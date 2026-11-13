// TARS — the copilot. Three jobs:
//   1. an autopilot that can fly every contract (rendezvous, docking, landing, orbit changes, launch, the black hole)
//   2. a voice: callouts while you fly ("five degrees… three degrees… thrust sixty percent") and spoken warnings
//   3. voice commands through the browser's speech recognition ("TARS, dock", "full throttle", "status")
import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { C_GAME } from './locations.js';
import { fmt } from '../data/astro.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ZERO = V();
const DEG = 180 / Math.PI;
const now = () => performance.now() / 1000;
const NUM = { zero: 0, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, half: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, full: 100 };

// ---------------------------------------------------------------------------------------------- voice out
class Voice {
  constructor(onLine) {
    this.onLine = onLine; this.synth = window.speechSynthesis || null; this.voice = null; this.quietUntil = 0;
    if (!this.synth) return;
    const pick = () => {
      const vs = this.synth.getVoices().filter((v) => /^en/i.test(v.lang));
      const want = ['Google UK English Male', 'Daniel', 'Alex', 'Aaron', 'Google US English', 'Samantha'];
      this.voice = want.map((n) => vs.find((v) => v.name.includes(n))).find(Boolean) || vs[0] || null;
    };
    pick(); this.synth.addEventListener?.('voiceschanged', pick);
  }
  get speaking() { return !!this.synth && (this.synth.speaking || this.synth.pending); }
  /** pri 3 interrupts, 2 queues (one deep), 1 is chatter that is dropped while TARS is already talking */
  say(text, pri = 2) {
    this.onLine(text);
    if (!settings.voice || !this.synth) return;
    if (pri <= 1 && this.speaking) return;
    if (pri === 2 && this.synth.pending) return;
    if (pri >= 3) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/r_s/g, 'R S').replace(/Δv/g, 'delta v'));
    if (this.voice) u.voice = this.voice;
    u.rate = 1.08; u.pitch = 0.72; u.volume = clamp(settings.voiceVol ?? 0.9);
    u.onend = () => { this.quietUntil = now() + 0.7; };
    this.quietUntil = now() + 0.8 + text.length * 0.08; // do not take my own voice as a command
    this.synth.speak(u);
  }
  stop() { this.synth?.cancel(); this.quietUntil = 0; }
}

// ---------------------------------------------------------------------------------------------- voice in
class Mic {
  constructor(onText, onState) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.ok = !!SR; this.want = false; this.live = false; this.onState = onState;
    if (!SR) return;
    const r = (this.rec = new SR()); r.continuous = true; r.interimResults = false; r.lang = 'en-US'; r.maxAlternatives = 3;
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText([...e.results[i]].map((a) => a.transcript.toLowerCase().trim())); };
    r.onend = () => { this.live = false; if (this.want) setTimeout(() => this.start(), 250); else onState(false); };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { this.want = false; onState(false, 'microphone unavailable or permission denied'); } };
  }
  start() { if (!this.ok) return false; this.want = true; if (this.live) return true; try { this.rec.start(); this.live = true; this.onState(true); } catch { /* already running */ } return true; }
  stop() { this.want = false; try { this.rec?.stop(); } catch { /* not running */ } }
}

/** seconds until the next periapsis ('pe') or apoapsis ('ap') on the current conic (0 if the orbit is circular) */
function apsisTime(r, v, mu, which) {
  const rr = r.length(), h = V().crossVectors(r, v);
  const ev = v.clone().cross(h).multiplyScalar(1 / mu).addScaledVector(r, -1 / rr), e = ev.length();
  const a = 1 / (2 / rr - v.lengthSq() / mu);
  if (e < 2e-4) return 0;
  if (a <= 0 || e >= 1) return which === 'pe' && r.dot(v) < 0 ? rr / Math.max(1, -r.dot(v) / rr) : Infinity;
  let nu = Math.acos(clamp(ev.dot(r) / (e * rr), -1, 1)); if (r.dot(v) < 0) nu = 2 * Math.PI - nu;
  let E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2)); if (E < 0) E += 2 * Math.PI;
  const n = Math.sqrt(mu / (a * a * a)), T = (2 * Math.PI) / n, since = (E - e * Math.sin(E)) / n;
  return which === 'pe' ? T - since : (T / 2 - since + T) % T;
}

export class Copilot {
  constructor(X) {
    this.X = X; this.mode = null; this.task = null; this.queue = []; this.objI = -1; this.idle = 0;
    this.cmd = { acc: V(), boost: false, dir: null, quat: null, thr: null };
    this.lad = {}; this.cool = {}; this.pow = { v: 0, said: 0, t: 0, hold: 0 };
    this.voice = new Voice((line) => X.tarsLine(line));
    this.mic = new Mic((alts) => this.heard(alts), (on, err) => { X.micState(on, err); if (err) this.say(`I can't hear you: ${err}.`, 2); });
  }
  get on() { return !!this.mode; }
  get s() { return this.X.ship; }
  get L() { return this.X.loc; }
  get label() { return this.mode ? `TARS · ${this.task?.name || 'STANDING BY'}` : ''; }

