import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createPlume } from './fx.js';
import { MAT, hullPanels, rng } from './materials.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Legacy helper still used by a few scenes (habitat): panel texture set. */
export function panelTextures({ seed = 7, windows = false, base = 214 } = {}) {
  const t = hullPanels({ seed, windows, base: [base, base, base - 3] });
  return { map: t.map, roughnessMap: t.roughnessMap, emissiveMap: t.emissiveMap };
}

// ---------------------------------------------------------------------------
// small reusable details
// ---------------------------------------------------------------------------
function bell(r0, r1, len, segs = 40) {
  const pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(r0 + (r1 - r0) * Math.pow(t, 0.55), -t * len)); }
  return new THREE.LatheGeometry(pts, segs);
}
function rcsQuad(mat, nozMat, s = 1) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.34 * s, 0.34 * s), mat);
  g.add(box);
  const dirs = [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, 0, 1)];
  for (const d of dirs) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.07 * s, 0.14 * s, 10, 1, true), nozMat);
    c.position.copy(d).multiplyScalar(0.22 * s); c.quaternion.setFromUnitVectors(V(0, 1, 0), d);
    g.add(c);
  }
  return g;
}
function handrail(len, mat) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 6), mat); bar.rotation.z = Math.PI / 2; bar.position.y = 0.09; g.add(bar);
  for (const x of [-len / 2 + 0.05, len / 2 - 0.05]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 6), mat); p.position.set(x, 0.045, 0); g.add(p); }
  return g;
}
function strobe(color, size = 0.07) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(8) }));
  return m;
}

