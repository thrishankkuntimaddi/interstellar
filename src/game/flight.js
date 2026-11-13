import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { settings } from '../core/settings.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = V(), _b = V(), _c = V(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

/**
 * Six-degree-of-freedom spacecraft. State is double precision (plain JS numbers in Vector3),
 * integrated with velocity-Verlet under an external gravity field supplied by the location.
 * Units are whatever the location uses (metres, or r_s at Gargantua): the location supplies the
 * baseline accelerations, the ship definition scales them.
 * Propellant is tracked as a Δv budget: every m/s of thrust applied is a m/s spent (Tsiolkovsky, integrated).
 */
export const SAS_MODES = ['OFF', 'PROGRADE', 'RETROGRADE', 'TARGET', 'ANTI-TARGET', 'RADIAL OUT', 'BRAKE'];
export class Ship {
  constructor(def, base = {}, dvBudget = 12000) {
    const { accel = 12, boost = 4, rcs = 3, retro = 6, rate = 0.9, rollRate = 1.2 } = base;
    this.def = def;
    this.pos = V(); this.vel = V(); this.quat = new THREE.Quaternion();
    this.w = V(); // body angular velocity (rad/s): x pitch, y yaw, z roll
    this.p = { accel: accel * def.accel, boost: boost * def.boost, rcs: rcs * def.rcs, retro: retro * def.accel, rate: rate * def.rate, rollRate: rollRate * def.rate };
    this.thrustLocal = V(); this.rcsLocal = V(); this.torque = V(); this.gLoad = 0; this.main = 0; this.rcsLevel = 0; this.boosting = false;
    this.fa = settings.flightAssist;
    this.docked = null; this.landed = null;
    this.mouse = { x: 0, y: 0 }; this.stick = { x: 0, y: 0 };
    this.fuel = 1; this.dvBudget = dvBudget; this.dvSpent = 0;
    this.hull = def.hull; this.throttle = 0; this.sas = 0; this.lights = false;
    this.ap = null; this.apPower = 0; this.held = false;
  }
  forward(out = V()) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  up(out = V()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  get dv() { return this.fuel * this.dvBudget; }
  damage(n) { if (!settings.invulnerable) this.hull = Math.max(0, this.hull - n * (settings.easy ? 0.5 : 1)); }
  refill() { this.fuel = 1; this.hull = this.def.hull; }

  /**
   * input.down(key); matchVel: relative velocity to null with X (or null); sasDir: world direction to hold (or null).
   * this.ap (set by the copilot): { acc: wanted world acceleration, boost, dir: forward to hold, quat: full attitude to hold }
   */
  control(input, dt, matchVel, sasDir) {
    const world = this.thrust(input, dt, matchVel);
    this.steer(input, dt, sasDir);
    return world;
  }

  thrust(input, dt, matchVel) {
    const k = (c) => input.down(c);
    const p = this.p;
    const dry = this.fuel <= 0 && !settings.infiniteFuel;
    const fwd = dry ? 0 : Math.max(k('w') ? 1 : 0, this.throttle);
    this.boosting = k('shift') && fwd > 0;
    const t = this.thrustLocal.set(0, 0, 0), r = this.rcsLocal.set(0, 0, 0);
    if (!dry) {
      if (k('s')) r.z -= p.retro;
      if (k('d')) r.x -= p.rcs; if (k('a')) r.x += p.rcs;
      if (k('r')) r.y += p.rcs; if (k('f')) r.y -= p.rcs;
    }
    t.copy(r); t.z += fwd * p.accel * (this.boosting ? p.boost : 1);
    this.main = fwd > 0 ? Math.min(1, fwd * (this.boosting ? 1 : 0.55) + 0.1) : 0;
    const world = _a.copy(t).applyQuaternion(this.quat);
    if (matchVel && k('x') && !dry) {
      // automatic velocity matching (RCS + main), capped at the main-engine acceleration
      const dv = _b.copy(matchVel).negate();
      const mag = dv.length();
      if (mag > 1e-9) { world.add(dv.multiplyScalar(Math.min(p.accel, mag / dt) / mag)); r.add(_c.copy(dv).applyQuaternion(_q2.copy(this.quat).invert())); }
    }
    const ap = this.ap;
    if (ap && ap.acc && !dry) {
      // the copilot flies with the same engines: any direction up to the main-engine acceleration (boost if it asks)
      const max = p.accel * (ap.boost ? p.boost : 1), m = ap.acc.length();
      if (m > 1e-12) {
        _b.copy(ap.acc).multiplyScalar(Math.min(1, max / m)); world.add(_b);
        _c.copy(_b).applyQuaternion(_q2.copy(this.quat).invert()); r.add(_c);
        const along = Math.max(0, _c.z) / p.accel;
        if (along > 0.03) this.main = Math.max(this.main, Math.min(1, along * 0.55 + 0.1));
        if (ap.boost && along > 1.05) this.boosting = true;
        this.apPower = Math.min(1, m / max);
      } else this.apPower = 0;
    }
    if (this.docked) world.set(0, 0, 0);
    this.rcsLevel = r.lengthSq() > 0 || k('q') || k('e') ? 1 : 0;
    this.gLoad = world.length();
    // propellant
    const spent = this.gLoad * dt;
    if (spent > 0 && !settings.infiniteFuel) { this.fuel = Math.max(0, this.fuel - spent / this.dvBudget); this.dvSpent += spent; }
    return world;
  }

  /** rotation: mouse / stick = rate command (virtual stick), keys = roll, SAS / copilot = attitude hold */
  steer(input, dt, sasDir) {
    const k = (c) => input.down(c), p = this.p, ap = this.ap;
    const inv = settings.invertY ? -1 : 1;
    const sx = this.mouse.x + this.stick.x, sy = this.mouse.y + this.stick.y;
    const cmd = V(-sy * inv * p.rate, -sx * p.rate, ((k('e') ? 1 : 0) - (k('q') ? 1 : 0)) * p.rollRate);
    const manual = Math.hypot(sx, sy) > 0.06;
    const dir = (ap && ap.dir) || sasDir, att = ap && ap.quat;
    this.sasErr = null;
    if (att && !manual) {
      _q.copy(this.quat).invert().multiply(att);
      if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
      const ang = 2 * Math.acos(Math.min(1, _q.w)), sn = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
      if (sn > 1e-5) { const rate = Math.min(p.rate * 1.3, ang * 2.2) / sn; cmd.x += _q.x * rate; cmd.y += _q.y * rate; cmd.z += _q.z * rate; }
      this.sasErr = ang;
    } else if (dir && !manual) {
      const f = this.forward(_c); const ang = Math.acos(Math.min(1, Math.max(-1, f.dot(dir))));
      const ax = _b.crossVectors(f, dir);
      if (ax.lengthSq() < 1e-10) ax.set(1, 0, 0); else ax.normalize().applyQuaternion(_q2.copy(this.quat).invert());
      const rate = Math.min(p.rate * 1.3, ang * 2.2);
      cmd.x += ax.x * rate; cmd.y += ax.y * rate; cmd.z += ax.z * rate;
      this.sasErr = ang;
    }
    this.torque.copy(cmd).sub(this.w);
    if (this.fa || dir || att) this.w.lerp(cmd, 1 - Math.exp(-dt * 4));
    else this.w.addScaledVector(cmd, dt * 1.2);
    // the virtual stick slowly re-centres
    this.mouse.x *= Math.exp(-dt * 2.5); this.mouse.y *= Math.exp(-dt * 2.5);
  }

  integrate(dt, accelWorld, gravity) {
    if (this.docked || this.landed || this.held) return;
    // velocity-Verlet
    gravity(this.pos, _b);
    const ax = _b.x + accelWorld.x, ay = _b.y + accelWorld.y, az = _b.z + accelWorld.z;
    this.pos.x += this.vel.x * dt + 0.5 * ax * dt * dt;
    this.pos.y += this.vel.y * dt + 0.5 * ay * dt * dt;
    this.pos.z += this.vel.z * dt + 0.5 * az * dt * dt;
    gravity(this.pos, _b);
    this.vel.x += 0.5 * (ax + _b.x + accelWorld.x) * dt;
    this.vel.y += 0.5 * (ay + _b.y + accelWorld.y) * dt;
    this.vel.z += 0.5 * (az + _b.z + accelWorld.z) * dt;
  }
  rotate(dt) {
    const w = this.w; const ang = w.length() * dt;
    if (ang > 1e-9) { _q.setFromAxisAngle(_a.copy(w).normalize(), ang); this.quat.multiply(_q).normalize(); }
  }
}

/** A free body (another spacecraft, the wormhole…) that just coasts under gravity. */
export class Body {
  constructor(pos, vel) { this.pos = pos.clone(); this.vel = vel.clone(); }
  step(dt, gravity) {
    gravity(this.pos, _b);
    this.pos.addScaledVector(this.vel, dt).addScaledVector(_b, 0.5 * dt * dt);
    const ax = _b.x, ay = _b.y, az = _b.z;
    gravity(this.pos, _b);
    this.vel.x += 0.5 * (ax + _b.x) * dt; this.vel.y += 0.5 * (ay + _b.y) * dt; this.vel.z += 0.5 * (az + _b.z) * dt;
  }
}

export const CAM_MODES = ['CHASE', 'COCKPIT', 'ORBIT', 'CINEMATIC', 'TARGET'];

/** Cameras for free flight, in ship-relative (floating origin) space: ship is at the origin. */
export class FlightCamera {
  constructor(camera, dom) {
    this.cam = camera; this.mode = 0;
    this.pos = V(0, 5, -26); this.first = true;
    this.orbit = new OrbitControls(camera, dom); this.orbit.enabled = false; this.orbit.enableDamping = true; this.orbit.enablePan = false;
    this.cine = { pos: V(), until: 0 };
    this.chase = { offset: V(0, 6.5, -30), look: V(0, 0.5, 26), level: false };
    this.shakeT = 0; this.scale = 1; this.zoom = 1; this.kickAmt = 0;
    dom.addEventListener('wheel', (e) => { if (this.mode === 0 || this.mode === 4) this.zoom = Math.min(4, Math.max(0.45, this.zoom * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: true });
  }
  cycle() { this.setMode((this.mode + 1) % CAM_MODES.length); }
  /** impulse shake (collisions, hard docks) */
  kick(a) { this.kickAmt = Math.min(3, this.kickAmt + a); }
  setMode(m) { this.mode = m; this.first = true; this.orbit.enabled = m === 2; if (m === 2) { this.cam.position.set(18, 8, -30).multiplyScalar(this.scale); this.orbit.target.set(0, 0, 0); } }
  get name() { return CAM_MODES[this.mode]; }

  update(ship, dt, t, shipObj, { targetRel = null } = {}) {
    const cam = this.cam;
    const fovBase = settings.fov;
    cam.fov += ((ship.boosting ? fovBase + 8 : fovBase) - cam.fov) * (1 - Math.exp(-dt * 3));
    const q = ship.quat;
    if (this.mode === 0) {
      const c = this.chase;
      if (c.level) {
        // tracking camera in the local-level frame (launch): the horizon stays level while the vehicle pitches over
        const up = ship.pos.clone().normalize(), east = V(up.y, -up.x, 0).normalize(), south = V().crossVectors(east, up);
        const o = c.offset, z = this.scale * this.zoom;
        const want = V().addScaledVector(east, o.x * z).addScaledVector(up, o.y * z).addScaledVector(south, o.z * z);
        if (this.first) { this.pos.copy(want); this.first = false; }
        this.pos.lerp(want, 1 - Math.exp(-dt * 3));
        cam.position.copy(this.pos); cam.up.copy(up);
        cam.lookAt(ship.forward().multiplyScalar(c.look.z * this.scale));
      } else {
        const want = c.offset.clone().multiplyScalar(this.scale * this.zoom).applyQuaternion(q);
        // the camera lags a little behind accelerations — sells mass and speed
        if (this.first) { this.pos.copy(want); this.first = false; }
        this.pos.lerp(want, 1 - Math.exp(-dt * 5));
        cam.position.copy(this.pos);
        cam.up.set(0, 1, 0).applyQuaternion(q);
        cam.lookAt(c.look.clone().multiplyScalar(this.scale).applyQuaternion(q));
      }
    } else if (this.mode === 1) {
      cam.position.copy(shipObj.userData.cockpit).applyQuaternion(q);
      cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI));
    } else if (this.mode === 2) {
      this.orbit.target.set(0, 0, 0);
      this.orbit.update();
    } else if (this.mode === 4 && targetRel) {
      // over-the-shoulder: ship in the foreground, the selected target framed behind it
      const d = targetRel.clone(); const dist = d.length(); d.normalize();
      const up = ship.up();
      const zs = this.scale * this.zoom;
      const want = d.clone().multiplyScalar(-28 * zs).addScaledVector(up, 7 * zs).add(V().crossVectors(d, up).normalize().multiplyScalar(6 * zs));
      if (this.first) { this.pos.copy(want); this.first = false; }
      this.pos.lerp(want, 1 - Math.exp(-dt * 3));
      cam.position.copy(this.pos); cam.up.copy(up);
      cam.lookAt(d.multiplyScalar(Math.min(dist, 2000) * 0.5));
    } else {
      // cinematic: a static "long lens" camera placed ahead of the ship; re-placed once it falls behind
      const rel = this.cine.pos;
      const vdir = ship.vel.lengthSq() > 1e-12 ? ship.forward() : ship.forward();
      if (t > this.cine.until || rel.length() > 400) {
        const side = V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        rel.copy(vdir).multiplyScalar((60 + Math.random() * 80) * this.scale).addScaledVector(side, (14 + Math.random() * 20) * this.scale);
        this.cine.until = t + 5 + Math.random() * 3;
        this.cine.fov = 22 + Math.random() * 20;
      }
      // the world moves relative to the ship; the camera is fixed in the world frame
      rel.addScaledVector(ship.velRelRender || V(), -dt);
      cam.position.copy(rel);
      cam.up.set(0, 1, 0).applyQuaternion(q);
      cam.lookAt(0, 0, 0);
      cam.fov = this.cine.fov;
    }
    // shake from engines
    this.kickAmt *= Math.exp(-dt * 3.5);
    const sh = settings.shake * ((ship.boosting ? 0.12 : ship.main > 0.2 ? 0.03 : 0) + this.kickAmt + (ship.heat || 0) * 0.25);
    if (sh > 0 && this.mode !== 2) { this.shakeT += dt; cam.position.add(V(Math.sin(this.shakeT * 53), Math.sin(this.shakeT * 41 + 1), Math.sin(this.shakeT * 37 + 2)).multiplyScalar(sh)); }
    cam.updateProjectionMatrix();
  }
}
