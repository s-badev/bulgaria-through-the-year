export function installMobileSheet(root) {
  const panel = root.querySelector('#panel');
  const openButton = root.querySelector('#mobileOpen');
  const menu = root.querySelector('#mobileMenu');
  const moreButton = root.querySelector('#moreBtn');
  const mobile = matchMedia('(max-width: 820px), (max-height: 500px)');
  const secondary = [...root.querySelector('.tr').querySelectorAll('button:not(#moreBtn)')];
  const placeholders = secondary.map(button => {
    const marker = document.createComment('desktop toolbar position');
    button.before(marker);
    return marker;
  });

  function closePanel() {
    if (!mobile.matches || !panel.classList.contains('is-open')) return false;
    panel.classList.remove('is-open');
    panel.inert = true;
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

  openButton.addEventListener('click', () => {
    closeMenu();
    panel.classList.add('is-open');
    panel.inert = false;
    openButton.classList.add('is-open');
    panel.scrollTop = 0;
    openButton.setAttribute('aria-expanded', 'true');
    root.querySelector('#mobileClose').focus({ preventScroll: true });
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
  root.querySelector('#menuCredits').addEventListener('click', () => root.querySelector('#credits').showModal());

  const titleToggle = root.querySelector('.title-toggle');
  const titleDetails = root.querySelector('#titleDetails');
  titleToggle.addEventListener('click', () => titleDetails.showModal());
  titleDetails.addEventListener('close', () => titleToggle.focus({ preventScroll: true }));
  for (const button of secondary) button.setAttribute('aria-label', button.querySelector('span').textContent);

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
  mobile.addEventListener('change', layout);
  addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  new ResizeObserver(updateViewport).observe(root.querySelector('.top'));
  layout();

  return {
    applied() {
      if (!mobile.matches || !panel.classList.contains('is-open')) return;
      closePanel();
    },
    dismiss() { return closePanel() || closeMenu(); },
  };
}