  say(text, pri = 2) { this.voice.say(text, pri); }
  /** rate-limited line: at most once per `gap` seconds for a given key */
  once(key, text, gap = 10, pri = 2) { const t = now(); if (t - (this.cool[key] || -1e9) < gap) return false; this.cool[key] = t; this.say(text, pri); return true; }
  /** descending ladder of callouts: speaks each step once as `value` falls through it */
  ladder(key, value, steps, text, pri = 1) {
    const first = this.lad[key] === undefined; let i = this.lad[key] ?? -1;
    if (value > (steps[0] > 0 ? steps[0] * 1.25 : steps[0] * 0.5)) { this.lad[key] = -1; return; }
    let hit = -1; while (i + 1 < steps.length && value <= steps[i + 1]) hit = ++i;
    if (hit >= 0) { this.lad[key] = i; if (!first) this.say(text(steps[hit]), pri); } else if (first) this.lad[key] = -1;
  }
  dist(d) { return this.L.units === 'rs' ? `${fmt.n(d, d < 10 ? 1 : 0)} r_s` : d >= 1000 ? `${fmt.n(d / 1000, d < 10000 ? 1 : 0)} kilometres` : `${fmt.n(d, 0)} metres`; }

  toggleMic() {
    if (!this.mic.ok) { this.X.toast('VOICE COMMANDS UNAVAILABLE', 'this browser has no speech recognition · use Chrome', '#ff7a4d', 3500); return; }
    if (this.mic.want) { this.mic.stop(); this.say('Microphone off.', 2); } else { this.mic.start(); this.say('Listening. Say: autopilot, dock, land, full throttle, status.', 2); }
  }

  // -------------------------------------------------------------------------------------------- engage
  engage(kind = 'auto') {
    const X = this.X, L = this.L, s = this.s;
    if (!X.active || !s || X.crash) return;
    this.task = null; this.queue = []; this.objI = -1; this.idle = 0; this.lad = {}; X.warpI = 0; s.sas = 0; s.throttle = L.launch ? s.throttle : 0;
    const tg = X.targets()[X.tgtI % X.targets().length];
    if (L.launch) { this.mode = 'plan'; this.queue = [this.ascent()]; this.say('I have the vehicle. Flying the ascent.', 3); }
    else if (kind === 'auto' && X.mission) { this.mode = 'mission'; this.say(`I have control. Flying the contract: ${X.mission.name}.`, 3); }
    else {
      this.mode = 'plan';
      const dockable = tg?.dock ? tg : X.targets().find((o) => o.dock), ground = tg?.surface ? tg : X.targets().find((o) => o.surface);
      if (kind === 'dock') { if (!dockable) return this.refuse('There is nothing to dock with here.'); this.queue = [this.dock(dockable.id)]; }
      else if (kind === 'land') { if (!ground) return this.refuse('There is nothing to land on here.'); this.queue = [this.land(ground.id)]; }
      else if (kind === 'brake') this.queue = [this.brake()];
      else if (L.tesseract) this.queue = [this.fragments(), this.moment(), this.transmit()];
      else if (kind === 'approach') this.queue = [tg.surface ? this.land(tg.id) : this.goto(tg.id)];
      else this.queue = [tg.dock ? this.dock(tg.id) : tg.surface ? this.land(tg.id) : tg.portal ? this.portal(tg.id) : this.goto(tg.id)];
      this.say(`I have control. ${this.queue[0].name.toLowerCase().replace(' · ', ': ')}.`, 3);
    }
    X.sfx?.ping(660, 0.12, 0.16); X.sfx?.ping(990, 0.2, 0.14, 0.1);
  }
  refuse(text) { this.mode = null; this.say(text, 3); }
  disengage(text = 'You have control.') {
    if (!this.mode) return;
    this.mode = null; this.task = null; this.queue = [];
    const s = this.s; if (s) { s.ap = null; s.apPower = 0; }
    this.X.warpI = 0;
    if (text) this.say(text, 3);
    this.X.sfx?.ping(520, 0.2, 0.14);
  }

  // -------------------------------------------------------------------------------------------- frame
  update(dt, tg, dRaw, relVel) {
    const X = this.X, s = this.s;
    if (this.mode && (X.crash || !X.active)) { this.mode = null; this.task = null; this.queue = []; }
    if (this.mode) {
      const c = this.cmd; c.acc.set(0, 0, 0); c.boost = false; c.dir = null; c.quat = null; c.thr = null;
      s.ap = c; s.mouse.x = s.mouse.y = 0;
      if (this.mode === 'mission') {
        const i = X.mission ? X.done.indexOf(false) : -1;
        if (i < 0) { this.disengage('You have control.'); return; }
        if (i !== this.objI) {
          this.objI = i; this.task = null; this.lad = {};
          const o = X.objectives[i];
          if (!o.auto) { this.disengage('This one needs a human. You have control.'); return; }
          this.queue = o.auto(this);
        }
      }
      if (!this.task) {
        this.task = this.queue.shift() || null;
        if (!this.task) {
          if (this.mode !== 'mission') { this.disengage(s.docked ? 'Docked. You have control.' : s.landed ? 'We are down. You have control.' : 'Done. You have control.'); return; }
          // the plan ran out but the objective is still open: hold, then plan again
          this.idle += dt; this.hold(relVel); if (this.idle > 5) { this.idle = 0; this.objI = -1; }
        } else this.idle = 0;
      }
      if (this.task) {
        if (!this.task.keepWarp) X.warpI = 0;
        if (this.task.step(dt)) this.task = null;
        if (!c.dir && !c.quat && c.acc.lengthSq() > 0.09 * s.p.accel * s.p.accel) c.dir = c.acc.clone().normalize();
      }
    } else if (s.ap) { s.ap = null; s.apPower = 0; }
    this.callouts(dt, tg, dRaw, relVel);
  }