// ---------------------------------------------------------------------------
// RANGER — lifting-body shuttle. Forward = +Z, up = +Y, length ~14 m.
// The hull is a lofted superellipse surface: flat tiled belly, rounded white upper body.
// ---------------------------------------------------------------------------
export function createRanger({ length = 14, width = 8.4, height = 3.2 } = {}) {
  const group = new THREE.Group();
  const W = (s) => width * (s < 0.5 ? 1 - 0.1 * s : 0.95 * Math.pow(Math.cos(((s - 0.5) / 0.5) * Math.PI * 0.5), 0.62)) + 0.18;
  const HT = (s) => height * 0.62 * (s < 0.4 ? 1 : 0.25 + 0.75 * Math.pow(Math.cos(((s - 0.4) / 0.6) * Math.PI * 0.5), 0.9));
  const HB = (s) => height * 0.38 * (s < 0.55 ? 1 : 0.2 + 0.8 * Math.pow(Math.cos(((s - 0.55) / 0.45) * Math.PI * 0.5), 0.7));
  const lift = (s) => (s > 0.6 ? Math.pow((s - 0.6) / 0.4, 2) * 0.35 : 0); // nose rises slightly
  // surface point: s along length (0 tail -> 1 nose), t around section (0..2π, 0 = starboard chine)
  const surf = (s, t, out = new THREE.Vector3(), off = 0) => {
    const c = Math.cos(t), sn = Math.sin(t);
    const x = (W(s) / 2) * Math.sign(c) * Math.pow(Math.abs(c), 0.6);
    const top = sn >= 0;
    const y = (top ? HT(s) * Math.pow(Math.abs(sn), 0.62) : -HB(s) * Math.pow(Math.abs(sn), 0.3)) + lift(s);
    out.set(x, y, -length / 2 + s * length);
    if (off) { const n = V(x / Math.max(W(s), 0.1), y / Math.max(top ? HT(s) : HB(s), 0.1) * 0.5, 0).normalize(); out.addScaledVector(n, off); }
    return out;
  };
  const S = 96, T = 64;
  const buildPatch = (s0, s1, t0, t1, ns, nt, off = 0) => {
    const pos = [], uv = [], idx = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= ns; i++) for (let j = 0; j <= nt; j++) {
      const s = s0 + ((s1 - s0) * i) / ns, t = t0 + ((t1 - t0) * j) / nt;
      surf(s, t, p, off); pos.push(p.x, p.y, p.z);
      uv.push((t / (Math.PI * 2)) * (width * 1.5) / 4, (s * length) / 4);
    }
    for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
      const a = i * (nt + 1) + j, b = a + 1, c = a + nt + 1, d = c + 1;
      idx.push(a, b, c, b, d, c); // counter-clockwise seen from outside
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const whiteMat = MAT.hull({ seed: 42, base: [226, 226, 222] }, [1, 1]);
  const tileMat = MAT.tiles([1.6, 1.6]);
  const topG = buildPatch(0, 1, 0, Math.PI, S, T / 2);
  const belG = buildPatch(0, 1, Math.PI, Math.PI * 2, S, T / 2);
  const top = new THREE.Mesh(topG, whiteMat); const bel = new THREE.Mesh(belG, tileMat);
  for (const m of [top, bel]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  // black leading-edge band (reinforced carbon-carbon) along the chines and nose
  const rcc = new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.65, metalness: 0.1 });
  for (const t0 of [-0.16, Math.PI - 0.0]) { const g = buildPatch(0.02, 1, t0, t0 + 0.16, 80, 3, 0.004); const m = new THREE.Mesh(g, rcc); group.add(m); }
  const nose = new THREE.Mesh(buildPatch(0.93, 1, 0, Math.PI * 2, 12, 48, 0.005), rcc); group.add(nose);
  // cockpit glazing: four panes on the upper forward fuselage, with frames
  const glass = MAT.glass();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.6 });
  const panes = [[1.05, 1.42], [1.46, 1.68], [1.72, 2.09]].flatMap(([a, b]) => [[a, b]]);
  const ws0 = 0.70, ws1 = 0.80;
  for (const [a, b] of [[0.95, 1.3], [1.34, 1.57], [1.57, 1.8], [1.84, 2.19]]) {
    const g = buildPatch(ws0, ws1, a, b, 10, 8, 0.02);
    group.add(new THREE.Mesh(g, glass));
  }
  for (const t of [0.93, 1.32, 1.57, 1.82, 2.21]) {
    const pts = []; for (let i = 0; i <= 10; i++) pts.push(surf(ws0 + ((ws1 - ws0) * i) / 10, t, V(), 0.035));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.035, 6), frameMat));
  }
  for (const s of [ws0, ws1]) {
    const pts = []; for (let i = 0; i <= 16; i++) pts.push(surf(s, 0.93 + (1.28 * i) / 16, V(), 0.035));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.035, 6), frameMat));
  }
  // aft bulkhead
  const shape = new THREE.Shape();
  for (let j = 0; j <= 64; j++) { const p = surf(0, (j / 64) * Math.PI * 2, V()); j ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y); }
  const bulk = new THREE.Mesh(new THREE.ShapeGeometry(shape), MAT.darkMetal());
  bulk.position.z = -length / 2 - 0.01; bulk.rotation.y = Math.PI; bulk.scale.x = -1; group.add(bulk);
  // main engines + OMS pods
  const noz = MAT.nozzle();
  const plumes = [];
  const engines = [[-2.3, -0.28, 0.62], [0, -0.32, 0.78], [2.3, -0.28, 0.62], [-1.2, 0.75, 0.32], [1.2, 0.75, 0.32]];
  engines.forEach(([x, y, r], i) => {
    const b = new THREE.Mesh(bell(r * 0.45, r, r * 2.4), noz); b.rotation.x = -Math.PI / 2; b.position.set(x, y, -length / 2 + 0.05); group.add(b);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(r * 0.48, r * 0.08, 8, 24), MAT.darkMetal()); collar.position.set(x, y, -length / 2 - 0.02); group.add(collar);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.44, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.25).multiplyScalar(0.0) }));
    disc.position.set(x, y, -length / 2 - 0.1); disc.rotation.y = Math.PI; group.add(disc);
    if (i < 3) {
      const pl = createPlume({ radius: r * 0.95, length: 10, color: new THREE.Color(0.55, 0.7, 1.0) });
      pl.position.set(x, y, -length / 2 - r * 2.4); pl.rotation.x = -Math.PI / 2; group.add(pl);
      plumes.push({ plume: pl, disc });
    }
  });
  // RCS quads at nose and tail corners
  const rcsMat = MAT.hull({ seed: 5, base: [200, 200, 196] }, [0.2, 0.2]);
  for (const [s, t] of [[0.88, 0.25], [0.88, Math.PI - 0.25], [0.08, 0.35], [0.08, Math.PI - 0.35]]) {
    const q = rcsQuad(rcsMat, noz, 1); q.position.copy(surf(s, t, V(), 0.12)); group.add(q);
  }
  // docking collar on the upper aft fuselage
  const sCol = 0.28;
  const collar = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.2, 0.95, 48), MAT.metal(0x9c9d9f, 0.35));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.1, 12, 48), MAT.metal(0xb5b6b8, 0.25)); lip.rotation.x = Math.PI / 2; lip.position.y = 0.48;
  const petals = new THREE.Group();
  for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.08), MAT.darkMetal()); const a = (k / 3) * Math.PI * 2; p.position.set(Math.cos(a) * 0.95, 0.62, Math.sin(a) * 0.95); p.rotation.y = -a; petals.add(p); }
  collar.add(ring, lip, petals);
  const topAtCol = surf(sCol, Math.PI / 2, V());
  collar.position.set(0, topAtCol.y + 0.3, topAtCol.z);
  group.add(collar);
  // antenna + handrails
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), MAT.metal()); ant.position.copy(surf(0.55, Math.PI / 2, V())).add(V(0.4, 0.6, 0)); group.add(ant);
  for (const s of [0.4, 0.5, 0.6]) { const h = handrail(0.9, MAT.metal(0xd8c070, 0.4)); h.position.copy(surf(s, Math.PI / 2 - 0.5, V(), 0.01)); h.rotation.z = -0.3; group.add(h); }
  // nav lights
  const navs = [];
  const pS = surf(0.25, 0.02, V(), 0.06), pP = surf(0.25, Math.PI - 0.02, V(), 0.06);
  [[pS, 0xff2a2a], [pP, 0x2aff6a], [surf(0.05, Math.PI / 2, V(), 0.15), 0xffffff]].forEach(([p, c]) => { const m = strobe(c, 0.08); m.position.copy(p); group.add(m); navs.push(m); });
  const spot = new THREE.SpotLight(0xfff1dd, 0, 90, 0.45, 0.6, 1.2);
  spot.position.copy(surf(0.98, Math.PI * 1.5, V())); spot.target.position.set(0, 0, length / 2 + 25);
  group.add(spot, spot.target);

  group.userData = {
    length, collar, plumes, navs, spot,
    cockpit: surf(0.74, Math.PI / 2, V()).add(V(0, -0.55, 0)),
    setThrust(v, t = 0) { plumes.forEach(({ plume, disc }) => { plume.userData.set(v, t); disc.material.color.setRGB(1.0, 0.55, 0.25).multiplyScalar(0.01 + v * 8); }); },
    blink(t) { navs.forEach((m, i) => { m.visible = i < 2 ? (Math.floor(t * 1.1 + i * 0.5) % 2) === 0 : (t % 1.3) < 0.07; }); },
  };
  return group;
}

