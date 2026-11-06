import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, shake, clamp, easeInOut } from '../core/util.js';
import { ScaledLayer, skyLayer, shipScene, aimSun } from './base.js';
import { createEarth } from '../world/planets.js';
import { createRocket, createRanger } from '../world/ships.js';
import { buildLauncher, model } from '../world/models.js';
import { createPlume } from '../world/fx.js';

/** Real Saturn V (NASA model) when available, with a Ranger in place of the Apollo CSM. */
function launcherWithRanger(ranger) {
  const rocket = buildLauncher(createPlume) || createRocket();
  const u = rocket.userData;
  const payloadY = u.payloadY ?? 86;
  ranger.rotation.x = -Math.PI / 2;
  u.stage3.add(ranger); ranger.position.y = payloadY + 7 - u.stage3.position.y;
  if (u.hideTop) u.hideTop(); else u.stage3.children[1].visible = false;
  u.rangerTop = payloadY + 7;
  return rocket;
}
import { createSmokeTrail } from '../world/fx.js';
import { simulateAscent, sampleAscent } from '../data/ascent.js';
import { NOISE } from '../gl/noise.js';
import { fmt } from '../data/astro.js';

const SITE = { lat: 28.57, lon: -80.65 }; // LC-39A, Florida

function siteDir(lat, lon) {
  const u = (lon + 180) / 360, v = (90 - lat) / 180;
  return V(-Math.cos(2 * Math.PI * u) * Math.sin(Math.PI * v), Math.cos(Math.PI * v), Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * v)).normalize();
}

// lt (chapter seconds) -> simulated mission time
function simTime(lt) {
  if (lt < 2) return lt - 2;
  if (lt < 28) return (lt - 2) * 2.2;
  return 57.2 + (lt - 28) * 15;
}

function skyDome(sunDir) {
  const u = { uSun: { value: sunDir }, uAlt: { value: 0 } };
  const m = new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 24), new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uAlt; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float k = smoothstep(0.0, 45000.0, uAlt);
        float e = max(d.y, 0.0);
        vec3 zen = mix(vec3(0.16, 0.34, 0.78), vec3(0.0, 0.01, 0.04), k);
        vec3 hor = mix(vec3(0.72, 0.82, 0.93), vec3(0.25, 0.45, 0.85), k);
        vec3 col = mix(hor, zen, pow(e, 0.45));
        col = mix(col, vec3(0.55, 0.6, 0.62), smoothstep(0.0, -0.08, d.y));
        float mu = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(mu, 8.0) * 0.35 + pow(mu, 200.0) * 2.0) + vec3(1.0,0.95,0.9) * smoothstep(0.9996, 0.9999, mu) * 40.0;
        gl_FragColor = vec4(col * 1.05, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false,
  }));
  m.renderOrder = -100;
  m.onBeforeRender = (r, s, c) => { m.position.copy(c.position); m.updateMatrixWorld(); };
  m.frustumCulled = false;
  m.userData.u = u;
  return m;
}

function groundPlane(sunDir) {
  const u = { uSun: { value: sunDir }, uFog: { value: new THREE.Color(0.72, 0.8, 0.9) }, uScorch: { value: 0 } };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(120000, 120000, 1, 1), new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uFog; uniform float uScorch; varying vec3 vW;
      ${NOISE}
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 p = vW.xz;
        vec2 cell = floor(p / 220.0 + vec2(snoise(vec3(p * 0.0007, 1.0)) * 0.6));
        float r = h2(cell);
        vec3 c = mix(vec3(0.24, 0.30, 0.12), vec3(0.60, 0.53, 0.28), r);
        if (r > 0.84) c = vec3(0.33, 0.26, 0.18);
        float rows = 0.86 + 0.14 * sin((r > 0.5 ? p.x : p.y) * 2.2);
        float dist = length(vW - cameraPosition);
        c *= mix(rows, 1.0, smoothstep(300.0, 1500.0, dist));
        c *= 0.82 + 0.25 * snoise(vec3(p * 0.004, 2.0)) + 0.08 * snoise(vec3(p * 0.05, 3.0));
        vec2 f = abs(fract(p / 1600.0) - 0.5) * 1600.0;
        c = mix(vec3(0.42, 0.41, 0.39), c, smoothstep(3.0, 6.0, min(f.x, f.y)));
        float d = length(p);
        c = mix(vec3(0.52, 0.51, 0.49), c, smoothstep(60.0, 75.0, d));
        c = mix(c, vec3(0.05, 0.045, 0.04), uScorch * smoothstep(40.0, 5.0, d));
        float lit = max(uSun.y, 0.0) * 1.9 + 0.38;
        vec3 col = c * lit;
        float fog = 1.0 - exp(-dist / 32000.0);
        col = mix(col, uFog * 1.05, fog);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  m.rotation.x = -Math.PI / 2;
  m.userData.u = u;
  return m;
}

