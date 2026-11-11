import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createPlume } from './fx.js';
import { MAT } from './materials.js';
import { createRanger } from './ships.js';
import { NOISE } from '../gl/noise.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// shared parts. Every craft: forward = +Z, up = +Y, metres.
// ---------------------------------------------------------------------------
function bell(r0, r1, len, segs = 36) {
  const pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(r0 + (r1 - r0) * Math.pow(t, 0.55), -t * len)); }
  return new THREE.LatheGeometry(pts, segs);
}
const shadow = (g) => { g.traverse((o) => { if (o.isMesh && !o.material.transparent) o.castShadow = o.receiveShadow = true; }); return g; };
function strobe(color, size = 0.08) { return new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(8) })); }

/** Aft-facing engine at (x, y, z = nozzle throat). Returns the plume record used by setThrust. */
function addEngine(group, plumes, x, y, z, r, { plume = 10, color = new THREE.Color(0.55, 0.7, 1.0), noz } = {}) {
  const L = r * 2.2;
  const b = new THREE.Mesh(bell(r * 0.42, r, L), noz); b.rotation.x = Math.PI / 2; b.position.set(x, y, z); group.add(b);
  const gimbal = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.62, r * 0.7, 20), MAT.darkMetal()); gimbal.rotation.x = Math.PI / 2; gimbal.position.set(x, y, z + r * 0.3); group.add(gimbal);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  disc.position.set(x, y, z - L * 0.25); disc.rotation.y = Math.PI; group.add(disc);
  const pl = createPlume({ radius: r * 0.95, length: plume, color });
  pl.position.set(x, y, z - L); pl.rotation.x = -Math.PI / 2; group.add(pl);
  plumes.push({ plume: pl, disc });
}
function rcsQuad(mat, nozMat, s = 1) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.34 * s, 0.34 * s), mat));
  for (const d of [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, 0, 1)]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.07 * s, 0.14 * s, 10, 1, true), nozMat);
    c.position.copy(d).multiplyScalar(0.22 * s); c.quaternion.setFromUnitVectors(V(0, 1, 0), d); g.add(c);
  }
  return g;
}
function dockCollar(r = 1.15) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 1.05, 0.9, 40), MAT.metal(0x9c9d9f, 0.35));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 10, 40), MAT.metal(0xb5b6b8, 0.25)); lip.rotation.x = Math.PI / 2; lip.position.y = 0.45;
  g.add(ring, lip);
  for (let k = 0; k < 3; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.08), MAT.darkMetal()); const a = (k / 3) * Math.PI * 2; p.position.set(Math.cos(a) * r * 0.82, 0.58, Math.sin(a) * r * 0.82); p.rotation.y = -a; g.add(p); }
  return g;
}
function finish(group, { plumes, navs, cockpit, lampAt, lampAim, rcs }) {
  const spot = new THREE.SpotLight(0xfff1dd, 0, 140, 0.5, 0.6, 1.2);
  spot.position.copy(lampAt); spot.target.position.copy(lampAim); group.add(spot, spot.target);
  shadow(group);
  group.userData = {
    plumes, navs, spot, cockpit, rcs,
    setThrust(v, t = 0) { plumes.forEach(({ plume, disc }) => { plume.userData.set(v, t); disc.material.color.setRGB(1.0, 0.55, 0.25).multiplyScalar(0.01 + v * 8); }); },
    blink(t) { navs.forEach((m, i) => { m.visible = i < 2 ? (Math.floor(t * 1.1 + i * 0.5) % 2) === 0 : (t % 1.3) < 0.07; }); },
  };
  return group;
}
function navLights(group, port, starboard, tail) {
  const navs = [];
  [[starboard, 0xff2a2a], [port, 0x2aff6a], [tail, 0xffffff]].forEach(([p, c]) => { const m = strobe(c); m.position.copy(p); group.add(m); navs.push(m); });
  return navs;
}

