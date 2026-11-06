// Real physical data. Sources:
//  - NASA Planetary Fact Sheets (nssdc.gsfc.nasa.gov/planetary/factsheet)
//  - JPL "Keplerian Elements for Approximate Positions of the Major Planets" (E.M. Standish), table 1, 1800–2050 AD
//  - Live state vectors: JPL Horizons API (ssd.jpl.nasa.gov/api/horizons.api), proxied by the Vite dev server
//  - Gargantua parameters: K. Thorne, "The Science of Interstellar" (2014)

export const C = {
  G: 6.6743e-11,
  c: 299792458,
  Msun: 1.98847e30,
  AU: 1.495978707e11,
  g0: 9.80665,
  year: 365.25 * 86400,
};

export const PLANETS = {
  earth:   { name: 'Earth',   radiusKm: 6371.0,  massKg: 5.9722e24, gm: 3.986004418e14, rotH: 23.9345, tilt: 23.44, g: 9.81,  vesc: 11.186, color: 0x6fa8ff },
  moon:    { name: 'Moon',    radiusKm: 1737.4,  massKg: 7.346e22,  gm: 4.9048695e12,  rotH: 655.72,  tilt: 6.68,  g: 1.62,  vesc: 2.38 },
  mars:    { name: 'Mars',    radiusKm: 3389.5,  massKg: 6.4171e23, gm: 4.282837e13,   rotH: 24.6229, tilt: 25.19, g: 3.71,  vesc: 5.03,  color: 0xd9734a },
  jupiter: { name: 'Jupiter', radiusKm: 69911,   massKg: 1.89813e27,gm: 1.26686534e17, rotH: 9.925,   tilt: 3.13,  g: 24.79, vesc: 59.5,  color: 0xd8b48a },
  saturn:  { name: 'Saturn',  radiusKm: 58232,   massKg: 5.6834e26, gm: 3.7931187e16,  rotH: 10.656,  tilt: 26.73, g: 10.44, vesc: 35.5,  color: 0xe8d29a,
             rings: { dInner: 66900, cInner: 74658, bOuter: 117580, aOuter: 136775, fRing: 140180 } },
};

// [a(AU), e, I(deg), L(deg), longPeri(deg), longNode(deg)] and per-century rates
const KEP = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};
export const ORBIT_KEYS = Object.keys(KEP);

const rad = Math.PI / 180;
export function julianDate(date) { return date.getTime() / 86400000 + 2440587.5; }

/** Heliocentric ecliptic J2000 position (AU) from JPL mean elements. */
export function keplerPosition(key, date = new Date()) {
  const [e0, r] = KEP[key];
  const T = (julianDate(date) - 2451545.0) / 36525;
  const a = e0[0] + r[0] * T, e = e0[1] + r[1] * T, I = (e0[2] + r[2] * T) * rad;
  const L = e0[3] + r[3] * T, wb = e0[4] + r[4] * T, Om = (e0[5] + r[5] * T) * rad;
  const w = wb * rad - Om;
  let M = ((L - wb) % 360) * rad;
  if (M > Math.PI) M -= 2 * Math.PI; if (M < -Math.PI) M += 2 * Math.PI;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: (sw * sI) * xp + (cw * sI) * yp,
    a,
  };
}

const HORIZON_IDS = { mercury: '199', venus: '299', earth: '399', mars: '499', jupiter: '599', saturn: '699', uranus: '799', neptune: '899' };

