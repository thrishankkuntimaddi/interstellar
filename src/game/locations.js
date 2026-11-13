import * as THREE from 'three';
import { ScaledLayer, skyLayer, shipScene, aimSun, skySun } from '../chapters/base.js';
import { createEarth, createPlanet, createAlienPlanet } from '../world/planets.js';
import { createEndurance } from '../world/ships.js';
import { createStation, createPhobos, phobosRadius } from '../world/fleet.js';
import { createWormhole } from '../world/wormhole.js';
import { model } from '../world/models.js';
import { TEX } from '../world/assets.js';
import { SKY } from '../world/sky.js';
import { gargantuaLayer, SYS, RS_KM, RS_M } from '../chapters/gsys.js';
import { PLANETS, fmt, C } from '../data/astro.js';
import { Body } from './flight.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NOISE } from '../gl/noise.js';
import { buildLaunch } from './launch.js';
import { buildTesseract } from './tesseract.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function orbitalElements(r, v, mu) {
  const rr = r.length(), vv = v.length();
  const eps = (vv * vv) / 2 - mu / rr;
  const a = -mu / (2 * eps);
  const h = new THREE.Vector3().crossVectors(r, v).length();
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (mu * mu)));
  return { a, e, rp: a * (1 - e), ra: e < 1 ? a * (1 + e) : Infinity, period: e < 1 ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity };
}
const pointGravity = (mu) => (p, out) => { const r2 = p.lengthSq(), r = Math.sqrt(r2); return out.copy(p).multiplyScalar(-mu / (r2 * r)); };

function orbitRows(ship, MU, R, speedKm = false) {
  const el = orbitalElements(ship.pos, ship.vel, MU);
  return [
    ['ALTITUDE', fmt.km(ship.pos.length() - R)],
    ['ORBITAL SPEED', speedKm ? `${fmt.n(ship.vel.length() / 1000, 2)} km/s` : `${fmt.n(ship.vel.length(), 1)} m/s`],
    ['PERIAPSIS', fmt.km(el.rp - R), el.rp - R < 0 ? 'warn' : ''],
    ['APOAPSIS', el.ra === Infinity ? 'ESCAPE' : fmt.km(el.ra - R)],
    ['PERIOD', el.period === Infinity ? '—' : el.period > 7200 ? `${fmt.n(el.period / 3600, 2)} h` : `${fmt.n(el.period / 60, 1)} min`],
  ];
}

/**
 * A circular starting orbit (in the XY plane) around one of the Solar System's bodies.
 * The planet lives in a km-scale background layer; spacecraft live in a metre-scale foreground
 * with the player's ship at the origin. Every object is its own Keplerian body.
 */
