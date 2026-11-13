import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { HUD } from './core/hud.js';
import { Soundtrack } from './core/audio.js';
import { CameraRig, MODES } from './core/camera.js';
import { settings, onSettings, setSetting } from './core/settings.js';
import { loadTextures } from './world/assets.js';
import { loadModels, MODELS } from './world/models.js';
import { bakeSkies, createMilkyWay, createOtherSky } from './world/sky.js';
import { makeEnv } from './core/util.js';
import { fetchEphemeris, fmt } from './data/astro.js';
import { setBlackHoleMode, BH_MODES, INSTANCES_UNIFORMS } from './world/blackhole.js';
import { Menu } from './ui/menu.js';
import { Explore } from './game/explore.js';
import { award, stat, selectShip } from './game/career.js';

import c01 from './chapters/c01_cosmos.js';
import c02 from './chapters/c02_launch.js';
import c03 from './chapters/c03_docking.js';
import c04 from './chapters/c04_cruise.js';
import c05 from './chapters/c05_saturn.js';
import c06 from './chapters/c06_transit.js';
import c07 from './chapters/c07_arrival.js';
import c08 from './chapters/c08_miller.js';
import c09 from './chapters/c09_mann.js';
import c10 from './chapters/c10_spin.js';
import c11 from './chapters/c11_gargantua.js';

const DEFS = [c01, c02, c03, c04, c05, c06, c07, c08, c09, c10, c11];
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const engine = new Engine($('gl'));
const hud = new HUD();
const audio = new Soundtrack(`${import.meta.env.BASE_URL}audio/interstellar-music.mp3`);
const rig = new CameraRig(engine.camera, $('gl'));

const input = {
  keys: new Set(),
  down(k) { return this.keys.has(k); },
  axis() {
    return {
      x: (this.down('d') ? 1 : 0) - (this.down('a') ? 1 : 0),
      y: (this.down('w') ? 1 : 0) - (this.down('s') ? 1 : 0),
      roll: (this.down('e') ? 1 : 0) - (this.down('q') ? 1 : 0),
      thrust: this.down(' ') || this.down('shift'),
    };
  },
};

const ctx = { engine, renderer: engine.renderer, hud, input, audio, eph: null, envOurs: null, envOther: null, menu: null };
const chapters = [];
let current = -1;
let state = 'loading'; // loading | menu | journey | explore
let last = performance.now();
let menuT = 0;
let explore = null;

function setLoad(p, msg) { $('load-fill').style.width = `${Math.round(p * 100)}%`; if (msg) $('load-status').textContent = msg; }

// ---------------- settings application ----------------
function applySettings(s, key) {
  engine.bloom.enabled = s.bloom;
  audio.el.volume = s.volume;
  setBlackHoleMode(s.bhLook);
  hud.show(s.hud && (state === 'journey' || state === 'explore'));
  if (explore) { explore.dom.f.classList.toggle('nohud', !s.hud); explore.dom.f.classList.toggle('nokeys', !s.keyHints); }
  $('log').style.display = s.subtitles ? '' : 'none';
  for (const u of INSTANCES_UNIFORMS()) u.uSteps.value = s.bhQuality;
  if (key === 'shadows') {
    const all = new Set(); for (const ch of chapters) for (const L of collectLayers(ch)) all.add(L.scene);
    for (const sc of all) sc.traverse((o) => { if (o.isLight && o.castShadow && o.shadow) { o.shadow.mapSize.set(s.shadows, s.shadows); o.shadow.map?.dispose(); o.shadow.map = null; } });
  }
}

async function boot() {
  setLoad(0.02, 'Querying NASA/JPL Horizons for today’s planetary positions…');
  const ephP = fetchEphemeris(new Date());
  const audioP = audio.load();
  await loadTextures(engine.renderer, (p, k) => setLoad(0.04 + p * 0.28, `Loading 4K planetary maps · ${k}`));
  await loadModels((p, k) => setLoad(0.32 + p * 0.1, `Loading NASA spacecraft · ${k}`));
  setLoad(0.43, 'Baking skies of two galaxies…');
  await new Promise((r) => setTimeout(r, 30));
  bakeSkies(engine.renderer);
  ctx.envOurs = makeEnv(engine.renderer, createMilkyWay({ gain: 1.5, stars: false }));
  ctx.envOther = makeEnv(engine.renderer, createOtherSky({ gain: 1.5, stars: false }));
  ctx.eph = await ephP;
  setLoad(0.5, `Ephemeris: ${ctx.eph.source}`);
  for (let i = 0; i < DEFS.length; i++) {
    const d = DEFS[i];
    setLoad(0.5 + (i / DEFS.length) * 0.3, `Building ${d.title}…`);
    await new Promise((r) => setTimeout(r, 10));
    const ch = d.build(ctx);
    Object.assign(ch, { id: d.id, kicker: d.kicker, title: d.title, start: d.start, end: d.end });
    chapters.push(ch);
  }
  setLoad(0.82, 'Compiling shaders (this happens once)…');
  const scenes = new Set();
  for (const ch of chapters) for (const L of collectLayers(ch)) scenes.add(L.scene);
  scenes.add(rig.cockpitScene);
  await engine.precompile([...scenes]);
  setLoad(0.97, 'Waiting for the soundtrack…');
  await audioP;
  setLoad(1, 'Ready.');
  hud.buildTimeline(chapters, audio.duration, (t) => audio.seek(t));
  explore = new Explore(ctx);
  ctx.menu = new Menu({
    onJourney: () => startJourney(0),
    onExplore: (id, mission) => startExplore(id, mission),
    onResume: () => resume(),
    onMainMenu: () => toMainMenu(),
  });
  onSettings(applySettings);
  state = 'menu';
  $('loader').style.opacity = 0; setTimeout(() => $('loader').remove(), 2100);
  const t0 = parseFloat(params.get('t') || '-1');
  if (params.get('ship')) selectShip(params.get('ship'));
  if (params.get('explore')) startExplore(params.get('explore'), params.get('mission'));
  else if (t0 >= 0) startJourney(t0);
  else ctx.menu.show('main');
  requestAnimationFrame(frame);
}

