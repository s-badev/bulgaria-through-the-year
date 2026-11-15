// Interface (Bulgarian): time, season, weather, wind, fog, sound, "Сега", "Без проблясвания", photo mode, demo.
import './ui.css';
import { formatClock } from '../engine/sun.js';
import { snowAllowed } from '../engine/blend.js';

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const SEASONS = [['spring', 'Пролет'], ['summer', 'Лято'], ['autumn', 'Есен'], ['winter', 'Зима']];
const WEATHERS = [['clear', 'Ясно'], ['cloudy', 'Облачно'], ['fog', 'Мъгла'], ['rain', 'Дъжд'], ['storm', 'Буря'], ['snow', 'Сняг']];
const ICON = {
  panel: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="9" width="12" height="5" rx="1.5"/><path d="M5 5.5 8 2.5l3 3"/></svg>',
  play: '<path d="M4 2.5v11l9-5.5z"/>', pause: '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/>',
  flash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/></svg>',
  sound: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z"/><path class="wave" d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8" opacity=".35"/></svg>',
  camera: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="1.5" y="4.5" width="13" height="9" rx="2"/><circle cx="8" cy="9" r="2.6"/><path d="M5.5 4.5 6.5 2.5h3l1 2"/></svg>',
};
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export function buildUI({ state, scene, version, actions }) {
  const cfg = scene.cfg, root = document.querySelector('#app'), $ = s => root.querySelector(s);
  root.append(h(`<div class="top" id="top">
    <div class="title"><h1>${cfg.title}</h1><p>${cfg.subtitle} · слънцето е изчислено за ${cfg.location.name}</p><div class="readout" id="readout"></div></div>
    <div class="tr" role="toolbar" aria-label="Режими">
      <button class="chip" id="panelBtn" type="button" aria-pressed="false" title="Скрий всичко (клавиш H)">${ICON.panel}<span>Само снимката</span></button>
      <button class="chip" id="shotBtn" type="button" title="Запази кадъра като PNG">${ICON.camera}<span>Запази кадър</span></button>
      <button class="chip" id="demoBtn" type="button"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${ICON.play}</svg><span>Демо</span></button>
      <button class="chip" id="flashBtn" type="button" aria-pressed="false">${ICON.flash}<span>Без проблясвания</span></button>
      <button class="chip" id="soundBtn" type="button" aria-pressed="false">${ICON.sound}<span id="soundLbl">Включи звука</span></button>
    </div></div>`));
  root.append(h(`<div class="demo-bar" id="demoBar" role="status"><span>Демо</span><button type="button" id="demoStop">Спри</button></div>`));
  root.append(h(`<div class="caption" id="caption" aria-live="polite"></div>`));
  root.append(h(`<section class="panel" id="panel" aria-label="Управление на сцената">
    <button class="sheet-handle" id="sheetHandle" type="button" aria-expanded="true" aria-controls="panel" aria-label="Свий или разгъни управлението"><i></i></button>
    <div class="row row-time">
      <div class="time"><span class="lab" id="hourLab">Час</span>
        <button class="play" id="play" type="button" aria-label="Пусни деня"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" id="playIco">${ICON.play}</svg></button>
        <span class="clock" id="clock" aria-hidden="true">18:45</span>
        <label class="sr" for="hour">Час на деня</label><input id="hour" type="range" min="0" max="24" step="0.01" value="18.75" aria-valuetext="18:45">
      </div>
      <div class="grp"><span class="lab">Сезон</span>
        <div class="seg" id="seasons" role="group" aria-label="Сезон">${SEASONS.map(([k, n]) => `<button type="button" data-s="${k}" aria-pressed="false">${n}</button>`).join('')}</div>
        <label class="sr" for="date">Дата</label><input id="date" type="date" min="2000-01-01" max="2099-12-31">
      </div>
    </div>
    <div class="row">
      <div class="grp"><span class="lab">Време</span>
        <div class="seg" id="weather" role="group" aria-label="Време">${WEATHERS.map(([k, n]) => `<button type="button" data-w="${k}" aria-pressed="false">${n}</button>`).join('')}</div>
        <button class="sec now" id="now" type="button" title="Реалният час и времето в София в момента">Сега</button>
      </div>
      <div class="sl"><span class="lab">Вятър</span><label class="sr" for="wind">Сила на вятъра</label><input id="wind" type="range" min="0" max="1" step="0.01" value="0.3"></div>
      <div class="sl"><span class="lab">Мъгла</span><label class="sr" for="fogLvl">Гъстота и височина на мъглата</label><input id="fogLvl" type="range" min="0" max="1" step="0.01" value="0.55"></div>
      <div class="sl" style="max-width:220px"><span class="lab">Звук</span><label class="sr" for="vol">Сила на звука</label><input id="vol" type="range" min="0" max="1" step="0.01" value="0.7"></div>
    </div>
    <div class="note"><span><span class="long">Истинска снимка на автора; сезоните и времето са върху нейни варианти. </span>Слънцето, изгревът и залезът са изчислени за София. Звукът е синтезиран. Симулация, не прогноза.</span><span class="foot"><button type="button" class="linkbtn" id="creditsBtn" aria-haspopup="dialog">Информация и права</button><span class="stamp" id="version" title="Версия: комит и време на компилация">${version}</span></span></div>
  </section>`));
  root.append(h(`<button class="chip photo-exit" id="photoExit" type="button">Покажи управлението (H)</button>`));
  root.append(h(`<div class="intro gone" id="intro" role="dialog" aria-labelledby="introTitle" aria-describedby="introText">
    <h2 id="introTitle">Жива снимка на София</h2>
    <p id="introText">НДК, Южният парк и Витоша през денонощието, сезоните и времето. Демото върви зад този прозорец без звук. Плъзни часа, смени сезона, пусни мъгла, буря или сняг, или натисни „Сега“ за реалното време в София.</p>
    <div class="btns"><button class="pri" id="introSound" type="button">Демо със звук</button><button class="sec" id="introKeep" type="button">Гледай демото</button><button class="sec" id="introExplore" type="button">Разгледай сам</button></div></div>`));
  root.append(h(`<dialog class="credits" id="credits" aria-labelledby="creditsTitle">
    <h2 id="creditsTitle">Информация и права</h2>
    <p>Снимката на НДК е на автора на проекта. Вариантите за сезони, час и време са направени с изкуствен интелект върху нея, а маските, дълбочината и движението са изчислени. Всички изображения: <b>всички права запазени</b>. Изходният код: MIT (виж <a href="./THIRD-PARTY-LICENSES.txt" target="_blank" rel="noopener">пълните лицензи</a>).</p>
    <ul>
      <li><b>Дълбочина:</b> Depth Anything V2 Small (Apache-2.0), Yang и др., 2024.</li>
      <li><b>Времето:</b> данни от <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0), само при натискане на „Сега“.</li>
      <li><b>Слънцето:</b> алгоритъм на NOAA Solar Calculator (Jean Meeus), изчислено за София; изгрев и залез са намерени чрез търсене.</li>
      <li><b>Шрифт:</b> Manrope, © The Manrope Project Authors (SIL Open Font License 1.1).</li>
    </ul>
    <p class="muted">Симулация, не прогноза. Звукът е синтезиран в браузъра. Приложението не събира данни и не ползва бисквитки; в браузъра се пази само бележка, че си видял въведението.</p>
    <div class="btns"><button type="button" class="pri" id="creditsClose">Затвори</button></div>
  </dialog>`));
  root.append(h(`<div class="toast" id="toast" role="status" aria-live="polite"></div>`));

  const hourEl = $('#hour'), clockEl = $('#clock'), dateEl = $('#date'), S = state.S;
  const ui = {
    toast(msg, ms = 5200) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(ui._tt); ui._tt = setTimeout(() => t.classList.remove('on'), ms); },
    caption(txt, ms = 2800) { const c = $('#caption'); c.textContent = txt; c.classList.add('on'); clearTimeout(ui._ct); ui._ct = setTimeout(() => c.classList.remove('on'), ms); },
    syncTime() { hourEl.value = S.hour.toFixed(2); const f = formatClock(S.hour); if (clockEl.textContent !== f) { clockEl.textContent = f; hourEl.setAttribute('aria-valuetext', f); } },
    syncDate() { dateEl.value = `${S.y}-${String(S.m + 1).padStart(2, '0')}-${String(S.d).padStart(2, '0')}`; const cur = state.seasonName; root.querySelectorAll('#seasons button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === cur))); ui.syncWeather(); },
    syncWeather() {
      root.querySelectorAll('#weather button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.w === S.weather)); if (b.dataset.w === 'snow') b.title = snowAllowed(state.doy) ? '' : 'През топлите месеци вали дъжд, не сняг'; });
      $('#wind').value = S.wind; $('#fogLvl').value = S.fogLvl;
    },
    syncPlay() { $('#playIco').innerHTML = S.playing ? ICON.pause : ICON.play; $('#play').setAttribute('aria-label', S.playing ? 'Спри деня' : 'Пусни деня'); },
    syncSound() { const on = S.sound; $('#soundBtn').setAttribute('aria-pressed', String(on)); $('#soundLbl').textContent = on ? 'Звук: включен' : 'Включи звука'; $('#soundBtn .wave').setAttribute('opacity', on ? '1' : '.35'); },
    syncFlash() { $('#flashBtn').setAttribute('aria-pressed', String(!S.flashes)); },
    readout(alt) {
      const pos = alt > 0.5 ? `Слънцето е ${Math.round(alt)}° над хоризонта` : alt > -0.833 ? 'Слънцето е на хоризонта' : `Слънцето е ${Math.round(-alt)}° под хоризонта`;
      const html = `<b>${S.d} ${MONTHS[S.m]} ${S.y} · ${formatClock(S.hour)}</b><br>${pos}<br>Изгрев ${formatClock(state.times.rise)} · Залез ${formatClock(state.times.set)}`;
      if (html !== ui._ro) { ui._ro = html; $('#readout').innerHTML = html; }
    },
    setPhotoMode(on) { document.body.classList.toggle('photo', on); $('#panelBtn').setAttribute('aria-pressed', String(on)); if (on) { $('#photoExit').focus({ preventScroll: true }); ui.toast('Само снимката. Натисни H или Esc, за да върнеш управлението.', 2600); } else $('#panelBtn').focus({ preventScroll: true }); },
    get photoMode() { return document.body.classList.contains('photo'); },
    setDemo(on) { $('#demoBar').classList.toggle('on', on); },
    showIntro(reduced) { if (reduced) { $('#introText').textContent += ' Включено е намалено движение, затова демото не тръгва само.'; $('#introKeep').hidden = true; $('#introSound').textContent = 'Включи звука'; } $('#intro').classList.remove('gone'); $('#introExplore').focus({ preventScroll: true }); },
    hideIntro() { $('#intro').classList.add('gone'); },
  };
  // ---- events ----
  hourEl.addEventListener('input', () => { actions.user(); state.setHour(+hourEl.value); ui.syncTime(); });
  $('#play').addEventListener('click', () => { actions.user(); state.set('playing', !S.playing); ui.syncPlay(); });
  root.querySelectorAll('#seasons button').forEach(b => b.addEventListener('click', () => { actions.user(); state.setSeason(b.dataset.s); ui.syncDate(); if (S.weather === 'snow' && !snowAllowed(state.doy)) ui.toast('През топлите месеци не вали сняг: времето „Сняг“ се показва като дъжд.'); }));
  dateEl.addEventListener('change', () => { const m = dateEl.value.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) { actions.user(); state.setDate(+m[1], +m[2] - 1, +m[3]); ui.syncDate(); } });
  root.querySelectorAll('#weather button').forEach(b => b.addEventListener('click', () => {
    actions.user(); state.setWeather(b.dataset.w); ui.syncWeather();
    if (b.dataset.w === 'snow' && !snowAllowed(state.doy)) ui.toast('През топлите месеци не вали сняг: показвам дъжд. Избери зима или късна есен за сняг.');
  }));
  $('#wind').addEventListener('input', e => { actions.user(); state.set('wind', +e.target.value); });
  $('#fogLvl').addEventListener('input', e => { actions.user(); state.set('fogLvl', +e.target.value); });
  $('#vol').addEventListener('input', e => { state.set('vol', +e.target.value); actions.volume(+e.target.value); });
  $('#soundBtn').addEventListener('click', () => { actions.sound(!S.sound); ui.syncSound(); });
  $('#flashBtn').addEventListener('click', () => { state.set('flashes', !S.flashes); ui.syncFlash(); ui.toast(S.flashes ? 'Проблясванията на мълниите са включени.' : 'Без проблясвания: мълниите само меко осветяват облаците.', 2600); });
  $('#panelBtn').addEventListener('click', () => ui.setPhotoMode(!ui.photoMode));
  $('#photoExit').addEventListener('click', () => ui.setPhotoMode(false));
  $('#shotBtn').addEventListener('click', () => actions.saveFrame());
  $('#demoBtn').addEventListener('click', () => actions.demo(true));
  $('#demoStop').addEventListener('click', () => actions.demo(false));
  $('#now').addEventListener('click', async () => { const b = $('#now'); b.disabled = true; try { await actions.now(); } finally { b.disabled = false; ui.syncTime(); ui.syncDate(); } });
  $('#introSound').addEventListener('click', () => { actions.sound(true); ui.syncSound(); ui.hideIntro(); if (!S.reducedMotion) actions.demo(true, true); });
  $('#introKeep').addEventListener('click', () => ui.hideIntro());
  $('#introExplore').addEventListener('click', () => { actions.demo(false); ui.hideIntro(); });
  const dlg = $('#credits'), opener = $('#creditsBtn');
  opener.addEventListener('click', () => dlg.showModal());
  $('#creditsClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // click on the backdrop
  dlg.addEventListener('close', () => opener.focus({ preventScroll: true }));
  $('#sheetHandle').addEventListener('click', () => { const c = $('#panel').classList.toggle('collapsed'); $('#sheetHandle').setAttribute('aria-expanded', String(!c)); });
  addEventListener('keydown', e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || dlg.open) return;   // a modal dialog owns the keyboard
    const typing = e.target instanceof HTMLInputElement && e.target.type !== 'range';
    if ((e.key === 'h' || e.key === 'H' || e.key === 'х' || e.key === 'Х') && !typing) { ui.setPhotoMode(!ui.photoMode); e.preventDefault(); }
    else if (e.key === 'Escape') { if (ui.photoMode) ui.setPhotoMode(false); else if (!$('#intro').classList.contains('gone')) { actions.demo(false); ui.hideIntro(); } else actions.demo(false); }
  });
  // phones: the sheet starts collapsed (time row only) so the photograph stays visible
  if (matchMedia('(max-width: 820px)').matches) { $('#panel').classList.add('collapsed'); $('#sheetHandle').setAttribute('aria-expanded', 'false'); }
  ui.syncTime(); ui.syncDate(); ui.syncPlay(); ui.syncSound(); ui.syncFlash();
  return ui;
}
