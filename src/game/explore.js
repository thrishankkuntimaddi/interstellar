import * as THREE from 'three';
import { Ship, FlightCamera, SAS_MODES } from './flight.js';
import { LOCATIONS, C_GAME, orbitalElements } from './locations.js';
import { EngineSound } from './sfx.js';
import { createRcsJets, createDust, createPlasma } from './gfx.js';
import { career, onCareer, addXp, award, stat, mark, completeMission, unlocked, locationUnlocked, rankInfo } from './career.js';
import { MISSIONS, CODEX, LOCATION_INFO, locInfo, missionKey, ALL_MISSION_KEYS } from './missions.js';
import { shipDef, SHIPS } from '../world/fleet.js';
import { createCockpit } from '../world/ships.js';
import { createExplosion } from '../world/fx.js';
import { settings } from '../core/settings.js';
import { drawSystem, RS_KM } from '../chapters/gsys.js';
import { fmt, hohmann } from '../data/astro.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const WARPS = [1, 10, 100, 1000];
const ORBIT_AU = { earth: 1, moon: 1, mars: 1.524, jupiter: 5.203, saturn: 9.537 };
const KEY_HINT = '[W/S] engines · [Shift] boost · [A/D R/F] RCS · [Q/E] roll · [X] match velocity · [1–6] autopilot hold · [0] off · [Tab] target · [B] scan<br>[M] orbit map · [N] nav computer · [T , .] time warp · [ [ ] ] throttle · [Z] full · [Bksp] cut · [C] camera · [L] lights · [K] photo · [J] contracts · [P] restart · [Esc] menu';
const _q = new THREE.Quaternion();

