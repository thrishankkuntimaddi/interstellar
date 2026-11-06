import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, clamp, easeInOut, easeOut, shake } from '../core/util.js';
import { ScaledLayer, shipScene, aimSun } from './base.js';
import { gargantuaLayer, SYS, drawSystem, bhTelemetry, RS_KM } from './gsys.js';
import { createAlienPlanet } from '../world/planets.js';
import { createWormhole } from '../world/wormhole.js';
import { createRanger } from '../world/ships.js';
import { SKY } from '../world/sky.js';
import { enduranceWithRanger, spinAngle } from './c04_cruise.js';
import { dockPose } from './c03_docking.js';
import { fmt, GARGANTUA } from '../data/astro.js';


/** Ship-less beauty orbit around the hole: camera in r_s, always looking at the centre. */
function orbitCam(G, u, { r0 = 60, r1 = 26, a0 = 0.3, a1 = 2.6, e0 = 0.28, e1 = 0.06 } = {}) {
  const k = u * u * (3 - 2 * u);
  const r = r0 + (r1 - r0) * k, a = a0 + (a1 - a0) * k, e = e0 + (e1 - e0) * k;
  const c = G.camera;
  c.position.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  c.up.set(0, 1, 0); c.lookAt(0, 0, 0); c.fov = 42; c.updateMatrixWorld();
}

