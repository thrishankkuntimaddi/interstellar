// Pilot career: XP, ranks, unlocks, mission records, achievements, codex and lifetime stats.
// Stored per browser (localStorage, best-effort).
import { settings } from '../core/settings.js';

const KEY = 'interstellar-endurance.career.v1';

export const RANKS = [
  { name: 'CADET', xp: 0 },
  { name: 'PILOT', xp: 400 },
  { name: 'COMMANDER', xp: 1200 },
  { name: 'CAPTAIN', xp: 2600 },
  { name: 'EXPLORER', xp: 4800 },
  { name: 'PATHFINDER', xp: 8000 },
  { name: 'LEGEND', xp: 13000 },
];

export const ACHIEVEMENTS = {
  firstFlight: ['First Light', 'Start your first free flight'],
  firstDock: ['Hard Dock', 'Dock with a station'],
  softTouch: ['Feather Touch', 'Dock at under 0.1 m/s'],
  firstLanding: ['One Small Step', 'Land on Phobos'],
  scan5: ['Surveyor', 'Scan 5 different objects'],
  scanAll: ['Cartographer', 'Complete the codex'],
  wormhole: ['Through the Looking Glass', 'Traverse the wormhole'],
  horizon: ['No Return', 'Cross an event horizon'],
  isco: ['Daredevil', 'Survive a pass below 3 r_s'],
  lostYear: ['Stay', 'Lose a year to time dilation in one flight'],
  dryTanks: ['Running on Fumes', 'Run the tanks completely dry'],
  threeStar: ['Textbook', 'Earn three stars on a mission'],
  allMissions: ['Mission Control', 'Complete every mission'],
  allStars: ['Perfectionist', 'Three stars on every mission'],
  tourist: ['Grand Tour', 'Fly in every location'],
  transfer: ['Interplanetary', 'Use the nav computer to change worlds'],
  reentry: ['Fireball', 'Survive atmospheric heating'],
  photo: ['Pale Blue Dot', 'Take a photograph'],
  fleet: ['Test Pilot', 'Fly every spacecraft'],
  speed: ['Half Light', 'Exceed 0.5 c'],
  orbit: ['Go for Launch', 'Fly from the pad to orbit'],
  tesseract: ['The Bulk', 'Send the quantum data home from inside Gargantua'],
};

const fresh = () => ({ xp: 0, ship: 'ranger', missions: {}, ach: {}, codex: {}, visited: {}, flown: {}, unlockedLoc: {},
  stats: { flights: 0, time: 0, distance: 0, dockings: 0, landings: 0, crashes: 0, dv: 0, yearsLost: 0, photos: 0 } });

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!s) return fresh(); const f = fresh(); return { ...f, ...s, stats: { ...f.stats, ...(s.stats || {}) } }; } catch { return fresh(); }
}

export const career = load();
const listeners = new Set();
let dirty = false;
function save() { try { localStorage.setItem(KEY, JSON.stringify(career)); } catch { /* private mode */ } dirty = false; }
setInterval(() => { if (dirty) save(); }, 5000);
window.addEventListener('beforeunload', () => { if (dirty) save(); });

/** fn({type:'xp'|'rank'|'ach', ...}) */
export function onCareer(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (e) => listeners.forEach((fn) => fn(e));

export function rankIndex(xp = career.xp) { let i = 0; while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++; return i; }
export function rankInfo() {
  const i = rankIndex(), cur = RANKS[i], next = RANKS[i + 1];
  return { index: i, name: cur.name, xp: career.xp, next: next ? next.name : null, nextXp: next ? next.xp : null, progress: next ? (career.xp - cur.xp) / (next.xp - cur.xp) : 1 };
}
export const unlocked = (rank) => settings.sandbox || rankIndex() >= rank;
export const locationUnlocked = (L) => unlocked(L.rank) || !!career.unlockedLoc[L.id];

export function addXp(n, why = '') {
  if (n <= 0) return;
  const before = rankIndex();
  career.xp += Math.round(n);
  emit({ type: 'xp', amount: Math.round(n), why });
  const after = rankIndex();
  if (after > before) emit({ type: 'rank', name: RANKS[after].name });
  save();
}
export function award(id) {
  if (career.ach[id] || !ACHIEVEMENTS[id]) return;
  career.ach[id] = Date.now();
  emit({ type: 'ach', id, name: ACHIEVEMENTS[id][0], desc: ACHIEVEMENTS[id][1] });
  addXp(100, 'achievement');
}
export function stat(k, v = 1) { career.stats[k] = (career.stats[k] || 0) + v; dirty = true; }
export function mark(group, id) { if (!career[group][id]) { career[group][id] = 1; save(); return true; } return false; }
export function selectShip(id) { career.ship = id; save(); }

/** Record a mission result; returns { stars, xp, best } */
export function completeMission(key, { stars, time, xpBase }) {
  const prev = career.missions[key];
  const first = !prev;
  const gained = Math.round(xpBase * (0.5 + 0.25 * stars) * (first ? 1 : prev.stars < stars ? 0.5 : 0.15));
  career.missions[key] = { stars: Math.max(stars, prev?.stars || 0), time: Math.min(time, prev?.time ?? Infinity) };
  save();
  addXp(gained, 'mission');
  if (stars === 3) award('threeStar');
  return { stars, xp: gained, best: career.missions[key] };
}
export function resetCareer() { Object.assign(career, fresh()); save(); }
