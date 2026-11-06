import { settings } from '../core/settings.js';
import * as THREE from 'three';

export const TEX = {};

const LIST = {
  milkyway: '8k_stars_milky_way.jpg',
  earthDay: settings.earth8k ? '8k_earth_daymap.jpg' : '4k_earth_daymap.jpg',
  earthClouds: '4k_earth_clouds.jpg',
  earthLights: '4k_earth_nightmap.jpg',
  earthNormal: '4k_earth_normal_map.jpg',
  earthSpec: '4k_earth_specular_map.jpg',
  moon: '4k_moon.jpg',
  mars: '4k_mars.jpg',
  jupiter: '4k_jupiter.jpg',
  saturn: '4k_saturn.jpg',
  saturnRing: '2k_saturn_ring_alpha.png',
  neptune: '2k_neptune.jpg',
  sun: '2k_sun.jpg',
};
const LINEAR = new Set(['earthNormal', 'earthSpec', 'saturnRing', 'earthClouds']);

export function loadTextures(renderer, onProgress) {
  const loader = new THREE.TextureLoader();
  const keys = Object.keys(LIST);
  let done = 0;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  return Promise.all(keys.map((k) => new Promise((resolve) => {
    loader.load(`${import.meta.env.BASE_URL}textures/${LIST[k]}`, (t) => {
      t.colorSpace = LINEAR.has(k) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      t.wrapS = THREE.RepeatWrapping;
      TEX[k] = t;
      onProgress?.(++done / keys.length, k);
      resolve();
    }, undefined, () => {
      // Missing texture: neutral fallback so the journey still runs.
      const c = document.createElement('canvas'); c.width = c.height = 4;
      const g = c.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, 4, 4);
      TEX[k] = new THREE.CanvasTexture(c);
      onProgress?.(++done / keys.length, k);
      resolve();
    });
  })));
}