// ---------------------------------------------------------------------------
// ENDURANCE — twelve-module ring (~64 m), central hub, truss spokes. Spin axis = Z.
// ---------------------------------------------------------------------------
export function createEndurance({ radius = 32 } = {}) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const r = rng(77);
  const hullW = MAT.hull({ seed: 11, windows: true, base: [222, 222, 218] }, [1.6, 1]);
  const hullG = MAT.hull({ seed: 23, base: [196, 197, 196] }, [1.6, 1]);
  const gold = MAT.foil('gold', [2, 2]);
  const silver = MAT.foil('silver', [2, 2]);
  const blackFoil = MAT.foil('black', [2, 2]);
  const solar = MAT.solar([1, 2]);
  const rad = MAT.radiator([1, 1]);
  const metal = MAT.metal();
  const dark = MAT.darkMetal();
  const noz = MAT.nozzle();

  const modules = [];
  const boxA = new RoundedBoxGeometry(11, 4.6, 6.2, 4, 0.55);
  const boxB = new RoundedBoxGeometry(10, 5.6, 7.2, 4, 0.8);
  const cyl = new THREE.CylinderGeometry(2.7, 2.7, 10.5, 40, 1); cyl.rotateZ(Math.PI / 2);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const mod = new THREE.Group();
    const kind = i % 3;
    const core = new THREE.Mesh(kind === 0 ? boxB : kind === 1 ? boxA : cyl, kind === 2 ? hullG : hullW);
    core.castShadow = core.receiveShadow = true;
    mod.add(core);
    // foil-wrapped equipment boxes and a radiator or solar wing on the outer face
    for (let k = 0; k < 5; k++) {
      const gb = new THREE.Mesh(new THREE.BoxGeometry(0.6 + r() * 1.6, 0.3 + r() * 0.6, 0.6 + r() * 1.4), r() < 0.5 ? gold : r() < 0.5 ? silver : blackFoil);
      gb.position.set((r() - 0.5) * 8, 2.4 + (kind === 0 ? 0.5 : 0), (r() - 0.5) * 4); gb.castShadow = true; mod.add(gb);
    }
    if (kind === 1) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.08, 8.5), solar); wing.position.set(0, 3.6, 0); wing.castShadow = true; mod.add(wing);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), metal); strut.position.set(0, 2.9, 0); mod.add(strut);
    } else if (kind === 0) {
      for (const z of [-4.4, 4.4]) { const rp = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 2.4), rad); rp.position.set(0, 1.2, z); rp.rotation.x = z > 0 ? 0.35 : -0.35; mod.add(rp); }
    }
    for (const x of [-3, 0, 3]) { const h = handrail(1.4, MAT.metal(0xd8c070, 0.4)); h.position.set(x, kind === 0 ? 2.8 : 2.3, 3.2); h.rotation.x = Math.PI / 2; mod.add(h); }
    const q = rcsQuad(hullG, noz, 1.4); q.position.set(5.2, 0, kind === 0 ? 3.7 : 3.2); mod.add(q);
    mod.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    mod.rotation.z = a - Math.PI / 2;
    spin.add(mod); modules.push(mod);
    // ribbed pressurised connector to the next module
    const a2 = a + Math.PI / 12;
    const tube = new THREE.Group();
    const t0 = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 6.2, 28), blackFoil); tube.add(t0);
    for (let k = -2; k <= 2; k++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 8, 28), metal); rib.rotation.x = Math.PI / 2; rib.position.y = k * 1.3; tube.add(rib); }
    tube.position.set(Math.cos(a2) * radius, Math.sin(a2) * radius, 0); tube.rotation.z = a2;
    tube.traverse((o) => (o.castShadow = true));
    spin.add(tube);
  }
  // hub
  const hub = new THREE.Group();
  const hubCore = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 13, 48), hullG); hubCore.rotation.x = Math.PI / 2; hubCore.castShadow = hubCore.receiveShadow = true; hub.add(hubCore);
  for (const z of [-3.5, 0, 3.5]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(3.48, 3.48, 1.4, 48, 1, true), z === 0 ? gold : blackFoil); band.rotation.x = Math.PI / 2; band.position.z = z; hub.add(band); }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const q = rcsQuad(hullG, noz, 1.2); q.position.set(Math.cos(a) * 3.6, Math.sin(a) * 3.6, 5.6); hub.add(q); }
  spin.add(hub);
  // docking ports (androgynous adapters) at both ends
  const ports = [];
  [6.5, -6.5].forEach((z) => {
    const port = new THREE.Group();
    const adapter = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.7, 1.4, 48), MAT.metal(0xa5a6a8, 0.35)); adapter.rotation.x = Math.PI / 2;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.12, 12, 48), MAT.metal(0xbfc0c2, 0.25)); lip.position.z = Math.sign(z) * 0.7;
    const lamp = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.045, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.0, 0.6).multiplyScalar(1.2) }));
    lamp.position.z = Math.sign(z) * 0.6;
    port.add(adapter, lip, lamp);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5; const tgt = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.05), new THREE.MeshBasicMaterial({ color: 0xf0f0f0 })); tgt.position.set(Math.cos(a) * 2.3, Math.sin(a) * 2.3, Math.sign(z) * 0.2); port.add(tgt); }
    port.position.z = z + Math.sign(z) * 0.7;
    spin.add(port); ports.push(port);
  });
  // truss spokes: three longerons with diagonal bracing (instanced)
  const strutGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6);
  const members = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 12;
    const dir = V(Math.cos(a), Math.sin(a), 0), side = V(-Math.sin(a), Math.cos(a), 0);
    const r0 = 3.4, r1 = radius - 2.6, L = r1 - r0;
    const corners = [[side.clone().multiplyScalar(0.7), V(0, 0, 0.7)], [side.clone().multiplyScalar(-0.7), V(0, 0, 0.7)], [V(), V(0, 0, -0.8)]].map(([s, z]) => s.add(z));
    for (const c of corners) members.push([dir.clone().multiplyScalar(r0).add(c), dir.clone().multiplyScalar(r1).add(c), 0.11]);
    const bays = 10;
    for (let b = 0; b < bays; b++) for (let k = 0; k < 3; k++) {
      const c0 = corners[k], c1 = corners[(k + 1) % 3];
      members.push([dir.clone().multiplyScalar(r0 + (L * b) / bays).add(c0), dir.clone().multiplyScalar(r0 + (L * (b + 1)) / bays).add(c1), 0.05]);
    }
    // utility conduit along the spoke
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, L, 10), gold);
    conduit.position.copy(dir.clone().multiplyScalar(r0 + L / 2)); conduit.quaternion.setFromUnitVectors(V(0, 1, 0), dir); spin.add(conduit);
  }
  const inst = new THREE.InstancedMesh(strutGeo, metal, members.length);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion();
  members.forEach(([p0, p1, w], k) => {
    const d = p1.clone().sub(p0); const len = d.length();
    qq.setFromUnitVectors(V(0, 1, 0), d.normalize());
    m4.compose(p0.clone().add(p1).multiplyScalar(0.5), qq, V(w / 0.07, len, w / 0.07)); inst.setMatrixAt(k, m4);
  });
  inst.castShadow = true;
  spin.add(inst);
  // high-gain dish
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2.4, 40, 16, 0, Math.PI * 2, 0, Math.PI / 4.5), new THREE.MeshStandardMaterial({ color: 0xe8e8e4, metalness: 0.2, roughness: 0.45, side: THREE.DoubleSide }));
  dish.position.set(0, 5.0, -2.2); dish.rotation.x = -Math.PI / 2.4; spin.add(dish);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), metal); feed.position.set(0, 5.6, -1.8); feed.rotation.x = -0.5; spin.add(feed);
  // strobes
  const strobes = [];
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const s = strobe(k % 2 ? 0xff3030 : 0xffffff, 0.12); s.position.set(Math.cos(a) * (radius + 2.6), Math.sin(a) * (radius + 2.6), 3.4); spin.add(s); strobes.push(s); }
  const flood = new THREE.PointLight(0xfff0dd, 0, 40, 1.5);
  flood.position.set(0, 0, 9); spin.add(flood);
  group.userData = {
    spin, modules, ports, hub, radius, flood, modMat: hullW, modMat2: hullG, strobes,
    blink(t) { strobes.forEach((s, i) => (s.visible = ((t * 0.9 + i * 0.17) % 1.5) < 0.06)); },
  };
  return group;
}