export default {
  id: 'arrival', kicker: 'PHASE 2 · GARGANTUA SYSTEM', title: 'Another Galaxy', start: 372, end: 455,
  build(ctx) {
    const G = gargantuaLayer();
    // ship trajectory in r_s: from the wormhole mouth toward Miller
    const shipRs = (lt) => {
      const u = easeInOut(seg(lt, 6, 83));
      const a = SYS.wormhole.clone(), b = SYS.miller.clone().add(V(4, 1.2, 9));
      const k = 1 - Math.pow(1 - u, 2.2);
      return a.lerp(b, k);
    };
    // Miller's planet (km), with Gargantua behind it
    const P = new ScaledLayer({ near: 50, far: 3e6, scale: 0.001 });
    const toBH = new THREE.Vector3();
    const sunDir = new THREE.Vector3(0, 0, -1); // lit by the accretion disk
    const miller = createAlienPlanet({ type: 0, radius: 6800, sunDir, kmPerUnit: 1, seed: 1.3 });
    P.scene.add(miller);

    const fg = shipScene({ sunDir, env: ctx.envOther, intensity: 2.6, ambient: 0.12, shadowSize: 50 });
    fg.userData.sun.color.setRGB(1.0, 0.82, 0.62);
    const end = enduranceWithRanger();
    fg.add(end);
    end.userData.flood.intensity = 40;
    const dockedRanger = end.userData.ranger;
    const ranger = createRanger(); fg.add(ranger); ranger.visible = false;
    const worm = createWormhole({ radius: 1000 });
    worm.userData.uniforms.uOurs.value = SKY.other; worm.userData.uniforms.uOther.value = SKY.ours;
    worm.position.set(0, 0, 9000);
    fg.add(worm);
    const fgLayer = { scene: fg, near: 0.5, far: 60000 };
    const dock = dockPose();
    let srs = shipRs(0);

    const ch = {
      layers: [G, fgLayer], allLayers: [G, P, fgLayer],
      subject: end, sunDir, chase: { offset: V(0, 14, 90), look: V(0, 0, -200) }, cockpit: V(0, 4, -16), freeDist: 140,
      bhLayer: G,
      update(lt) {
        srs = shipRs(lt);
        G.origin.copy(srs);
        G.bh.uniforms.uTime.value = lt + 100;
        // the hole is the light source: point the "sun" at it (in fg space = BH direction from ship)
        toBH.copy(srs).negate().normalize();
        sunDir.copy(toBH);
        fg.userData.sun.position.copy(sunDir).multiplyScalar(200);
        aimSun(fg, sunDir, end.position);
        end.userData.spin.rotation.z = spinAngle(lt + 300);
        // Endurance hub points toward the black hole
        end.quaternion.setFromUnitVectors(V(0, 0, -1), toBH);
        worm.position.copy(toBH).multiplyScalar(-6000 - lt * 120);
        worm.visible = lt < 40;
        // Ranger departs for Miller at lt 44
        const dep = seg(lt, 44, 83);
        dockedRanger.visible = lt < 44;
        ranger.visible = lt >= 44;
        if (lt >= 44) {
          end.updateMatrixWorld(true);
          const start = dockedRanger.getWorldPosition(new THREE.Vector3());
          const q = dockedRanger.getWorldQuaternion(new THREE.Quaternion());
          const fwd = toBH.clone();
          ranger.position.copy(start).addScaledVector(V(0, 1, 0).applyQuaternion(q), Math.min(dep * 40, 6)).addScaledVector(fwd, Math.pow(Math.max(0, lt - 46), 2) * 4);
          const target = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), fwd);
          ranger.quaternion.copy(q).slerp(target, sseg(lt, 45, 50));
          ranger.userData.setThrust(lt > 46 ? 1 : 0.1, lt);
          ranger.userData.blink(lt);
          this.subject = ranger; this.chase = { offset: V(0, 4, -26), look: V(0, 0, 20) }; this.cockpit = ranger.userData.cockpit;
        } else { this.subject = end; this.chase = { offset: V(0, 14, 90), look: V(0, 0, -200) }; this.cockpit = V(0, 4, -16); }
        // Miller layer: compressed approach distance, true direction
        const showP = lt > 50;
        this.layers = showP ? [G, P, fgLayer] : [G, fgLayer];
        if (lt >= 20 && lt < 32) this.layers = [G];
        const toM = SYS.miller.clone().sub(srs).normalize();
        const dKm = lerp(260000, 34000, easeOut(seg(lt, 50, 83)));
        P.origin.copy(toM).multiplyScalar(-dKm);
        miller.userData.update(lt);
        worm.userData.uniforms.uTime.value = lt;
      },
      afterCamera(cam) { G.sync(cam); P.sync(cam); if (this.layers.length === 1) orbitCam(G, seg(ctx.audio.time - 372, 20, 32), { r0: 70, r1: 30, a0: -0.4, a1: 1.9 }); },
      shot(lt, cam) {
        cam.fov = 45;
        const W = worm.position;
        if (lt < 9) {
          // looking back as we leave the mouth: it now shows Saturn's sky
          const u = easeInOut(seg(lt, 0, 9));
          cam.fov = 50;
          lookAt(cam, toBH.clone().multiplyScalar(lerp(250, 160, u)).add(V(40, 25, 0)), W.clone().lerp(V(0, 0, 0), u * 0.6));
        } else if (lt < 20) {
          // turn around: Gargantua
          const u = easeInOut(seg(lt, 9, 20));
          cam.fov = lerp(50, 30, u);
          const back = toBH.clone().multiplyScalar(-110).add(V(55, 30, 0));
          const look = new THREE.Vector3().lerpVectors(W, toBH.clone().multiplyScalar(1000), smooth(seg(lt, 9, 15)));
          lookAt(cam, back, look);
        } else if (lt < 32) {
          cam.fov = 22;
          lookAt(cam, toBH.clone().multiplyScalar(-90).add(V(-70, 30, 10)), toBH.clone().multiplyScalar(1000));
        } else if (lt < 44) {
          cam.fov = 38;
          const u = seg(lt, 32, 44);
          const a = u * 1.0;
          lookAt(cam, V(Math.cos(a) * 80, 30, Math.sin(a) * 80), toBH.clone().multiplyScalar(40));
        } else if (lt < 56) {
          cam.fov = 40;
          lookAt(cam, V(25, -10, 0).add(toBH.clone().multiplyScalar(-30)), ranger.position.clone());
        } else if (lt < 70) {
          cam.fov = 45;
          const R = ranger.position;
          lookAt(cam, R.clone().addScaledVector(toBH, -28).add(V(6, 5, 0)), R.clone().addScaledVector(toBH, 100));
        } else {
          cam.fov = 32;
          const R = ranger.position;
          lookAt(cam, R.clone().addScaledVector(toBH, -60).add(V(-14, 9, 12)), R.clone().addScaledVector(toBH, 200));
        }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        return { white: bump(lt, 0, 0.01, 0.3, 2.5) * 0.9, letterbox: 1, bloom: 0.85, exposure: 1.0 };
      },
      telemetry(lt) {
        const r = srs.length();
        const rows = bhTelemetry(r);
        if (lt > 30) rows.push(['MILLER: 1 h =', '7 years on Earth', 'warn'], ['DILATION FACTOR', '61,362 ×']);
        if (lt > 44) rows.push(['RANGER', 'EN ROUTE · MILLER']);
        return rows;
      },
      telemetrySource: () => 'Gargantua parameters: K. Thorne, The Science of Interstellar · renderer: Kerr null-geodesic ray tracing',
      minimap: (g, lt) => drawSystem(g, srs, { highlight: lt > 30 ? 'miller' : '', label: 'ENDURANCE' }),
      cards: [[14, 21, 'GARGANTUA', 'one hundred million solar masses'], [33, 39, 'THREE WORLDS', 'Miller · Mann · Edmunds']],
      logs: [
        [3, 'CASE', 'Transit complete. We are in another galaxy.', 4],
        [9.5, 'CREW', 'Oh my god…', 3],
        [22, 'TARS', 'Gargantua. Spinning at very nearly the speed of light. The disk is all the daylight these worlds get.', 7],
        [34, 'CREW', 'Miller first. Her beacon is still transmitting.', 4.5],
        [40, 'CASE', 'Her orbit is so deep that every hour down there costs us seven years.', 6],
        [47, 'CREW', 'Then we don’t waste a minute. Ranger away.', 4],
        [62, 'TARS', 'Using Gargantua to brake. Picking up speed now.', 5],
      ],
    };
    return ch;
  },
};
