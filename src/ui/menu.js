import { settings, setSetting, SCHEMA, resetSettings } from '../core/settings.js';

const LOCATIONS = [
  { id: 'earth', name: 'Earth Orbit', sub: '400 km · ISS · Hubble · the Endurance', desc: 'Real orbital mechanics around a real Earth. Rendezvous and dock with the Endurance, fly past the International Space Station and Hubble.', tag: 'ORBITAL MECHANICS' },
  { id: 'saturn', name: 'Saturn', sub: 'the rings · Cassini · the wormhole', desc: 'Skim the A ring between kilometre-sized ice boulders, visit Cassini, then dive into the wormhole.', tag: 'RINGS & WORMHOLE' },
  { id: 'gargantua', name: 'Gargantua', sub: 'Kerr black hole · Miller · Mann', desc: 'Fly anywhere around a spinning supermassive black hole. Watch your clock run slow. Try not to cross the horizon.', tag: 'RELATIVITY' },
];

const CONTROLS = [
  ['JOURNEY', [['1 – 5', 'Cinematic · Chase · Cockpit · Free orbit · Orbit Gargantua'], ['Space', 'Pause'], ['← / →', 'Seek ±10 s'], ['W A S D · Q E', 'Steer during the docking'], ['Space / E · Q', 'Spin-match the Endurance'], ['G', 'Movie / physical black hole'], ['H · M · F', 'HUD · mute · fullscreen'], ['Esc', 'Menu']]],
  ['FREE FLIGHT', [['Mouse', 'Pitch & yaw (click to capture the mouse)'], ['W / S', 'Main engines forward / retro'], ['A / D', 'Lateral RCS'], ['R / F', 'Vertical RCS'], ['Q / E', 'Roll'], ['Shift', 'Boost'], ['X', 'Match velocity with target'], ['Tab', 'Cycle target'], ['V', 'Flight assist on/off'], ['C', 'Camera: chase · cockpit · orbit · cinematic · target'], ['T', 'Time warp ×1 / ×10 / ×100'], ['Esc', 'Menu']]],
];

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export class Menu {
  constructor({ onJourney, onExplore, onResume, onMainMenu }) {
    this.cb = { onJourney, onExplore, onResume, onMainMenu };
    this.root = el('div', 'menu hidden'); this.root.id = 'menu';
    document.body.appendChild(this.root);
    this.mode = 'main';
    this.inGame = false;
  }
  show(screen = 'main') { this.root.classList.remove('hidden'); this.render(screen); this.visible = true; }
  hide() { this.root.classList.add('hidden'); this.visible = false; }

  render(screen) {
    this.screen = screen;
    const r = this.root; r.innerHTML = '';
    const panel = el('div', 'menu-panel');
    r.appendChild(panel);
    const back = (to) => { const b = el('button', 'menu-back', '← BACK'); b.onclick = () => this.render(to); panel.appendChild(b); };
    if (screen === 'main' || screen === 'pause') {
      panel.appendChild(el('div', 'menu-kicker', screen === 'pause' ? 'PAUSED' : 'A PRIVATE JOURNEY'));
      panel.appendChild(el('h1', 'menu-title', 'INTERSTELLAR<br/><span>ENDURANCE</span>'));
      const list = el('div', 'menu-list');
      const item = (title, sub, fn) => { const b = el('button', 'menu-item', `<div class="mi-t">${title}</div><div class="mi-s">${sub}</div>`); b.onclick = fn; list.appendChild(b); };
      if (screen === 'pause') item('RESUME', 'back to where you were', () => this.cb.onResume());
      item('THE JOURNEY', 'Earth → Saturn → Gargantua · 14 min 56 s, scored to your soundtrack', () => this.cb.onJourney());
      item('FREE FLIGHT', 'pilot a Ranger yourself · real physics · missions', () => this.render('locations'));
      item('SETTINGS', 'graphics · camera · flight · audio', () => this.render('settings'));
      item('CONTROLS', 'keyboard & mouse', () => this.render('controls'));
      if (screen === 'pause') item('MAIN MENU', 'leave this flight', () => this.cb.onMainMenu());
      panel.appendChild(list);
      panel.appendChild(el('div', 'menu-foot', 'Data: NASA/JPL Horizons · NASA fact sheets · NASA 3D Resources (ISS, Hubble, Cassini, Juno, Saturn V) · Solar System Scope textures (CC BY 4.0) · physics after K. Thorne'));
    } else if (screen === 'locations') {
      back(this.inGame ? 'pause' : 'main');
      panel.appendChild(el('div', 'menu-kicker', 'FREE FLIGHT'));
      panel.appendChild(el('h2', 'menu-h2', 'Choose a starting point'));
      const grid = el('div', 'loc-grid');
      for (const L of LOCATIONS) {
        const c = el('button', `loc-card loc-${L.id}`, `<div class="loc-tag">${L.tag}</div><div class="loc-name">${L.name}</div><div class="loc-sub">${L.sub}</div><div class="loc-desc">${L.desc}</div>`);
        c.onclick = () => this.cb.onExplore(L.id);
        grid.appendChild(c);
      }
      panel.appendChild(grid);
    } else if (screen === 'settings') {
      back(this.inGame ? 'pause' : 'main');
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
      back(this.inGame ? 'pause' : 'main');
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