function orbitLocation(ctx, def, c) {
  const P = PLANETS[c.key], MU = P.gm, R = P.radiusKm * 1000, r0 = R + c.alt0, vc = Math.sqrt(MU / r0);
  const sunDir = c.sunDir.clone().normalize();
  const sky = skyLayer('ours', 1.0);
  skySun(sky, sunDir, c.sun);
  const bg = new ScaledLayer({ near: c.bgNear || 1, far: c.bgFar, scale: 0.001 });
  const world = c.world(bg.scene, sunDir);
  const fg = shipScene({ sunDir, env: ctx.envOurs, intensity: c.light, ambient: 0.05, shadowSize: 40 });
  if (c.shine) { fg.userData.hemi.color.set(c.shine[0]); fg.userData.hemi.groundColor.set(c.shine[1]); fg.userData.hemi.intensity = c.shine[2]; }
  const fgLayer = { scene: fg, near: 0.3, far: 2e5 };
  const gravity = pointGravity(MU);
  const along = (d, dh = 0, dz = 0) => { const r = r0 + dh, th = d / r; return [V(r * Math.sin(th), r * Math.cos(th), dz), V(Math.cos(th), -Math.sin(th), 0).multiplyScalar(Math.sqrt(MU / r))]; };
  const objs = [];
  const add = (id, name, mesh, d, dh, dz, radius, opts = {}) => {
    const [p, v] = along(d, dh, dz); const b = new Body(p, v);
    fg.add(mesh); objs.push({ id, name, mesh, body: b, radius, ...opts }); return objs[objs.length - 1];
  };
  const extra = c.things?.({ add, fg, MU, R, r0, objs }) || {};
  const ship = def.build(); fg.add(ship);
  let simT = 0;
  return {
    id: c.id, name: c.name, kicker: c.kicker, units: 'm', bodyName: P.name,
    layers: [sky, bg, fgLayer], fg, sunDir, ranger: ship, objs, mu: MU, R, atmo: c.atmo,
    ship: { pos: V(0, r0, 0), vel: V(vc, 0, 0), quat: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), c.pitch || 0)) },
    shipParams: c.shipParams || { accel: 12, boost: 4, rcs: 2.5, retro: 6 },
    gravity: extra.gravity || gravity, music: c.music, hazard: extra.hazard,
    update(s, dt, t) {
      simT += dt;
      for (const o of objs) { o.body.step(dt, gravity); o.mesh.position.copy(o.body.pos).sub(s.pos); o.mesh.userData.blink?.(t); }
      world(simT, t);
      sky.sky.userData.update(t);
      bg.origin.copy(s.pos).multiplyScalar(0.001);
      aimSun(fg, sunDir, V());
      extra.update?.(s, dt, t, this);
    },
    afterCamera(cam) { bg.sync(cam); sky.camera = bg.camera; },
    collide(s) { return s.pos.length() < R + c.floor ? c.floorMsg : null; },
    telemetry(s) { return [...orbitRows(s, MU, R, vc > 5000), ...(extra.telemetry?.(s) || [])]; },
  };
}

// ===========================================================================
// EARTH ORBIT
// ===========================================================================
export function buildEarth(ctx, def) {
  return orbitLocation(ctx, def, {
    id: 'earth', key: 'earth', name: 'Earth Orbit', kicker: 'FREE FLIGHT · LOW EARTH ORBIT', alt0: 400e3, music: 140,
    sunDir: V(0.55, 0.42, -0.72), sun: { size: 70, intensity: 30 }, bgFar: 400000, light: 3.4, shine: [0x6a8fc4, 0x0a1a33, 0.55],
    atmo: { top: 125e3, kill: 72e3 }, floor: 72e3, floorMsg: 'Re-entry too steep. The hull broke up over the Pacific.',
    world(scene, sunDir) {
      const earth = createEarth({ radius: PLANETS.earth.radiusKm, sunDir, kmPerUnit: 1, segments: 256 });
      earth.rotation.z = 0.41; scene.add(earth);
      const moon = new THREE.Mesh(new THREE.SphereGeometry(1737, 96, 48), new THREE.MeshStandardMaterial({ map: TEX.moon, roughness: 1 }));
      moon.position.set(-250000, 90000, -260000); scene.add(moon);
      const ml = new THREE.DirectionalLight(0xffffff, 3); ml.position.copy(sunDir).multiplyScalar(1e5); scene.add(ml);
      return (simT, t) => { earth.rotation.y = 0.8 + simT * 7.2921159e-5; earth.userData.update(t); };
    },
    things({ add }) {
      const end = createEndurance(); end.userData.flood.intensity = 12;
      end.quaternion.setFromUnitVectors(V(0, 0, 1), V(-1, 0, 0));
      add('endurance', 'ENDURANCE', end, 380, 0, 0, 40, { dock: { port: V(0, 0, 7.9), axis: V(0, 0, 1) }, scan: 400 });
      add('iss', 'ISS', model('iss') || new THREE.Object3D(), 3200, 60, 250, 60, { scan: 500 });
      const hub = model('hubble') || new THREE.Object3D(); hub.rotation.set(0.4, 1.2, 0.2);
      add('hubble', 'HUBBLE', hub, 5200, 600, -400, 12, { scan: 250 });
    },
  });
}

