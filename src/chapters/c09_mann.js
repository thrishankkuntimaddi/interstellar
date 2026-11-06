import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { model } from '../world/models.js';
import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, clamp, easeInOut, easeOut, easeIn, shake } from '../core/util.js';
import { ScaledLayer, shipScene, aimSun } from './base.js';
import { gargantuaLayer, SYS, drawSystem, bhTelemetry } from './gsys.js';
import { createAlienPlanet } from '../world/planets.js';
import { createRanger, panelTextures } from '../world/ships.js';
import { enduranceWithRanger, spinAngle } from './c04_cruise.js';
import { cloudLayer } from './c02_launch.js';
import { NOISE } from '../gl/noise.js';
import { fmt } from '../data/astro.js';

// cheap deterministic 2-D value noise for CPU-side terrain
function vnoise(x, y) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(h(i, j), h(i + 1, j), u), lerp(h(i, j + 1), h(i + 1, j + 1), u), v);
}
function ridgedCPU(x, y) { let a = 0.5, s = 0, f = 1; for (let k = 0; k < 5; k++) { s += a * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)); f *= 2.1; a *= 0.5; } return s; }
export function iceHeight(x, z) {
  const flat = smooth(clamp((Math.hypot(x, z) - 250) / 1400));
  return (ridgedCPU(x * 0.0006, z * 0.0006) * 420 - 120) * flat + vnoise(x * 0.02, z * 0.02) * 2;
}