  /** things TARS says whether or not it is flying */
  callouts(dt, tg, dRaw, relVel) {
    const X = this.X, s = this.s, L = this.L, rs = L.units === 'rs';
    // attitude: "ten degrees… five… three… aligned"
    if (s.sasErr != null) {
      const deg = s.sasErr * DEG;
      if (deg > 14) this.wasOff = true;
      this.ladder('att', deg, [30, 20, 10, 5, 3], (n) => `${n} degrees.`);
      if (this.wasOff && deg < 1.2) { this.wasOff = false; this.say('Aligned.', 1); }
    }
    // thrust power, when it settles on a new level
    const p = this.pow, power = L.launch ? (s.lit ? s.power || 0 : 0) : this.on ? s.apPower * (s.ap?.boost ? s.p.boost : 1) : s.main > 0 ? Math.max(s.throttle, 0.99) * (s.boosting ? s.p.boost : 1) : 0;
    const level = Math.round(power * 10) / 10;
    if (level !== p.v) { p.v = level; p.hold = 0; } else p.hold += dt;
    if (p.hold > 0.7 && Math.abs(level - p.said) >= 0.3 && now() - p.t > 4 && !s.docked) {
      p.said = level; p.t = now();
      this.say(level === 0 ? 'Engines off.' : level > 1 ? 'Boost. Full power.' : `Thrust ${fmt.n(level * 100, 0)} percent.`, 1);
    }
    // docking
    const dk = X.dockInfo;
    if (dk && !s.docked) {
      this.ladder('dk', dk.d, [50, 30, 20, 10, 5, 3, 2, 1], (n) => `${n} metre${n === 1 ? '' : 's'}.`);
      if (dk.d < 30) this.ladder('dka', dk.deg, [20, 10, 5, 3], (n) => `Alignment ${n} degrees.`);
      if (dk.d < 12 && dk.vrel > 0.6) this.once('dkfast', `Too fast. ${fmt.n(dk.vrel, 1)} metres per second. Bring it under half a metre.`, 6, 2);
    } else if (!rs && !L.launch && !L.tesseract && dRaw < 6000) this.ladder(`rng:${tg.id}`, dRaw, [5000, 2000, 1000, 500, 200, 100], (n) => `${tg.name.toLowerCase()}, ${this.dist(n)}.`);
    // landing
    const ground = X.targets().find((o) => o.surface);
    if (ground && !s.landed) {
      const alt = X.surfaceInfo(ground).alt;
      if (alt < 1500) this.ladder('alt', alt, [1000, 500, 200, 100, 50, 20, 10, 5], (n) => `${n} metres.`);
    }
    // relativity
    if (L.clock) {
      this.ladder('dil', L.clock.dil ?? 1, [0.9, 0.8, 0.7, 0.6, 0.5, 0.4], (n) => `Time dilation ${n}. One hour here is ${fmt.n(1 / n, 1)} on Earth.`, 2);
      this.ladder('bh', s.pos.length(), [50, 20, 10, 5, 3, 2], (n) => `${n} r_s from the horizon${n <= 3 ? '. Inside the last stable orbit.' : '.'}`, 1);
    }
    // launch
    if (L.launch && s.lit) {
      const h = L.flags.h || 0;
      this.ladder('h', -h, [-1000, -10000, -50000, -100000, -150000], (n) => (n === -100000 ? 'One hundred kilometres. Welcome to space.' : `Altitude ${fmt.n(-n / 1000, 0)} kilometre${n === -1000 ? '' : 's'}.`), 2);
      if (s.q > 20000) this.qHigh = true; else if (this.qHigh && s.q < 17000) { this.qHigh = false; this.say('Through max Q.', 2); }
      if (s.stage < 3 && s.fuel < 0.08 && s.fuel > 0) this.once(`low${s.stage}`, `${s.stageName} is nearly empty. Stand by to stage.`, 60, 2);
      if (s.fuel <= 0 && s.stage < 2 && !this.on) this.once(`out${s.stage}`, 'Stage is spent. Press space to separate.', 12, 2);
      if (!this.on && s.aoa > 0.25 && s.q > 9000) this.once('aoa', `Angle of attack ${fmt.n(s.aoa * DEG, 0)} degrees. Point into the airflow.`, 6, 3);
    }
  }

  // -------------------------------------------------------------------------------------------- guidance
  select(o) { const i = this.X.targets().indexOf(o); if (i >= 0) this.X.tgtI = i; }
  maxAcc(boost) { return this.s.p.accel * (boost ? this.s.p.boost : 1); }
  setAcc(acc, boost = false) {
    const L = this.L, max = this.maxAcc(boost), m = acc.length();
    // ring boulders, or anything else the location reports as about to hit us
    const th = L.threat;
    if (th && th.gap < 60) acc.addScaledVector(th.rel, (-this.maxAcc(false) * clamp(1 - th.gap / 60)) / Math.max(th.rel.length(), 1e-6));
    if (m > max) acc.multiplyScalar(max / m);
    this.cmd.acc.copy(acc); this.cmd.boost = boost;
  }
  /** fly to point P moving at vT: a braking-curve speed command, with gravity fed forward */
  steerTo(P, vT = ZERO, o = {}) {
    const s = this.s, L = this.L, boost = !!o.boost, max = this.maxAcc(boost);
    const err = P.clone().sub(s.pos), d = err.length();
    const vRel = s.vel.clone().sub(vT);
    const sp = Math.min(o.vmax ?? Infinity, Math.sqrt(2 * (o.brake ?? 0.35) * max * Math.max(0, d - (o.slack || 0)))) + (o.vmin || 0);
    const acc = (d > 1e-9 ? err.multiplyScalar(sp / d) : err.set(0, 0, 0)).sub(vRel).multiplyScalar(o.kv ?? 1.2);
    const g = L.gravity(s.pos, V()); if (o.body) g.sub(L.gravity(o.body.pos, V())); acc.sub(g);
    this.setAcc(acc, boost);
    return { d, v: vRel.length(), vRel };
  }
  hold(relVel) { this.setAcc(relVel.clone().multiplyScalar(-1.2)); }

