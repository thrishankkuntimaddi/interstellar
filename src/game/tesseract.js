import * as THREE from 'three';
import { shipScene, aimSun } from '../chapters/base.js';
import { tesseract } from '../chapters/c11_gargantua.js';
import { model } from '../world/models.js';
import { fmt } from '../data/astro.js';
import { award } from './career.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const glow = (r, g, b, k = 1) => new THREE.Color(r, g, b).multiplyScalar(k);

// S · T · A · Y, keyed one gravity pulse at a time
const MORSE = '···–·––·––', LETTERS = [[3, 'S'], [4, 'T'], [6, 'A'], [10, 'Y']];
const FRAGMENTS = [V(13.5, 4.5, 58.5), V(-31.5, 22.5, 22.5), V(40.5, -13.5, -13.5), V(-13.5, -31.5, -40.5), V(22.5, 31.5, -58.5)];
const WINDOW = V(0, 4.5, -85.5);
const PERIOD = 1.7, OPEN = 0.74; // one pulse every PERIOD seconds; the key is live in the last quarter of each

function astronaut() {
  const g = new THREE.Group();
  const fig = model('astronaut');
  if (fig) { fig.position.y = -0.95; g.add(fig); } else {
    const suit = new THREE.MeshStandardMaterial({ color: 0xe6e4de, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 6, 16), suit), head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 14), new THREE.MeshStandardMaterial({ color: 0x20242c, metalness: 0.9, roughness: 0.15 }));
    head.position.y = 0.75; g.add(body, head);
  }
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.22), new THREE.MeshStandardMaterial({ color: 0xcfd0cc, roughness: 0.6, metalness: 0.2 })); pack.position.set(0, 0.32, -0.26); g.add(pack);
  const jet = new THREE.PointLight(0x9fc4ff, 0, 6, 2); jet.position.set(0, 0.2, -0.5); g.add(jet);
  const spot = new THREE.SpotLight(0xfff1dd, 0, 60, 0.6, 0.6, 1.2); spot.position.set(0, 0.7, 0.2); spot.target.position.set(0, 0.4, 20); g.add(spot, spot.target);
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  g.userData = { rcs: [V(0.3, 0.3, -0.3), V(-0.3, 0.3, -0.3)], cockpit: V(0, 0.72, 0.28), spot, blink() {}, setThrust(v) { jet.intensity = v * 6; } };
  return g;
}

export const EVA = {
  id: 'eva', name: 'EVA SUIT', cls: 'Manoeuvring unit', rank: 0, build: astronaut,
  accel: 1, boost: 1, rcs: 1, rate: 1, dv: 6000, hull: 100, heat: 1, size: 0.2, radius: 1.2,
  collar: V(), dockAxis: V(0, 0, 1), gear: 0,
};