function glacier(sun) {
  const g = new THREE.PlaneGeometry(40000, 40000, 320, 320);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, iceHeight(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun } },
    vertexShader: /* glsl */`varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; varying vec3 vW; varying vec3 vN;
      ${NOISE}
      void main(){
        vec3 N = normalize(vN + 0.08 * vec3(snoise(vW * 0.05), 0.0, snoise(vW.zyx * 0.05)));
        float slope = 1.0 - N.y;
        vec3 snow = vec3(0.86, 0.9, 0.95);
        vec3 ice = vec3(0.42, 0.58, 0.72);
        float crev = smoothstep(0.25, 0.6, slope) + smoothstep(0.7, 0.9, snoise(vec3(vW.xz * 0.004, 1.0)) * 0.5 + 0.5) * 0.4;
        vec3 c = mix(snow, ice, clamp(crev, 0.0, 1.0));
        c *= 0.92 + 0.08 * snoise(vec3(vW.xz * 0.3, 2.0)); // sastrugi
        float l = 0.55 + 0.6 * max(dot(N, uSun), 0.0);
        vec3 col = c * l;
        float dist = length(vW - cameraPosition);
        col = mix(col, vec3(0.66, 0.72, 0.78), 1.0 - exp(-dist / 12000.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  return m;
}

function frozenCloud(seed, size) {
  let g = new THREE.IcosahedronGeometry(1, 5);
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); // smooth, sculpted ice instead of facets
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.35 * Math.sin(v.x * 3 + seed) * Math.cos(v.z * 2.7 + seed * 2) + 0.2 * Math.sin(v.y * 7 + v.x * 5 + seed) + 0.1 * Math.sin(v.z * 15 + seed * 3);
    v.multiplyScalar(n);
    if (v.y < -0.15) v.y = -0.15 - (v.y + 0.15) * 0.15; // flat, sheared underside
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xdfe8f2, roughness: 0.85, metalness: 0.0, emissive: 0x1a2a3a, emissiveIntensity: 0.6 }));
  m.scale.set(size, size * 0.45, size * 0.8);
  m.castShadow = true;
  return m;
}

function coldSky() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(45000, 32, 16), new THREE.ShaderMaterial({
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`varying vec3 vD; void main(){ float e = clamp(normalize(vD).y, -0.1, 1.0); vec3 c = mix(vec3(0.68, 0.74, 0.8), vec3(0.36, 0.46, 0.58), smoothstep(0.0, 0.7, e)); gl_FragColor = vec4(c * 1.1, 1.0); }`,
    side: THREE.BackSide, depthWrite: false,
  }));
  m.onBeforeRender = (r, s, c) => { m.position.copy(c.position); m.updateMatrixWorld(); };
  m.renderOrder = -100; m.frustumCulled = false;
  return m;
}

function snowfall(count = 6000) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) pos[i] = Math.random() * 60;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3(9, -2.5, 3) } };
  const m = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */`uniform float uTime; uniform vec3 uCam, uWind; void main(){
      vec3 p = mod(position + uWind * uTime - uCam, 60.0) - 30.0 + uCam;
      vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(40.0 / -mv.z, 1.0, 6.0); }`,
    fragmentShader: /* glsl */`void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.25, 0.0, dot(c,c)); gl_FragColor = vec4(vec3(0.95), a * 0.7); }`,
    transparent: true, depthWrite: false,
  }));
  m.frustumCulled = false; m.userData.u = u;
  return m;
}

/** Mann's habitat: a few modules, antenna and lights on the ice. */
function habitat() {
  const g = new THREE.Group();
  const tex = panelTextures({ seed: 77, windows: true, base: 200 });
  const mat = new THREE.MeshStandardMaterial({ ...tex, roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 3 });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 4), mat);
    b.position.set(i * 9 - 13, 1.6, (i % 2) * 5); b.castShadow = true; g.add(b);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 14), new THREE.MeshStandardMaterial({ color: 0x666666 }));
  mast.position.set(6, 7, -4); g.add(mast);
  const lamp = new THREE.PointLight(0xffd8a0, 400, 120, 1.5); lamp.position.set(0, 4, 3); g.add(lamp);
  return g;
}

export default {
  id: 'mann', kicker: 'PHASE 2 · MANN', title: 'The Frozen World', start: 582, end: 742,
  build(ctx) {
    // A: Gargantua flyby
    const G = gargantuaLayer();
    const passRs = (lt) => {
      const u = easeInOut(seg(lt, 0, 34));
      const a = lerp(0.42, 2.0, u);
      const r = lerp(16, 26, u);
      return V(Math.cos(a) * r, lerp(1.8, 3.2, u), Math.sin(a) * r);
    };
    const fgA = shipScene({ sunDir: V(0, 0, -1), env: ctx.envOther, intensity: 2.6, ambient: 0.12, shadowSize: 50 });
    fgA.userData.sun.color.setRGB(1, 0.82, 0.62);
    const end = enduranceWithRanger(); fgA.add(end);
    const layerA = { scene: fgA, near: 0.5, far: 60000 };
    // B: Mann's planet from orbit
    const sunB = V(-0.5, 0.25, 0.83).normalize();
    const P = new ScaledLayer({ near: 5, far: 2e6, scale: 0.001 });
    const mannPlanet = createAlienPlanet({ type: 1, radius: 5900, sunDir: sunB, kmPerUnit: 1, seed: 2.7 });
    P.scene.add(mannPlanet);
    const G2 = gargantuaLayer(); G2.origin.copy(SYS.mann);
    // C/D: ice world (metres)
    const sunIce = V(-0.4, 0.55, 0.3).normalize();
    const ice = new THREE.Scene();
    ice.environment = ctx.envOther; ice.environmentIntensity = 0.6;
    ice.add(coldSky());
    ice.add(glacier(sunIce));
    const deck = cloudLayer(4200, sunIce, 0.7, 0.00018); deck.material.uniforms.uCov.value = 0.75; ice.add(deck);
    const clouds = [];
    const cloudSpots = [[0, 1600, -300, 900], [-1200, 1900, 800, 1300], [1500, 1400, 1200, 1100], [-2500, 2200, -1800, 1600], [2600, 2000, -2200, 1500], [400, 2500, 2600, 1800], [-600, 1250, 200, 600], [700, 1300, -900, 500]];
    cloudSpots.forEach(([x, y, z, s], i) => { const c = frozenCloud(i * 1.7 + 1, s); c.position.set(x, y, z); c.rotation.y = i; ice.add(c); clouds.push(c); });
    const sI = new THREE.DirectionalLight(0xdfeaff, 1.4); sI.position.copy(sunIce).multiplyScalar(500);
    sI.castShadow = true; sI.shadow.mapSize.set(2048, 2048); Object.assign(sI.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 2000 });
    ice.add(sI, sI.target, new THREE.HemisphereLight(0xc8d8ee, 0x8090a0, 1.6));
    const hab = habitat(); hab.position.set(140, iceHeight(140, -90), -90); ice.add(hab);
    const mannFigure = model('astronaut'); if (mannFigure) { mannFigure.position.set(118, iceHeight(118, -70), -70); mannFigure.rotation.y = -2.3; ice.add(mannFigure); }
    const ranger = createRanger(); ice.add(ranger);
    const mannRanger = createRanger(); mannRanger.position.set(40, iceHeight(40, 60) + 0.8, 60); mannRanger.rotation.y = 2.2; ice.add(mannRanger);
    const snow = snowfall(); ice.add(snow);
    const iceLayer = { scene: ice, near: 0.5, far: 60000 };

    let phase = 0;
    let srs = passRs(0);
    const LAND = V(0, iceHeight(0, 0) + 0.8, 0);
    const descent = (lt, out) => {
      const u = seg(lt, 60, 102);
      const k = easeOut(u);
      out.set(lerp(-5200, LAND.x, k), lerp(5600, LAND.y, Math.pow(u, 0.75)), lerp(3800, LAND.z, k));
      if (lt >= 102) out.copy(LAND);
      return out;
    };
    const prev = new THREE.Vector3();

    const ch = {
      layers: [G, layerA], allLayers: [G, layerA, G2, P, iceLayer],
      subject: end, sunDir: V(0, 0, -1), chase: { offset: V(0, 14, 90), look: V(0, 0, -200) }, cockpit: V(0, 4, -16), freeDist: 140,
      bhLayer: G,
      update(lt, dt) {
        G.bh.uniforms.uTime.value = G2.bh.uniforms.uTime.value = lt + 300;
        phase = lt < 34 ? 0 : lt < 60 ? 1 : 2;
        if (phase === 0) {
          srs = passRs(lt);
          G.origin.copy(srs);
          const toBH = srs.clone().negate().normalize();
          this.sunDir = toBH;
          fgA.userData.sun.position.copy(toBH).multiplyScalar(200);
          aimSun(fgA, toBH, V());
          end.userData.spin.rotation.z = spinAngle(lt + 500);
          const tangent = V(-Math.sin(lerp(0.42, 2.0, seg(lt, 0, 34))), 0, Math.cos(lerp(0.42, 2.0, seg(lt, 0, 34))));
          end.quaternion.setFromUnitVectors(V(0, 0, -1), tangent);
          end.userData.ranger.userData.blink(lt);
          this.layers = [G, layerA]; this.subject = end;
        } else if (phase === 1) {
          srs = SYS.mann.clone().add(V(0.02, 0, 0));
          const u = easeInOut(seg(lt, 34, 60));
          P.origin.set(lerp(-26000, -11000, u), lerp(4000, 2500, u), lerp(30000, 12000, u));
          mannPlanet.userData.update(lt);
          mannPlanet.rotation.y = lt * 0.01;
          fgA.userData.sun.position.copy(sunB).multiplyScalar(200); aimSun(fgA, sunB, V());
          this.sunDir = sunB;
          end.userData.spin.rotation.z = spinAngle(lt + 500);
          end.quaternion.setFromUnitVectors(V(0, 0, -1), P.origin.clone().negate().normalize());
          this.layers = [G2, P, layerA]; this.subject = end;
        } else {
          srs = SYS.mann.clone();
          this.layers = [iceLayer];
          this.sunDir = sunIce;
          descent(lt, ranger.position);
          descent(lt + 0.2, prev);
          const vel = prev.clone().sub(ranger.position);
          if (lt < 100 && vel.lengthSq() > 1e-6) {
            const fwd = V(vel.x, 0, vel.z).normalize();
            ranger.quaternion.setFromUnitVectors(V(0, 0, 1), fwd);
            ranger.rotateX(-Math.atan2(vel.y, Math.hypot(vel.x, vel.z)) * 0.5 + Math.sin(lt * 2.0) * 0.03);
          }
          ranger.userData.setThrust(lt > 92 && lt < 102 ? 0.7 : 0.15, lt);
          ranger.userData.blink(lt);
          // Mann takes the other Ranger and leaves for the Endurance
          const lift = Math.max(0, lt - 140);
          mannRanger.position.set(40 + lift * lift * 0.8, iceHeight(40, 60) + 0.8 + Math.pow(lift, 2.4) * 1.4, 60 - lift * lift * 0.5);
          mannRanger.rotation.set(-Math.min(lift * 0.12, 0.9), 2.2, 0);
          mannRanger.userData.setThrust(lift > 0 ? 1 : 0, lt);
          mannRanger.userData.blink(lt);
          deck.material.uniforms.uTime.value = lt;
          snow.userData.u.uTime.value = lt;
          snow.userData.u.uCam.value.copy(ctx.engine.camera.position);
          const tgt = lt < 102 ? ranger.position : V(40, 0, 20);
          sI.target.position.copy(tgt); sI.position.copy(tgt).addScaledVector(sunIce, 800); sI.target.updateMatrixWorld();
          this.subject = lt > 140 ? mannRanger : ranger;
          this.cockpit = ranger.userData.cockpit; this.chase = { offset: V(0, 6, -32), look: V(0, 0, 20) }; this.freeDist = 60;
        }
      },
      afterCamera(cam) {
        if (phase === 0) G.sync(cam);
        else if (phase === 1) { G2.sync(cam); P.sync(cam); }
      },
      shot(lt, cam) {
        cam.fov = 40;
        if (phase === 0) {
          // silhouetted against the disk
          const toBH = srs.clone().negate().normalize();
          if (lt < 12) { cam.fov = 35; lookAt(cam, toBH.clone().multiplyScalar(-140).add(V(30, 20, 0)), toBH.clone().multiplyScalar(500)); }
          else if (lt < 24) { cam.fov = 28; const u = seg(lt, 12, 24); lookAt(cam, V(lerp(-120, -60, u), lerp(-10, 30, u), 150), toBH.clone().multiplyScalar(800)); }
          else { cam.fov = 55; lookAt(cam, V(40, 50, 30), toBH.clone().multiplyScalar(100)); }
        } else if (phase === 1) {
          const u = seg(lt, 34, 60);
          const toP = P.origin.clone().negate().normalize();
          if (lt < 46) { cam.fov = 35; lookAt(cam, toP.clone().multiplyScalar(-150).add(V(40, 30, 0)), toP.clone().multiplyScalar(1000)); }
          else { cam.fov = 45; lookAt(cam, V(-60, -15, 70 - u * 20), toP.clone().multiplyScalar(500)); }
        } else {
          const R = ranger.position;
          if (lt < 72) { cam.fov = 45; lookAt(cam, R.clone().add(V(-40, 10, -60)), R.clone()); }
          else if (lt < 84) { cam.fov = 60; lookAt(cam, R.clone().add(V(14, -6, 20)), R.clone().add(V(400, 300, -300))); shake(cam, lt, 0.08); }
          else if (lt < 96) { cam.fov = 35; lookAt(cam, V(300, 60, 400), R.clone()); }
          else if (lt < 112) { cam.fov = 40; lookAt(cam, V(26, 4, 30), R.clone().add(V(0, 2, 0))); }
          else if (lt < 126) { cam.fov = 30; const u = seg(lt, 112, 126); lookAt(cam, V(lerp(-60, -20, u), 3, 50), V(150, 20, -90)); }
          else if (lt < 140) { cam.fov = 55; lookAt(cam, V(10, 2.5, 18), V(0, 500, -400)); }
          else { cam.fov = 45; lookAt(cam, V(-10, 4, 30), mannRanger.position.clone()); }
        }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        return {
          cold: phase === 2 ? 0.9 : phase === 1 ? 0.4 : 0,
          white: bump(lt, 58.5, 59.6, 60.2, 61.5) * 0.8 + bump(lt, 77, 79, 80, 82) * 0.75,
          letterbox: 1, bloom: phase === 2 ? 0.35 : 0.85, exposure: phase === 2 ? 0.8 : 1.0,
        };
      },
      telemetry(lt) {
        if (phase === 0) return [...bhTelemetry(srs.length()), ['MANOEUVRE', 'ORBIT CHANGE · MANN']];
        const rows = [
          ['BODY', 'MANN’S PLANET'], ['SURFACE GRAVITY', '~0.8 g'], ['SURFACE TEMP', '−76 °C'],
          ['ATMOSPHERE', 'N₂ + NH₃ ice clouds'], ['DILATION', 'negligible (far orbit)', 'ok'],
          ['EARTH TIME SINCE LAUNCH', '≈ 25 years', 'warn'],
        ];
        if (phase === 2 && lt < 102) rows.push(['RANGER ALT.', fmt.km(Math.max(0, ranger.position.y - LAND.y))]);
        if (lt > 140) rows.push(['ALERT', 'RANGER 1 LAUNCHED · UNAUTHORISED', 'warn']);
        return rows;
      },
      minimap: (g) => drawSystem(g, srs, { highlight: 'mann', label: 'ENDURANCE' }),
      cards: [[36, 42, 'MANN', 'the frozen world'], [104, 110, '', 'clouds that never melt']],
      logs: [
        [3, 'CREW', 'Look at it. Light bent all the way around the back of the hole.', 5],
        [14, 'TARS', 'We are skimming the outer orbits. Thirty minutes here cost us a month at home.', 6],
        [26, 'CASE', 'Setting course for Mann. His signal is still strong.', 4.5],
        [44, 'CREW', 'Glaciers all the way down. And the clouds… they are frozen.', 5],
        [62, 'TARS', 'Descending under the cloud ceiling. Watch your wingtips.', 4.5],
        [78, 'CASE', 'Ice formations above us. Do not touch them.', 4],
        [102, 'CREW', 'Down. Mann’s beacon is two hundred metres east.', 4.5],
        [116, 'MANN', 'You came. You actually came. I had almost forgotten other voices.', 6],
        [128, 'MANN', 'My data is… promising. Come, I will show you everything.', 5],
        [141, 'CASE', 'Ranger one is lifting off! Mann is not answering.', 5],
        [150, 'CREW', 'He’s going for the Endurance. Get us up there.', 5],
      ],
    };
    return ch;
  },
};
