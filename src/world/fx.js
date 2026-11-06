import * as THREE from 'three';
import { NOISE } from '../gl/noise.js';

/** Rocket exhaust. Extends along local +Y from y=0 (nozzle exit). sea=true adds Mach diamonds. */
export function createPlume({ radius = 1, length = 10, color = new THREE.Color(1, 0.6, 0.3), sea = false } = {}) {
  const geo = new THREE.CylinderGeometry(radius * 2.2, radius, length, 48, 48, true);
  geo.translate(0, length / 2, 0);
  const uniforms = { uThrottle: { value: 0 }, uTime: { value: 0 }, uColor: { value: color }, uSea: { value: sea ? 1 : 0 }, uExpand: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      uniform float uExpand; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vec3 p = position;
        p.xz *= 1.0 + uExpand * uv.y * 2.5; // under-expanded plume balloons at altitude
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uThrottle, uTime, uSea; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){
        float v = clamp(vUv.y, 0.0, 1.0);
        float face = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(clamp(face, 0.0, 1.0), 2.2);
        float n = snoise(vec3(vUv.x * 6.0, v * 8.0 - uTime * 14.0, uTime * 3.0)) * 0.5 + 0.5;
        float fall = pow(1.0 - v, 1.6);
        float diamonds = uSea > 0.5 ? pow(abs(sin(v * 34.0)), 10.0) * smoothstep(0.45, 0.0, v) : 0.0;
        vec3 hot = mix(uColor, vec3(1.0, 0.95, 0.85), core * smoothstep(0.35, 0.0, v));
        float I = (fall * (0.55 + 0.6 * n) * core + diamonds * core * 1.5) * uThrottle;
        gl_FragColor = vec4(hot * I * 5.0, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 20;
  m.userData.set = (thr, t, expand = 0) => { uniforms.uThrottle.value = thr; uniforms.uTime.value = t; uniforms.uExpand.value = expand; m.visible = thr > 0.002; };
  m.visible = false;
  return m;
}

/**
 * Deterministic smoke/vapour trail. Each particle is born at a fixed time along an emitter path,
 * so scrubbing the timeline reproduces exactly the same plume.
 */
export function createSmokeTrail({ count = 1800, t0 = 0, t1 = 30, path, spread = 4, rise = 0.6, grow = 6, life = 25, size = 14, color = new THREE.Color(0.85, 0.84, 0.82), sunDir }) {
  const pos = new Float32Array(count * 3), birth = new Float32Array(count), seed = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    birth[i] = t0 + (t1 - t0) * (i / count);
    seed.set([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('birth', new THREE.BufferAttribute(birth, 1));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
  const uniforms = { uTime: { value: 0 }, uSize: { value: size }, uGrow: { value: grow }, uLife: { value: life }, uColor: { value: color }, uSun: { value: sunDir || new THREE.Vector3(0, 1, 0) }, uScale: { value: window.innerHeight }, uLight: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute float birth; attribute vec3 seed; uniform float uTime, uSize, uGrow, uLife, uScale; varying float vA; varying float vAge;
      void main(){
        float age = uTime - birth; vAge = age / uLife;
        vA = age < 0.0 ? 0.0 : (1.0 - smoothstep(0.3, 1.0, vAge)) * smoothstep(0.0, 0.4, age);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float s = uSize * (1.0 + uGrow * sqrt(max(age, 0.0) / uLife)) * (0.7 + 0.3 * seed.x);
        gl_PointSize = vA > 0.0 ? clamp(s * uScale / -mv.z, 0.0, 900.0) : 0.0;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor, uSun; uniform float uLight; varying float vA; varying float vAge;
      void main(){
        vec2 c = gl_PointCoord * 2.0 - 1.0; float d = dot(c, c); if (d > 1.0) discard;
        vec3 n = vec3(c.x, -c.y, sqrt(1.0 - d));
        float l = 0.45 + 0.55 * max(dot(n, normalize(vec3(uSun.x, uSun.y, 0.6))), 0.0);
        float a = (1.0 - d) * (1.0 - d) * vA * 0.32;
        gl_FragColor = vec4(uColor * l * uLight * (1.0 - vAge * 0.3), a);
      }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  const tmp = new THREE.Vector3();
  pts.userData.update = (t) => {
    uniforms.uTime.value = t; uniforms.uScale.value = window.innerHeight;
    for (let i = 0; i < count; i++) {
      const b = birth[i]; const age = Math.max(0, t - b);
      path(b, tmp);
      const sx = seed[i * 3], sy = seed[i * 3 + 1], sz = seed[i * 3 + 2];
      const spreadNow = spread * Math.sqrt(age + 0.2);
      pos[i * 3] = tmp.x + sx * spreadNow;
      pos[i * 3 + 1] = tmp.y + sy * spreadNow * 0.4 + rise * age;
      pos[i * 3 + 2] = tmp.z + sz * spreadNow;
    }
    g.attributes.position.needsUpdate = true;
  };
  return pts;
}

/** Fireball + shock ring + tumbling debris. update(age seconds). */
export function createExplosion({ scale = 10, debris = 140 } = {}) {
  const group = new THREE.Group();
  const fu = { uAge: { value: 0 }, uTime: { value: 0 } };
  const fire = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({
    uniforms: fu,
    vertexShader: /* glsl */`varying vec3 vP; varying vec3 vN; varying vec3 vV; uniform float uAge;
      ${NOISE}
      void main(){ vP = position; float n = snoise(position * 2.0 + uAge); vec3 p = position * (1.0 + 0.25 * n);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uAge, uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float n = fbm3(vP * 3.0 + vec3(0.0, uAge * 1.5, 0.0)) * 0.5 + 0.5;
        float heat = clamp(1.4 - uAge * 0.5, 0.0, 1.0);
        vec3 c = mix(vec3(0.25, 0.04, 0.0), vec3(1.0, 0.55, 0.15), n * heat);
        c = mix(c, vec3(1.0, 0.95, 0.8), pow(n * f * heat, 3.0));
        float a = smoothstep(0.0, 0.2, f) * clamp(1.6 - uAge * 0.45, 0.0, 1.0);
        gl_FragColor = vec4(c * (3.0 + heat * 8.0) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(fire);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.8, 0.6).multiplyScalar(4), transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(ring);
  const dMat = new THREE.MeshStandardMaterial({ color: 0x9a9894, metalness: 0.7, roughness: 0.4, emissive: 0xff5a1a, emissiveIntensity: 1 });
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.15, 0.6), dMat, debris);
  const vel = [], spin = [];
  for (let i = 0; i < debris; i++) {
    vel.push(new THREE.Vector3().randomDirection().multiplyScalar(0.3 + Math.random() * 1.2));
    spin.push(new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(4));
  }
  group.add(inst);
  const light = new THREE.PointLight(0xff9a50, 0, scale * 30, 1.5);
  group.add(light);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  group.visible = false;
  group.userData.update = (age, t = 0) => {
    group.visible = age > 0 && age < 30;
    if (!group.visible) return;
    fu.uAge.value = age; fu.uTime.value = t;
    const r = scale * (1 - Math.exp(-age * 2.2)) * 1.6;
    fire.scale.setScalar(Math.max(0.01, r));
    fire.visible = age < 5;
    ring.scale.setScalar(scale * age * 5.0); ring.material.opacity = Math.max(0, 1 - age * 0.6); ring.visible = age < 2;
    light.intensity = Math.max(0, 1 - age * 0.35) * 600 * scale;
    dMat.emissiveIntensity = Math.max(0, 2 - age * 0.6);
    for (let i = 0; i < debris; i++) {
      p.copy(vel[i]).multiplyScalar(age * scale * 1.4);
      e.set(spin[i].x * age, spin[i].y * age, spin[i].z * age); q.setFromEuler(e);
      s.setScalar(scale * 0.06 * (0.4 + (i % 7) * 0.2));
      m.compose(p, q, s); inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
  };
  return group;
}

/** Instanced asteroid field (realistic sparse belt, rendered dense for cinema). */
export function createAsteroids({ count = 2500, inner = 300, outer = 600, thickness = 40, sunDir }) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.35 * Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3) + 0.18 * Math.sin(v.x * 7 + v.z * 5);
    v.multiplyScalar(n); v.y *= 0.75; p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f665c, roughness: 0.95, metalness: 0.05, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), c = new THREE.Color();
  const data = [];
  for (let i = 0; i < count; i++) {
    const r = inner + Math.random() * (outer - inner), a = Math.random() * Math.PI * 2;
    const size = Math.pow(Math.random(), 6) * 9 + 0.3;
    data.push({ r, a, y: (Math.random() - 0.5) * thickness, size, axis: new THREE.Vector3().randomDirection(), w: Math.random() * 0.4 });
    c.setHSL(0.07 + Math.random() * 0.03, 0.15 + Math.random() * 0.15, 0.25 + Math.random() * 0.25);
    inst.setColorAt(i, c);
  }
  inst.userData.update = (t) => {
    for (let i = 0; i < count; i++) {
      const d = data[i];
      const a = d.a + t * 0.004 * Math.pow(inner / d.r, 1.5);
      pos.set(Math.cos(a) * d.r, d.y, Math.sin(a) * d.r);
      q.setFromAxisAngle(d.axis, t * d.w);
      s.setScalar(d.size);
      m.compose(pos, q, s); inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
  };
  inst.frustumCulled = false;
  return inst;
}
