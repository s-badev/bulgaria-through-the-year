// Bootstrap: load the scene, then one clock drives state -> compositor -> life -> sound -> interface.
import { createGL } from './render/gl.js';
import { Compositor } from './render/compositor.js';
import { loadScene, loadPhoto } from './engine/scene.js';
import { State } from './engine/state.js';
import { Clock } from './engine/clock.js';
import { Quality } from './engine/quality.js';
import { Life } from './life/index.js';
import { Sound } from './audio/audio.js';
import { fetchNow } from './weather/now.js';
import { buildUI } from './ui/ui.js';
import { Demo } from './ui/demo.js';
import { installMobilePan } from './ui/mobile-pan.js';
import { showStaticView } from './static-view.js';
import { SpecialScenes } from './special/scenes.js';
import { SceneError, reportSceneError } from './diagnostics.js';

const params = new URLSearchParams(location.search);
const QA = params.has('qa'), STILL = params.get('still') === '1', app = document.querySelector('#app');
// Explicit scene URLs and deterministic QA keep their chosen state; ordinary visits start live.
const startLive = !QA && !['date', 'h', 'w', 'wind', 'fog'].some(key => params.has(key));
const version = `версия ${__APP_COMMIT__} · ${__APP_BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC`;

const canvas = document.createElement('canvas');
canvas.id = 'gl'; canvas.setAttribute('role', 'img');
canvas.setAttribute('aria-label', 'Снимка на НДК и Южния парк с Витоша отзад, която се променя според часа, сезона и времето');
app.append(canvas);
const loading = document.createElement('div');
loading.className = 'loading'; loading.innerHTML = '<div><div>Зареждам снимката…</div><div class="bar"><i></i></div></div>';
app.append(loading);
let failed = false, bootStage = 'context', activeGL, activeClock, activeSound, activeState, activeSpecial;
const lifetime = new AbortController();
const { signal } = lifetime;
const timers = [];
function showFallback(error, stage = bootStage, defaultReason = 'initialization-error') {
  if (failed) return;
  failed = true;
  const reason = reportSceneError(error, stage, false, defaultReason);
  const world = activeSpecial?.id || params.get('special');
  lifetime.abort();
  activeClock?.stop();
  try { activeSpecial?.destroy(); } catch (cleanupError) { reportSceneError(cleanupError, 'special-cleanup', true); }
  try { if (activeSound) { activeSound.disable(); activeSound.suspend(true); } }
  catch (cleanupError) { reportSceneError(cleanupError, 'audio-cleanup', true); }
  for (const timer of timers) clearInterval(timer);
  delete window.__app;
  showStaticView(false, activeState?.S.volcano ?? params.get('volcano') === '1', world, reason, activeState?.S);
  if (activeGL && !activeGL.isContextLost()) activeGL.getExtension('WEBGL_lose_context')?.loseContext();
}
canvas.addEventListener('webglcontextlost', event => {
  showFallback(new SceneError('context-lost', 'context', event.statusMessage || 'WebGL context lost'));
}, { signal });

