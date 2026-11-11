import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _f = V(), _t = V();

/** Cold-gas RCS jets: six cones per thruster quad, fired according to the commanded force/torque. */
export function createRcsJets(points, scale = 1) {
  const group = new THREE.Group();
  const geo = new THREE.ConeGeometry(0.16 * scale, 1.5 * scale, 10, 1, true); geo.translate(0, -0.75 * scale, 0);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.85, 1.0).multiplyScalar(1.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const dirs = [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)];
  const jets = [];
  for (const p of points) for (const d of dirs) {
    // quads only carry outward-facing nozzles
    if (d.x * p.x < 0 && Math.abs(d.x) > 0) continue;
    const m = new THREE.Mesh(geo, mat); m.position.copy(p).addScaledVector(d, 0.3 * scale);
    m.quaternion.setFromUnitVectors(V(0, -1, 0), d); m.visible = false; m.renderOrder = 21;
    group.add(m); jets.push({ m, p, d });
  }
  /** force / torque: desired directions in the ship frame (zero vectors = idle) */
  group.userData.update = (force, torque, t) => {
    const fOn = force.lengthSq() > 1e-8, tOn = torque.lengthSq() > 1e-4;
    if (fOn) _f.copy(force).normalize();
    if (tOn) _t.copy(torque).normalize();
    for (let i = 0; i < jets.length; i++) {
      const j = jets[i];
      let on = fOn && -j.d.dot(_f) > 0.6; // exhaust leaves along d, pushing the ship along -d
      if (!on && tOn) { const tq = V().crossVectors(j.p, j.d).negate(); on = tq.dot(_t) > 0.45 * j.p.length(); }
      j.m.visible = on;
      if (on) { const k = 0.7 + 0.3 * Math.sin(t * 90 + i * 1.7); j.m.scale.set(k, 0.6 + 0.4 * Math.abs(Math.sin(t * 61 + i)), k); }
    }
  };
  group.userData.off = () => jets.forEach((j) => (j.m.visible = false));
  return group;
}

/** Drifting dust motes drawn as velocity streaks: the only thing in vacuum that shows your motion. */
export function createDust(count = 420, box = 360) {
  const pos = new Float32Array(count * 6), base = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) base[i] = (Math.random() - 0.5) * box;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xbfd0e6, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(g, mat); lines.frustumCulled = false; lines.renderOrder = 15;
  const wrap = (u) => ((u % box) + box * 1.5) % box - box / 2;
  /** vel: ship velocity relative to the local medium (m/s, world axes of the render frame) */
  lines.userData.update = (vel, dt) => {
    const sp = vel.length();
    mat.opacity += (Math.min(0.5, sp / 120) - mat.opacity) * Math.min(1, dt * 3);
    lines.visible = mat.opacity > 0.01;
    if (!lines.visible) return;
    const k = Math.min(1, 900 / Math.max(sp, 1e-6)); // cap the apparent speed so streaks stay readable
    const vx = vel.x * k, vy = vel.y * k, vz = vel.z * k;
    const len = Math.min(0.045, 14 / Math.max(sp * k, 1e-6));
    for (let i = 0; i < count; i++) {
      const b = i * 3, o = i * 6;
      const x = (base[b] = wrap(base[b] - vx * dt)), y = (base[b + 1] = wrap(base[b + 1] - vy * dt)), z = (base[b + 2] = wrap(base[b + 2] - vz * dt));
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      pos[o + 3] = x + vx * len + 0.02; pos[o + 4] = y + vy * len; pos[o + 5] = z + vz * len;
    }
    g.attributes.position.needsUpdate = true;
  };
  return lines;
}

/** Re-entry plasma sheath: a glowing bow shock ahead of the hull with a trailing wake. */
export function createPlasma(radius = 6) {
  const uniforms = { uHeat: { value: 0 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uHeat, uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float front = smoothstep(-0.6, 1.0, vP.z);           // +Z of the sheath faces the airflow
        float flick = 0.8 + 0.2 * sin(uTime * 37.0 + vP.x * 9.0) * sin(uTime * 23.0 + vP.y * 7.0);
        vec3 c = mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.85, 0.7), front * uHeat);
        float a = (rim * 0.7 + front * front * 0.55) * uHeat * flick;
        gl_FragColor = vec4(c * a * 5.0, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mat);
  m.renderOrder = 22; m.visible = false; m.frustumCulled = false;
  const z = V(0, 0, 1);
  /** dir: direction of travel through the gas (world), heat 0..1 */
  m.userData.update = (dir, heat, t) => {
    m.visible = heat > 0.01; if (!m.visible) return;
    uniforms.uHeat.value = heat; uniforms.uTime.value = t;
    m.quaternion.setFromUnitVectors(z, dir);
    m.scale.set(radius * 1.25, radius * 1.25, radius * (1.6 + heat * 1.6));
    m.position.copy(dir).multiplyScalar(-radius * (0.5 + heat * 1.2));
  };
  return m;
}
