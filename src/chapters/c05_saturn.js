import { model } from '../world/models.js';
import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, clamp, easeInOut, easeIn, shake } from '../core/util.js';
import { ScaledLayer, skyLayer, shipScene, aimSun, skySun, drawOrrery } from './base.js';
import { createPlanet } from '../world/planets.js';
import { createWormhole } from '../world/wormhole.js';
import { TEX } from '../world/assets.js';
import { PLANETS, fmt, C } from '../data/astro.js';
import { enduranceWithRanger, spinAngle } from './c04_cruise.js';

const WR = 1000; // wormhole throat radius, metres (≈2 km sphere)

export default {
  id: 'saturn', kicker: 'PHASE 1 · SATURN', title: 'The Wormhole', start: 300, end: 352,
  build(ctx) {
    const sunDir = V(0.92, 0.22, -0.3).normalize();
    const sky = skyLayer('ours', 1.0);
    skySun(sky, sunDir, { size: 40, intensity: 14 });
    const bg = new ScaledLayer({ near: 100, far: 4e6, scale: 0.001 });
    const R = PLANETS.saturn.rings;
    const saturn = createPlanet({ map: TEX.saturn, radius: PLANETS.saturn.radiusKm, sunDir, kmPerUnit: 1, sun: 1.5, limb: 0.45, segments: 192, ring: { inner: R.dInner, outer: R.fRing } });
    saturn.rotation.x = 0.36; saturn.rotation.z = -0.12;
    bg.scene.add(saturn);
    const fg = shipScene({ sunDir, env: ctx.envOurs, intensity: 2.8, shadowSize: 50 });
    const end = enduranceWithRanger();
    fg.add(end);
    const cassini = model('cassini'); if (cassini) { cassini.position.set(-160, 30, -1500); cassini.rotation.set(0.25, 2.2, 0.1); fg.add(cassini); }
    end.userData.flood.intensity = 40;
    const worm = createWormhole({ radius: WR });
    const WPOS = V(-2200, 400, -14000);
    worm.position.copy(WPOS);
    fg.add(worm);
    const fgLayer = { scene: fg, near: 0.5, far: 120000 };

    // ship path: cruise past the rings, then fall into the wormhole
    const shipPos = (lt) => {
      if (lt < 30) return V(0, 0, 0);
      const u = easeIn(seg(lt, 30, 51.5));
      return new THREE.Vector3().lerpVectors(V(0, 0, 0), WPOS, u * 1.0);
    };

    const ch = {
      layers: [sky, bg, fgLayer], allLayers: [sky, bg, fgLayer],
      subject: end, sunDir, chase: { offset: V(0, 14, 90), look: V(0, 0, -200) }, cockpit: V(0, 4, -16), freeDist: 150,
      update(lt) {
        end.userData.spin.rotation.z = spinAngle(lt + 200);
        end.position.copy(shipPos(lt));
        // turn the ship's hub toward the wormhole for the approach
        end.rotation.y = lerp(0, 0.15, sseg(lt, 26, 34));
        end.userData.ranger.userData.blink(lt);
        end.userData.ranger.userData.setThrust(lt > 30 && lt < 38 ? 0.6 : 0, lt);
        worm.userData.uniforms.uTime.value = lt;
        worm.userData.uniforms.uRipple.value = sseg(lt, 40, 50) * 3;
        worm.userData.uniforms.uGain.value = sseg(lt, 18, 26);
        worm.visible = lt > 17;
        sky.sky.userData.update(lt);
        // bg origin: approaching Saturn from above the ring plane
        const u = seg(lt, 0, 52);
        bg.origin.set(lerp(230000, 150000, u), lerp(42000, 22000, u), lerp(330000, 240000, u));
        saturn.rotation.y = lt * 0.01;
        aimSun(fg, sunDir, end.position);
      },
      afterCamera(cam) { bg.sync(cam); bg.origin; sky.camera = bg.camera; },
      shot(lt, cam) {
        cam.fov = 40;
        const P = end.position;
        if (lt < 10) {
          const u = easeInOut(seg(lt, 0, 10));
          cam.fov = lerp(55, 45, u);
          lookAt(cam, P.clone().add(V(lerp(90, 60, u), lerp(-20, 10, u), lerp(160, 120, u))), P.clone().add(V(-400, -60, -800)));
        } else if (lt < 18) {
          const u = seg(lt, 10, 18);
          cam.fov = 32;
          lookAt(cam, P.clone().add(V(-70 + u * 30, 12, 50)), P.clone());
        } else if (lt < 30) {
          // the reveal: a sphere hanging in space, distorting the stars behind it
          const u = easeInOut(seg(lt, 18, 30));
          cam.fov = lerp(30, 22, u);
          lookAt(cam, P.clone().add(V(40, 18, 120)), new THREE.Vector3().lerpVectors(P, WPOS, lerp(0.3, 1, u)));
        } else if (lt < 40) {
          cam.fov = 45;
          lookAt(cam, P.clone().add(V(30, 20, 110)), WPOS);
          shake(cam, lt, 0.05);
        } else if (lt < 47) {
          cam.fov = 60;
          lookAt(cam, P.clone().add(V(-70, 25, 60)), P.clone().add(V(0, 0, -50)));
          shake(cam, lt, 0.2 * seg(lt, 40, 47));
        } else {
          cam.fov = 70;
          const dir = WPOS.clone().sub(P).normalize();
          lookAt(cam, P.clone().add(V(0, 6, 40)).addScaledVector(dir, -20), WPOS);
          shake(cam, lt, 0.6 * seg(lt, 47, 52), 24);
        }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        return { distort: sseg(lt, 44, 52) * 0.6, white: bump(lt, 50.8, 51.8, 52, 52.2), aberration: 0.0015 + sseg(lt, 42, 52) * 0.006, letterbox: 1, bloom: 0.8, exposure: 1.0 };
      },
      telemetry(lt) {
        const P = end.position;
        const d = Math.max(0, P.distanceTo(WPOS) - WR);
        const dSat = bg.origin.length() - PLANETS.saturn.radiusKm;
        return [
          ['BODY', 'SATURN'], ['RADIUS', `${fmt.n(PLANETS.saturn.radiusKm, 0)} km`],
          ['RING SPAN', `${fmt.n(PLANETS.saturn.rings.cInner, 0)} – ${fmt.n(PLANETS.saturn.rings.fRing, 0)} km`],
          ['ALTITUDE', `${fmt.n(dSat, 0)} km`],
          ['SUNLIGHT', '1.1% of Earth’s (9.5 AU)'],
          ...(lt > 18 ? [
            ['ANOMALY', 'SPHERICAL WORMHOLE', 'warn'],
            ['APPARENT DIAMETER', `${fmt.n((2 * WR) / 1000, 1)} km`],
            ['DISTANCE TO THROAT', fmt.km(d)],
            ['LENSING', 'Einstein ring at b ≈ R', 'ok'],
          ] : []),
        ];
      },
      telemetrySource: () => 'Saturn data: NASA fact sheet · ' + ctx.eph.source,
      minimap: (g, lt) => drawOrrery(g, ctx.eph, 0.92 + seg(lt, 0, 52) * 0.08, { label: 'ARRIVAL · SATURN' }),
      cards: [[2, 8, 'SATURN', 'nine and a half astronomical units from home'], [20, 26, '', 'a hole in space · two kilometres across']],
      logs: [
        [10, 'CREW', 'Eight months of Saturn rising. Never gets old.', 4.5],
        [19, 'CASE', 'Visual on the anomaly.', 3.5],
        [23, 'CREW', 'It’s a sphere. Of course it’s a sphere — a hole, in three dimensions.', 5.5],
        [31, 'TARS', 'Gravitational lensing is consistent with a wormhole. The stars inside are not ours.', 6],
        [41, 'CASE', 'Tidal shear increasing. Stay on the axis.', 4],
        [46.5, 'CREW', 'Here we go…', 3],
      ],
    };
    return ch;
  },
};
