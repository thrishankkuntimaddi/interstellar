import * as THREE from 'three';
import { Ship } from './flight.js';
import { orbitalElements } from './locations.js';
import { ScaledLayer, skyLayer, shipScene, aimSun } from '../chapters/base.js';
import { launcherWithRanger, skyDome, groundPlane, cloudLayer, launchTower } from '../chapters/c02_launch.js';
import { createEarth } from '../world/planets.js';
import { createRanger } from '../world/ships.js';
import { createPlume, createSmokeTrail } from '../world/fx.js';
import { STAGES, PAYLOAD, ascentGuidance } from '../data/ascent.js';
import { PLANETS, fmt } from '../data/astro.js';
import { settings } from '../core/settings.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const G0 = 9.80665, MU = PLANETS.earth.gm, RE = PLANETS.earth.radiusKm * 1000;
const CENTER = 55;            // the vehicle's origin sits this far above the engine bells (m)
const NAMES = ['S-IC', 'S-II', 'S-IVB'];
const SITE = { lat: 28.57, lon: -80.65 }; // LC-39A
const _f = V(), _w = V();

/** The launch vehicle definition (not selectable in the hangar: it is what the pad gives you). */
export const LAUNCHER = {
  id: 'launcher', name: 'SATURN V', cls: 'Three-stage heavy launcher', rank: 0,
  accel: 1, boost: 1, rcs: 0, rate: 1, dv: 1, hull: 100, heat: 2, size: 1, radius: 30,
  collar: V(), dockAxis: V(0, 0, 1), gear: 0,
};

/**
 * A staged rocket: thrust, mass flow and drag from the same numbers as the film's ascent simulation.
 * Forward (+Z) is the nose. Held on the pad until thrust exceeds weight.
 */
export class Rocket extends Ship {
  constructor(def) {
    super(def, { accel: 12, boost: 1, rcs: 0, retro: 0, rate: 0.2, rollRate: 0.3 }, 1);
    this.reset();
  }
  reset() {
    this.stage = 0; this.prop = STAGES[0].mProp; this.lit = false; this.held = true;
    this.fuel = 1; this.hull = this.def.hull; this.q = 0; this.aoa = 0; this.simScale = 1; this.aT = 0; this.throttle = 0;
  }
  refill() { this.reset(); }
  get mass() {
    let m = PAYLOAD + this.prop;
    for (let i = this.stage; i < STAGES.length; i++) m += STAGES[i].mDry + (i > this.stage ? STAGES[i].mProp : 0);
    return m;
  }
  /** Δv left in the burning stage (Tsiolkovsky) */
  get dv() { const S = STAGES[this.stage]; if (!S || this.prop <= 0) return 0; const m = this.mass; return S.isp * G0 * Math.log(m / (m - this.prop)); }
  get stageName() { return NAMES[this.stage] || 'RANGER'; }
  /** drop the spent stage and light the next one */
  dropStage() {
    if (this.stage >= STAGES.length) return false;
    this.stage++; this.prop = STAGES[this.stage]?.mProp || 0; this.lit = this.stage < STAGES.length;
    return true;
  }
  thrust(input, dt) {
    const S = STAGES[this.stage], ap = this.ap;
    const r = this.pos.length(), h = Math.max(0, r - RE - CENTER);
    let thr = 0;
    if (S && this.lit && this.prop > 0) thr = ap && ap.thr != null ? ap.thr : Math.max(input.down('w') ? 1 : 0, this.throttle);
    const m = this.mass;
    const F = S ? S.F * (this.stage === 0 ? Math.min(1, 0.92 + (h / 40000) * 0.08) : 1) * thr : 0;
    const fw = this.forward(_f);
    const world = _w.copy(fw).multiplyScalar(F / m);
    const v = this.vel.length(), q = 0.5 * 1.225 * Math.exp(-h / 8500) * v * v;
    this.q = q;
    if (v > 1) { world.addScaledVector(this.vel, -(q * 0.5 * Math.PI * 25) / (m * v)); this.aoa = Math.acos(clamp(fw.dot(this.vel) / v, -1, 1)); } else this.aoa = 0;
    if (thr > 0 && !settings.infiniteFuel) this.prop = Math.max(0, this.prop - (F / (S.isp * G0)) * dt * this.simScale);
    this.fuel = S ? this.prop / S.mProp : 0;
    this.main = thr; this.power = thr; this.boosting = false; this.rcsLevel = 0;
    this.thrustLocal.set(0, 0, F / m); this.rcsLocal.set(0, 0, 0);
    this.gLoad = F / m; this.aT = S ? S.F / m : 0;
    if (this.held) { if (F / m > MU / (r * r)) this.held = false; else world.set(0, 0, 0); }
    return world;
  }
}