// ---------------------------------------------------------------------------
// Procedural launcher (fallback if the NASA Saturn V model is unavailable). Up = +Y.
// ---------------------------------------------------------------------------
export function createRocket() {
  const group = new THREE.Group();
  const white = MAT.hull({ seed: 31, base: [232, 231, 227] }, [3, 4]);
  const dark = MAT.darkMetal();
  const noz = MAT.nozzle();
  const stage1 = new THREE.Group();
  const s1 = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 42, 64), white); s1.position.y = 21; s1.castShadow = true; stage1.add(s1);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 3.5), dark); fin.position.set(Math.cos(a) * 5.8, 3.5, Math.sin(a) * 5.8); fin.rotation.y = -a; stage1.add(fin); }
  for (const [x, z] of [[0, 0], [2.8, 0], [-2.8, 0], [0, 2.8], [0, -2.8]]) { const n = new THREE.Mesh(bell(0.7, 1.75, 5.5), noz); n.position.set(x, 0.2, z); stage1.add(n); }
  const plume1 = createPlume({ radius: 6.2, length: 70, color: new THREE.Color(1.0, 0.62, 0.3), sea: true }); plume1.position.y = -5.5; plume1.rotation.x = Math.PI; stage1.add(plume1);
  group.add(stage1);
  const stage2 = new THREE.Group();
  const inter = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 4, 64), dark); inter.position.y = 2;
  const s2 = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 24, 64), white); s2.position.y = 16;
  const s2n = new THREE.Mesh(bell(0.5, 1.4, 3.2), noz); s2n.position.y = 0.6;
  stage2.add(inter, s2, s2n);
  const plume2 = createPlume({ radius: 3.0, length: 50, color: new THREE.Color(0.7, 0.75, 1.0) }); plume2.position.y = -2.6; plume2.rotation.x = Math.PI; stage2.add(plume2);
  stage2.position.y = 42; group.add(stage2);
  const stage3 = new THREE.Group();
  const s3 = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5, 16, 64), white); s3.position.y = 8;
  const fairing = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 4.2, 10, 64), white); fairing.position.y = 21;
  stage3.add(s3, fairing); stage3.position.y = 70; group.add(stage3);
  group.userData = { stage1, stage2, stage3, plume1, plume2, height: 101 };
  return group;
}

