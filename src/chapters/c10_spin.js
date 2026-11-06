import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, clamp, easeInOut, easeOut, shake } from '../core/util.js';
import { ScaledLayer, skyLayer, shipScene, aimSun } from './base.js';
import { createAlienPlanet } from '../world/planets.js';
import { createEndurance, createRanger } from '../world/ships.js';
import { createExplosion } from '../world/fx.js';
import { dockPose } from './c03_docking.js';
import { drawSystem, SYS } from './gsys.js';
import { ENDURANCE, fmt } from '../data/astro.js';

const W68 = (67.8 * 2 * Math.PI) / 60; // rad/s
const T_BOOM = 28, T_SPIN = 34, T_CONTACT = 76, T_STILL = 86;

/** Endurance spin rate after the explosion, then de-spin once the Ranger is locked on. */
function endRate(lt) {
  if (lt < T_BOOM) return 0;
  if (lt < T_SPIN) return W68 * smooth(seg(lt, T_BOOM, T_SPIN));
  if (lt < T_CONTACT + 1) return W68;
  return W68 * (1 - smooth(seg(lt, T_CONTACT + 1, T_STILL)));
}
function endAngle(lt) { // numeric integral of endRate (piecewise, deterministic)
  let a = 0; const step = 0.02;
  for (let t = T_BOOM; t < lt; t += step) a += endRate(t + step * 0.5) * Math.min(step, lt - t);
  return a;
}