async function boot() {
  let gl;
  try { gl = activeGL = createGL(canvas); }
  catch (error) { throw new SceneError('context-create', 'context', error.message); }
  if (!gl) throw new SceneError('webgl-unavailable', 'context', 'Browser did not provide a WebGL2 context');
  if (failed) return;
  bootStage = 'scene';
  const scene = await loadScene(gl, params.get('scene') || 'ndk', { signal, onProgress: p => { loading.querySelector('i').style.width = Math.round(p * 100) + '%'; } });
  if (failed) return;
  if (scene.photos.master?.state !== 'ready') throw scene.photos.master?.error ?? new SceneError('scene-resource', 'scene', 'Missing master photograph');
  const state = new State(scene.cfg.location);
  activeState = state;
  if (params.get('volcano') === '1') state.S.volcano = true;
  let liveMode = startLive, weatherRequest = 0;
  if (liveMode) state.setNow();
  bootStage = 'renderer';
  const comp = new Compositor(gl, scene);
  if (STILL) comp.view.zoom = 1;
  const mobile = matchMedia('(max-width: 820px), (max-height: 500px)');
  comp.panEnabled = mobile.matches;
  const sound = new Sound();
  activeSound = sound;
  const life = new Life(gl, scene, { hooks: { onPlane: d => sound.plane(d), onBolt: km => sound.thunder(km) } });
  comp.trafficLayer = life.trafficLayer;
  const clock = new Clock();
  activeClock = clock;
  const quality = new Quality({ mobile: matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700, fixed: QA });
  const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
  const applyReduced = () => { state.S.reducedMotion = reduceMq.matches || params.get('reduce') === '1'; };
  applyReduced(); reduceMq.addEventListener('change', applyReduced, { signal });
  const mobilePan = installMobilePan(canvas, comp, mobile, () => state.S.reducedMotion);

  const resize = () => {
    if (failed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, quality.dprCap) * quality.scale;
    const width = Math.max(2, Math.round(canvas.clientWidth * dpr)), height = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    comp.layout(width, height);
  };
  const canvasSize = new ResizeObserver(resize);
  canvasSize.observe(canvas);
  signal.addEventListener('abort', () => canvasSize.disconnect(), { once: true });
  mobile.addEventListener('change', () => { comp.panEnabled = mobile.matches; resize(); }, { signal });
  quality.onChange = () => { comp.shadowSteps = quality.shadowSteps; comp.maxPhotos = quality.maxPhotos; resize(); }; quality.onChange();

  let demo, ui, special, wantFrame = false;
  const actions = {
    user() { liveMode = false; weatherRequest++; demo && demo.stop(); ui?.markSimulated(); },
    sound(on) { state.set('sound', on); if (on) { sound.enable(); sound.setVolume(state.S.vol); sound.suspend(document.hidden); } else sound.disable(); },
    volume(v) { sound.setVolume(v); },
    demo(start, keepSound) {
      if (!start) { demo.stop(); return; }
      if (state.S.reducedMotion) { ui.toast('Включено е намалено движение: демото не се пуска. Плъзни часа или смени сезона сам.'); return; }
      liveMode = false; weatherRequest++;
      ui.hideIntro(); demo.start();
    },
    async now() {
      demo && demo.stop();
      liveMode = true;
      state.set('playing', false);
      ui.syncPlay();
      syncLiveClock();
      ui.markRealNow();
      const r = await refreshLiveWeather(true);
      return r;
    },
    saveFrame() { wantFrame = true; },
    specialManifest() { return special.loadManifest(); },
    selectSpecial(id) { return special.select(id); },
    exitSpecial() { return special.exit(); },
    specialSetting() { return special.setting(); },
    specialCondition(condition) { return special.setCondition(condition); },
    specialIntensity(value) { return special.setIntensity(value); },
  };
  bootStage = 'interface';
  ui = buildUI({ state, scene, version, actions, signal });
  special = new SpecialScenes(app, comp, state, id => { ui.syncSpecial(id); sound.setSpecialScene(id); sound.suspend(document.hidden); }, signal);
  special.onSetting = setting => ui.syncSpecialSetting(setting);
  activeSpecial = special;
  void special.loadManifest().then(manifest => { if (!failed) ui.setSpecialManifest(manifest); }).catch(error => reportSceneError(error, 'special-interface', true));
  if (liveMode) ui.markRealNow();
  demo = new Demo(state, ui, life);

  function syncLiveClock() {
    if (!liveMode || state.S.playing || demo.on) return;
    const old = [state.S.y, state.S.m, state.S.d, state.S.hour].join('/');
    state.setNow();
    if ([state.S.y, state.S.m, state.S.d, state.S.hour].join('/') !== old) {
      ui.syncTime(); ui.syncDate();
    }
  }
  async function refreshLiveWeather(announce = false) {
    if (!liveMode) return { ok: false, error: 'manual scene' };
    const requestId = ++weatherRequest;
    const r = await fetchNow(scene.cfg.location);
    // A slow response must never undo a user's later selection.
    if (failed || requestId !== weatherRequest || !liveMode) return r;
    syncLiveClock();
    if (r.ok) {
      state.setLive(r);
      ui.syncWeather();
      if (announce) ui.toast(`София сега: ${r.label}, ${Math.round(r.temperature)}°C, вятър ${Math.round(r.windKmh)} км/ч, облачност ${r.cloudPct}%. Данни: Open-Meteo.`);
    } else if (announce) {
      ui.toast('Часът и датата са сверени със София. Актуалното време от Open-Meteo не е достъпно.');
    }
    return r;
  }

  // parallax: pointer on desktop, gyroscope on phones; never in reduced motion
  const par = { tx: 0, ty: 0, x: 0, y: 0 };
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', e => { par.tx = (e.clientX / innerWidth - 0.5) * 2; par.ty = (e.clientY / innerHeight - 0.5) * 2; }, { signal });
    document.addEventListener('pointerleave', () => { par.tx = par.ty = 0; }, { signal });
  } else if ('DeviceOrientationEvent' in window) {
    addEventListener('deviceorientation', e => { if (e.gamma == null) return; par.tx = Math.max(-1, Math.min(1, e.gamma / 18)); par.ty = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 18)); }, { passive: true, signal });
  }
  document.addEventListener('visibilitychange', () => {
    if (failed) return;
    sound.suspend(document.hidden);
    if (!document.hidden) { syncLiveClock(); if (liveMode) void refreshLiveWeather(); }
  }, { signal });

  // URL state (also drives the QA grid): ?date=2026-07-15&h=18.5&w=rain&wind=.3&fog=.55&ui=0
  if (params.get('date')) { const [y, m, d] = params.get('date').split('-').map(Number); state.setDate(y, m - 1, d); }
  if (params.get('h')) state.setHour(+params.get('h'));
  if (params.get('w')) state.setWeather(params.get('w'));
  if (params.get('wind')) state.S.wind = +params.get('wind');
  if (params.get('fog')) state.S.fogLvl = +params.get('fog');
  if (params.get('flash') === '0') state.S.flashes = false;
  if (params.get('ui') === '0') document.body.classList.add('photo');
  state.settle(); ui.syncTime(); ui.syncDate(); ui.syncFlash();
  // Keep the live wall clock exact without enabling accelerated time playback.
  timers.push(setInterval(() => { if (!document.hidden) syncLiveClock(); }, 1000));
  timers.push(setInterval(() => { if (!document.hidden && liveMode) void refreshLiveWeather(); }, 10 * 60 * 1000));

  let readT = 0, lifeEnabled = true, audioEnabled = true;
  const downloadFrame = b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `sofia-ndk-${state.S.y}-${String(state.S.m + 1).padStart(2, '0')}-${String(state.S.d).padStart(2, '0')}-${String(Math.floor(state.S.hour)).padStart(2, '0')}${String(Math.floor(state.S.hour % 1 * 60)).padStart(2, '0')}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); ui.toast('Кадърът е запазен като PNG.', 2400); };
  clock.add((dt, t) => {
    if (failed) return;
    try {
    if (!special.active) demo.update(dt);
    state.update(dt);
    const reduced = state.S.reducedMotion, k = 1 - Math.exp(-dt / 0.5);
    par.x += ((reduced ? 0 : par.tx) - par.x) * k; par.y += ((reduced ? 0 : par.ty) - par.y) * k;
    comp.view.par = STILL ? [0, 0] : [mobile.matches ? 0 : par.x, par.y]; if (!special.active) comp.view.zoom = STILL ? 1 : reduced ? 1.03 : 1.035 + 0.012 * Math.sin(t * 0.05); // ?still=1: pixel-exact framing for QA
    comp.applyPan();
    mobilePan.update();
    let specialLight;
    try { special.layout(); specialLight = special.update(dt, state, quality.particles); }
    catch (error) { reportSceneError(error, 'special-effects', true); special.exit(); }
    let blend = { alt: state.sun.elevation };
    if (special.renderNormal) {
      blend = comp.render(state.snapshot(), t, { flash: lifeEnabled ? life.lightning.level : 0, boltX: life.lightning.boltX, fountainColor: life.ctx.fountainColor, reducedMotion: reduced, grain: quality.grain, effectDetail: quality.particles });
      if (lifeEnabled) {
        try { const ctx = life.context(state, blend, t, quality.particles); life.update(dt, ctx); life.draw(ctx, comp.view); }
        catch (error) {
          reportSceneError(error, 'life-effects', true);
          lifeEnabled = false;
          gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          comp.trafficLayer = null; comp.prevKey = '';
          life.destroy();
        }
      }
      special.normalFrameReady();
    }
    if (audioEnabled) try {
      const setting = special.active && special.setting();
      if (setting) {
        sound.update(dt, { time: t, special: { id: special.id, condition: setting.condition, intensity: setting.intensity, light: specialLight } });
        if (specialLight?.flash) sound.thunder(.35 + (1 - setting.intensity) * .65, special.id === 'flood' ? .65 : 1);
      } else sound.update(dt, { env: state.V, season: state.season, alt: blend.alt, activity: state.activity, time: t });
    } catch (error) { audioEnabled = false; reportSceneError(error, 'audio', true); sound.disable(); }
    quality.update(clock.dtAvg, dt);
    if (wantFrame) { wantFrame = false; if (special.active) void special.capture().then(downloadFrame).catch(error => reportSceneError(error, 'capture', true)); else canvas.toBlob(downloadFrame, 'image/png'); }
    if (state.S.playing) ui.syncTime();
    readT += dt; if (readT > 0.25) { readT = 0; ui.readout(blend.alt); }
    } catch (error) { showFallback(error, 'frame', 'runtime-error'); }
  });
  if (failed) return;
  clock.start();
  loading.classList.add('gone'); setTimeout(() => loading.remove(), 900);

  const initialSpecial = params.get('special') ? special.select(params.get('special')).catch(error => ui.toast(error.message)) : Promise.resolve();

  // stream the rest of the photographs in the background, nearest states first
  const rest = ['night', 'dawn-golden', 'dawn-bluehour', 'autumn', 'winter-snow', 'winter-night', 'fog', 'rain-night', 'evening-golden', 'evening-bluehour', 'spring'].filter(id => scene.photos[id]);
  (async () => { await initialSpecial; for (const id of rest.slice(0, quality.maxPhotos - 1)) { await special.whenInactive(); if (failed) break; await loadPhoto(gl, scene, id); await new Promise(r => setTimeout(r, 60)); } })();

  // Starting at the real current time takes priority over the former automatic demo.
  // The demo stays available through its explicit button, and intro via ?intro=1.
  if (!QA && params.get('ui') !== '0' && !mobile.matches && params.get('intro') === '1') ui.showIntro(state.S.reducedMotion);
  window.__app = { state, comp, clock, scene, gl, life, sound, ui, demo, quality, special, actions, version };
  if (liveMode) void refreshLiveWeather();
  if (import.meta.env.DEV) import('./ui/debug-overlay.js').then(d => { window.__app.debug = d.install({ scene, comp, life, clock }); }); // key D; stripped from production builds
}
void boot().catch(showFallback);
