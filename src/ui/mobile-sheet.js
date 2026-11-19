export function installMobileSheet(root, openCredits, signal) {
  const panel = root.querySelector('#panel');
  const openButton = root.querySelector('#mobileOpen');
  const menu = root.querySelector('#mobileMenu');
  const moreButton = root.querySelector('#moreBtn');
  const mobile = matchMedia('(max-width: 820px), (max-height: 500px)');
  let pendingOpen;
  // Credits has its own mobile entry. Move only the shared toolbar actions.
  const secondary = [...root.querySelectorAll('.tr button:not(#moreBtn, .desktop-info)')];
  const placeholders = secondary.map(button => {
    const marker = document.createComment('desktop toolbar position');
    button.before(marker);
    return marker;
  });

  function closePanel() {
    clearTimeout(pendingOpen);
    if (!mobile.matches || !panel.classList.contains('is-open')) return false;
    panel.classList.remove('is-open');
    panel.inert = true;
    panel.dispatchEvent(new Event('sheetclose'));
    openButton.classList.remove('is-open');
    openButton.setAttribute('aria-expanded', 'false');
    openButton.focus({ preventScroll: true });
    return true;
  }

  function closeMenu() {
    if (!mobile.matches || !menu.classList.contains('is-open')) return false;
    menu.classList.remove('is-open');
    menu.inert = true;
    moreButton.setAttribute('aria-expanded', 'false');
    moreButton.focus({ preventScroll: true });
    return true;
  }

  function openPanel() {
    clearTimeout(pendingOpen);
    if (signal.aborted || !mobile.matches || document.body.classList.contains('photo')) return;
    if (panel.classList.contains('is-open')) return;
    closeMenu();
    panel.classList.add('is-open');
    panel.inert = false;
    openButton.classList.add('is-open');
    panel.scrollTop = 0;
    openButton.setAttribute('aria-expanded', 'true');
    root.querySelector('#mobileClose').focus({ preventScroll: true });
  }
  openButton.addEventListener('click', openPanel);
  // A captured panorama drag can suppress the next synthesized touch click.
  openButton.addEventListener('pointerup', event => {
    if (event.pointerType === 'touch' && event.isPrimary) pendingOpen = setTimeout(openPanel, 0);
  });
  root.querySelector('#mobileClose').addEventListener('click', closePanel);
  root.querySelector('#mobileDone').addEventListener('click', closePanel);
  moreButton.addEventListener('click', () => {
    if (closeMenu()) return;
    closePanel();
    menu.classList.add('is-open');
    menu.inert = false;
    moreButton.setAttribute('aria-expanded', 'true');
    menu.querySelector('button').focus({ preventScroll: true });
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('button')) closeMenu();
  });
  root.querySelector('#menuCredits').addEventListener('click', () => openCredits(moreButton));

  const titleToggle = root.querySelector('.title-toggle');
  titleToggle.addEventListener('click', () => openCredits(titleToggle));
  const titleHide = root.querySelector('#titleHide');
  const titleRestore = root.querySelector('#titleRestore');
  const titleKey = 'btty.titleHidden';
  function setTitleHidden(hidden) {
    document.body.classList.toggle('title-hidden', hidden);
    try { sessionStorage.setItem(titleKey, hidden ? '1' : '0'); } catch { /* Storage may be blocked in an in-app browser. */ }
    (hidden ? titleRestore : titleHide).focus({ preventScroll: true });
  }
  titleHide.addEventListener('click', () => setTitleHidden(true));
  titleRestore.addEventListener('click', () => setTitleHidden(false));
  try { document.body.classList.toggle('title-hidden', sessionStorage.getItem(titleKey) === '1'); } catch { /* Use the visible title. */ }
  function layout() {
    closePanel();
    closeMenu();
    panel.inert = mobile.matches;
    menu.inert = true;
    secondary.forEach((button, index) => {
      if (mobile.matches) menu.append(button);
      else placeholders[index].after(button);
    });
    updateViewport();
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
    titleToggle.tabIndex = mobile.matches ? 0 : -1;
  }
  mobile.addEventListener('change', layout, { signal });
  addEventListener('resize', updateViewport, { signal });
  window.visualViewport?.addEventListener('resize', updateViewport, { signal });
  window.visualViewport?.addEventListener('scroll', updateViewport, { signal });
  const observer = new ResizeObserver(updateViewport);
  observer.observe(root.querySelector('.top'));
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  layout();

  return {
    applied() {
      if (!mobile.matches || !panel.classList.contains('is-open')) return;
      closePanel();
    },
    dismiss() { return closePanel() || closeMenu(); },
  };
}
