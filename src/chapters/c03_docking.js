import { model } from '../world/models.js';
import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, clamp, easeInOut, easeOut } from '../core/util.js';
import { ScaledLayer, skyLayer, shipScene, aimSun } from './base.js';
import { createEarth } from '../world/planets.js';
import { createEndurance, createRanger } from '../world/ships.js';
import { fmt } from '../data/astro.js';

const MU = 3.986004418e14, RE = 6371e3, ALT = 400e3;

/** Docked pose of a Ranger on the forward hub port: dorsal collar on the spin axis. */
export function dockPose(out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, standoff = 0) {
  const m = new THREE.Matrix4().makeBasis(V(1, 0, 0), V(0, 0, -1), V(0, 1, 0));
  out.quat.setFromRotationMatrix(m);
  out.pos.set(0, 3.08, 10.8 + standoff);
  return out;
}

export default {
  id: 'docking', kicker: 'PHASE 1 · EARTH ORBIT', title: 'Rendezvous', start: 140, end: 205,
  build(ctx) {
    const sunFg = V(0.55, 0.38, 0.74).normalize();
    const bg = new ScaledLayer({ near: 1, far: 300000, scale: 0.001 });
    bg.origin.set(0, (RE + ALT) / 1000, 0);
    const earth = createEarth({ radius: 6371, sunDir: sunFg, kmPerUnit: 1, segments: 256 });
    bg.scene.add(earth);
    const sky = skyLayer('ours', 0.9);
    const fg = shipScene({ sunDir: sunFg, env: ctx.envOurs, intensity: 3.6, shadowSize: 50 });
    const endurance = createEndurance();
    fg.add(endurance);
    // the real ISS and Hubble share the orbit (NASA 3D Resources)
    const iss = model('iss'); if (iss) { iss.position.set(-950, 140, -1900); iss.rotation.set(0.15, 0.9, 0.05); fg.add(iss); }
    const hst = model('hubble'); if (hst) { hst.position.set(420, -70, -620); hst.rotation.set(0.5, -0.7, 0.3); fg.add(hst); }
    endurance.userData.flood.intensity = 12;
    const ranger = createRanger();
    fg.add(ranger);
    const fgLayer = { scene: fg, near: 0.3, far: 60000 };

    const dock = dockPose();
    const state = { ex: 3.2, ey: -2.1, roll: 0.21, vx: 0, vy: 0, vr: 0, captured: false, quality: 0, user: 0 };
    const reset = () => Object.assign(state, { ex: 3.2, ey: -2.1, roll: 0.21, vx: 0, vy: 0, vr: 0, captured: false, user: 0 });
    let lastLt = 0;
    const tmp = new THREE.Vector3(), q = new THREE.Quaternion();

    // range (m) along the approach axis as a function of chapter time
    const range = (lt) => {
      if (lt < 12) return lerp(420, 150, easeInOut(seg(lt, 0, 12)));
      if (lt < 22) return lerp(150, 60, seg(lt, 12, 22));
      if (lt < 52) return lerp(60, 0, Math.pow(seg(lt, 22, 52), 0.8));
      return 0;
    };

    const ch = {
      layers: [sky, bg, fgLayer],
      allLayers: [sky, bg, fgLayer],
      subject: ranger, sunDir: sunFg,
      chase: { offset: V(0, -4, -24), look: V(0, 1, 8) },
      cockpit: ranger.userData.cockpit, freeDist: 70,
      enter() { reset(); },
      update(lt, dt) {
        if (lt < lastLt - 0.5 || lt < 22) { if (lt < 22) reset(); }
        lastLt = lt;
        earth.userData.update(lt);
        earth.rotation.y = 0.6 + lt * 0.0045; // ground track scrolling beneath (orbital motion)
        sky.sky.userData.update(lt);
        // interactive alignment
        if (lt >= 22 && lt < 52 && !state.captured) {
          const a = ctx.input.axis();
          if (a.x || a.y || a.roll) state.user += dt;
          const assist = lerp(0.04, 0.9, Math.pow(seg(lt, 22, 50), 2));
          // disturbances: residual drift and RCS noise
          state.vx += (a.x * 0.9 + Math.sin(lt * 0.7) * 0.05) * dt;
          state.vy += (a.y * 0.9 + Math.cos(lt * 0.53) * 0.05) * dt;
          state.vr += (a.roll * 0.25) * dt;
          state.vx *= Math.exp(-dt * 1.2); state.vy *= Math.exp(-dt * 1.2); state.vr *= Math.exp(-dt * 1.5);
          state.ex += state.vx * dt; state.ey += state.vy * dt; state.roll += state.vr * dt;
          const k = Math.exp(-assist * dt);
          state.ex *= k; state.ey *= k; state.roll *= k;
        }
        if (lt >= 52) { state.captured = true; state.ex = state.ey = state.roll = 0; }
        const err = Math.hypot(state.ex, state.ey);
        state.quality = 1 - clamp(err / 3.8);
        // ranger pose
        const r = range(lt);
        const lateral = lt < 22 ? V(lerp(40, 3.2, sseg(lt, 0, 22)), lerp(-18, -2.1, sseg(lt, 0, 22)), 0) : V(state.ex, state.ey, 0);
        ranger.position.copy(dock.pos).add(V(0, 0, r)).add(lateral);
        q.setFromAxisAngle(V(0, 0, 1), lt < 22 ? lerp(0.6, 0.21, sseg(lt, 0, 22)) : state.roll);
        ranger.quaternion.copy(q).multiply(dock.quat);
        if (lt < 12) ranger.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), lerp(-0.4, 0, sseg(lt, 0, 12))));
        const pulse = lt > 12 && lt < 52 ? (Math.sin(lt * 3.1) > 0.85 ? 0.15 : 0) : 0;
        ranger.userData.setThrust(lt < 10 ? 0.25 * (1 - seg(lt, 6, 10)) : pulse, lt);
        ranger.userData.blink(lt);
        ranger.userData.spot.intensity = lt > 18 ? 60 : 0;
        // port lights: amber while approaching, green on capture
        const lampCol = state.captured ? new THREE.Color(0.3, 1.0, 0.5).multiplyScalar(4) : new THREE.Color(1.0, 0.6, 0.2).multiplyScalar(0.9 + Math.sin(lt * 6) * 0.6);
        endurance.userData.ports.forEach((p) => p.children[2].material.color.copy(lampCol));
        aimSun(fg, sunFg, V(0, 0, 6));
      },
      afterCamera(cam) { bg.sync(cam); sky.camera = bg.camera; },
      shot(lt, cam) {
        cam.fov = 45;
        const R = ranger.position;
        if (lt < 7) {
          const u = easeInOut(seg(lt, 0, 7));
          lookAt(cam, V(lerp(-150, -95, u), lerp(-25, -12, u), lerp(-60, 40, u)), V(0, -4, 10).lerp(V(0, 0, 0), u));
          cam.fov = 40;
        } else if (lt < 12) {
          cam.fov = 28;
          lookAt(cam, V(18, 6, 26), R.clone().lerp(V(0, 0, 0), 0.25));
        } else if (lt < 17) {
          const u = seg(lt, 12, 17);
          cam.fov = 50;
          lookAt(cam, R.clone().add(V(lerp(-14, -9, u), 4, lerp(-8, 6, u))), R.clone().add(V(0, 0, -4)));
        } else if (lt < 22) {
          cam.fov = 38;
          lookAt(cam, V(-30, 22, 70), V(0, 0, 25));
        } else if (lt < 52) {
          // docking camera on the Ranger's dorsal collar, looking along the docking axis
          cam.fov = 55;
          ranger.updateMatrixWorld();
          const p = ranger.localToWorld(V(0, 3.3, -3.08));
          const fwd = V(0, 1, 0).applyQuaternion(ranger.quaternion);
          const up = V(0, 0, 1).applyQuaternion(ranger.quaternion);
          lookAt(cam, p, p.clone().add(fwd), up);
        } else if (lt < 58) {
          cam.fov = 35;
          const u = seg(lt, 52, 58);
          lookAt(cam, V(lerp(14, 9, u), lerp(10, 6, u), 24), V(0, 1.5, 9));
        } else {
          cam.fov = 40;
          const u = easeInOut(seg(lt, 58, 65));
          const a = 0.4 + u * 0.9;
          lookAt(cam, V(Math.cos(a) * 110, lerp(20, -30, u), Math.sin(a) * 110), V(0, 0, 0));
        }
        cam.updateProjectionMatrix();
      },
      interact(lt) {
        if (lt < 22 || lt >= 58) return null;
        const err = Math.hypot(state.ex, state.ey);
        let x = 0.5, y = 0.5;
        if (lt < 52) {
          const cam = ctx.engine.camera;
          const p = V(0, 0, 7.9).project(cam);
          x = 0.5 + p.x * 0.5; y = 0.5 - p.y * 0.5;
        }
        const capture = state.captured;
        return {
          title: capture ? 'HARD DOCK CONFIRMED' : 'MANUAL DOCKING · ENDURANCE HUB',
          body: capture
            ? `Capture latches engaged. Final error ${fmt.n(err * 100, 1)} cm. ${state.user > 1 ? 'Nice flying.' : 'Autopilot assisted.'}`
            : `Range <b>${fmt.n(range(lt), 1)} m</b> · lateral error <b>${fmt.n(err * 100, 0)} cm</b> · roll <b>${fmt.n((state.roll * 180) / Math.PI, 1)}°</b>`,
          hint: capture ? '' : 'W/A/S/D translate · Q/E roll · centre the green box in the ring (autopilot assists as range closes)',
          progress: capture ? 1 : state.quality,
          color: err < 0.3 ? '#8fe3c0' : '#ffd49a',
          reticle: lt < 52 ? { x, y, ok: err < 0.3 } : null,
        };
      },
      telemetry(lt) {
        const r = RE + ALT;
        const v = Math.sqrt(MU / r);
        const err = Math.hypot(state.ex, state.ey);
        const rate = lt < 52 ? (range(lt) - range(lt + 0.1)) / 0.1 : 0;
        return [
          ['ORBIT', `${fmt.n(ALT / 1000, 0)} km circular`],
          ['ORBITAL VELOCITY', `${fmt.n(v, 0)} m/s`],
          ['PERIOD', `${fmt.n((2 * Math.PI * Math.sqrt(r ** 3 / MU)) / 60, 1)} min`],
          ['TARGET', 'ENDURANCE · HUB PORT A'],
          ['RANGE', `${fmt.n(range(lt), 1)} m`],
          ['CLOSING RATE', `${fmt.n(rate, 2)} m/s`, rate > 3 ? 'warn' : ''],
          ['LATERAL ERROR', `${fmt.n(err * 100, 0)} cm`, err < 0.3 ? 'ok' : 'warn'],
          ['ROLL ERROR', `${fmt.n((state.roll * 180) / Math.PI, 2)}°`],
          ['STATUS', state.captured ? 'HARD DOCK' : lt > 22 ? 'FINAL APPROACH' : 'RENDEZVOUS', state.captured ? 'ok' : ''],
        ];
      },
      telemetrySource: () => 'v = √(μ/r) · μ⊕ = 3.986 × 10¹⁴ m³/s²',
      fx(lt) {
        return { letterbox: lt >= 22 && lt < 52 ? 0 : 1, flash: bump(lt, 51.8, 52.1, 52.3, 53.2) * 0.25, bloom: 0.7, exposure: 1.0, aberration: lt >= 22 && lt < 52 ? 0.003 : 0.0015 };
      },
      cards: [[1, 6, 'ENDURANCE', 'twelve modules · 64 metres · assembled in low Earth orbit']],
      logs: [
        [7, 'CREW', 'There she is. Range four hundred metres, closing.', 5],
        [13, 'TARS', 'Matching rotation and velocity. Over to you for final approach.', 5],
        [23, 'TARS', 'Take it slow. The collar has six centimetres of tolerance.', 5],
        [40, 'CREW', 'Steady… steady…', 3.5],
        [52.3, 'TARS', 'Contact. Latches engaged. Hard dock.', 4.5],
        [58, 'CREW', 'Welcome aboard the Endurance.', 4],
      ],
    };
    return ch;
  },
};
