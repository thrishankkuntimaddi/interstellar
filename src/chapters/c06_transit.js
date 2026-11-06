import * as THREE from 'three';
import { seg, sseg, lerp, bump, V, lookAt, shake, easeInOut } from '../core/util.js';
import { shipScene, aimSun } from './base.js';
import { createWormholeTunnel } from '../world/wormhole.js';
import { enduranceWithRanger, spinAngle } from './c04_cruise.js';
import { fmt } from '../data/astro.js';

export default {
  id: 'transit', kicker: 'PHASE 2 · TRANSIT', title: 'Through', start: 352, end: 372,
  build(ctx) {
    const bgScene = new THREE.Scene();
    const tunnel = createWormholeTunnel();
    bgScene.add(tunnel);
    const bgLayer = { scene: bgScene, near: 0.1, far: 10 };
    const sunDir = V(0.3, 0.8, 0.5).normalize();
    const fg = shipScene({ sunDir, env: ctx.envOurs, intensity: 1.6, ambient: 0.25, shadow: false });
    const end = enduranceWithRanger();
    fg.add(end);
    end.userData.flood.intensity = 8;
    // light from the tunnel walls (cool and warm, swirling)
    const l1 = new THREE.PointLight(0x9fc4ff, 0, 400, 1); const l2 = new THREE.PointLight(0xffc48a, 0, 400, 1);
    fg.add(l1, l2);
    const fgLayer = { scene: fg, near: 0.5, far: 5000 };
    const u = tunnel.userData.uniforms;

    return {
      layers: [bgLayer, fgLayer], allLayers: [bgLayer, fgLayer],
      subject: end, sunDir, chase: { offset: V(0, 14, 90), look: V(0, 0, -200) }, cockpit: V(0, 4, -16), freeDist: 130,
      update(lt) {
        u.uTime.value = lt; u.uProgress.value = seg(lt, 0, 20);
        end.userData.spin.rotation.z = spinAngle(lt + 252);
        end.rotation.z = Math.sin(lt * 0.6) * 0.15;
        end.position.set(Math.sin(lt * 1.3) * 2, Math.cos(lt * 0.9) * 1.5, 0);
        const a = lt * 2.2;
        l1.position.set(Math.cos(a) * 120, Math.sin(a) * 120, -40); l1.intensity = 500;
        l2.position.set(Math.cos(a + 3) * 120, Math.sin(a + 3) * 120, 40); l2.intensity = 350;
        aimSun(fg, sunDir, end.position);
      },
      shot(lt, cam) {
        if (lt < 6) {
          cam.fov = 75;
          lookAt(cam, V(0, 10, 75), V(0, 0, -100), V(Math.sin(lt * 0.4) * 0.3, 1, 0).normalize());
          shake(cam, lt, 0.8, 20);
        } else if (lt < 12) {
          cam.fov = 60;
          const k = seg(lt, 6, 12);
          lookAt(cam, V(lerp(-70, -40, k), 22, lerp(20, -30, k)), V(0, 0, 0));
          shake(cam, lt, 0.4, 14);
        } else if (lt < 16) {
          cam.fov = 80;
          lookAt(cam, V(0, 5, -20), V(0, 0, -400));
          shake(cam, lt, 0.25, 30);
        } else {
          cam.fov = 65;
          const k = easeInOut(seg(lt, 16, 20));
          lookAt(cam, V(lerp(30, 10, k), lerp(15, 8, k), lerp(70, 140, k)), V(0, 0, -300));
          shake(cam, lt, 0.3 * (1 - k), 20);
        }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        return {
          distort: 0.35 + 0.25 * Math.sin(lt * 1.7), aberration: 0.006, white: bump(lt, 0, 0.01, 0.2, 1.4) + bump(lt, 18.6, 19.5, 19.8, 20) * 0.9,
          flash: bump(lt, 9.5, 9.8, 10, 10.8) * 0.6, letterbox: 1, bloom: 0.75, exposure: 0.85, grain: 0.09,
        };
      },
      telemetry(lt) {
        return [
          ['STATE', 'INSIDE THE THROAT', 'warn'],
          ['PROPER TIME', `00:00:${String(Math.floor(lt)).padStart(2, '0')}`],
          ['COORDINATE TIME', 'undefined'],
          ['TIDAL ACCEL.', `${fmt.n(0.08 + 0.06 * Math.sin(lt * 1.7), 2)} g`],
          ['NAV', 'inertial only · no star fix'],
          ['DESTINATION', lt > 12 ? 'STARS RESOLVING' : '—', lt > 12 ? 'ok' : ''],
        ];
      },
      cards: [],
      logs: [
        [1.5, 'CASE', 'Instruments are useless in here.', 3.5],
        [8, 'CREW', 'Did you feel that? Something brushed the hull…', 4],
        [13, 'TARS', 'Light ahead. A new sky.', 4],
      ],
    };
  },
};
