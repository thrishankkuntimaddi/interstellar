import * as THREE from 'three';
import { ScaledLayer } from './base.js';
import { createBlackHole, blackHoleMode } from '../world/blackhole.js';
import { GARGANTUA, fmt } from '../data/astro.js';
import { V } from '../core/util.js';

// Positions in units of the Schwarzschild radius (BH at origin, disk in the XZ plane).
// Miller orbits just outside the disk's inner edge; Mann and Edmunds far out.
export const SYS = {
  miller: V(6.5, 0.35, 3.0),
  mann: V(-160, 12, 90),
  edmunds: V(210, -20, -260),
  wormhole: V(0, 9, 120),
};
export const RS_M = GARGANTUA.rs;        // metres per r_s
export const RS_KM = GARGANTUA.rs / 1000;

/** Layer that renders Gargantua (and the far galaxy's sky around it) in r_s units. */
export function gargantuaLayer({ tilt = 0.08 } = {}) {
  const L = new ScaledLayer({ near: 0.1, far: 10, scale: 1 / RS_M });
  const bh = createBlackHole({ scale: 1 });
  bh.anchor.rotation.set(tilt, 0, 0.05);
  L.scene.add(bh.mesh, bh.anchor);
  L.bh = bh;
  return L;
}

export function dilation(rRs) { return GARGANTUA.dilation(rRs); }

/** Schematic of the Gargantua system for the HUD minimap. */
export function drawSystem(g, shipRs, { highlight = '', label = '' } = {}) {
  const W = g.canvas.width, H = g.canvas.height, cx = W / 2, cy = H / 2;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(cx, cy, W / 2 - 2, 0, 7); g.fill();
  g.strokeStyle = 'rgba(232,236,239,0.18)'; g.stroke();
  // log-radial projection so the inner system is readable
  const proj = (p) => { const r = Math.hypot(p.x, p.z); const k = (Math.log10(1 + r) / Math.log10(1 + 400)) * (W / 2 - 18); const a = Math.atan2(p.z, p.x); return [cx + Math.cos(a) * k, cy + Math.sin(a) * k, k]; };
  // disk
  const [, , kIn] = proj(V(2.3, 0, 0)), [, , kOut] = proj(V(13, 0, 0));
  const grd = g.createRadialGradient(cx, cy, kIn, cx, cy, kOut);
  grd.addColorStop(0, 'rgba(255,220,170,0.7)'); grd.addColorStop(1, 'rgba(255,150,80,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, kOut, 0, 7); g.fill();
  g.fillStyle = '#000'; g.beginPath(); g.arc(cx, cy, proj(V(1, 0, 0))[2], 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,212,154,0.8)'; g.beginPath(); g.arc(cx, cy, proj(V(1, 0, 0))[2], 0, 7); g.stroke();
  g.font = '9px JetBrains Mono, monospace';
  const items = [['miller', '#8fd0d8', 'MILLER'], ['mann', '#d8e6f5', 'MANN'], ['edmunds', '#d8a070', 'EDMUNDS'], ['wormhole', '#9fc4ff', 'WORMHOLE']];
  for (const [k, c, name] of items) {
    const [x, y, kr] = proj(SYS[k]);
    if (k !== 'wormhole') { g.strokeStyle = 'rgba(232,236,239,0.10)'; g.beginPath(); g.arc(cx, cy, kr, 0, 7); g.stroke(); }
    g.fillStyle = c; g.beginPath(); g.arc(x, y, highlight === k ? 4 : 2.5, 0, 7); g.fill();
    g.fillStyle = highlight === k ? '#ffd49a' : 'rgba(232,236,239,0.7)'; g.fillText(name, x + 6, y + 3);
  }
  if (shipRs) {
    const [x, y] = proj(shipRs);
    g.strokeStyle = '#ffd49a'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.stroke();
    g.fillStyle = '#ffd49a'; g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(232,236,239,0.6)';
  g.fillText('GARGANTUA SYSTEM · LOG RADIUS', 18, H - 18);
  if (label) g.fillText(label, 18, H - 30);
}

export function bhTelemetry(rRs) {
  const d = dilation(rRs);
  return [
    ['GARGANTUA MASS', '1.0 × 10⁸ M☉'],
    ['SCHWARZSCHILD RADIUS', `${fmt.n(RS_KM / 1e6, 0)} million km (${fmt.n(GARGANTUA.rsAU, 2)} AU)`],
    ['SPIN a/M (rendered)', blackHoleMode() === 'movie' ? '0.6 · movie look' : '0.999 · physical'],
    ['FRAME DRAGGING', 'Kerr metric · ZAMO camera', 'ok'],
    ['DISTANCE', `${fmt.n(rRs, rRs < 10 ? 2 : 0)} r_s`],
    ['TIME DILATION dτ/dt', fmt.n(d, d > 0.999 ? 5 : 4), d < 0.9 ? 'warn' : ''],
  ];
}
