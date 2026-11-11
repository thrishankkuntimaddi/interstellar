import { settings, setSetting, SCHEMA, resetSettings } from '../core/settings.js';
import { career, rankInfo, unlocked, locationUnlocked, selectShip, resetCareer, ACHIEVEMENTS, RANKS } from '../game/career.js';
import { LOCATION_INFO, MISSIONS, CODEX, missionKey, locInfo } from '../game/missions.js';
import { SHIPS, shipDef } from '../world/fleet.js';
import { fmt } from '../data/astro.js';

const CONTROLS = [
  ['FLIGHT', [['Mouse', 'Pitch & yaw (click to capture the mouse)'], ['W / S', 'Main engines / retro thrust'], ['Shift', 'Boost (with W)'], ['A / D', 'Lateral RCS'], ['R / F', 'Vertical RCS'], ['Q / E', 'Roll'],
    ['[ / ]', 'Throttle hold −/+ 10 %'], ['Z · Backspace', 'Full throttle hold · cut'], ['X', 'Match velocity with the target'], ['V', 'Flight assist on/off'], ['U', 'Undock'], ['P', 'Restart from the starting orbit']]],
  ['AUTOPILOT & NAVIGATION', [['1 / 2', 'Hold orbital prograde / retrograde'], ['3 / 4', 'Hold toward / away from the target'], ['5', 'Hold radial out (away from the planet)'], ['6', 'Brake: hold retrograde relative to the target'], ['0', 'Autopilot off'],
    ['Tab', 'Cycle target'], ['B', 'Scan the target (codex + XP)'], ['M', 'Orbit map'], ['N', 'Nav computer: travel to another world'], ['T · , · .', 'Time warp ×1 / ×10 / ×100 / ×1000'], ['J', 'Next contract / free roam']]],
  ['VIEW & SYSTEMS', [['C', 'Camera: chase · cockpit · orbit · cinematic · target'], ['Mouse wheel', 'Zoom the chase camera'], ['L', 'Floodlights'], ['K', 'Photograph (saves a PNG)'], ['H', 'Hide / show the HUD'], ['G', 'Movie / physical black hole'], ['Esc', 'Menu']]],
  ['GAMEPAD', [['Left stick', 'Pitch & yaw'], ['Right stick', 'Lateral & vertical RCS'], ['RT / LT', 'Engines / retro'], ['LB / RB', 'Roll'], ['A · X', 'Boost · match velocity'], ['Y · B', 'Cycle target · camera'], ['D-pad', '↑↓ time warp · ←→ autopilot mode'], ['L3 · R3 · Back', 'Scan · lights · map']]],
  ['THE JOURNEY', [['1 – 5', 'Cinematic · Chase · Cockpit · Free orbit · Orbit Gargantua'], ['Space', 'Pause'], ['← / →', 'Seek ±10 s'], ['W A S D · Q E', 'Steer during the docking'], ['Space / E · Q', 'Spin-match the Endurance'], ['M · F', 'Mute · fullscreen']]],
];

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const stars = (n) => `<span class="stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
const pct = (v, max) => `<div class="stat-bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div>`;

export class Menu {
  constructor({ onJourney, onExplore, onResume, onMainMenu }) {
    this.cb = { onJourney, onExplore, onResume, onMainMenu };
    this.root = el('div', 'menu hidden'); this.root.id = 'menu';
    document.body.appendChild(this.root);
    this.inGame = false;
  }
  show(screen = 'main') { this.root.classList.remove('hidden'); this.render(screen); this.visible = true; }
  hide() { this.root.classList.add('hidden'); this.visible = false; }

  rankBadge() {
    const r = rankInfo();
    return `<div class="rank"><div class="rank-top"><b>${r.name}</b><span>${fmt.n(r.xp)} XP${r.next ? ` · ${fmt.n(r.nextXp - r.xp)} to ${r.next}` : ' · maximum rank'}</span></div><div class="rank-bar"><i style="width:${r.progress * 100}%"></i></div></div>`;
  }