// ===========================================================================
// THE MOON — 100 km low lunar orbit
// ===========================================================================
export function buildMoon(ctx, def) {
  return orbitLocation(ctx, def, {
    id: 'moon', key: 'moon', name: 'The Moon', kicker: 'FREE FLIGHT · LOW LUNAR ORBIT', alt0: 100e3, music: 205,
    sunDir: V(0.35, 0.3, -0.89), sun: { size: 70, intensity: 30 }, bgFar: 9e5, light: 3.4, shine: [0x8a8a86, 0x1c1c1c, 0.32],
    floor: 1500, floorMsg: 'Impact. A new crater on the lunar surface.',
    shipParams: { accel: 8, boost: 3, rcs: 2.5, retro: 5 },
    world(scene, sunDir) {
      const moon = new THREE.Mesh(new THREE.SphereGeometry(PLANETS.moon.radiusKm, 384, 192), new THREE.MeshStandardMaterial({ map: TEX.moon, bumpMap: TEX.moon, bumpScale: 1.2, roughness: 0.97, metalness: 0, color: 0xd0d0d0 }));
      moon.rotation.set(0.2, 2.2, 0); scene.add(moon);
      const sl = new THREE.DirectionalLight(0xfff6ea, 3.6); sl.position.copy(sunDir).multiplyScalar(1e5); scene.add(sl);
      const earth = createEarth({ radius: PLANETS.earth.radiusKm, sunDir, kmPerUnit: 1, segments: 96 });
      earth.position.copy(V(-0.55, 0.3, 0.78).normalize().multiplyScalar(384400)); earth.rotation.z = 0.41; scene.add(earth);
      return (simT, t) => { earth.rotation.y = 2.1 + simT * 7.2921159e-5; earth.userData.update(t); };
    },
    things({ add }) {
      const st = createStation();
      st.quaternion.setFromUnitVectors(V(0, 0, 1), V(-1, 0, 0));
      add('gateway', 'GATEWAY', st, 1500, 80, 60, 26, { dock: { port: st.userData.port, axis: st.userData.axis }, scan: 400 });
    },
  });
}

// ===========================================================================
// MARS — co-orbiting with Phobos, 5,990 km above the surface
// ===========================================================================
export function buildMars(ctx, def) {
  const MU_PH = 7.087e5;
  return orbitLocation(ctx, def, {
    id: 'mars', key: 'mars', name: 'Mars · Phobos', kicker: 'FREE FLIGHT · MARS · PHOBOS', alt0: 9376e3 - PLANETS.mars.radiusKm * 1000, music: 262,
    sunDir: V(-0.45, 0.35, -0.82), sun: { size: 50, intensity: 22 }, bgFar: 2e5, light: 2.9, shine: [0xc98a5e, 0x24140c, 0.3],
    atmo: { top: 120e3, kill: 50e3 }, floor: 50e3, floorMsg: 'Entered the Martian atmosphere at orbital speed.',
    shipParams: { accel: 8, boost: 3, rcs: 2.5, retro: 5 },
    world(scene, sunDir) {
      const mars = createPlanet({ map: TEX.mars, radius: PLANETS.mars.radiusKm, sunDir, kmPerUnit: 1, sun: 2.2, limb: 0.25, segments: 256,
        atmosphere: { thicknessKm: 90, Hkm: 11, beta: [19e-3, 12e-3, 6.5e-3], mie: 30e-3, intensity: 5 } });
      mars.rotation.z = 0.44; scene.add(mars);
      return (simT) => { mars.rotation.y = 1.3 + simT * (2 * Math.PI / (PLANETS.mars.rotH * 3600)); };
    },
    things({ add, MU }) {
      const ph = add('phobos', 'PHOBOS', createPhobos(), 42000, 0, 0, 9000, { surface: phobosRadius, scan: 30000, solid: true });
      const marsG = pointGravity(MU), g = V(), d = V(), x = V(), y = V(), z = V(0, 0, 1), m = new THREE.Matrix4(), inv = new THREE.Quaternion();
      let d0 = null;
      const lock = () => { x.copy(ph.body.pos).normalize().negate(); y.crossVectors(z, x).normalize(); m.makeBasis(x, y, z); ph.mesh.quaternion.setFromRotationMatrix(m); };
      lock();
      return {
        gravity(p, out) { marsG(p, out); d.copy(p).sub(ph.body.pos); const r = Math.max(d.length(), 8000); return out.addScaledVector(d, -MU_PH / (r * r * r)); },
        update(s, dt, t, loc) {
          lock(); // tidally locked: the long axis always points at Mars
          d.copy(s.pos).sub(ph.body.pos).applyQuaternion(inv.copy(ph.mesh.quaternion).invert()).normalize();
          if (!d0) d0 = d.clone(); else if (d.dot(d0) < -0.6 && loc.flags) loc.flags.farSide = true;
        },
        telemetry(s) {
          d.copy(s.pos).sub(ph.body.pos); const dist = d.length();
          const alt = dist - phobosRadius(g.copy(d).applyQuaternion(inv.copy(ph.mesh.quaternion).invert()));
          const vr = g.copy(s.vel).sub(ph.body.vel);
          return [['PHOBOS ALTITUDE', fmt.km(Math.max(0, alt)), alt < 300 ? 'ok' : ''], ['DESCENT RATE', `${fmt.n(-vr.dot(d) / dist, 2)} m/s`, -vr.dot(d) / dist > 4 && alt < 2000 ? 'warn' : ''], ['PHOBOS GRAVITY', `${fmt.n((MU_PH / Math.max(dist, 8000) ** 2) * 1000, 2)} mm/s²`]];
        },
      };
    },
  });
}

