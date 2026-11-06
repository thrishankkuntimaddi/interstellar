import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, clamp, easeInOut, easeOut, easeIn, shake } from '../core/util.js';
import { shipScene, aimSun } from './base.js';
import { gargantuaLayer, drawSystem, bhTelemetry, RS_M } from './gsys.js';
import { createRanger } from '../world/ships.js';
import { createWormholeTunnel } from '../world/wormhole.js';
import { SKY } from '../world/sky.js';
import { enduranceWithRanger } from './c04_cruise.js';
import { GARGANTUA, fmt, C } from '../data/astro.js';

const T_PERI = 14, T_HORIZON = 35, T_TESS = 41, T_END = 52;
const ECC = 1.4, PERI = 2.6, SEMI_LATUS = PERI * (1 + ECC);
const ROT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.9, 0));

/** Endurance's hyperbolic slingshot around Gargantua (r in r_s). */
function enduranceRs(lt) {
  const th = lerp(-2.0, 2.05, seg(lt, 0, 28)) + Math.max(0, lt - 28) * 0.02;
  const r = SEMI_LATUS / (1 + ECC * Math.cos(Math.min(th, 2.3)));
  return V(r * Math.cos(th), 0.45 + 0.02 * r, r * Math.sin(th)).applyQuaternion(ROT);
}
/** The Ranger lets go at periapsis and falls toward the horizon. */
function rangerRs(lt) {
  if (lt < T_PERI) return enduranceRs(lt);
  const p0 = enduranceRs(T_PERI);
  const u = easeIn(seg(lt, T_PERI, T_HORIZON));
  const r = lerp(PERI, 0.985, u);
  const dir = p0.clone().normalize().applyAxisAngle(V(0, 1, 0), -u * 0.9);
  dir.y = lerp(dir.y, 0.02, u);
  return dir.normalize().multiplyScalar(r);
}