  // -------------------------------------------------------------------------------------------- tasks
  brake() {
    return { name: 'MATCH VELOCITY', step: () => {
      const X = this.X, tg = X.targets()[X.tgtI % X.targets().length], rel = this.s.vel.clone().sub(tg.body ? tg.body.vel : ZERO);
      this.setAcc(rel.clone().multiplyScalar(-1.5));
      if (rel.length() < 0.03 * this.s.p.accel) { this.say('Relative velocity zero.', 2); return true; }
      return false;
    } };
  }

  /** approach an object and hold `stop` away from it */
  goto(id, stop, o = {}) {
    const X = this.X, rs = this.L.units === 'rs';
    const t0 = X.find(id);
    return { name: `APPROACH · ${t0?.name || id}`, step: () => {
      const tg = X.find(id); if (!tg) return true;
      this.select(tg);
      const s = this.s, pos = X.tpos(tg), vel = tg.body ? tg.body.vel : ZERO;
      const out = s.pos.clone().sub(pos), d0 = out.length();
      const keep = stop ?? Math.max(tg.radius * 2.2, rs ? 0 : 60);
      const P = pos.clone().addScaledVector(out, keep / Math.max(d0, 1e-9));
      const far = d0 > keep + (rs ? 4 : 3000);
      const r = this.steerTo(P, vel, { vmax: o.vmax ?? (rs ? 0.32 : 400), boost: o.boost ?? (rs || far), body: tg.body, kv: rs ? 2.5 : 1.2 });
      // long legs at Gargantua: coast under time warp once we are at cruise speed
      if (rs && this.cmd.acc.length() < 0.25 * s.p.accel && r.d > 12) { this.cmd.acc.set(0, 0, 0); X.warpI = r.d > 80 ? 2 : 1; this.task.keepWarp = true; } else this.task.keepWarp = false;
      if (!this.cmd.dir && r.d < keep * 0.5 + 300) this.cmd.dir = pos.clone().sub(s.pos).normalize();
      const tol = o.tol ?? Math.max(keep * 0.08, rs ? 0.004 : 3);
      if (r.d < tol && r.v < (o.vtol ?? 0.05 * s.p.accel)) { if (!o.quiet) this.say(`Holding ${this.dist(keep)} from ${tg.name.toLowerCase()}.`, 2); return true; }
      return false;
    } };
  }
  /** fly to a point given by fn() -> { pos, vel, body } */
  via(name, fn, o = {}) {
    return { name, step: () => {
      const p = fn(); const r = this.steerTo(p.pos, p.vel || ZERO, { vmax: o.vmax ?? 150, boost: o.boost, body: p.body });
      return r.d < (o.tol ?? 60) && (o.pass || r.v < (o.vtol ?? 2));
    } };
  }
  /** fly straight in, no braking */
  portal(id) {
    const X = this.X;
    return { name: `ENTER · ${X.find(id)?.name || id}`, step: () => {
      const tg = X.find(id); if (!tg) return true;
      this.select(tg);
      const pos = X.tpos(tg), s = this.s, dir = pos.clone().sub(s.pos), d = dir.length(); dir.multiplyScalar(1 / d);
      const vel = tg.body ? tg.body.vel : ZERO, rel = s.vel.clone().sub(vel);
      this.setAcc(dir.clone().multiplyScalar(this.L.units === 'rs' ? 0.3 : 320).sub(rel).multiplyScalar(1.2), true);
      this.cmd.dir = dir;
      this.ladder(`in:${id}`, d, [20000, 10000, 5000, 2000], (n) => `Wormhole in ${this.dist(n)}.`);
      return false;
    } };
  }
  scan(id) {
    const X = this.X;
    return { name: `SCAN · ${X.find(id)?.name || id}`, step: (dt) => {
      const tg = X.find(id); if (!tg || X.scanned(id)) return true;
      this.select(tg);
      const range = tg.scan ?? tg.radius * 8, d = X.tpos(tg).distanceTo(this.s.pos);
      if (d < range * 0.9) { X.scan(); return true; }
      const keep = Math.max(range * 0.6, tg.radius * 1.6);
      const out = this.s.pos.clone().sub(X.tpos(tg)).normalize();
      const rs = this.L.units === 'rs';
      const r = this.steerTo(X.tpos(tg).clone().addScaledVector(out, keep), tg.body ? tg.body.vel : ZERO, { vmax: rs ? 0.32 : 400, boost: rs || d > 4000, body: tg.body, kv: rs ? 2.5 : 1.2 });
      if (rs && this.cmd.acc.length() < 0.25 * this.s.p.accel && r.d > 12) { this.cmd.acc.set(0, 0, 0); X.warpI = r.d > 80 ? 2 : 1; this.task.keepWarp = true; } else this.task.keepWarp = false;
      return false;
    } };
  }