// ===========================================================================
// JUPITER — 14,000 km above the cloud tops, with Juno
// ===========================================================================
export function buildJupiter(ctx, def) {
  const RJ = PLANETS.jupiter.radiusKm * 1000;
  const flux = (s) => Math.pow(RJ * 1.2 / s.pos.length(), 7); // relative to the starting orbit
  return orbitLocation(ctx, def, {
    id: 'jupiter', key: 'jupiter', name: 'Jupiter', kicker: 'FREE FLIGHT · JUPITER', alt0: 14000e3, pitch: 0.38, music: 278,
    sunDir: V(0.7, 0.2, -0.69), sun: { size: 40, intensity: 16 }, bgNear: 5, bgFar: 4e6, light: 2.6, shine: [0xd8b890, 0x2a1c12, 0.35],
    atmo: { top: 1500e3, kill: 250e3 }, floor: 250e3, floorMsg: 'Crushed in Jupiter’s atmosphere.',
    shipParams: { accel: 12, boost: 5, rcs: 2.5, retro: 6 },
    world(scene, sunDir) {
      const jup = createPlanet({ map: TEX.jupiter, radius: PLANETS.jupiter.radiusKm, sunDir, kmPerUnit: 1, sun: 1.8, limb: 0.5, segments: 256 });
      jup.rotation.z = 0.054; scene.add(jup);
      return (simT) => { jup.rotation.y = 0.6 + simT * (2 * Math.PI / (PLANETS.jupiter.rotH * 3600)); };
    },
    things({ add }) {
      const juno = model('juno') || new THREE.Object3D(); juno.rotation.set(0.5, 0.3, 0.2);
      const o = add('juno', 'JUNO', juno, 3000, 120, -150, 10, { scan: 300 });
      return {
        update(s, dt) { o.mesh.rotateY(dt * 0.209); }, // Juno spins at 2 rpm
        telemetry(s) { const f = flux(s); return [['RADIATION FLUX', `× ${fmt.n(f, 2)}`, f > 2.2 ? 'warn' : '']]; },
        hazard(s) { const f = flux(s); return f > 2.2 ? { dmg: (f - 2.2) * 0.07, label: 'RADIATION' } : null; }, // a full Keplerian pass through the belts costs about half a hull
      };
    },
  });
}

