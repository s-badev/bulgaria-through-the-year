// Keep the desktop DOM order while making the same controls available in a mobile sheet.
export function installMobileSheet(root) {
  const panel = root.querySelector('#panel');
  const handle = root.querySelector('#sheetHandle');
  const pinned = root.querySelector('.sheet-pinned');
  const time = root.querySelector('.time');
  const now = root.querySelector('#now');
  const timeHome = document.createComment('time control desktop position');
  const nowHome = document.createComment('now control desktop position');
  time.before(timeHome);
  now.before(nowHome);

  const mobile = matchMedia('(max-width: 820px), (max-height: 500px)');
  const short = matchMedia('(max-height: 500px)');
  const compact = matchMedia('(max-width: 419px), (max-height: 499px)');
  const states = ['collapsed', 'medium', 'full'];
  const storageKey = 'btty.mobileSheet';
  let saved;
  try { saved = sessionStorage.getItem(storageKey); } catch { /* Storage can be unavailable in an in-app browser. */ }
  if (!states.includes(saved)) saved = null;
  let current = saved || (short.matches ? 'collapsed' : 'medium');

  function setState(next, remember = true) {
    current = next;
    // Move focus before hiding a control after a keyboard-driven collapse.
    if (mobile.matches && panel.contains(document.activeElement) && !pinned.contains(document.activeElement)) handle.focus({ preventScroll: true });
    panel.dataset.sheet = current;
    handle.setAttribute('aria-expanded', String(current !== 'collapsed'));
    panel.scrollTop = 0;
    if (remember) {
      saved = current;
      try { sessionStorage.setItem(storageKey, current); } catch { /* The sheet still works without storage. */ }
    }
  }

  function layout() {
    if (mobile.matches) {
      pinned.append(time);
      time.append(now);
    } else {
      timeHome.after(time);
      nowHome.after(now);
    }
    setState(saved || (short.matches ? 'collapsed' : 'medium'), false);
    updateViewport();
  }

  handle.addEventListener('click', event => {
    if (suppressClick && event.detail > 0) { suppressClick = false; return; }
    suppressClick = false;
    setState(states[(states.indexOf(current) + 1) % states.length]);
  });
  handle.addEventListener('keydown', event => {
    let index = states.indexOf(current);
    if (event.key === 'ArrowUp') index = Math.min(2, index + 1);
    else if (event.key === 'ArrowDown') index = Math.max(0, index - 1);
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = 2;
    else return; // Enter and Space use the native button click.
    event.preventDefault();
    setState(states[index]);
  });

  let drag = null;
  let suppressClick = false;
  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    drag = { id: event.pointerId, y: event.clientY };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const distance = drag.y - event.clientY;
    drag = null;
    if (Math.abs(distance) < 24) return;
    suppressClick = true;
    const index = states.indexOf(current) + (distance > 0 ? 1 : -1);
    setState(states[Math.max(0, Math.min(2, index))]);
  });
  handle.addEventListener('pointercancel', () => { drag = null; });
  handle.addEventListener('lostpointercapture', () => { drag = null; });

  const title = root.querySelector('.title');
  const titleToggle = root.querySelector('.title-toggle');
  titleToggle.addEventListener('click', () => {
    const expanded = title.classList.toggle('expanded');
    titleToggle.setAttribute('aria-expanded', String(expanded));
  });
  // Icon-only buttons retain their original Bulgarian accessible names.
  for (const button of root.querySelectorAll('.tr button')) {
    button.setAttribute('aria-label', button.querySelector('span').textContent);
  }

  function updateViewport() {
    const viewport = window.visualViewport;
    const height = viewport?.height || innerHeight;
    const top = viewport?.offsetTop || 0;
    const style = document.documentElement.style;
    style.setProperty('--visible-height', `${height}px`);
    style.setProperty('--visible-top', `${top}px`);
    style.setProperty('--visible-bottom', `${Math.max(0, innerHeight - height - top)}px`);
    const headerBottom = root.querySelector('.top').getBoundingClientRect().bottom;
    style.setProperty('--sheet-top', `${Math.max(16, headerBottom - top + 8)}px`);
    titleToggle.tabIndex = compact.matches ? 0 : -1;
  }
  mobile.addEventListener('change', layout);
  short.addEventListener('change', layout);
  compact.addEventListener('change', updateViewport);
  addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  new ResizeObserver(updateViewport).observe(root.querySelector('.top'));
  layout();
}