  dock(id) {
    const X = this.X; let phase = 0;
    return { name: `DOCK · ${X.find(id)?.name || id}`, step: () => {
      const o = X.find(id), s = this.s, def = X.def;
      if (!o?.dock) return true;
      if (s.docked === o) { this.say('Capture. Hard dock.', 3); return true; }
      if (s.docked) X.handleKey('u');
      this.select(o);
      const mq = o.mesh.quaternion, port = o.dock.port.clone().applyQuaternion(mq).add(o.body.pos), axis = o.dock.axis.clone().applyQuaternion(mq);
      const mine = def.dockAxis.clone().applyQuaternion(s.quat), off = def.collar.clone().applyQuaternion(s.quat);
      const qd = new THREE.Quaternion().setFromUnitVectors(mine, axis.clone().negate()).multiply(s.quat);
      const rel = off.clone().add(s.pos).sub(port), ax = rel.dot(axis), lat = rel.clone().addScaledVector(axis, -ax), latD = lat.length();
      const vRel = s.vel.clone().sub(o.body.vel), err = Math.acos(clamp(mine.dot(axis) * -1, -1, 1));
      if (phase === 0) {
        // to the gate, 30 m out on the port axis — going round the station if we are behind the port
        let gate = port.clone().addScaledVector(axis, 30);
        if (ax < 6) { const n = latD > 0.5 ? lat.clone().multiplyScalar(1 / latD) : V().crossVectors(axis, V(0.3, 1, 0.2)).normalize(); gate = port.clone().addScaledVector(n, o.radius + 35).addScaledVector(axis, latD < o.radius + 25 ? ax : 30); }
        const r = this.steerTo(gate.sub(off), o.body.vel, { vmax: 60, body: o.body });
        if (r.d < 400) this.cmd.quat = qd;
        if (ax >= 6 && r.d < 1.5 && r.v < 0.3 && err < 0.07) { phase = 1; this.say('On the axis. Final approach, point two metres per second.', 2); }
      } else {
        const centred = latD < 0.35 + 0.04 * Math.max(ax, 0);
        const vDes = axis.clone().multiplyScalar(centred ? -(ax > 12 ? 1.6 : ax > 4 ? 0.7 : 0.22) : 0).addScaledVector(lat, -Math.min(0.8, 0.45 / Math.max(latD, 1e-6)));
        this.setAcc(vDes.sub(vRel).multiplyScalar(2.2));
        this.cmd.quat = qd;
        if (ax > 36 || latD > 7) phase = 0;
      }
      return false;
    } };
  }

  land(id) {
    const X = this.X;
    return { name: `LAND · ${X.find(id)?.name || id}`, step: () => {
      const o = X.find(id), s = this.s;
      if (!o?.surface) return true;
      if (s.landed) { this.say('Touchdown.', 3); return true; }
      this.select(o);
      const info = X.surfaceInfo(o), far = info.alt > 400, max = this.maxAcc(far);
      const vRel = s.vel.clone().sub(o.body.vel);
      const down = far ? Math.min(600, Math.sqrt(2 * 0.3 * max * Math.max(0, info.alt - 150)) + 4) : clamp(info.alt * 0.1 + 0.6, 0.6, 14);
      const acc = info.n.clone().multiplyScalar(-down).sub(vRel).multiplyScalar(far ? 1.0 : 1.6);
      acc.sub(this.L.gravity(s.pos, V()).sub(this.L.gravity(o.body.pos, V())));
      this.setAcc(acc, far);
      if (info.alt < 2500) this.cmd.quat = new THREE.Quaternion().setFromUnitVectors(s.up(), info.n).multiply(s.quat);
      return false;
    } };
  }
  liftoff(id, alt = 650) {
    const X = this.X;
    return { name: 'LIFTOFF', step: () => {
      const o = X.find(id), s = this.s; if (!o?.surface) return true;
      if (s.landed) X.liftoff();
      const info = X.surfaceInfo(o), vRel = s.vel.clone().sub(o.body.vel);
      this.setAcc(info.n.clone().multiplyScalar(clamp((alt - info.alt) * 0.2 + 1, 0, 25)).sub(vRel).multiplyScalar(1.2));
      this.cmd.quat = new THREE.Quaternion().setFromUnitVectors(s.up(), info.n).multiply(s.quat);
      return info.alt >= alt;
    } };
  }
  /** move over the surface by `arc` metres (measured on the ground) and hover there, ready to land again */
  hop(id, arc = 4200, alt = 1100) {
    const X = this.X; let dir = null;
    return { name: 'SURFACE HOP', step: () => {
      const o = X.find(id), s = this.s; if (!o?.surface) return true;
      if (s.landed) X.liftoff();
      if (!dir) { const n = s.pos.clone().sub(o.body.pos), R = n.length(); n.normalize(); const t = V().crossVectors(n, V(0, 0, 1)).normalize(); dir = n.multiplyScalar(Math.cos(arc / R)).addScaledVector(t, Math.sin(arc / R)).normalize(); }
      // the ground under the destination, from the body's own shape
      const R = o.surface(dir.clone().applyQuaternion(o.mesh.quaternion.clone().invert())) + alt;
      const r = this.steerTo(o.body.pos.clone().addScaledVector(dir, R), o.body.vel, { vmax: 70, body: o.body });
      const info = X.surfaceInfo(o);
      if (info.alt < 450) this.cmd.acc.addScaledVector(info.n, this.maxAcc() * 0.6 * (1 - info.alt / 450)); // terrain clearance on the way
      this.cmd.quat = new THREE.Quaternion().setFromUnitVectors(s.up(), info.n).multiply(s.quat);
      return r.d < 120 && r.v < 4;
    } };
  }
  /** a waypoint relative to a body, fixed in direction when the task starts: side = 1 goes abeam, -1 goes behind it */
  around(id, side, range) {
    const X = this.X; let dir = null;
    return this.via('FAR SIDE PASS', () => {
      const o = X.find(id), s = this.s;
      if (!dir) { const n = s.pos.clone().sub(o.body.pos).normalize(); dir = side > 0 ? V().crossVectors(n, V(0, 0, 1)).normalize() : n.negate(); }
      return { pos: o.body.pos.clone().addScaledVector(dir, range), vel: o.body.vel, body: o.body };
    }, { vmax: 300, tol: 1500, pass: true, boost: true });
  }
  /** Saturn: hold a height above the ring plane (the boulders live within ±100 m of it) */
  ringAlt(y, tol = 8) {
    return { name: `RING PLANE · ${y >= 0 ? '+' : ''}${y} m`, step: () => {
      const s = this.s, vy = clamp((y - s.pos.y) * 0.35, -12, 12);
      this.setAcc(V(0, (vy - s.vel.y) * 1.2, 0));
      this.cmd.dir = s.vel.clone().normalize();
      return Math.abs(s.pos.y - y) < tol;
    } };
  }