function tesseract() {
  const N = 14, S = 9, lines = [];
  for (let a = 0; a < 3; a++) for (let i = -N; i <= N; i += 2) for (let j = -N; j <= N; j += 2) lines.push([a, i * S / 2, j * S / 2]);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: /* glsl */`varying float vD; varying vec3 vW; void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uTime, uFade; varying float vD; varying vec3 vW;
      void main(){ float pulse = 0.6 + 0.4 * sin(vW.x * 0.3 + vW.y * 0.2 + vW.z * 0.25 - uTime * 2.0);
        vec3 c = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.92, 0.75), pulse) * 2.2 * pulse;
        c *= exp(-vD * 0.012) * uFade; gl_FragColor = vec4(c, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const inst = new THREE.InstancedMesh(geo, mat, lines.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), L = N * S * 1.2;
  lines.forEach(([a, u, v], k) => {
    const pos = a === 0 ? V(0, u, v) : a === 1 ? V(u, 0, v) : V(u, v, 0);
    const scl = a === 0 ? V(L * 2, 0.05, 0.05) : a === 1 ? V(0.05, L * 2, 0.05) : V(0.05, 0.05, L * 2);
    m.compose(pos, q, scl); inst.setMatrixAt(k, m);
  });
  inst.frustumCulled = false;
  return inst;
}


/** Ship-less beauty orbit around the hole: camera in r_s, always looking at the centre. */
function orbitCam(G, u, { r0 = 60, r1 = 26, a0 = 0.3, a1 = 2.6, e0 = 0.28, e1 = 0.06 } = {}) {
  const k = u * u * (3 - 2 * u);
  const r = r0 + (r1 - r0) * k, a = a0 + (a1 - a0) * k, e = e0 + (e1 - e0) * k;
  const c = G.camera;
  c.position.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  c.up.set(0, 1, 0); c.lookAt(0, 0, 0); c.fov = 42; c.updateMatrixWorld();
}

export default {
  id: 'gargantua', kicker: 'PHASE 3 · GARGANTUA', title: 'Event Horizon', start: 832, end: 896,
  build(ctx) {
    const G = gargantuaLayer({ tilt: 0.0 });
    const sunDir = new THREE.Vector3(0, -1, 0);
    const fg = shipScene({ sunDir, env: ctx.envOther, intensity: 3.0, ambient: 0.12, shadowSize: 50 });
    fg.userData.sun.color.setRGB(1, 0.82, 0.6);
    const end = enduranceWithRanger(); fg.add(end);
    const docked = end.userData.ranger;
    const ranger = createRanger(); fg.add(ranger); ranger.visible = false;
    const fgLayer = { scene: fg, near: 0.3, far: 1e6 };

    // inside the horizon: the outside universe squeezed into a shrinking window overhead
    const inside = new THREE.Scene();
    const tun = createWormholeTunnel();
    tun.userData.uniforms.uOurs.value = SKY.other; tun.userData.uniforms.uOther.value = SKY.other;
    inside.add(tun);
    const insideLayer = { scene: inside, near: 0.1, far: 10 };
    const fgIn = shipScene({ sunDir: V(0, 1, 0), env: ctx.envOther, intensity: 2.0, ambient: 0.3, shadow: false });
    const rIn = createRanger(); fgIn.add(rIn);
    const fgInLayer = { scene: fgIn, near: 0.1, far: 5000 };

    const tess = new THREE.Scene();
    const lattice = tesseract(); tess.add(lattice);
    const tessLayer = { scene: tess, near: 0.1, far: 2000 };

    let phase = 0; let ers = enduranceRs(0), rrs = rangerRs(0);
    const tmp = new THREE.Vector3();

    const ch = {
      layers: [G, fgLayer], allLayers: [G, fgLayer, insideLayer, fgInLayer, tessLayer],
      subject: end, sunDir, chase: { offset: V(0, 14, 90), look: V(0, 0, -200) }, cockpit: V(0, 4, -16), freeDist: 140,
      bhLayer: G,
      update(lt, dt) {
        G.bh.uniforms.uTime.value = lt + 600;
        phase = lt < T_HORIZON ? 0 : lt < T_TESS ? 1 : 2;
        ers = enduranceRs(lt); rrs = rangerRs(lt);
        if (phase === 0) {
          this.layers = lt < 5 ? [G] : [G, fgLayer];
          const anchor = lt < T_PERI ? ers : rrs;
          G.origin.copy(anchor);
          const toBH = anchor.clone().negate().normalize();
          sunDir.copy(toBH).add(V(0, -0.8, 0)).normalize(); // lit from the disk below and the hole's glow
          fg.userData.sun.position.copy(sunDir).multiplyScalar(-200);
          // Endurance flies along its trajectory, hub forward
          const vel = enduranceRs(lt + 0.05).sub(enduranceRs(lt)).normalize();
          end.quaternion.setFromUnitVectors(V(0, 0, -1), vel);
          end.userData.spin.rotation.z = lt * 0.2;
          const sep = Math.max(0, lt - T_PERI);
          if (lt < T_PERI) {
            end.position.set(0, 0, 0);
            docked.visible = true; ranger.visible = false;
            docked.userData.setThrust(lt > 3 ? 0.55 : 0.2, lt);
            this.subject = end;
          } else {
            // fg origin follows the falling Ranger; Endurance pulls away
            docked.visible = false; ranger.visible = true;
            end.position.copy(vel).multiplyScalar(sep * sep * 9 + sep * 14).add(V(0, sep * 2, 0));
            end.updateMatrixWorld(true);
            ranger.position.set(0, 0, 0);
            const toBHn = toBH.clone();
            ranger.quaternion.setFromUnitVectors(V(0, 0, 1), toBHn);
            ranger.rotateZ(sep * 0.3);
            ranger.userData.setThrust(sep < 1.5 ? 0.6 : 0, lt);
            ranger.userData.blink(lt);
            this.subject = ranger; this.cockpit = ranger.userData.cockpit; this.chase = { offset: V(0, 5, -26), look: V(0, 0, 30) };
          }
          aimSun(fg, sunDir, V());
        } else if (phase === 1) {
          this.layers = [insideLayer, fgInLayer];
          const u = seg(lt, T_HORIZON, T_TESS);
          tun.userData.uniforms.uTime.value = lt * 0.6; tun.userData.uniforms.uProgress.value = 0;
          tun.userData.uniforms.uAxis.value.set(0, 0, 1);
          // spaghettification: stretched along the radial direction, squeezed transversely
          const s = 1 + 40 * Math.pow(u, 2.2);
          rIn.scale.set(1 / Math.sqrt(s), 1 / Math.sqrt(s), s);
          rIn.position.set(0, 0, -s * 3);
          rIn.rotation.set(0, 0, lt * 0.4);
          rIn.userData.setThrust(0, lt);
          this.subject = rIn;
        } else {
          this.layers = [tessLayer];
          lattice.material.uniforms.uTime.value = lt;
          lattice.material.uniforms.uFade.value = 1 - seg(lt, T_END - 2, T_END + 2);
          this.subject = null;
        }
      },
      afterCamera(cam) { if (phase === 0) { G.sync(cam); if (this.layers.length === 1) orbitCam(G, seg(ctx.audio.time - 832, 0, 5), { r0: 22, r1: 12, a0: 2.2, a1: 3.4, e0: 0.12, e1: 0.03 }); } },
      shot(lt, cam) {
        cam.fov = 45;
        if (phase === 0) {
          const toBH = G.origin.clone().negate().normalize();
          if (lt < 5) { cam.fov = 32; lookAt(cam, toBH.clone().multiplyScalar(-150).add(V(-40, 30, 0)), toBH.clone().multiplyScalar(500)); }
          else if (lt < 10) { cam.fov = 55; lookAt(cam, V(30, 10, 80), V(0, 0, 0)); shake(cam, lt, 0.25, 20); }
          else if (lt < T_PERI) { cam.fov = 70; lookAt(cam, V(-45, -25, 30), toBH.clone().multiplyScalar(200)); shake(cam, lt, 0.4, 20); }
          else if (lt < 20) {
            // separation: the Endurance leaves us behind
            cam.fov = 50;
            lookAt(cam, V(-8, 6, -16).applyQuaternion(ranger.quaternion), end.position.clone().multiplyScalar(0.6).add(V(0, 0, 0)));
          } else if (lt < 28) {
            cam.fov = 60;
            lookAt(cam, V(14, 4, -22).applyQuaternion(ranger.quaternion), toBH.clone().multiplyScalar(300));
            shake(cam, lt, 0.1, 18);
          } else {
            // looking back up: the outside universe shrinks to a bright ring above us
            cam.fov = 75;
            lookAt(cam, V(0, 3, -12).applyQuaternion(ranger.quaternion), toBH.clone().multiplyScalar(-1000));
            shake(cam, lt, 0.15 * seg(lt, 28, 35), 25);
          }
        } else if (phase === 1) {
          cam.fov = 70;
          lookAt(cam, V(6, 4, 20), V(0, 0, -80));
          shake(cam, lt, 0.3, 30);
        } else {
          const u = seg(lt, T_TESS, T_END + 12);
          cam.fov = 60;
          const z = 140 - u * 260;
          lookAt(cam, V(Math.sin(u * 3) * 4.5, 2.25 + Math.cos(u * 2) * 2, z), V(Math.sin(u * 3 + 0.5) * 8, 2, z - 50), V(Math.sin(u) * 0.3, 1, 0).normalize());
        }
        cam.updateProjectionMatrix();
      },
      fx(lt) {
        return {
          white: bump(lt, T_HORIZON - 1.2, T_HORIZON - 0.2, T_HORIZON + 0.2, T_HORIZON + 1.5) * 0.9 + bump(lt, T_TESS - 0.6, T_TESS - 0.1, T_TESS + 0.2, T_TESS + 1.5),
          distort: phase === 1 ? 0.8 * seg(lt, T_HORIZON, T_TESS) : sseg(lt, 26, T_HORIZON) * 0.4,
          aberration: 0.0015 + (phase === 1 ? 0.012 : sseg(lt, 24, T_HORIZON) * 0.006),
          fade: sseg(lt, T_END + 1, T_END + 4) * 0.92,
          letterbox: 1, bloom: phase === 2 ? 1.0 : 0.85, exposure: 1.0, grain: 0.07,
        };
      },
      telemetry(lt) {
        if (lt > T_END) return [];
        if (phase === 2) return [['LOCATION', 'THE BULK · 5 DIMENSIONS'], ['TIME', 'a physical dimension'], ['SIGNAL', 'gravity crosses every slice', 'ok']];
        const r = (lt < T_PERI ? ers : rrs).length();
        const tidalH = GARGANTUA.tidal(GARGANTUA.rs, 2);
        const rows = bhTelemetry(Math.max(r, 1.0001));
        const vEsc = Math.sqrt(1 / Math.max(r, 1));
        rows.push(['ESCAPE VELOCITY', `${fmt.n(vEsc, 3)} c`, vEsc > 0.5 ? 'warn' : '']);
        const earthYrs = 23.4 + 2 + 51 * sseg(lt, 6, T_PERI + 4);
        rows.push(['EARTH TIME SINCE LAUNCH', `≈ ${fmt.n(earthYrs, 0)} years`, 'warn']);
        if (lt > T_PERI) rows.push(['TIDAL STRETCH (2 m, at horizon)', `${tidalH.toExponential(1)} m/s²`, 'ok'], ['NOTE', 'supermassive: no spaghettification at the horizon']);
        if (phase === 1) rows.push(['TIDAL STRETCH', '→ ∞ toward the singularity', 'warn']);
        return rows;
      },
      telemetrySource: () => 'Δa_tidal = 2GML / r³ · slingshot: Newton’s third law (Ranger released at periapsis)',
      minimap: (g, lt) => (lt < T_HORIZON ? drawSystem(g, lt < T_PERI ? ers : rrs, { label: lt < T_PERI ? 'SLINGSHOT' : 'RANGER · FALLING' }) : g.clearRect(0, 0, g.canvas.width, g.canvas.height)),
      cards: [
        [T_END + 1, 64.5, 'INTERSTELLAR · ENDURANCE', 'a private journey · data: NASA/JPL Horizons, NASA fact sheets · physics after K. Thorne'],
      ],
      logs: [
        [1, 'CASE', 'Slingshot burn. All engines.', 3.5],
        [6, 'TARS', 'Periapsis two point six Schwarzschild radii. Every second here is hours back home.', 6],
        [11, 'CREW', 'We need to shed mass. I’m letting go.', 4],
        [14.5, 'CREW', 'Newton’s third law. You have to leave something behind to move forward.', 6],
        [21, 'CASE', 'Ranger, we are clear of the hole. We will not forget you.', 5],
        [28, 'CREW', 'The sky is closing into a ring of light…', 4.5],
        [36.5, '', 'Inside. Down is a direction in time.', 4],
        [43, '', 'A lattice of every moment. Gravity can cross it.', 5],
        [48.5, '', 'Some things travel further than light. We carried them all the way here.', 5],
      ],
    };
    return ch;
  },
};