// ---------------------------------------------------------------------------
// LANDER — heavy twin-nacelle hauler, ~17 m long, 14 m across.
// ---------------------------------------------------------------------------
export function createLander() {
  const g = new THREE.Group(), plumes = [];
  const white = MAT.hull({ seed: 71, base: [214, 214, 208] }, [1.4, 1.4]);
  const grey = MAT.hull({ seed: 83, base: [150, 152, 154] }, [1, 2]);
  const tiles = MAT.tiles([2, 2]), noz = MAT.nozzle(), dark = MAT.darkMetal(), metal = MAT.metal();
  const gold = MAT.foil('gold', [1, 1]), black = MAT.foil('black', [1, 1]);
  const body = new THREE.Mesh(new RoundedBoxGeometry(8.6, 3.6, 13, 5, 1.1), white); g.add(body);
  const belly = new THREE.Mesh(new RoundedBoxGeometry(8.2, 0.7, 12.4, 3, 0.3), tiles); belly.position.y = -1.7; g.add(belly);
  // sloped flight deck with a wraparound windscreen
  const deck = new THREE.Mesh(new RoundedBoxGeometry(6.2, 2.6, 3.6, 4, 0.9), white); deck.position.set(0, 0.1, 7.3); g.add(deck);
  const glass = MAT.glass();
  const ws = new THREE.Mesh(new THREE.BoxGeometry(4.9, 1.0, 0.12), glass); ws.position.set(0, 0.75, 8.92); ws.rotation.x = -0.38; g.add(ws);
  for (const sx of [-1, 1]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 1.7), glass); sw.position.set(sx * 3.06, 0.72, 7.7); sw.rotation.z = sx * 0.12; g.add(sw); }
  for (const x of [-1.25, 0, 1.25]) { const fr = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.16), dark); fr.position.set(x, 0.75, 8.94); fr.rotation.x = -0.38; g.add(fr); }
  // engine nacelles on pylons
  for (const sx of [-1, 1]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 9.5, 40), grey); nac.rotation.x = Math.PI / 2; nac.position.set(sx * 5.9, -0.2, -1.2); g.add(nac);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.45, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), grey); cap.rotation.x = Math.PI / 2; cap.position.set(sx * 5.9, -0.2, 3.55); g.add(cap);
    for (const z of [-3.6, -1.2, 1.2]) { const band = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.06, 8, 40), metal); band.position.set(sx * 5.9, -0.2, z); g.add(band); }
    const pylon = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.7, 5.2, 2, 0.2), white); pylon.position.set(sx * 4.4, -0.2, -1.2); g.add(pylon);
    const radp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 5.5), MAT.radiator([1, 1])); radp.position.set(sx * 7.5, 0.3, -1.4); radp.rotation.z = sx * -0.5; g.add(radp);
    addEngine(g, plumes, sx * 5.9, -0.2, -5.95, 1.15, { plume: 14, noz });
    addEngine(g, plumes, sx * 1.9, -0.2, -6.5, 0.85, { plume: 11, noz });
    // folded landing gear
    for (const z of [-4.2, 4.6]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 2.6, 10), metal); leg.position.set(sx * 3.9, -2.5, z); leg.rotation.z = sx * 0.45; g.add(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.16, 20), dark); pad.position.set(sx * 4.5, -3.72, z); g.add(pad);
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 8), metal); brace.position.set(sx * 3.6, -2.7, z + 0.6); brace.rotation.set(0.5, 0, sx * 0.2); g.add(brace);
    }
    const q1 = rcsQuad(grey, noz, 1.3); q1.position.set(sx * 4.45, 1.2, 5.6); g.add(q1);
    const q2 = rcsQuad(grey, noz, 1.3); q2.position.set(sx * 4.45, 1.2, -5.8); g.add(q2);
  }
  // cargo deck: foil-wrapped tanks, hatch, antenna
  for (const [x, z, s] of [[-2.2, 1.5, 1.1], [2.2, 1.5, 1.1], [-2.2, -4.6, 0.9], [2.2, -4.6, 0.9]]) { const t = new THREE.Mesh(new THREE.SphereGeometry(s, 24, 16), x < 0 ? gold : MAT.foil('silver', [1, 1])); t.position.set(x, 1.75, z); t.scale.y = 0.7; g.add(t); }
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 24), dark); hatch.position.set(0, 1.86, 3.4); g.add(hatch);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), metal); ant.position.set(2.6, 2.5, 5.2); g.add(ant);
  const col = dockCollar(1.15); col.position.set(0, 2.2, -1.6); g.add(col);
  const navs = navLights(g, V(-7.4, -0.2, -1.2), V(7.4, -0.2, -1.2), V(0, 1.9, -6.4));
  return finish(g, { plumes, navs, cockpit: V(0, 0.6, 8.0), lampAt: V(0, -1.2, 8.8), lampAim: V(0, -1.2, 40),
    rcs: [V(4.45, 1.2, 5.6), V(-4.45, 1.2, 5.6), V(4.45, 1.2, -5.8), V(-4.45, 1.2, -5.8)] });
}