  /** burn at an apsis ('now' | 'pe' | 'ap') until the opposite apsis sits at `alt` */
  burn(when, alt, label = '') {
    const X = this.X; let phase = when === 'now' ? 1 : 0, t = 0, said = false;
    const name = `${when === 'now' ? 'BURN' : `BURN AT ${when === 'pe' ? 'PERIAPSIS' : 'APOAPSIS'}`} · ${label || fmt.km(alt)}`;
    return { name, step: (dt) => {
      const s = this.s, L = this.L, r = s.pos.length(), v = s.vel.length(), vh = s.vel.clone().multiplyScalar(1 / v);
      const rT = L.R + alt, dv = Math.sqrt((2 * L.mu * rT) / (r * (r + rT))) - v, sign = dv >= 0 ? 1 : -1;
      this.cmd.dir = vh.clone().multiplyScalar(sign);
      if (phase === 0) {
        const tau = apsisTime(s.pos, s.vel, L.mu, when);
        if (!said) { said = true; this.say(`Coasting to ${when === 'pe' ? 'periapsis' : 'apoapsis'}. ${fmt.n(tau / 60, 0)} minutes. Warping.`, 2); }
        if (tau < 3 || tau === Infinity) { phase = 1; X.warpI = 0; this.task.keepWarp = false; }
        else { X.warpI = tau > 1500 ? 3 : tau > 150 ? 2 : tau > 15 ? 1 : 0; this.task.keepWarp = true; }
        return false;
      }
      t += dt;
      if (phase === 1) { if ((s.sasErr != null && s.sasErr < 0.06) || t > 14) { phase = 2; this.say(`${sign > 0 ? 'Prograde' : 'Retrograde'} burn. ${fmt.n(Math.abs(dv), 0)} metres per second.`, 2); } return false; }
      const big = Math.abs(dv) > 350;
      this.setAcc(vh.multiplyScalar(clamp(dv * 1.2, -this.maxAcc(big), this.maxAcc(big))), big);
      if (Math.abs(dv) < 0.25) { const o = X.orb(); this.say(`Cutoff. Periapsis ${this.dist(o.altPe)}, apoapsis ${this.dist(o.altAp)}.`, 2); return true; }
      return false;
    } };
  }
  coast(to) {
    const X = this.X; let said = false;
    return { name: `COAST · ${to === 'pe' ? 'PERIAPSIS' : 'APOAPSIS'}`, keepWarp: true, step: () => {
      const s = this.s, tau = apsisTime(s.pos, s.vel, this.L.mu, to);
      if (!said) { said = true; this.say(`Coasting to ${to === 'pe' ? 'periapsis' : 'apoapsis'}.`, 2); }
      this.cmd.dir = s.vel.clone().normalize();
      X.warpI = tau > 1500 ? 3 : tau > 150 ? 2 : tau > 15 ? 1 : 0;
      return tau < 3;
    } };
  }

