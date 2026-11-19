import { VISIBLE_SPECIAL_SCENES, specialScene } from './registry.js';
import { formatClock } from '../engine/sun.js';
import './ui.css';

export function installSpecialUI(root, actions, state, shared) {
  const entry = root.querySelector('#specialEntry');
  const mobileOpen = root.querySelector('#mobileOpen');

  const nav = document.createElement('div');
  nav.className = 'special-nav';
  const worldBadge = document.createElement('span');
  worldBadge.className = 'special-world-badge';
  nav.append(worldBadge);
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
  nav.append(change, back);
  root.append(nav);

  const controls = document.createElement('div');
  controls.id = 'specialControls';
  controls.className = 'special-controls';
  controls.innerHTML = `<div class="special-controls-heading"><h2 id="specialWorldName"></h2><span id="specialWorldTime"></span></div>
    <div class="special-time-row"><label for="specialHour">Час</label><input id="specialHour" type="range" min="0" max="24" step="0.01"><button id="specialPlay" type="button"></button></div>
    <div class="special-date-row"><label for="specialDate">Дата</label><input id="specialDate" type="date" min="2000-01-01" max="2099-12-31"><span id="specialSolar"></span></div>
    <div class="special-condition-row"><span>Атмосфера</span><div id="specialConditions" role="group" aria-label="Атмосфера на специалната сцена"></div></div>
    <div class="special-intensity-row"><label for="specialIntensity">Сила на атмосферата</label><input id="specialIntensity" type="range" min="0" max="1" step="0.01"><output id="specialIntensityValue"></output></div>
    <div class="special-audio-row"><button id="specialSound" type="button"></button><label for="specialVolume">Сила на звука</label><input id="specialVolume" type="range" min="0" max="1" step="0.01"></div>`;
  root.querySelector('#panel .mobile-sheet-header').after(controls);
  const field = selector => controls.querySelector(selector);
  const sameText = (node, value) => { if (node.textContent !== value) node.textContent = value; };

  const dialog = document.createElement('dialog');
  dialog.id = 'specialDialog';
  dialog.className = 'special-dialog';
  dialog.setAttribute('aria-labelledby', 'specialTitle');
  dialog.innerHTML = `<div class="special-dialog-head"><h2 id="specialTitle">Другата София</h2><button id="specialClose" class="sec" type="button">Затвори</button></div>
    <p class="special-intro">Фантастични светове върху снимката на НДК. Избери сцена:</p>
    <div class="special-grid" role="group" aria-label="Фантастични сцени">${VISIBLE_SPECIAL_SCENES.map(scene => `<button type="button" data-special="${scene.id}" disabled><strong>${scene.name}</strong><small>Проверявам снимката…</small></button>`).join('')}</div>
    <div class="special-actions"><button id="specialReturn" class="sec" type="button">Обратно към София</button></div>
    <p id="specialStatus" role="status" aria-live="polite"></p>`;
  root.append(dialog);
  const status = dialog.querySelector('#specialStatus');
  let available = new Set(), active = null, returnFocus = entry;

  function setManifest(manifest) {
    available = new Set(VISIBLE_SPECIAL_SCENES.filter(scene => manifest?.scenes?.[scene.id]).map(scene => scene.id));
    for (const button of dialog.querySelectorAll('[data-special]')) {
      const ready = available.has(button.dataset.special);
      button.disabled = !ready;
      button.querySelector('small').textContent = ready ? 'Разгледай сцената' : 'Недостъпно · липсва снимка';
      button.setAttribute('aria-label', `${button.querySelector('strong').textContent} — ${ready ? 'разгледай сцената' : 'недостъпно, липсва снимка'}`);
    }
    status.textContent = `${available.size} от ${VISIBLE_SPECIAL_SCENES.length} сцени са налични.`;
  }

  function sync(id) {
    active = id;
    nav.classList.toggle('is-visible', !!id);
    const definition = specialScene(id);
    if (definition) {
      sameText(worldBadge, definition.name);
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
    for (const button of dialog.querySelectorAll('[data-special]')) button.setAttribute('aria-pressed', String(button.dataset.special === id));
    dialog.querySelector('#specialReturn').disabled = !id;
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
    field('#specialDate').value = `${S.y}-${String(S.m + 1).padStart(2, '0')}-${String(S.d).padStart(2, '0')}`;
    sameText(field('#specialSolar'), `Изгрев ${formatClock(state.times.rise)} · Залез ${formatClock(state.times.set)}`);
    sameText(field('#specialPlay'), S.playing ? 'Пауза' : 'Пусни');
    field('#specialPlay').setAttribute('aria-label', S.playing ? 'Постави симулацията на пауза' : 'Пусни симулацията');
    sameText(field('#specialSound'), S.sound ? 'Изключи звука' : 'Включи звука');
    field('#specialSound').setAttribute('aria-pressed', String(S.sound));
    field('#specialVolume').value = S.vol;
  }
  field('#specialHour').addEventListener('input', event => shared.setHour(+event.target.value));
  field('#specialDate').addEventListener('change', event => shared.setDate(event.target.value));
  field('#specialPlay').addEventListener('click', shared.togglePlayback);
  field('#specialSound').addEventListener('click', shared.toggleSound);
  field('#specialVolume').addEventListener('input', event => shared.setVolume(+event.target.value));
  field('#specialIntensity').addEventListener('input', event => actions.specialIntensity(+event.target.value));
  state.on(what => { if (active && ['hour', 'tick', 'date', 'playing', 'sound', 'vol'].includes(what)) syncShared(); });

  function open(opener) {
    if (dialog.open) return;
    returnFocus = opener;
    status.textContent = 'Проверявам наличните снимки…';
    dialog.showModal();
    void actions.specialManifest().then(setManifest);
  }
  entry.addEventListener('click', () => open(entry));
  change.addEventListener('click', () => open(change));
  dialog.querySelector('#specialClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    const openerVisible = returnFocus.getClientRects().length && !returnFocus.closest('[inert]');
    const focus = openerVisible ? returnFocus : mobileOpen.getClientRects().length ? mobileOpen : change;
    focus.focus({ preventScroll: true });
  });
  const exit = () => { actions.exitSpecial(); if (dialog.open) dialog.close(); };
  back.addEventListener('click', exit);
  dialog.querySelector('#specialReturn').addEventListener('click', exit);
  // Some in-app touch browsers suppress the first synthesized click after a
  // captured panorama drag. Pointer-up still reaches these explicit buttons.
  const touchFallback = (button, action) => button.addEventListener('pointerup', event => {
    if (event.pointerType === 'touch' && event.isPrimary) setTimeout(action, 0);
  });
  touchFallback(change, () => { if (!dialog.open) open(change); });
  touchFallback(back, () => { if (nav.classList.contains('is-visible')) exit(); });
  for (const button of dialog.querySelectorAll('[data-special]')) button.addEventListener('click', async () => {
    status.textContent = `Зареждам „${button.querySelector('strong').textContent}“…`;
    button.disabled = true;
    try {
      const selected = await actions.selectSpecial(button.dataset.special);
      if (selected) {
        dialog.close();
        shared.closeMobilePanel();
      }
    } catch (error) {
      status.textContent = error.message;
    } finally { button.disabled = !available.has(button.dataset.special); }
  });
  sync(null);
  return { setManifest, sync, syncSetting, syncShared };
}
