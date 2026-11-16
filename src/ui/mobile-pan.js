/** Touch-only camera movement. The crop stays in the compositor, so the canvas never moves. */
export function installMobilePan(canvas, comp, mobile, reducedMotion) {
  let drag = null, lastTap = null, resetFrame = 0;
  const hint = document.createElement('div');
  hint.className = 'mobile-pan-hint'; hint.setAttribute('role', 'status');
  hint.innerHTML = '<span class="mobile-pan-hint-icons" aria-hidden="true"><span>←</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 13V5a1.5 1.5 0 0 1 3 0v6-1a1.5 1.5 0 0 1 3 0v1-1a1.5 1.5 0 0 1 3 0v2a1.5 1.5 0 0 1 3 0v4c0 3-2 5-5 5h-3c-2 0-3-1-4-2l-4-4a1.5 1.5 0 0 1 2-2l2 2Z"/></svg><span>→</span></span><span>Плъзни наляво или надясно, за да разгледаш София</span>';
  const left = document.createElement('div'), right = document.createElement('div');
  left.className = 'mobile-pan-edge mobile-pan-edge-left'; left.textContent = '‹'; left.setAttribute('aria-hidden', 'true');
  right.className = 'mobile-pan-edge mobile-pan-edge-right'; right.textContent = '›'; right.setAttribute('aria-hidden', 'true');
  canvas.parentElement.append(hint, left, right);
  let hintSeen = false, hintTimer = 0;
  try { hintSeen = sessionStorage.getItem('btty.panHintSeen') === '1'; } catch { /* In-app storage can be blocked. */ }
  const dismissHint = () => { hint.classList.remove('is-visible'); clearTimeout(hintTimer); hintTimer = 0; };
  const update = () => {
    const range = comp.panBounds();
    const available = mobile.matches && comp.coverWidth < 0.999 && range[1] > range[0];
    const covered = document.body.classList.contains('photo') || document.querySelector('#panel.is-open, #mobileMenu.is-open, dialog[open]');
    const showEdges = available && !covered;
    left.classList.toggle('is-visible', showEdges && comp.panX > 0.005);
    right.classList.toggle('is-visible', showEdges && comp.panX < 0.995);
    if (!showEdges) dismissHint();
    if (showEdges && !hintSeen) {
      hintSeen = true;
      try { sessionStorage.setItem('btty.panHintSeen', '1'); } catch { /* Keep the in-memory state. */ }
      hint.classList.add('is-visible');
      hintTimer = setTimeout(dismissHint, 4000);
    }
  };
  const stopReset = () => { if (resetFrame) cancelAnimationFrame(resetFrame); resetFrame = 0; };
  const reset = () => {
    stopReset();
    const start = comp.panX, target = comp.centerPan();
    if (start === null || reducedMotion() || Math.abs(start - target) < 0.001) { comp.setPan(target); return; }
    const began = performance.now();
    const step = now => {
      const t = Math.min(1, (now - began) / 240), eased = t * t * (3 - 2 * t);
      comp.setPan(start + (target - start) * eased);
      resetFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    resetFrame = requestAnimationFrame(step);
  };
  canvas.addEventListener('pointerdown', event => {
    if (drag || !mobile.matches || !event.isPrimary || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
    stopReset();
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.lastX;
    if (Math.abs(event.clientX - drag.startX) > 8 || Math.abs(event.clientY - drag.startY) > 8) drag.moved = true;
    if (Math.abs(event.clientX - drag.startX) > 12 && Math.abs(event.clientX - drag.startX) > Math.abs(event.clientY - drag.startY)) dismissHint();
    if (dx) comp.panByPixels(dx, canvas.clientWidth);
    drag.lastX = event.clientX;
  });
  canvas.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const gesture = drag;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!gesture.moved) {
      const now = performance.now();
      if (lastTap && now - lastTap.time < 320 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 36) {
        lastTap = null; reset();
      } else lastTap = { time: now, x: event.clientX, y: event.clientY };
    } else lastTap = null;
  });
  canvas.addEventListener('pointercancel', event => {
    if (drag?.id === event.pointerId) drag = null;
    lastTap = null;
  });
  canvas.addEventListener('lostpointercapture', event => {
    if (drag?.id === event.pointerId) drag = null;
  });
  return { update };
}