export default {
  id: 'spin', kicker: 'PHASE 3 · ORBIT OF MANN', title: 'No Time for Caution', start: 742, end: 832,
  build(ctx) {
    const sunDir = V(-0.55, 0.3, 0.78).normalize();
    const sky = skyLayer('other', 1.0);
    const P = new ScaledLayer({ near: 5, far: 2e6, scale: 0.001 });
    const planet = createAlienPlanet({ type: 1, radius: 5900, sunDir, kmPerUnit: 1, seed: 2.7 });
    P.scene.add(planet);
    const fg = shipScene({ sunDir, env: ctx.envOther, intensity: 2.8, ambient: 0.1, shadowSize: 55 });
    const end = createEndurance();
    fg.add(end);
    end.userData.flood.intensity = 20;
    const spin = end.userData.spin;
    // modules lost in the blast
    const lost = [spin.children.indexOf(end.userData.modules[0]), spin.children.indexOf(end.userData.modules[1])].map((i) => spin.children[i]);
    const lostTubes = spin.children.filter((c, i) => c.geometry?.type === 'CylinderGeometry' && Math.abs(c.position.length() - 32) < 1).slice(0, 2);
    const debris = [...lost, ...lostTubes].map((m, i) => {
      const c = m.clone(); c.visible = false; fg.add(c);
      return { src: m, clone: c, p0: m.position.clone(), r0: m.rotation.clone(), v: V(m.position.x, m.position.y, 6 + i * 3).normalize().multiplyScalar(9 + i * 2), w: V(0.6 + i * 0.3, 1.1, 0.4) };
    });
    const mann = createRanger(); fg.add(mann);
    const hero = createRanger(); fg.add(hero);
    const boom = createExplosion({ scale: 7, debris: 160 });
    boom.position.set(0, 0, 9); fg.add(boom);
    const fire = new THREE.PointLight(0xff7a30, 0, 120, 1.5); fire.position.set(0, 0, 8); fg.add(fire);
    const fgLayer = { scene: fg, near: 0.3, far: 60000 };
    const dock = dockPose();

    const st = { w: 0, phi: 0, user: 0, locked: false };
    const reset = () => Object.assign(st, { w: 0, phi: 0, user: 0, locked: false });
    const q = new THREE.Quaternion(), qz = new THREE.Quaternion(), Z = V(0, 0, 1);
    let eAng = 0;

    const heroStandoff = (lt) => (lt < 36 ? lerp(420, 120, seg(lt, 0, 36)) : lt < 48 ? lerp(120, 30, easeOut(seg(lt, 36, 48))) : lt < T_CONTACT ? lerp(30, 0, Math.pow(seg(lt, 48, T_CONTACT), 1.4)) : 0);

    const ch = {
      layers: [sky, P, fgLayer], allLayers: [sky, P, fgLayer],
      subject: hero, sunDir, chase: { offset: V(0, -5, -26), look: V(0, 2, 10) }, cockpit: hero.userData.cockpit, freeDist: 90,
      wantsSpace: (lt) => lt > 44 && lt < 78,
      enter() { reset(); },
      update(lt, dt) {
        if (lt < 48) reset();
        sky.sky.userData.update(lt);
        planet.userData.update(lt);
        // orbit decays after the blast: the planet's limb rises until we stabilise
        const alt = lt < T_BOOM ? 380 : lt < T_STILL ? lerp(380, 165, seg(lt, T_BOOM, T_STILL)) : 165;
        P.origin.set(0, 5900 + alt, 0);
        eAng = endAngle(lt);
        spin.rotation.z = eAng;
        // wobble from the asymmetric mass loss
        const wob = lt > T_BOOM && lt < T_STILL ? 0.08 * smooth(seg(lt, T_BOOM, T_BOOM + 4)) * (1 - seg(lt, T_CONTACT, T_STILL)) : 0;
        end.rotation.set(Math.sin(eAng * 0.13) * wob, Math.cos(eAng * 0.13) * wob, 0);
        // blast
        const age = lt - T_BOOM;
        boom.userData.update(age, lt);
        fire.intensity = age > 0 ? Math.max(0, 1 - age / 20) * 4000 * (0.7 + 0.3 * Math.sin(lt * 23)) : 0;
        debris.forEach((d) => {
          d.src.visible = age < 0; d.clone.visible = age >= 0;
          if (age >= 0) {
            d.clone.position.copy(d.p0).applyAxisAngle(Z, endAngle(T_BOOM)).addScaledVector(d.v, age);
            d.clone.rotation.set(d.r0.x + d.w.x * age, d.r0.y + d.w.y * age, d.r0.z + d.w.z * age);
          }
        });
        // Mann's Ranger: approach and a bad dock
        const mStand = lt < 20 ? lerp(160, 0, easeOut(seg(lt, 0, 20))) : 0;
        mann.visible = age < 0.2;
        mann.position.copy(dock.pos).add(V(0.6, -0.4, mStand));
        mann.quaternion.copy(dock.quat).premultiply(qz.setFromAxisAngle(Z, 0.12));
        mann.userData.setThrust(lt < 18 ? 0.3 : 0, lt); mann.userData.blink(lt);
        // hero Ranger: hold off, then align on the axis and match the spin
        if (lt >= 48 && lt < T_CONTACT && !st.locked) {
          const a = ctx.input.axis();
          const throttle = (a.thrust || a.roll > 0 ? 1 : 0) - (a.roll < 0 ? 1 : 0);
          if (throttle) st.user += dt;
          st.w += throttle * 1.9 * dt;
          const assist = lerp(0.05, 1.6, Math.pow(seg(lt, 48, T_CONTACT - 2), 2.2));
          st.w += (W68 - st.w) * (1 - Math.exp(-assist * dt));
          st.w = clamp(st.w, 0, W68 * 1.4);
          st.phi += st.w * dt;
          // phase alignment assist (collar keyways)
          let dphi = ((eAng - st.phi) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
          st.phi += dphi * (1 - Math.exp(-assist * 0.8 * dt));
        }
        if (lt >= T_CONTACT) st.locked = true;
        const phi = lt < 48 ? 0 : st.locked ? eAng : st.phi;
        const stand = heroStandoff(lt);
        hero.position.copy(dock.pos).add(V(0, 0, stand)).applyAxisAngle(Z, phi);
        hero.quaternion.copy(dock.quat).premultiply(qz.setFromAxisAngle(Z, phi));
        if (lt < 36) hero.position.add(V(lerp(60, 0, seg(lt, 0, 36)), lerp(-30, 0, seg(lt, 0, 36)), 0));
        const despin = lt > T_CONTACT + 1 && lt < T_STILL;
        hero.userData.setThrust(despin ? 1 : lt > 48 && lt < T_CONTACT ? 0.25 + 0.2 * Math.sin(lt * 9) : 0.08, lt);
        hero.userData.blink(lt);
        hero.userData.spot.intensity = lt > 36 ? 80 : 0;
        // port lamp
        const lampCol = lt > T_CONTACT ? new THREE.Color(0.3, 1, 0.5) : new THREE.Color(1, 0.3, 0.15);
        end.userData.ports.forEach((p) => p.children[2].material.color.copy(lampCol).multiplyScalar(1.2));
        aimSun(fg, sunDir, V(0, 0, 0));
      },
      afterCamera(cam) { P.sync(cam); sky.camera = P.camera; },
      lockCinematic: () => false,
      shot(lt, cam) {
        cam.fov = 45;
        if (lt < 10) { cam.fov = 35; lookAt(cam, V(-60, 25, 120), V(0, 0, 20)); }
        else if (lt < 20) { cam.fov = 40; lookAt(cam, mann.position.clone().add(V(14, 6, 22)), V(0, 0, 8)); }
        else if (lt < T_BOOM) { cam.fov = 50; lookAt(cam, hero.position.clone().add(V(0, 2, 4)), V(0, 0, 8)); }
        else if (lt < 36) {
          cam.fov = 55; lookAt(cam, V(-80, 30, 110), V(0, 0, 0));
          shake(cam, lt, 1.2 * Math.max(0, 1 - (lt - T_BOOM) / 6), 16);
        } else if (lt < 48) {
          cam.fov = 40; lookAt(cam, hero.position.clone().add(V(-20, 8, 30)), V(0, 0, 0));
        } else if (lt < 62) {
          // from the Ranger's docking camera: the hub spins in front of us
          cam.fov = 60;
          hero.updateMatrixWorld();
          const p = hero.localToWorld(V(0, 3.3, -3.08));
          const fwd = V(0, 1, 0).applyQuaternion(hero.quaternion), up = V(0, 0, 1).applyQuaternion(hero.quaternion);
          lookAt(cam, p, p.clone().add(fwd), up);
          shake(cam, lt, 0.04, 30);
        } else if (lt < T_CONTACT) {
          // exterior, rotating with the Ranger: the Endurance appears to slow as we match
          cam.fov = 50;
          const off = V(10, 7, 26).applyAxisAngle(Z, hero.rotation.z ? 0 : 0);
          const roll = qz.setFromAxisAngle(Z, lt < 48 ? 0 : st.phi);
          lookAt(cam, off.clone().applyQuaternion(roll).add(V(0, 0, 8)), V(0, 0, 4), V(0, 1, 0).applyQuaternion(roll));
          shake(cam, lt, 0.08, 25);
        } else if (lt < T_STILL) {
          cam.fov = 45;
          const roll = qz.setFromAxisAngle(Z, eAng);
          lookAt(cam, V(-30, 18, 60).applyQuaternion(roll), V(0, 0, 0), V(0, 1, 0).applyQuaternion(roll));
        } else { cam.fov = 38; lookAt(cam, V(-90, 40, 130), V(0, 0, 0)); }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        const heat = lt > T_BOOM + 4 && lt < T_STILL ? 0.3 * seg(lt, T_BOOM + 4, T_CONTACT) * (1 - seg(lt, T_CONTACT, T_STILL)) : 0;
        return { flash: bump(lt, T_BOOM, T_BOOM + 0.1, T_BOOM + 0.3, T_BOOM + 1.8) * 1.2, heat, letterbox: lt > 48 && lt < T_CONTACT ? 0 : 1, bloom: 0.8, exposure: 1.0, aberration: 0.0015 + heat * 0.01 };
      },
      interact(lt) {
        if (lt < 48 || lt > T_CONTACT + 4) return null;
        const rpmE = (endRate(lt) * 60) / (2 * Math.PI), rpmR = st.locked ? rpmE : (st.w * 60) / (2 * Math.PI);
        const sync = 1 - clamp(Math.abs(rpmE - rpmR) / rpmE);
        return {
          title: st.locked ? 'DOCKED · BEGIN DE-SPIN' : 'MATCH THE SPIN',
          body: st.locked ? `Locked at ${fmt.n(rpmE, 1)} rpm. Retro-thrusters firing.${st.user > 1 ? ' That was not possible. It was necessary.' : ''}`
            : `Endurance <b>${fmt.n(rpmE, 1)} rpm</b> · Ranger <b>${fmt.n(rpmR, 1)} rpm</b> · sync <b>${fmt.n(sync * 100, 0)}%</b>`,
          hint: st.locked ? '' : 'Hold SPACE or E to roll faster, Q to slow · autopilot assists as the deadline nears',
          progress: sync, color: sync > 0.97 ? '#8fe3c0' : '#ff7a4d',
        };
      },
      telemetry(lt) {
        const rpmE = (endRate(lt) * 60) / (2 * Math.PI);
        const alt = lt < T_BOOM ? 380 : lt < T_STILL ? lerp(380, 165, seg(lt, T_BOOM, T_STILL)) : 165;
        const rows = [
          ['ENDURANCE SPIN', `${fmt.n(rpmE, 1)} rpm`, rpmE > 20 ? 'warn' : ''],
          ['RIM ACCEL. (r = 32 m)', `${fmt.n(ENDURANCE.gAt(rpmE), 1)} g`, rpmE > 20 ? 'warn' : ''],
          ['ORBIT ALTITUDE', `${fmt.n(alt, 0)} km`, lt > T_BOOM && lt < T_STILL ? 'warn' : ''],
          ['HULL TEMP (lower modules)', `${fmt.n(lt > T_BOOM ? 290 + 900 * seg(lt, T_BOOM + 4, T_CONTACT) * (1 - seg(lt, T_CONTACT, T_STILL)) : 290, 0)} K`],
        ];
        if (lt < T_BOOM) rows.push(['RANGER 1 (MANN)', lt < 20 ? `docking · ${fmt.n(lerp(160, 0, easeOut(seg(lt, 0, 20))), 0)} m` : 'SEAL NOT CONFIRMED', lt >= 20 ? 'warn' : '']);
        else rows.push(['MODULES', '10 / 12 · hub breach', 'warn']);
        if (lt >= 48) rows.push(['RANGER ROLL', `${fmt.n(st.locked ? rpmE : (st.w * 60) / (2 * Math.PI), 1)} rpm`]);
        return rows;
      },
      telemetrySource: () => 'a = ω²r · 67.8 rpm ⇒ ω = 7.10 rad/s',
      minimap: (g) => drawSystem(g, SYS.mann, { highlight: 'mann', label: 'ENDURANCE · MANN ORBIT' }),
      cards: [],
      logs: [
        [2, 'CASE', 'Ranger one is on final approach to the hub. He is not using the autopilot.', 5.5],
        [9, 'CREW', 'Mann, do not open the hatch! The seal is not confirmed!', 5],
        [20.5, 'TARS', 'Imperfect contact. Latches at forty per cent.', 4],
        [25, 'CREW', 'Mann! Abort!', 2.5],
        [30, 'CASE', 'Hub breach. We have lost two modules. Endurance spinning at sixty-eight rpm.', 5.5],
        [37, 'TARS', 'She is falling into the stratosphere. Without heat shields.', 5],
        [44, 'CREW', 'Analyse the spin. We are going to match it.', 4],
        [48.5, 'TARS', 'It is not possible.', 2.5],
        [51.5, 'CREW', 'No. It’s necessary.', 3],
        [60, 'CREW', 'Come on… come on…', 3],
        [T_CONTACT + 0.5, 'TARS', 'Latched. Firing retros.', 3.5],
        [T_STILL + 0.5, 'CREW', 'She’s steady. We still have a ship.', 3.5],
      ],
    };
    return ch;
  },
};