// ---------------------------------------------------------------------------
// KESTREL — fast two-seat scout, ~12 m long, delta wing.
// ---------------------------------------------------------------------------
export function createScout() {
  const g = new THREE.Group(), plumes = [];
  const hull = MAT.hull({ seed: 17, base: [208, 211, 216] }, [1, 2]);
  const darkHull = MAT.hull({ seed: 29, base: [104, 110, 122] }, [1, 1]);
  const noz = MAT.nozzle(), dark = MAT.darkMetal(), metal = MAT.metal();
  const prof = [[0.02, 6], [0.35, 5.3], [0.8, 4.0], [1.15, 2.2], [1.3, 0], [1.25, -2.4], [1.05, -4.4], [0.9, -5.2]].map(([r, y]) => new THREE.Vector2(r, y));
  const fg = new THREE.LatheGeometry(new THREE.SplineCurve(prof).getPoints(40).reverse(), 48); fg.rotateX(Math.PI / 2);
  const fus = new THREE.Mesh(fg, hull); fus.scale.set(1.45, 0.72, 1); g.add(fus);
  const tail = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), dark); tail.rotation.y = Math.PI; tail.position.z = -5.2; tail.scale.set(1.45, 0.72, 1); g.add(tail);
  // delta wings
  const wingShape = new THREE.Shape(); wingShape.moveTo(1.2, 2.0); wingShape.lineTo(5.0, -4.2); wingShape.lineTo(5.0, -5.3); wingShape.lineTo(1.2, -5.0); wingShape.closePath();
  const wg = new THREE.ExtrudeGeometry(wingShape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 }); wg.rotateX(Math.PI / 2); // shape (x, y) -> (x, z)
  const wmat = darkHull.clone(); wmat.side = THREE.DoubleSide;
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(wg, wmat); w.scale.x = sx; w.position.y = -0.1; w.rotation.z = sx * 0.06; g.add(w);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 2.0), wmat); fin.position.set(sx * 4.95, 0.75, -4.5); fin.rotation.set(-0.3, 0, sx * -0.18); g.add(fin);
    const le = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 7.3, 8), metal); le.position.set(sx * 3.1, -0.08, -1.1); le.rotation.set(Math.PI / 2, 0, sx * 0.55); g.add(le);
    addEngine(g, plumes, sx * 2.1, -0.05, -5.05, 0.42, { plume: 7, noz });
    const q = rcsQuad(hull, noz, 0.9); q.position.set(sx * 1.55, 0.35, 3.2); g.add(q);
    const q2 = rcsQuad(hull, noz, 0.9); q2.position.set(sx * 4.9, 0.1, -3.6); g.add(q2);
  }
  addEngine(g, plumes, 0, 0, -5.25, 0.8, { plume: 13, color: new THREE.Color(0.5, 0.75, 1.0), noz });
  const can = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), MAT.glass()); can.scale.set(0.78, 0.55, 1.9); can.position.set(0, 0.62, 2.3); g.add(can);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.04, 6, 32, Math.PI), dark); frame.position.set(0, 0.62, 2.3); g.add(frame);
  const col = dockCollar(0.85); col.position.set(0, 1.0, -1.6); g.add(col);
  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 1.4, 6), metal); pitot.rotation.x = Math.PI / 2; pitot.position.z = 6.6; g.add(pitot);
  const navs = navLights(g, V(-5.0, 0, -4.8), V(5.0, 0, -4.8), V(0, 0.8, -5.0));
  return finish(g, { plumes, navs, cockpit: V(0, 0.55, 2.6), lampAt: V(0, -0.5, 5.2), lampAim: V(0, -0.5, 40),
    rcs: [V(1.55, 0.35, 3.2), V(-1.55, 0.35, 3.2), V(4.9, 0.1, -3.6), V(-4.9, 0.1, -3.6)] });
}