function siteDir(lat, lon) {
  const u = (lon + 180) / 360, v = (90 - lat) / 180;
  return V(-Math.cos(2 * Math.PI * u) * Math.sin(Math.PI * v), Math.cos(Math.PI * v), Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * v)).normalize();
}

/**
 * KENNEDY SPACE CENTER — a playable launch to orbit.
 * Inertial frame: the pad is at (0, R, 0), +X is east (downrange), the ascent stays in the XY plane.
 * Below 42 km the pad, fields and cloud decks are drawn (metres); above it the real Earth (km) takes over.
 */
export function buildLaunch(ctx) {
  const def = LAUNCHER;
  const sunDir = V(0.8, 0.42, -0.42).normalize();
  const pad = V(0, RE, 0);

  // ---- ground (metres, pad at the origin of this group)
  const ground = new THREE.Scene();
  ground.environment = ctx.envOurs; ground.environmentIntensity = 0.6;
  const world = new THREE.Group(); ground.add(world);
  const dome = skyDome(sunDir); ground.add(dome);
  const gp = groundPlane(sunDir); world.add(gp);
  const clouds = cloudLayer(3800, sunDir, 0.42), cirrus = cloudLayer(9500, sunDir, 0.3, 0.00008); world.add(clouds, cirrus);
  world.add(launchTower());
  const sunA = new THREE.DirectionalLight(0xfff1dc, 2.4); sunA.position.copy(sunDir).multiplyScalar(300); world.add(sunA, sunA.target);
  ground.add(new THREE.HemisphereLight(0xa8c4ff, 0x4a4030, 0.5));
  const track = []; // rocket base in the pad frame, sampled every 0.5 s of mission time
  const at = (T, out) => { const i = clamp(Math.floor(Math.max(0, T) * 2), 0, track.length - 1); return track.length ? out.copy(track[i]) : out.set(0, 0, 0); };
  const contrail = createSmokeTrail({ count: 2400, t0: 0, t1: 75, path: at, spread: 5, rise: 0.4, grow: 9, life: 80, size: 22, sunDir });
  const padSmoke = createSmokeTrail({ count: 900, t0: -0.5, t1: 14, path: (b, o) => o.set(Math.cos(b * 9.7) * 18, 4, Math.sin(b * 9.7) * 18), spread: 16, rise: 1.2, grow: 3, life: 40, size: 50, color: new THREE.Color(0.92, 0.9, 0.88), sunDir });
  world.add(contrail, padSmoke);
  const flame = new THREE.PointLight(0xff9a4a, 0, 1500, 1.2); world.add(flame);
  const groundLayer = { scene: ground, near: 0.5, far: 150000, visible: true };

  // ---- space (the real Earth in km, oriented so that LC-39A is under the pad)
  const sky = skyLayer('ours', 0);
  const bg = new ScaledLayer({ near: 0.5, far: 400000, scale: 0.001 });
  const up0 = siteDir(SITE.lat, SITE.lon), east0 = V().crossVectors(V(0, 1, 0), up0).normalize(), third = V().crossVectors(east0, up0).normalize();
  bg.basis.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east0, up0, third));
  const sunBg = sunDir.clone().applyQuaternion(bg.basis);
  const earth = createEarth({ radius: PLANETS.earth.radiusKm, sunDir: sunBg, kmPerUnit: 1, segments: 256 }); bg.scene.add(earth);

  // ---- the vehicle (metres): rocket axis +Y -> ship +Z, origin at mid-height
  const fg = shipScene({ sunDir, env: ctx.envOurs, intensity: 3.4, ambient: 0.3, shadowSize: 90 });
  fg.userData.hemi.color.set(0x8fb0e0); fg.userData.hemi.groundColor.set(0x3a3428);
  const fgLayer = { scene: fg, near: 0.5, far: 60000 };
  const ranger = createRanger();
  const rocket = launcherWithRanger(ranger), ru = rocket.userData;
  const plume3 = createPlume({ radius: 1.6, length: 30, color: new THREE.Color(0.7, 0.78, 1.0) });
  plume3.position.y = -1; plume3.rotation.x = Math.PI; ru.stage3.add(plume3);
  const home = [ru.stage1, ru.stage2].map((g) => g.position.clone());
  rocket.position.y = -CENTER;
  const rig = new THREE.Group(), tilt = new THREE.Group(); tilt.rotation.x = Math.PI / 2; tilt.add(rocket); rig.add(tilt);
  fg.add(rig);
  let rocketRef = null, T = -1, sep = [null, null], phaseSpace = false, lastTrack = -1, count = null;
  rig.userData = {
    rcs: [], cockpit: V(0, 0.6, (ru.rangerTop ?? 93) - CENTER + 2), spot: { intensity: 0 },
    blink() {},
    setThrust(v, t) {
      const st = rocketRef ? rocketRef.stage : 0, h = rocketRef ? rocketRef.pos.length() - RE : 0;
      ru.plume1.userData.set(st === 0 ? v : 0, t, clamp((h - 20000) / 50000));
      ru.plume2.userData.set(st === 1 ? v : 0, t, 0.6);
      plume3.userData.set(st === 2 ? v : 0, t, 0.8);
    },
  };

  const flags = {};
  const loc = {
    id: 'launch', name: 'Cape Canaveral', kicker: 'FREE FLIGHT · LC-39A · KENNEDY SPACE CENTER', units: 'm', bodyName: 'Earth',
    def, launch: true, warps: [1, 2, 4, 8], warpAlways: true,
    chase: { offset: V(-70, 14, 190), look: V(0, 0, 8), level: true },
    layers: [groundLayer, fgLayer], fg, sunDir, ranger: rig, objs: [],
    points: [{ id: 'pad', name: 'LC-39A', pos: pad.clone(), radius: 60 }],
    mu: MU, R: RE, music: 68,
    ship: { pos: V(0, RE + CENTER, 0), vel: V(), quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(-1, 0, 0), V(0, 1, 0))) },
    shipParams: {},
    makeShip() { rocketRef = new Rocket(def); return rocketRef; },
    gravity: (p, out) => { const r2 = p.lengthSq(), r = Math.sqrt(r2); return out.copy(p).multiplyScalar(-MU / (r2 * r)); },
    reset() {
      T = -1; sep = [null, null]; lastTrack = -1; track.length = 0; count = null;
      [ru.stage1, ru.stage2].forEach((g, i) => { g.visible = true; g.position.copy(home[i]); g.rotation.set(0, 0, 0); });
      ranger.visible = true; ru.stage3.visible = true;
      for (const k of Object.keys(flags)) delete flags[k];
    },
    /** Space: ignition, staging, and finally Ranger separation */
    key(k, X) {
      const s = X.ship;
      if (k !== ' ') return false;
      if (!s.lit && s.stage === 0 && !flags.liftoff) {
        if (count == null) { count = 3.2; X.say?.('Main engine start. Three. Two. One.', 3); X.toast('IGNITION SEQUENCE START', 'five F-1 engines · 35 MN', '#ffd49a', 3000); }
        return true;
      }
      if (s.stage >= STAGES.length) return true;
      const o = X.orb();
      if (o.altPe > 150e3) { // in orbit: let the Ranger go
        flags.sep = true; ranger.visible = false; X.cam.kick(0.6); X.sfx?.thud(0.6);
        X.say?.('Ranger separation. We are flying free.', 3);
        X.checkObjectives();
        X.transit({ title: 'RANGER SEPARATION', sub: 'the S-IVB falls behind · next: rendezvous with the Endurance', color: '#8fe3c0', t: 6, then: () => X.start('earth', 'dock') });
        return true;
      }
      if (s.stage === STAGES.length - 1) { X.toast('S-IVB IS THE LAST STAGE', s.prop > 0 ? 'keep burning: periapsis must clear 150 km' : 'out of propellant below orbital speed · P to restart', '#ff7a4d', 3500); return true; }
      const was = s.stage; sep[was] = 0; s.dropStage(); s.throttle = 1;
      X.cam.kick(1.0); X.sfx?.thud(0.9); ctx.engine.fx.uFlash.value = 0.5;
      X.toast(`STAGING · ${NAMES[was]} SEPARATION`, `${NAMES[s.stage]} ignition`, '#ffd49a', 3000);
      X.say?.(`Staging. ${was === 0 ? 'Second' : 'Third'} stage ignition.`, 3);
      return true;
    },
    update(s, dt, t, X) {
      // countdown -> ignition
      if (count != null && count > 0) { count -= dt; if (count <= 0) { s.lit = true; s.throttle = 1; T = 0; X?.cam.kick(1.5); X?.toast('LIFTOFF', 'the Endurance mission has cleared the pad', '#ffd49a', 3500); } }
      if (T >= 0) T += dt;
      const r = s.pos.length(), h = r - RE - CENTER;
      if (!flags.liftoff && !s.held && h > 2) { flags.liftoff = true; X?.say?.('Liftoff. We have liftoff.', 3); }
      flags.stage = s.stage; flags.h = h;
      // stage separation: the spent stage drifts back along the stack and tumbles
      [ru.stage1, ru.stage2].forEach((g, i) => {
        if (sep[i] == null) return;
        sep[i] += dt; const u = sep[i];
        g.position.set(home[i].x + u * u * 1.5, home[i].y - u * u * 9 - u * 6, home[i].z); g.rotation.set(u * 0.25, 0, u * 0.12);
        g.visible = u < 9;
      });
      // ground frame
      world.position.copy(pad).sub(s.pos);
      const base = s.forward(_f).multiplyScalar(-CENTER).add(s.pos).sub(pad);
      if (T >= 0 && Math.floor(T * 2) > lastTrack && T < 80) { lastTrack = Math.floor(T * 2); track[lastTrack] = base.clone(); for (let i = 0; i < lastTrack; i++) if (!track[i]) track[i] = base.clone(); }
      dome.userData.u.uAlt.value = h;
      gp.userData.u.uScorch.value = clamp(T / 6);
      contrail.userData.update(Math.max(T, 0)); padSmoke.userData.update(T < 0 ? -1 : T);
      clouds.userData.u.uTime.value = t;
      flame.position.copy(base).add(V(0, -6, 0)); flame.intensity = s.stage === 0 ? s.main * 9e3 : 0;
      sunA.target.position.copy(base); sunA.position.copy(base).addScaledVector(sunDir, 300); sunA.target.updateMatrixWorld();
      // hand over to the real Earth above the weather
      const space = h > 42000;
      if (space !== phaseSpace) { phaseSpace = space; ctx.engine.fx.uWhite.value = 0.55; }
      this.layers = space ? [sky, bg, fgLayer] : [groundLayer, fgLayer];
      sky.sky.userData.setGain(clamp((h - 30000) / 60000) * 0.95); sky.sky.userData.update(t);
      earth.userData.update(t);
      bg.origin.copy(s.pos).multiplyScalar(0.001).applyQuaternion(bg.basis);
      fg.userData.hemi.intensity = space ? 0.12 : 0.3;
      aimSun(fg, sunDir, V());
    },
    afterCamera(cam) {
      // keep the camera out of the ground while the stack is on (or near) the pad
      if (!phaseSpace) { const floor = world.position.y + 3; if (cam.position.y < floor) { cam.position.y = floor; cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); } }
      bg.sync(cam); sky.camera = bg.camera;
    },
    /** aerodynamic loads: flying sideways through max-Q breaks the stack */
    hazard(s) {
      const load = (s.q / 1000) * Math.sin(Math.min(s.aoa, Math.PI / 2));
      return load > 9 ? { dmg: (load - 9) * 2.2, label: 'AERODYNAMIC STRESS · POINT INTO THE AIRFLOW' } : null;
    },
    collide(s) {
      if (s.held) return null;
      const h = s.pos.length() - RE - CENTER;
      return h < -3 ? (s.vel.length() > 12 ? 'The vehicle came back down on the Cape.' : 'Fell back onto the pad.') : null;
    },
    telemetry(s) {
      const r = s.pos.length(), h = Math.max(0, r - RE - CENTER), up = s.pos.clone().multiplyScalar(1 / r);
      const vUp = s.vel.dot(up), vH = Math.sqrt(Math.max(0, s.vel.lengthSq() - vUp * vUp));
      const el = orbitalElements(s.pos, s.vel, MU);
      const pitch = 90 - (Math.acos(clamp(s.forward(_f).dot(up), -1, 1)) * 180) / Math.PI;
      const ev = count != null && count > 0 ? `T−${Math.ceil(count)}` : T < 0 ? 'HOLD · SPACE TO IGNITE' : !s.lit ? (s.stage >= STAGES.length ? 'RANGER FREE' : 'ENGINE CUTOFF') : `${s.stageName} BURN`;
      return [
        ['MISSION TIME', T < 0 ? 'T−00:00:00' : `T+${fmt.time(T)}`], ['EVENT', ev, T < 0 ? 'warn' : 'ok'],
        ['ALTITUDE', fmt.km(h)], ['VELOCITY', `${fmt.n(s.vel.length(), 0)} m/s`],
        ['VERTICAL · HORIZONTAL', `${fmt.n(vUp, 0)} · ${fmt.n(vH, 0)} m/s`],
        ['PITCH', `${fmt.n(pitch, 1)}°`], ['ACCEL', `${fmt.n(s.gLoad / G0, 2)} g`],
        ['DYN. PRESSURE', `${fmt.n(s.q / 1000, 1)} kPa`, s.q > 20000 ? 'warn' : ''],
        ['ANGLE OF ATTACK', `${fmt.n((s.aoa * 180) / Math.PI, 1)}°`, s.aoa > 0.2 && s.q > 8000 ? 'warn' : ''],
        ['STAGE', `${s.stageName} · ${fmt.n(s.fuel * 100, 0)}% · ${fmt.n(s.mass / 1000, 0)} t`],
        ['APOAPSIS', el.ra === Infinity ? 'ESCAPE' : fmt.km(Math.max(0, el.ra - RE))],
        ['PERIAPSIS', el.rp - RE > 0 ? fmt.km(el.rp - RE) : 'below the surface', el.rp - RE > 150e3 ? 'ok' : 'warn'],
      ];
    },
    /** What TARS flies: returns { dir, thr } for this instant, and presses Space when a stage is spent. */
    guide(s, X) {
      const r = s.pos.length(), up = s.pos.clone().multiplyScalar(1 / r);
      if (!s.lit && s.stage === 0 && !flags.liftoff) { if (count == null) this.key(' ', X); return { dir: up, thr: 1 }; }
      if (s.stage >= STAGES.length) return { done: true };
      const o = X.orb();
      if (o.altPe > 160e3) { if (!flags.sep) this.key(' ', X); return { thr: 0, done: true }; }
      if (s.prop <= 0) { if (s.stage < STAGES.length - 1) this.key(' ', X); return { dir: s.forward(), thr: 0 }; }
      const vUp = s.vel.dot(up), hv = s.vel.clone().addScaledVector(up, -vUp), vE = hv.length();
      const east = vE > 80 ? hv.multiplyScalar(1 / vE) : V(up.y, -up.x, 0).normalize();
      const g = ascentGuidance({ h: r - RE - CENTER, v: s.vel.length(), vUp, vE, r, stage: s.stage, aT: s.aT });
      if (g.cut) return { dir: east, thr: 0 };
      return { dir: east.multiplyScalar(Math.cos(g.pitch)).addScaledVector(up, Math.sin(g.pitch)), thr: g.thr, pitch: g.pitch };
    },
  };
  loc.flags = flags;
  return loc;
}
