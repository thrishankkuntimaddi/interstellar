import * as THREE from 'three';
import { TEX } from './assets.js';
import { NOISE, EQUIRECT, BLACKBODY } from '../gl/noise.js';

export const SKY = { ours: null, other: null };

function followCamera(mesh) {
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.updateMatrixWorld(); };
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
}

/** Point-sprite stars with realistic magnitude and colour distribution. */
export function createStarPoints(count = 6000, { radius = 900, seed = 1, size = 1.0, gain = 1.0 } = {}) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), sz = new Float32Array(count), ph = new Float32Array(count);
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos.set([r * Math.cos(th) * radius, u * radius, r * Math.sin(th) * radius], i * 3);
    const mag = Math.pow(rnd(), 7.0);               // most stars faint, a few very bright
    const T = 2800 + Math.pow(rnd(), 1.6) * 14000;   // K
    // quick blackbody-ish tint
    const t = (T - 2800) / 14000;
    tmp.setRGB(1.0, 0.72 + 0.28 * Math.min(1, t * 2), 0.45 + 0.65 * t);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
    sz[i] = (0.8 + mag * 5.5) * size;
    ph[i] = rnd() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGain: { value: gain }, uPR: { value: Math.min(window.devicePixelRatio, 1.5) } },
    vertexShader: /* glsl */`
      attribute float size; attribute float phase; attribute vec3 color;
      uniform float uTime, uPR; varying vec3 vCol; varying float vB;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.85 + 0.15 * sin(uTime * (1.3 + fract(phase) * 2.0) + phase);
        vB = size * tw; vCol = color;
        gl_PointSize = max(1.5, size * uPR * 1.4);
      }`,
    fragmentShader: /* glsl */`
      uniform float uGain; varying vec3 vCol; varying float vB;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
        float a = (exp(-d * 28.0) + 0.12 * exp(-d * 6.0)) * smoothstep(0.25, 0.12, d); // round, fades to 0 inside the sprite
        gl_FragColor = vec4(vCol * a * vB * 0.55 * uGain, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
  });
  const p = new THREE.Points(g, m);
  followCamera(p);
  return p;
}

/** The real Milky Way panorama (ESO/S. Brunier via Solar System Scope) as the sky of the Solar System. */
export function createMilkyWay({ gain = 1.0, stars = true } = {}) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { tSky: { value: TEX.milkyway }, uGain: { value: gain } },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tSky; uniform float uGain; varying vec3 vDir;
      ${EQUIRECT}
      void main(){
        vec3 c = texture2D(tSky, dirToEquirect(normalize(vDir))).rgb;
        c = pow(c, vec3(1.25)) * uGain;      // deepen blacks, keep the galactic band
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), mat);
  followCamera(sphere);
  group.add(sphere);
  if (stars) group.add(createStarPoints(2600, { seed: 3, gain: 0.9 }));
  group.userData.setGain = (g) => { mat.uniforms.uGain.value = g; };
  group.userData.update = (t) => group.children.forEach((c) => c.material.uniforms.uTime && (c.material.uniforms.uTime.value = t));
  return group;
}

/** Procedural sky of the far galaxy on the other side of the wormhole. */
export function createOtherSky({ gain = 1.0, stars = true } = {}) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uGain: { value: gain } },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uGain; varying vec3 vDir;
      ${NOISE}
      ${BLACKBODY}
      void main(){
        vec3 d = normalize(vDir);
        // galactic plane tilted ~25 deg
        vec3 n = normalize(vec3(0.15, 0.9, 0.42));
        float lat = dot(d, n);
        float band = exp(-lat*lat*28.0);
        float bulge = exp(-pow(length(d - normalize(vec3(-0.6, 0.2, -0.75))), 2.0) * 6.0);
        float neb = fbm(d * 3.0) * 0.5 + 0.5;
        float dust = smoothstep(0.35, 0.75, fbm(d * 7.0 + 3.0) * 0.5 + 0.5);
        vec3 warm = vec3(1.0, 0.72, 0.45), cool = vec3(0.45, 0.6, 1.0);
        vec3 col = mix(cool, warm, smoothstep(0.2, 0.9, neb)) * band * (0.18 + 0.5 * neb) * (1.0 - dust * 0.85 * band);
        col += warm * bulge * 0.55 * (1.0 - dust * 0.7);
        // faint emission nebulae
        float em = smoothstep(0.55, 0.9, fbm(d * 2.2 + 11.0) * 0.5 + 0.5);
        col += vec3(0.9, 0.25, 0.35) * em * 0.06 + vec3(0.2, 0.5, 0.9) * smoothstep(0.6, 0.95, fbm(d*1.7-5.0)*0.5+0.5) * 0.05;
        // unresolved star haze
        col += vec3(0.6, 0.65, 0.8) * 0.012;
        // tiny resolved stars
        vec3 q = d * 420.0; vec3 id = floor(q); float h = hash13(id);
        if (h > 0.985) { vec3 f = fract(q) - 0.5; float s = exp(-dot(f,f) * 60.0); col += blackbody(3000.0 + 9000.0 * hash13(id + 7.0)) * s * (h - 0.985) * 120.0 * (0.4 + band); }
        // distant galaxies
        for (int i = 0; i < 3; i++){
          vec3 c = normalize(vec3(sin(float(i)*2.4+1.0), cos(float(i)*3.1)*0.6, cos(float(i)*1.7+2.0)));
          float r = length(d - c);
          col += vec3(1.0, 0.85, 0.7) * exp(-r*r*9000.0) * 0.9 + vec3(0.7,0.75,1.0) * exp(-r*r*900.0) * 0.06;
        }
        gl_FragColor = vec4(col * uGain, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), mat);
  followCamera(sphere);
  group.add(sphere);
  if (stars) group.add(createStarPoints(5000, { seed: 11, gain: 1.0 }));
  group.userData.setGain = (g) => { mat.uniforms.uGain.value = g; };
  group.userData.update = (t) => group.children.forEach((c) => c.material.uniforms.uTime && (c.material.uniforms.uTime.value = t));
  return group;
}

/** Bake both skies into HDR cubemaps that the black hole and wormhole ray tracers sample. */
export function bakeSkies(renderer) {
  const bake = (group) => {
    const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cam = new THREE.CubeCamera(0.1, 5000, rt);
    const scene = new THREE.Scene();
    scene.add(group, cam);
    const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    cam.update(renderer, scene);
    renderer.toneMapping = tm;
    return rt.texture;
  };
  SKY.ours = bake(createMilkyWay({ gain: 1.0 }));
  SKY.other = bake(createOtherSky({ gain: 1.0 }));
}
