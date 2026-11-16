/** Touch-only camera movement. The crop stays in the compositor, so the canvas never moves. */
export function installMobilePan(canvas, comp, mobile, reducedMotion) {
  let drag = null, lastTap = null, resetFrame = 0;
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
}
