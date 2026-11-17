import { formatClock, sunTimes, utcToSofia } from '../engine/sun.js';

/** The mobile view reads the shared state; "Now" resyncs that same state once a minute. */
export function installMobileClock(root, state, togglePlayback, icons) {
  const card = document.createElement('div');
  card.className = 'mobile-clock'; card.id = 'mobileClock'; card.setAttribute('aria-live', 'off');
  card.innerHTML = `<div class="mobile-clock-head"><span id="mobileClockSource"></span><span id="mobileClockDate"></span></div>
    <div class="mobile-clock-main"><strong id="mobileClockTime"></strong><button class="mobile-clock-play" id="mobileClockPlay" type="button"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" id="mobileClockPlayIcon">${icons.play}</svg><span id="mobileClockPlayLabel"></span></button></div>
    <span class="mobile-clock-next" id="mobileClockNext"></span>`;
  root.append(card);
  const source = card.querySelector('#mobileClockSource'), date = card.querySelector('#mobileClockDate');
  const time = card.querySelector('#mobileClockTime'), next = card.querySelector('#mobileClockNext');
  const play = card.querySelector('#mobileClockPlay'), playIcon = card.querySelector('#mobileClockPlayIcon'), playLabel = card.querySelector('#mobileClockPlayLabel');
  const S = state.S;
  let realNow = false, realMinute = -1, tomorrowKey = '', tomorrowRise = null;
  const mobile = matchMedia('(max-width: 820px), (max-height: 500px)');

  function upcomingSun() {
    const { rise, set } = state.times;
    if (rise !== null && S.hour < rise) return `Следва изгрев ${formatClock(rise)}`;
    if (set !== null && S.hour < set) return `Следва залез ${formatClock(set)}`;
    const key = `${S.y}-${S.m}-${S.d}`;
    if (key !== tomorrowKey) {
      const date = new Date(Date.UTC(S.y, S.m, S.d + 1));
      tomorrowRise = sunTimes(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), state.loc.lat, state.loc.lon).rise;
      tomorrowKey = key;
    }
    return `Следва изгрев утре ${formatClock(tomorrowRise)}`;
  }
  function sync() {
    if (S.playing) realNow = false;
    const values = [realNow ? 'София сега' : 'Симулация', `${String(S.d).padStart(2, '0')}.${String(S.m + 1).padStart(2, '0')}.${S.y}`, formatClock(S.hour), upcomingSun()];
    for (const [node, value] of [[source, values[0]], [date, values[1]], [time, values[2]], [next, values[3]]]) if (node.textContent !== value) node.textContent = value;
    const label = S.playing ? 'Пауза' : 'Пусни';
    if (playLabel.textContent !== label) {
      playLabel.textContent = label;
      playIcon.innerHTML = S.playing ? icons.pause : icons.play;
      play.setAttribute('aria-label', S.playing ? 'Постави симулацията на пауза' : 'Пусни симулацията');
    }
  }
  play.addEventListener('click', togglePlayback);
  state.on(what => { if (['tick', 'date', 'hour', 'playing'].includes(what)) sync(); });
  sync();
  return {
    sync,
    markRealNow() { realNow = true; realMinute = Math.floor(Date.now() / 60000); sync(); },
    markSimulated() { realNow = false; sync(); },
    refreshRealNow() {
      if (!mobile.matches || !realNow || S.playing) return;
      const ms = Date.now(), minute = Math.floor(ms / 60000);
      if (minute === realMinute) return;
      realMinute = minute;
      const now = utcToSofia(ms);
      if (now.y !== S.y || now.m !== S.m || now.d !== S.d) state.setDate(now.y, now.m, now.d);
      state.setHour(now.hour);
      return true;
    },
  };
}
