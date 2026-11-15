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

const params = new URLSearchParams(location.search);
const QA = params.has('qa'), STILL = params.get('still') === '1', app = document.querySelector('#app');
const version = `версия ${__APP_COMMIT__} · ${__APP_BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC`;

const canvas = document.createElement('canvas');
canvas.id = 'gl'; canvas.setAttribute('role', 'img');
canvas.setAttribute('aria-label', 'Снимка на НДК и Южния парк с Витоша отзад, която се променя според часа, сезона и времето');
app.append(canvas);
const loading = document.createElement('div');
loading.className = 'loading'; loading.innerHTML = '<div><div>Зареждам снимката…</div><div class="bar"><i></i></div></div>';
app.append(loading);

async function boot() {
  const gl = createGL(canvas);
  if (!gl) throw new Error('Браузърът не поддържа WebGL 2, затова живата снимка не може да се покаже.');
  const scene = await loadScene(gl, params.get('scene') || 'ndk', { onProgress: p => { loading.querySelector('i').style.width = Math.round(p * 100) + '%'; } });
  const state = new State(scene.cfg.location);
  const comp = new Compositor(gl, scene);
  const sound = new Sound();
  const life = new Life(gl, scene, { hooks: { onPlane: d => sound.plane(d), onBolt: km => sound.thunder(km) } });
  comp.trafficLayer = life.trafficLayer;
  const clock = new Clock();
  const quality = new Quality({ mobile: matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700, fixed: QA });
  const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
  const applyReduced = () => { state.S.reducedMotion = reduceMq.matches || params.get('reduce') === '1'; };
  applyReduced(); reduceMq.addEventListener('change', applyReduced);

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, quality.dprCap) * quality.scale;
    canvas.width = Math.max(2, Math.round(innerWidth * dpr)); canvas.height = Math.max(2, Math.round(innerHeight * dpr));
    comp.layout(canvas.width, canvas.height);
  };
  addEventListener('resize', resize); quality.onChange = () => { comp.shadowSteps = quality.shadowSteps; comp.maxPhotos = quality.maxPhotos; resize(); }; quality.onChange();

  let demo, ui, wantFrame = false;
  const actions = {
    user() { demo && demo.stop(); },
    sound(on) { state.S.sound = on; if (on) { sound.enable(); sound.setVolume(state.S.vol); } else sound.disable(); },
    volume(v) { sound.setVolume(v); },
    demo(start, keepSound) {
      if (!start) { demo.stop(); return; }
      if (state.S.reducedMotion) { ui.toast('Включено е намалено движение: демото не се пуска. Плъзни часа или смени сезона сам.'); return; }
      ui.hideIntro(); demo.start();
    },
    async now() {
      actions.user(); state.set('playing', false); ui.syncPlay(); state.setNow();
      const r = await fetchNow(scene.cfg.location);
      if (r.ok) { state.setLive(r); ui.toast(`София сега: ${r.label}, ${Math.round(r.temperature)}°C, вятър ${Math.round(r.windKmh)} км/ч, облачност ${r.cloudPct}%. Данни: Open-Meteo.`); }
      else ui.toast('Часът и датата са сверени със София. Времето от Open-Meteo не е достъпно в момента, затова оставям избраното време.');
      ui.syncWeather(); return r;
    },
    saveFrame() { wantFrame = true; },
  };
  ui = buildUI({ state, scene, version, actions });
  demo = new Demo(state, ui, life);

  // parallax: pointer on desktop, gyroscope on phones; never in reduced motion
  const par = { tx: 0, ty: 0, x: 0, y: 0 };
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', e => { par.tx = (e.clientX / innerWidth - 0.5) * 2; par.ty = (e.clientY / innerHeight - 0.5) * 2; });
    document.addEventListener('pointerleave', () => { par.tx = par.ty = 0; });
  } else if ('DeviceOrientationEvent' in window) {
    addEventListener('deviceorientation', e => { if (e.gamma == null) return; par.tx = Math.max(-1, Math.min(1, e.gamma / 18)); par.ty = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 18)); }, { passive: true });
  }
  document.addEventListener('visibilitychange', () => sound.suspend(document.hidden));

  // URL state (also drives the QA grid): ?date=2026-07-15&h=18.5&w=rain&wind=.3&fog=.55&ui=0
  if (params.get('date')) { const [y, m, d] = params.get('date').split('-').map(Number); state.setDate(y, m - 1, d); }
  if (params.get('h')) state.setHour(+params.get('h'));
  if (params.get('w')) state.setWeather(params.get('w'));
  if (params.get('wind')) state.S.wind = +params.get('wind');
  if (params.get('fog')) state.S.fogLvl = +params.get('fog');
  if (params.get('flash') === '0') state.S.flashes = false;
  if (params.get('ui') === '0') document.body.classList.add('photo');
  state.settle(); ui.syncTime(); ui.syncDate(); ui.syncFlash();

  let readT = 0;
  clock.add((dt, t) => {
    demo.update(dt); state.update(dt);
    const reduced = state.S.reducedMotion, k = 1 - Math.exp(-dt / 0.5);
    par.x += ((reduced ? 0 : par.tx) - par.x) * k; par.y += ((reduced ? 0 : par.ty) - par.y) * k;
    comp.view.par = STILL ? [0, 0] : [par.x, par.y]; comp.view.zoom = STILL ? 1 : reduced ? 1.03 : 1.035 + 0.012 * Math.sin(t * 0.05); // ?still=1: pixel-exact framing for QA
    const blend = comp.render(state.snapshot(), t, { flash: life.lightning.level, boltX: life.lightning.boltX, fountainColor: life.ctx.fountainColor, reducedMotion: reduced, grain: quality.grain });
    const ctx = life.context(state, blend, t, quality.particles);
    life.update(dt, ctx); life.draw(ctx, comp.view);
    if (wantFrame) { wantFrame = false; canvas.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `sofia-ndk-${state.S.y}-${String(state.S.m + 1).padStart(2, '0')}-${String(state.S.d).padStart(2, '0')}-${String(Math.floor(state.S.hour)).padStart(2, '0')}${String(Math.floor(state.S.hour % 1 * 60)).padStart(2, '0')}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); ui.toast('Кадърът е запазен като PNG.', 2400); }, 'image/png'); }
    sound.update(dt, { env: state.V, season: state.season, alt: blend.alt, activity: state.activity, time: t });
    quality.update(clock.dtAvg, dt);
    if (state.S.playing) ui.syncTime();
    readT += dt; if (readT > 0.25) { readT = 0; ui.readout(blend.alt); }
  });
  clock.start();
  loading.classList.add('gone'); setTimeout(() => loading.remove(), 900);

  // stream the rest of the photographs in the background, nearest states first
  const rest = ['night', 'dawn-golden', 'dawn-bluehour', 'autumn', 'winter-snow', 'winter-night', 'fog', 'rain-night', 'evening-golden', 'evening-bluehour', 'spring'].filter(id => scene.photos[id]);
  (async () => { for (const id of rest.slice(0, quality.maxPhotos - 1)) { await loadPhoto(gl, scene, id); await new Promise(r => setTimeout(r, 60)); } })();

  // first visit: the demo plays by itself, muted, behind a small welcome card
  let seen = true; try { seen = localStorage.getItem('btty.seen') === '1'; localStorage.setItem('btty.seen', '1'); } catch { /* private mode */ }
  if (!QA && params.get('ui') !== '0') { if (!seen || params.get('intro') === '1') { ui.showIntro(state.S.reducedMotion); if (!state.S.reducedMotion) demo.start(); } }
  window.__app = { state, comp, clock, scene, gl, life, sound, ui, demo, quality, actions, version };
}
boot().catch(err => {
  console.error(err);
  loading.classList.remove('gone'); loading.innerHTML = `<div role="alert">Живата снимка не може да се покаже.<br><small>${String(err.message || err)}</small></div>`;
  if (!loading.isConnected) app.append(loading);
});