function collectLayers(ch) {
  const out = [], seen = new Set();
  const add = (L) => { if (L && L.scene && !seen.has(L.scene)) { seen.add(L.scene); out.push(L); } };
  (ch.layers || []).forEach(add); (ch.allLayers || []).forEach(add);
  return out;
}

// ---------------- state transitions ----------------
async function startJourney(t0 = 0) {
  if (explore?.active) explore.stop();
  ctx.menu.hide(); ctx.menu.inGame = true;
  state = 'journey'; current = -1;
  hud.show(settings.hud);
  audio.el.loop = false;
  audio.seek(t0);
  try { await audio.start(); } catch (e) { console.warn(e); }
}
async function startExplore(id, mission = null) {
  ctx.menu.hide(); ctx.menu.inGame = true;
  audio.el.pause();
  state = 'explore';
  hud.show(settings.hud);
  hud.updateLogs([], 0, ''); hud.updateCard([], 0); hud.setInteract(null); hud.letterbox(0);
  await explore.start(id, mission);
}
function pause() {
  if (state === 'journey') audio.el.pause();
  if (document.pointerLockElement) document.exitPointerLock();
  ctx.menu.show('pause');
}
function resume() {
  ctx.menu.hide();
  if (state === 'journey') audio.el.play();
}
function toMainMenu() {
  if (explore?.active) explore.stop();
  audio.el.pause();
  state = 'menu'; ctx.menu.inGame = false;
  hud.show(false); hud.letterbox(0); hud.setInteract(null);
  ctx.menu.show('main');
}
// 14:56 — the film ends at the horizon. The game does not: you keep falling, into the tesseract.
audio.el.addEventListener('ended', () => { if (state === 'journey') { engine.fx.uWhite.value = 1; startExplore('tesseract', 'data'); } });
document.addEventListener('pointerlockchange', () => {
  if (state === 'explore' && !document.pointerLockElement && !ctx.menu.visible && explore.cam.mode !== 2 && explore._wantPauseOnUnlock) pause();
  if (document.pointerLockElement) explore._wantPauseOnUnlock = true;
});

function chapterAt(t) { for (let i = chapters.length - 1; i >= 0; i--) if (t >= chapters[i].start) return i; return 0; }

const DEFAULT_FX = { fade: 0, flash: 0, white: 0, heat: 0, distort: 0, cold: 0, letterbox: 0.6, bloom: 0.7, exposure: 1, grain: 0.06, aberration: 0.0015, vignette: 0.9 };
const _sp = new THREE.Vector3();

function setSunFlare(sunDir, enabled) {
  const u = engine.fx;
  if (!sunDir || !enabled || !settings.flare) { u.uFlare.value = 0; return; }
  const cam = engine.camera;
  _sp.copy(cam.position).addScaledVector(sunDir, 1e4).project(cam);
  const ahead = cam.getWorldDirection(new THREE.Vector3()).dot(sunDir) > 0;
  u.uSun.value.set(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5);
  u.uFlare.value = ahead ? 1 : 0;
}