// ---------------------------------------------------------------------------
// PILGRIM — crew capsule + service module with four solar wings. Docks nose-first (+Z).
// ---------------------------------------------------------------------------
export function createCapsule() {
  const g = new THREE.Group(), plumes = [];
  const white = MAT.hull({ seed: 51, base: [224, 224, 220] }, [2, 1]);
  const noz = MAT.nozzle(), dark = MAT.darkMetal(), metal = MAT.metal(), solar = MAT.solar([2, 1]);
  const cone = [[2.5, 0], [2.52, 0.25], [2.1, 1.3], [1.45, 2.6], [1.05, 3.3]].map(([r, y]) => new THREE.Vector2(r, y));
  const cg = new THREE.LatheGeometry(cone, 56); cg.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(cg, white));
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(2.52, 2.45, 0.3, 56), MAT.tiles([3, 1])); shield.rotation.x = Math.PI / 2; shield.position.z = -0.12; g.add(shield);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.08), MAT.glass()); const r = 1.86; w.position.set(Math.cos(a) * r, Math.sin(a) * r, 1.8); w.lookAt(Math.cos(a) * 9, Math.sin(a) * 9, 5.8); g.add(w); }
  const sm = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 2.42, 4, 56), MAT.foil('silver', [4, 1])); sm.rotation.x = Math.PI / 2; sm.position.z = -2.3; g.add(sm);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.46, 2.46, 0.9, 56, 1, true), MAT.foil('gold', [4, 1])); band.rotation.x = Math.PI / 2; band.position.z = -3.7; g.add(band);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const rp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 2.6), MAT.radiator([1, 1])); rp.position.set(Math.cos(a) * 2.47, Math.sin(a) * 2.47, -1.9); rp.rotation.z = a + Math.PI / 2; g.add(rp); }
  const aft = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 1.2, 0.7, 40), dark); aft.rotation.x = Math.PI / 2; aft.position.z = -4.65; g.add(aft);
  addEngine(g, plumes, 0, 0, -4.9, 0.95, { plume: 10, color: new THREE.Color(0.75, 0.8, 1.0), noz });
  // X-wing solar arrays
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    const arm = new THREE.Group(); arm.rotation.z = a; arm.position.z = -3.5;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), metal); strut.rotation.z = Math.PI / 2; strut.position.x = 3.1; arm.add(strut);
    for (let p = 0; p < 3; p++) { const pan = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.05, 1.9), solar); pan.position.x = 5.0 + p * 2.32; arm.add(pan); }
    g.add(arm);
    const q = rcsQuad(white, noz, 1.1); q.position.set(c * 2.6, s * 2.6, -0.9); q.rotation.z = a - Math.PI / 2; g.add(q);
  }
  // nose docking adapter
  const col = dockCollar(1.0); col.rotation.x = Math.PI / 2; col.position.z = 3.55; g.add(col);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 10, 0, Math.PI * 2, 0, Math.PI / 4), new THREE.MeshStandardMaterial({ color: 0xe8e8e4, metalness: 0.2, roughness: 0.45, side: THREE.DoubleSide }));
  dish.position.set(0, -3.1, -3.0); dish.rotation.x = Math.PI; g.add(dish);
  const navs = navLights(g, V(-2.5, 0, -0.3), V(2.5, 0, -0.3), V(0, 2.5, -4.2));
  const k = Math.SQRT1_2 * 2.6;
  return finish(g, { plumes, navs, cockpit: V(0, 0.5, 2.2), lampAt: V(0, 1.3, 3.2), lampAim: V(0, 1.3, 40),
    rcs: [V(k, k, -0.9), V(-k, k, -0.9), V(k, -k, -0.9), V(-k, -k, -0.9)] });
}

