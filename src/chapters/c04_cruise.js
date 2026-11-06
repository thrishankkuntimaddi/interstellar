import { model } from '../world/models.js';
import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, clamp, easeInOut } from '../core/util.js';
import { ScaledLayer, skyLayer, shipScene, aimSun, skySun, drawOrrery } from './base.js';
import { createEarth, createPlanet } from '../world/planets.js';
import { createEndurance, createRanger } from '../world/ships.js';
import { createAsteroids, createPlume } from '../world/fx.js';
import { TEX } from '../world/assets.js';
import { PLANETS, ENDURANCE, hohmann, fmt, C } from '../data/astro.js';
import { dockPose } from './c03_docking.js';

const W0 = Math.sqrt(C.g0 / ENDURANCE.radius); // rad/s for 1 g at the rim (5.29 rpm)

/** Rotation angle of the Endurance ring: ramp from 0 to ω₀ over [t0, t1], then constant. */
export function spinAngle(lt, t0 = 2, t1 = 12, w = W0) {
  if (lt < t0) return 0;
  if (lt < t1) return 0.5 * w * (lt - t0) ** 2 / (t1 - t0);
  return 0.5 * w * (t1 - t0) + w * (lt - t1);
}
export function spinRate(lt, t0 = 2, t1 = 12, w = W0) { return lt < t0 ? 0 : lt < t1 ? (w * (lt - t0)) / (t1 - t0) : w; }

/** Endurance with its docked Ranger, sharing the spin. */
export function enduranceWithRanger() {
  const e = createEndurance();
  const r = createRanger();
  const p = dockPose();
  r.position.copy(p.pos); r.quaternion.copy(p.quat);
  e.userData.spin.add(r);
  // small attitude thrusters on four modules (tangential, used for spin-up)
  const jets = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 6;
    const j = createPlume({ radius: 0.35, length: 6, color: new THREE.Color(0.7, 0.8, 1.0) });
    j.position.set(Math.cos(a) * 32, Math.sin(a) * 32, 3.2);
    j.quaternion.setFromUnitVectors(V(0, 1, 0), V(Math.sin(a), -Math.cos(a), 0));
    e.userData.spin.add(j); jets.push(j);
  }
  e.userData.ranger = r; e.userData.jets = jets;
  return e;
}

