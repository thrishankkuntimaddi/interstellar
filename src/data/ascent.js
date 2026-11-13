// 2-D point-mass ascent simulation over a spherical, rotating-atmosphere-free Earth.
// Three-stage heavy launcher (Saturn V class numbers), exponential atmosphere, drag,
// gravity turn in stage 1, then a linear pitch program to orbit insertion.

const MU = 3.986004418e14, RE = 6371000, G0 = 9.80665;
export const STAGES = [
  { F: 35.1e6, isp: 263, mProp: 2.15e6, mDry: 0.135e6, burn: 161 },
  { F: 5.14e6, isp: 421, mProp: 0.444e6, mDry: 0.036e6, burn: 360 },
  { F: 1.03e6, isp: 421, mProp: 0.075e6, mDry: 0.012e6, burn: 160 },
];
export const PAYLOAD = 0.05e6;

export function simulateAscent({ dt = 0.1, tEnd = 720, kickV = 60, kickDeg = 1.6 } = {}) {
  let m = PAYLOAD + STAGES.reduce((s, x) => s + x.mProp + x.mDry, 0);
  let x = 0, y = RE, vx = 0, vy = 0;   // inertial frame, launch site at (0, RE)
  let stage = 0, tStage = 0, kicked = false, gammaAtStaging = 0;
  const out = [];
  let maxQ = 0, tMaxQ = 0;
  for (let t = 0; t <= tEnd; t += dt) {
    const r = Math.hypot(x, y), h = r - RE;
    const up = [x / r, y / r], east = [up[1], -up[0]];
    const v = Math.hypot(vx, vy);
    const vUp = vx * up[0] + vy * up[1], vE = vx * east[0] + vy * east[1];
    const gamma = Math.atan2(vUp, Math.max(vE, 1e-3)); // flight-path angle above horizontal
    const rho = 1.225 * Math.exp(-h / 8500);
    const q = 0.5 * rho * v * v;
    if (q > maxQ) { maxQ = q; tMaxQ = t; }
    let F = 0, dirx = up[0], diry = up[1];
    const S = STAGES[stage];
    if (S) {
      F = S.F * (stage === 0 ? Math.min(1, 0.92 + h / 40000 * 0.08) : 1);
      let pitch; // thrust angle above local horizontal
      if (!kicked) { pitch = Math.PI / 2; if (v > kickV) kicked = true; }
      else if (stage === 0) pitch = v < kickV + 50 ? Math.PI / 2 - kickDeg * Math.PI / 180 : Math.max(gamma, 0); // pitch-over, then gravity turn
      else pitch = gammaAtStaging * Math.max(0, 1 - (tStage / 300)) + (h < 175e3 ? 0.06 : 0) - (vUp > 0 && h > 185e3 ? 0.05 : 0);
      dirx = east[0] * Math.cos(pitch) + up[0] * Math.sin(pitch);
      diry = east[1] * Math.cos(pitch) + up[1] * Math.sin(pitch);
    }
    const drag = q * 0.5 * Math.PI * 25;
    const ax = (F * dirx - (v > 0 ? drag * vx / v : 0)) / m - MU * x / r ** 3;
    const ay = (F * diry - (v > 0 ? drag * vy / v : 0)) / m - MU * y / r ** 3;
    const gLoad = Math.hypot(ax + MU * x / r ** 3, ay + MU * y / r ** 3) / G0;
    const downrange = Math.atan2(x, y) * RE;
    if (Math.round(t / dt) % 5 === 0) out.push({ t, h, v, vE, vUp, gamma, q, gLoad, downrange, stage, m, theta: Math.atan2(x, y) });
    vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
    if (S) {
      m -= (S.F / (S.isp * G0)) * dt; tStage += dt;
      if (tStage >= S.burn) {
        m -= S.mDry; stage++; tStage = 0; gammaAtStaging = Math.max(gamma, 0.05);
      }
      // orbit insertion: cut off when circular velocity reached
      const vCirc = Math.sqrt(MU / r);
      if (stage >= 1 && vE >= vCirc * 0.999 && h > 150e3) stage = 99;
    }
  }
  return { samples: out, maxQ, tMaxQ };
}

export function sampleAscent(sim, t) {
  const s = sim.samples; const dt = s[1].t - s[0].t;
  const i = Math.max(0, Math.min(s.length - 2, Math.floor(t / dt)));
  const a = s[i], b = s[i + 1], f = Math.max(0, Math.min(1, (t - a.t) / dt));
  const o = {};
  for (const k in a) o[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * f : a[k];
  o.stage = a.stage;
  return o;
}

/**
 * Closed-loop ascent guidance used by the playable launch (and by TARS when it flies it).
 * st: { h, v, vUp, vE, r, stage, aT (thrust acceleration available) } -> { pitch (rad above the local horizon), thr, cut }
 * Stage 1: vertical rise, a 2.2° kick, then a gravity turn. Upper stages: hold 185 km with a critically damped
 * vertical channel and spend everything else on horizontal speed; cut off at circular velocity.
 */
export function ascentGuidance(st) {
  const { h, v, vUp, vE, r, stage, aT } = st;
  const gamma = Math.atan2(vUp, Math.max(vE, 1e-3));
  if (v < 60) return { pitch: Math.PI / 2, thr: 1, cut: false };
  if (stage === 0) return { pitch: v < 110 ? Math.PI / 2 - (2.2 * Math.PI) / 180 : Math.max(gamma, 0), thr: 1, cut: false };
  const tau = 60, aV = (185e3 - h) / (tau * tau) - (2 * vUp) / tau;
  const need = aV + MU / (r * r) - (vE * vE) / r;
  const vc = Math.sqrt(MU / r);
  return { pitch: Math.asin(Math.max(-0.35, Math.min(0.85, need / Math.max(aT, 0.1)))), thr: Math.max(0.05, Math.min(1, (vc - vE) / 60)), cut: vE >= vc - 1 && h > 150e3 };
}
