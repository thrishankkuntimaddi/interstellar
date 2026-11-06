import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const seg = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t) => t * t * t;
export const sseg = (t, t0, t1) => smoother(seg(t, t0, t1));
/** bump: 0 outside [t0,t3], ramps up over [t0,t1], holds, ramps down over [t2,t3] */
export const bump = (t, t0, t1, t2, t3) => smooth(seg(t, t0, t1)) * (1 - smooth(seg(t, t2, t3)));

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();

/** Pick the active shot from a sorted list of [startTime, fn(localT, u, cam)] entries. */
export function runShots(lt, shots, cam, end) {
  let i = shots.length - 1;
  while (i > 0 && lt < shots[i][0]) i--;
  const t0 = shots[i][0];
  const t1 = i + 1 < shots.length ? shots[i + 1][0] : end;
  shots[i][1](lt - t0, clamp((lt - t0) / Math.max(0.001, t1 - t0)), cam);
  return i;
}

/** Catmull-Rom path helper. */
export function path(points) { return new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : V(...p))), false, 'centripetal'); }

export function lookAt(cam, pos, target, up = null) {
  cam.position.copy(pos);
  if (up) cam.up.copy(up); else cam.up.set(0, 1, 0);
  cam.lookAt(target);
}

/** Deterministic pseudo-random shake (seekable). */
export function shake(cam, t, amp, freq = 18) {
  if (amp <= 0) return;
  const n = (s) => Math.sin(t * freq * s + s * 13.1) * Math.sin(t * freq * 0.37 * s + s * 7.7);
  _v.set(n(1.1), n(1.7), n(2.3)).multiplyScalar(amp);
  cam.position.add(_v);
  cam.rotateZ(n(0.9) * amp * 0.02);
  cam.rotateX(n(1.3) * amp * 0.01);
}

export function sunLight(dir, intensity = 3.2, color = 0xfff4e8) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.copy(dir).multiplyScalar(100);
  return l;
}

export function makeEnv(renderer, skyGroup) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.add(skyGroup);
  s.add(new THREE.HemisphereLight(0x8899aa, 0x222222, 0.6));
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}
