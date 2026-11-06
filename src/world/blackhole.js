import * as THREE from 'three';
import { NOISE, FS_VERT, RAY, BLACKBODY } from '../gl/noise.js';
import { SKY } from './sky.js';
import { settings } from '../core/settings.js';

/**
 * GARGANTUA — a spinning (Kerr) black hole, ray traced per pixel.
 *
 * Null geodesics are integrated (RK4) in Boyer–Lindquist coordinates with the Hamiltonian
 * equations used by GPU Kerr tracers (Pu et al. 2016, "Odyssey"), in units of M (r_s = 2M):
 *   dr/dλ  = Δ p_r / Σ                   dθ/dλ  = p_θ / Σ
 *   dφ/dλ  = [2ar + (Σ − 2r) L / sin²θ] / (ΣΔ)
 *   dp_r/dλ = [2rPΔ − P²(r−1)] / (ΣΔ²) − (r−1)p_r²/Σ,   P = r² + a² − aL   (exact −∂H/∂r)
 *   dp_θ/dλ = sinθ cosθ (L²/sin⁴θ − a²) / Σ,   κ = p_θ² + L²/sin²θ + a² sin²θ
 * Rays start from a zero-angular-momentum observer (ZAMO) at the camera, so frame dragging,
 * the asymmetric "D-shaped" shadow, and the lensed disk arching over and under the hole all emerge.
 * The thin disk runs from the prograde ISCO outward, Keplerian Ω = 1/(r^{3/2} + a), with the exact
 * Kerr redshift g = 1 / (u^t (1 + Ω L)) including Doppler beaming and gravitational redshift.
 *
 * Two looks (key G):  MOVIE    a = 0.6,  no beaming (what the film's VFX team rendered)
 *                      PHYSICAL a = 0.999, full Doppler beaming and redshift
 */

export function iscoRadius(a) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

export const BH_MODES = {
  movie: { spin: 0.6, doppler: 0.0, label: 'MOVIE LOOK · a = 0.6 · no beaming' },
  physical: { spin: 0.999, doppler: 0.85, label: 'PHYSICAL · a = 0.999 · Doppler + redshift' },
};
const INSTANCES = new Set();
let currentMode = 'movie';
export function setBlackHoleMode(mode) {
  currentMode = mode;
  const m = BH_MODES[mode];
  for (const u of INSTANCES) { u.uSpin.value = m.spin; u.uDoppler.value = m.doppler; u.uRin.value = iscoRadius(m.spin); }
}
export function blackHoleMode() { return currentMode; }
export function INSTANCES_UNIFORMS() { return INSTANCES; }

