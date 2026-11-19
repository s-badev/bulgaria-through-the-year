import { VISIBLE_SPECIAL_SCENES, specialScene } from './registry.js';
import { formatClock } from '../engine/sun.js';
import './ui.css';

export function installSpecialUI(root, actions, state, shared) {
  const entry = root.querySelector('#specialEntry');
  const mobileOpen = root.querySelector('#mobileOpen');

  const nav = document.createElement('div');
  nav.className = 'special-nav';
  const change = document.createElement('button');
  change.id = 'specialChange';
  change.type = 'button';
  change.className = 'sec';
  change.textContent = 'Смени сцената';
  const back = document.createElement('button');
  back.id = 'specialBack';
  back.type = 'button';
  back.className = 'sec';
  back.textContent = 'Обратно към София';
  nav.append(change);

  const controls = document.createElement('div');
  controls.id = 'specialControls';
  controls.className = 'special-controls';
  controls.innerHTML = `<div class="special-controls-heading"><h2 id="specialWorldName"></h2><span class="special-back-slot"></span><span id="specialWorldTime"></span><button id="specialPlay" class="sec" type="button"></button></div>
    <div class="special-settings">
    <div class="special-time-row"><label for="specialHour">Час</label><input id="specialHour" type="range" min="0" max="24" step="0.01"></div>
    <div class="special-condition-row"><span>Атмосфера</span><div id="specialConditions" class="seg" role="group" aria-label="Атмосфера на специалната сцена"></div></div>
    <div class="special-intensity-row"><label for="specialIntensity">Сила на атмосферата</label><input id="specialIntensity" type="range" min="0" max="1" step="0.01"><output id="specialIntensityValue"></output></div>
    <div class="special-audio-row"><button id="specialSound" class="sec" type="button"></button><label for="specialVolume">Сила на звука</label><input id="specialVolume" type="range" min="0" max="1" step="0.01"></div>
    </div>`;
  controls.querySelector('.special-back-slot').replaceWith(back);
  root.querySelector('#panel .mobile-sheet-header').after(controls);
  // Keep mobile scene switching in settings; the return button stays in the pinned heading.
  controls.querySelector('.special-condition-row').after(nav);
  const field = selector => controls.querySelector(selector);
  const sameText = (node, value) => { if (node.textContent !== value) node.textContent = value; };

  const picker = document.createElement('section');
  picker.id = 'specialPicker';
  picker.className = 'special-picker';
  picker.setAttribute('aria-label', 'Другата София — избор на свят');
  picker.innerHTML = `<div class="special-picker-head"><h2>Другата София</h2><button id="specialPickerClose" class="sec" type="button">Затвори</button></div>
    <div class="special-grid" role="group" aria-label="Шест свята">${VISIBLE_SPECIAL_SCENES.map(scene => `<button type="button" data-special="${scene.id}" disabled><strong>${scene.name}</strong></button>`).join('')}</div>
    <p id="specialStatus" role="status" aria-live="polite"></p>`;
  controls.after(picker);
  const status = picker.querySelector('#specialStatus');
  let available = new Set(), active = null, returnFocus = entry;
  let manifestRequested = false;
  function updatePickerState() {
    const opened = picker.classList.contains('is-open');
    entry.setAttribute('aria-expanded', String(opened));
    change.setAttribute('aria-expanded', String(opened));
    root.querySelector('#panel').classList.toggle('special-picker-expanded', opened);
  }
  function closePicker() {
    picker.classList.remove('is-open');
    updatePickerState();
  }
  function showPicker(opener) {
    returnFocus = opener;
    picker.classList.add('is-open');
    updatePickerState();
    const mobile = matchMedia('(max-width: 820px), (max-height: 500px)').matches;
    if (mobile && !root.querySelector('#panel').classList.contains('is-open')) mobileOpen.click();
    if (!manifestRequested) {
      manifestRequested = true;
      status.textContent = 'Проверявам наличните снимки…';
      void actions.specialManifest().then(setManifest).catch(error => {
        manifestRequested = false;
        status.textContent = error.message || 'Снимките са недостъпни.';
      });
    }
  }

  function setManifest(manifest) {
    available = new Set(VISIBLE_SPECIAL_SCENES.filter(scene => manifest?.scenes?.[scene.id]).map(scene => scene.id));
    for (const button of picker.querySelectorAll('[data-special]')) {
      const ready = available.has(button.dataset.special);
      button.disabled = !ready;
      button.setAttribute('aria-label', `${button.querySelector('strong').textContent} — ${ready ? 'разгледай сцената' : 'недостъпно, липсва снимка'}`);
    }
    status.textContent = `${available.size} от ${VISIBLE_SPECIAL_SCENES.length} сцени са налични.`;
  }

  function sync(id) {
    active = id;
    field('.special-settings').scrollTop = 0;
    nav.classList.toggle('is-visible', !!id);
    closePicker();
    if (id && !manifestRequested) {
      manifestRequested = true;
      void actions.specialManifest().then(setManifest).catch(error => {
        manifestRequested = false;
        status.textContent = error.message || 'Снимките са недостъпни.';
      });
    }
    const definition = specialScene(id);
    if (definition) {
      sameText(field('#specialWorldName'), definition.name);
      field('#specialConditions').replaceChildren(...definition.conditions.map(([value, label]) => {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.condition = value; button.textContent = label;
        button.addEventListener('click', () => actions.specialCondition(value));
        return button;
      }));
      syncSetting(actions.specialSetting());
      syncShared();
    }
    for (const button of picker.querySelectorAll('[data-special]')) button.setAttribute('aria-pressed', String(button.dataset.special === id));
    updatePickerState();
  }
  function syncSetting(setting) {
    if (!setting || !active) return;
    field('#specialIntensity').value = setting.intensity;
    sameText(field('#specialIntensityValue'), `${Math.round(setting.intensity * 100)}%`);
    for (const button of field('#specialConditions').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.condition === setting.condition));
  }
  function syncShared() {
    if (!active) return;
    const S = state.S;
    field('#specialHour').value = S.hour.toFixed(2);
    field('#specialHour').setAttribute('aria-valuetext', formatClock(S.hour));
    sameText(field('#specialWorldTime'), formatClock(S.hour));
    sameText(field('#specialPlay'), S.playing ? 'Пауза' : 'Пусни');
    field('#specialPlay').setAttribute('aria-label', S.playing ? 'Постави симулацията на пауза' : 'Пусни симулацията');
    sameText(field('#specialSound'), S.sound ? 'Изключи звука' : 'Включи звука');
    field('#specialSound').setAttribute('aria-pressed', String(S.sound));
    field('#specialVolume').value = S.vol;
  }
  field('#specialHour').addEventListener('input', event => shared.setHour(+event.target.value));
  field('#specialPlay').addEventListener('click', shared.togglePlayback);
  field('#specialSound').addEventListener('click', shared.toggleSound);
  field('#specialVolume').addEventListener('input', event => shared.setVolume(+event.target.value));
  field('#specialIntensity').addEventListener('input', event => actions.specialIntensity(+event.target.value));
  state.on(what => { if (active && ['hour', 'tick', 'date', 'playing', 'sound', 'vol'].includes(what)) syncShared(); });

  entry.addEventListener('click', () => {
    if (picker.classList.contains('is-open')) closePicker();
    else showPicker(entry);
  });
  change.addEventListener('click', () => {
    if (picker.classList.contains('is-open')) closePicker();
    else showPicker(change);
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!picker.classList.contains('is-open')) return;
      event.preventDefault();
      event.stopPropagation();
      closePicker();
      const focus = returnFocus?.getClientRects().length ? returnFocus : mobileOpen;
      focus.focus({ preventScroll: true });
    }
  });
  picker.querySelector('#specialPickerClose').addEventListener('click', () => {
    closePicker();
    const focus = returnFocus?.getClientRects().length ? returnFocus : mobileOpen;
    focus.focus({ preventScroll: true });
  });
  const exit = () => { closePicker(); actions.exitSpecial(); };
  back.addEventListener('click', exit);
  // Some in-app touch browsers suppress the first synthesized click after a
  // captured panorama drag. Pointer-up still reaches these explicit buttons.
  const touchFallback = (button, action) => button.addEventListener('pointerup', event => {
    if (event.pointerType === 'touch' && event.isPrimary) setTimeout(action, 0);
  });
  touchFallback(change, () => { if (!picker.classList.contains('is-open')) showPicker(change); });
  touchFallback(back, () => { if (nav.classList.contains('is-visible')) exit(); });
  for (const button of picker.querySelectorAll('[data-special]')) button.addEventListener('click', async () => {
    status.textContent = `Зареждам „${button.querySelector('strong').textContent}“…`;
    button.disabled = true;
    try {
      const selected = await actions.selectSpecial(button.dataset.special);
      if (selected) {
        closePicker();
        shared.closeMobilePanel();
      }
    } catch (error) {
      status.textContent = error.message;
    } finally { button.disabled = !available.has(button.dataset.special); }
  });
  sync(null);
  return { setManifest, sync, syncSetting, syncShared };
}
