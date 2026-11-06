import * as THREE from 'three';
import { TEX } from './assets.js';
import { NOISE } from '../gl/noise.js';

// ---------------------------------------------------------------------------
// Physically-based single-scattering atmosphere (Rayleigh + Mie), ray-marched per pixel.
// ---------------------------------------------------------------------------
const ATMO_GLSL = /* glsl */`
uniform vec3 uCenter; uniform float uRp, uRa, uH, uHm; uniform vec3 uSunDir; uniform vec3 uBeta; uniform float uMie, uIntensity, uMieG;
vec2 raySphere(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd); float c = dot(ro, ro) - r*r; float h = b*b - c;
  if (h < 0.0) return vec2(1e20, -1e20); h = sqrt(h); return vec2(-b - h, -b + h);
}
vec3 atmosphere(vec3 ro, vec3 rd, out vec3 transmit){
  transmit = vec3(1.0);
  vec2 ta = raySphere(ro, rd, uRa);
  if (ta.x > ta.y || ta.y < 0.0) return vec3(0.0);
  vec2 tp = raySphere(ro, rd, uRp);
  float t0 = max(ta.x, 0.0), t1 = ta.y;
  if (tp.x < tp.y && tp.x > 0.0) t1 = min(t1, tp.x);
  if (t1 <= t0) return vec3(0.0);
  const int N = 14; const int L = 5;
  float ds = (t1 - t0) / float(N);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0); float odR = 0.0, odM = 0.0;
  for (int i = 0; i < N; i++){
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    float h = length(p) - uRp;
    float dR = exp(-h / uH) * ds, dM = exp(-h / uHm) * ds;
    odR += dR; odM += dM;
    vec2 tl = raySphere(p, uSunDir, uRa);
    vec2 tpl = raySphere(p, uSunDir, uRp * 0.998);
    if (tpl.x < tpl.y && tpl.x > 0.0) continue; // in planet shadow
    float dl = tl.y / float(L); float lR = 0.0, lM = 0.0;
    for (int j = 0; j < L; j++){
      vec3 q = p + uSunDir * dl * (float(j) + 0.5);
      float hq = max(0.0, length(q) - uRp);
      lR += exp(-hq / uH) * dl; lM += exp(-hq / uHm) * dl;
    }
    vec3 att = exp(-(uBeta * (odR + lR) + uMie * 1.1 * (odM + lM)));
    sumR += dR * att; sumM += dM * att;
  }
  transmit = exp(-(uBeta * odR + uMie * 1.1 * odM));
  float mu = dot(rd, uSunDir);
  float pR = 0.0596831 * (1.0 + mu*mu);
  float g = uMieG;
  float pM = 0.1193662 * ((1.0 - g*g) * (1.0 + mu*mu)) / ((2.0 + g*g) * pow(1.0 + g*g - 2.0*g*mu, 1.5));
  return uIntensity * (sumR * uBeta * pR + sumM * uMie * pM);
}
`;

/**
 * kmPerUnit: how many kilometres one scene unit represents for this planet.
 * Earth-like defaults: Rayleigh beta (5.8, 13.5, 33.1)e-3 /km, H = 8 km, Mie H = 1.2 km.
 */
