import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Renders a stack of scenes, each with its own near/far range, clearing depth between them.
 * This gives planet-scale backgrounds and metre-scale spacecraft in the same frame with no
 * z-fighting and no logarithmic-depth hacks.
 */
class LayeredRenderPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.layers = [];
    this.needsSwap = false;
    this.clearColor = new THREE.Color(0x000000);
  }
  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera;
    const near0 = cam.near, far0 = cam.far;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.setClearColor(this.clearColor, 1);
    renderer.autoClear = false;
    renderer.clear(true, true, true);
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i];
      if (!L || !L.scene || L.visible === false) continue;
      const c = L.camera || cam;
      if (c !== cam) c.aspect = cam.aspect;
      c.near = L.near; c.far = L.far;
      c.updateProjectionMatrix();
      if (i > 0) renderer.clearDepth();
      renderer.render(L.scene, c);
    }
    cam.near = near0; cam.far = far0;
    cam.updateProjectionMatrix();
    renderer.autoClear = true;
  }
}

// Replaces NaN/Inf (e.g. from pow() of tiny negatives on some GPUs) before bloom can smear them.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
      // max/min follow IEEE fmax/fmin: a NaN operand yields the other operand
      c = min(max(c, vec3(0.0)), vec3(3.0e4));
      gl_FragColor = vec4(c, 1.0); }`,
};

const CinemaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.9 },
    uAberration: { value: 0.0015 },
    uFade: { value: 0 },      // 0 = clear, 1 = black
    uFlash: { value: 0 },     // white flash
    uWhite: { value: 0 },     // fade to white
    uHeat: { value: 0 },      // red alarm tint
    uDistort: { value: 0 },   // lens barrel distortion (e.g. tidal / transit)
    uCold: { value: 0 },      // desaturated cold grade
    uSun: { value: new THREE.Vector2(-9, -9) }, // sun position in uv (lens flare)
    uFlare: { value: 0 },     // flare strength
    uGrade: { value: 1 },     // film colour grade amount
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uAberration, uFade, uFlash, uWhite, uHeat, uDistort, uCold, uFlare, uGrade;
    uniform vec2 uRes, uSun; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      uv = 0.5 + c * (1.0 + uDistort * r2 * 1.8);
      vec2 dir = c * uAberration * (1.0 + 4.0*r2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;
      // lens flare: occlusion is read straight from the frame (a hidden sun leaves no bright pixels)
      if (uFlare > 0.001){
        vec2 asp = vec2(uRes.x / uRes.y, 1.0);
        vec3 sunC = texture2D(tDiffuse, clamp(uSun, 0.001, 0.999)).rgb;
        float vis = smoothstep(0.75, 0.98, dot(sunC, vec3(0.333))) * step(0.0, uSun.x) * step(uSun.x, 1.0) * step(0.0, uSun.y) * step(uSun.y, 1.0);
        float k = vis * uFlare;
        if (k > 0.001){
          vec2 d = (vUv - uSun) * asp; float r = length(d);
          float ang = atan(d.y, d.x);
          float star = pow(abs(cos(ang * 3.0)), 220.0) + pow(abs(cos(ang * 3.0 + 0.52)), 400.0) * 0.6;
          vec3 f = vec3(1.0, 0.92, 0.8) * (star * exp(-r * 5.0) * 0.9 + exp(-r * 18.0) * 0.6);
          f += vec3(0.6, 0.75, 1.0) * exp(-pow((r - 0.28) * 22.0, 2.0)) * 0.05; // halo ring
          vec2 axis = (vec2(0.5) - uSun);
          for (int i = 0; i < 6; i++){
            float t = float(i) * 0.37 + 0.45;
            vec2 gp = uSun + axis * t * 2.0;
            float gr = length((vUv - gp) * asp);
            float size = 0.018 + float(i) * 0.012;
            vec3 tint = mix(vec3(0.35, 0.55, 1.0), vec3(1.0, 0.55, 0.25), fract(float(i) * 0.61));
            f += tint * smoothstep(size, size * 0.7, gr) * 0.05 * (i == 2 ? 2.0 : 1.0);
          }
          f += vec3(1.0, 0.85, 0.6) * exp(-abs(d.y) * 90.0) * exp(-abs(d.x) * 2.5) * 0.12; // horizontal streak
          col += f * k;
        }
      }
      // subtle film grade: cool shadows, warm highlights, gentle S-curve
      { float lg = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 graded = col * mix(vec3(0.95, 1.0, 1.06), vec3(1.05, 1.0, 0.94), smoothstep(0.1, 0.8, lg));
        graded = mix(graded, graded * graded * (3.0 - 2.0 * graded), 0.18);
        col = mix(col, graded, uGrade); }
      // cold grade (Mann's planet) and heat alarm
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(0.86, 0.95, 1.08), uCold * 0.6);
      col = mix(col, col * vec3(1.35, 0.55, 0.42) + vec3(0.04, 0.0, 0.0), uHeat);
      // vignette
      float v = smoothstep(0.95, 0.2, length(c * vec2(uRes.x/uRes.y, 1.0)) * 0.85);
      col *= mix(1.0, v, uVignette);
      // film grain (luma-weighted)
      float g = hash(vUv * uRes + fract(uTime * 7.13) * 100.0) - 0.5;
      col += g * uGrain * (0.35 + 0.65 * (1.0 - l));
      col = mix(col, vec3(1.0), clamp(uWhite, 0.0, 1.0));
      col += uFlash;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1e6);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.layered = new LayeredRenderPass(this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.7, 0.55, 0.82);
    this.output = new OutputPass();
    this.cinema = new ShaderPass(CinemaShader);
    this.composer.addPass(this.layered);
    this.sanitize = new ShaderPass(SanitizeShader);
    for (const p of [this.sanitize, this.cinema]) { p.material.depthTest = false; p.material.depthWrite = false; }
    this.composer.addPass(this.sanitize);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.cinema);
    this.cinema.uniforms.uRes.value.set(size.x, size.y);

    window.addEventListener('resize', () => this.resize());
  }

  get fx() { return this.cinema.uniforms; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.cinema.uniforms.uRes.value.set(size.x, size.y);
  }

  setLayers(layers) { this.layered.layers = layers; }

  /** Dynamic resolution: trade pixels for a steady frame rate (the Kerr ray tracer is per-pixel). */
  setPixelRatio(pr) {
    if (Math.abs(this.renderer.getPixelRatio() - pr) < 0.01) return;
    this.renderer.setPixelRatio(pr); this.composer.setPixelRatio(pr); this.resize();
  }
  adaptQuality(dt, max = 1.5, enabled = true) {
    if (!enabled) { this.setPixelRatio(max); return; }
    this._acc = (this._acc || 0) + dt; this._n = (this._n || 0) + 1;
    if (this._acc < 1.5) return;
    const fps = this._n / this._acc; this._acc = 0; this._n = 0;
    let pr = this.renderer.getPixelRatio();
    if (fps < 45 && pr > 0.6) pr = Math.max(0.6, pr - 0.15);
    else if (fps > 57 && pr < max) pr = Math.min(max, pr + 0.1);
    else return;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.resize();
  }

  render(time) {
    this.cinema.uniforms.uTime.value = time;
    this.composer.render();
  }

  /** Compile every material in a set of scenes up front so the journey never hitches. */
  async precompile(scenes) {
    for (const s of scenes) {
      try { await this.renderer.compileAsync(s, this.camera); } catch (e) { this.renderer.compile(s, this.camera); }
    }
  }
}
