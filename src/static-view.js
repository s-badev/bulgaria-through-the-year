import './static-view.css';

export function showStaticView(lite = false) {
  const app = document.querySelector('#app');
  if (!app || app.querySelector('.static-view')) return;
  document.body.classList.remove('photo');
  const view = document.createElement('main');
  view.className = 'static-view';
  const photo = document.createElement('img');
  photo.src = '/scenes/ndk/photos/master.webp';
  photo.alt = 'София · НДК и Витоша';
  photo.decoding = 'async';
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.textContent = lite
    ? 'Статична снимка на София · НДК и Витоша.'
    : 'Показвам статична снимка. Интерактивният изглед не е достъпен на това устройство.';
  view.append(photo, message);
  app.replaceChildren(view);
}
