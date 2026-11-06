import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MAT } from './materials.js';

// Real spacecraft from NASA's 3D Resources (public domain, github.com/nasa/NASA-3D-Resources).
// Each entry: file, real-world size of the longest dimension (m), anchor (center | base).
const LIST = {
  saturnV:   { file: 'saturn_v.glb',        size: 110.6, anchor: 'base', upgrade: 'paint' },
  iss:       { file: 'iss.glb',             size: 109,   anchor: 'center', upgrade: 'iss' },
  cassini:   { file: 'cassini.glb',         size: 11,    anchor: 'center', upgrade: 'probe' },
  juno:      { file: 'juno.glb',            size: 20.1,  anchor: 'center', upgrade: 'probe' },
  hubble:    { file: 'hubble.glb',          size: 13.2,  anchor: 'center', upgrade: 'probe' },
  astronaut: { file: 'astronaut.glb',       size: 1.85,  anchor: 'base', upgrade: 'suit' },
  launcher:  { file: 'mobile_launcher.glb', size: 116,   anchor: 'base', upgrade: 'paint' },
};
export const MODELS = {};

/** Planar UVs from the dominant normal axis, for meshes exported without UVs. */
function ensureUV(geo, scale = 0.5) {
  if (geo.attributes.uv) return;
  const p = geo.attributes.position; if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function upgradeMaterials(root, kind) {
  const cache = new Map();
  const box = new THREE.Box3(), size = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const name = `${o.name} ${o.material?.name || ''}`.toLowerCase();
    const old = o.material;
    if (kind === 'iss') {
      // NASA's ISS mesh ships without textures: classify parts by shape
      box.setFromBufferAttribute(o.geometry.attributes.position); box.getSize(size);
      const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
      const flat = dims[0] < dims[2] * 0.03 && dims[1] > dims[2] * 0.15;
      ensureUV(o.geometry, flat ? 0.12 : 0.4);
      const key = flat ? 'solar' : name.includes('tru') ? 'truss' : 'hull';
      if (!cache.has(key)) cache.set(key, key === 'solar' ? MAT.solar([1, 1]) : key === 'truss' ? MAT.metal(0x9a9b9d, 0.45) : MAT.hull({ seed: 61, base: [214, 214, 210] }, [1, 1]));
      o.material = cache.get(key);
      if (flat) o.material.side = THREE.DoubleSide;
      return;
    }
    const mats = Array.isArray(old) ? old : [old];
    const out = mats.map((m) => {
      if (!m) return m;
      const n = (m.name || name).toLowerCase();
      if (/gold|foil_g|kapton/.test(n)) { ensureUV(o.geometry, 1.5); return cache.get('gold') || cache.set('gold', MAT.foil('gold', [1, 1])).get('gold'); }
      if (/silver|foil_s/.test(n)) { ensureUV(o.geometry, 1.5); return cache.get('silver') || cache.set('silver', MAT.foil('silver', [1, 1])).get('silver'); }
      if (/krinkle|black/.test(n)) { ensureUV(o.geometry, 1.5); return cache.get('black') || cache.set('black', MAT.foil('black', [1, 1])).get('black'); }
      // keep NASA's textures, but make the shading physically based
      const s = m.isMeshStandardMaterial ? m : new THREE.MeshStandardMaterial({ map: m.map || null, color: m.color || new THREE.Color(0xcccccc) });
      if (/alum|metal|chrome|shiny/.test(n)) { s.metalness = 0.95; s.roughness = 0.3; }
      else if (/solar|panel/.test(n)) { s.metalness = 0.5; s.roughness = 0.25; }
      else { s.metalness = Math.min(s.metalness ?? 0.1, 0.25); s.roughness = Math.max(s.roughness ?? 0.6, kind === 'paint' ? 0.45 : 0.5); }
      s.envMapIntensity = 1.0;
      if (s.map) s.map.anisotropy = 16;
      return s;
    });
    o.material = Array.isArray(old) ? out : out[0];
  });
}

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader(); draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`); draco.preload(); // NASA models are Draco-compressed
  loader.setDRACOLoader(draco);
  const keys = Object.keys(LIST);
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    const def = LIST[k];
    try {
      const g = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${def.file}`);
      const root = g.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const s = def.size / Math.max(size.x, size.y, size.z);
      const wrap = new THREE.Group();
      root.position.sub(def.anchor === 'base' ? new THREE.Vector3(c.x, box.min.y, c.z) : c);
      const holder = new THREE.Group(); holder.add(root); holder.scale.setScalar(s);
      wrap.add(holder);
      upgradeMaterials(root, def.upgrade);
      wrap.userData.height = size.y * s;
      MODELS[k] = wrap;
    } catch (e) { console.warn('[models] failed', k, e.message); }
    onProgress?.(++done / keys.length, k);
  }));
}

/** Independent instance (geometry/materials shared). */
export function model(key) { return MODELS[key] ? MODELS[key].clone(true) : null; }

/**
 * Split the Saturn V into its three stages + payload by height, so staging can be animated.
 * Returns groups positioned in the rocket's own frame (base at y = 0, height ≈ 110.6 m).
 */
export function saturnVStages() {
  const src = model('saturnV');
  if (!src) return null;
  src.updateMatrixWorld(true);
  const H = 110.6;
  const cuts = [0, 42.1 / H, 67.0 / H, 85.0 / H, 1.01]; // S-IC | S-II | S-IVB+IU | CSM/LES
  const stages = cuts.slice(0, -1).map(() => new THREE.Group());
  const meshes = [];
  src.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const box = new THREE.Box3(), cc = new THREE.Vector3();
  for (const m of meshes) {
    box.setFromObject(m); box.getCenter(cc);
    const f = cc.y / H;
    let k = 0; while (k < stages.length - 1 && f > cuts[k + 1]) k++;
    const mesh = m.clone(); mesh.matrix.copy(m.matrixWorld); mesh.matrixAutoUpdate = false; mesh.matrixWorldNeedsUpdate = true;
    stages[k].add(mesh);
  }
  return { stages, height: H };
}

/**
 * The NASA Saturn V as a staged launcher with the same interface as the procedural rocket:
 * { stage1, stage2, stage3, plume1, plume2, payloadY, hideTop() }.
 */
export function buildLauncher(createPlume) {
  const sv = saturnVStages();
  if (!sv) return null;
  const cuts = [0, 42.1, 67.0, 85.0];
  const group = new THREE.Group();
  const wraps = sv.stages.map((st, i) => { const w = new THREE.Group(); w.position.y = cuts[i]; st.position.y = -cuts[i]; w.add(st); group.add(w); return w; });
  const [stage1, stage2, stage3, top] = wraps;
  stage3.add(top); top.position.y = cuts[3] - cuts[2]; // payload rides with the third stage
  const plume1 = createPlume({ radius: 6.4, length: 75, color: new THREE.Color(1.0, 0.62, 0.3), sea: true });
  plume1.position.y = -0.4; plume1.rotation.x = Math.PI; stage1.add(plume1);
  const plume2 = createPlume({ radius: 3.4, length: 55, color: new THREE.Color(0.7, 0.75, 1.0) });
  plume2.position.y = -1.2; plume2.rotation.x = Math.PI; stage2.add(plume2);
  group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  group.userData = { stage1, stage2, stage3, plume1, plume2, height: sv.height, payloadY: 85.0, hideTop: () => (top.visible = false), real: true };
  return group;
}
