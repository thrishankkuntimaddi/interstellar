import * as THREE from 'three';
import { createMilkyWay, createOtherSky } from '../world/sky.js';

/**
 * A layer with its own camera that mirrors the main camera's orientation but lives at a
 * different scale and origin — a floating origin for planet-scale scenery behind metre-scale ships.
 */
export class ScaledLayer {
  constructor({ near = 1, far = 1e7, scale = 0.001 } = {}) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, near, far);
    this.near = near; this.far = far; this.scale = scale;
    this.origin = new THREE.Vector3(); // ship (fg origin) position in layer units
    this.basis = new THREE.Quaternion(); // orientation of the fg frame inside this layer
    this.visible = true;
  }
  sync(main) {
    this.camera.quaternion.copy(main.quaternion).premultiply(this.basis);
    this.camera.position.copy(main.position).multiplyScalar(this.scale).applyQuaternion(this.basis).add(this.origin);
    this.camera.fov = main.fov; this.camera.aspect = main.aspect;
    this.camera.updateMatrixWorld();
  }
}

export function skyLayer(kind = 'ours', gain = 1) {
  const L = { scene: new THREE.Scene(), near: 1, far: 5000, visible: true };
  L.sky = kind === 'ours' ? createMilkyWay({ gain }) : createOtherSky({ gain });
  L.scene.add(L.sky);
  return L;
}

/** Foreground scene for spacecraft: hard sunlight, faint fill, PMREM reflections. */
export function shipScene({ sunDir, env, intensity = 3.4, ambient = 0.12, shadow = true, shadowSize = 60 }) {
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.6;
  // soft photographic fill that follows the camera, so hulls in shadow keep their detail
  const fill = new THREE.DirectionalLight(0xcfd8e6, 0.35);
  fill.onBeforeShadow = null;
  scene.add(fill, fill.target);
  scene.onBeforeRender = (r, s, cam) => { fill.position.copy(cam.position); fill.target.position.copy(cam.position).add(cam.getWorldDirection(fill.target.position.clone()).multiplyScalar(10)); fill.target.updateMatrixWorld(); };
  const sun = new THREE.DirectionalLight(0xfff3e4, intensity);
  sun.position.copy(sunDir).multiplyScalar(200);
  if (shadow) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = c.bottom = -shadowSize; c.right = c.top = shadowSize; c.near = 1; c.far = 500;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  }
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x8fa6c8, 0x1a1612, ambient);
  scene.add(hemi);
  scene.userData = { sun, hemi };
  return scene;
}

/** Point the shadow camera of a directional light at a target. */
export function aimSun(scene, sunDir, target = new THREE.Vector3()) {
  const s = scene.userData.sun;
  s.target.position.copy(target);
  s.position.copy(target).addScaledVector(sunDir, 200);
  s.target.updateMatrixWorld();
}

/** Text sprite for labels in maps. */
export function labelSprite(text, { size = 1, color = '#e8ecef', font = '300 44px Inter, sans-serif' } = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d'); g.font = font; g.fillStyle = color; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase().split('').join(String.fromCharCode(8202)), 8, 48);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
  s.center.set(0, 0.5);
  s.scale.set(0.16 * size, 0.03 * size, 1);
  s.renderOrder = 100;
  return s;
}

/** Sun glare that sits at infinity in a given direction (follows the layer camera). */
export function skySun(layer, dir, { size = 60, intensity = 30 } = {}) {
  const s = createSunSprite({ size, intensity });
  s.onBeforeRender = (r, sc, cam) => { s.position.copy(cam.position).addScaledVector(dir, 900); s.updateMatrixWorld(); };
  layer.scene.add(s);
  return s;
}
import { createSun as createSunSprite } from '../world/planets.js';
import { keplerPosition as _kp } from '../data/astro.js';

/**
 * Top-down orrery on the HUD minimap: real orbits, live planet positions, the ship's path.
 * progress 0..1 runs the ship from Earth to Saturn along a transfer arc.
 */
export function drawOrrery(g, eph, progress, { label = '', showShip = true } = {}) {
  const W = g.canvas.width, H = g.canvas.height, cx = W / 2, cy = H / 2;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(cx, cy, W / 2 - 2, 0, 7); g.fill();
  g.strokeStyle = 'rgba(232,236,239,0.18)'; g.stroke();
  const sc = (W / 2 - 14) / 10.2; // Saturn orbit fits
  const keys = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'];
  const cols = { mercury: '#b8b0a6', venus: '#e8cf9c', earth: '#7fb2ff', mars: '#e07a52', jupiter: '#e3c49a', saturn: '#f0dca6' };
  for (const k of keys) {
    const a = eph.positions[k].a || _kp(k).a;
    g.strokeStyle = 'rgba(232,236,239,0.12)'; g.beginPath(); g.arc(cx, cy, a * sc, 0, 7); g.stroke();
  }
  // belt
  g.strokeStyle = 'rgba(200,180,150,0.10)'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, 2.7 * sc, 0, 7); g.stroke(); g.lineWidth = 1;
  g.fillStyle = '#fff4d0'; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
  for (const k of keys) {
    const p = eph.positions[k];
    g.fillStyle = cols[k]; g.beginPath(); g.arc(cx + p.x * sc, cy - p.y * sc, k === 'jupiter' || k === 'saturn' ? 3 : 2, 0, 7); g.fill();
  }
  // transfer arc Earth -> Saturn
  const e = eph.positions.earth, s = eph.positions.saturn;
  const a0 = Math.atan2(e.y, e.x); let a1 = Math.atan2(s.y, s.x); while (a1 < a0) a1 += Math.PI * 2;
  const r0 = Math.hypot(e.x, e.y), r1 = Math.hypot(s.x, s.y);
  const at = (u) => { const a = a0 + (a1 - a0) * u; const r = r0 + (r1 - r0) * Math.pow(u, 0.8); return [cx + Math.cos(a) * r * sc, cy - Math.sin(a) * r * sc]; };
  g.strokeStyle = 'rgba(255,212,154,0.5)'; g.setLineDash([3, 3]); g.beginPath();
  for (let i = 0; i <= 60; i++) { const [x, y] = at(i / 60); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.setLineDash([]);
  if (showShip) {
    const [x, y] = at(Math.max(0, Math.min(1, progress)));
    g.fillStyle = '#ffd49a'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,212,154,0.6)'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke();
  }
  g.fillStyle = 'rgba(232,236,239,0.6)'; g.font = '9px JetBrains Mono, monospace';
  g.fillText('SOLAR SYSTEM · LIVE EPHEMERIS', 18, H - 18);
  if (label) g.fillText(label, 18, H - 30);
}
