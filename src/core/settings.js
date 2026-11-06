// Persistent user settings with graphics presets. Stored per browser (localStorage, best-effort).
const KEY = 'interstellar-endurance.settings.v2';

export const PRESETS = {
  low:    { resolution: 0.7,  shadows: 1024, bhQuality: 0.7,  bloom: true, flare: false, grain: 0.6, adaptive: true,  earth8k: false },
  medium: { resolution: 1.0,  shadows: 2048, bhQuality: 0.85, bloom: true, flare: true,  grain: 0.8, adaptive: true,  earth8k: false },
  high:   { resolution: 1.25, shadows: 2048, bhQuality: 1.0,  bloom: true, flare: true,  grain: 1.0, adaptive: true,  earth8k: false },
  ultra:  { resolution: 1.5,  shadows: 4096, bhQuality: 1.3,  bloom: true, flare: true,  grain: 1.0, adaptive: false, earth8k: true },
};

const DEFAULTS = {
  preset: 'high', ...PRESETS.high,
  fov: 50, mouseSens: 1.0, invertY: false, volume: 0.9, sfx: 0.7,
  hud: true, letterbox: true, shake: 1.0, subtitles: true, bhLook: 'movie', flightAssist: true,
};

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s ? { ...DEFAULTS, ...s } : { ...DEFAULTS }; } catch { return { ...DEFAULTS }; }
}

export const settings = load();
const listeners = new Set();
export function onSettings(fn) { listeners.add(fn); fn(settings); return () => listeners.delete(fn); }
export function setSetting(k, v) {
  settings[k] = v;
  if (k === 'preset' && PRESETS[v]) Object.assign(settings, PRESETS[v]);
  else if (k in PRESETS.high) settings.preset = 'custom';
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  listeners.forEach((fn) => fn(settings, k));
}
export function resetSettings() { Object.assign(settings, DEFAULTS); setSetting('preset', 'high'); }

/** Settings UI schema (rendered by the menu). */
export const SCHEMA = [
  { group: 'GRAPHICS' },
  { key: 'preset', label: 'Quality preset', type: 'select', options: ['low', 'medium', 'high', 'ultra', 'custom'] },
  { key: 'resolution', label: 'Resolution scale', type: 'range', min: 0.5, max: 2, step: 0.05 },
  { key: 'adaptive', label: 'Dynamic resolution (holds 60 fps)', type: 'toggle' },
  { key: 'shadows', label: 'Shadow map', type: 'select', options: [1024, 2048, 4096] },
  { key: 'bhQuality', label: 'Black hole ray-tracing quality', type: 'range', min: 0.5, max: 2, step: 0.05 },
  { key: 'bloom', label: 'Bloom', type: 'toggle' },
  { key: 'flare', label: 'Lens flares', type: 'toggle' },
  { key: 'grain', label: 'Film grain', type: 'range', min: 0, max: 2, step: 0.05 },
  { key: 'earth8k', label: '8K Earth texture (next load)', type: 'toggle' },
  { group: 'CAMERA & HUD' },
  { key: 'fov', label: 'Field of view (free flight)', type: 'range', min: 35, max: 90, step: 1 },
  { key: 'shake', label: 'Camera shake', type: 'range', min: 0, max: 1.5, step: 0.05 },
  { key: 'letterbox', label: 'Cinematic letterbox', type: 'toggle' },
  { key: 'hud', label: 'Show HUD', type: 'toggle' },
  { key: 'subtitles', label: 'Radio dialogue', type: 'toggle' },
  { key: 'bhLook', label: 'Gargantua', type: 'select', options: ['movie', 'physical'] },
  { group: 'FLIGHT' },
  { key: 'mouseSens', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05 },
  { key: 'invertY', label: 'Invert pitch', type: 'toggle' },
  { key: 'flightAssist', label: 'Flight assist (rotation damping)', type: 'toggle' },
  { group: 'AUDIO' },
  { key: 'volume', label: 'Music', type: 'range', min: 0, max: 1, step: 0.01 },
  { key: 'sfx', label: 'Engine & effects', type: 'range', min: 0, max: 1, step: 0.01 },
];