// ===========================================================================
// SATURN — inside the A ring
// ===========================================================================
function iceChunk(seed) {
  let g = new THREE.IcosahedronGeometry(1, 5);
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); // weld → smooth shading
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.3 * Math.sin(v.x * 2.3 + seed) * Math.cos(v.z * 1.9 + seed * 2) + 0.14 * Math.sin(v.y * 5 + seed * 5) + 0.06 * Math.sin(v.x * 11 + v.z * 9) + 0.025 * Math.sin(v.x * 31 + v.y * 27);
    v.multiplyScalar(n); p.setXYZ(i, v.x, v.y * 0.85, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildSaturn(ctx, def) {
  const MU = PLANETS.saturn.gm, RS = PLANETS.saturn.radiusKm * 1000, R = PLANETS.saturn.rings;
  const r0 = 131000e3, vc = Math.sqrt(MU / r0);
  const sunDir = V(0.8, 0.28, 0.53).normalize();
  const sky = skyLayer('ours', 1.0);
  skySun(sky, sunDir, { size: 36, intensity: 14 });
  const bg = new ScaledLayer({ near: 5, far: 4e6, scale: 0.001 });
  const saturn = createPlanet({ map: TEX.saturn, radius: PLANETS.saturn.radiusKm, sunDir, kmPerUnit: 1, sun: 1.5, limb: 0.45, segments: 192, ring: { inner: R.dInner, outer: R.fRing } });
  bg.scene.add(saturn);
  const fg = shipScene({ sunDir, env: ctx.envOurs, intensity: 2.8, ambient: 0.06, shadowSize: 40 });
  fg.userData.hemi.color.set(0xd8c8a0); fg.userData.hemi.intensity = 0.18; // ringshine
  const fgLayer = { scene: fg, near: 0.3, far: 2e5 };

  // ring particles in a box that travels with the local ring orbit
  const N = 3200, BOX = 3000, TH = 70;
  // water ice with regolith dust: procedural frost/grain in the shader keeps boulders from looking smooth plastic
  const chunkMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.7 });
  chunkMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vObjP;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fr = fbm3(vObjP * 4.0) * 0.5 + 0.5; float dust = smoothstep(0.55, 0.8, fbm3(vObjP * 1.6 + 7.0) * 0.5 + 0.5);
        diffuseColor.rgb *= mix(0.7, 1.08, fr); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.47), dust * 0.55);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 gp = vObjP * 9.0; float e = 0.02;
        float h0 = snoise(gp); vec3 gdir = vec3(snoise(gp + vec3(e,0,0)) - h0, snoise(gp + vec3(0,e,0)) - h0, snoise(gp + vec3(0,0,e)) - h0) / e;
        normal = normalize(normal - 0.06 * (mat3(viewMatrix) * gdir));`);
  };
  const chunks = new THREE.InstancedMesh(iceChunk(3), chunkMat, N);
  chunks.castShadow = chunks.receiveShadow = true;
  const seeds = [];
  for (let i = 0; i < N; i++) {
    const size = Math.pow(Math.random(), 4.5) * 28 + 0.25;
    seeds.push({ x: (Math.random() - 0.5) * BOX, y: (Math.random() - 0.5) * TH * 2 * (size > 8 ? 0.4 : 1), z: (Math.random() - 0.5) * BOX, s: size, ax: V().randomDirection(), w: Math.random() * 0.3, c: 0.75 + Math.random() * 0.3 });
    chunks.setColorAt(i, new THREE.Color(seeds[i].c, seeds[i].c * 0.97, seeds[i].c * 0.92));
  }
  fg.add(chunks);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = V(), pp = V();
  const ringFrame = new Body(V(r0, 0, 0), V(0, 0, -vc)); // a ring particle's own Keplerian orbit

  const objs = [];
  const add = (id, name, mesh, ahead, dy, radius, opts = {}) => {
    const th = ahead / r0;
    const b = new Body(V(r0 * Math.cos(th), dy, -r0 * Math.sin(th)), V(-Math.sin(th), 0, -Math.cos(th)).multiplyScalar(vc));
    fg.add(mesh); objs.push({ id, name, mesh, body: b, radius, ...opts }); return objs[objs.length - 1];
  };
  const cas = model('cassini') || new THREE.Object3D(); cas.rotation.set(0.3, 0.8, 0.1);
  add('cassini', 'CASSINI', cas, 2600, 180, 8, { scan: 250 });
  const worm = createWormhole({ radius: 1000 });
  add('wormhole', 'WORMHOLE', worm, 34000, 2600, 1000, { portal: 'gargantua', scan: 20000 });
  const ranger = def.build(); fg.add(ranger);
  let simT = 0;
  const loc = {
    id: 'saturn', name: 'Saturn', kicker: 'FREE FLIGHT · SATURN · A RING', units: 'm',
    layers: [sky, bg, fgLayer], fg, sunDir, ranger, objs, mu: MU, R: RS, atmo: { top: 1200e3, kill: 300e3 }, bodyName: 'Saturn',
    ship: { pos: V(r0, 90, 0), vel: V(0, 0, -vc), quat: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI) },
    shipParams: { accel: 12, boost: 5, rcs: 2.5, retro: 6 },
    gravity: pointGravity(MU),
    music: 300,
    update(ship, dt, t) {
      simT += dt;
      for (const o of objs) { o.body.step(dt, this.gravity); o.mesh.position.copy(o.body.pos).sub(ship.pos); }
      worm.userData.uniforms.uTime.value = t;
      saturn.rotation.y = simT * (2 * Math.PI / (PLANETS.saturn.rotH * 3600));
      sky.sky.userData.update(t);
      bg.origin.copy(ship.pos).multiplyScalar(0.001);
      // ring frame: co-orbiting point at the ship's radius, in the ring plane
      const rr = Math.hypot(ship.pos.x, ship.pos.z);
      const inRing = rr > R.cInner * 1000 && rr < R.aOuter * 1000 && !(rr > 117580e3 && rr < 122170e3);
      chunks.visible = inRing && Math.abs(ship.pos.y) < 4000;
      if (!chunks.visible) ringFrame.step(dt, this.gravity);
      if (chunks.visible) {
        const phi = Math.atan2(-ship.pos.z, ship.pos.x);
        const omega = Math.sqrt(MU / rr ** 3);
        const radial = V(Math.cos(phi), 0, -Math.sin(phi)), track = V(-Math.sin(phi), 0, -Math.cos(phi));
        // local ring coordinates of the ship (along-track drift from the Keplerian shear is folded into the wrap)
        ringFrame.step(dt, this.gravity);
        const dd = ship.pos.clone().sub(ringFrame.pos);
        const sx = dd.dot(radial), sz = dd.dot(track); const sy = ship.pos.y;
        for (let i = 0; i < N; i++) {
          const s = seeds[i];
          const wrap = (u) => ((u % BOX) + BOX * 1.5) % BOX - BOX / 2;
          const lx = wrap(s.x - sx), lz = wrap(s.z - sz);
          pp.copy(radial).multiplyScalar(lx).addScaledVector(track, lz); pp.y = s.y - sy;
          qq.setFromAxisAngle(s.ax, simT * s.w);
          m4.compose(pp, qq, sc.setScalar(s.s)); chunks.setMatrixAt(i, m4);
        }
        chunks.instanceMatrix.needsUpdate = true;
        chunks.userData.omega = omega;
      }
      aimSun(fg, sunDir, V());
    },
    afterCamera(cam) { bg.sync(cam); sky.camera = bg.camera; },
    collide(ship) {
      if (ship.pos.length() < RS + 300e3) return 'Lost in Saturn’s atmosphere.';
      this.threat = null;
      if (chunks.visible) {
        let best = 1e9;
        for (let i = 0; i < N; i++) {
          const s = seeds[i]; if (s.s < 3) continue; chunks.getMatrixAt(i, m4); pp.setFromMatrixPosition(m4);
          const gap = pp.length() - (s.s * 1.1 + 4);
          if (gap < 0) return `Collided with a ${fmt.n(s.s, 0)} m ring boulder.`;
          if (gap < best) { best = gap; (this.threat ||= { rel: V(), gap: 0 }).rel.copy(pp); this.threat.gap = gap; } // nearest boulder, for the copilot
        }
      }
      return null;
    },
    telemetry(ship) {
      const rr = Math.hypot(ship.pos.x, ship.pos.z);
      const el = orbitalElements(ship.pos, ship.vel, MU);
      const ring = rr < R.cInner * 1000 ? 'inside C ring' : rr < R.bOuter * 1000 ? (rr < 92000e3 ? 'C ring' : 'B ring') : rr < 122170e3 ? 'CASSINI DIVISION' : rr < R.aOuter * 1000 ? 'A ring' : 'outside the rings';
      return [
        ['DISTANCE FROM SATURN', `${fmt.n(rr / 1000, 0)} km`],
        ['RING REGION', ring, ring === 'A ring' ? 'ok' : ''],
        ['HEIGHT ABOVE RING PLANE', fmt.km(ship.pos.y)],
        ['ORBITAL SPEED', `${fmt.n(ship.vel.length() / 1000, 2)} km/s`],
        ['PERIAPSIS', fmt.km(el.rp - RS), el.rp < RS + 300e3 ? 'warn' : ''],
      ];
    },
  };
  return loc;
}

// ===========================================================================
// GARGANTUA — free flight in units of the Schwarzschild radius
// ===========================================================================
export const C_GAME = 0.6; // r_s per second treated as the speed of light in this scaled sandbox
export function buildGargantua(ctx, def) {
  const G = gargantuaLayer();
  const GM = 0.5;
  const worm = createWormhole({ radius: 0.3 });
  worm.userData.uniforms.uOurs.value = SKY.other; worm.userData.uniforms.uOther.value = SKY.ours;
  worm.position.copy(SYS.wormhole);
  G.scene.add(worm);
  // planet layer (km) for close approaches, with a compressed distance mapping
  const P = new ScaledLayer({ near: 5, far: 3e6, scale: 0.001 });
  const sunDir = V(0, 0, -1);
  const planets = {
    miller: createAlienPlanet({ type: 0, radius: 6800, sunDir, kmPerUnit: 1, seed: 1.3 }),
    mann: createAlienPlanet({ type: 1, radius: 5900, sunDir, kmPerUnit: 1, seed: 2.7 }),
    edmunds: createAlienPlanet({ type: 2, radius: 6100, sunDir, kmPerUnit: 1, seed: 4.1 }),
  };
  for (const p of Object.values(planets)) { p.visible = false; P.scene.add(p); }
  const fg = shipScene({ sunDir, env: ctx.envOther, intensity: 2.6, ambient: 0.12, shadowSize: 30 });
  fg.userData.sun.color.setRGB(1, 0.82, 0.62);
  const fgLayer = { scene: fg, near: 0.3, far: 5e4 };
  const ranger = def.build(); fg.add(ranger);
  const objs = [
    { id: 'gargantua', name: 'GARGANTUA', pos: V(0, 0, 0), radius: 1, scan: 40 },
    { id: 'miller', name: 'MILLER', pos: SYS.miller.clone(), radius: 0.004, planet: 'miller', scan: 0.06 },
    { id: 'mann', name: 'MANN', pos: SYS.mann.clone(), radius: 0.004, planet: 'mann', scan: 0.06 },
    { id: 'edmunds', name: 'EDMUNDS', pos: SYS.edmunds.clone(), radius: 0.004, planet: 'edmunds', scan: 0.06 },
    { id: 'wormhole', name: 'WORMHOLE', pos: SYS.wormhole.clone(), radius: 0.3, portal: 'saturn', scan: 6 },
  ];
  const clock = { proper: 0, earth: 0, minR: 1e9 };
  const REAL_PER_GAME_S = (RS_M / C.c) / C_GAME; // one sandbox second ≈ this many real seconds
  const loc = {
    id: 'gargantua', name: 'Gargantua', kicker: 'FREE FLIGHT · GARGANTUA SYSTEM', units: 'rs',
    layers: [G, fgLayer], fg, sunDir, ranger, objs: [], points: objs, bhLayer: G,
    ship: { pos: SYS.wormhole.clone().add(V(0, -0.2, -1.6)), vel: V(0, 0, -0.02), quat: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI) },
    shipParams: { accel: 0.012, boost: 8, rcs: 0.004, retro: 0.008, rate: 0.9 },
    gravity: (p, out) => { const r = p.length(); const k = -GM / Math.max((r - 1) * (r - 1), 1e-4) / r; return out.copy(p).multiplyScalar(k); },
    music: 372, clock,
    update(ship, dt, t) {
      // relativistic speed limit
      const v = ship.vel.length(); if (v > 0.97 * C_GAME) ship.vel.multiplyScalar((0.97 * C_GAME) / v);
      const r = ship.pos.length();
      clock.minR = Math.min(clock.minR, r);
      const beta = Math.min(0.999, ship.vel.length() / C_GAME);
      const d = Math.sqrt(Math.max(1e-6, 1 - 1 / Math.max(r, 1.0001))) * Math.sqrt(1 - beta * beta);
      clock.proper += dt * REAL_PER_GAME_S * d;
      clock.earth += dt * REAL_PER_GAME_S;
      clock.dil = d;
      G.origin.copy(ship.pos);
      G.bh.uniforms.uTime.value = t;
      worm.userData.uniforms.uTime.value = t;
      // light comes from the hole
      sunDir.copy(ship.pos).negate().normalize();
      fg.userData.sun.position.copy(sunDir).multiplyScalar(200);
      aimSun(fg, sunDir, V());
      // nearest planet within 0.03 r_s shows up in the km layer
      let near = null, nd = 1e9;
      for (const o of objs) if (o.planet) { const dd = o.pos.distanceTo(ship.pos); if (dd < nd) { nd = dd; near = o; } }
      for (const p of Object.values(planets)) p.visible = false;
      if (near && nd < 0.03) {
        const pl = planets[near.planet]; pl.visible = true; pl.userData.update(t);
        const dir = near.pos.clone().sub(ship.pos).normalize();
        const shownKm = Math.max(7400, 400000 * Math.pow(nd / 0.03, 1.4));
        P.origin.copy(dir).multiplyScalar(-shownKm);
        this.layers = [G, P, fgLayer];
      } else this.layers = [G, fgLayer];
    },
    afterCamera(cam) { G.sync(cam); P.sync(cam); },
    collide(ship) { return ship.pos.length() < 1.0 ? 'HORIZON' : null; },
    telemetry(ship) {
      const r = ship.pos.length();
      const vEsc = Math.min(1, Math.sqrt(2 * GM / Math.max(r - 1, 1e-3)) / C_GAME);
      return [
        ['DISTANCE', `${fmt.n(r, r < 10 ? 3 : 1)} r_s  (${fmt.n((r * RS_KM) / 1e6, 0)} million km)`],
        ['SPEED', `${fmt.n(ship.vel.length() / C_GAME, 3)} c`],
        ['ESCAPE SPEED HERE', `${fmt.n(vEsc, 3)} c`, vEsc > 0.8 ? 'warn' : ''],
        ['TIME DILATION dτ/dt', fmt.n(clock.dil ?? 1, 4), (clock.dil ?? 1) < 0.8 ? 'warn' : ''],
        ['SHIP CLOCK', fmt.ymd(clock.proper / C.year)],
        ['EARTH CLOCK', fmt.ymd(clock.earth / C.year), 'warn'],
        ['CLOSEST APPROACH', `${fmt.n(clock.minR, 2)} r_s`],
      ];
    },
  };
  return loc;
}

export const LOCATIONS = { launch: buildLaunch, tesseract: buildTesseract, earth: buildEarth, moon: buildMoon, mars: buildMars, jupiter: buildJupiter, saturn: buildSaturn, gargantua: buildGargantua };
