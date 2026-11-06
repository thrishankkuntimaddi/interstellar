import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, clamp, easeInOut, easeOut, easeIn, shake } from '../core/util.js';
import { ScaledLayer, shipScene, aimSun } from './base.js';
import { gargantuaLayer, SYS, drawSystem, bhTelemetry } from './gsys.js';
import { createAlienPlanet } from '../world/planets.js';
import { createRanger } from '../world/ships.js';
import { createSmokeTrail } from '../world/fx.js';
import { enduranceWithRanger, spinAngle } from './c04_cruise.js';
import { NOISE } from '../gl/noise.js';
import { fmt, GARGANTUA, C } from '../data/astro.js';

// The giant tidal wave: crest position (m along +x) and height over chapter time.
const WAVE_T0 = 44, WAVE_T1 = 82;
const waveX = (lt) => lerp(-14000, 1800, seg(lt, WAVE_T0, WAVE_T1));
const waveH = (lt) => lerp(250, 1150, sseg(lt, WAVE_T0, WAVE_T0 + 22));
const PROPER_PER_SEC = 11820 / 77; // 3 h 17 min of ship time across the surface sequence

function waveHeightJS(x, lt) {
  const d = x - waveX(lt);
  const back = Math.exp(-Math.pow(Math.max(-d, 0) / 1400, 2));
  const front = Math.exp(-Math.pow(Math.max(d, 0) / 260, 2));
  return waveH(lt) * (d < 0 ? back : front);
}

function createOcean(sunDir) {
  const u = { uTime: { value: 0 }, uWX: { value: -14000 }, uWH: { value: 0 }, uSun: { value: sunDir }, uFog: { value: new THREE.Color(0.55, 0.6, 0.62) } };
  const g = new THREE.PlaneGeometry(30000, 30000, 600, 600);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */`
      uniform float uTime, uWX, uWH; varying vec3 vW; varying float vH; varying float vSlope;
      float wave(float x){ float d = x - uWX; float back = exp(-pow(max(-d, 0.0) / 1400.0, 2.0)); float front = exp(-pow(max(d, 0.0) / 260.0, 2.0)); return uWH * (d < 0.0 ? back : front); }
      void main(){
        vec3 p = position;
        float h = wave(p.x) * (0.85 + 0.15 * sin(p.z * 0.0011 + 1.3));
        p.y += h;
        vH = h; vSlope = (wave(p.x + 5.0) - wave(p.x - 5.0)) / 10.0;
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uWH; uniform vec3 uSun, uFog; varying vec3 vW; varying float vH; varying float vSlope;
      ${NOISE}
      void main(){
        vec2 p = vW.xz;
        // small capillary/chop normals
        float e = 0.6;
        float n0 = fbm3(vec3(p * 0.35, uTime * 0.6));
        float nx = fbm3(vec3((p + vec2(e, 0.0)) * 0.35, uTime * 0.6));
        float nz = fbm3(vec3((p + vec2(0.0, e)) * 0.35, uTime * 0.6));
        vec3 N = normalize(vec3(-(nx - n0) * 0.9 - vSlope, 1.0, -(nz - n0) * 0.9));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 skyC = mix(vec3(0.62, 0.66, 0.66), vec3(0.42, 0.48, 0.52), clamp(R.y, 0.0, 1.0));
        // shallow water: bottom shows through near the viewer
        float depthTint = smoothstep(0.0, 60.0, vH);
        vec3 bottom = vec3(0.32, 0.36, 0.33) * (0.8 + 0.2 * snoise(vec3(p * 0.08, 1.0)));
        vec3 deep = vec3(0.07, 0.13, 0.15);
        vec3 body = mix(bottom * 0.75, deep, max(depthTint, 0.65 * (1.0 - exp(-length(vW.xz - cameraPosition.xz) / 300.0))));
        vec3 col = mix(body, skyC, fres);
        col += vec3(1.0, 0.9, 0.75) * pow(max(dot(R, uSun), 0.0), 220.0) * 6.0;
        // foam on the steep wave face and crest
        float foam = smoothstep(0.35, 1.2, abs(vSlope)) * smoothstep(80.0, 300.0, vH);
        foam += smoothstep(0.92, 1.0, vH / max(uWH, 1.0)) * 0.8;
        foam *= 0.6 + 0.4 * snoise(vec3(p * 0.02, uTime * 0.3));
        col = mix(col, vec3(0.85, 0.88, 0.88), clamp(foam, 0.0, 1.0));
        float dist = length(vW - cameraPosition);
        col = mix(col, uFog, 1.0 - exp(-dist / 14000.0));
        gl_FragColor = vec4(col * 1.1, 1.0);
      }`,
  }));
  m.frustumCulled = false;
  m.userData.u = u;
  return m;
}

