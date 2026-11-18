import './static-view.css';
import { SPECIAL_BASE, VISIBLE_SPECIAL_SCENES, specialScene } from './special/registry.js';

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
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.textContent = lite
    ? volcano ? 'Статична снимка на София · НДК и Витоша · Вулкан (опростен ефект).' : 'Статична снимка на София · НДК и Витоша.'
    : volcano ? 'Показвам статична снимка с опростен вулкан. Интерактивният изглед не е достъпен.' : 'Показвам статична снимка. Интерактивният изглед не е достъпен на това устройство.';
  view.append(message);
  const nav = document.createElement('div');
  nav.className = 'static-special-nav';
  const choose = document.createElement('button'), back = document.createElement('button');
  choose.type = back.type = 'button';
  choose.textContent = 'Невъзможна София'; back.textContent = 'Обратно към София';
  nav.append(choose, back); view.append(nav);
  const dialog = document.createElement('dialog');
  dialog.className = 'static-special-dialog';
  dialog.setAttribute('aria-label', 'Невъзможна София');
  dialog.innerHTML = `<h2>Невъзможна София</h2><div class="static-special-grid">${VISIBLE_SPECIAL_SCENES.map(scene => `<button type="button" data-special="${scene.id}" disabled>${scene.name}<small>Недостъпно · липсва снимка</small></button>`).join('')}</div><button class="static-special-close" type="button">Затвори</button><p aria-live="polite"></p>`;
  view.append(dialog);
  let manifestPromise, selection = 0;
  const status = dialog.querySelector('[aria-live]');
  const manifest = () => manifestPromise ||= fetch(`${SPECIAL_BASE}manifest.json`).then(r => r.ok ? r.json() : { scenes: {} }).catch(() => ({ scenes: {} }));
  function available(data) {
    for (const button of dialog.querySelectorAll('[data-special]')) {
      const ready = !!data.scenes?.[button.dataset.special];
      button.disabled = !ready;
      button.querySelector('small').textContent = ready ? 'Разгледай сцената' : 'Недостъпно · липсва снимка';
    }
  }
  async function select(id) {
    const request = ++selection;
    const data = await manifest(), asset = data.scenes?.[id], definition = specialScene(id);
    if (request !== selection) return;
    if (!asset || !definition) { status.textContent = 'Сцената все още няма предоставена снимка.'; return; }
    const next = new Image();
    next.src = `${SPECIAL_BASE}${asset.webp}?v=${asset.hash.slice(0, 12)}`;
    try { await next.decode(); } catch {
      if (request !== selection) return;
      next.src = `${SPECIAL_BASE}${encodeURI(asset.source)}?v=${asset.hash.slice(0, 12)}`;
      try { await next.decode(); } catch {
        if (request === selection) status.textContent = 'Снимката не можа да се зареди.';
        return;
      }
    }
    if (request !== selection) return;
    photo.src = next.src;
    photo.alt = definition.name;
    back.hidden = false;
    message.textContent = `${definition.name} · статичен изглед.`;
    dialog.close();
    position();
  }
  choose.addEventListener('click', async () => { dialog.showModal(); available(await manifest()); });
  back.addEventListener('click', () => {
    selection++; photo.src = '/scenes/ndk/photos/master.webp'; photo.alt = 'София · НДК и Витоша'; back.hidden = true;
    message.textContent = 'Статична снимка на София · НДК и Витоша.';
    const url = new URL(location.href); url.searchParams.delete('special'); history.replaceState(null, '', url);
  });
  dialog.querySelector('.static-special-close').addEventListener('click', () => dialog.close());
  for (const button of dialog.querySelectorAll('[data-special]')) button.addEventListener('click', () => void select(button.dataset.special));
  back.hidden = true;
  app.replaceChildren(view);
  position();
  addEventListener('resize', position);
  if (requestedSpecial) void select(requestedSpecial);
}
