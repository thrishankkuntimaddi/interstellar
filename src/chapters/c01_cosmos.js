import * as THREE from 'three';
import { seg, sseg, smooth, lerp, bump, V, lookAt, easeInOut } from '../core/util.js';
import { skyLayer, labelSprite } from './base.js';
import { createEarth, createSun } from '../world/planets.js';
import { TEX } from '../world/assets.js';
import { keplerPosition, ORBIT_KEYS, PLANETS, C, fmt } from '../data/astro.js';

// ---------- Cosmic web of galaxies ----------
function galaxyField(count = 60000) {
  const nodes = [];
  for (let i = 0; i < 70; i++) nodes.push(new THREE.Vector3().randomDirection().multiplyScalar(Math.pow(Math.random(), 0.5) * 1800));
  nodes.push(new THREE.Vector3(0, 0, 0)); // our Local Group sits on a filament node
  const pos = [], col = [], size = [], rot = [], ell = [];
  const c = new THREE.Color();
  const push = (p, s) => {
    if (p.length() < 6) return; // keep space around the Milky Way itself
    pos.push(p.x, p.y, p.z);
    const elliptical = Math.random() < 0.3;
    c.setHSL(elliptical ? 0.09 : 0.58 + Math.random() * 0.05, elliptical ? 0.5 : 0.35, 0.65 + Math.random() * 0.2);
    col.push(c.r, c.g, c.b);
    size.push(s * (0.4 + Math.pow(Math.random(), 3) * 2.5));
    rot.push(Math.random() * Math.PI); ell.push(elliptical ? 0.6 + Math.random() * 0.4 : 0.15 + Math.random() * 0.6);
  };
  for (let i = 0; i < count; i++) {
    const a = nodes[(Math.random() * nodes.length) | 0];
    let b = nodes[(Math.random() * nodes.length) | 0];
    if (Math.random() < 0.35) { // cluster
      push(a.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(Math.pow(Math.random(), 2) * 40)), 1.0);
    } else {
      if (a.distanceTo(b) > 900) b = a.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(500));
      const t = Math.random();
      push(a.clone().lerp(b, t).add(new THREE.Vector3().randomDirection().multiplyScalar(Math.pow(Math.random(), 1.5) * 28)), 0.9);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('rot', new THREE.Float32BufferAttribute(rot, 1));
  g.setAttribute('ell', new THREE.Float32BufferAttribute(ell, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: window.innerHeight }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float size, rot, ell; attribute vec3 color; uniform float uScale; varying vec3 vC; varying float vR, vE, vF;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        float px = size * 1.6 * uScale / -mv.z; vF = clamp(px / 2.0, 0.15, 1.0);
        gl_PointSize = clamp(px, 1.5, 220.0); vC = color; vR = rot; vE = ell; }`,
    fragmentShader: /* glsl */`
      uniform float uGain; varying vec3 vC; varying float vR, vE, vF;
      void main(){
        vec2 p = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR);
        p = vec2(c*p.x - s*p.y, s*p.x + c*p.y); p.y /= max(vE, 0.12);
        float d = dot(p, p);
        float core = exp(-d * 260.0), disk = exp(-d * 34.0);
        float a = atan(p.y, p.x); float arms = 0.6 + 0.4 * sin(a * 2.0 + sqrt(d) * 30.0);
        float I = (core * 1.6 + disk * 0.5 * arms) * vF * smoothstep(0.25, 0.15, dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5));
        gl_FragColor = vec4(vC * I * uGain, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------- Milky Way: barred spiral, ~1 unit = 100,000 ly ----------
function milkyWay() {
  const group = new THREE.Group();
  const N = 160000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
  const c = new THREE.Color();
  const pitch = Math.tan((12 * Math.PI) / 180);
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return (u - 2) / 2; };
  for (let i = 0; i < N; i++) {
    let x, y, z;
    const kind = Math.random();
    if (kind < 0.16) { // bulge + bar
      const r = Math.abs(gauss()) * 0.06;
      const a = Math.random() * Math.PI * 2;
      x = Math.cos(a) * r * 1.8; z = Math.sin(a) * r * 0.7; y = gauss() * 0.02;
      const ca = Math.cos(0.45), sa = Math.sin(0.45); [x, z] = [x * ca - z * sa, x * sa + z * ca];
      c.setRGB(1.0, 0.78, 0.5);
      sz[i] = 1.2;
    } else {
      const r = 0.05 + -Math.log(1 - Math.random() * 0.995) * 0.13;
      const arm = (Math.random() * 4) | 0;
      const major = arm % 2 === 0;
      const theta = arm * Math.PI / 2 + Math.log(r / 0.05) / pitch;
      const scatter = (major ? 0.22 : 0.35) * (0.6 + r * 2);
      const a = theta + gauss() * scatter;
      const rr = r * (1 + gauss() * 0.06);
      x = Math.cos(a) * rr; z = Math.sin(a) * rr; y = gauss() * 0.006 * (1 + r * 3);
      const inArm = Math.exp(-Math.pow((a - theta) / scatter, 2) * 3);
      const young = Math.random() < inArm * 0.7;
      if (young) c.setRGB(0.62, 0.75, 1.0); else c.setRGB(1.0, 0.86, 0.68);
      if (young && Math.random() < 0.05) c.setRGB(1.0, 0.45, 0.6); // H II regions
      sz[i] = young ? 1.0 + Math.random() : 0.8;
    }
    pos.set([x, y, z], i * 3);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: window.innerHeight }, uGain: { value: 1 }, uFocus: { value: new THREE.Vector3() }, uHide: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float size; attribute vec3 color; uniform float uScale, uHide; uniform vec3 uFocus; varying vec3 vC; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        float px = size * 0.0016 * uScale / -mv.z;
        vA = clamp(px, 0.05, 1.0) * (1.0 - uHide * smoothstep(0.02, 0.0, distance(position, uFocus)));
        gl_PointSize = clamp(px, 1.0, 6.0); vC = color; }`,
    fragmentShader: /* glsl */`
      uniform float uGain; varying vec3 vC; varying float vA;
      void main(){ vec2 p = gl_PointCoord - 0.5; float a = exp(-dot(p,p) * 16.0) * smoothstep(0.25, 0.12, dot(p,p)); gl_FragColor = vec4(vC * a * vA * uGain * 0.55, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const stars = new THREE.Points(g, mat); stars.frustumCulled = false;
  group.add(stars);
  // dust lanes: dark absorbing haze following the inner edge of the arms
  const D = 24000, dpos = new Float32Array(D * 3);
  for (let i = 0; i < D; i++) {
    const r = 0.06 + Math.random() * 0.4; const arm = (Math.random() * 2 | 0) * 2;
    const a = arm * Math.PI / 2 + Math.log(r / 0.05) / pitch - 0.12 + gauss() * 0.07;
    dpos.set([Math.cos(a) * r, gauss() * 0.003, Math.sin(a) * r], i * 3);
  }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dmat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: window.innerHeight }, uGain: { value: 1 } },
    vertexShader: /* glsl */`uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(0.012 * uScale / -mv.z, 1.0, 40.0); }`,
    fragmentShader: /* glsl */`uniform float uGain; void main(){ vec2 p = gl_PointCoord - 0.5; float a = exp(-dot(p,p)*10.0) * 0.12 * uGain * smoothstep(0.25, 0.1, dot(p,p)); gl_FragColor = vec4(0.06, 0.035, 0.02, a); }`,
    transparent: true, depthWrite: false,
  });
  const dust = new THREE.Points(dg, dmat); dust.frustumCulled = false;
  group.add(dust);
  // galactic core glow
  const core = createSun({ size: 0.35, color: new THREE.Color(1.0, 0.8, 0.55), intensity: 3 });
  group.add(core);
  group.userData = { stars, dust, core, mat, dmat };
  return group;
}

