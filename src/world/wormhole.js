import * as THREE from 'three';
import { NOISE, FS_VERT, RAY } from '../gl/noise.js';
import { SKY } from './sky.js';

/**
 * Spherical wormhole mouth (Ellis/Morris–Thorne-style lens).
 * Rays with impact parameter b > R are deflected around the mouth (lensing our sky, bright
 * Einstein ring at b≈R). Rays with b < R pass through the throat and map onto the entire sky of
 * the destination galaxy, compressed into the sphere — the "crystal ball" look.
 */
export function createWormhole({ radius = 40 } = {}) {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() }, uR: { value: radius }, uTime: { value: 0 },
    uOurs: { value: SKY.ours }, uOther: { value: SKY.other }, uGain: { value: 1.0 }, uRipple: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCenter; uniform float uR, uTime, uGain, uRipple; uniform samplerCube uOurs, uOther; varying vec3 vW;
      ${NOISE}
      vec3 rotAxis(vec3 v, vec3 axis, float ang){ float c = cos(ang), s = sin(ang); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
      void main(){
        vec3 ro = cameraPosition - uCenter;
        vec3 rd = normalize(vW - cameraPosition);
        float tc = -dot(ro, rd);
        vec3 closest = ro + rd * max(tc, 0.0);
        float b = length(closest);
        float x = b / uR;
        vec3 toC = normalize(-closest + 1e-6);
        vec3 axis = normalize(cross(rd, toC) + 1e-6);
        float outer = 3.0;
        vec3 col; float alpha = 1.0;
        if (x < 1.0 && tc > 0.0){
          // through the throat: full other-sky squeezed into the disc, mirrored at the rim
          float ang = 3.14159 * pow(x, 1.6);
          float wob = uRipple * 0.05 * snoise(closest / uR * 3.0 + vec3(uTime * 0.5));
          vec3 d = rotAxis(rd, axis, ang + wob);
          col = textureCube(uOther, d).rgb * 1.15;
          // thin bright caustic just inside the rim
          col += vec3(1.0, 0.9, 0.75) * exp(-pow((1.0 - x) * 40.0, 2.0)) * 0.8;
        } else {
          // lensed exterior sky
          float defl = 2.0 / (x * x) * 0.55;
          vec3 d = rotAxis(rd, axis, defl);
          col = textureCube(uOurs, d).rgb;
          col += textureCube(uOther, -d).rgb * exp(-pow((x - 1.0) * 18.0, 2.0)) * 0.6; // secondary image
          alpha = 1.0 - smoothstep(1.6, outer, x);
          if (tc < 0.0) alpha *= smoothstep(-uR, 0.0, tc);
        }
        gl_FragColor = vec4(col * uGain, alpha);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 3.0, 96, 64), mat);
  mesh.onBeforeRender = () => mesh.getWorldPosition(uniforms.uCenter.value);
  mesh.renderOrder = -500;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

/** Interior of the wormhole: a full-screen tunnel through warped spacetime. */
export function createWormholeTunnel() {
  const uniforms = {
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uOurs: { value: SKY.ours }, uOther: { value: SKY.other }, uProgress: { value: 0 }, uTime: { value: 0 }, uAxis: { value: new THREE.Vector3(0, 0, -1) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */`
      ${RAY}
      ${NOISE}
      uniform samplerCube uOurs, uOther; uniform float uProgress, uTime; uniform vec3 uAxis;
      vec3 rotAxis(vec3 v, vec3 axis, float ang){ float c = cos(ang), s = sin(ang); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
      void main(){
        vec3 rd = viewRay();
        vec3 ax = normalize(uAxis);
        float mu = dot(rd, ax);                 // 1 = straight ahead
        float th = acos(clamp(mu, -1.0, 1.0));  // angle from tunnel axis
        vec3 side = normalize(rd - ax * mu + 1e-5);
        float phi = atan(dot(side, normalize(cross(ax, vec3(0.0,1.0,0.0)))), dot(side, vec3(0.0,1.0,0.0)));
        // tunnel walls: depth coordinate grows towards the axis
        float depth = 1.0 / max(th, 0.02);
        float z = depth * 0.35 + uTime * 2.6;
        float swirl = phi + z * 0.18 + uTime * 0.25;
        // walls show the sky, smeared by the twisting geometry
        vec3 d1 = rotAxis(rd, ax, swirl * 0.6);
        d1 = normalize(mix(d1, ax, 0.35 * smoothstep(1.5, 0.2, th)));
        vec3 sky = mix(textureCube(uOurs, d1).rgb, textureCube(uOther, d1).rgb, smoothstep(0.35, 0.85, uProgress));
        float streak = pow(snoise(vec3(phi * 5.0, z * 0.5, 0.0)) * 0.5 + 0.5, 6.0);
        float streak2 = pow(snoise(vec3(phi * 13.0, z * 1.6, 3.0)) * 0.5 + 0.5, 10.0);
        vec3 col = sky * (0.7 + 1.6 * streak);
        col += vec3(0.7, 0.85, 1.0) * streak2 * 0.9 * smoothstep(0.1, 0.9, th);
        col += vec3(1.0, 0.75, 0.45) * streak * 0.25 * smoothstep(1.2, 0.3, th);
        // the exit: other galaxy opening ahead
        float hole = smoothstep(0.08 + 0.55 * uProgress, 0.02 + 0.45 * uProgress, th);
        vec3 ahead = textureCube(uOther, rotAxis(rd, ax, th * 1.6)).rgb * 1.4;
        col = mix(col, ahead, hole * smoothstep(0.2, 0.6, uProgress));
        // rim glow
        col += vec3(1.0, 0.92, 0.8) * exp(-pow((th - (0.06 + 0.5 * uProgress)) * 30.0, 2.0)) * smoothstep(0.2, 0.6, uProgress) * 1.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -2000;
  mesh.onBeforeRender = (r, s, cam) => {
    uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    uniforms.uCamWorld.value.copy(cam.matrixWorld);
    uniforms.uCamPos.value.copy(cam.position);
  };
  mesh.userData.uniforms = uniforms;
  return mesh;
}