/** Save the frame that was just rendered (must run in the same task as the render). */
function savePhoto() {
  try {
    $('gl').toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `interstellar-${explore.locId}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      stat('photos'); award('photo'); explore.toast('PHOTOGRAPH SAVED', a.download, '#9fc4ff', 2500);
    }, 'image/png');
  } catch (e) { console.warn(e); }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!chapters.length) return;
  const u = engine.fx;

  if (state === 'explore') {
    if (!ctx.menu.visible) explore.update(dt);
    const L = explore.loc;
    Object.assign(u, {});
    u.uFade.value = explore.fade; u.uFlash.value = 0; u.uHeat.value = explore.heat * 0.75; u.uDistort.value = explore.heat * 0.15; u.uCold.value = 0;
    u.uWhite.value = Math.max(0, u.uWhite.value - dt * 0.6);
    u.uGrain.value = 0.05 * settings.grain; u.uAberration.value = 0.0012; u.uVignette.value = 0.85;
    engine.bloom.strength = 0.75; engine.renderer.toneMappingExposure = 1.0;
    if (L) setSunFlare(L.sunDir, L.units !== 'rs');
    engine.render(now / 1000);
    if (explore.wantShot) { explore.wantShot = false; savePhoto(); }
    engine.adaptQuality(dt, settings.resolution, settings.adaptive);
    return;
  }

  // journey (or the menu backdrop, which plays the opening slowly)
  let t;
  if (state === 'journey') t = audio.time;
  else { menuT += dt; t = 6 + (menuT * 0.5) % 34; }
  const idx = chapterAt(t);
  const ch = chapters[idx];
  if (idx !== current) { current = idx; hud.setChapter(ch); ch.enter?.(); rig._freeChapter = null; rig._first = true; }
  const lt = t - ch.start;
  ch.update(lt, dt, ctx);
  const modeName = rig.update(ch, lt, dt);
  ch.afterCamera?.(engine.camera);
  engine.setLayers(rig.explorerLayer ? [rig.explorerLayer] : [...(ch.layers || []), rig.cockpitLayer]);
  const fx = { ...DEFAULT_FX, ...(ch.fx ? ch.fx(lt) : {}) };
  const level = audio.sample();
  u.uFade.value = fx.fade; u.uFlash.value = fx.flash; u.uWhite.value = fx.white; u.uHeat.value = fx.heat;
  u.uDistort.value = fx.distort; u.uCold.value = fx.cold; u.uGrain.value = fx.grain * settings.grain; u.uAberration.value = fx.aberration; u.uVignette.value = fx.vignette;
  engine.bloom.strength = fx.bloom * (1 + level * 0.35);
  engine.renderer.toneMappingExposure = fx.exposure;
  setSunFlare(ch.sunDir, !ch.bhLayer && !rig.explorerLayer && idx !== 0 && ch.id !== 'transit');

  if (state === 'journey') {
    hud.letterbox(rig.mode === 0 && settings.letterbox ? fx.letterbox : 0);
    hud.setCamMode(modeName + (modeName !== MODES[rig.mode] ? `  (${MODES[rig.mode]} unavailable here)` : ''));
    hud.setProgress(t, audio.duration);
    hud.setClock(`${ch.clock ? ch.clock(lt) : 'JOURNEY'} · ${fmt.time(t).slice(3)} / ${fmt.time(audio.duration).slice(3)}${audio.paused ? ' · PAUSED' : ''}`);
    if (ch.telemetry) hud.setTelemetry(ch.telemetry(lt), ch.telemetrySource ? ch.telemetrySource(lt) : '', now / 1000);
    hud.updateLogs(ch.logs, lt, ch.id);
    hud.updateCard(ch.cards, lt);
    hud.setInteract(ch.interact ? ch.interact(lt, input, dt) : null);
    if (ch.minimap) { hud.showMinimap(true); ch.minimap(hud.mctx, lt); } else hud.showMinimap(false);
  }
  engine.render(t);
  if (state === 'journey' && !audio.paused) engine.adaptQuality(dt, settings.resolution, settings.adaptive);
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'tab' || k === ' ' || (state === 'explore' && (k === 'backspace' || k === "'" || k === '/'))) e.preventDefault();
  input.keys.add(k);
  if (state === 'loading') return;
  if (k === 'escape') {
    if (state === 'explore' && !ctx.menu.visible && explore.overlayOpen()) { explore.closeOverlays(); return; }
    if (ctx.menu.visible) { if (ctx.menu.inGame && (ctx.menu.screen === 'pause')) resume(); else if (ctx.menu.screen !== 'main' && ctx.menu.screen !== 'pause') ctx.menu.render(ctx.menu.inGame ? 'pause' : 'main'); }
    else if (state === 'journey' || state === 'explore') pause();
    return;
  }
  if (ctx.menu.visible) return;
  if (k === 'h') { setSetting('hud', !settings.hud); return; }
  if (state === 'explore' && k !== 'g') { explore.handleKey(k); return; }
  if (k === 'f' && state !== 'explore') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); return; }
  if (k === 'm') { audio.mute(); return; }
  if (k === 'g') { const next = settings.bhLook === 'movie' ? 'physical' : 'movie'; setSetting('bhLook', next); hud.flashNote(BH_MODES[next].label); return; }
  if (state === 'explore') { explore.handleKey(k); return; }
  if (state !== 'journey') return;
  if (k >= '1' && k <= '5') rig.setMode(+k - 1);
  else if (k === 'c') rig.setMode((rig.mode + 1) % 5);
  else if (k === ' ' && !(chapters[current]?.wantsSpace?.(audio.time - chapters[current].start))) audio.toggle();
  else if (k === 'arrowright') audio.seek(audio.time + 10);
  else if (k === 'arrowleft') audio.seek(audio.time - 10);
});
window.addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => input.keys.clear());

boot().catch((e) => { console.error(e); setLoad(1, 'Error: ' + e.message); });

// Debug handle for local testing
window.__journey = {
  audio, chapters, rig, engine, MODELS, get explore() { return explore; }, get state() { return state; },
  seek: (t) => audio.seek(t), pause: () => audio.el.pause(), startJourney, startExplore,
};
