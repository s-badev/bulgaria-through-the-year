// Development only (never in the production bundle): key D shows what the traffic system believes about the road —
// the strict asphalt mask, the lanes with direction arrows, hide segments, spawn and despawn points, the signal and the live cars.
export function install({ scene, comp, life, clock }) {
  const cv = document.createElement('canvas');
  Object.assign(cv.style, { position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 30, display: 'none' });
  document.body.append(cv); const g = cv.getContext('2d'); let on = false, maskCanvas = null, maskSet = '';
  const [W, H] = scene.size;
  const toScreen = (x, y) => { const v = comp.view, u = 0.5 + (x / W - 0.5) * v.zoom, w = 0.5 + (y / H - 0.5) * v.zoom; return [(u - v.cov[0]) / v.cov[2] * cv.width, (w - v.cov[1]) / v.cov[3] * cv.height]; };
  function mask(set) {
    if (maskCanvas && maskSet === set) return maskCanvas;
    const m = scene.cpu.road, c = document.createElement('canvas'); c.width = m.w; c.height = m.h; const x = c.getContext('2d'), id = x.createImageData(m.w, m.h), ch = set === 'autumn' ? 1 : 0;
    for (let i = 0; i < m.w * m.h; i++) if (m.data[i * 4 + ch]) { id.data[i * 4] = 40; id.data[i * 4 + 1] = 255; id.data[i * 4 + 2] = 120; id.data[i * 4 + 3] = 110; }
    x.putImageData(id, 0, 0); maskCanvas = c; maskSet = set; return c;
  }
  function draw() {
    if (!on) return;
    cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; g.clearRect(0, 0, cv.width, cv.height);
    const T = life.traffic; if (!T) return;
    const [x0, y0] = toScreen(0, 0), [x1, y1] = toScreen(W, H); g.imageSmoothingEnabled = false; g.drawImage(mask(T.setName), x0, y0, x1 - x0, y1 - y0);
    const k = (x1 - x0) / W;
    for (const lane of T.lanes) {
      for (const [vis, col, dash] of [[1, '#ffe14a', []], [0, '#ff4040', [4, 4]]]) {
        g.beginPath(); g.strokeStyle = col; g.lineWidth = Math.max(1.5, k * 0.9); g.setLineDash(dash); let pen = false;
        lane.pts.forEach(p => { if (!!p[3] === !!vis) { const [x, y] = toScreen(p[0], p[1]); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; } else pen = false; }); g.stroke();
      }
      g.setLineDash([]);
      for (let i = 20; i < lane.pts.length - 4; i += 45) { const a = toScreen(lane.pts[i][0], lane.pts[i][1]), b = toScreen(lane.pts[i + 4][0], lane.pts[i + 4][1]), an = Math.atan2(b[1] - a[1], b[0] - a[0]); g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - 9 * Math.cos(an - 0.5), b[1] - 9 * Math.sin(an - 0.5)); g.moveTo(b[0], b[1]); g.lineTo(b[0] - 9 * Math.cos(an + 0.5), b[1] - 9 * Math.sin(an + 0.5)); g.strokeStyle = '#ffe14a'; g.stroke(); }
      const s = toScreen(lane.pts[0][0], lane.pts[0][1]), e = toScreen(lane.pts[lane.pts.length - 1][0], lane.pts[lane.pts.length - 1][1]);
      g.fillStyle = '#3cff6a'; g.beginPath(); g.arc(s[0], s[1], 5, 0, 7); g.fill(); g.fillStyle = '#ff3c3c'; g.fillRect(e[0] - 4, e[1] - 4, 8, 8);
      g.font = '11px system-ui'; g.fillStyle = '#fff'; g.fillText(`${lane.id} · spawn (${lane.start})`, s[0] + 8, s[1] + 4); g.fillText(`despawn (${lane.end})`, e[0] + 8, e[1] + 4);
      if (lane.signalM != null) { const p = lane.pts[lane.signalM], q = toScreen(p[0], p[1]); g.fillStyle = T.red(lane) ? '#ff2a2a' : '#2aff5a'; g.fillRect(q[0] - 7, q[1] - 2, 14, 4); }
      g.fillStyle = '#35e0ff'; for (const c of lane.cars) { const P = T.at(lane, c.s, {}); if (!P.vis) continue; const q = toScreen(P.x, P.y); g.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3); }
    }
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(10, cv.height - 54, 520, 44); g.fillStyle = '#fff'; g.font = '13px system-ui';
    g.fillText(`DEBUG (D): asphalt mask · lanes [${T.setName}] · cars ${T.count} · sprites from "${T.lib}"`, 18, cv.height - 36);
    g.fillText('yellow = lane on visible asphalt, red dashed = hide segment, green dot = spawn, red square = despawn', 18, cv.height - 18);
  }
  addEventListener('keydown', e => { if ((e.key === 'd' || e.key === 'D' || e.key === 'д' || e.key === 'Д') && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement && e.target.type !== 'range')) { on = !on; cv.style.display = on ? 'block' : 'none'; } });
  clock.add(draw);
  return { toggle(v) { on = v ?? !on; cv.style.display = on ? 'block' : 'none'; draw(); } };
}