/** Thick humid haze over Gargantua: alpha-blended dome so the hole shows through. */
function hazeDome(sunDir) {
  const u = { uSun: { value: sunDir }, uOpacity: { value: 1 } };
  const m = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uOpacity; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float e = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(vec3(0.6, 0.64, 0.64), vec3(0.32, 0.38, 0.42), smoothstep(0.0, 0.8, e));
        col += vec3(1.0, 0.85, 0.65) * pow(max(dot(d, uSun), 0.0), 6.0) * 0.25;
        float a = mix(0.78, 0.22, smoothstep(0.0, 0.45, e)) * uOpacity;
        gl_FragColor = vec4(col, a);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false,
  }));
  m.renderOrder = -50;
  m.onBeforeRender = (r, s, c) => { m.position.copy(c.position); m.updateMatrixWorld(); };
  m.frustumCulled = false;
  return m;
}

function plasmaShell() {
  const u = { uTime: { value: 0 }, uI: { value: 0 } };
  const g = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */`varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uTime, uI; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float n = fbm3(vP * 3.0 + vec3(0.0, -uTime * 8.0, 0.0)) * 0.5 + 0.5;
        vec3 c = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.85, 0.6), n) * (0.4 + f) * n * uI * 1.4; gl_FragColor = vec4(c, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.scale.set(6.5, 13, 2.8);
  m.rotation.x = Math.PI / 2; // dome opens toward the nose (+Z)
  m.userData.u = u;
  return m;
}

export default {
  id: 'miller', kicker: 'PHASE 2 · MILLER', title: 'Miller’s Planet', start: 455, end: 582,
  build(ctx) {
    // Gargantua as seen from Miller's orbit (≈6.5 r_s): enormous in the sky
    const G = gargantuaLayer();
    G.origin.copy(SYS.miller).add(V(0.0, 0.25, 0.0));
    const toBH = SYS.miller.clone().negate().normalize();
    const skyBH = V(-0.62, 0.42, -0.66).normalize(); // where Gargantua hangs in Miller's sky (surface frame)
    const sunSurf = skyBH.clone();

    // --- orbit / entry ---
    const P = new ScaledLayer({ near: 5, far: 2e6, scale: 0.001 });
    const planet = createAlienPlanet({ type: 0, radius: 6800, sunDir: sunSurf, kmPerUnit: 1, seed: 1.3 });
    P.scene.add(planet);
    const fgEntry = shipScene({ sunDir: sunSurf, env: ctx.envOther, intensity: 2.2, ambient: 0.15, shadowSize: 30 });
    fgEntry.userData.sun.color.setRGB(1, 0.85, 0.68);
    const rEntry = createRanger(); fgEntry.add(rEntry);
    const plasma = plasmaShell(); plasma.position.z = 5.5; rEntry.add(plasma);
    const entryLayer = { scene: fgEntry, near: 0.3, far: 50000 };

    // --- surface (metres) ---
    const surf = new THREE.Scene();
    surf.environment = ctx.envOther; surf.environmentIntensity = 0.5;
    const haze = hazeDome(sunSurf); surf.add(haze);
    const ocean = createOcean(sunSurf); surf.add(ocean);
    const sl = new THREE.DirectionalLight(0xffe2c0, 1.6); sl.position.copy(sunSurf).multiplyScalar(200);
    sl.castShadow = true; sl.shadow.mapSize.set(2048, 2048); Object.assign(sl.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 600 });
    surf.add(sl, sl.target, new THREE.HemisphereLight(0xb4c4c8, 0x40484a, 1.1));
    const ranger = createRanger(); surf.add(ranger);
    // wreckage of the previous lander, scattered in the shallows
    const wreckMat = new THREE.MeshStandardMaterial({ color: 0x8e8e8a, roughness: 0.6, metalness: 0.5 });
    for (let i = 0; i < 9; i++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1 + Math.random() * 4, 0.3 + Math.random(), 1 + Math.random() * 2), wreckMat);
      w.position.set(60 + Math.random() * 60, 0.1, -40 + Math.random() * 50); w.rotation.set(Math.random(), Math.random() * 3, Math.random() * 0.5);
      surf.add(w);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.4, 0.2) }));
    beacon.position.set(80, 1.2, -20); surf.add(beacon);
    const spray = createSmokeTrail({ count: 700, t0: 22, t1: 30, path: (b, o) => o.set(Math.cos(b * 11) * 6, 0.5, Math.sin(b * 11) * 6), spread: 6, rise: 1.5, grow: 3, life: 8, size: 10, color: new THREE.Color(0.85, 0.88, 0.9), sunDir: sunSurf });
    surf.add(spray);
    const spray2 = createSmokeTrail({ count: 700, t0: 60, t1: 68, path: (b, o) => o.set(Math.cos(b * 13) * 7, 0.5, Math.sin(b * 13) * 7), spread: 8, rise: 2.5, grow: 3, life: 8, size: 12, color: new THREE.Color(0.85, 0.88, 0.9), sunDir: sunSurf });
    surf.add(spray2);
    const surfLayer = { scene: surf, near: 0.3, far: 60000 };

    // --- back in orbit with the Endurance ---
    const fgOrbit = shipScene({ sunDir: toBH, env: ctx.envOther, intensity: 2.4, ambient: 0.12, shadowSize: 50 });
    fgOrbit.userData.sun.color.setRGB(1, 0.82, 0.62);
    const end = enduranceWithRanger(); fgOrbit.add(end);
    const orbitLayer = { scene: fgOrbit, near: 0.5, far: 50000 };
    const G2 = gargantuaLayer();
    G2.origin.copy(SYS.miller).add(V(4, 1.2, 9));

    const basisSurf = new THREE.Quaternion().setFromUnitVectors(skyBH, toBH);
    let phase = 0;

    // ranger pose on the surface
    const rangerSurface = (lt, out) => {
      let y;
      if (lt < 30) y = lerp(140, 0.6, easeOut(seg(lt, 18, 30)));
      else if (lt < 60) y = 0.6;
      else if (lt < 78) y = 0.6 + Math.pow(Math.max(0, lt - 60), 2.1) * 0.9;
      else y = 1200 + Math.pow(lt - 78, 1.6) * 60; // over the crest and away
      const x = lt < 30 ? lerp(-80, 0, easeOut(seg(lt, 18, 30))) : lt > 62 ? Math.pow(lt - 62, 2) * 1.6 : 0;
      // riding up the wave face
      const hw = waveHeightJS(x, lt);
      out.set(x, Math.max(y, hw + 25 * sseg(lt, 66, 72)), 0);
      return out;
    };

    const ch = {
      layers: [G, P, entryLayer], allLayers: [G, P, entryLayer, surfLayer, orbitLayer, G2],
      subject: rEntry, sunDir: sunSurf, chase: { offset: V(0, 4, -26), look: V(0, 0, 20) }, cockpit: rEntry.userData.cockpit, freeDist: 50,
      bhLayer: G,
      update(lt, dt) {
        G.bh.uniforms.uTime.value = G2.bh.uniforms.uTime.value = lt + 200;
        phase = lt < 19 ? 0 : lt < 95 ? 1 : 2;
        if (phase === 0) {
          this.layers = [G, P, entryLayer];
          G.basis.copy(basisSurf);
          const alt = lerp(420, 25, easeIn(seg(lt, 0, 19)));
          P.origin.set(0, 6800 + alt, 0);
          P.basis.identity();
          planet.userData.update(lt);
          rEntry.position.set(0, 0, 0);
          rEntry.quaternion.setFromEuler(new THREE.Euler(0.55, 0.3, Math.sin(lt * 7) * 0.02)); // nose-high entry attitude
          const pl = bump(lt, 3, 7, 14, 18.5);
          plasma.userData.u.uI.value = pl; plasma.userData.u.uTime.value = lt;
          rEntry.userData.setThrust(lt > 16 ? 0.4 : 0, lt);
          this.subject = rEntry; this.cockpit = rEntry.userData.cockpit; this.sunDir = sunSurf;
          aimSun(fgEntry, sunSurf, V());
        } else if (phase === 1) {
          this.layers = [G, surfLayer];
          G.basis.copy(basisSurf);
          ocean.userData.u.uTime.value = lt;
          ocean.userData.u.uWX.value = waveX(lt);
          ocean.userData.u.uWH.value = lt > WAVE_T0 - 2 ? waveH(lt) : 0;
          rangerSurface(lt, ranger.position);
          const climb = sseg(lt, 60, 66);
          ranger.rotation.set(-climb * 0.9 + (lt > 66 && lt < 76 ? -0.35 : 0), Math.PI / 2, 0);
          ranger.userData.setThrust(lt < 30 ? 0.6 * (1 - seg(lt, 27, 30)) : lt > 59 ? 1 : 0, lt);
          ranger.userData.blink(lt);
          spray.userData.update(lt); spray2.userData.update(lt);
          beacon.visible = Math.floor(lt * 2) % 2 === 0;
          sl.target.position.copy(ranger.position); sl.position.copy(ranger.position).addScaledVector(sunSurf, 300); sl.target.updateMatrixWorld();
          this.subject = ranger; this.cockpit = ranger.userData.cockpit; this.chase = { offset: V(0, 6, -30), look: V(0, 0, 20) };
        } else {
          this.layers = [G2, orbitLayer];
          const u = seg(lt, 95, 127);
          end.userData.spin.rotation.z = spinAngle(lt + 400);
          end.quaternion.setFromUnitVectors(V(0, 0, -1), G2.origin.clone().negate().normalize());
          const r = end.userData.ranger;
          r.visible = true;
          // the returning ranger is the docked one easing into the collar
          this.subject = end; this.cockpit = V(0, 4, -16); this.chase = { offset: V(0, 14, 90), look: V(0, 0, -200) };
          this.sunDir = G2.origin.clone().negate().normalize();
          fgOrbit.userData.sun.position.copy(this.sunDir).multiplyScalar(200);
          aimSun(fgOrbit, this.sunDir, V());
        }
      },
      afterCamera(cam) {
        if (phase === 0) { G.sync(cam); P.sync(cam); }
        else if (phase === 1) G.sync(cam);
        else G2.sync(cam);
      },
      shot(lt, cam) {
        cam.fov = 45;
        if (phase === 0) {
          if (lt < 8) { cam.fov = 40; lookAt(cam, V(18, 8, 30), V(0, -2, 0)); shake(cam, lt, 0.05 + 0.2 * seg(lt, 3, 8)); }
          else if (lt < 14) { cam.fov = 60; lookAt(cam, V(-4, 6, -18), V(0, -40, 60)); shake(cam, lt, 0.35, 26); }
          else { cam.fov = 50; lookAt(cam, V(12, -6, 26), V(0, 0, 0)); shake(cam, lt, 0.3, 22); }
        } else if (phase === 1) {
          const R = ranger.position;
          if (lt < 30) { cam.fov = 40; lookAt(cam, V(-30, 4, 48), R.clone().add(V(0, 1, 0))); shake(cam, lt, lt < 24 ? 0.05 : 0); }
          else if (lt < 38) { cam.fov = 55; lookAt(cam, V(9, 1.7, 7), V(60, 1, -20)); }
          else if (lt < 44) { cam.fov = 30; lookAt(cam, V(40, 2.2, 35), V(-3000, 150, -600)); }
          else if (lt < 52) {
            // "those mountains…" — the horizon is moving
            cam.fov = lerp(28, 20, seg(lt, 44, 52));
            lookAt(cam, V(8, 1.8, 10), V(waveX(lt), waveH(lt) * 0.5, -200));
          } else if (lt < 60) {
            cam.fov = 50; lookAt(cam, V(60, 2, 40), R.clone().add(V(-30, 20, 0)));
            shake(cam, lt, 0.05);
          } else if (lt < 70) {
            cam.fov = 55; lookAt(cam, R.clone().add(V(40, -5, 60)), R.clone().add(V(-200, 100, 0)));
            shake(cam, lt, 0.5, 15);
          } else if (lt < 80) {
            // up the face of the wave
            cam.fov = 60; lookAt(cam, R.clone().add(V(30, 10, 45)), R.clone());
            shake(cam, lt, 0.6, 18);
          } else {
            cam.fov = 45; lookAt(cam, R.clone().add(V(-30, -10, 40)), R.clone().add(V(-600, -400, 0)));
            shake(cam, lt, 0.2, 18);
          }
        } else {
          const u = easeInOut(seg(lt, 95, 127));
          cam.fov = 38;
          const a = 0.5 + u * 1.2;
          lookAt(cam, V(Math.cos(a) * 100, lerp(20, 40, u), Math.sin(a) * 100), V(0, 0, 0));
        }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        return {
          white: bump(lt, 17.5, 18.8, 19.2, 21) * 0.95 + bump(lt, 92.5, 94.5, 95, 97) * 0.9,
          heat: bump(lt, 4, 8, 13, 17) * 0.18,
          distort: bump(lt, 4, 8, 13, 17) * 0.15,
          letterbox: 1, bloom: phase === 1 ? 0.45 : 0.85, exposure: phase === 1 ? 0.85 : 1.0, grain: 0.07,
        };
      },
      clock(lt) {
        const proper = Math.max(0, lt - 18) * PROPER_PER_SEC * (lt < 95 ? 1 : 0) + (lt >= 95 ? 77 * PROPER_PER_SEC : 0);
        return `SHIP ${fmt.time(Math.min(proper, 77 * PROPER_PER_SEC))}`;
      },
      telemetry(lt) {
        const proper = Math.min(Math.max(0, lt - 18), 77) * PROPER_PER_SEC;
        const earthYears = (proper * GARGANTUA.millerDilation) / C.year;
        const rows = [
          ['SHIP TIME ON MILLER', fmt.time(proper)],
          ['EARTH TIME ELAPSED', fmt.ymd(earthYears), earthYears > 5 ? 'warn' : ''],
          ['DILATION', '1 hour = 7 years'],
        ];
        if (lt < 19) rows.push(['PHASE', 'ATMOSPHERIC ENTRY'], ['ALTITUDE', `${fmt.n(lerp(420, 25, easeIn(seg(lt, 0, 19))), 0)} km`], ['HULL TEMP', `${fmt.n(300 + bump(lt, 3, 7, 14, 18.5) * 1350, 0)} K`, lt > 4 && lt < 16 ? 'warn' : '']);
        else if (lt < 95) {
          const d = Math.max(0, ranger.position.x - waveX(lt));
          rows.push(['SURFACE GRAVITY', '1.30 g'], ['WATER DEPTH', '0.3 m']);
          if (lt > WAVE_T0) rows.push(['TIDAL WAVE HEIGHT', `${fmt.n(waveH(lt), 0)} m`, 'warn'], ['WAVE DISTANCE', fmt.km(d), d < 3000 ? 'warn' : '']);
          if (lt > 59) rows.push(['ENGINES', 'FULL THRUST', 'ok']);
        } else rows.push(['STATUS', 'DOCKED · ENDURANCE', 'ok'], ...bhTelemetry(G2.origin.length()).slice(3));
        return rows;
      },
      telemetrySource: () => 'Δt_Earth = 61,362 × Δτ (Thorne: Miller at r ≈ 1.000037 r_horizon of a near-extremal Kerr hole)',
      minimap: (g, lt) => drawSystem(g, SYS.miller.clone().add(V(4, 1.2, 9)), { highlight: 'miller', label: lt < 95 ? 'RANGER · MILLER' : 'ENDURANCE' }),
      cards: [[108, 117, '23 YEARS · 4 MONTHS · 8 DAYS', 'the price of three hours']],
      logs: [
        [2, 'CASE', 'Entry interface. Heat shield to the wind.', 4],
        [9, 'TARS', 'Hull temperature nominal. Ish.', 3.5],
        [24, 'CREW', 'Touchdown. It’s water — only ankle-deep. Everywhere.', 5],
        [32, 'CREW', 'Debris over there. Her lander. It’s in pieces.', 4.5],
        [40, 'CASE', 'Those ridges on the horizon are not mountains.', 4.5],
        [48, 'CREW', 'It’s a wave. Get back to the ship, now!', 4],
        [57, 'TARS', 'Engines are flooded. Draining… thirty seconds.', 4.5],
        [61, 'CREW', 'Go, go, go!', 2.5],
        [72, 'CASE', 'We are on the face of the wave. Hold on!', 4],
        [86, 'CREW', 'We made it over. We made it…', 4],
        [99, 'CREW', 'How long were we gone?', 3.5],
        [104, 'CASE', 'We waited for you. A long time.', 4.5],
        [118, 'CREW', 'Twenty-three years of messages from home. Twenty-three years I missed.', 7],
      ],
    };
    return ch;
  },
};
