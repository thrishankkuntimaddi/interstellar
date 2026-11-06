const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.kicker = $('chapter-kicker');
    this.title = $('chapter-title');
    this.clock = $('mission-clock');
    this.tele = $('telemetry');
    this.log = $('log');
    this.camMode = $('cam-mode');
    this.card = $('title-card');
    this.timelineFill = $('timeline-fill');
    this.marks = $('timeline-marks');
    this.interact = $('interact');
    this.iTitle = $('interact-title'); this.iBody = $('interact-body'); this.iFill = $('interact-fill'); this.iHint = $('interact-hint');
    this.reticle = $('reticle'); this.targetBox = $('target-box');
    this.minimap = $('minimap'); this.mctx = this.minimap.getContext('2d');
    this.lbTop = document.querySelector('#letterbox .top'); this.lbBot = document.querySelector('#letterbox .bottom');
    this.visible = true;
    this._tele = ''; this._lines = new Map(); this._card = ''; this._lb = -1; this._teleT = 0;
  }
  show(v = true) { this.visible = v; this.el.classList.toggle('hidden', !v); }
  toggle() { this.show(!this.visible); }

  buildTimeline(chapters, duration, onSeek) {
    this.marks.innerHTML = '';
    for (const c of chapters) {
      const m = document.createElement('div'); m.className = 'm';
      m.style.left = `${(c.start / duration) * 100}%`;
      m.innerHTML = `<span>${c.title}</span>`;
      this.marks.appendChild(m);
    }
    $('timeline').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      onSeek(((e.clientX - r.left) / r.width) * duration);
    });
  }

  setChapter(ch) { this.kicker.textContent = ch.kicker; this.title.textContent = ch.title; }
  setProgress(t, duration) { this.timelineFill.style.width = `${(t / duration) * 100}%`; }
  setClock(text) { if (this.clock.textContent !== text) this.clock.textContent = text; }
  flashNote(text) { this._note = text; this._noteT = performance.now(); }
  setCamMode(text) {
    const note = this._note && performance.now() - this._noteT < 3500 ? `   ·   GARGANTUA: ${this._note}` : '';
    const s = `CAM · ${text}${note}`;
    if (this.camMode.textContent !== s) this.camMode.textContent = s;
  }

  setTelemetry(rows, source, now) {
    if (now - this._teleT < 0.08) return;
    this._teleT = now;
    const html = rows.map(([k, v, c]) => `<div class="row"><span class="k">${k}</span><span class="v ${c || ''}">${v}</span></div>`).join('') + (source ? `<div class="src">${source}</div>` : '');
    if (html !== this._tele) { this.tele.innerHTML = html; this._tele = html; }
  }

  /** logs: [t, who, text, dur] evaluated against local chapter time (seek-safe). */
  updateLogs(logs, lt, chapterId) {
    const active = new Set();
    for (const [t, who, text, dur = 5] of logs || []) {
      if (lt >= t && lt < t + dur) active.add(`${chapterId}|${t}|${who}|${text}`);
    }
    for (const [k, el] of this._lines) {
      if (!active.has(k)) { el.classList.remove('show'); setTimeout(() => el.remove(), 1200); this._lines.delete(k); }
    }
    for (const k of active) {
      if (this._lines.has(k)) continue;
      const [, , who, text] = k.split('|');
      const el = document.createElement('div'); el.className = 'line';
      el.innerHTML = (who ? `<span class="who">${who}</span>` : '') + text;
      this.log.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
      this._lines.set(k, el);
    }
  }

  updateCard(cards, lt) {
    let html = '';
    for (const [t0, t1, big, small] of cards || []) if (lt >= t0 && lt < t1) html = `<div class="big">${big}</div>${small ? `<div class="small">${small}</div>` : ''}`;
    if (html !== this._card) {
      this._card = html;
      if (html) { this.card.innerHTML = html; this.card.classList.add('show'); } else this.card.classList.remove('show');
    }
  }

  letterbox(amount) {
    const v = Math.round(amount * 100) / 100;
    if (v === this._lb) return; this._lb = v;
    const h = `${v * 11}vh`;
    this.lbTop.style.height = h; this.lbBot.style.height = h;
  }

  setInteract(state) {
    if (!state) { this.interact.classList.add('hidden'); this.reticle.classList.add('hidden'); return; }
    this.interact.classList.remove('hidden');
    this.iTitle.textContent = state.title; this.iBody.innerHTML = state.body; this.iHint.textContent = state.hint || '';
    this.iFill.style.width = `${Math.round(state.progress * 100)}%`;
    this.iFill.style.background = state.color || '';
    if (state.reticle) {
      this.reticle.classList.remove('hidden');
      this.targetBox.style.left = `${state.reticle.x * 100}%`;
      this.targetBox.style.top = `${state.reticle.y * 100}%`;
      this.targetBox.style.borderColor = state.reticle.ok ? '#8fe3c0' : '#ff7a4d';
    } else this.reticle.classList.add('hidden');
  }

  showMinimap(v) { this.minimap.classList.toggle('hidden', !v); }
}