function rangerShip() {
  const g = createRanger();
  g.userData.spot.distance = 140;
  g.userData.rcs = [V(3.6, 0.5, 5.2), V(-3.6, 0.5, 5.2), V(4.2, 0.6, -5.8), V(-4.2, 0.6, -5.8)];
  return g;
}

/**
 * The fleet. Multipliers are relative to the location's baseline (Ranger) accelerations.
 * dv: propellant as a Δv budget (m/s) · hull: structural points · heat: re-entry tolerance
 * collar/dockAxis: docking interface in the ship frame · size: camera distance scale
 */
export const SHIPS = [
  { id: 'ranger', name: 'RANGER', cls: 'Lifting-body shuttle', rank: 0, build: rangerShip,
    desc: 'The all-rounder. Balanced engines, a tiled belly and a dorsal docking collar.',
    accel: 1, boost: 1, rcs: 1, rate: 1, dv: 12000, hull: 100, heat: 1.5, size: 1, radius: 5,
    collar: V(0, 2.86, -3.08), dockAxis: V(0, 1, 0), gear: 1.4 },
  { id: 'capsule', name: 'PILGRIM', cls: 'Crew capsule + service module', rank: 1, build: createCapsule,
    desc: 'Modest main engine, superb RCS authority and an ablative heat shield. Docks nose-first.',
    accel: 0.5, boost: 0.6, rcs: 1.6, rate: 0.85, dv: 6500, hull: 120, heat: 5, size: 0.95, radius: 4,
    collar: V(0, 0, 4.1), dockAxis: V(0, 0, 1), gear: 2.6 },
  { id: 'lander', name: 'LANDER', cls: 'Heavy twin-nacelle hauler', rank: 2, build: createLander,
    desc: 'Four engines and huge tanks. Slow to turn, hard to break, and it has real landing gear.',
    accel: 0.8, boost: 1.25, rcs: 0.7, rate: 0.6, dv: 20000, hull: 200, heat: 2, size: 1.35, radius: 8,
    collar: V(0, 2.8, -1.6), dockAxis: V(0, 1, 0), gear: 3.8 },
  { id: 'scout', name: 'KESTREL', cls: 'Two-seat scout', rank: 3, build: createScout,
    desc: 'Overpowered and fragile. The fastest way anywhere — and the fastest way to a crater.',
    accel: 1.7, boost: 1.4, rcs: 1.3, rate: 1.5, dv: 9500, hull: 60, heat: 0.8, size: 0.85, radius: 5,
    collar: V(0, 1.6, -1.6), dockAxis: V(0, 1, 0), gear: 1.4 },
];
export const shipDef = (id) => SHIPS.find((s) => s.id === id) || SHIPS[0];