export function cloudLayer(y, sunDir, coverage = 0.45, scale = 0.00025) {
  const u = { uSun: { value: sunDir }, uCov: { value: coverage }, uScale: { value: scale }, uTime: { value: 0 } };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uCov, uScale, uTime; varying vec3 vW;
      ${NOISE}
      void main(){
        vec2 p = vW.xz * uScale;
        float n = fbm(vec3(p, uTime * 0.01)) * 0.5 + 0.5;
        float a = smoothstep(1.0 - uCov, 1.0 - uCov + 0.25, n);
        float dist = length(vW - cameraPosition);
        a *= 1.0 - smoothstep(40000.0, 90000.0, dist);
        float shade = 0.75 + 0.35 * (fbm(vec3(p * 2.0 + 0.3, 1.0)) * 0.5 + 0.5);
        vec3 col = vec3(1.0, 0.98, 0.95) * shade * (0.95 + 0.5 * uSun.y);
        gl_FragColor = vec4(col, a * 0.95);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.rotation.x = -Math.PI / 2; m.position.y = y;
  m.userData.u = u;
  return m;
}

function launchTower() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a2f1d, roughness: 0.8, metalness: 0.3 });
  const H = 118, W = 10;
  const beams = [];
  for (const [x, z] of [[0, 0], [W, 0], [0, W], [W, W]]) beams.push([x, H / 2, z, 0.6, H, 0.6]);
  for (let y = 0; y < H; y += 6) {
    beams.push([W / 2, y, 0, W, 0.35, 0.35], [W / 2, y, W, W, 0.35, 0.35], [0, y, W / 2, 0.35, 0.35, W], [W, y, W / 2, 0.35, 0.35, W]);
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, beams.length + 40);
  const m = new THREE.Matrix4();
  beams.forEach(([x, y, z, sx, sy, sz], i) => { m.compose(V(x, y, z), new THREE.Quaternion(), V(sx, sy, sz)); inst.setMatrixAt(i, m); });
  // diagonal braces
  for (let k = 0; k < 40; k++) {
    const y = k * 3 + 1.5, side = k % 4;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (side * Math.PI) / 2, (k % 2 ? 1 : -1) * 0.78));
    const pos = [[W / 2, y, 0], [W, y, W / 2], [W / 2, y, W], [0, y, W / 2]][side];
    m.compose(V(...pos), q, V(8.4, 0.25, 0.25)); inst.setMatrixAt(beams.length + k, m);
  }
  inst.castShadow = true;
  g.add(inst);
  // swing arms
  for (const y of [70, 86, 95]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 1.6), mat); arm.position.set(W + 7, y, W / 2); g.add(arm); }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1) }));
  beacon.position.set(W / 2, H + 1, W / 2); g.add(beacon);
  g.position.set(-24, 0, -W / 2);
  return g;
}

