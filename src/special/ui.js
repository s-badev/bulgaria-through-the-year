import { SPECIAL_SCENES } from './registry.js';
import './ui.css';

export function installSpecialUI(root, actions) {
  const entry = document.createElement('button');
  entry.id = 'specialEntry';
  entry.type = 'button';
  entry.className = 'sec special-entry';
  entry.textContent = 'Невъзможна София';
  root.querySelector('.foot').prepend(entry);

  const menuEntry = document.createElement('button');
  menuEntry.id = 'menuSpecial';
  menuEntry.type = 'button';
  menuEntry.className = 'sec';
  menuEntry.textContent = 'Невъзможна София';
  root.querySelector('#mobileMenu').prepend(menuEntry);

  const back = document.createElement('button');
  back.id = 'specialBack';
  back.type = 'button';
  back.className = 'sec special-back';
  back.textContent = 'Обратно към София';
  root.append(back);

  const dialog = document.createElement('dialog');
  dialog.id = 'specialDialog';
  dialog.className = 'special-dialog';
  dialog.setAttribute('aria-labelledby', 'specialTitle');
  dialog.innerHTML = `<div class="special-dialog-head"><h2 id="specialTitle">Невъзможна София</h2><button id="specialClose" class="sec" type="button">Затвори</button></div>
    <p class="special-intro">Фантастични светове върху снимката на НДК. Избери сцена:</p>
    <div class="special-grid" role="group" aria-label="Фантастични сцени">${SPECIAL_SCENES.map(scene => `<button type="button" data-special="${scene.id}" disabled><strong>${scene.name}</strong><small>Проверявам снимката…</small></button>`).join('')}</div>
    <div class="special-actions"><button id="specialReturn" class="sec" type="button">Обратно към София</button></div>
    <p id="specialStatus" role="status" aria-live="polite"></p>`;
  root.append(dialog);
  const status = dialog.querySelector('#specialStatus');
  let available = new Set(), active = null, returnFocus = entry;

  function setManifest(manifest) {
    available = new Set(Object.keys(manifest?.scenes || {}));
    for (const button of dialog.querySelectorAll('[data-special]')) {
      const ready = available.has(button.dataset.special);
      button.disabled = !ready;
      button.querySelector('small').textContent = ready ? 'Разгледай сцената' : 'Недостъпно · липсва снимка';
      button.setAttribute('aria-label', `${button.querySelector('strong').textContent} — ${ready ? 'разгледай сцената' : 'недостъпно, липсва снимка'}`);
    }
    status.textContent = `${available.size} от ${SPECIAL_SCENES.length} снимки са налични.`;
  }

  function sync(id) {
    active = id;
    back.classList.toggle('is-visible', !!id);
    for (const button of dialog.querySelectorAll('[data-special]')) button.setAttribute('aria-pressed', String(button.dataset.special === id));
    dialog.querySelector('#specialReturn').disabled = !id;
  }

  function open(opener) {
    returnFocus = opener;
    status.textContent = 'Проверявам наличните снимки…';
    dialog.showModal();
    void actions.specialManifest().then(setManifest);
  }
  entry.addEventListener('click', () => open(entry));
  // The mobile menu closes and returns focus during the same click bubble.
  menuEntry.addEventListener('click', () => setTimeout(() => open(menuEntry), 0));
  dialog.querySelector('#specialClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => returnFocus.focus({ preventScroll: true }));
  const exit = () => { actions.exitSpecial(); if (dialog.open) dialog.close(); };
  back.addEventListener('click', exit);
  dialog.querySelector('#specialReturn').addEventListener('click', exit);
  for (const button of dialog.querySelectorAll('[data-special]')) button.addEventListener('click', async () => {
    status.textContent = `Зареждам „${button.querySelector('strong').textContent}“…`;
    button.disabled = true;
    try {
      const selected = await actions.selectSpecial(button.dataset.special);
      if (selected) dialog.close();
    } catch (error) {
      status.textContent = error.message;
    } finally { button.disabled = !available.has(button.dataset.special); }
  });
  sync(null);
  return { setManifest, sync };
}