// ---------------------------------------------------------------------------
// Cockpit interior rendered in camera space (overlay layer).
// ---------------------------------------------------------------------------
export function createCockpit() {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.75, metalness: 0.3 });
  const panelMat = MAT.hull({ seed: 99, base: [58, 60, 64] }, [0.6, 0.3]);
  const trim = MAT.metal(0x55575a, 0.4);
  const z = -1.2;
  const bar = (w, h, d, x, y, zz, rz = 0, mat = frame) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, zz); m.rotation.z = rz; g.add(m); return m; };
  bar(3.6, 0.32, 0.25, 0, 0.78, z, 0, panelMat);
  bar(0.12, 1.9, 0.18, -0.55, 0.02, z, 0.18, trim);
  bar(0.12, 1.9, 0.18, 0.55, 0.02, z, -0.18, trim);
  bar(0.36, 2.2, 0.3, -1.5, 0.0, z + 0.1, 0.3, panelMat);
  bar(0.36, 2.2, 0.3, 1.5, 0.0, z + 0.1, -0.3, panelMat);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.6, 0.9), panelMat); dash.position.set(0, -0.82, z + 0.2); dash.rotation.x = -0.35; g.add(dash);
  bar(3.6, 0.05, 0.05, 0, -0.52, z - 0.18, 0, trim);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const cx = c.getContext('2d');
  cx.fillStyle = '#010304'; cx.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 4; i++) {
    const x0 = 20 + i * 250; cx.strokeStyle = 'rgba(140,220,255,.6)'; cx.strokeRect(x0, 20, 230, 216);
    cx.fillStyle = 'rgba(140,220,255,.85)'; cx.font = '18px monospace';
    for (let l = 0; l < 8; l++) cx.fillText(['ATT', 'RCS', 'O2', 'PWR', 'NAV', 'COM', 'HDG', 'ALT'][l] + ' ' + (Math.random() * 999).toFixed(1), x0 + 12, 48 + l * 24);
    cx.beginPath(); for (let k = 0; k < 100; k++) cx.lineTo(x0 + 120 + k, 200 - Math.sin(k * 0.2 + i) * 20 - k * 0.3); cx.stroke();
  }
  const stex = new THREE.CanvasTexture(c); stex.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: stex, color: new THREE.Color(0.9, 0.9, 0.9) }));
  scr.position.set(0, -0.7, z - 0.25); scr.rotation.x = -0.35; g.add(scr);
  for (let i = 0; i < 18; i++) {
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(i % 5 ? 0x55ff99 : 0xffaa33).multiplyScalar(3) }));
    led.position.set(-1.1 + i * 0.13, -0.98, z); led.rotation.x = -0.35; g.add(led);
  }
  const light = new THREE.PointLight(0x9fd8ff, 0.6, 3, 2); light.position.set(0, -0.5, z + 0.6); g.add(light);
  g.add(new THREE.AmbientLight(0xffffff, 0.06));
  const sunL = new THREE.DirectionalLight(0xfff4e6, 2.0); g.add(sunL, sunL.target);
  g.userData = { sunL, mfd: { c, cx, tex: stex } };
  return g;
}