export default {
  id: 'cruise', kicker: 'PHASE 1 · SOLAR SYSTEM', title: 'The Long Sleep', start: 205, end: 300,
  build(ctx) {
    const sky = skyLayer('ours', 1.0);
    // --- Earth departure ---
    const sunE = V(0.7, 0.3, -0.65).normalize();
    const bgE = new ScaledLayer({ near: 10, far: 2e6, scale: 0.001 });
    const earth = createEarth({ radius: 6371, sunDir: sunE, kmPerUnit: 1, segments: 200 });
    bgE.scene.add(earth);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1737, 96, 48), new THREE.MeshStandardMaterial({ map: TEX.moon, roughness: 1 }));
    moon.position.set(-150000, 20000, -340000);
    bgE.scene.add(moon);
    const ml = new THREE.DirectionalLight(0xffffff, 3); ml.position.copy(sunE).multiplyScalar(1e5); bgE.scene.add(ml);
    // --- Mars ---
    const sunM = V(0.85, 0.15, 0.5).normalize();
    const bgM = new ScaledLayer({ near: 10, far: 2e6, scale: 0.001 });
    const mars = createPlanet({ map: TEX.mars, radius: PLANETS.mars.radiusKm, sunDir: sunM, kmPerUnit: 1, sun: 2.3, limb: 0.15,
      atmosphere: { thicknessKm: 60, beta: [19.9e-3, 13.6e-3, 5.75e-3], Hkm: 11, intensity: 6, mie: 8e-3 } });
    mars.rotation.z = (25.19 * Math.PI) / 180;
    bgM.scene.add(mars);
    // --- Jupiter ---
    const sunJ = V(0.75, 0.05, 0.66).normalize();
    const bgJ = new ScaledLayer({ near: 100, far: 4e6, scale: 0.001 });
    const jup = createPlanet({ map: TEX.jupiter, radius: PLANETS.jupiter.radiusKm, sunDir: sunJ, kmPerUnit: 1, sun: 2.4, limb: 0.55, segments: 160 });
    jup.rotation.z = (3.13 * Math.PI) / 180;
    bgJ.scene.add(jup);
    const io = new THREE.Mesh(new THREE.SphereGeometry(1821, 64, 32), new THREE.MeshStandardMaterial({ color: 0xe8d27a, roughness: 0.9 }));
    io.position.set(-260000, 8000, -300000); bgJ.scene.add(io);
    const iol = new THREE.DirectionalLight(0xffffff, 3); iol.position.copy(sunJ).multiplyScalar(1e6); bgJ.scene.add(iol);

    const suns = [skySun(sky, sunE, { size: 70, intensity: 30 })];

    const fg = shipScene({ sunDir: sunE, env: ctx.envOurs, intensity: 3.4, shadowSize: 50 });
    const end = enduranceWithRanger();
    fg.add(end);
    const juno = model('juno'); if (juno) { juno.position.set(70, -14, -150); juno.rotation.set(0.3, 0.6, 0.2); fg.add(juno); }
    end.userData.flood.intensity = 40;
    const ast = createAsteroids({ count: 1600, inner: 700, outer: 4200, thickness: 260 });
    ast.position.set(0, 0, 0);
    fg.add(ast);
    const fgLayer = { scene: fg, near: 0.5, far: 80000 };
    const sunDirs = { E: sunE, M: sunM, J: sunJ };
    let seg_ = 'E';

    const hz = hohmann(1.0, 9.537);
    const sleepYears = (lt) => (lt < 14 ? 0 : lt < 27 ? 2 * seg(lt, 14, 27) * 0.62 : lt < 95 ? 1.24 + 0.76 * seg(lt, 27, 95) : 2);
    const departDate = new Date();

    const ch = {
      layers: [sky, bgE, fgLayer], allLayers: [sky, bgE, bgM, bgJ, fgLayer],
      subject: end, sunDir: sunE, chase: { offset: V(0, 18, -95), look: V(0, 0, 0) }, cockpit: V(0, 4, 16), freeDist: 140,
      update(lt, dt) {
        seg_ = lt < 27 ? 'E' : lt < 45 ? 'M' : lt < 68 ? 'B' : 'J';
        const sd = seg_ === 'E' ? sunE : seg_ === 'M' ? sunM : seg_ === 'B' ? sunM : sunJ;
        this.sunDir = sd;
        suns[0].onBeforeRender = (r, sc, cam) => { suns[0].position.copy(cam.position).addScaledVector(sd, 900); suns[0].updateMatrixWorld(); };
        suns[0].userData.uniforms.uI.value = seg_ === 'E' ? 30 : seg_ === 'J' ? 9 : 18;
        fg.userData.sun.position.copy(sd).multiplyScalar(200);
        fg.userData.sun.intensity = seg_ === 'J' ? 2.4 : 3.4;
        aimSun(fg, sd, V(0, 0, 0));
        // spin-up with tangential jets, then cruise at 5.29 rpm (1 g at r = 32 m)
        end.userData.spin.rotation.z = spinAngle(lt);
        const jetOn = lt > 2 && lt < 12 ? 1 : 0;
        end.userData.jets.forEach((j) => j.userData.set(jetOn * (0.6 + 0.4 * Math.sin(lt * 30)), lt));
        end.userData.ranger.userData.setThrust(lt > 9 && lt < 15 ? smooth(seg(lt, 9, 10.5)) * (1 - seg(lt, 13.5, 15)) : 0, lt);
        end.userData.ranger.userData.blink(lt);
        ast.visible = seg_ === 'B';
        if (juno) { juno.visible = seg_ === 'J'; juno.rotation.y = lt * 0.33; } // Juno spins at ~2 rpm
        if (seg_ === 'B') ast.userData.update(lt * 3);
        earth.userData.update(lt);
        sky.sky.userData.update(lt);
        if (seg_ === 'E') {
          this.layers = [sky, bgE, fgLayer];
          const u = seg(lt, 0, 27);
          bgE.origin.set(lerp(-9000, -60000, Math.pow(u, 1.4)), lerp(3000, 25000, u), lerp(9000, 140000, Math.pow(u, 1.6)));
        } else if (seg_ === 'M') {
          this.layers = [sky, bgM, fgLayer];
          const u = seg(lt, 27, 45);
          bgM.origin.set(lerp(-30000, 22000, u), lerp(2600, 1200, u), lerp(11000, 8000, u));
          mars.rotation.y = lt * 0.01;
        } else if (seg_ === 'B') {
          this.layers = [sky, fgLayer];
        } else {
          this.layers = [sky, bgJ, fgLayer];
          const u = seg(lt, 68, 95);
          bgJ.origin.set(lerp(-420000, 160000, u), lerp(30000, 15000, u), lerp(330000, 250000, u));
          jup.rotation.y = lt * 0.02;
        }
      },
      afterCamera(cam) {
        const L = seg_ === 'E' ? bgE : seg_ === 'M' ? bgM : seg_ === 'J' ? bgJ : bgE;
        L.sync(cam); sky.camera = seg_ === 'B' ? null : L.camera;
      },
      shot(lt, cam) {
        cam.fov = 42;
        if (lt < 6) {
          const u = easeInOut(seg(lt, 0, 6));
          lookAt(cam, V(lerp(60, 30, u), lerp(-20, -6, u), lerp(70, 55, u)), V(0, 0, 5));
        } else if (lt < 14) {
          cam.fov = 35;
          const u = seg(lt, 6, 14);
          lookAt(cam, V(-25, 46, lerp(-20, 10, u)), V(0, 25, 0), V(0, 0, 1));
        } else if (lt < 27) {
          // hypersleep: drifting away from the ship, Earth and Moon behind
          cam.fov = 30;
          const u = seg(lt, 14, 27);
          lookAt(cam, V(lerp(180, 420, u), lerp(40, 90, u), lerp(-260, -600, u)), V(0, 0, 0));
        } else if (lt < 36) {
          cam.fov = 40;
          const u = seg(lt, 27, 36);
          lookAt(cam, V(lerp(70, 50, u), 14, lerp(-80, -60, u)), V(-20, -6, 10));
        } else if (lt < 45) {
          cam.fov = 28;
          const u = seg(lt, 36, 45);
          lookAt(cam, V(-160 + u * 40, -30, 220), V(0, 0, 0));
        } else if (lt < 56) {
          cam.fov = 50;
          const u = seg(lt, 45, 56);
          lookAt(cam, V(lerp(-300, -90, u), lerp(40, 15, u), lerp(400, 120, u)), V(0, 0, 0));
        } else if (lt < 68) {
          cam.fov = 45;
          const u = seg(lt, 56, 68);
          const a = u * 1.2;
          lookAt(cam, V(Math.cos(a) * 70, 25, Math.sin(a) * 70 + 20), V(0, 0, 0));
        } else if (lt < 80) {
          cam.fov = 38;
          const u = seg(lt, 68, 80);
          lookAt(cam, V(lerp(-40, -70, u), lerp(-8, 6, u), lerp(90, 120, u)), V(30, 10, -60));
        } else {
          cam.fov = 26;
          const u = seg(lt, 80, 95);
          lookAt(cam, V(lerp(70, 40, u), 22, lerp(230, 290, u)), V(-10, 0, 0));
        }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        const sleep = bump(lt, 14, 16.5, 24.5, 27);
        return { cold: sleep * 0.8, fade: sleep * 0.35 + bump(lt, 26.2, 26.8, 27.1, 28) * 0.9, letterbox: 1, bloom: 0.75, exposure: 1.0 };
      },
      telemetry(lt) {
        const w = spinRate(lt);
        const rpm = (w * 60) / (2 * Math.PI);
        const yrs = sleepYears(lt);
        const date = new Date(departDate.getTime() + yrs * C.year * 1000);
        const base = [
          ['SPIN', `${fmt.n(rpm, 2)} rpm`],
          ['GRAVITY AT RIM (r = 32 m)', `${fmt.n(ENDURANCE.gAt(rpm), 3)} g`, rpm > 5 ? 'ok' : ''],
          ['MISSION DATE', date.toISOString().slice(0, 10)],
        ];
        if (lt < 14) return [...base, ['MANOEUVRE', lt < 12 ? 'SPIN-UP · RCS' : 'TRANS-SATURN INJECTION'], ['RPM FOR 1 g', `${fmt.n(ENDURANCE.rpmFor1g(), 2)}  (ω = √(g/r))`]];
        if (lt < 27) return [...base, ['CREW', 'HYPERSLEEP', 'ok'], ['HOHMANN E→S', `${fmt.n(hz.tofYears, 2)} yr · Δv ${fmt.n(hz.dv1 / 1000, 2)} km/s`], ['PLANNED TRANSIT', '~2 yr (powered + gravity assists)']];
        if (lt < 45) return [...base, ['FLYBY', 'MARS'], ['RADIUS', `${fmt.n(PLANETS.mars.radiusKm, 1)} km`], ['SURFACE GRAVITY', `${PLANETS.mars.g} m/s²`], ['CLOSEST APPROACH', '~8,000 km'], ['SOL LENGTH', '24 h 37 m']];
        if (lt < 68) return [...base, ['REGION', 'MAIN ASTEROID BELT'], ['EXTENT', '2.2 – 3.2 AU'], ['TOTAL MASS', '~3% of the Moon'], ['MEAN SPACING', '~10⁶ km (dense cluster shown)']];
        return [...base, ['FLYBY', 'JUPITER'], ['RADIUS', `${fmt.n(PLANETS.jupiter.radiusKm, 0)} km`], ['GRAVITY', `${PLANETS.jupiter.g} m/s²`], ['ROTATION', '9 h 55 m'], ['ASSIST', 'gravity slingshot to Saturn']];
      },
      telemetrySource: () => ctx.eph.source,
      minimap: (g, lt) => drawOrrery(g, ctx.eph, seg(lt, 0, 125) * 0.92, { label: 'ENDURANCE → SATURN' }),
      cards: [
        [15.5, 24, 'HYPERSLEEP', 'two years to Saturn'],
        [28, 33, 'MARS', 'first waypoint'],
        [69, 74, 'JUPITER', 'gravity assist'],
      ],
      logs: [
        [1, 'CASE', 'Initiating spin. Stand by for gravity.', 4],
        [7.5, 'TARS', `Five point three rpm. One g at the rim. You can let go of the handholds now.`, 5.5],
        [10.5, 'CREW', 'Burn for Saturn. See you in two years, Earth.', 4],
        [46, 'TARS', 'Entering the belt. Do not worry, they are usually a million kilometres apart.', 6],
        [58, 'CASE', 'Except for this cluster. Adjusting course by two degrees.', 5],
        [82, 'TARS', 'Jupiter assist complete. Saturn in eight months.', 5],
      ],
    };
    return ch;
  },
};