  /** Gargantua: fly in polar coordinates. Tangential speed tracks the local circular speed so the radial channel is cheap. */
  bh(rGoal, o = {}) {
    const X = this.X, GM = 0.5;
    return { name: `${this.s.pos.length() > rGoal ? 'DESCEND' : 'CLIMB'} · ${rGoal} r_s`, step: () => {
      const s = this.s, r = s.pos.length(), rh = s.pos.clone().multiplyScalar(1 / r);
      const vr = s.vel.dot(rh), vtV = s.vel.clone().addScaledVector(rh, -vr), vt = vtV.length();
      const th = vt > 1e-3 ? vtV.multiplyScalar(1 / vt) : V().crossVectors(V(0, 1, 0), rh).normalize();
      const near = r < 14, vtGoal = near ? Math.min(0.55, Math.sqrt(GM * r) / (r - 1)) : 0;
      const rd = clamp((rGoal - r) * 0.3, -(o.rdot ?? 0.3), o.rdot ?? 0.3);
      const acc = rh.clone().multiplyScalar((rd - vr) * 1.6 + GM / ((r - 1) * (r - 1)) - (vt * vt) / r).addScaledVector(th, (vtGoal - vt) * (near ? 1.2 : 0.3));
      if (!near && acc.length() < 0.2 * s.p.accel) { X.warpI = 1; this.task.keepWarp = true; } else { this.task.keepWarp = false; this.setAcc(acc, true); }
      this.cmd.dir = near ? th : rh.clone().multiplyScalar(Math.sign(rGoal - r) || 1);
      return o.done ? o.done(r) : Math.abs(r - rGoal) < 0.15;
    } };
  }
  plunge() {
    const X = this.X;
    return { name: 'INTO THE HORIZON', step: () => {
      const s = this.s, r = s.pos.length(), d = s.pos.clone().multiplyScalar(-1 / r);
      // get up to half the speed of light straight down, then let the hole do the rest (warping the long fall)
      const acc = d.clone().multiplyScalar(0.5 * C_GAME).sub(s.vel).multiplyScalar(2);
      if (acc.length() < 0.3 * s.p.accel || r < 6) { this.task.keepWarp = r > 20; if (r > 20) X.warpI = 1; } else { this.task.keepWarp = false; this.setAcc(acc, true); }
      this.cmd.dir = d;
      if (r < 12) this.once('plunge', 'No signal comes back from here. I am recording everything.', 120, 2);
      return false;
    } };
  }

  /** launch: the location owns the guidance law (and presses Space to stage) */
  ascent() {
    const X = this.X; let lastPitch = 90, said = false;
    return { name: 'ASCENT GUIDANCE', keepWarp: true, step: () => {
      const g = this.L.guide(this.s, X);
      if (g.dir) this.cmd.dir = g.dir;
      this.cmd.thr = g.thr ?? 0;
      if (g.pitch != null) { const p = Math.round((g.pitch * DEG) / 10) * 10; if (p < lastPitch && p >= 0) { lastPitch = p; this.say(`Pitch ${p} degrees.`, 1); } }
      if (g.done && !said) { said = true; const o = X.orb(); this.say(`Engine cutoff. Orbit achieved: ${this.dist(o.altPe)} by ${this.dist(o.altAp)}.`, 3); }
      return !!g.done && !!this.L.flags.sep;
    } };
  }

  // tesseract
  fragments() {
    const X = this.X;
    return { name: 'COLLECT QUANTUM DATA', step: () => {
      const s = this.s, left = X.targets().filter((p) => p.frag);
      if (!left.length) return true;
      const p = left.reduce((a, b) => (a.pos.distanceTo(s.pos) < b.pos.distanceTo(s.pos) ? a : b));
      this.select(p);
      this.steerTo(p.pos, ZERO, { vmax: 16, vmin: 2, kv: 1.5, boost: true });
      this.cmd.dir = p.pos.clone().sub(s.pos).normalize();
      return false;
    } };
  }
  moment() {
    const X = this.X;
    return { name: 'TO THE MOMENT', step: () => {
      const w = this.L.window; this.select(w);
      const r = this.steerTo(w.pos, ZERO, { vmax: 16, kv: 1.5, boost: true });
      this.cmd.dir = V(0, 0, -1);
      return r.d < 1.5 && r.v < 0.4;
    } };
  }
  transmit() {
    const X = this.X; let pressed = -1, n = 0;
    return { name: 'TRANSMIT', step: (dt) => {
      const L = this.L, w = L.window;
      this.steerTo(w.pos, ZERO, { vmax: 4, kv: 2 }); this.cmd.dir = V(0, 0, -1);
      if (L.txOpen) { if (pressed !== n) { pressed = n; X.handleKey(' '); } } else n = pressed + 1;
      return (L.flags.sent || 0) >= 10;
    } };
  }

  // -------------------------------------------------------------------------------------------- talking
  report() {
    const X = this.X, s = this.s, L = this.L;
    const tg = X.targets()[X.tgtI % X.targets().length], pos = X.tpos(tg), d = pos.distanceTo(s.pos);
    const rel = s.vel.clone().sub(tg.body ? tg.body.vel : ZERO), closing = rel.dot(pos.clone().sub(s.pos).normalize());
    const sp = L.units === 'rs' ? `${fmt.n(Math.abs(closing) / C_GAME, 2)} c` : `${fmt.n(Math.abs(closing), Math.abs(closing) < 10 ? 1 : 0)} metres per second`;
    let t = `Target ${tg.name.toLowerCase()}, ${this.dist(d)}, ${closing > 0 ? 'closing' : 'opening'} at ${sp}. `;
    if (L.mu && !L.launch) { const o = X.orb(); t += `Orbit ${this.dist(o.altPe)} by ${o.altAp === Infinity ? 'escape' : this.dist(o.altAp)}. `; }
    t += L.launch ? `${s.stageName} at ${fmt.n(s.fuel * 100, 0)} percent. ` : `Propellant ${fmt.n(s.fuel * 100, 0)} percent, hull ${fmt.n((s.hull / X.def.hull) * 100, 0)} percent. `;
    if (L.clock) t += `Time dilation ${fmt.n(L.clock.dil ?? 1, 2)}. `;
    this.say(t + (this.on ? `I am flying: ${this.task?.name.toLowerCase() || 'standing by'}.` : ''), 3);
  }
  hint() {
    const X = this.X, i = X.mission ? X.done.indexOf(false) : -1, o = i >= 0 ? X.objectives[i] : null;
    if (o) this.say(`${o.hint || o.text.replace(/\s*\(.*?\)/g, '').trim()}. ${o.auto ? 'Or press Enter and I will fly it.' : ''}`, 3);
    else if (this.L.launch) this.say('Press space for ignition. Climb straight up, then ease the nose east and follow the prograde marker. Space again to stage. Or press Enter and I will fly it.', 3);
    else this.say('Free roam. Tab picks a target. Press Enter and I will take us there: I dock with stations, land on moons and fly through wormholes.', 3);
  }

