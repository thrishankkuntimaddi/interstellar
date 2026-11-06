import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural PBR texture sets: albedo + height-derived normal map + roughness.
// Everything is painted once into canvases at load time (no external assets).
// ---------------------------------------------------------------------------

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function canvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')]; }

/** Sobel height -> tangent-space normal map. */
export function heightToNormal(hc, strength = 2.0) {
  const n = hc.width, g = hc.getContext('2d');
  const src = g.getImageData(0, 0, n, n).data;
  const [oc, og] = canvas(n);
  const out = og.createImageData(n, n);
  const H = (x, y) => src[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * n + x) * 4;
    out.data[i] = (nx * 0.5 + 0.5) * 255; out.data[i + 1] = (ny * 0.5 + 0.5) * 255; out.data[i + 2] = (nz * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  og.putImageData(out, 0, 0);
  return oc;
}

function tex(c, srgb, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = 16; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function grime(g, n, r, amt, dark = '35,32,28') {
  for (let i = 0; i < 1800; i++) {
    const x = r() * n, y = r() * n, s = 3 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    grd.addColorStop(0, `rgba(${dark},${r() * amt})`); grd.addColorStop(1, `rgba(${dark},0)`);
    g.fillStyle = grd; g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  // streaks
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${dark},${r() * amt * 0.6})`; g.fillRect(r() * n, r() * n, 1 + r() * 2, 20 + r() * 120); }
}

const CACHE = new Map();
const cached = (key, fn) => { if (!CACHE.has(key)) CACHE.set(key, fn()); return CACHE.get(key); };

/** Spacecraft hull panels: painted aluminium / white thermal paint, seams, rivets, access hatches. */
export function hullPanels({ seed = 1, base = [218, 218, 214], n = 1024, windows = false, scale = 1 } = {}) {
  return cached(`hull${seed}${base}${windows}${n}`, () => {
    const r = rng(seed);
    const [ac, ag] = canvas(n), [hc, hg] = canvas(n), [rc, rg] = canvas(n), [ec, eg] = canvas(n);
    ag.fillStyle = `rgb(${base})`; ag.fillRect(0, 0, n, n);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, n, n);
    rg.fillStyle = '#8c8c8c'; rg.fillRect(0, 0, n, n);
    eg.fillStyle = '#000'; eg.fillRect(0, 0, n, n);
    // recursive panel subdivision for a believable, non-grid layout
    const panels = [];
    const split = (x, y, w, h, d) => {
      if (d > 4 || (d > 1 && r() < 0.25) || w < 40 || h < 40) { panels.push([x, y, w, h]); return; }
      if (w > h ? r() < 0.8 : r() < 0.2) { const k = w * (0.3 + r() * 0.4); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
      else { const k = h * (0.3 + r() * 0.4); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
    };
    split(0, 0, n, n, 0);
    for (const [x, y, w, h] of panels) {
      const t = (r() - 0.5) * 16;
      ag.fillStyle = `rgb(${base[0] + t},${base[1] + t},${base[2] + t - 1})`; ag.fillRect(x + 2, y + 2, w - 4, h - 4);
      const rough = 120 + r() * 70; rg.fillStyle = `rgb(${rough},${rough},${rough})`; rg.fillRect(x + 2, y + 2, w - 4, h - 4);
      const raised = r() < 0.35;
      hg.fillStyle = raised ? '#8e8e8e' : '#828282'; hg.fillRect(x + 3, y + 3, w - 6, h - 6);
      // seams (grooves)
      hg.strokeStyle = '#3a3a3a'; hg.lineWidth = 3; hg.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      ag.strokeStyle = 'rgba(40,40,40,0.55)'; ag.lineWidth = 1.5; ag.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      // rivet rows
      const step = 10 + (r() * 6 | 0);
      hg.fillStyle = '#b0b0b0'; ag.fillStyle = 'rgba(90,90,90,0.5)';
      for (let k = x + 8; k < x + w - 6; k += step) { hg.fillRect(k, y + 6, 2, 2); hg.fillRect(k, y + h - 8, 2, 2); ag.fillRect(k, y + 6, 1.5, 1.5); ag.fillRect(k, y + h - 8, 1.5, 1.5); }
      // occasional hatch / handhold / label
      if (w > 120 && h > 80 && r() < 0.25) {
        const hx = x + w * 0.25, hy = y + h * 0.3, hw = w * 0.4, hh = h * 0.35;
        hg.strokeStyle = '#2a2a2a'; hg.lineWidth = 2; hg.strokeRect(hx, hy, hw, hh);
        ag.strokeStyle = 'rgba(30,30,30,0.6)'; ag.strokeRect(hx, hy, hw, hh);
        hg.fillStyle = '#c8c8c8'; hg.fillRect(hx + hw * 0.4, hy + hh * 0.45, hw * 0.2, 4);
      }
      if (r() < 0.06) { ag.fillStyle = 'rgba(200,110,30,0.85)'; ag.fillRect(x + 8, y + 8, Math.min(60, w * 0.4), 6); }
      if (r() < 0.05) { ag.fillStyle = 'rgba(25,25,25,0.9)'; ag.font = `${12 + r() * 8}px monospace`; ag.fillText(['NASA', 'NO STEP', 'RCS', 'O2', 'GSE', 'EVA'][(r() * 6) | 0], x + 10, y + h - 14); }
      if (windows && w > 100 && r() < 0.35) {
        for (let k = 0; k < 3; k++) {
          const wx = x + 14 + k * 26, wy = y + h * 0.55;
          ag.fillStyle = '#06080a'; ag.fillRect(wx, wy, 16, 12); rg.fillStyle = '#0c0c0c'; rg.fillRect(wx, wy, 16, 12);
          hg.fillStyle = '#505050'; hg.fillRect(wx, wy, 16, 12);
          if (r() < 0.7) { eg.fillStyle = `rgba(255,${205 + r() * 30},${160 + r() * 50},1)`; eg.fillRect(wx + 3, wy + 3, 10, 6); }
        }
      }
    }
    grime(ag, n, r, 0.05);
    // micro texture into roughness
    const rd = rg.getImageData(0, 0, n, n);
    for (let i = 0; i < rd.data.length; i += 4) { const v = (r() - 0.5) * 18; rd.data[i] += v; rd.data[i + 1] += v; rd.data[i + 2] += v; }
    rg.putImageData(rd, 0, 0);
    const nc = heightToNormal(hc, 2.4);
    return { map: tex(ac, true), normalMap: tex(nc, false), roughnessMap: tex(rc, false), emissiveMap: tex(ec, true) };
  });
}

/** Multi-layer insulation: crinkled gold or silver Kapton foil. */
export function mliFoil({ seed = 3, color = 'gold', n = 512 } = {}) {
  return cached(`mli${seed}${color}`, () => {
    const r = rng(seed);
    const [ac, ag] = canvas(n), [hc, hg] = canvas(n);
    const base = color === 'gold' ? [196, 146, 58] : color === 'black' ? [26, 26, 28] : [205, 205, 210];
    ag.fillStyle = `rgb(${base})`; ag.fillRect(0, 0, n, n);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) {
      const x = r() * n, y = r() * n, s = 10 + r() * 50;
      hg.fillStyle = `rgb(${90 + r() * 80 | 0},${90 + r() * 80 | 0},${90 + r() * 80 | 0})`;
      hg.beginPath(); hg.moveTo(x, y);
      for (let k = 0; k < 4; k++) hg.lineTo(x + (r() - 0.5) * s * 2, y + (r() - 0.5) * s * 2);
      hg.fill();
      const t = (r() - 0.5) * 50;
      ag.fillStyle = `rgba(${base[0] + t},${base[1] + t * 0.8},${base[2] + t * 0.5},0.35)`;
      ag.beginPath(); ag.moveTo(x, y); for (let k = 0; k < 4; k++) ag.lineTo(x + (r() - 0.5) * s * 2, y + (r() - 0.5) * s * 2); ag.fill();
    }
    // tape seams
    hg.fillStyle = '#9a9a9a'; ag.fillStyle = `rgba(${base[0] - 30},${base[1] - 30},${base[2] - 20},0.5)`;
    for (let k = 0; k < 4; k++) { const y = r() * n; hg.fillRect(0, y, n, 10); ag.fillRect(0, y, n, 10); }
    const nc = heightToNormal(hc, 3.5);
    return { map: tex(ac, true), normalMap: tex(nc, false) };
  });
}

/** Photovoltaic array: cells, bus bars, a slight cobalt sheen. */
export function solarCells({ n = 1024 } = {}) {
  return cached('solar', () => {
    const [ac, ag] = canvas(n), [hc, hg] = canvas(n), [rc, rg] = canvas(n);
    ag.fillStyle = '#b8b4a8'; ag.fillRect(0, 0, n, n);
    hg.fillStyle = '#606060'; hg.fillRect(0, 0, n, n);
    rg.fillStyle = '#c0c0c0'; rg.fillRect(0, 0, n, n);
    const cells = 16, cs = n / cells;
    const r = rng(9);
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      const t = r() * 10;
      ag.fillStyle = `rgb(${14 + t},${22 + t},${52 + t * 2})`; ag.fillRect(i * cs + 2, j * cs + 2, cs - 4, cs - 4);
      hg.fillStyle = '#909090'; hg.fillRect(i * cs + 2, j * cs + 2, cs - 4, cs - 4);
      rg.fillStyle = '#2a2a2a'; rg.fillRect(i * cs + 2, j * cs + 2, cs - 4, cs - 4);
      ag.fillStyle = 'rgba(170,170,180,0.6)';
      for (let k = 1; k < 4; k++) ag.fillRect(i * cs + (k * cs) / 4, j * cs + 2, 1, cs - 4);
    }
    return { map: tex(ac, true), normalMap: tex(heightToNormal(hc, 1.5), false), roughnessMap: tex(rc, false) };
  });
}

/** Ceramic heat-shield tiles (Shuttle-style black HRSI tiles with gap filler). */
export function heatTiles({ n = 1024 } = {}) {
  return cached('tiles', () => {
    const r = rng(21);
    const [ac, ag] = canvas(n), [hc, hg] = canvas(n), [rc, rg] = canvas(n);
    ag.fillStyle = '#121214'; ag.fillRect(0, 0, n, n);
    hg.fillStyle = '#404040'; hg.fillRect(0, 0, n, n);
    rg.fillStyle = '#e0e0e0'; rg.fillRect(0, 0, n, n);
    const s = 32;
    for (let y = 0; y < n; y += s) for (let x = (y / s) % 2 ? s / 2 : 0; x < n + s; x += s) {
      const t = 16 + r() * 22;
      ag.fillStyle = `rgb(${t},${t},${t + 2})`; ag.fillRect(x + 1, y + 1, s - 2, s - 2);
      hg.fillStyle = `rgb(${150 + r() * 30 | 0},${150},${150})`; hg.fillRect(x + 1.5, y + 1.5, s - 3, s - 3);
      const rr = 200 + r() * 50 | 0; rg.fillStyle = `rgb(${rr},${rr},${rr})`; rg.fillRect(x + 1, y + 1, s - 2, s - 2);
    }
    grime(ag, n, r, 0.12, '200,195,185'); // pale scorching
    return { map: tex(ac, true), normalMap: tex(heightToNormal(hc, 2.5), false), roughnessMap: tex(rc, false) };
  });
}

/** Radiator panel: white with heat-pipe ribs. */
export function radiator({ n = 512 } = {}) {
  return cached('rad', () => {
    const [ac, ag] = canvas(n), [hc, hg] = canvas(n);
    ag.fillStyle = '#e6e6e2'; ag.fillRect(0, 0, n, n);
    hg.fillStyle = '#707070'; hg.fillRect(0, 0, n, n);
    for (let x = 0; x < n; x += 24) { hg.fillStyle = '#c0c0c0'; hg.fillRect(x, 0, 6, n); ag.fillStyle = 'rgba(160,160,160,0.4)'; ag.fillRect(x, 0, 6, n); }
    grime(ag, n, rng(4), 0.04);
    return { map: tex(ac, true), normalMap: tex(heightToNormal(hc, 2), false) };
  });
}

// ----- material factories ---------------------------------------------------
export const MAT = {
  hull(opts = {}, repeat = [1, 1]) {
    const t = hullPanels(opts);
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, emissiveMap: opts.windows ? t.emissiveMap : null,
      emissive: opts.windows ? 0xffffff : 0x000000, emissiveIntensity: opts.windows ? 1.6 : 0, roughness: 1, metalness: 0.12, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.9 });
    setRepeat(m, repeat);
    return m;
  },
  foil(color = 'gold', repeat = [2, 2]) {
    const t = mliFoil({ color });
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, metalness: color === 'black' ? 0.3 : 1.0, roughness: color === 'black' ? 0.6 : 0.32, normalScale: new THREE.Vector2(1.1, 1.1), envMapIntensity: 1.4 });
    setRepeat(m, repeat);
    return m;
  },
  solar(repeat = [1, 1]) {
    const t = solarCells();
    const m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, metalness: 0.55, roughness: 1, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 });
    setRepeat(m, repeat);
    return m;
  },
  tiles(repeat = [1, 1]) {
    const t = heatTiles();
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, metalness: 0.0, roughness: 1, envMapIntensity: 0.5 });
    setRepeat(m, repeat);
    return m;
  },
  radiator(repeat = [1, 1]) {
    const t = radiator();
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, metalness: 0.05, roughness: 0.55, envMapIntensity: 0.8 });
    setRepeat(m, repeat);
    return m;
  },
  metal(color = 0x8a8b8e, rough = 0.32) { return new THREE.MeshStandardMaterial({ color, metalness: 1.0, roughness: rough, envMapIntensity: 1.2 }); },
  darkMetal() { return new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.85, roughness: 0.42, envMapIntensity: 1.0 }); },
  glass() { return new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.9, envMapIntensity: 2.2, ior: 1.52 }); },
  nozzle() { return new THREE.MeshStandardMaterial({ color: 0x4a4440, metalness: 0.95, roughness: 0.38, side: THREE.DoubleSide, envMapIntensity: 1.0 }); },
};

function setRepeat(m, rep) {
  for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) if (m[k]) { m[k] = m[k].clone(); m[k].needsUpdate = true; m[k].repeat.set(rep[0], rep[1]); }
}