function fragment() {
  const g = new THREE.Group();
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshBasicMaterial({ color: glow(0.55, 0.8, 1.0, 2.2), wireframe: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 2), new THREE.MeshBasicMaterial({ color: glow(0.8, 0.95, 1.0, 5) }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 16), new THREE.MeshBasicMaterial({ color: glow(0.3, 0.6, 1.0, 0.5), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(cage, core, halo);
  g.userData.spin = (t, i) => { cage.rotation.set(t * 0.7 + i, t * 0.9, 0); core.scale.setScalar(1 + 0.25 * Math.sin(t * 4 + i)); };
  return g;
}

/** The moment: a bookshelf seen from behind, one slice of time among all the others. */
function momentWindow() {
  const g = new THREE.Group();
  const bar = (w, h, d, x, y, z, col) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.set(x, y, z); g.add(m); return m; };
  const mats = [];
  for (const [x, y, w, h] of [[0, 2.7, 9, 0.12], [0, -2.7, 9, 0.12], [-4.5, 0, 0.12, 5.5], [4.5, 0, 0.12, 5.5], [0, 0.9, 9, 0.06], [0, -0.9, 9, 0.06]]) mats.push(bar(w, h, 0.12, x, y, 0, glow(1.0, 0.8, 0.5, 2.5)).material);
  // book spines on three shelves
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const sy of [-1.8, 0, 1.8]) for (let x = -4.2; x < 4.2;) {
    const w = 0.12 + rnd() * 0.22, h = 1.0 + rnd() * 0.6;
    mats.push(bar(w * 0.8, h, 0.5, x + w / 2, sy - 0.85 + h / 2, -0.3, glow(0.9 + rnd() * 0.1, 0.55 + rnd() * 0.3, 0.3 + rnd() * 0.25, 0.7 + rnd() * 0.8)).material);
    x += w;
  }
  const pane = bar(8.9, 5.3, 0.02, 0, 0, -0.7, glow(1.0, 0.75, 0.45, 0.5)); pane.material.opacity = 0.25;
  const light = new THREE.PointLight(0xffc890, 0, 60, 1.6); light.position.z = 3; g.add(light);
  g.userData.set = (k, pulse) => { mats.forEach((m) => (m.opacity = 0.12 + 0.88 * k)); pane.material.opacity = 0.06 + 0.3 * k + pulse * 0.6; light.intensity = k * 30 + pulse * 200; };
  return g;
}

/**
 * THE TESSERACT — inside Gargantua. No gravity you can feel, no up. Collect the quantum data,
 * find the one moment you can reach, and key it across in gravity.
 */
export function buildTesseract(ctx) {
  const sunDir = V(0.3, 1, 0.2).normalize();
  const tess = new THREE.Scene();
  const world = new THREE.Group(); tess.add(world);
  const lattice = tesseract(); world.add(lattice);
  const win = momentWindow(); win.position.copy(WINDOW); world.add(win);
  const frags = FRAGMENTS.map((p) => { const f = fragment(); f.position.copy(p); world.add(f); return f; });
  const tessLayer = { scene: tess, near: 0.1, far: 2000 };
  const fg = shipScene({ sunDir, env: ctx.envOther, intensity: 2.2, ambient: 0.5, shadow: false });
  fg.userData.sun.color.setRGB(1, 0.84, 0.62); fg.userData.hemi.color.set(0xffd9a8); fg.userData.hemi.groundColor.set(0x6a4a2a);
  const fgLayer = { scene: fg, near: 0.05, far: 500 };
  const me = astronaut(); fg.add(me);
  const flags = {};
  let tx = 0, pulse = 0, hit = 0;
  const points = [];
  const fill = () => {
    points.length = 0;
    FRAGMENTS.forEach((p, i) => points.push({ id: `data${i + 1}`, name: `QUANTUM DATA ${i + 1}`, pos: p.clone(), radius: 1.5, frag: frags[i] }));
    points.push({ id: 'moment', name: 'THE MOMENT', pos: WINDOW.clone().add(V(0, 0, 4)), radius: 4 });
  };
  fill();
  const sentText = (n) => LETTERS.map(([end, ch], i) => { const start = i ? LETTERS[i - 1][0] : 0; return `<b style="color:${n >= end ? '#8fe3c0' : n > start ? '#ffd49a' : 'rgba(232,236,239,.35)'}">${ch} ${MORSE.slice(start, end).split('').map((c, j) => (start + j < n ? c : '○')).join(' ')}</b>`; }).join(' &nbsp; ');

  const loc = {
    id: 'tesseract', name: 'The Tesseract', kicker: 'INSIDE GARGANTUA · THE BULK', units: 'm', bodyName: 'the bulk',
    def: EVA, tesseract: true,
    layers: [tessLayer, fgLayer], fg, sunDir, ranger: me, objs: [], points,
    ship: { pos: V(0, 4.5, 118), vel: V(0, 0, -3), quat: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI) },
    shipParams: { accel: 5, boost: 3, rcs: 4, retro: 4, rate: 1.25, rollRate: 1.2 },
    gravity: (p, out) => out.set(0, 0, 0),
    music: 873,
    reset() { for (const k of Object.keys(flags)) delete flags[k]; frags.forEach((f) => (f.visible = true)); fill(); tx = 0; pulse = 0; lattice.material.uniforms.uFade.value = 1; },
    get window() { return points.find((p) => p.id === 'moment'); },
    get txPhase() { return (tx % PERIOD) / PERIOD; },
    get txOpen() { return this.txPhase > OPEN; },
    canTransmit(s) { return (flags.collected || 0) >= FRAGMENTS.length && s.pos.distanceTo(this.window.pos) < 9; },
    /** Space keys a pulse while you are at the window */
    key(k, X) {
      if (k !== ' ') return false;
      const s = X.ship;
      if (flags.closing) return true;
      if (!this.canTransmit(s)) { X.toast('NOT YET', (flags.collected || 0) < FRAGMENTS.length ? 'collect all five quantum data fragments first' : 'move up to the window: THE MOMENT', '#ff7a4d', 2200); return true; }
      if (s.vel.length() > 2.5) { X.toast('HOLD STILL', 'null your drift (X) before keying', '#ff7a4d', 1500); return true; }
      if (this.txOpen && hit !== Math.floor(tx / PERIOD)) {
        hit = Math.floor(tx / PERIOD); flags.sent = (flags.sent || 0) + 1; pulse = 1;
        X.sfx?.ping(MORSE[flags.sent - 1] === '–' ? 392 : 587, MORSE[flags.sent - 1] === '–' ? 0.5 : 0.18, 0.25); X.cam.kick(0.25);
        const L = LETTERS.find(([end]) => end === flags.sent); if (L) X.say?.(`${L[1]}.`, 2);
        if (flags.sent >= MORSE.length) {
          flags.closing = 0.001; award('tesseract');
          X.checkObjectives();
          X.say?.('They have it. The data is through. The tesseract is closing.', 3);
          X.transit({ title: 'THE DATA IS THROUGH', sub: 'the tesseract is closing · they are letting you go', color: '#ffd49a', t: 11, white: true, then: () => X.start('saturn', null) });
        }
      } else { X.sfx?.ping(180, 0.2, 0.12); X.toast('MISTIMED', 'press as the pulse reaches the end of the bar', '#ff7a4d', 900); }
      return true;
    },
    update(s, dt, t, X) {
      world.position.copy(s.pos).negate();
      lattice.material.uniforms.uTime.value = t;
      const n = flags.collected || 0, ready = n >= FRAGMENTS.length;
      // data fragments: fly through one to take it
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i]; if (!p.frag) continue;
        p.frag.userData.spin(t, i);
        if (p.pos.distanceTo(s.pos) < 3.2) {
          p.frag.visible = false; points.splice(i, 1); flags.collected = n + 1; if (X) X.tgtI = 0;
          X?.sfx?.ping(880, 0.15, 0.2); X?.sfx?.ping(1320, 0.4, 0.16, 0.1); ctx.engine.fx.uFlash.value = 0.35;
          X?.feed(`QUANTUM DATA ${n + 1} / ${FRAGMENTS.length}`, 'recorded');
          X?.say?.(n + 1 >= FRAGMENTS.length ? 'That is all five. Now find the moment. The window is marked.' : `Fragment ${n + 1} of ${FRAGMENTS.length}.`, 2);
        }
      }
      const dW = s.pos.distanceTo(this.window.pos);
      if (ready && dW < 9) flags.atWindow = true;
      // the pulse clock only runs while you can transmit
      if (this.canTransmit(s) && !flags.closing) tx += dt; else tx = 0;
      pulse = Math.max(0, pulse - dt * 2.2);
      win.userData.set(ready ? 1 : 0.15, pulse);
      if (flags.closing) { flags.closing += dt; lattice.material.uniforms.uFade.value = Math.max(0, 1 - flags.closing / 9) + pulse; }
      else lattice.material.uniforms.uFade.value = 1 + pulse * 1.5;
      // the lattice has no edge: far from the centre you are gently folded back
      const r = s.pos.length(); if (r > 135) s.vel.addScaledVector(s.pos, (-dt * 0.12 * (r - 135)) / r);
      aimSun(fg, sunDir, V());
      if (X && this.canTransmit(s) && !flags.closing) {
        const ph = this.txPhase;
        X.ctx.hud.setInteract({ title: 'TRANSMIT · GRAVITY THROUGH THE SECOND HAND', body: `${sentText(flags.sent || 0)}`, hint: 'Press Space as each pulse reaches the end of the bar · hold still (X nulls your drift)', progress: ph, color: this.txOpen ? '#8fe3c0' : '#ffd49a', reticle: null });
        X.interactHeld = true;
      }
    },
    afterCamera() {},
    collide() { return null; },
    telemetry(s) {
      const n = flags.collected || 0;
      return [
        ['LOCATION', 'THE BULK · 5 DIMENSIONS'], ['TIME', 'a physical dimension here', 'ok'],
        ['QUANTUM DATA', `${n} / ${FRAGMENTS.length}`, n >= FRAGMENTS.length ? 'ok' : 'warn'],
        ['THE MOMENT', fmt.km(s.pos.distanceTo(this.window.pos)), n >= FRAGMENTS.length ? 'ok' : ''],
        ['PULSES KEYED', `${flags.sent || 0} / ${MORSE.length}`],
        ['DRIFT', `${fmt.n(s.vel.length(), 2)} m/s`],
      ];
    },
  };
  loc.flags = flags;
  return loc;
}
