import './static-view.css';

export function showStaticView(lite = false, volcano = new URLSearchParams(location.search).get('volcano') === '1') {
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
  app.replaceChildren(view);
}