  /** speech recognition result: a list of alternative transcripts */
  heard(alts) {
    if (now() < this.voice.quietUntil) return; // that was me talking
    const X = this.X, s = this.s; if (!X.active || !s) return;
    const key = (k) => X.handleKey(k);
    const thr = (v) => { if (this.on) this.disengage(null); s.throttle = v; this.say(v === 0 ? 'Engines off.' : `Throttle ${fmt.n(v * 100, 0)} percent.`, 2); };
    const sas = (n, name) => { if (this.on) this.disengage(null); key(String(n)); this.say(`Holding ${name}.`, 2); };
    const CMDS = [
      [/\bundock\b/, () => key('u')],
      [/\b(disengage|manual|i have control|i('ll| will) take it|my ship|cancel|abort|autopilot off|stop autopilot|stand down)\b/, () => (this.on ? this.disengage() : this.say('You already have control.', 2))],
      [/\b(dock|docking)\b/, () => this.engage('dock')],
      [/\b(land|landing|touch ?down|set (us|her) down)\b/, () => this.engage('land')],
      [/\b(launch|ignition|lift ?off|light (it|them|the engines))\b/, () => key(' ')],
      [/\b(stage|staging|separate|separation|transmit|pulse)\b/, () => key(' ')],
      [/\b(auto ?pilot|take over|take the (wheel|stick|controls?)|you have control|your ship|fly (it|us|the mission|the contract)|engage)\b/, () => this.engage('auto')],
      [/\b(approach|go to|fly to|take (us|me) to|intercept|rendezvous)\b/, () => this.engage('approach')],
      [/\b(match|kill|null|zero) (the )?(velocity|speed|drift)\b|\bbrake\b|\bfull stop\b|\bhold position\b/, () => this.engage('brake')],
      [/\bretro ?grade\b/, () => sas(2, 'retrograde')], [/\bpro ?grade\b/, () => sas(1, 'prograde')],
      [/\b(point|face|aim|look) (at|to|toward) (the )?target\b|\btarget hold\b/, () => sas(3, 'the target')], [/\bradial\b/, () => sas(5, 'radial out')],
      [/\b(full|max|maximum) (throttle|thrust|power|burn)\b|\bpunch it\b|\bgo for burn\b/, () => thr(1)],
      [/\b(cut|kill|stop|zero) (the )?(engines?|throttle|thrust|burn)\b|\bengines? off\b|\bshut ?down\b/, () => thr(0)],
      [/\b(?:throttle|thrust|power)(?: to| at)? (\d{1,3}|zero|ten|twenty|thirty|forty|fifty|half|sixty|seventy|eighty|ninety|hundred|full)\b/, (m) => thr(clamp((NUM[m[1]] ?? +m[1]) / 100))],
      [/\b(next|cycle|switch|change) target\b/, () => key('tab')],
      [/\bscan\b/, () => key('b')], [/\b(flood)?lights?\b/, () => key('l')], [/\b(orbit )?map\b/, () => key('m')],
      [/\b(camera|change view|next view|cockpit)\b/, () => key('c')], [/\b(photo|photograph|picture|snapshot)\b/, () => key('k')],
      [/\b(faster|time warp|warp|speed up)\b/, () => key('.')], [/\b(slower|normal time|real ?time)\b/, () => key(',')],
      [/\b(status|report|where are we|situation)\b/, () => this.report()],
      [/\b(help|hint|guide me|what (now|next)|what (do|should) i do)\b/, () => this.hint()],
      [/\b(restart|start over|try again)\b/, () => key('p')],
      [/\bthank(s| you)\b/, () => this.say('Any time.', 2)],
      [/\b(hello|hi|hey) tars\b|\bare you there\b/, () => this.say('Here. All systems nominal.', 2)],
    ];
    for (const text of alts) {
      // "target hubble" / "select the endurance": pick a target by name
      const m = text.match(/\b(?:target|select|lock (?:on|onto))\s+(?:the\s+)?([a-z' ]+)/);
      if (m) { const o = X.targets().find((t) => m[1].includes(t.name.toLowerCase().split(' ')[0])); if (o) { this.select(o); this.say(`Target ${o.name.toLowerCase()}.`, 2); return; } }
      for (const [re, fn] of CMDS) { const hit = text.match(re); if (hit) { X.feed(`“${text}”`, 'voice command'); fn(hit); return; } }
    }
    X.feed(`“${alts[0]}”`, 'not understood');
  }
}
