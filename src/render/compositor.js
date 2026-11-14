// The compositor: shadow pass (on sun change) -> base pass (on state change) -> composite pass (every frame).
import { createProgram, drawFullscreen, createTarget, bindTarget } from './gl.js';
import { SHADOW_FS, BASE_FS, COMPOSITE_FS } from './shaders.js';
import { blendState, sunDirection, skyColors, mix3, clamp, sstep, lerp, SEASONS } from '../engine/blend.js';
import { loadPhoto, disposePhoto, photoReady } from '../engine/scene.js';

const SEASON_PHOTO = { spring: 'spring', summer: 'master', autumn: 'autumn', winter: 'winter-snow' };

export class Compositor {
  constructor(gl, scene) {
    this.gl = gl; this.scene = scene;
    const [W, H] = scene.size; this.W = W; this.H = H;
    this.pShadow = createProgram(gl, SHADOW_FS, { target: true });
    this.pBase = createProgram(gl, BASE_FS, { target: true });
    this.pComp = createProgram(gl, COMPOSITE_FS);
    this.base = createTarget(gl, W, H);
    this.shadow = createTarget(gl, Math.round(W / 2), Math.round(H / 2));
    this.prevKey = ''; this.prevSunKey = ''; this.baseRenders = 0; this.shadowRenders = 0;
    this.shadowSteps = 30; this.maxPhotos = 12;
    this.view = { cov: [0, 0, 1, 1], zoom: 1.03, par: [0, 0] };
    this.blend = null;
  }
  /** Which photographs the current state needs; streams them in and reports what is ready. */
  requestPhotos(season, tod) {
    const s = this.scene, want = new Set(['master']);
    for (const k of SEASONS) if (season[k] > 0.001 && s.photos[SEASON_PHOTO[k]]) want.add(SEASON_PHOTO[k]);
    if (tod.cover > 0.001) want.add('winter-snow');
    if (tod.nightish) { want.add('night'); if (tod.cover > 0.001) want.add('winter-night'); if (tod.wetAutumn) want.add('rain-night'); }
    if (tod.dawnish) { want.add('dawn-golden'); want.add('dawn-bluehour'); }
    if (tod.duskish) { want.add('evening-golden'); want.add('evening-bluehour'); }
    if (tod.foggyAutumn) want.add('fog');
    const now = performance.now();
    for (const id of want) { const p = s.photos[id]; if (!p) continue; p.lastUsed = now; if (p.state === 'idle') loadPhoto(this.gl, s, id); }
    // keep GPU memory bounded: drop the least recently used photos beyond the budget
    const ready = Object.values(s.photos).filter(p => p.state === 'ready');
    if (ready.length > this.maxPhotos) { ready.sort((a, b) => a.lastUsed - b.lastUsed); for (const p of ready.slice(0, ready.length - this.maxPhotos)) if (!want.has(p.id)) disposePhoto(this.gl, s, p.id); }
    const has = {}; for (const id of Object.keys(s.photos)) has[id] = photoReady(s, id);
    for (const id of ['night', 'winter-night', 'rain-night', 'fog', 'dawn-golden', 'dawn-bluehour', 'evening-golden', 'evening-bluehour', 'spring']) if (!(id in has)) has[id] = false;
    return has;
  }
  photo(id, fallback) { const p = this.scene.photos[id]; return p && p.state === 'ready' ? p.tex : fallback; }