/** Live ephemeris from NASA/JPL Horizons via the local dev proxy. Falls back to Kepler elements. */
export async function fetchEphemeris(date = new Date()) {
  const out = { source: 'JPL mean Keplerian elements (offline)', positions: {} };
  for (const k of ORBIT_KEYS) out.positions[k] = keplerPosition(k, date);
  const d0 = date.toISOString().slice(0, 10);
  const d1 = new Date(date.getTime() + 86400000).toISOString().slice(0, 10);
  try {
    if (!import.meta.env.DEV) throw new Error('static hosting: no Horizons proxy');
    const settled = [];
    let failed = false; // stop after the first failure (offline) instead of trying every planet
    for (const k of ORBIT_KEYS) settled.push(failed ? null : await (async () => {
      const q = new URLSearchParams({
        format: 'json', COMMAND: `'${HORIZON_IDS[k]}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS',
        CENTER: "'500@10'", START_TIME: `'${d0}'`, STOP_TIME: `'${d1}'`, STEP_SIZE: "'1 d'", VEC_TABLE: "'1'",
        OUT_UNITS: "'AU-D'", CSV_FORMAT: "'YES'", REF_PLANE: "'ECLIPTIC'",
      });
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(`/horizons?${q}`, { signal: ctl.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error('horizons ' + res.status);
      const j = await res.json();
      const block = j.result.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n')[0];
      const f = block.split(',').map((s) => s.trim());
      return [k, { x: +f[2], y: +f[3], z: +f[4], a: out.positions[k].a }];
    })().catch(() => { failed = true; return null; }));
    let live = 0;
    for (const r of settled) if (r && Number.isFinite(r[1].x)) { out.positions[r[0]] = r[1]; live++; }
    if (!live) throw new Error('no live vectors');
    out.source = live === ORBIT_KEYS.length ? 'NASA/JPL Horizons · live state vectors' : `NASA/JPL Horizons (${live}/${ORBIT_KEYS.length} live) + Kepler`;
  } catch (e) {
    console.info('[astro] Horizons unavailable, using Kepler elements:', e.message);
  }
  return out;
}

// ---------- Derived physics ----------
const GM_SUN = 1.32712440018e20;

export function hohmann(a1AU, a2AU) {
  const r1 = a1AU * C.AU, r2 = a2AU * C.AU, at = (r1 + r2) / 2;
  const v1 = Math.sqrt(GM_SUN / r1), v2 = Math.sqrt(GM_SUN / r2);
  const dv1 = v1 * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
  const dv2 = v2 * (1 - Math.sqrt(2 * r1 / (r1 + r2)));
  const tof = Math.PI * Math.sqrt(at ** 3 / GM_SUN);
  return { dv1, dv2, tofYears: tof / C.year };
}

export const GARGANTUA = (() => {
  const M = 1e8 * C.Msun;
  const rs = 2 * C.G * M / (C.c * C.c);
  return {
    massSolar: 1e8, M, rs, rsAU: rs / C.AU, spin: 0.99999999999999,
    // Miller's planet: 1 hour = 7 years
    millerDilation: 7 * 365.25 * 24,
    tidal(rMeters, bodyLen = 2) { return 2 * C.G * M * bodyLen / rMeters ** 3; },
    // Schwarzschild static-observer factor dτ/dt (shown with the non-spinning approximation used by the renderer)
    dilation(rOverRs) { return Math.sqrt(Math.max(1e-12, 1 - 1 / rOverRs)); },
  };
})();

export const ENDURANCE = {
  radius: 32, // m (ring of 12 modules, ~64 m diameter)
  rpmFor1g() { return Math.sqrt(C.g0 / this.radius) * 60 / (2 * Math.PI); },
  gAt(rpm, r = this.radius) { const w = rpm * 2 * Math.PI / 60; return w * w * r / C.g0; },
};

export const fmt = {
  n(v, d = 0) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); },
  km(m) { return m >= 1e6 ? `${fmt.n(m / 1000, 0)} km` : m >= 1e3 ? `${fmt.n(m / 1000, 1)} km` : `${fmt.n(m, 0)} m`; },
  time(s) {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
  },
  ymd(years) {
    const y = Math.floor(years); const remDays = (years - y) * 365.25;
    const mo = Math.floor(remDays / 30.44); const d = Math.floor(remDays - mo * 30.44);
    return `${y}y ${mo}m ${d}d`;
  },
};