export class Explore {
  constructor(ctx) {
    this.ctx = ctx; this.active = false; this.loc = null; this.t = 0; this.warpI = 0; this.tgtI = 0;
    this.fade = 0; this.fadeTarget = 0; this.heat = 0; this.wantShot = false;
    this.cockpit = createCockpit(); this.cockpitScene = new THREE.Scene(); this.cockpitScene.add(this.cockpit);
    this.cockpitLayer = { scene: this.cockpitScene, near: 0.05, far: 20, visible: false };
    this.cam = new FlightCamera(ctx.engine.camera, ctx.engine.canvas);
    this.padKeys = new Set(); this.padPrev = [];
    this.input = { down: (k) => ctx.input.down(k) || this.padKeys.has(k) };
    this.buildDom();
    document.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== ctx.engine.canvas || !this.ship) return;
      const k = settings.mouseSens / 320;
      const m = this.ship.mouse; m.x += e.movementX * k; m.y += e.movementY * k;
      const l = Math.hypot(m.x, m.y); if (l > 1) { m.x /= l; m.y /= l; }
    });
    ctx.engine.canvas.addEventListener('click', () => { if (this.active && this.cam.mode !== 2 && !ctx.menu.visible) ctx.engine.canvas.requestPointerLock?.(); });
    onCareer((e) => {
      if (e.type === 'xp') this.feed(`+${e.amount} XP`, e.why);
      else if (e.type === 'rank') { this.feed(`RANK UP · ${e.name}`, 'new ships and worlds may be available', 'rank'); this.sfx?.ping(660, 0.5, 0.25); this.sfx?.ping(990, 0.6, 0.2, 0.18); }
      else if (e.type === 'ach') { this.feed(`ACHIEVEMENT · ${e.name}`, e.desc, 'ach'); this.sfx?.ping(1320, 0.35, 0.18); }
    });
  }

  buildDom() {
    const f = document.createElement('div'); f.id = 'flight'; f.className = 'hidden';
    f.innerHTML = `<div class="cross"></div><div id="stick" class="fmark pro" style="left:50%;top:50%"><div class="box" style="width:6px;height:6px;border-radius:50%"></div></div><div id="marks"></div>
      <div id="fl-warn"></div>
      <div id="fl-status">
        <div class="fl-bar"><span>Δv</span><div class="bar"><i id="fl-fuel"></i></div><b id="fl-fuel-t"></b></div>
        <div class="fl-bar"><span>HULL</span><div class="bar"><i id="fl-hull"></i></div><b id="fl-hull-t"></b></div>
        <div class="fl-bar"><span>THR</span><div class="bar"><i id="fl-thr"></i></div><b id="fl-thr-t"></b></div>
        <div id="fl-modes"></div>
      </div>
      <div id="fl-keys">${KEY_HINT}</div>
      <div id="fl-feed"></div>
      <canvas id="fl-map" width="760" height="760" class="hidden"></canvas>
      <div id="fl-nav" class="hidden"></div>
      <div id="fl-result" class="hidden"></div>`;
    document.body.appendChild(f);
    const ob = document.createElement('div'); ob.id = 'objectives'; document.getElementById('hud').appendChild(ob);
    const toast = document.createElement('div'); toast.id = 'toast'; document.body.appendChild(toast);
    const q = (s) => f.querySelector(s);
    this.dom = { f, marks: q('#marks'), stick: q('#stick'), ob, toast, warn: q('#fl-warn'), fuel: q('#fl-fuel'), fuelT: q('#fl-fuel-t'), hull: q('#fl-hull'), hullT: q('#fl-hull-t'),
      thr: q('#fl-thr'), thrT: q('#fl-thr-t'), modes: q('#fl-modes'), feed: q('#fl-feed'), map: q('#fl-map'), nav: q('#fl-nav'), result: q('#fl-result') };
    this.dom.mapCtx = this.dom.map.getContext('2d');
    this.markEls = new Map();
    this.mapOpen = false; this.navOpen = false;
  }

  toast(text, sub = '', color = '', ms = 3500) {
    const t = this.dom.toast; t.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`; t.style.color = color; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms);
  }
  feed(text, sub = '', cls = '') {
    const el = document.createElement('div'); el.className = `fd ${cls}`; el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.dom.feed.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 600); }, cls ? 6000 : 3200);
    while (this.dom.feed.children.length > 5) this.dom.feed.firstChild.remove();
  }

  /** keep: { fuel, hull } carried from the previous location (wormhole transit) */
  async start(id, missionId = null, keep = null) {
    const { engine, hud, audio } = this.ctx;
    if (!LOCATIONS[id]) id = 'earth';
    this.stop(false);
    this.toast('LOADING', locInfo(id).name.toUpperCase(), '', 1500);
    await new Promise((r) => setTimeout(r, 30));
    let def = shipDef(career.ship); if (!unlocked(def.rank)) def = SHIPS[0];
    const loc = LOCATIONS[id](this.ctx, def);
    this.loc = loc; this.locId = id; this.def = def;
    this.flags = {}; loc.flags = this.flags;
    const s = (this.ship = new Ship(def, loc.shipParams, loc.units === 'rs' ? (2.4 * def.dv) / 12000 : def.dv));
    s.pos.copy(loc.ship.pos); s.vel.copy(loc.ship.vel); s.quat.copy(loc.ship.quat);
    if (keep) { s.fuel = keep.fuel; s.hull = Math.min(def.hull, keep.hull); }
    this.start0 = { pos: loc.ship.pos.clone(), vel: loc.ship.vel.clone(), quat: loc.ship.quat.clone() };
    // effects that travel with the ship
    this.jets = createRcsJets(loc.ranger.userData.rcs || [], def.size); loc.ranger.add(this.jets);
    this.dust = createDust(); this.plasma = createPlasma(def.radius); this.boom = createExplosion({ scale: def.radius * 0.9, debris: 90 });
    loc.fg.add(this.dust, this.plasma, this.boom);
    this.t = 0; this.warpI = 0; this.tgtI = 0; this.crash = null; this.scans = new Set(); this.respawns = 0; this.heatPeak = 0; this.lastMission = null; this.boomT = null;
    this.setMission(missionId, false);
    this.cam.scale = def.size; this.cam.zoom = 1; this.cam.setMode(0);
    this.closeOverlays();
    try { await engine.precompile(loc.layers.map((L) => L.scene)); } catch { /* compile lazily */ }
    this.active = true;
    hud.el.classList.add('explore');
    hud.kicker.textContent = loc.kicker; hud.title.textContent = loc.name;
    this.dom.f.classList.remove('hidden');
    audio.el.loop = true;
    audio.seek(loc.music);
    try { await audio.start(); } catch { /* autoplay */ }
    if (!this.sfx && audio.ctx) this.sfx = new EngineSound(audio.ctx);
    stat('flights'); mark('visited', id); mark('flown', def.id); career.unlockedLoc[id] = 1;
    award('firstFlight');
    if (LOCATION_INFO.every((l) => career.visited[l.id])) award('tourist');
    if (SHIPS.every((x) => career.flown[x.id])) award('fleet');
    this.toast(loc.name.toUpperCase(), `${def.name} · click to fly with the mouse · Esc for menu`);
  }

  setMission(missionId, announce = true) {
    this.mission = MISSIONS[this.locId]?.find((m) => m.id === missionId) || null;
    this.objectives = this.mission ? this.mission.objectives : [];
    this.done = this.objectives.map(() => false);
    this.mt = 0; this.respawns = 0; this.flags && Object.keys(this.flags).forEach((k) => delete this.flags[k]);
    this.scans?.clear();
    if (announce || this.mission) this.dom.result.classList.add('hidden');
    this.renderObjectives();
    if (announce) this.toast(this.mission ? `CONTRACT · ${this.mission.name.toUpperCase()}` : 'FREE ROAM', this.mission ? this.mission.brief : 'no active contract', '#ffd49a', 5000);
  }

  stop(full = true) {
    this.active = false;
    if (this.loc) {
      for (const L of this.loc.layers) L.scene.traverse((o) => { o.geometry?.dispose?.(); });
      this.loc = null;
    }
    if (full) {
      this.dom.f.classList.add('hidden');
      this.ctx.hud.el.classList.remove('explore');
      this.dom.ob.innerHTML = '';
      this.sfx?.set(0, 0);
      if (document.pointerLockElement) document.exitPointerLock();
      this.ctx.audio.el.loop = false;
      this.fade = this.fadeTarget = 0; this.heat = 0;
      this.closeOverlays();
    }
  }

  overlayOpen() { return this.mapOpen || this.navOpen; }
  closeOverlays() { this.mapOpen = this.navOpen = false; this.dom.map.classList.add('hidden'); this.dom.nav.classList.add('hidden'); }

  targets() { const L = this.loc; return L.objs.length ? L.objs : L.points; }
  tpos(o) { return o.body ? o.body.pos : o.pos; }
  find(id) { return this.targets().find((x) => x.id === id); }
  dist(id) { const o = this.find(id); return o ? this.tpos(o).distanceTo(this.ship.pos) : Infinity; }
  scanned(id) { return this.scans.has(id); }
  /** Orbit around the central body: altitudes in metres. */
  orb() {
    const L = this.loc, s = this.ship;
    if (!L.mu) return { alt: Infinity, altPe: Infinity, altAp: Infinity, e: 0, period: Infinity };
    const el = orbitalElements(s.pos, s.vel, L.mu);
    return { alt: s.pos.length() - L.R, altPe: el.rp - L.R, altAp: el.ra - L.R, e: el.e, period: el.period };
  }
  surfaceInfo(o) {
    const s = this.ship;
    const rel = s.pos.clone().sub(o.body.pos), dist = rel.length();
    const local = rel.clone().applyQuaternion(_q.copy(o.mesh.quaternion).invert());
    const R = o.surface(local);
    return { alt: dist - R - s.def.gear, n: rel.multiplyScalar(1 / dist), local, R };
  }
  surfaceAlt(id) { const o = this.find(id); return o?.surface ? this.surfaceInfo(o).alt : Infinity; }

  handleKey(k) {
    if (!this.active) return false;
    const s = this.ship, L = this.loc;
    if (this.navOpen) {
      if (k === 'n' || k === 'escape') { this.closeOverlays(); return true; }
      const i = parseInt(k, 10); if (i >= 1 && this.navRows?.[i - 1]?.ok) this.travel(this.navRows[i - 1]);
      return true;
    }
    if (k === 'escape' && this.mapOpen) { this.closeOverlays(); return true; }
    if (k === 'tab') { this.tgtI = (this.tgtI + 1) % this.targets().length; this.sfx?.ping(520, 0.06, 0.08); return true; }
    if (k === 'c') { this.cam.cycle(); if (this.cam.mode === 2) { this.ctx.engine.camera.position.applyQuaternion(s.quat); if (document.pointerLockElement) document.exitPointerLock(); } return true; }
    if (k === 'v') { s.fa = !s.fa; this.toast(`FLIGHT ASSIST ${s.fa ? 'ON' : 'OFF'}`, s.fa ? 'rotation damped' : 'pure Newtonian rotation', '', 1500); return true; }
    if (k === 't' || k === '.') { this.warpI = k === 't' ? (this.warpI + 1) % WARPS.length : Math.min(WARPS.length - 1, this.warpI + 1); this.toast(`TIME WARP ×${WARPS[this.warpI]}`, 'applies while coasting', '', 1200); return true; }
    if (k === ',') { this.warpI = Math.max(0, this.warpI - 1); this.toast(`TIME WARP ×${WARPS[this.warpI]}`, '', '', 1200); return true; }
    if (k === 'u' && s.docked) { const ax = s.def.dockAxis.clone().applyQuaternion(s.quat); s.docked = null; s.vel.addScaledVector(ax, -0.3); this.toast('UNDOCKED', '', '', 1500); this.sfx?.thud(0.3); return true; }
    if (k === 'p') { this.respawn(true); return true; }
    if (k >= '0' && k <= '6') { s.sas = +k; this.sfx?.ping(700, 0.05, 0.08); this.toast(`AUTOPILOT · ${SAS_MODES[s.sas]}`, s.sas ? 'holds attitude · moving the stick overrides' : '', '', 1300); return true; }
    if (k === ']') { s.throttle = clamp(Math.round(s.throttle * 10 + 1) / 10); return true; }
    if (k === '[') { s.throttle = clamp(Math.round(s.throttle * 10 - 1) / 10); return true; }
    if (k === 'z') { s.throttle = s.throttle >= 1 ? 0 : 1; return true; }
    if (k === 'backspace') { s.throttle = 0; return true; }
    if (k === 'l') { s.lights = !s.lights; this.toast(`FLOODLIGHTS ${s.lights ? 'ON' : 'OFF'}`, '', '', 1000); return true; }
    if (k === 'b') { this.scan(); return true; }
    if (k === 'k') { this.wantShot = true; return true; }
    if (k === 'm') {
      if (!L.mu) { this.toast('ORBIT MAP', 'not available here — use the system chart, bottom right', '', 2000); return true; }
      this.mapOpen = !this.mapOpen; this.dom.map.classList.toggle('hidden', !this.mapOpen); return true;
    }
    if (k === 'n') { this.openNav(); return true; }
    if (k === 'j') {
      const ms = MISSIONS[this.locId] || []; const i = ms.indexOf(this.mission);
      this.respawn(false); this.setMission(ms[i + 1]?.id || null); return true;
    }
    return ['w', 'a', 's', 'd', 'r', 'f', 'q', 'e', 'x', 'shift'].includes(k);
  }

  respawn(countIt = false) {
    const s = this.ship;
    s.pos.copy(this.start0.pos); s.vel.copy(this.start0.vel); s.quat.copy(this.start0.quat); s.w.set(0, 0, 0); s.docked = null; s.landed = null;
    s.refill(); s.throttle = 0; s.sas = 0; s.heat = 0;
    this.loc.ranger.visible = true; this.boomT = null; this.boom.userData.update(-1);
    if (this.loc.clock) { this.loc.clock.minR = 1e9; }
    if (countIt) {
      const again = this.mission || (!this.dom.result.classList.contains('hidden') ? this.lastMission : null);
      if (again) this.setMission(again.id, false); this.respawns = again ? 0 : this.respawns + 1; this.toast('RESTART', this.mission ? 'contract timer reset' : '', '', 1500);
    }
  }

  fail(msg, { title = 'SPACECRAFT LOST', color = '#ff7a4d', t = 4, explode = true } = {}) {
    if (this.crash) return;
    this.crash = { t }; this.respawns++;
    stat('crashes');
    this.toast(title, msg, color, t * 1000);
    if (explode) { this.boomT = 0; this.loc.ranger.visible = false; this.cam.kick(2.5); this.sfx?.thud(1); }
    this.ship.throttle = 0; this.ship.sas = 0;
  }

  scan() {
    const tg = this.targets()[this.tgtI % this.targets().length], s = this.ship;
    const d = this.tpos(tg).distanceTo(s.pos), range = tg.scan ?? tg.radius * 8;
    const info = CODEX[tg.id];
    if (!info) { this.toast('NOTHING TO SCAN', '', '', 1200); return; }
    if (d > range) { this.toast('OUT OF SCANNER RANGE', `${tg.name}: close to within ${this.loc.units === 'rs' ? `${range} r_s` : fmt.km(range)}`, '#ff7a4d', 2200); this.sfx?.ping(220, 0.2, 0.12); return; }
    this.scans.add(tg.id);
    this.sfx?.ping(880, 0.12, 0.14); this.sfx?.ping(1320, 0.2, 0.12, 0.12);
    this.toast(`SCAN · ${info[0]}`, info[1], '#9fc4ff', 6500);
    if (mark('codex', tg.id)) { addXp(50, 'new codex entry'); const n = Object.keys(career.codex).length; if (n >= 5) award('scan5'); if (n >= Object.keys(CODEX).length) award('scanAll'); }
  }

  // ------------------------------------------------------------------ nav computer
  openNav() {
    const here = this.locId;
    this.navRows = LOCATION_INFO.filter((l) => l.id !== here).map((l) => {
      let ok = locationUnlocked(l), note = '';
      if (here === 'gargantua') { ok = false; note = 'another galaxy — return through the wormhole'; }
      else if (l.id === 'gargantua') { ok = false; note = 'reachable only through the wormhole at Saturn'; }
      else if (!ok) note = `locked · requires rank ${l.rank}`;
      else {
        const a1 = ORBIT_AU[here], a2 = ORBIT_AU[l.id];
        if (a1 === a2) note = '384,400 km · 3-day coast · Δv 3.9 km/s';
        else { const h = hohmann(a1, a2); note = `${fmt.n(Math.abs(a2 - a1), 2)} AU · Hohmann transfer ${h.tofYears < 1 ? `${fmt.n(h.tofYears * 365.25, 0)} days` : `${fmt.n(h.tofYears, 1)} years`} · Δv ${fmt.n((Math.abs(h.dv1) + Math.abs(h.dv2)) / 1000, 1)} km/s`; }
      }
      return { ...l, ok, note };
    });
    this.dom.nav.innerHTML = `<div class="panel-title">NAV COMPUTER · INTERPLANETARY TRANSFER</div>` +
      this.navRows.map((r, i) => `<div class="nv ${r.ok ? '' : 'off'}"><kbd>${i + 1}</kbd><div><b>${r.name.toUpperCase()}</b><small>${r.note}</small></div></div>`).join('') +
      `<div class="nv-foot">A transfer stage carries you there and tops up your tanks. Press a number to depart · [N] close</div>`;
    this.navOpen = true; this.mapOpen = false; this.dom.map.classList.add('hidden'); this.dom.nav.classList.remove('hidden');
  }
  travel(row) {
    this.closeOverlays(); this.active = false; this.fadeTarget = 1;
    this.toast(`TRANSFER · ${row.name.toUpperCase()}`, row.note, '#9fc4ff', 5000);
    this.sfx?.set(1, 0, 1);
    award('transfer');
    setTimeout(async () => { this.sfx?.set(0, 0); await this.start(row.id); this.fadeTarget = 0; }, 1900);
  }
  portal(to) {
    const { engine } = this.ctx, s = this.ship;
    engine.fx.uWhite.value = 1;
    this.flags.portal = true; this.checkObjectives();
    award('wormhole');
    this.toast('WORMHOLE TRANSIT', to === 'gargantua' ? 'emerging in another galaxy…' : 'back to Saturn…', '#9fc4ff', 3000);
    this.start(to, null, { fuel: s.fuel, hull: s.hull });
  }

  // ------------------------------------------------------------------ frame
  pollPad() {
    this.padKeys.clear();
    const s = this.ship; s.stick.x = s.stick.y = 0;
    if (!settings.gamepad || !navigator.getGamepads) return;
    const gp = [...navigator.getGamepads()].find((g) => g && g.connected && g.mapping === 'standard'); if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.14 ? 0 : v), B = (i) => gp.buttons[i]?.pressed || gp.buttons[i]?.value > 0.3;
    s.stick.x = dz(gp.axes[0]); s.stick.y = dz(gp.axes[1]);
    if (gp.axes[2] > 0.4) this.padKeys.add('d'); if (gp.axes[2] < -0.4) this.padKeys.add('a');
    if (gp.axes[3] > 0.4) this.padKeys.add('f'); if (gp.axes[3] < -0.4) this.padKeys.add('r');
    const hold = { 7: 'w', 6: 's', 4: 'q', 5: 'e', 0: 'shift', 2: 'x' };
    for (const i in hold) if (B(+i)) this.padKeys.add(hold[i]);
    const tap = { 3: 'tab', 1: 'c', 12: '.', 13: ',', 8: 'm', 10: 'b', 11: 'l' };
    for (const i in tap) { const on = !!B(+i); if (on && !this.padPrev[i]) this.handleKey(tap[i]); this.padPrev[i] = on; }
    for (const [i, d] of [[14, -1], [15, 1]]) { const on = !!B(i); if (on && !this.padPrev[i]) this.handleKey(String((s.sas + d + 7) % 7)); this.padPrev[i] = on; }
  }

  update(dt) {
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 2.5);
    if (!this.active || !this.loc) return;
    const { engine, hud } = this.ctx;
    const L = this.loc, s = this.ship, def = this.def;
    this.t += dt; this.mt += dt; stat('time', dt);
    this.pollPad();
    const tg = this.targets()[this.tgtI % this.targets().length];
    const tPos = this.tpos(tg), tVel = tg.body ? tg.body.vel : V();
    const relVel = s.vel.clone().sub(tVel);
    const toT = tPos.clone().sub(s.pos); const dRaw = toT.length(); toT.multiplyScalar(1 / Math.max(dRaw, 1e-9));
    // autopilot attitude hold
    let sasDir = null;
    if (s.sas && !s.docked && !s.landed) {
      if (s.sas === 1 || s.sas === 2) { if (s.vel.lengthSq() > 1e-12) sasDir = s.vel.clone().normalize().multiplyScalar(s.sas === 1 ? 1 : -1); }
      else if (s.sas === 3) sasDir = toT.clone();
      else if (s.sas === 4) sasDir = toT.clone().negate();
      else if (s.sas === 5) sasDir = s.pos.clone().normalize();
      else if (s.sas === 6 && relVel.lengthSq() > 1e-10) sasDir = relVel.clone().normalize().negate();
    }
    // controls + physics
    if (this.crash) {
      this.crash.t -= dt; s.w.multiplyScalar(0.95);
      if (this.crash.t <= 0) { this.crash = null; this.respawn(); }
    }
    const fuel0 = s.fuel;
    const accel = this.crash ? V() : s.control(this.input, dt, relVel, sasDir);
    if (fuel0 > 0 && s.fuel <= 0) { award('dryTanks'); this.toast('TANKS DRY', 'no propellant: you are a satellite now · P to restart', '#ff7a4d', 5000); }
    if (s.landed && !this.crash) {
      const o = s.landed.obj;
      if (s.thrustLocal.y > 0 || s.thrustLocal.z > 0) { const n = s.pos.clone().sub(o.body.pos).normalize(); s.landed = null; s.vel.copy(o.body.vel).addScaledVector(n, 1.2); s.pos.addScaledVector(n, 0.4); this.toast('LIFTOFF', '', '', 1200); }
    }
    const thrusting = accel.lengthSq() > 0;
    const warp = thrusting || this.crash ? 1 : WARPS[this.warpI];
    const total = dt * warp;
    const sub = Math.min(240, Math.max(1, Math.ceil(total / (L.units === 'rs' ? 0.02 : 0.25))));
    for (let i = 0; i < sub; i++) s.integrate(total / sub, accel, L.gravity);
    s.rotate(dt);
    L.update(s, total, this.t);
    if (s.landed) { const o = s.landed.obj; s.pos.copy(s.landed.local).applyQuaternion(o.mesh.quaternion).add(o.body.pos); s.vel.copy(o.body.vel); s.quat.copy(o.mesh.quaternion).multiply(s.landed.q); s.w.set(0, 0, 0); for (const x of L.objs) x.mesh.position.copy(x.body.pos).sub(s.pos); }
    stat('distance', s.vel.length() * total * (L.units === 'rs' ? RS_KM : 0.001));
    stat('dv', s.gLoad * dt * (L.units === 'rs' ? 0 : 1));

    // docking
    let interact = false;
    if (!this.crash) for (const o of L.objs) if (o.dock && this.dockLogic(o, dt)) interact = true;
    if (!interact) hud.setInteract(null);
    // landing surfaces, portals, collisions
    if (!this.crash) for (const o of this.targets()) {
      const d = this.tpos(o).distanceTo(s.pos);
      if (o.portal && d < o.radius) { this.portal(o.portal); return; }
      if (o.surface) { if (!s.landed) this.touch(o); continue; }
      if (o.body && !o.dock && !o.portal && d < o.radius * 0.55) {
        const n = s.pos.clone().sub(this.tpos(o)).normalize(); const vr = s.vel.clone().sub(o.body.vel); const vn = -vr.dot(n);
        if (vn > 0) { s.vel.addScaledVector(n, 1.6 * vn); s.damage(Math.max(0, vn - 0.5) * 9); this.cam.kick(Math.min(2, vn * 0.3)); this.sfx?.thud(Math.min(1, 0.3 + vn * 0.1)); this.toast('COLLISION', `you hit ${o.name} at ${fmt.n(vn, 1)} m/s`, '#ff7a4d', 1500); }
      }
    }
    // atmosphere: heating, drag
    let heat = 0;
    if (L.atmo && !this.crash) {
      const alt = s.pos.length() - L.R;
      const f = clamp((L.atmo.top - alt) / (L.atmo.top - L.atmo.kill));
      heat = f * f * clamp(s.vel.length() / (0.4 * Math.sqrt(L.mu / L.R)));
      if (heat > 0) {
        s.damage((heat * heat * 34 * total) / def.heat);
        s.vel.multiplyScalar(Math.max(0, 1 - heat * 0.004 * total));
        this.heatPeak = Math.max(this.heatPeak, heat);
      } else if (this.heatPeak > 0.25 && alt > L.atmo.top) { award('reentry'); this.heatPeak = 0; }
    }
    s.heat = heat; this.heat += (heat - this.heat) * Math.min(1, dt * 4);
    const hz = !this.crash && L.hazard?.(s);
    if (hz) s.damage(hz.dmg * total);
    // losses
    const fatal = !this.crash && L.collide(s);
    if (fatal === 'HORIZON') {
      L.clock.horizon = true; award('horizon'); this.checkObjectives();
      this.fail('no signal can leave · respawning at the wormhole', { title: 'YOU CROSSED THE EVENT HORIZON', color: '#ffd49a', explode: false }); engine.fx.uWhite.value = 1;
    } else if (fatal) this.fail(fatal);
    else if (!this.crash && s.hull <= 0) this.fail(heat > 0.2 ? 'The hull burned through.' : hz ? `${hz.label} destroyed the avionics.` : 'Structural failure.');
    if (L.clock) {
      if (L.clock.minR < 3 && s.pos.length() > 4) award('isco');
      if ((L.clock.earth - L.clock.proper) / 31557600 > 1) award('lostYear');
      if (s.vel.length() / C_GAME > 0.5) award('speed');
    }
    this.checkObjectives();

    // ---- render: ship at the origin
    const rg = L.ranger;
    rg.position.set(0, 0, 0); rg.quaternion.copy(s.quat);
    rg.userData.setThrust(this.crash || s.docked ? 0 : s.main, this.t);
    rg.userData.blink(this.t);
    rg.userData.spot.intensity = s.lights ? 700 : 0;
    const exploded = this.boomT != null;
    if (exploded) { this.boomT += dt; this.boom.userData.update(this.boomT, this.t); }
    rg.visible = this.cam.mode !== 1 && !exploded;
    if (this.crash || s.docked) this.jets.userData.off(); else this.jets.userData.update(s.rcsLocal, s.torque, this.t);
    const medium = L.units === 'm' ? relVel : s.vel.clone().multiplyScalar(400 / C_GAME);
    this.dust.visible = settings.dust; if (settings.dust) this.dust.userData.update(medium, dt);
    this.plasma.userData.update(s.vel.lengthSq() > 0 ? s.vel.clone().normalize() : V(0, 0, 1), this.crash ? 0 : this.heat, this.t);
    s.velRelRender = L.units === 'm' ? relVel : V();
    const tRel = L.units === 'rs' ? toT.clone().multiplyScalar(3000) : tPos.clone().sub(s.pos);
    this.cam.update(s, dt, this.t, rg, { targetRel: tRel });
    const cam = engine.camera;
    if (s.landed && this.cam.mode === 2) { const n = s.up(), d = cam.position.dot(n); if (d < 3) { cam.position.addScaledVector(n, 3 - d); cam.lookAt(0, 0, 0); } } // keep the orbit camera above ground
    cam.updateMatrixWorld();
    L.afterCamera?.(cam);
    // cockpit overlay
    this.cockpitLayer.visible = this.cam.mode === 1 && !exploded;
    if (this.cockpitLayer.visible) {
      this.cockpit.position.copy(cam.position); this.cockpit.quaternion.copy(cam.quaternion);
      const sl = this.cockpit.userData.sunL; sl.position.copy(cam.position).addScaledVector(L.sunDir, 10); sl.target.position.copy(cam.position); sl.target.updateMatrixWorld();
      this.drawMfd(tg, dRaw, relVel);
    }
    engine.setLayers([...L.layers, this.cockpitLayer]);
    this.sfx?.set(this.crash || s.docked ? 0 : s.main, s.rcsLevel, s.boosting ? 1 : 0, this.heat);

    // ---- HUD
    this.updateMarkers(cam, tg, relVel);
    const rs = L.units === 'rs';
    const dTxt = rs ? `${fmt.n(dRaw, dRaw < 1 ? 4 : 2)} r_s` : fmt.km(dRaw);
    const closing = relVel.dot(toT);
    const vu = rs ? (x) => `${fmt.n(x / C_GAME, 4)} c` : (x) => `${fmt.n(x, 2)} m/s`;
    const g = rs ? (s.gLoad / 0.012) * 1.2 : s.gLoad / 9.81;
    const rows = [
      ...L.telemetry(s),
      ['TARGET', tg.name, 'ok'], ['TARGET DISTANCE', dTxt], ['RELATIVE SPEED', vu(relVel.length())], ['CLOSING RATE', vu(closing), closing > 0 ? '' : 'warn'],
      ['THRUST', `${fmt.n(g, 2)} g${s.boosting ? ' · BOOST' : ''}`], ['TIME WARP', `×${warp}`], ['CAMERA', this.cam.name],
    ];
    if (s.docked) rows.unshift(['STATUS', 'DOCKED · resupplying · U to undock', 'ok']);
    if (s.landed) rows.unshift(['STATUS', 'LANDED · R or W to lift off', 'ok']);
    hud.setTelemetry(rows, rs ? 'Paczyński–Wiita gravity · dτ/dt = √(1 − r_s/r)·√(1 − v²/c²)' : 'velocity-Verlet integration · every craft in its own Keplerian orbit', performance.now() / 1000);
    hud.setCamMode(`${this.cam.name}  ·  [C] change`);
    hud.setClock(`${def.name} · ${this.mission ? `CONTRACT ${fmt.time(this.mt).slice(3)} / PAR ${fmt.time(this.mission.par).slice(3)}` : `FREE ROAM ${fmt.time(this.t)}`}${warp > 1 ? ` · WARP ×${warp}` : ''}`);
    if (rs) { hud.showMinimap(true); drawSystem(hud.mctx, s.pos, { highlight: tg.id, label: `YOUR ${def.name}` }); } else hud.showMinimap(false);
    this.updateStatus(rs, hz);
    if (this.mapOpen) this.drawMap();
  }

  updateStatus(rs, hz) {
    const s = this.ship, d = this.dom, def = this.def;
    const hp = s.hull / def.hull;
    d.fuel.style.width = `${s.fuel * 100}%`; d.fuel.className = s.fuel < 0.15 ? 'bad' : '';
    d.fuelT.textContent = settings.infiniteFuel ? '∞' : rs ? `${fmt.n(s.fuel * 100, 0)}%` : `${fmt.n(s.dv, 0)} m/s`;
    d.hull.style.width = `${hp * 100}%`; d.hull.className = hp < 0.3 ? 'bad' : hp < 0.6 ? 'mid' : '';
    d.hullT.textContent = `${fmt.n(hp * 100, 0)}%`;
    const thr = s.main > 0 ? Math.max(s.throttle, this.input.down('w') ? 1 : 0) : 0;
    d.thr.style.width = `${thr * 100}%`; d.thrT.textContent = s.throttle > 0 ? `HOLD ${fmt.n(s.throttle * 100, 0)}%` : thr ? 'BURN' : 'IDLE';
    const modes = `<span class="${s.sas ? 'on' : ''}">AP ${SAS_MODES[s.sas]}${s.sasErr != null ? ` ${fmt.n((s.sasErr * 180) / Math.PI, 0)}°` : ''}</span><span class="${s.fa ? 'on' : ''}">ASSIST</span><span class="${s.lights ? 'on' : ''}">LIGHTS</span><span>${rankInfo().name}</span>`;
    if (modes !== this._modes) { d.modes.innerHTML = modes; this._modes = modes; }
    const w = [];
    if (s.fuel <= 0 && !settings.infiniteFuel) w.push('TANKS DRY'); else if (s.fuel < 0.15) w.push('LOW PROPELLANT');
    if (hp < 0.3) w.push('HULL CRITICAL');
    if (this.heat > 0.05) w.push('ATMOSPHERIC HEATING');
    if (hz) w.push(hz.label);
    if (this.loc.mu && !s.landed) { const o = this.orb(); const floor = this.loc.atmo ? this.loc.atmo.top : 0; if (o.altPe < floor && o.alt < floor * 4 + 3e5 && this.heat <= 0.05) w.push(this.loc.atmo ? 'PERIAPSIS IN ATMOSPHERE' : 'IMPACT TRAJECTORY'); }
    const wt = w.join('  ·  ');
    if (wt !== this._warn) { d.warn.textContent = wt; this._warn = wt; if (wt) this.sfx?.ping(440, 0.25, 0.1); }
  }

  checkObjectives() {
    if (!this.mission) return;
    const i = this.done.indexOf(false); if (i < 0) return;
    const o = this.objectives[i];
    if (!o.check(this.ship, this)) return;
    this.done[i] = true; this.renderObjectives();
    this.sfx?.ping(784, 0.15, 0.16); this.sfx?.ping(1175, 0.3, 0.14, 0.14);
    if (this.done.every(Boolean)) this.finishMission();
    else this.toast('OBJECTIVE COMPLETE', o.text, '#8fe3c0');
  }

  finishMission() {
    const m = this.mission, s = this.ship, time = this.mt;
    const hp = s.hull / this.def.hull;
    const stars = time <= m.par && hp >= 0.7 && this.respawns === 0 ? 3 : time <= m.par * 2 ? 2 : 1;
    const r = completeMission(missionKey(this.locId, m.id), { stars, time, xpBase: m.xp });
    const all = ALL_MISSION_KEYS.every((k) => career.missions[k]);
    if (all) award('allMissions');
    if (all && ALL_MISSION_KEYS.every((k) => career.missions[k].stars === 3)) award('allStars');
    const why = stars === 3 ? 'flawless' : time > m.par ? `over par by ${fmt.time(time - m.par).slice(3)}` : this.respawns ? 'restarted during the contract' : 'hull damage';
    this.dom.result.innerHTML = `<div class="rs-k">CONTRACT COMPLETE</div><div class="rs-n">${m.name}</div><div class="rs-s">${'★'.repeat(stars)}<i>${'★'.repeat(3 - stars)}</i></div>
      <div class="rs-r"><span>TIME</span><b>${fmt.time(time).slice(3)} <small>par ${fmt.time(m.par).slice(3)}</small></b></div>
      <div class="rs-r"><span>HULL</span><b>${fmt.n(hp * 100, 0)}%</b></div><div class="rs-r"><span>PROPELLANT LEFT</span><b>${fmt.n(s.fuel * 100, 0)}%</b></div>
      <div class="rs-r"><span>RATING</span><b>${why}</b></div><div class="rs-r"><span>EARNED</span><b>+${r.xp} XP</b></div>
      <div class="rs-f">[J] next contract · [P] fly it again · keep flying in free roam</div>`;
    this.dom.result.classList.remove('hidden');
    clearTimeout(this._rt); this._rt = setTimeout(() => this.dom.result.classList.add('hidden'), 14000);
    this.lastMission = m; this.mission = null; this.objectives = []; this.done = [];
    this.renderObjectives();
  }

  touch(o) {
    const s = this.ship, info = this.surfaceInfo(o);
    if (info.alt > 0) return;
    const vr = s.vel.clone().sub(o.body.vel), sp = vr.length();
    if (sp < 4) {
      s.quat.premultiply(new THREE.Quaternion().setFromUnitVectors(s.up(), info.n)).normalize();
      const inv = o.mesh.quaternion.clone().invert();
      s.landed = { obj: o, local: info.local.clone().setLength(info.R + s.def.gear), q: inv.clone().multiply(s.quat) };
      s.vel.copy(o.body.vel); s.w.set(0, 0, 0); s.throttle = 0; s.sas = 0;
      stat('landings'); award('firstLanding'); addXp(80, 'landing');
      this.cam.kick(0.25 + sp * 0.15); this.sfx?.thud(0.5);
      this.toast('TOUCHDOWN', `${o.name} · contact at ${fmt.n(sp, 2)} m/s`, '#8fe3c0', 4000);
    } else if (sp < 16) {
      const vn = vr.dot(info.n); vr.addScaledVector(info.n, -1.5 * vn).multiplyScalar(0.6);
      s.vel.copy(o.body.vel).add(vr); s.pos.addScaledVector(info.n, -info.alt + 0.1);
      s.damage((sp - 4) * 7); this.cam.kick(1.2); this.sfx?.thud(0.9);
      this.toast('HARD CONTACT', `${fmt.n(sp, 1)} m/s — land under 4 m/s`, '#ff7a4d', 2500);
    } else this.fail(`Impact on ${o.name} at ${fmt.n(sp, 0)} m/s.`);
  }

  dockLogic(o, dt) {
    const s = this.ship, def = s.def, mq = o.mesh.quaternion;
    const portPos = o.dock.port.clone().applyQuaternion(mq).add(o.body.pos);
    const axis = o.dock.axis.clone().applyQuaternion(mq);
    if (s.docked) {
      if (s.docked !== o) return false;
      s.pos.copy(portPos).sub(def.collar.clone().applyQuaternion(s.quat)); s.vel.copy(o.body.vel); s.w.set(0, 0, 0);
      s.fuel = Math.min(1, s.fuel + dt * 0.1); s.hull = Math.min(def.hull, s.hull + dt * def.hull * 0.1);
      return false;
    }
    const collar = def.collar.clone().applyQuaternion(s.quat).add(s.pos);
    const d = collar.distanceTo(portPos);
    if (d > 70) return false;
    const vrel = s.vel.clone().sub(o.body.vel).length();
    const mine = def.dockAxis.clone().applyQuaternion(s.quat);
    const align = mine.dot(axis.clone().negate());
    const p = portPos.clone().sub(s.pos).project(this.ctx.engine.camera);
    const ok = d < 2 && vrel < 0.5 && align > Math.cos((12 * Math.PI) / 180);
    this.ctx.hud.setInteract({
      title: `DOCKING · ${o.name} PORT`,
      body: `Collar to port <b>${fmt.n(d, 2)} m</b> · rel. speed <b>${fmt.n(vrel, 2)} m/s</b> · alignment <b>${fmt.n((Math.acos(clamp(align, -1, 1)) * 180) / Math.PI, 1)}°</b>`,
      hint: `${def.dockAxis.z ? 'Point the nose at the port' : 'Roll so the dorsal collar faces the port'} · X matches velocity · approach < 0.5 m/s`,
      progress: clamp(1 - d / 70), color: ok ? '#8fe3c0' : '#ffd49a',
      reticle: p.z < 1 ? { x: 0.5 + p.x * 0.5, y: 0.5 - p.y * 0.5, ok } : null,
    });
    if (ok && d < 1.2) {
      s.docked = o; s.throttle = 0; s.sas = 0;
      s.quat.premultiply(new THREE.Quaternion().setFromUnitVectors(mine, axis.clone().negate())).normalize();
      stat('dockings'); award('firstDock'); if (vrel < 0.1) award('softTouch'); addXp(60, 'docking');
      this.cam.kick(0.3); this.sfx?.thud(0.5);
      this.toast('HARD DOCK', `capture latches engaged · ${o.name} is resupplying your ship`, '#8fe3c0', 4000);
    } else if (d < 1.0 && vrel >= 0.5) {
      // too fast: bounce off the port
      const n = collar.clone().sub(portPos).normalize(); const vr = s.vel.clone().sub(o.body.vel);
      if (vr.dot(n) < 0) { s.vel.addScaledVector(n, -1.5 * vr.dot(n)); s.damage((vrel - 0.5) * 10); this.cam.kick(0.8); this.sfx?.thud(0.8); this.toast('DOCKING ABORT', `${fmt.n(vrel, 1)} m/s is too fast`, '#ff7a4d', 1800); }
    }
    return true;
  }

  renderObjectives() {
    if (!this.loc) return;
    const cur = this.done.indexOf(false);
    this.dom.ob.innerHTML = this.mission
      ? `<div class="panel-title">CONTRACT · ${this.mission.name.toUpperCase()}</div>` + this.objectives.map((o, i) => `<div class="ob ${this.done[i] ? 'done' : i === cur ? 'cur' : ''}">${o.text}</div>`).join('')
      : `<div class="panel-title">FREE ROAM</div><div class="ob">No active contract · [J] cycles this world’s contracts</div>`;
  }

  // ------------------------------------------------------------------ cockpit display
  drawMfd(tg, dRaw, relVel) {
    const m = this.cockpit.userData.mfd; if (!m || this.t - (this._mfdT || 0) < 0.2) return; this._mfdT = this.t;
    const g = m.cx, s = this.ship, rs = this.loc.units === 'rs';
    g.fillStyle = '#010304'; g.fillRect(0, 0, 1024, 256);
    const panel = (i, title) => { const x = 20 + i * 250; g.strokeStyle = 'rgba(140,220,255,.6)'; g.lineWidth = 1; g.strokeRect(x, 20, 230, 216); g.fillStyle = 'rgba(140,220,255,.55)'; g.font = '15px monospace'; g.fillText(title, x + 12, 44); return x + 12; };
    const big = (x, y, txt, col = 'rgba(190,235,255,.95)') => { g.fillStyle = col; g.font = '26px monospace'; g.fillText(txt, x, y); };
    const bar = (x, y, v, col) => { g.strokeStyle = 'rgba(140,220,255,.4)'; g.strokeRect(x, y, 200, 14); g.fillStyle = col; g.fillRect(x + 2, y + 2, 196 * clamp(v), 10); };
    let x = panel(0, 'PROPELLANT');
    big(x, 92, rs ? `${fmt.n(s.fuel * 100, 0)} %` : `${fmt.n(s.dv, 0)} m/s`); bar(x, 110, s.fuel, s.fuel < 0.15 ? '#ff7a4d' : '#8fe3c0');
    g.fillStyle = 'rgba(140,220,255,.55)'; g.font = '15px monospace'; g.fillText('HULL', x, 160); bar(x, 172, s.hull / this.def.hull, s.hull / this.def.hull < 0.3 ? '#ff7a4d' : '#9fc4ff');
    x = panel(1, 'VELOCITY');
    big(x, 92, rs ? `${fmt.n(s.vel.length() / C_GAME, 3)} c` : `${fmt.n(s.vel.length(), 0)} m/s`);
    g.fillStyle = 'rgba(140,220,255,.55)'; g.font = '15px monospace'; g.fillText('RELATIVE', x, 140); big(x, 176, rs ? `${fmt.n(relVel.length() / C_GAME, 3)} c` : `${fmt.n(relVel.length(), 1)} m/s`, '#ffd49a');
    g.fillStyle = 'rgba(140,220,255,.55)'; g.font = '15px monospace'; g.fillText(`THR ${fmt.n(s.main * 100, 0)}%  AP ${SAS_MODES[s.sas]}`, x, 216);
    x = panel(2, 'TARGET');
    big(x, 92, tg.name.slice(0, 12)); big(x, 136, rs ? `${fmt.n(dRaw, 2)} r_s` : fmt.km(dRaw), '#8fe3c0');
    // attitude: target bearing in the ship frame
    const b = this.tpos(tg).clone().sub(s.pos).normalize().applyQuaternion(_q.copy(s.quat).invert());
    const cx = x + 100, cy = 190; g.strokeStyle = 'rgba(140,220,255,.5)'; g.beginPath(); g.arc(cx, cy, 34, 0, 7); g.stroke();
    g.fillStyle = b.z > 0 ? '#8fe3c0' : '#ff7a4d'; g.beginPath(); g.arc(cx - b.x * 32, cy - b.y * 32, 5, 0, 7); g.fill();
    x = panel(3, 'ORBIT');
    if (this.loc.mu) { const o = this.orb(); g.font = '18px monospace'; g.fillStyle = 'rgba(190,235,255,.95)';
      [['ALT', fmt.km(o.alt)], ['PE', fmt.km(o.altPe)], ['AP', o.altAp === Infinity ? 'ESCAPE' : fmt.km(o.altAp)], ['ECC', fmt.n(o.e, 4)], ['T', o.period === Infinity ? '—' : `${fmt.n(o.period / 60, 1)} min`]].forEach(([k, v], i) => g.fillText(`${k.padEnd(4)}${v}`, x, 78 + i * 30)); }
    else { const c = this.loc.clock; g.font = '18px monospace'; g.fillStyle = 'rgba(190,235,255,.95)';
      [['R', `${fmt.n(s.pos.length(), 2)} r_s`], ['dτ/dt', fmt.n(c.dil ?? 1, 4)], ['SHIP', fmt.ymd(c.proper / 31557600)], ['EARTH', fmt.ymd(c.earth / 31557600)]].forEach(([k, v], i) => g.fillText(`${k.padEnd(6)}${v}`, x, 78 + i * 30)); }
    m.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ orbit map
  drawMap() {
    const L = this.loc, s = this.ship, g = this.dom.mapCtx, W = g.canvas.width, H = g.canvas.height, cx = W / 2, cy = H / 2;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(3,6,10,0.86)'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(232,236,239,0.18)'; g.strokeRect(0.5, 0.5, W - 1, H - 1);
    const r = s.pos, v = s.vel, mu = L.mu;
    const h = V().crossVectors(r, v), w = h.clone().normalize(), u = r.clone().normalize(), q = V().crossVectors(w, u);
    const ev = v.clone().cross(h).multiplyScalar(1 / mu).sub(u), e = ev.length(), p = h.lengthSq() / mu;
    const eh = e > 1e-6 ? ev.clone().multiplyScalar(1 / e) : u.clone(), fh = V().crossVectors(w, eh);
    const ra = e < 1 ? p / (1 - e) : Infinity;
    let ext = Math.max(r.length(), Math.min(ra, r.length() * 6)) * 1.08;
    for (const o of L.objs) if (o.body && !o.portal) ext = Math.max(ext, Math.min(o.body.pos.length() * 1.08, ext * 3));
    const k = (Math.min(W, H) / 2 - 46) / ext;
    const P = (pt) => [cx + pt.dot(u) * k, cy - pt.dot(q) * k];
    // body
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(2, L.R * k));
    grd.addColorStop(0, 'rgba(60,70,84,0.9)'); grd.addColorStop(1, 'rgba(26,32,42,0.95)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, Math.max(2, L.R * k), 0, 7); g.fill(); g.strokeStyle = 'rgba(232,236,239,0.4)'; g.stroke();
    if (L.atmo) { g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,122,77,0.55)'; g.beginPath(); g.arc(cx, cy, (L.R + L.atmo.top) * k, 0, 7); g.stroke(); g.setLineDash([]); }
    // other craft
    g.font = '10px JetBrains Mono, monospace';
    for (const o of L.objs) { if (!o.body) continue; const [x, y] = P(o.body.pos); if (x < 0 || y < 0 || x > W || y > H) continue;
      g.strokeStyle = 'rgba(143,227,192,0.25)'; g.beginPath(); g.arc(cx, cy, o.body.pos.length() * k, 0, 7); g.stroke();
      g.fillStyle = '#8fe3c0'; g.fillRect(x - 2.5, y - 2.5, 5, 5); g.fillText(o.name, x + 8, y - 6); }
    // own conic
    g.strokeStyle = '#ffd49a'; g.lineWidth = 1.5; g.beginPath(); let pen = false; const pt = V();
    for (let i = 0; i <= 360; i++) { const th = (i / 360) * Math.PI * 2, den = 1 + e * Math.cos(th); const rr = p / den;
      if (den <= 0.02 || rr > ext * 2.5) { pen = false; continue; }
      pt.copy(eh).multiplyScalar(rr * Math.cos(th)).addScaledVector(fh, rr * Math.sin(th)); const [x, y] = P(pt); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; }
    g.stroke(); g.lineWidth = 1;
    const mk = (rr, th, label, col) => { pt.copy(eh).multiplyScalar(rr * Math.cos(th)).addScaledVector(fh, rr * Math.sin(th)); const [x, y] = P(pt); g.fillStyle = col; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.fillText(label, x + 8, y + 12); };
    const rp = p / (1 + e);
    mk(rp, 0, `Pe ${fmt.km(rp - L.R)}`, rp < L.R + (L.atmo?.top || 0) ? '#ff7a4d' : '#9fc4ff');
    if (e < 1 && ra < ext * 2.5) mk(ra, Math.PI, `Ap ${fmt.km(ra - L.R)}`, '#9fc4ff');
    // ship
    const [sx, sy] = P(r); const vd = [v.dot(u), v.dot(q)]; const vl = Math.hypot(vd[0], vd[1]) || 1;
    g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + (vd[0] / vl) * 26, sy - (vd[1] / vl) * 26); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 4, 0, 7); g.fill(); g.fillText(this.def.name, sx + 9, sy + 4);
    // legend
    g.fillStyle = 'rgba(232,236,239,0.85)'; g.font = '11px JetBrains Mono, monospace';
    g.fillText(`ORBIT MAP · ${String(L.bodyName).toUpperCase()} · VIEWED ALONG YOUR ORBIT NORMAL`, 18, 26);
    g.fillStyle = 'rgba(232,236,239,0.55)';
    const el = orbitalElements(r, v, mu);
    g.fillText(`e ${fmt.n(e, 4)}   a ${e < 1 ? fmt.km(el.a) : '—'}   T ${el.period === Infinity ? 'escape' : `${fmt.n(el.period / 60, 1)} min`}   v ${fmt.n(v.length(), 0)} m/s   v_circ ${fmt.n(Math.sqrt(mu / r.length()), 0)} m/s   v_esc ${fmt.n(Math.sqrt((2 * mu) / r.length()), 0)} m/s`, 18, H - 34);
    g.fillText('burn prograde at Pe to raise Ap · retrograde at Ap to lower Pe · [1]/[2] hold pro/retrograde · [M] close', 18, H - 16);
  }

  updateMarkers(cam, tgSel, relVel) {
    const L = this.loc, s = this.ship;
    const w = window.innerWidth, h = window.innerHeight;
    const seen = new Set();
    const fwd = cam.getWorldDirection(V());
    const place = (key, worldRel, label, cls) => {
      let el = this.markEls.get(key);
      if (!el) { el = document.createElement('div'); el.className = 'fmark'; el.innerHTML = '<div class="box"></div><div class="lbl"></div>'; this.dom.marks.appendChild(el); this.markEls.set(key, el); }
      seen.add(key);
      const p = worldRel.clone().project(cam);
      let x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h; let off = false;
      const behind = worldRel.clone().sub(cam.position).dot(fwd) < 0;
      if (behind) { x = w - x; y = h - y; }
      if (behind || x < 30 || x > w - 30 || y < 30 || y > h - 30) {
        off = true; const cx = w / 2, cy = h / 2; const dx = x - cx, dy = y - cy; const k = Math.min((w / 2 - 40) / Math.abs(dx || 1), (h / 2 - 40) / Math.abs(dy || 1)); x = cx + dx * k; y = cy + dy * k;
      }
      el.className = `fmark ${cls}${off ? ' off' : ''}`;
      el.style.left = `${x}px`; el.style.top = `${y}px`;
      if (el._l !== label) { el.lastChild.innerHTML = label; el._l = label; }
    };
    const far = L.units === 'rs' ? 5e4 : 1e4;
    for (const o of this.targets()) {
      let rel = this.tpos(o).clone().sub(s.pos);
      const d = rel.length();
      if (L.units === 'rs') rel = rel.normalize().multiplyScalar(5e4);
      const dTxt = L.units === 'rs' ? `${fmt.n(d, d < 1 ? 4 : 1)} r_s` : fmt.km(d);
      place(o.id, rel, `${o.name}<br>${dTxt}`, o === tgSel ? 'sel' : '');
    }
    // prograde / retrograde relative to the selected target
    if (relVel.lengthSq() > 1e-10) {
      const dir = relVel.clone().normalize().multiplyScalar(far);
      place('pro', dir, '', 'pro'); place('retro', dir.clone().negate(), '', 'retro');
    }
    // orbital prograde (around the central body)
    if (L.mu && s.vel.lengthSq() > 1) place('opro', s.vel.clone().normalize().multiplyScalar(far), '', 'orb');
    for (const [k, el] of this.markEls) el.style.display = seen.has(k) ? '' : 'none';
    // virtual stick
    this.dom.stick.style.left = `${50 + (s.mouse.x + s.stick.x) * 8}%`; this.dom.stick.style.top = `${50 + (s.mouse.y + s.stick.y) * 12}%`;
  }
}