  render(screen, arg) {
    this.screen = screen;
    const r = this.root; r.innerHTML = '';
    const panel = el('div', `menu-panel ${['locations', 'missions', 'hangar', 'pilot'].includes(screen) ? 'wide' : ''}`);
    r.appendChild(panel);
    const home = this.inGame ? 'pause' : 'main';
    const back = (to, a) => { const b = el('button', 'menu-back', '← BACK'); b.onclick = () => this.render(to, a); panel.appendChild(b); };
    if (screen === 'main' || screen === 'pause') {
      panel.appendChild(el('div', 'menu-kicker', screen === 'pause' ? 'PAUSED' : 'A PRIVATE JOURNEY'));
      panel.appendChild(el('h1', 'menu-title', 'INTERSTELLAR<br/><span>ENDURANCE</span>'));
      panel.appendChild(el('div', '', this.rankBadge()));
      const list = el('div', 'menu-list');
      const item = (title, sub, fn) => { const b = el('button', 'menu-item', `<div class="mi-t">${title}</div><div class="mi-s">${sub}</div>`); b.onclick = fn; list.appendChild(b); };
      if (screen === 'pause') item('RESUME', 'back to where you were', () => this.cb.onResume());
      const done = Object.keys(career.missions).length, total = Object.values(MISSIONS).reduce((a, m) => a + m.length, 0);
      item('FLIGHT OPERATIONS', `six worlds · ${done} / ${total} contracts flown · real orbital mechanics`, () => this.render('locations'));
      item('HANGAR', `${shipDef(career.ship).name} selected · ${SHIPS.filter((s) => unlocked(s.rank)).length} of ${SHIPS.length} spacecraft available`, () => this.render('hangar'));
      item('PILOT RECORD', `${Object.keys(career.ach).length} / ${Object.keys(ACHIEVEMENTS).length} achievements · ${Object.keys(career.codex).length} / ${Object.keys(CODEX).length} codex entries`, () => this.render('pilot'));
      item('THE JOURNEY', 'Earth → Saturn → Gargantua · the 14 min 56 s film, scored to your soundtrack', () => this.cb.onJourney());
      item('SETTINGS', 'graphics · camera · flight · gameplay · audio', () => this.render('settings'));
      item('CONTROLS', 'keyboard, mouse & gamepad', () => this.render('controls'));
      if (screen === 'pause') item('MAIN MENU', 'leave this flight', () => this.cb.onMainMenu());
      panel.appendChild(list);
      panel.appendChild(el('div', 'menu-foot', 'Data: NASA/JPL Horizons · NASA fact sheets · NASA 3D Resources (ISS, Hubble, Cassini, Juno, Saturn V) · Solar System Scope textures (CC BY 4.0) · physics after K. Thorne'));
    } else if (screen === 'locations') {
      back(home);
      panel.appendChild(el('div', 'menu-kicker', 'FLIGHT OPERATIONS'));
      panel.appendChild(el('h2', 'menu-h2', 'Choose a world'));
      const grid = el('div', 'loc-grid');
      for (const L of LOCATION_INFO) {
        const open = locationUnlocked(L), ms = MISSIONS[L.id] || [];
        const got = ms.reduce((a, m) => a + (career.missions[missionKey(L.id, m.id)]?.stars || 0), 0);
        const c = el('button', `loc-card loc-${L.id} ${open ? '' : 'locked'}`, `<div class="loc-tag">${L.tag}</div><div class="loc-name">${L.name}</div><div class="loc-sub">${L.sub}</div><div class="loc-desc">${L.desc}</div>
          <div class="loc-foot">${open ? `<span class="stars">★</span> ${got} / ${ms.length * 3}` : `LOCKED · reach ${RANKS[L.rank].name}${L.id === 'gargantua' ? ' or fly through the wormhole' : ''}`}</div>`);
        if (open) c.onclick = () => this.render('missions', L.id); else c.disabled = true;
        grid.appendChild(c);
      }
      panel.appendChild(grid);
    } else if (screen === 'missions') {
      const L = locInfo(arg);
      back('locations');
      panel.appendChild(el('div', 'menu-kicker', `${L.tag} · FLYING THE ${shipDef(career.ship).name}`));
      panel.appendChild(el('h2', 'menu-h2', L.name));
      const list = el('div', 'ms-list');
      const row = (title, brief, meta, fn) => { const b = el('button', 'ms-row', `<div class="ms-main"><div class="ms-t">${title}</div><div class="ms-b">${brief}</div></div><div class="ms-meta">${meta}</div>`); b.onclick = fn; list.appendChild(b); };
      for (const m of MISSIONS[L.id] || []) {
        const rec = career.missions[missionKey(L.id, m.id)];
        row(m.name.toUpperCase(), m.brief, `${stars(rec?.stars || 0)}<span>par ${fmt.time(m.par).slice(3)} · ${m.xp} XP</span>${rec ? `<span>best ${fmt.time(rec.time).slice(3)}</span>` : '<span>not flown</span>'}`, () => this.cb.onExplore(L.id, m.id));
      }
      row('FREE ROAM', 'No objectives, no clock. Explore, scan things, practise, take photographs.', '<span>sandbox</span>', () => this.cb.onExplore(L.id, null));
      panel.appendChild(list);
      const sw = el('button', 'menu-back', 'CHANGE SPACECRAFT'); sw.style.marginTop = '22px'; sw.onclick = () => this.render('hangar', L.id); panel.appendChild(sw);
    } else if (screen === 'hangar') {
      back(arg ? 'missions' : home, arg);
      panel.appendChild(el('div', 'menu-kicker', 'HANGAR'));
      panel.appendChild(el('h2', 'menu-h2', 'Choose your spacecraft'));
      const grid = el('div', 'ship-grid');
      for (const s of SHIPS) {
        const open = unlocked(s.rank), sel = career.ship === s.id;
        const c = el('button', `ship-card ${sel ? 'sel' : ''} ${open ? '' : 'locked'}`, `<div class="loc-tag">${open ? (sel ? 'SELECTED' : 'AVAILABLE') : `LOCKED · ${RANKS[s.rank].name}`}</div><div class="loc-name">${s.name}</div><div class="loc-sub">${s.cls}</div><div class="loc-desc">${s.desc}</div>
          <div class="stat"><span>THRUST</span>${pct(s.accel * s.boost, 2.4)}</div><div class="stat"><span>AGILITY</span>${pct(s.rate, 1.5)}</div><div class="stat"><span>RCS</span>${pct(s.rcs, 1.6)}</div>
          <div class="stat"><span>Δv ${fmt.n(s.dv / 1000, 1)} km/s</span>${pct(s.dv, 20000)}</div><div class="stat"><span>HULL</span>${pct(s.hull, 200)}</div><div class="stat"><span>HEAT SHIELD</span>${pct(s.heat, 5)}</div>`);
        if (open) c.onclick = () => { selectShip(s.id); this.render('hangar', arg); }; else c.disabled = true;
        grid.appendChild(c);
      }
      panel.appendChild(grid);
      if (this.inGame) panel.appendChild(el('div', 'menu-foot', 'A new spacecraft takes effect on your next launch.'));
    } else if (screen === 'pilot') {
      back(home);
      panel.appendChild(el('div', 'menu-kicker', 'PILOT RECORD'));
      panel.appendChild(el('div', '', this.rankBadge()));
      const st = career.stats;
      const cols = el('div', 'pilot-cols');
      const a = el('div'); a.appendChild(el('div', 'set-group', 'LOGBOOK'));
      for (const [k, v] of [['Flights', fmt.n(st.flights)], ['Time at the controls', fmt.time(st.time)], ['Distance flown', `${fmt.n(st.distance)} km`], ['Δv expended', `${fmt.n(st.dv / 1000, 1)} km/s`], ['Dockings', fmt.n(st.dockings)], ['Landings', fmt.n(st.landings)], ['Spacecraft lost', fmt.n(st.crashes)], ['Photographs', fmt.n(st.photos)]])
        a.appendChild(el('div', 'ctl-row', `<kbd>${v}</kbd><span>${k}</span>`));
      a.appendChild(el('div', 'set-group', 'CODEX'));
      for (const [id, [name, text]] of Object.entries(CODEX)) a.appendChild(el('div', `cx ${career.codex[id] ? '' : 'off'}`, career.codex[id] ? `<b>${name}</b>${text}` : '<b>UNKNOWN</b>fly close and scan it (B)'));
      const b = el('div'); b.appendChild(el('div', 'set-group', 'ACHIEVEMENTS'));
      for (const [id, [name, desc]] of Object.entries(ACHIEVEMENTS)) b.appendChild(el('div', `cx ${career.ach[id] ? 'got' : 'off'}`, `<b>${career.ach[id] ? '◆' : '◇'} ${name}</b>${desc}`));
      cols.append(a, b); panel.appendChild(cols);
      const reset = el('button', 'menu-back', 'RESET CAREER'); reset.style.marginTop = '22px';
      reset.onclick = () => { if (reset.dataset.arm) { resetCareer(); this.render('pilot'); } else { reset.dataset.arm = 1; reset.textContent = 'CLICK AGAIN TO ERASE ALL PROGRESS'; } };
      panel.appendChild(reset);
    } else if (screen === 'settings') {
      back(home);
      panel.appendChild(el('div', 'menu-kicker', 'SETTINGS'));
      const form = el('div', 'set-form');
      for (const f of SCHEMA) {
        if (f.group) { form.appendChild(el('div', 'set-group', f.group)); continue; }
        const row = el('label', 'set-row');
        row.appendChild(el('span', 'set-label', f.label));
        let input;
        if (f.type === 'toggle') { input = el('input'); input.type = 'checkbox'; input.checked = !!settings[f.key]; input.onchange = () => setSetting(f.key, input.checked); }
        else if (f.type === 'select') {
          input = el('select');
          for (const o of f.options) { const op = el('option', '', String(o).toUpperCase()); op.value = o; if (String(settings[f.key]) === String(o)) op.selected = true; input.appendChild(op); }
          input.onchange = () => { const v = isNaN(+input.value) ? input.value : +input.value; setSetting(f.key, v); if (f.key === 'preset') this.render('settings'); };
        } else {
          input = el('input'); input.type = 'range'; Object.assign(input, { min: f.min, max: f.max, step: f.step, value: settings[f.key] });
          const val = el('span', 'set-val', (+settings[f.key]).toFixed(2));
          input.oninput = () => { val.textContent = (+input.value).toFixed(2); setSetting(f.key, +input.value); };
          row.appendChild(input); row.appendChild(val); form.appendChild(row); continue;
        }
        row.appendChild(input); form.appendChild(row);
      }
      panel.appendChild(form);
      const reset = el('button', 'menu-back', 'RESET TO DEFAULTS'); reset.onclick = () => { resetSettings(); this.render('settings'); }; panel.appendChild(reset);
    } else if (screen === 'controls') {
      back(home);
      panel.classList.add('wide');
      panel.appendChild(el('div', 'menu-kicker', 'CONTROLS'));
      const cols = el('div', 'ctl-cols');
      for (const [title, rows] of CONTROLS) {
        const c = el('div', 'ctl-col'); c.appendChild(el('div', 'set-group', title));
        for (const [k, d] of rows) c.appendChild(el('div', 'ctl-row', `<kbd>${k}</kbd><span>${d}</span>`));
        cols.appendChild(c);
      }
      panel.appendChild(cols);
    }
  }
}