// ---------------------------------------------------------------------------
// GATEWAY — small modular lunar station. Docking port faces +Z.
// ---------------------------------------------------------------------------
export function createStation() {
  const g = new THREE.Group();
  const hullW = MAT.hull({ seed: 13, windows: true, base: [220, 220, 216] }, [2, 1]);
  const hullG = MAT.hull({ seed: 37, base: [188, 190, 190] }, [2, 1]);
  const metal = MAT.metal(), dark = MAT.darkMetal(), gold = MAT.foil('gold', [2, 2]), solar = MAT.solar([4, 1]);
  const cyl = (r, len, mat, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 48), mat); m.rotation.x = Math.PI / 2; m.position.z = z; g.add(m); return m; };
  cyl(2.3, 8.5, hullW, 1.5);                 // habitat
  cyl(1.7, 2.0, hullG, 6.6);                 // docking node
  cyl(2.0, 6.0, hullG, -6.0);                // power & propulsion element
  cyl(1.2, 1.6, dark, -1.9); cyl(1.2, 0.6, dark, 5.7);
  for (const z of [-0.8, 1.5, 3.8]) { const b = new THREE.Mesh(new THREE.TorusGeometry(2.33, 0.07, 8, 48), metal); b.position.z = z; g.add(b); }
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.04, 2.04, 1.6, 48, 1, true), gold); band.rotation.x = Math.PI / 2; band.position.z = -6.4; g.add(band);
  // side airlock node
  const side = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.6, 32), hullG); side.position.set(0, 2.6, 6.6); g.add(side);
  // solar wings and radiators
  for (const sx of [-1, 1]) {
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 8), metal); boom.rotation.z = Math.PI / 2; boom.position.set(sx * 4, 0, -6.6); g.add(boom);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(15, 0.06, 4.6), solar); wing.position.set(sx * 13.4, 0, -6.6); wing.rotation.x = 0.5; g.add(wing);
    const radp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 5.5, 2.4), MAT.radiator([1, 2])); radp.position.set(sx * 2.2, sx * 3.6, -3.4); g.add(radp);
  }
  const noz = MAT.nozzle();
  for (const [x, y] of [[0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]) { const n = new THREE.Mesh(bell(0.16, 0.42, 0.9), noz); n.rotation.x = Math.PI / 2; n.position.set(x, y, -9.0); g.add(n); }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 4.5), new THREE.MeshStandardMaterial({ color: 0xe8e8e4, metalness: 0.2, roughness: 0.45, side: THREE.DoubleSide }));
  dish.position.set(0, -3.6, -1.9); dish.rotation.x = Math.PI * 0.9; g.add(dish);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), metal); mast.position.set(0, -2.6, -1.9); g.add(mast);
  // docking port (+Z) with guide lamp
  const adapter = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 1.2, 48), MAT.metal(0xa5a6a8, 0.35)); adapter.rotation.x = Math.PI / 2; adapter.position.z = 8.2; g.add(adapter);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.11, 12, 48), MAT.metal(0xbfc0c2, 0.25)); lip.position.z = 8.8; g.add(lip);
  const lamp = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.045, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.0, 0.6).multiplyScalar(1.2) })); lamp.position.z = 8.7; g.add(lamp);
  const strobes = [];
  for (const [x, y, z, c] of [[20.8, 0, -6.6, 0xff3030], [-20.8, 0, -6.6, 0x30ff60], [0, 4.0, 6.6, 0xffffff], [0, -4.4, -1.9, 0xffffff]]) { const s = strobe(c, 0.12); s.position.set(x, y, z); g.add(s); strobes.push(s); }
  const flood = new THREE.PointLight(0xfff0dd, 10, 40, 1.5); flood.position.set(0, 0, 11); g.add(flood);
  shadow(g);
  g.userData = { port: V(0, 0, 8.85), axis: V(0, 0, 1), blink(t) { strobes.forEach((s, i) => (s.visible = ((t * 0.9 + i * 0.21) % 1.5) < 0.06)); } };
  return g;
}

