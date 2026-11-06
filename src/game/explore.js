import * as THREE from 'three';
import { Ship, FlightCamera } from './flight.js';
import { LOCATIONS, C_GAME } from './locations.js';
import { EngineSound } from './sfx.js';
import { createCockpit } from '../world/ships.js';
import { settings } from '../core/settings.js';
import { drawSystem } from '../chapters/gsys.js';
import { fmt } from '../data/astro.js';
import { RS_KM } from '../chapters/gsys.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WARPS = [1, 10, 100];
const COLLAR = V(0, 2.86, -3.08);   // Ranger docking-collar face, ship frame
const PORT = V(0, 0, 7.9);          // Endurance forward port face, Endurance frame

export class Explore {
  constructor(ctx) {
    this.ctx = ctx; this.active = false; this.loc = null; this.t = 0; this.warpI = 0; this.tgtI = 0;
    this.cockpit = createCockpit(); this.cockpitScene = new THREE.Scene(); this.cockpitScene.add(this.cockpit);
    this.cockpitLayer = { scene: this.cockpitScene, near: 0.05, far: 20, visible: false };
    this.cam = new FlightCamera(ctx.engine.camera, ctx.engine.canvas);
    this.buildDom();
    document.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== ctx.engine.canvas || !this.ship) return;
      const k = settings.mouseSens / 320;
      const m = this.ship.mouse; m.x += e.movementX * k; m.y += e.movementY * k;
      const l = Math.hypot(m.x, m.y); if (l > 1) { m.x /= l; m.y /= l; }
    });
    ctx.engine.canvas.addEventListener('click', () => { if (this.active && this.cam.mode !== 2 && !ctx.menu.visible) ctx.engine.canvas.requestPointerLock?.(); });
  }

  buildDom() {
    const f = document.createElement('div'); f.id = 'flight'; f.className = 'hidden';
    f.innerHTML = '<div class="cross"></div><div id="stick" class="fmark pro" style="left:50%;top:50%"><div class="box" style="width:6px;height:6px;border-radius:50%"></div></div><div id="marks"></div>';
    document.body.appendChild(f);
    const ob = document.createElement('div'); ob.id = 'objectives'; document.getElementById('hud').appendChild(ob);
    const toast = document.createElement('div'); toast.id = 'toast'; document.body.appendChild(toast);
    this.dom = { f, marks: f.querySelector('#marks'), stick: f.querySelector('#stick'), ob, toast };
    this.markEls = new Map();
  }

  toast(text, sub = '', color = '', ms = 3500) {
    const t = this.dom.toast; t.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`; t.style.color = color; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

  async start(id) {
    const { engine, hud, audio } = this.ctx;
    this.stop(false);
    this.toast('LOADING', LOCATIONS[id] ? id.toUpperCase() : '', '', 1500);
    await new Promise((r) => setTimeout(r, 30));
    const loc = LOCATIONS[id](this.ctx);
    this.loc = loc; this.locId = id;
    const s = (this.ship = new Ship(loc.shipParams));
    s.pos.copy(loc.ship.pos); s.vel.copy(loc.ship.vel); s.quat.copy(loc.ship.quat);
    this.start0 = { pos: loc.ship.pos.clone(), vel: loc.ship.vel.clone(), quat: loc.ship.quat.clone() };
    this.done = loc.objectives.map(() => false);
    this.t = 0; this.warpI = 0; this.tgtI = 0; this.crash = null;
    this.cam.setMode(0);
    try { await engine.precompile(loc.layers.map((L) => L.scene)); } catch { /* compile lazily */ }
    this.active = true;
    hud.el.classList.add('explore');
    hud.kicker.textContent = loc.kicker; hud.title.textContent = loc.name;
    this.dom.f.classList.remove('hidden');
    audio.el.loop = true;
    audio.seek(loc.music);
    try { await audio.start(); } catch { /* autoplay */ }
    if (!this.sfx && audio.ctx) this.sfx = new EngineSound(audio.ctx);
    this.renderObjectives();
    this.toast(loc.name.toUpperCase(), 'click to fly with the mouse · Esc for menu · C cameras · Tab targets');
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
    }
  }

  targets() { const L = this.loc; return L.objs.length ? L.objs : L.points; }
  tpos(o) { return o.body ? o.body.pos : o.pos; }
  dist(id) {
    const o = this.targets().find((x) => x.id === id); if (!o) return Infinity;
    return this.tpos(o).distanceTo(this.ship.pos);
  }

  handleKey(k) {
    if (!this.active) return false;
    const s = this.ship;
    if (k === 'tab') { this.tgtI = (this.tgtI + 1) % this.targets().length; return true; }
    if (k === 'c') { this.cam.cycle(); if (this.cam.mode === 2 && document.pointerLockElement) document.exitPointerLock(); return true; }
    if (k === 'v') { s.fa = !s.fa; this.toast(`FLIGHT ASSIST ${s.fa ? 'ON' : 'OFF'}`, s.fa ? 'rotation damped' : 'pure Newtonian rotation', '', 1500); return true; }
    if (k === 't') { this.warpI = (this.warpI + 1) % WARPS.length; this.toast(`TIME WARP ×${WARPS[this.warpI]}`, '', '', 1200); return true; }
    if (k === 'u' && s.docked) { s.docked = null; s.vel.addScaledVector(s.up(), -0.3); this.toast('UNDOCKED', '', '', 1500); return true; }
    if (k === 'p') { this.respawn(); return true; }
    return ['w', 'a', 's', 'd', 'r', 'f', 'q', 'e', 'x', 'shift'].includes(k);
  }

  respawn() {
    const s = this.ship;
    s.pos.copy(this.start0.pos); s.vel.copy(this.start0.vel); s.quat.copy(this.start0.quat); s.w.set(0, 0, 0); s.docked = null;
    if (this.loc.clock) { this.loc.clock.minR = 1e9; }
  }

  update(dt) {
    if (!this.active || !this.loc) return;
    const { engine, hud, input } = this.ctx;
    const L = this.loc, s = this.ship;
    this.t += dt;
    const tg = this.targets()[this.tgtI % this.targets().length];
    const tPos = this.tpos(tg), tVel = tg.body ? tg.body.vel : V();
    const relVel = s.vel.clone().sub(tVel);
    // controls + physics
    if (this.crash) {
      this.crash.t -= dt; s.w.multiplyScalar(0.95);
      if (this.crash.t <= 0) { this.crash = null; this.respawn(); }
    }
    const accel = this.crash ? V() : s.control(input, dt, relVel);
    const thrusting = accel.lengthSq() > 0;
    const warp = thrusting ? 1 : WARPS[this.warpI];
    const total = dt * warp;
    const sub = Math.min(200, Math.max(1, Math.ceil(total / (L.units === 'rs' ? 0.02 : 0.25))));
    for (let i = 0; i < sub; i++) s.integrate(total / sub, accel, L.gravity);
    s.rotate(dt);
    L.update(s, total, this.t);
    // docking (Endurance)
    const end = L.objs.find((o) => o.dock);
    if (end) this.dockLogic(end, dt);
    // portals, collisions
    for (const o of this.targets()) {
      if (o.portal && this.tpos(o).distanceTo(s.pos) < o.radius) { this.portal(o.portal); return; }
      if (o.body && !o.dock && !o.portal && this.tpos(o).distanceTo(s.pos) < o.radius * 0.55 && !this.crash) {
        const n = s.pos.clone().sub(this.tpos(o)).normalize(); const vr = s.vel.clone().sub(o.body.vel);
        s.vel.addScaledVector(n, -1.6 * vr.dot(n)); this.toast('COLLISION', `you bumped the ${o.name}`, '#ff7a4d', 1500);
      }
    }
    const crash = !this.crash && L.collide(s);
    if (crash === 'HORIZON') { L.clock.horizon = true; this.crash = { t: 4 }; this.toast('YOU CROSSED THE EVENT HORIZON', 'no signal can leave · respawning at the wormhole', '#ffd49a', 4000); engine.fx.uWhite.value = 1; }
    else if (crash) { this.crash = { t: 3 }; this.toast('MISSION FAILURE', crash, '#ff7a4d', 3000); }
    // objectives
    let changed = false;
    L.objectives.forEach((o, i) => { if (!this.done[i] && o.check(s, this)) { this.done[i] = true; changed = true; this.toast('OBJECTIVE COMPLETE', o.text, '#8fe3c0'); } });
    if (changed) { this.renderObjectives(); if (this.done.every(Boolean)) setTimeout(() => this.toast(`${L.name.toUpperCase()} COMPLETE`, 'keep exploring, or choose another location from the menu (Esc)', '#ffd49a', 6000), 3800); }

    // render: ship at the origin
    const rg = L.ranger;
    rg.position.set(0, 0, 0); rg.quaternion.copy(s.quat);
    rg.userData.setThrust(this.crash ? 0 : Math.max(s.main * (s.boosting ? 1 : 0.55), s.docked ? 0 : 0), this.t);
    rg.userData.blink(this.t);
    rg.visible = this.cam.mode !== 1;
    s.velRelRender = L.units === 'm' ? relVel : V();
    const tRel = L.units === 'rs' ? tPos.clone().sub(s.pos).normalize().multiplyScalar(3000) : tPos.clone().sub(s.pos);
    this.cam.update(s, dt, this.t, rg, { targetRel: tRel });
    const cam = engine.camera;
    cam.updateMatrixWorld();
    L.afterCamera?.(cam);
    // cockpit overlay
    this.cockpitLayer.visible = this.cam.mode === 1;
    if (this.cockpitLayer.visible) {
      this.cockpit.position.copy(cam.position); this.cockpit.quaternion.copy(cam.quaternion);
      const sl = this.cockpit.userData.sunL; sl.position.copy(cam.position).addScaledVector(L.sunDir, 10); sl.target.position.copy(cam.position); sl.target.updateMatrixWorld();
    }
    engine.setLayers([...L.layers, this.cockpitLayer]);
    this.sfx?.set(this.crash ? 0 : s.main, s.rcsLevel, s.boosting ? 1 : 0);

    // HUD
    this.updateMarkers(cam, tg, relVel);
    const dRaw = tPos.distanceTo(s.pos);
    const dTxt = L.units === 'rs' ? `${fmt.n(dRaw, dRaw < 1 ? 4 : 2)} r_s` : fmt.km(dRaw);
    const closing = -relVel.dot(tPos.clone().sub(s.pos).normalize());
    const vu = L.units === 'rs' ? (x) => `${fmt.n(x / C_GAME, 4)} c` : (x) => `${fmt.n(x, 2)} m/s`;
    const g = L.units === 'rs' ? s.gLoad / 0.012 * 1.2 : s.gLoad / 9.81;
    const rows = [
      ...L.telemetry(s),
      ['TARGET', tg.name, 'ok'], ['TARGET DISTANCE', dTxt], ['RELATIVE SPEED', vu(relVel.length())], ['CLOSING RATE', vu(closing), closing > 0 ? '' : 'warn'],
      ['THRUST', `${fmt.n(g, 2)} g${s.boosting ? ' · BOOST' : ''}`], ['FLIGHT ASSIST', s.fa ? 'ON' : 'OFF'], ['TIME WARP', `×${warp}`], ['CAMERA', this.cam.name],
    ];
    if (s.docked) rows.unshift(['STATUS', 'DOCKED · press U to undock', 'ok']);
    hud.setTelemetry(rows, L.units === 'rs' ? 'Paczyński–Wiita gravity · dτ/dt = √(1 − r_s/r)·√(1 − v²/c²)' : 'velocity-Verlet integration · every craft in its own Keplerian orbit', performance.now() / 1000);
    hud.setCamMode(`${this.cam.name}  ·  [C] change`);
    hud.setClock(`FREE FLIGHT · ${fmt.time(this.t)}${warp > 1 ? ` · WARP ×${warp}` : ''}`);
    if (L.units === 'rs') { hud.showMinimap(true); drawSystem(hud.mctx, s.pos, { highlight: tg.id, label: 'YOUR RANGER' }); } else hud.showMinimap(false);
  }

  dockLogic(end, dt) {
    const s = this.ship, eq = end.mesh.quaternion;
    const portPos = PORT.clone().applyQuaternion(eq).add(end.body.pos);
    const axis = V(0, 0, 1).applyQuaternion(eq);
    if (s.docked) {
      s.pos.copy(portPos).sub(COLLAR.clone().applyQuaternion(s.quat)); s.vel.copy(end.body.vel); s.w.set(0, 0, 0);
      return;
    }
    const collar = COLLAR.clone().applyQuaternion(s.quat).add(s.pos);
    const d = collar.distanceTo(portPos);
    const vrel = s.vel.clone().sub(end.body.vel).length();
    const align = s.up().dot(axis.clone().negate());
    const near = d < 70;
    if (near) {
      const p = portPos.clone().sub(s.pos).project(this.ctx.engine.camera);
      const ok = d < 2 && vrel < 0.5 && align > Math.cos((12 * Math.PI) / 180);
      this.ctx.hud.setInteract({
        title: 'DOCKING · ENDURANCE HUB PORT',
        body: `Collar to port <b>${fmt.n(d, 2)} m</b> · rel. speed <b>${fmt.n(vrel, 2)} m/s</b> · alignment <b>${fmt.n((Math.acos(Math.min(1, align)) * 180) / Math.PI, 1)}°</b>`,
        hint: 'Roll the Ranger so its top faces the port · X matches velocity · approach < 0.5 m/s',
        progress: Math.max(0, Math.min(1, 1 - d / 70)), color: ok ? '#8fe3c0' : '#ffd49a',
        reticle: p.z < 1 ? { x: 0.5 + p.x * 0.5, y: 0.5 - p.y * 0.5, ok } : null,
      });
      if (ok && d < 1.2) {
        s.docked = end;
        // snap: collar axis onto the port axis, keep roll
        const q = new THREE.Quaternion().setFromUnitVectors(s.up(), axis.clone().negate()); s.quat.premultiply(q);
        this.toast('HARD DOCK', 'capture latches engaged — welcome aboard the Endurance', '#8fe3c0', 4000);
      }
    } else this.ctx.hud.setInteract(null);
    if (s.docked) this.ctx.hud.setInteract(null);
  }

  portal(to) {
    const { engine } = this.ctx;
    engine.fx.uWhite.value = 1;
    this.toast('WORMHOLE TRANSIT', to === 'gargantua' ? 'emerging in another galaxy…' : 'back to Saturn…', '#9fc4ff', 3000);
    this.start(to);
  }

  renderObjectives() {
    const L = this.loc; if (!L) return;
    const cur = this.done.indexOf(false);
    this.dom.ob.innerHTML = '<div class="panel-title">MISSIONS</div>' + L.objectives.map((o, i) => `<div class="ob ${this.done[i] ? 'done' : i === cur ? 'cur' : ''}">${o.text}</div>`).join('');
  }

  updateMarkers(cam, tgSel, relVel) {
    const L = this.loc, s = this.ship;
    const w = window.innerWidth, h = window.innerHeight;
    const seen = new Set();
    const place = (key, worldRel, label, cls) => {
      let el = this.markEls.get(key);
      if (!el) { el = document.createElement('div'); el.className = 'fmark'; el.innerHTML = '<div class="box"></div><div class="lbl"></div>'; this.dom.marks.appendChild(el); this.markEls.set(key, el); }
      seen.add(key);
      const p = worldRel.clone().add(cam.position.clone().multiplyScalar(0)).project(cam);
      let x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h; let off = false;
      const behind = worldRel.clone().sub(cam.position).dot(cam.getWorldDirection(V())) < 0;
      if (behind) { x = w - x; y = h - y; }
      if (behind || x < 30 || x > w - 30 || y < 30 || y > h - 30) {
        off = true; const cx = w / 2, cy = h / 2; let dx = x - cx, dy = y - cy; const k = Math.min((w / 2 - 40) / Math.abs(dx || 1), (h / 2 - 40) / Math.abs(dy || 1)); x = cx + dx * k; y = cy + dy * k;
      }
      el.className = `fmark ${cls}${off ? ' off' : ''}`;
      el.style.left = `${x}px`; el.style.top = `${y}px`;
      el.lastChild.innerHTML = label;
    };
    for (const o of this.targets()) {
      let rel = this.tpos(o).clone().sub(s.pos);
      const d = rel.length();
      if (L.units === 'rs') rel = rel.normalize().multiplyScalar(5e4);
      const dTxt = L.units === 'rs' ? `${fmt.n(d, d < 1 ? 4 : 1)} r_s` : fmt.km(d);
      place(o.id, rel, `${o.name}<br>${dTxt}`, o === tgSel ? 'sel' : '');
    }
    // prograde / retrograde relative to the selected target
    if (relVel.lengthSq() > 1e-10) {
      const dir = relVel.clone().normalize().multiplyScalar(L.units === 'rs' ? 5e4 : 1e4);
      place('pro', dir, '', 'pro'); place('retro', dir.clone().negate(), '', 'retro');
    }
    for (const [k, el] of this.markEls) el.style.display = seen.has(k) ? '' : 'none';
    // virtual stick
    this.dom.stick.style.left = `${50 + s.mouse.x * 8}%`; this.dom.stick.style.top = `${50 + s.mouse.y * 12}%`;
  }
}