export function createAtmosphere({ radius, kmPerUnit, thicknessKm = 100, beta = [5.8e-3, 13.5e-3, 33.1e-3], Hkm = 8, HmKm = 1.2, mie = 21e-3, mieG = 0.76, intensity = 22, sunDir }) {
  const Ra = radius + thicknessKm / kmPerUnit;
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uRp: { value: radius }, uRa: { value: Ra },
    uH: { value: Hkm / kmPerUnit }, uHm: { value: HmKm / kmPerUnit },
    uBeta: { value: new THREE.Vector3(...beta).multiplyScalar(kmPerUnit) },
    uMie: { value: mie * kmPerUnit }, uMieG: { value: mieG },
    uIntensity: { value: intensity },
    uSunDir: { value: sunDir || new THREE.Vector3(1, 0, 0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${ATMO_GLSL}
      varying vec3 vW;
      void main(){
        vec3 rd = normalize(vW - cameraPosition);
        vec3 tr; vec3 c = atmosphere(cameraPosition - uCenter, rd, tr);
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(Ra, 96, 64), mat);
  mesh.onBeforeRender = () => mesh.getWorldPosition(uniforms.uCenter.value);
  mesh.renderOrder = 5;
  return mesh;
}

// ---------------------------------------------------------------------------
// Earth: day/night, ocean glint, normal map, city lights, moving clouds, atmosphere.
// ---------------------------------------------------------------------------
export function createEarth({ radius = 100, sunDir, kmPerUnit = 6371 / radius, segments = 160 } = {}) {
  const group = new THREE.Group();
  const sun = sunDir || new THREE.Vector3(1, 0, 0);
  const uniforms = {
    tDay: { value: TEX.earthDay }, tNight: { value: TEX.earthLights }, tSpec: { value: TEX.earthSpec },
    tNormal: { value: TEX.earthNormal }, tClouds: { value: TEX.earthClouds },
    uSunDir: { value: sun }, uTime: { value: 0 }, uSun: { value: 1.7 },
  };
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying vec3 vB; varying vec3 vW;
      void main(){ vUv = uv; vec3 on = normalize(position); vN = normalize(mat3(modelMatrix) * normal);
        vec3 t = normalize(cross(vec3(0.0, 1.0, 0.0), on) + vec3(1e-5, 0.0, 0.0));
        vT = normalize(mat3(modelMatrix) * t); vB = normalize(mat3(modelMatrix) * cross(on, t));
        vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDay, tNight, tSpec, tNormal, tClouds; uniform vec3 uSunDir; uniform float uTime, uSun;
      varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying vec3 vB; varying vec3 vW;
      void main(){
        vec3 nm = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
        vec3 Ng = normalize(vN);
        vec3 N = normalize(normalize(vT) * nm.x * 0.7 + normalize(vB) * nm.y * 0.7 + Ng * nm.z);
        vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(Ng, uSunDir);
        float lit = smoothstep(-0.06, 0.22, ndl);
        float diff = max(dot(N, uSunDir), 0.0);
        vec3 day = texture2D(tDay, vUv).rgb;
        float ocean = texture2D(tSpec, vUv).r;
        day = mix(day, day * vec3(0.55, 0.7, 0.9), ocean * 0.5);
        // twilight warmth
        vec3 tw = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.35, ndl));
        float cl = texture2D(tClouds, vUv + vec2(uTime * 0.0006, 0.0)).r;
        float shadow = 1.0 - 0.45 * texture2D(tClouds, vUv + vec2(uTime * 0.0006, 0.0) + uSunDir.xz * 0.002).r;
        vec3 col = day * diff * lit * uSun * tw * shadow;
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(Ng, H), 0.0), 120.0) * smoothstep(0.5, 0.9, ocean) * lit * (1.0 - cl);
        float fres = pow(1.0 - max(dot(Ng, V), 0.0), 5.0);
        col += vec3(1.0, 0.92, 0.8) * spec * 1.6 * uSun + vec3(0.25, 0.4, 0.7) * fres * ocean * lit * 0.4;
        vec3 night = texture2D(tNight, vUv).rgb;
        col += night * vec3(1.0, 0.78, 0.5) * 1.6 * (1.0 - smoothstep(-0.2, 0.05, ndl)) * (1.0 - cl * 0.8);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  group.add(surface);

  const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.006, segments, segments / 2), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tClouds; uniform vec3 uSunDir; uniform float uTime, uSun; varying vec2 vUv; varying vec3 vN;
      void main(){
        float a = texture2D(tClouds, vUv + vec2(uTime * 0.0006, 0.0)).r;
        float ndl = dot(normalize(vN), uSunDir);
        float lit = smoothstep(-0.12, 0.3, ndl);
        vec3 tw = mix(vec3(1.0, 0.5, 0.28), vec3(1.0), smoothstep(0.0, 0.4, ndl));
        gl_FragColor = vec4(vec3(0.9) * tw * lit * uSun * (0.25 + 0.75 * max(ndl, 0.0)), a * 0.9);
      }`,
    transparent: true, depthWrite: false,
  }));
  clouds.renderOrder = 2;
  group.add(clouds);

  const atmo = createAtmosphere({ radius, kmPerUnit, sunDir: sun, intensity: 14 });
  group.add(atmo);
  group.userData = { surface, clouds, atmo, uniforms, update: (t) => { uniforms.uTime.value = t; } };
  return group;
}

// ---------------------------------------------------------------------------
// Generic textured planet (Mars, Jupiter, Saturn, Neptune) with optional ring shadow.
// ---------------------------------------------------------------------------
export function createPlanet({ map, radius = 50, sunDir, atmosphere = null, kmPerUnit = 1, limb = 0.4, sun = 2.4, ring = null, segments = 128 }) {
  const group = new THREE.Group();
  const uniforms = {
    tMap: { value: map }, uSunDir: { value: sunDir }, uSun: { value: sun }, uLimb: { value: limb },
    tRing: { value: ring ? TEX.saturnRing : null }, uRingIn: { value: ring ? ring.inner : 0 }, uRingOut: { value: ring ? ring.outer : 0 },
    uHasRing: { value: ring ? 1 : 0 }, uCenter: { value: new THREE.Vector3() }, uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
  };
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tMap, tRing; uniform vec3 uSunDir, uCenter, uRingNormal; uniform float uSun, uLimb, uRingIn, uRingOut, uHasRing;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(N, uSunDir);
        float diff = smoothstep(-0.04, 0.5, ndl) * max(ndl + 0.04, 0.0) / 1.04;
        vec3 c = texture2D(tMap, vUv).rgb;
        float mu = max(dot(N, V), 0.0);
        c *= mix(1.0, pow(mu, 0.35), uLimb); // limb darkening
        float sh = 1.0;
        if (uHasRing > 0.5){
          // shadow of the rings on the cloud tops
          float t = -dot(vW - uCenter, uRingNormal) / dot(uSunDir, uRingNormal);
          if (t > 0.0){ vec3 p = vW + uSunDir * t; float r = length(p - uCenter);
            if (r > uRingIn && r < uRingOut){ vec4 rc = texture2D(tRing, vec2((r - uRingIn)/(uRingOut - uRingIn), 0.5)); sh = 1.0 - rc.a * 0.85; } }
        }
        gl_FragColor = vec4(c * diff * uSun * sh, 1.0);
      }`,
  }));
  surface.onBeforeRender = () => {
    surface.getWorldPosition(uniforms.uCenter.value);
    uniforms.uRingNormal.value.set(0, 1, 0).applyQuaternion(surface.getWorldQuaternion(new THREE.Quaternion()));
  };
  group.add(surface);
  if (atmosphere) group.add(createAtmosphere({ radius, kmPerUnit, sunDir, ...atmosphere }));

  if (ring) {
    const g = new THREE.RingGeometry(ring.inner, ring.outer, 256, 4);
    const pos = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); uv.setXY(i, (v.length() - ring.inner) / (ring.outer - ring.inner), 0.5); }
    const rmat = new THREE.ShaderMaterial({
      uniforms: { tRing: { value: TEX.saturnRing }, uSunDir: { value: sunDir }, uCenter: uniforms.uCenter, uR: { value: radius }, uSun: { value: sun } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tRing; uniform vec3 uSunDir, uCenter; uniform float uR, uSun; varying vec2 vUv; varying vec3 vW;
        void main(){
          vec4 c = texture2D(tRing, vUv);
          // planet's shadow across the rings
          vec3 ro = vW - uCenter; float b = dot(ro, uSunDir); float cc = dot(ro, ro) - uR*uR; float h = b*b - cc;
          float sh = (h > 0.0 && -b - sqrt(h) > 0.0) ? 0.12 : 1.0;
          vec3 V = normalize(cameraPosition - vW);
          float fwd = pow(max(dot(-V, uSunDir), 0.0), 8.0); // forward scattering when backlit
          gl_FragColor = vec4(c.rgb * uSun * 0.42 * sh * (1.0 + fwd * 2.5), c.a * 0.92);
        }`,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const rmesh = new THREE.Mesh(g, rmat);
    rmesh.rotation.x = -Math.PI / 2;
    rmesh.renderOrder = 3;
    group.add(rmesh);
    group.userData.ring = rmesh;
  }
  group.userData.surface = surface;
  group.userData.uniforms = uniforms;
  return group;
}

// ---------------------------------------------------------------------------
// Procedural worlds around Gargantua.
//  type 0: Miller — a shallow global ocean, grey-teal, with huge tidal swells
//  type 1: Mann   — frozen ammonia clouds over glaciers
//  type 2: Edmunds — arid, rocky, temperate band
// ---------------------------------------------------------------------------
export function createAlienPlanet({ type = 0, radius = 50, sunDir, kmPerUnit = 100, seed = 1 }) {
  const group = new THREE.Group();
  const uniforms = { uType: { value: type }, uSunDir: { value: sunDir }, uTime: { value: 0 }, uSeed: { value: seed }, uSun: { value: type === 1 ? 0.75 : 2.3 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`varying vec3 vObj; varying vec3 vN; varying vec3 vW;
      void main(){ vObj = normalize(position); vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform int uType; uniform vec3 uSunDir; uniform float uTime, uSeed, uSun;
      varying vec3 vObj; varying vec3 vN; varying vec3 vW;
      ${NOISE}
      void main(){
        vec3 p = normalize(vObj) + uSeed * 3.17;
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(N, uSunDir);
        float lit = smoothstep(-0.05, 0.3, ndl) * max(ndl + 0.05, 0.0);
        vec3 col; float spec = 0.0; float cloud = 0.0;
        if (uType == 0){
          float sw = fbm(p * 3.0 + vec3(0.0, uTime * 0.01, 0.0));
          col = mix(vec3(0.10, 0.18, 0.22), vec3(0.32, 0.42, 0.45), smoothstep(-0.4, 0.6, sw));
          float bands = sin(dot(p, vec3(0.0, 1.0, 0.2)) * 40.0 + sw * 6.0) * 0.5 + 0.5;
          col *= 0.85 + 0.25 * bands;
          spec = 1.0;
          cloud = smoothstep(0.1, 0.65, fbm(p * 4.0 + vec3(uTime * 0.02, 0.0, 0.0)) * 0.6 + 0.3) * 0.75;
        } else if (uType == 1){
          float r = ridged(p * 4.0);
          col = mix(vec3(0.62, 0.70, 0.78), vec3(0.95, 0.97, 1.0), smoothstep(0.4, 0.9, r));
          col = mix(col, vec3(0.32, 0.45, 0.6), smoothstep(0.6, 0.85, fbm(p * 9.0)) * 0.5);
          cloud = smoothstep(0.0, 0.7, fbm(p * 2.5 + 4.0) * 0.6 + 0.35) * 0.9;
          spec = 0.4;
        } else {
          float h = fbm(p * 2.5);
          col = mix(vec3(0.42, 0.26, 0.16), vec3(0.78, 0.6, 0.42), smoothstep(-0.5, 0.6, h));
          col = mix(col, vec3(0.25, 0.3, 0.2), smoothstep(0.3, 0.6, fbm(p * 5.0 + 2.0)) * 0.4);
          cloud = smoothstep(0.35, 0.8, fbm(p * 3.0 + vec3(uTime*0.01)) * 0.5 + 0.5) * 0.5;
        }
        vec3 H = normalize(uSunDir + V);
        float s = pow(max(dot(N, H), 0.0), 70.0) * spec * (1.0 - cloud);
        vec3 c = col * lit * uSun;
        c = mix(c, vec3(0.95, 0.97, 1.0) * lit * uSun, cloud);
        c += vec3(1.0, 0.95, 0.85) * s * 3.0 * uSun;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 64), mat);
  group.add(surface);
  const atmoCfg = [
    { beta: [6.5e-3, 10e-3, 14e-3], Hkm: 10, intensity: 18, mie: 30e-3 },     // Miller: thick humid haze
    { beta: [4.5e-3, 9e-3, 18e-3], Hkm: 7, intensity: 6, mie: 10e-3 },        // Mann: pale cold blue (bright ice: keep the haze thin)
    { beta: [9e-3, 9e-3, 8e-3], Hkm: 9, intensity: 16, mie: 30e-3 },          // Edmunds: dusty tan
  ][type];
  group.add(createAtmosphere({ radius, kmPerUnit, sunDir, thicknessKm: 110, ...atmoCfg }));
  group.userData = { surface, uniforms, update: (t) => { uniforms.uTime.value = t; } };
  return group;
}

/** A distant star: hot disc + glare sprite. */
export function createSun({ size = 30, color = new THREE.Color(1.0, 0.95, 0.85), intensity = 30 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uI: { value: intensity } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); mv.xy += position.xy * vec2(length(modelMatrix[0].xyz)); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uI; varying vec2 vUv;
      void main(){
        vec2 c = vUv - 0.5; float r = length(c) * 2.0;
        float core = smoothstep(0.12, 0.09, r);
        float glow = exp(-r * 7.0) * 0.9 + exp(-r * 2.2) * 0.15;
        float a = atan(c.y, c.x);
        float rays = pow(abs(sin(a * 3.0)), 60.0) * exp(-r * 3.0) * 0.4 + pow(abs(cos(a * 2.0 + 0.5)), 120.0) * exp(-r*2.0) * 0.25;
        float fadeOut = smoothstep(1.0, 0.55, r); // reaches zero before the quad's edge: no square halo
        vec3 col = uColor * (core * uI + (glow + rays) * uI * 0.25) * fadeOut;
        gl_FragColor = vec4(col, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.scale.setScalar(size);
  m.frustumCulled = false;
  m.renderOrder = 10;
  m.userData.uniforms = mat.uniforms;
  return m;
}
