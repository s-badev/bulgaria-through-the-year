import './static-view.css';
import { SPECIAL_BASE, VISIBLE_SPECIAL_SCENES, specialScene } from './special/registry.js';
import { State } from './engine/state.js';
import { formatClock } from './engine/sun.js';
import { solarMix } from './special/lighting.js';
import { plateWeights } from './special/plates.js';

export function showStaticView(lite = false, volcano = new URLSearchParams(location.search).get('volcano') === '1', requestedSpecial = new URLSearchParams(location.search).get('special')) {
  const app = document.querySelector('#app');
  if (!app || app.querySelector('.static-view')) return;
  document.body.classList.remove('photo');
  const view = document.createElement('main');
  view.className = 'static-view';
  const photo = document.createElement('img');
  photo.src = '/scenes/ndk/photos/master.webp';
  photo.alt = 'София · НДК и Витоша';
  photo.decoding = 'async';
  view.append(photo);
  let pan = 0.5, drag = null;
  function position() {
    photo.style.objectPosition = `${pan * 100}% center`;
    const art = view.querySelector('.static-volcano-art svg');
    if (art) {
      const w = view.clientWidth, h = view.clientHeight, imageW = Math.max(w, h * 1672 / 941), imageH = imageW * 941 / 1672;
      Object.assign(art.style, { width: `${imageW}px`, height: `${imageH}px`, left: `${-(imageW - w) * pan}px`, top: `${-(imageH - h) / 2}px` });
    }
  }
  view.addEventListener('pointerdown', event => {
    if (event.target !== photo || !event.isPrimary || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
    drag = { id: event.pointerId, x: event.clientX };
    view.setPointerCapture(event.pointerId);
  });
  view.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const imageW = Math.max(view.clientWidth, view.clientHeight * 1672 / 941), range = imageW - view.clientWidth;
    if (range > 0) pan = Math.max(0, Math.min(1, pan - (event.clientX - drag.x) / range));
    drag.x = event.clientX;
    position();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) view.addEventListener(type, event => { if (drag?.id === event.pointerId) drag = null; });
  if (volcano) {
    view.classList.add('static-volcano');
    const overlay = document.createElement('div');
    overlay.className = 'static-volcano-art';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `<svg viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="craterGlow"><stop stop-color="#ff9e39" stop-opacity=".8"/><stop offset="1" stop-color="#e24b18" stop-opacity="0"/></radialGradient><radialGradient id="ash"><stop stop-color="#25222a" stop-opacity=".78"/><stop offset="1" stop-color="#25222a" stop-opacity="0"/></radialGradient></defs>
      <ellipse class="ash" cx="1017" cy="145" rx="85" ry="57" fill="url(#ash)"/>
      <ellipse cx="1017" cy="191" rx="55" ry="27" fill="url(#craterGlow)"/>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1017 191 Q977 222 915 246 T786 300 M1017 191 Q1052 211 1101 249 T1190 305" stroke="#d94c1b" stroke-opacity=".7" stroke-width="9"/>
        <path d="M1017 191 Q977 222 915 246 T786 300 M1017 191 Q1052 211 1101 249 T1190 305" stroke="#ffb049" stroke-opacity=".9" stroke-width="3"/>
      </g><circle cx="1017" cy="190" r="9" fill="#ffbd63"/>
    </svg>`;
    view.append(overlay);
  }

  // The photographic path must be useful even when a WebGL2 context or shader fails.
  // It shares real Sofia solar calculations and the registered world photographs.
  const timeState = new State({ lat: 42.6977, lon: 23.3219 });
  timeState.setNow();
  const query = new URLSearchParams(location.search);
  if (query.get('date')) {
    const parts = query.get('date').split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) timeState.setDate(parts[0], parts[1] - 1, parts[2]);
  }
  if (query.has('h') && Number.isFinite(+query.get('h'))) timeState.setHour(+query.get('h'));
  timeState.settle();
  const weatherPresets = [['clear', 'Ясно'], ['cloudy', 'Облачно'], ['fog', 'Мъгла'], ['rain', 'Дъжд'], ['storm', 'Буря'], ['snow', 'Сняг']];
  const seasons = [['spring', 'Пролет'], ['summer', 'Лято'], ['autumn', 'Есен'], ['winter', 'Зима']];
  const markupButtons = (items, attribute) => items.map(item =>
    '<button type="button" data-' + attribute + '="' + item[0] + '">' + item[1] + '</button>'
  ).join('');
  const panel = document.createElement('section');
  panel.className = 'static-panel';
  panel.setAttribute('aria-label', 'Управление на фотографския режим');
  panel.innerHTML =
    '<div class="static-control-side">' +
      '<div class="static-panel-heading"><strong id="fallbackSceneName">София · НДК и Витоша</strong><span class="static-photo-label">Фоторежим</span></div>' +
      '<div class="static-time-row"><span class="static-lab">ЧАС</span><button type="button" id="fallbackPlay" class="static-btn">▶</button><strong id="fallbackTime">12:00</strong><input id="fallbackHour" type="range" min="0" max="23.99" step="0.01" aria-label="Час от денонощието"></div>' +
      '<div class="static-normal-options"><div class="static-option-row"><span class="static-lab">СЕЗОН</span><div class="static-buttons" id="fallbackSeasons">' + markupButtons(seasons, 'season') + '</div><button type="button" id="fallbackOther" class="static-btn">Другата София</button></div>' +
      '<div class="static-option-row"><span class="static-lab">ВРЕМЕ</span><div class="static-buttons" id="fallbackWeather">' + markupButtons(weatherPresets, 'weather') + '</div></div></div>' +
      '<div class="static-special-options" hidden><span class="static-lab">АТМОСФЕРА</span><div class="static-buttons" id="fallbackConditions"></div></div>' +
    '</div>' +
    '<div class="static-world-side" hidden><div class="static-world-heading"><strong>Другата София</strong><button id="fallbackBack" class="static-btn" type="button">Обратно към София</button><button id="fallbackWorldClose" class="static-btn" type="button">Затвори</button></div>' +
      '<div class="static-world-grid">' + VISIBLE_SPECIAL_SCENES.map(scene =>
        '<button type="button" data-special="' + scene.id + '" disabled>' + scene.name + '</button>'
      ).join('') + '</div><div id="fallbackStatus" class="static-sr" role="status" aria-live="polite"></div>' +
    '</div>';
  const top = document.createElement('div');
  top.className = 'static-top';
  top.innerHTML = '<strong>София · НДК</strong><span>Фоторежим без WebGL</span><button id="fallbackHelp" class="static-btn" type="button">Причина</button>';
  const detail = document.createElement('div');
  detail.className = 'static-detail';
  detail.hidden = true;
  detail.textContent = 'Интерактивният GPU рендер не стартира. Фотографският режим запазва часа и алтернативните сцени. Проверете WebGL2/хардуерното ускорение и конзолата за точната грешка.';
  const panelToggle = document.createElement('button');
  panelToggle.className = 'static-panel-toggle';
  panelToggle.type = 'button';
  panelToggle.textContent = 'Контроли';
  panelToggle.setAttribute('aria-expanded', 'false');
  view.append(top, detail, panelToggle, panel);
  const $ = selector => panel.querySelector(selector);
  const btns = selector => [...panel.querySelectorAll(selector)];
  const status = $('#fallbackStatus');
  const photoName = $('#fallbackSceneName');
  const controls = $('.static-control-side');
  const worlds = $('.static-world-side');
  let active = null, condition = null, playing = false, manifestData = null, requestNumber = 0;
  let currentSrc = photo.src, pendingSrc = null, imageRequest = 0;
  let manifestPromise = null, lastFrame = performance.now();

  function srcFor(asset, key) {
    const part = key === 'base' ? asset : asset.variants?.[key];
    if (!part) return null;
    const keyName = part.webp ? 'webp' : 'source';
    const name = part[keyName], hash = part.renderHash || part.hash || asset.hash || '';
    return SPECIAL_BASE + encodeURI(name) + (hash ? '?v=' + hash.slice(0, 12) : '');
  }
  function loadManifest() {
    if (!manifestPromise) manifestPromise = fetch(SPECIAL_BASE + 'manifest.json')
      .then(response => { if (!response.ok) throw new Error('manifest ' + response.status); return response.json(); })
      .then(data => {
        manifestData = data;
        btns('[data-special]').forEach(button => { button.disabled = !data.scenes?.[button.dataset.special]; });
        return data;
      }).catch(error => {
        console.error(error);
        status.textContent = 'Снимките на другите светове не са достъпни.';
        return { scenes: {} };
      });
    return manifestPromise;
  }
  function photoForCurrentState() {
    if (active && manifestData?.scenes?.[active]) {
      const scene = specialScene(active), asset = manifestData.scenes[active];
      const weights = plateWeights(scene, asset, timeState.sun, { condition, intensity: .65 });
      const key = [...weights.keys()].sort((a, b) => weights.get(b) - weights.get(a))[0];
      return srcFor(asset, key);
    }
    const mix = solarMix(timeState.sun), season = timeState.seasonName, w = timeState.S.weather;
    let key;
    if (mix.night > .6) key = season === 'winter' ? 'winter-night' : ['rain', 'storm'].includes(w) ? 'rain-night' : 'night';
    else if (mix.twilight > .65) key = 'dawn-golden';
    else if (w === 'fog') key = 'fog';
    else if (season === 'winter' || w === 'snow') key = 'winter-snow';
    else if (season === 'autumn') key = 'autumn';
    else key = 'master';
    return '/scenes/ndk/photos/' + key + '.webp';
  }
  function swapPhotograph(nextSrc) {
    if (!nextSrc || nextSrc === currentSrc || nextSrc === pendingSrc) return;
    const token = ++imageRequest;
    pendingSrc = nextSrc;
    const next = new Image();
    next.onload = () => {
      if (token !== imageRequest) return;
      photo.src = nextSrc;
      currentSrc = nextSrc;
      pendingSrc = null;
      position();
    };
    next.onerror = () => {
      if (token !== imageRequest) return;
      pendingSrc = null;
      console.warn('Photographic fallback missing image:', nextSrc);
    };
    next.src = nextSrc;
  }
  function sync() {
    timeState.settle();
    $('#fallbackTime').textContent = formatClock(timeState.S.hour);
    $('#fallbackHour').value = timeState.S.hour;
    $('#fallbackPlay').textContent = playing ? 'Ⅱ' : '▶';
    $('#fallbackPlay').setAttribute('aria-label', playing ? 'Пауза' : 'Пусни');
    $('#fallbackPlay').setAttribute('aria-pressed', String(playing));
    btns('[data-season]').forEach(button => button.setAttribute('aria-pressed', String(timeState.seasonName === button.dataset.season)));
    btns('[data-weather]').forEach(button => button.setAttribute('aria-pressed', String(timeState.S.weather === button.dataset.weather)));
    btns('[data-condition]').forEach(button => button.setAttribute('aria-pressed', String(condition === button.dataset.condition)));
    btns('[data-special]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.special === active)));
    photoName.textContent = active ? specialScene(active).name : 'София · НДК и Витоша';
    view.classList.toggle('has-world', !!active);
    swapPhotograph(photoForCurrentState());
  }
  function selectWorld(id) {
    const scene = specialScene(id);
    if (!scene || !manifestData?.scenes?.[id]) return;
    active = id;
    condition = scene.defaultCondition;
    const container = $('#fallbackConditions');
    container.replaceChildren();
    for (const [value, label] of scene.conditions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.condition = value;
      button.textContent = label;
      container.append(button);
    }
    $('.static-special-options').hidden = false;
    $('.static-normal-options').hidden = true;
    worlds.hidden = false;
    $('#fallbackWorldClose').hidden = true;
    $('#fallbackBack').hidden = false;
    panel.classList.add('is-open');
    panelToggle.setAttribute('aria-expanded', 'true');
    status.textContent = '';
    sync();
  }
  function normalMode() {
    active = null;
    condition = null;
    $('.static-special-options').hidden = true;
    $('.static-normal-options').hidden = false;
    worlds.hidden = true;
    sync();
  }
  btns('[data-season]').forEach(button => button.addEventListener('click', () => { timeState.setSeason(button.dataset.season); sync(); }));
  btns('[data-weather]').forEach(button => button.addEventListener('click', () => { timeState.setWeather(button.dataset.weather); sync(); }));
  $('#fallbackHour').addEventListener('input', event => { timeState.setHour(+event.target.value); sync(); });
  $('#fallbackPlay').addEventListener('click', () => { playing = !playing; sync(); });
  $('#fallbackOther').addEventListener('click', () => {
    worlds.hidden = !worlds.hidden;
    $('#fallbackWorldClose').hidden = false;
    $('#fallbackBack').hidden = true;
    if (!worlds.hidden) void loadManifest();
  });
  $('#fallbackBack').addEventListener('click', normalMode);
  $('#fallbackWorldClose').addEventListener('click', () => { if (!active) worlds.hidden = true; });
  panel.addEventListener('click', event => {
    const specialButton = event.target.closest('[data-special]');
    if (specialButton) selectWorld(specialButton.dataset.special);
    const atmosphere = event.target.closest('[data-condition]');
    if (atmosphere) { condition = atmosphere.dataset.condition; sync(); }
  });
  panelToggle.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('is-open');
    panelToggle.setAttribute('aria-expanded', String(isOpen));
  });
  top.querySelector('#fallbackHelp').addEventListener('click', () => { detail.hidden = !detail.hidden; });
  view.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !detail.hidden) detail.hidden = true;
  });
  app.replaceChildren(view);
  position();
  addEventListener('resize', position);
  void loadManifest().then(() => {
    if (requestedSpecial && manifestData?.scenes?.[requestedSpecial]) selectWorld(requestedSpecial);
  });
  sync();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const frame = now => {
    if (!view.isConnected) return;
    const dt = Math.min((now - lastFrame) / 1000, .2);
    lastFrame = now;
    if (playing && !reduced.matches) {
      const previousHour = timeState.S.hour;
      timeState.setHour(previousHour + dt * 24 / 60);
      if (timeState.S.hour < previousHour) timeState.setDate(timeState.S.y, timeState.S.m, timeState.S.d + 1);
      sync();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