export function createBlackHole({ scale = 10, sky = null } = {}) {
  const m0 = BH_MODES[currentMode];
  const uniforms = {
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uBH: { value: new THREE.Vector3() }, uScale: { value: scale }, uRot: { value: new THREE.Matrix3() },
    uSky: { value: sky || SKY.other }, uSkyGain: { value: 1.0 }, uTime: { value: 0 },
    uSpin: { value: m0.spin }, uRin: { value: iscoRadius(m0.spin) }, uRout: { value: 26.0 },
    uDiskGain: { value: 1.0 }, uDoppler: { value: m0.doppler },
    uTemp: { value: 6200 }, uSteps: { value: settings.bhQuality || 1.0 }, uDiskSpeed: { value: 1.0 }, uWhite: { value: 0 },
  };
  INSTANCES.add(uniforms);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */`
      precision highp float;
      ${RAY}
      ${NOISE}
      ${BLACKBODY}
      uniform vec3 uBH; uniform float uScale; uniform mat3 uRot; uniform samplerCube uSky; uniform float uSkyGain, uTime;
      uniform float uSpin, uRin, uRout, uDiskGain, uDoppler, uTemp, uDiskSpeed, uWhite, uSteps;

      const float RFAR = 140.0; // M

      vec3 rotAxis(vec3 v, vec3 axis, float ang){ float c = cos(ang), s = sin(ang); return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }
      // scene axes (disk in XZ, spin along +Y)  <->  Kerr axes (spin along +Z)
      vec3 toKerr(vec3 p){ return vec3(p.x, p.z, p.y); }
      vec3 fromKerr(vec3 k){ return vec3(k.x, k.z, k.y); }
      vec3 bl2cart(float r, float th, float ph, float a){ float s = sqrt(r*r + a*a) * sin(th); return vec3(s * cos(ph), s * sin(ph), r * cos(th)); }

      // y = (r, θ, p_r, p_θ); returns dy/dλ and dφ/dλ
      vec4 F(vec4 y, float a, float L, float kap, out float dph){
        float sr = sin(y.y); float r = y.x, s = (sr < 0.0 ? -1.0 : 1.0) * max(abs(sr), 0.001), c = cos(y.y);
        float s2 = s * s, a2 = a * a, r2 = r * r;
        float Sig = r2 + a2 * c * c, Del = max(r2 - 2.0 * r + a2, 1e-6);
        dph = (2.0 * a * r + (Sig - 2.0 * r) * L / s2) / (Sig * Del);
        float P = r2 + a2 - a * L;
        return vec4(
          Del / Sig * y.z,
          y.w / Sig,
          // exact −∂H/∂r (no on-shell substitution — stable through the photon region)
          (2.0 * r * P * Del - P * P * (r - 1.0)) / (Sig * Del * Del) - (r - 1.0) * y.z * y.z / Sig,
          s * c * (L * L / (s2 * s2) - a2) / Sig);
      }

      vec4 diskSample(float r, float ph, float a, float L, float E0){
        if (r < uRin || r > uRout) return vec4(0.0);
        float r15 = pow(r, 1.5);
        float Om = 1.0 / (r15 + a);
        float ang = ph - uTime * Om * 6.0 * uDiskSpeed;
        vec2 cs = vec2(cos(ang), sin(ang));
        float n1 = fbm3(vec3(r * 1.6, cs * 1.4));
        float n2 = snoise(vec3(r * 4.5, cs * 3.0) + 7.0);
        float n3 = snoise(vec3(r * 11.0, cs * 6.0) + 3.0);
        float streak = 0.5 + 0.6 * (n1 * 0.5 + 0.5) + 0.22 * n2 + 0.1 * n3;
        float rings = 0.78 + 0.22 * sin(r * 5.5 + n1 * 3.0);
        float x = uRin / r;
        float prof = pow(x, 2.4) * max(1.0 - sqrt(x) * 0.9, 0.0);
        float edge = smoothstep(uRin, uRin * 1.08, r) * (1.0 - smoothstep(uRout * 0.55, uRout, r));
        // exact Kerr redshift for a circular equatorial emitter seen along this ray
        float ut = (r15 + a) / (pow(r, 0.75) * sqrt(max(r15 - 3.0 * sqrt(r) + 2.0 * a, 1e-4)));
        float g = 1.0 / (ut * (1.0 + Om * L) * E0);
        float shift = mix(1.0, g, uDoppler);
        float T = uTemp * pow(x, 0.75) * 1.25;
        vec3 col = blackbody(T * shift);
        float I = prof * streak * rings * edge * pow(shift, 4.0) * 10.0;
        I = I / (1.0 + 0.12 * I);           // soft knee: keeps the inner disk from clipping
        float al = clamp(I * 1.4, 0.0, 0.97) * edge;
        return vec4(col * I, al);
      }

      void main(){
        float a = uSpin;
        float rh = 1.0 + sqrt(max(1.0 - a * a, 0.0));
        vec3 rdW = viewRay();
        vec3 X = toKerr(uRot * ((uCamPos - uBH) / uScale) * 2.0);   // r_s -> M
        vec3 D = normalize(toKerr(uRot * rdW));
        vec3 col = vec3(0.0); float T = 1.0;
        float camGain = clamp(length(X) / 18.0, 0.32, 1.0);
        float b0 = length(cross(X, D));
        float tc = -dot(X, D);
        vec3 outDir = D;
        bool march = true; bool fromFar = false; bool escaped = false;
        if (length(X) > RFAR){
          if (tc < 0.0 || b0 > RFAR){
            vec3 toC = normalize(-X - D * dot(-X, D));
            float alpha = 4.0 / max(b0, 2.0) * smoothstep(-0.2 * length(X), 0.0, tc);
            outDir = rotAxis(D, normalize(cross(D, toC)), alpha);
            march = false;
          } else {
            X = X + D * (tc - sqrt(RFAR * RFAR - b0 * b0)); fromFar = true;
          }
        }
        if (march){
          // Boyer–Lindquist position of the camera
          float a2 = a * a; float R2 = dot(X, X); float w = R2 - a2;
          float r = sqrt(0.5 * (w + sqrt(w * w + 4.0 * a2 * X.z * X.z)));
          if (r < rh * 1.02){ T = 0.0; march = false; }
          else {
            float th = acos(clamp(X.z / r, -1.0, 1.0)), ph = atan(X.y, X.x);
            float s = max(sin(th), 1e-4), c = cos(th), sq = sqrt(r * r + a2);
            vec3 er = normalize(vec3(r / sq * s * cos(ph), r / sq * s * sin(ph), c));
            vec3 et = normalize(vec3(sq * c * cos(ph), sq * c * sin(ph), -r * s));
            vec3 ep = vec3(-sin(ph), cos(ph), 0.0);
            vec3 n = normalize(vec3(dot(D, er), dot(D, et), dot(D, ep)));
            // ZAMO tetrad -> covariant momenta, normalised to conserved E = 1
            float Sig = r * r + a2 * c * c, Del = r * r - 2.0 * r + a2;
            float A = (r * r + a2) * (r * r + a2) - a2 * Del * s * s;
            float alp = sqrt(Sig * Del / A), om = 2.0 * a * r / A;
            float pphi = sqrt(A / Sig) * s * n.z;
            float E0 = alp + om * pphi;
            float L = pphi / E0;
            vec4 y = vec4(r, th, sqrt(Sig / Del) * n.x / E0, sqrt(Sig) * n.y / E0);
            float kap = y.w * y.w + L * L / (s * s) + a2 * s * s;
            vec3 Pprev = bl2cart(y.x, y.y, ph, a), Pnow = Pprev;
            float crossings = 0.0;
            for (int i = 0; i < 230; i++){
              float d1, d2, d3, d4;
              vec4 k1 = F(y, a, L, kap, d1);
              float h = clamp(0.085 * y.x, 0.004, 5.0) / uSteps;
              h *= clamp((y.x - rh) * 1.5, 0.08, 1.0);
              // adaptive near the spin axis: limit the per-step change in θ and φ so rays bounce off
              // the polar centrifugal barrier correctly instead of tunnelling through it
              h = min(h, 0.3 * max(abs(sin(y.y)), 0.05) / max(abs(k1.y), 1e-6));
              h = min(h, 0.35 / max(abs(d1), 1e-6));
              h = max(h, 0.002);
              vec4 k2 = F(y + 0.5 * h * k1, a, L, kap, d2);
              vec4 k3 = F(y + 0.5 * h * k2, a, L, kap, d3);
              vec4 k4 = F(y + h * k3, a, L, kap, d4);
              vec4 yn = y + h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
              float phn = ph + h / 6.0 * (d1 + 2.0 * d2 + 2.0 * d3 + d4);
              float c0 = cos(y.y), c1 = cos(yn.y);
              if (c0 * c1 < 0.0){
                float f = c0 / (c0 - c1);
                crossings += 1.0;
                // direct image + first Einstein image; higher orders are sub-pixel and only alias into sparkle
                float order = crossings < 2.5 ? 1.0 : 0.0;
                vec4 dsk = diskSample(mix(y.x, yn.x, f), mix(ph, phn, f), a, L, E0) * order;
                col += T * dsk.rgb * uDiskGain * camGain;
                T *= 1.0 - dsk.a;
                if (crossings > 2.5){ T = 0.0; break; }
              }
              y = yn; ph = phn;
              if (y.x < rh * 1.01){ T = 0.0; break; }
              if (T < 0.01) break;
              Pprev = Pnow; Pnow = bl2cart(y.x, y.y, ph, a);
              if (y.x > RFAR && y.z > 0.0){ escaped = true; break; }   // direction = last chord of the path
            }
            outDir = normalize(Pnow - Pprev + 1e-6);
            if (!escaped && y.x < 8.0) T = 0.0; // trapped near the photon orbit: part of the shadow's edge
            else {
              // weak-field bending accumulated outside the traced sphere (keeps the image seamless at b = RFAR)
              float bb = max(b0, 2.0);
              float aOut = 4.0 / bb * (1.0 - sqrt(max(1.0 - bb * bb / (RFAR * RFAR), 0.0))) * (fromFar ? 1.0 : 0.5);
              vec3 toC = -Pnow; toC = normalize(toC - outDir * dot(toC, outDir) + 1e-6);
              outDir = rotAxis(outDir, normalize(cross(outDir, toC) + 1e-6), aOut);
            }
          }
        }
        vec3 skyDir = transpose(uRot) * fromKerr(outDir);
        skyDir.xz = -skyDir.xz; // face Gargantua against a dark, star-filled part of the far galaxy, as in the film
        col += T * textureLod(uSky, skyDir, 0.0).rgb * uSkyGain; // no mip blur under strong lensing
        col = mix(col, vec3(1.0), uWhite);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2000;
  const q = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const anchor = new THREE.Object3D(); // position + orientation of the hole (disk in local XZ plane)
  mesh.onBeforeRender = (r, s, cam) => {
    uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    uniforms.uCamWorld.value.copy(cam.matrixWorld);
    uniforms.uCamPos.value.copy(cam.position);
    anchor.updateMatrixWorld();
    anchor.getWorldPosition(uniforms.uBH.value);
    anchor.getWorldQuaternion(q).invert();
    uniforms.uRot.value.setFromMatrix4(m4.makeRotationFromQuaternion(q));
  };
  return { mesh, anchor, uniforms };
}