export default {
  id: 'launch', kicker: 'PHASE 1 · EARTH', title: 'Ascent', start: 68, end: 140,
  build(ctx) {
    const sim = simulateAscent();
    const sunGround = V(0.8, 0.42, -0.42).normalize();

    // ---------------- Phase A: ground (metres) ----------------
    const ground = new THREE.Scene();
    ground.environment = ctx.envOurs; ground.environmentIntensity = 0.6;
    const sky = skyDome(sunGround); ground.add(sky);
    const gp = groundPlane(sunGround); ground.add(gp);
    const clouds = cloudLayer(3800, sunGround, 0.42); ground.add(clouds);
    const cirrus = cloudLayer(9500, sunGround, 0.3, 0.00008); ground.add(cirrus);
    ground.add(launchTower());
    const sunA = new THREE.DirectionalLight(0xfff1dc, 2.4); sunA.position.copy(sunGround).multiplyScalar(300);
    sunA.castShadow = true; sunA.shadow.mapSize.set(2048, 2048);
    Object.assign(sunA.shadow.camera, { left: -80, right: 80, top: 140, bottom: -20, near: 1, far: 800 });
    ground.add(sunA, sunA.target);
    ground.add(new THREE.HemisphereLight(0xa8c4ff, 0x4a4030, 0.5));
    const ranger = createRanger();
    const rocket = launcherWithRanger(ranger);
    ground.add(rocket);
    const flameLight = new THREE.PointLight(0xff9a4a, 0, 1500, 1.2); ground.add(flameLight);
    const posAt = (T, out) => { const s = sampleAscent(sim, Math.max(0, T)); return out.set(s.downrange, s.h, 0); };
    const contrail = createSmokeTrail({ count: 2400, t0: 0, t1: 62, path: posAt, spread: 5, rise: 0.4, grow: 9, life: 70, size: 22, sunDir: sunGround });
    ground.add(contrail);
    const padSmoke = createSmokeTrail({ count: 900, t0: -0.5, t1: 14, path: (b, o) => o.set(Math.cos(b * 9.7) * 18, 4, Math.sin(b * 9.7) * 18), spread: 16, rise: 1.2, grow: 3, life: 40, size: 50, color: new THREE.Color(0.92, 0.9, 0.88), sunDir: sunGround });
    ground.add(padSmoke);
    const groundLayer = { scene: ground, near: 0.5, far: 150000, visible: true };

    // ---------------- Phase B: space (Earth in km, rocket in metres) ----------------
    const bg = new ScaledLayer({ near: 0.5, far: 400000, scale: 0.001 });
    const site = siteDir(SITE.lat, SITE.lon);
    const sunFg = V(0.62, 0.42, -0.66).normalize();
    // fg axes: x = downrange (east), y = local up, z = north. Built per frame from ship position.
    const basisQ = new THREE.Quaternion();
    const sunBg = new THREE.Vector3();
    const earth = createEarth({ radius: 6371, sunDir: sunBg, kmPerUnit: 1, segments: 256 });
    bg.scene.add(earth);
    const bgSky = skyLayer('ours', 0.0);
    const fg = shipScene({ sunDir: sunFg, env: ctx.envOurs, intensity: 3.6, shadowSize: 70 });
    const rangerB = createRanger();
    const rocketB = launcherWithRanger(rangerB);
    const stackB = new THREE.Group(); stackB.add(rocketB); fg.add(stackB);
    rocketB.position.y = -50;
    const freeRanger = createRanger(); freeRanger.visible = false; fg.add(freeRanger);
    const fgLayer = { scene: fg, near: 0.5, far: 50000, visible: true };

    const tmpUp = new THREE.Vector3(), tmpE = new THREE.Vector3(), tmpN = new THREE.Vector3(), m4 = new THREE.Matrix4();
    let S = sampleAscent(sim, 0);
    let phase = 0;

    const ch = {
      layers: [groundLayer],
      subject: rocket, sunDir: sunGround,
      chase: { offset: V(0, -30, -60), look: V(0, 40, 0) },
      cockpit: V(0, 100, 3), freeDist: 160,
      update(lt, dt) {
        const T = simTime(lt);
        S = sampleAscent(sim, Math.max(0, T));
        phase = lt < 28 ? 0 : 1;
        const thr = T < 0 ? 0 : 1;
        if (phase === 0) {
          this.layers = [groundLayer];
          this.subject = rocket; this.sunDir = sunGround;
          this.chase = { offset: V(0, 60, -90), look: V(0, 40, 0) };
          this.cockpit = V(6.5, 88, 0);
          rocket.position.set(S.downrange, Math.max(0, S.h), 0);
          rocket.rotation.z = -(Math.PI / 2 - Math.max(S.gamma, 0.2)) * (T > 0 ? 1 : 0);
          if (T < 12) rocket.rotation.z = 0;
          const ign = clamp((T + 0.6) / 1.2);
          rocket.userData.plume1.userData.set(ign * (T < 0 ? 0.6 : 1), lt, 0);
          rocket.userData.plume2.userData.set(0, lt);
          flameLight.position.copy(rocket.position).add(V(0, -8, 0));
          flameLight.intensity = ign * 9e3;
          gp.userData.u.uScorch.value = clamp(T / 6);
          sky.userData.u.uAlt.value = 0;
          contrail.userData.update(Math.max(T, 0));
          padSmoke.userData.update(T);
          clouds.userData.u.uTime.value = lt;
          sunA.target.position.copy(rocket.position); sunA.position.copy(rocket.position).addScaledVector(sunGround, 300); sunA.target.updateMatrixWorld();
        } else {
          // place the ship over the real Earth: rotate the launch site eastward by the downrange angle
          const up = tmpUp.copy(site).applyAxisAngle(V(0, 1, 0), S.theta);
          const east = tmpE.crossVectors(V(0, 1, 0), up).normalize();
          const north = tmpN.crossVectors(east, up).normalize().negate();
          m4.makeBasis(east, up, north.clone().negate());
          basisQ.setFromRotationMatrix(m4);
          bg.origin.copy(up).multiplyScalar(6371 + S.h / 1000);
          sunBg.copy(sunFg).applyQuaternion(basisQ);
          earth.userData.update(lt);
          bgSky.sky.userData.setGain(sseg(S.h, 30000, 90000) * 0.9);
          bgSky.sky.userData.update(lt);
          this.layers = [bgSky, bg, fgLayer];
          this.sunDir = sunFg;
          // stack orientation = flight path angle
          const pitch = Math.max(S.gamma, 0);
          stackB.rotation.z = -(Math.PI / 2 - pitch);
          const st = S.stage;
          const sep1 = clamp((T - 161) / 25);
          const r = rocketB.userData;
          r.stage1.position.set(0, -sep1 * sep1 * 160, 0); r.stage1.rotation.x = sep1 * 1.4; r.stage1.rotation.z = sep1 * 0.6;
          r.plume1.userData.set(st === 0 ? 1 : Math.max(0, 1 - (T - 161) * 3), lt, sseg(S.h, 20000, 70000));
          r.stage1.visible = sep1 < 1;
          r.plume2.userData.set(st >= 1 && st < 99 && T > 163 ? 1 : 0, lt, 0.6);
          // ranger separation at lt 62
          const sepR = clamp((lt - 62) / 10);
          if (lt >= 62) {
            rangerB.visible = false; freeRanger.visible = true;
            const p = new THREE.Vector3(0, rocketB.userData.rangerTop - 50, 0).applyEuler(stackB.rotation);
            const dir = V(0, 1, 0).applyEuler(stackB.rotation);
            freeRanger.position.copy(p).addScaledVector(dir, 2 + sepR * sepR * 260);
            freeRanger.quaternion.setFromUnitVectors(V(0, 0, 1), dir);
            freeRanger.userData.setThrust(clamp((lt - 64) / 1.5) * 0.8, lt);
            this.subject = freeRanger;
            this.chase = { offset: V(0, 5, -26), look: V(0, 0, 12) };
            this.cockpit = freeRanger.userData.cockpit;
          } else {
            rangerB.visible = true; freeRanger.visible = false;
            this.subject = stackB;
            this.chase = { offset: V(-25, 0, -70), look: V(0, 30, 0) };
            this.cockpit = V(6.2, 43, 0);
          }
          aimSun(fg, sunFg, this.subject.position);
        }
      },
      afterCamera(cam) {
        if (phase === 1) {
          bg.basis.copy(basisQ);
          bg.sync(cam);
          bgSky.camera = bg.camera; // sky follows the bg camera's orientation
        }
      },
      shot(lt, cam) {
        cam.fov = 50;
        const R = rocket.position;
        if (lt < 7.5) {
          cam.fov = 55;
          lookAt(cam, V(110, 6, 120), V(R.x, R.y + 50, R.z));
          shake(cam, lt, lt > 2 ? 0.25 * clamp((lt - 2) / 2) : 0);
        } else if (lt < 14) {
          cam.fov = 32;
          lookAt(cam, V(700, 30, 650), V(R.x, R.y + 45, R.z));
          shake(cam, lt, 0.4);
        } else if (lt < 22) {
          cam.fov = lerp(22, 14, seg(lt, 14, 22));
          lookAt(cam, V(2200, 40, 2600), V(R.x, R.y + 30, R.z));
          shake(cam, lt, 0.8, 9);
        } else if (lt < 28) {
          // onboard camera looking down along the first stage
          cam.fov = 70;
          const p = R.clone().add(V(6.2, 60, 0).applyEuler(rocket.rotation));
          const t = R.clone().add(V(2, -150, 0).applyEuler(rocket.rotation));
          lookAt(cam, p, t, V(1, 0, 0));
          shake(cam, lt, 0.04, 30);
        } else {
          const sub = stackB;
          const up = V(0, 1, 0).applyEuler(sub.rotation);
          const side = V(0, 0, 1);
          if (lt < 35) {
            cam.fov = 45;
            lookAt(cam, up.clone().multiplyScalar(lerp(-20, 30, seg(lt, 28, 35))).addScaledVector(side, 70).add(V(0, -20, 0)), up.clone().multiplyScalar(10));
            shake(cam, lt, 0.15, 25);
          } else if (lt < 41) {
            cam.fov = 40;
            lookAt(cam, up.clone().multiplyScalar(-10).addScaledVector(side, -95).add(V(30, -25, 0)), up.clone().multiplyScalar(-30));
          } else if (lt < 52) {
            cam.fov = 32;
            const u = seg(lt, 41, 52);
            lookAt(cam, up.clone().multiplyScalar(40).add(V(-20, 12 - u * 16, 95 - u * 25)), up.clone().multiplyScalar(25).add(V(0, -10, 0)));
          } else if (lt < 62) {
            cam.fov = 60;
            lookAt(cam, up.clone().multiplyScalar(52).addScaledVector(side, 14).add(V(0, 6, 0)), up.clone().multiplyScalar(-60).add(V(0, -120, 0)));
          } else {
            cam.fov = 38;
            const fr = freeRanger.position;
            const u = seg(lt, 62, 72);
            lookAt(cam, fr.clone().add(V(-40 + u * 10, 18, 50 - u * 20)), fr.clone().add(V(0, 0, 0)));
          }
        }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        const T = simTime(lt);
        const h = S.h;
        const cloudFog = bump(lt, 26.2, 27.6, 28.0, 29.6);
        return {
          white: cloudFog * 0.92,
          flash: bump(lt, 1.6, 2.1, 2.3, 3.4) * 0.35 + bump(lt, 34.6, 35.0, 35.2, 36.4) * 0.4,
          letterbox: lt < 28 ? 1 : 0.6,
          bloom: lt < 28 ? 0.45 : 0.75, exposure: lt < 28 ? 0.72 : 1.0, aberration: 0.0015 + (lt > 2 && lt < 28 ? 0.002 : 0),
          grain: 0.06,
        };
      },
      telemetry(lt) {
        const T = simTime(lt);
        const ev = T < 0 ? 'COUNTDOWN' : T < 8 ? 'LIFTOFF' : Math.abs(T - sim.tMaxQ) < 10 ? 'MAX-Q' : T < 161 ? 'S-IC BURN' : T < 170 ? 'STAGING · S-II IGNITION' : S.stage < 99 ? 'S-II BURN' : lt < 62 ? 'ORBIT INSERTION' : 'RANGER SEPARATION';
        return [
          ['MISSION TIME', `T${T < 0 ? '−' : '+'}${fmt.time(Math.abs(T))}`],
          ['EVENT', ev, T > 0 && T < 8 ? 'warn' : ''],
          ['ALTITUDE', fmt.km(Math.max(0, S.h))],
          ['VELOCITY', `${fmt.n(S.v, 0)} m/s`],
          ['DOWNRANGE', fmt.km(S.downrange)],
          ['FLIGHT PATH', `${fmt.n((S.gamma * 180) / Math.PI, 1)}°`],
          ['ACCEL', `${fmt.n(T > 0 ? S.gLoad : 1, 2)} g`],
          ['DYN. PRESSURE', `${fmt.n(S.q / 1000, 1)} kPa`],
          ['MASS', `${fmt.n(S.m / 1000, 0)} t`],
          ['SIM WARP', T < 0 ? '×1' : lt < 28 ? '×2.2' : '×15'],
        ];
      },
      telemetrySource: () => `2-D ascent sim · max-Q ${fmt.n(sim.maxQ / 1000, 1)} kPa @ T+${fmt.n(sim.tMaxQ, 0)} s`,
      cards: [[1.2, 3.6, 'IGNITION', 'LC-39A · Kennedy Space Center']],
      logs: [
        [0.0, 'CONTROL', 'All stations go. Main engine start.', 2.4],
        [3.5, 'CONTROL', 'Liftoff. The Endurance mission has cleared the tower.', 4],
        [16, 'CONTROL', 'Roll program complete. Throttling through max-Q.', 4.5],
        [30, 'CREW', 'Sky is going black. Beautiful.', 4],
        [35.2, 'CONTROL', 'Staging. Good second stage ignition.', 4],
        [55, 'CONTROL', 'Orbit insertion confirmed. Welcome to space.', 4.5],
        [64, 'CREW', 'Ranger is free. Pushing off for the Endurance.', 5],
      ],
    };
    return ch;
  },
};