  /** state: { sun:{elevation, azimuth}, morning, season, env }, time in seconds. Renders to the canvas. */
  render(state, time, opts = {}) {
    const gl = this.gl, s = this.scene, cam = s.cfg.camera, { W, H } = this;
    const { sun, morning, season, env } = state, alt = sun.elevation;
    const has = this.requestPhotos(season, {
      cover: Math.max(season.winter, env.cover), nightish: alt < 4 || true, dawnish: morning && alt < 20 && alt > -16, duskish: !morning && alt < 20 && alt > -16,
      wetAutumn: season.autumn > 0.01 && env.wet > 0.05, foggyAutumn: season.autumn > 0.01 && env.fog > 0.02,
    });
    const b = this.blend = blendState({ sun, morning, season, env, has, refSun: s.cfg.referenceSun });
    const master = this.photo('master', s.black);
    const sunW = sunDirection(sun.azimuth, Math.max(alt, 1.5)), refW = sunDirection(s.cfg.referenceSun.azimuth, s.cfg.referenceSun.altitude);
    const castStrength = clamp(b.sunVis * b.relight) * 0.8 * sstep(-0.5, 3, alt);

    // ---- 1. cast shadows (only when the sun moved) ----
    const sunKey = castStrength > 0.01 ? sunW.map(v => v.toFixed(3)).join() + this.shadowSteps : 'off';
    if (sunKey !== this.prevSunKey && sunKey !== 'off') {
      const ct = Math.cos(cam.pitchRad), st = Math.sin(cam.pitchRad);
      const sc = [sunW[0], -sunW[1] * ct + sunW[2] * st, -sunW[1] * st - sunW[2] * ct];
      bindTarget(gl, this.shadow);
      this.pShadow.use().tex('tGeo', s.tex.geo).set('uSunCam', sc).set('uCam', [cam.focalPx, W / 2, H / 2, cam.z0]).set('uSize', [W, H]).set('uInvScale', cam.invDepthScale).set('uSteps', this.shadowSteps);
      drawFullscreen(gl); this.shadowRenders++;
    }
    if (sunKey !== 'off') this.prevSunKey = sunKey;

    // ---- 2. base (only when the photographic state changed) ----
    const sIdx = n => SEASONS.indexOf(n);
    const ref = skyColors(40), sunY = (cam.horizonY - alt * cam.focalPx * Math.PI / 180) / H;
    const discVis = b.sunVis * sstep(-1, 1.5, alt) * (b.sunX > -0.05 && b.sunX < 1.05 ? 1 : 0);
    const U = {
      uTod: [b.wDay, b.wGold, b.wBlue, b.wNight], uSeason: [sIdx(b.sA), sIdx(b.sB), b.sT, b.cover],
      uSpecial: [b.wFogPhoto, b.wRainNight, b.lightsOn, b.winter], uRelight: [b.relight, castStrength, b.alpenglow, b.anchoredSide ? 1 : 0],
      uSunCol: b.sunCol, uAmb: b.amb, uSunDir: sunW, uRefDir: refW,
      uZen: b.sky.zen, uHor: b.sky.hor, uSunHor: b.sky.sun, uRefZen: ref.zen, uRefHor: ref.hor, uSkyP: [b.sunX, b.sky.glow * (1 - b.overcast * 0.8), sunY, discVis],
    };
    const key = JSON.stringify(U, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v) + s.version + this.prevSunKey + (morning ? 'm' : 'e');
    if (key !== this.prevKey) {
      this.prevKey = key;
      bindTarget(gl, this.base);
      const p = this.pBase.use();
      const blue = morning ? 'dawn-bluehour' : 'evening-bluehour', gold = morning ? 'dawn-golden' : 'evening-golden';
      p.tex('tDay', master).tex('tAutumn', this.photo('autumn', master)).tex('tWinter', this.photo('winter-snow', master)).tex('tSpring', this.photo('spring', master))
        .tex('tNight', this.photo('night', s.black)).tex('tWinterNight', this.photo('winter-night', this.photo('night', s.black))).tex('tRainNight', this.photo('rain-night', this.photo('night', s.black)))
        .tex('tFog', this.photo('fog', master)).tex('tBlue', this.photo(blue, master)).tex('tGold', this.photo(gold, master))
        .tex('tMaskA', s.tex.a).tex('tMaskC', s.tex.c).tex('tMaskD', s.tex.d).tex('tGeo', s.tex.geo).tex('tShadow', this.shadow.tex)
        .set('uSize', [W, H]).set('uHasSpring', has.spring ? 1 : 0);
      for (const k of Object.keys(U)) p.set(k, U[k]);
      drawFullscreen(gl); this.baseRenders++;
    }

    // ---- 3. composite to the canvas ----
    const dayL = sstep(-7, 12, alt);
    const cloudLitDay = mix3([0.93, 0.94, 0.96], [0.60, 0.63, 0.68], sstep(0.5, 1, env.cloud));
    let lit = mix3([0.022, 0.024, 0.034], cloudLitDay, dayL);
    lit = mix3(lit, [0.95, 0.52, 0.34].map(v => v * (0.25 + 0.75 * dayL)), b.golden * 0.55 + b.alpenglow * (1 - b.overcast) * 0.25);
    lit = mix3(lit, lit.map(v => v * 0.42), env.storm * 0.75);
    lit = lit.map((v, i) => v + [0.016, 0.012, 0.010][i] * b.lightsOn * (0.4 + 0.6 * env.cloud)); // city glow under the clouds at night
    const dark = lit.map((v, i) => v * [0.40, 0.43, 0.50][i]);
    let fogCol = mix3([0.030, 0.031, 0.040], [0.76, 0.78, 0.81], sstep(-7, 10, alt));
    fogCol = mix3(fogCol, [0.95, 0.66, 0.46].map(v => v * (0.3 + 0.5 * dayL)), b.golden * 0.4);
    fogCol = fogCol.map((v, i) => v + [0.085, 0.060, 0.038][i] * b.lightsOn * 0.8);
    const haze = mix3(mix3(b.sky.hor, [luma(b.sky.hor), luma(b.sky.hor), luma(b.sky.hor) * 1.06], 0.5 * b.overcast), fogCol, clamp(env.cloud * 0.6));
    const reduce = !!opts.reducedMotion;
    bindTarget(gl, null);
    const v = this.view;
    this.pComp.use().tex('tBase', this.base.tex).tex('tMaskA', s.tex.a).tex('tMaskB', s.tex.b).tex('tGeo', s.tex.geo).tex('tDeck', s.tex.deck).tex('tCumulus', s.tex.cumulus)
      .set('uCov', v.cov).set('uPar', v.par).set('uSize', [W, H]).set('uZoom', v.zoom).set('uTime', reduce ? 0 : time).set('uInvScale', cam.invDepthScale)
      .set('uEnvA', [env.cloud, env.fog, lerp(0.62, 0.28, env.fogLvl), 0.06 + env.rain * 0.2 + env.snow * 0.2 + env.cloud * 0.04])
      .set('uEnvB', [env.wet, reduce ? 0 : env.wind, env.water, env.storm])
      .set('uEnvC', [opts.flash || 0, b.stars, clamp(env.cloud * 0.85 + env.fog * 0.3), env.snow])
      .set('uMisc', [opts.grain ?? 0.022, 0.22, b.wRainNight, b.wFogPhoto])
      .set('uFogCol', fogCol).set('uHazeCol', haze).set('uCloudLit', lit).set('uCloudDark', dark).set('uSunHor', b.sky.sun)
      .set('uFountCol', opts.fountainColor || [0.2, 0.5, 1]).set('uSkyP', [b.sunX, b.sky.glow * (1 - b.overcast), b.lightsOn, opts.boltX ?? 0.5]);
    drawFullscreen(gl);
    return b;
  }
  /** Fit the image to the canvas like CSS object-fit: cover, keeping the focus column in view. */
  layout(cw, ch) {
    const as = cw / ch, ai = this.W / this.H, fx = this.scene.cfg.camera.focusX ?? 0.5;
    if (as > ai) { const k = ai / as; this.view.cov = [0, 0.5 - k / 2, 1, k]; }
    else { const k = as / ai; this.view.cov = [clamp(fx - k / 2, 0, 1 - k), 0, k, 1]; }
  }
}
const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
