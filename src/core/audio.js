/** Music is the master clock: every scene is a pure function of audio.currentTime. */
export class Soundtrack {
  constructor(src) {
    this.el = new Audio(src);
    this.el.preload = 'auto';
    this.el.crossOrigin = 'anonymous';
    this.ctx = null; this.analyser = null; this.data = null;
    this.level = 0; this.duration = 895.92;
    this.el.addEventListener('loadedmetadata', () => { if (isFinite(this.el.duration)) this.duration = this.el.duration; });
  }
  load() {
    return new Promise((res) => {
      if (this.el.readyState >= 3) return res();
      const done = () => res();
      this.el.addEventListener('canplaythrough', done, { once: true });
      this.el.addEventListener('error', done, { once: true });
      setTimeout(done, 15000);
      this.el.load();
    });
  }
  async start() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaElementSource(this.el);
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512; this.analyser.smoothingTimeConstant = 0.85;
      this.gain = this.ctx.createGain();
      src.connect(this.analyser); this.analyser.connect(this.gain); this.gain.connect(this.ctx.destination);
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
    }
    await this.ctx.resume();
    await this.el.play();
  }
  get time() { return this.el.currentTime; }
  get paused() { return this.el.paused; }
  toggle() { if (this.el.paused) this.el.play(); else this.el.pause(); }
  seek(t) { this.el.currentTime = Math.max(0, Math.min(this.duration - 0.1, t)); }
  mute() { this.el.muted = !this.el.muted; }
  sample() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.data);
    let s = 0; for (let i = 2; i < 64; i++) s += this.data[i];
    const v = s / (62 * 255);
    this.level += (v - this.level) * 0.1;
    return this.level;
  }
}