const SUN_POS = new THREE.Vector3(0.26, 0.0002, 0.0); // ~26,000 ly from the centre, Orion Arm

export default {
  id: 'cosmos', kicker: 'PROLOGUE', title: 'A Map of Everything', start: 0, end: 68,
  build(ctx) {
    // Stage A/B: universe + Milky Way share one scene with continuously varying near/far
    const uni = new THREE.Scene();
    const field = galaxyField();
    uni.add(field);
    const mw = milkyWay();
    mw.rotation.x = 0.0;
    uni.add(mw);
    const uniLayer = { scene: uni, near: 0.01, far: 1e5, visible: true };

    // Stage C: Solar System orrery with live ephemeris
    const ssSky = skyLayer('ours', 0.55);
    const ss = new THREE.Scene();
    const AU = 10;
    const sun = createSun({ size: 6, intensity: 30 }); ss.add(sun);
    const date = new Date();
    const planets = {};
    const ecl = (p) => new THREE.Vector3(p.x, p.z, -p.y).multiplyScalar(AU);
    const colors = { mercury: '#b8b0a6', venus: '#e8cf9c', earth: '#7fb2ff', mars: '#e07a52', jupiter: '#e3c49a', saturn: '#f0dca6', uranus: '#9fe0e8', neptune: '#6f8cff' };
    for (const k of ORBIT_KEYS) {
      const pts = [];
      const period = Math.pow(keplerPosition(k, date).a, 1.5) * 365.25;
      for (let i = 0; i <= 256; i++) pts.push(ecl(keplerPosition(k, new Date(date.getTime() + (i / 256) * period * 86400000))));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colors[k], transparent: true, opacity: k === 'saturn' ? 0.55 : 0.22 }));
      ss.add(line);
      const p = ctx.eph.positions[k];
      const dot = createSun({ size: k === 'jupiter' || k === 'saturn' ? 1.4 : 0.9, color: new THREE.Color(colors[k]), intensity: 4 });
      dot.position.copy(ecl(p));
      ss.add(dot);
      const lab = labelSprite(k, { size: 0.9, color: colors[k] }); lab.position.copy(dot.position).add(V(1.2, 0.6, 0));
      ss.add(lab);
      planets[k] = { dot, lab, pos: dot.position.clone() };
    }
    // the anomaly near Saturn
    const anomaly = createSun({ size: 2.2, color: new THREE.Color(0.7, 0.85, 1.0), intensity: 6 });
    anomaly.position.copy(planets.saturn.pos).add(V(2.5, 0.6, 1.5));
    ss.add(anomaly);
    const aLab = labelSprite('gravitational anomaly', { size: 0.9, color: '#ffd49a' }); aLab.position.copy(anomaly.position).add(V(1.4, -0.8, 0)); ss.add(aLab);
    const ssLayer = { scene: ss, near: 0.1, far: 5000, visible: true };

    // Stage D: Earth
    const sunDir = V(-0.25, 0.12, 1).normalize();
    const earthSky = skyLayer('ours', 0.6);
    const es = new THREE.Scene();
    const earth = createEarth({ radius: 10, sunDir });
    earth.rotation.z = (23.44 * Math.PI) / 180;
    es.add(earth);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(2.73, 64, 32), new THREE.MeshStandardMaterial({ map: TEX.moon, roughness: 1 }));
    moon.position.set(-420, 40, -380); es.add(moon);
    const sunL = new THREE.DirectionalLight(0xffffff, 3); sunL.position.copy(sunDir).multiplyScalar(100); es.add(sunL);
    const bigSun = createSun({ size: 140, intensity: 40 }); bigSun.position.copy(sunDir).multiplyScalar(2000); es.add(bigSun);
    const esLayer = { scene: es, near: 0.05, far: 10000, visible: true };

    const ch = {
      layers: [uniLayer],
      subject: null,
      sunDir,
      update(lt, dt) {
        const stage = lt < 44 ? 0 : lt < 56 ? 1 : 2;
        if (stage === 0) this.layers = [uniLayer];
        else if (stage === 1) this.layers = [ssSky, ssLayer];
        else this.layers = [earthSky, esLayer];
        mw.rotation.y = -lt * 0.004;
        mw.userData.mat.uniforms.uScale.value = field.material.uniforms.uScale.value = window.innerHeight;
        mw.userData.mat.uniforms.uFocus.value.copy(SUN_POS);
        mw.userData.mat.uniforms.uHide.value = sseg(lt, 36, 42);
        field.material.uniforms.uGain.value = sseg(lt, 1, 9) * (1 - sseg(lt, 22, 34) * 0.85);
        earth.userData.update(lt);
        earth.rotation.y = lt * 0.012;
        earthSky.sky.userData.update(lt); ssSky.sky.userData.update(lt);
        anomaly.userData.uniforms.uI.value = 4 + 4 * Math.sin(lt * 3);
      },
      shot(lt, cam) {
        if (lt < 30) {
          // fall through the cosmic web towards the Milky Way
          const u = easeInOut(seg(lt, 0, 30));
          const d = 2600 * Math.pow(1.6 / 2600, u);
          const ang = 0.9 + lt * 0.02;
          lookAt(cam, V(Math.cos(ang) * d, d * (0.25 + 0.4 * (1 - u)), Math.sin(ang) * d), V(0, 0, 0));
          uniLayer.near = Math.max(0.0005, d * 0.002); uniLayer.far = d * 50 + 4000;
        } else if (lt < 44) {
          // over the galactic disc, then down into the Orion Arm
          const u = easeInOut(seg(lt, 30, 44));
          const target = new THREE.Vector3().lerpVectors(V(0, 0, 0), SUN_POS.clone().applyAxisAngle(V(0, 1, 0), -lt * 0.004), smooth(seg(lt, 34, 42)));
          const d = 1.6 * Math.pow(0.004 / 1.6, u);
          const ang = 1.6 + u * 1.2;
          lookAt(cam, target.clone().add(V(Math.cos(ang) * d, d * lerp(0.75, 0.22, u), Math.sin(ang) * d)), target);
          uniLayer.near = Math.max(1e-6, d * 0.001); uniLayer.far = 3000;
        } else if (lt < 56) {
          const u = easeInOut(seg(lt, 44, 56));
          const sat = planets.saturn.pos, earthP = planets.earth.pos;
          const focus = new THREE.Vector3().lerpVectors(V(0, 0, 0), sat, smooth(seg(lt, 44, 50))).lerp(earthP, smooth(seg(lt, 51, 56)));
          const d = lerp(260, 30, u);
          const ang = 0.6 + u * 1.4;
          lookAt(cam, focus.clone().add(V(Math.cos(ang) * d, d * lerp(0.9, 0.35, u), Math.sin(ang) * d)), focus);
        } else {
          const u = easeInOut(seg(lt, 56, 68));
          const d = lerp(90, 13.2, u);
          const a = -0.8 + u * 0.95;
          const pos = V(Math.cos(a) * d, lerp(12, 1.0, u), Math.sin(a) * d);
          lookAt(cam, pos, V(0, lerp(0, 3, u), 0).add(V(-2, 0, 0).multiplyScalar(u)));
        }
      },
      fx(lt) {
        return {
          fade: 1 - sseg(lt, 0, 6) + bump(lt, 43, 43.8, 44.2, 45) * 0.0,
          flash: bump(lt, 43.2, 43.9, 44.1, 45.5) * 0.8 + bump(lt, 55.3, 55.9, 56.1, 57.5) * 0.6,
          letterbox: 1, bloom: lt < 44 ? 0.9 : 0.7, exposure: 1.0, grain: 0.07,
        };
      },
      telemetry(lt) {
        if (lt < 30) {
          const d = 2600 * Math.pow(1.6 / 2600, easeInOut(seg(lt, 0, 30)));
          return [
            ['SCALE', 'OBSERVABLE UNIVERSE'], ['RADIUS', '46.5 billion ly'], ['GALAXIES', '~2 × 10¹²'],
            ['DIST. TO MILKY WAY', `${fmt.n(d * 0.1, d < 10 ? 2 : 0)} Mly`], ['STRUCTURE', 'filaments · voids · clusters'],
          ];
        }
        if (lt < 44) return [
          ['GALAXY', 'MILKY WAY · SBbc'], ['DIAMETER', '~100,000 ly'], ['STARS', '100–400 billion'],
          ['SUN → CENTRE', '26,000 ly'], ['ORBITAL SPEED', '230 km/s'], ['GALACTIC YEAR', '~230 Myr'],
        ];
        if (lt < 56) {
          const e = ctx.eph.positions.earth, s = ctx.eph.positions.saturn;
          const dES = Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z);
          return [
            ['DATE', new Date().toISOString().slice(0, 10)], ['EARTH → SATURN', `${dES.toFixed(3)} AU`],
            ['LIGHT TIME', `${fmt.n((dES * C.AU) / C.c / 60, 1)} min`], ['SATURN HELIO. DIST', `${Math.hypot(s.x, s.y, s.z).toFixed(3)} AU`],
            ['ANOMALY', 'near Saturn · lensing detected', 'warn'],
          ];
        }
        return [['BODY', 'EARTH'], ['RADIUS', `${fmt.n(PLANETS.earth.radiusKm, 1)} km`], ['SIDEREAL DAY', '23 h 56 m 4 s'], ['AXIAL TILT', '23.44°'], ['ESCAPE VELOCITY', '11.186 km/s']];
      },
      telemetrySource: () => ctx.eph.source,
      cards: [
        [6, 15, 'INTERSTELLAR', 'E N D U R A N C E'],
        [31, 37, 'THE MILKY WAY', 'one galaxy among two trillion'],
        [39, 43.5, 'ORION ARM', '26,000 light-years from the galactic centre'],
        [62, 67.5, 'EARTH', 'the beginning'],
      ],
      logs: [
        [17, '', 'Every map of the sky ends somewhere. Ours ended at Saturn.', 6],
        [24, '', 'Fifty years ago something opened out there. Nobody built it. It just appeared.', 6.5],
        [47, 'NASA', 'Lensing signature confirmed near Saturn. Spherical. Stable. Two kilometres across.', 6],
        [57, 'NASA', 'The Endurance is assembled in orbit. Crew transfer by heavy launcher.', 5.5],
      ],
      minimap: null,
    };
    return ch;
  },
};