// ---------------------------------------------------------------------------
// PHOBOS — 27 × 22 × 18 km rubble pile with Stickney crater. Geometry is in metres.
// ---------------------------------------------------------------------------
const PH = V(13500, 9000, 11000); // semi-axes (m): long axis points at Mars
const ST = V(0.82, 0.2, 0.53).normalize(); // Stickney
const C2 = V(-0.5, 0.6, -0.62).normalize();
function phobosShape(v) {
  const lumps = 1 + 0.07 * Math.sin(v.x * 3.1 + 1.3) * Math.cos(v.z * 2.7 + 0.4) + 0.045 * Math.sin(v.y * 5.2 + v.x * 2.1) + 0.022 * Math.sin(v.x * 9.0 + v.z * 7.0 + 2.0) * Math.cos(v.y * 8.0) + 0.012 * Math.sin(v.x * 14 + v.y * 13 + v.z * 12);
  const d1 = 1 - v.dot(ST), d2 = 1 - v.dot(C2);
  // craters: bowl with a raised rim
  const crater = (d, w, depth) => -depth * Math.exp(-d / w) + depth * 0.35 * Math.exp(-((d - w * 2.2) ** 2) / (w * w * 0.6));
  return lumps + crater(d1, 0.035, 0.16) + crater(d2, 0.012, 0.07);
}
const _pv = V();
/** Surface radius (m) along a direction given in Phobos' own frame. */
export function phobosRadius(dirLocal) {
  _pv.set(dirLocal.x / PH.x, dirLocal.y / PH.y, dirLocal.z / PH.z).normalize();
  const f = phobosShape(_pv);
  return f * Math.hypot(_pv.x * PH.x, _pv.y * PH.y, _pv.z * PH.z);
}
export function createPhobos() {
  let geo = new THREE.IcosahedronGeometry(1, 96);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = mergeVertices(geo);
  const p = geo.attributes.position, v = V();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); const f = phobosShape(v); p.setXYZ(i, v.x * PH.x * f, v.y * PH.y * f, v.z * PH.z * f); }
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8179, roughness: 0.96, metalness: 0.0, envMapIntensity: 0.15 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vObjP;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float nearK = clamp(1.0 - length(vViewPosition) / 2500.0, 0.0, 1.0);
        float big = fbm3(vObjP / 5200.0) * 0.5 + 0.5; float mid = fbm3(vObjP / 1500.0 + 9.0) * 0.5 + 0.5; float fine = mix(0.5, fbm3(vObjP / 14.0) * 0.5 + 0.5, nearK);
        // long grooves radiating from Stickney, as on the real moon
        float groove = smoothstep(0.82, 1.0, abs(sin(vObjP.y / 420.0 + snoise(vObjP / 5200.0) * 2.0)));
        diffuseColor.rgb *= mix(0.55, 1.1, big) * mix(0.8, 1.08, mid) * mix(0.86, 1.06, fine) * (1.0 - groove * 0.22);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.84, 0.96), smoothstep(0.55, 0.8, mid) * 0.5);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 gp = vObjP / 1800.0; float e = 0.05; float h0 = fbm3(gp);
          vec3 gd = vec3(fbm3(gp + vec3(e,0,0)) - h0, fbm3(gp + vec3(0,e,0)) - h0, fbm3(gp + vec3(0,0,e)) - h0) / e;
          vec3 gq = vObjP / 9.0; float h1 = snoise(gq);
          vec3 gf = vec3(snoise(gq + vec3(e,0,0)) - h1, snoise(gq + vec3(0,e,0)) - h1, snoise(gq + vec3(0,0,e)) - h1) / e;
          float nk = clamp(1.0 - length(vViewPosition) / 1500.0, 0.0, 1.0);
          normal = normalize(normal - (mat3(viewMatrix) * (gd * 0.3 + gf * 0.07 * nk))); }`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}
