import { settings } from '../core/settings.js';

/** Procedural engine/RCS sound: filtered noise shaped by throttle (no audio files needed). */
export class EngineSound {
  constructor(ctx) {
    this.ctx = ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown noise
    const white = ctx.createBuffer(1, len, ctx.sampleRate); const wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    const mk = (b) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s; };
    // main engine rumble
    this.rumble = mk(buf);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 90; this.lp.Q.value = 0.7;
    this.gMain = ctx.createGain(); this.gMain.gain.value = 0;
    this.rumble.connect(this.lp).connect(this.gMain);
    // RCS hiss
    this.hiss = mk(white);
    this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 2600; this.bp.Q.value = 0.9;
    this.gRcs = ctx.createGain(); this.gRcs.gain.value = 0;
    this.hiss.connect(this.bp).connect(this.gRcs);
    this.out = ctx.createGain(); this.out.gain.value = 1;
    this.gMain.connect(this.out); this.gRcs.connect(this.out); this.out.connect(ctx.destination);
  }
  set(main, rcs, boost = 0) {
    const t = this.ctx.currentTime, v = settings.sfx;
    this.gMain.gain.setTargetAtTime(main * (0.5 + boost * 0.5) * v, t, 0.08);
    this.lp.frequency.setTargetAtTime(70 + main * 160 + boost * 220, t, 0.1);
    this.gRcs.gain.setTargetAtTime(rcs * 0.08 * v, t, 0.03);
  }
  stop() { try { this.rumble.stop(); this.hiss.stop(); this.out.disconnect(); } catch { /* already stopped */ } }
}
