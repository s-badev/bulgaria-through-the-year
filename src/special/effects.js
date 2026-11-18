import { rng } from '../engine/clock.js';

// Weather particles live in the photograph's coordinates. They are deliberately
// sparse: the supplied image carries the scene, including its main weather.
const WIDTH = 836, HEIGHT = 471;
const TYPES = { 'ice-age': 'snow', sandstorm: 'dust', abandoned: 'abandoned', cyberpunk: 'rain', supercell: 'rain' };

export class SpecialEffects {
  constructor(id, layer) {
    this.id = id;
    this.type = TYPES[id] || null;
    this.random = rng([...id].reduce((seed, letter) => seed * 31 + letter.charCodeAt(0), 7));
    this.elapsed = 0;
    this.nextFlash = 8 + this.random() * 10;
    this.flash = 0;
    this.frozen = false;
    if (this.type) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'special-particles';
      this.canvas.width = WIDTH;
      this.canvas.height = HEIGHT;
      this.ctx = this.canvas.getContext('2d', { alpha: true });
      layer.append(this.canvas);
      const count = this.type === 'abandoned' ? 85 : this.type === 'rain' ? 110 : 85;
      this.points = Array.from({ length: count }, () => ({
        x: this.random() * WIDTH, y: this.random() * HEIGHT,
        speed: 0.55 + this.random() * 0.9, size: 0.65 + this.random() * 1.5,
        alpha: 0.22 + this.random() * 0.36, phase: this.random() * Math.PI * 2,
      }));
    }
    if (id === 'supercell') {
      this.lightning = document.createElement('div');
      this.lightning.className = 'special-flash';
      layer.append(this.lightning);
    }
  }

  update(dt, detail, reduced, flashes, setting = {}, light = {}) {
    if (document.hidden || !this.ctx && !this.lightning) return;
    if (reduced) {
      if (!this.frozen) this.ctx?.clearRect(0, 0, WIDTH, HEIGHT);
      this.frozen = true;
      if (this.lightning) this.lightning.style.opacity = '0';
      return;
    }
    this.frozen = false;
    this.elapsed += dt;
    if (this.ctx) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      const mobile = matchMedia('(max-width: 820px), (max-height: 500px)').matches;
      const condition = setting.condition;
      const weatherStrength = .35 + .65 * setting.intensity;
      const snowStrength = this.type === 'snow' ? ({ light: .45, storm: 1, blizzard: 1.55 }[condition] || .45) * weatherStrength : 1;
      const dustStrength = this.type === 'dust' ? ({ light: .35, strong: .85, extreme: 1.35 }[condition] || .85) : 1;
      const rainStrength = this.id === 'cyberpunk' && condition !== 'rain' ? 0 : this.id === 'supercell' ? ({ approaching: .35, heavy: .85, violent: 1.3 }[condition] || .85) : 1;
      const count = this.type === 'abandoned' && condition !== 'rain'
        ? (light.day > .3 && condition !== 'fog' ? Math.max(1, Math.round(3 * detail)) : 0)
        : rainStrength === 0 ? 0 : Math.min(this.points.length, Math.max(10, Math.round(this.points.length * detail * (mobile ? 0.48 : 1) * weatherStrength * snowStrength * dustStrength * rainStrength)));
      for (let index = 0; index < count; index++) {
        const point = this.points[index];
        if (this.type === 'snow') {
          point.y += dt * (12 + 14 * snowStrength) * point.speed;
          point.x += dt * (4 + 21 * snowStrength + 5 * Math.sin(this.elapsed * .35 + point.phase));
          if (point.y > HEIGHT + 3) { point.y = -3; point.x = this.random() * WIDTH; }
          if (point.x > WIDTH + 3) point.x = -3;
          ctx.fillStyle = `rgba(219,235,252,${point.alpha * (.24 + .76 * light.day + .14 * light.twilight)})`;
          ctx.beginPath(); ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2); ctx.fill();
        } else if (this.type === 'dust') {
          point.x += dt * 26 * point.speed * dustStrength * (1 + .35 * Math.sin(this.elapsed * .37));
          point.y += dt * (1.5 + Math.sin(this.elapsed + point.phase));
          if (point.x > WIDTH + 12) { point.x = -12; point.y = this.random() * HEIGHT; }
          if (point.y > HEIGHT) point.y = 0;
          ctx.strokeStyle = `rgba(235,200,151,${point.alpha * .6 * weatherStrength})`;
          ctx.lineWidth = point.size * .55;
          ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(point.x - 4 * point.speed, point.y + .6); ctx.stroke();
        } else if (this.type === 'rain' || this.type === 'abandoned' && condition === 'rain') {
          point.x -= dt * 29 * point.speed * rainStrength;
          point.y += dt * 185 * point.speed * rainStrength;
          if (point.y > HEIGHT + 12 || point.x < -12) { point.y = -12; point.x = this.random() * WIDTH; }
          ctx.strokeStyle = `rgba(202,215,231,${point.alpha * (this.type === 'abandoned' ? .35 : .52) * weatherStrength})`;
          ctx.lineWidth = .65;
          ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(point.x - 2.2 * point.speed, point.y + 7 * point.speed); ctx.stroke();
        } else {
          point.x += dt * (3 + 2 * point.speed);
          if (point.x > WIDTH + 10) point.x = -10;
          const x = point.x, y = 85 + point.phase * 9 + Math.sin(this.elapsed * .45 + point.phase) * 3;
          const wing = 1.8 + Math.sin(this.elapsed * 3 + point.phase) * .7;
          ctx.strokeStyle = `rgba(30,39,45,${.5 * light.day})`; ctx.lineWidth = .8;
          ctx.beginPath(); ctx.moveTo(x - 2.5, y - wing); ctx.lineTo(x, y); ctx.lineTo(x + 2.5, y - wing); ctx.stroke();
        }
      }
    }
    if (this.lightning) {
      if (!flashes) {
        this.flash = 0;
        if (this.elapsed >= this.nextFlash) this.nextFlash = this.elapsed + 9 + this.random() * 14;
      }
      else if (this.elapsed >= this.nextFlash) {
        const storm = { approaching: .4, heavy: .8, violent: 1.35 }[setting.condition] || .8;
        this.flash = (.1 + .14 * setting.intensity) * storm;
        this.nextFlash = this.elapsed + (8 + this.random() * 12) / storm;
        this.lightning.style.opacity = String(this.flash);
        return true;
      }
      this.flash *= Math.exp(-dt / .12);
      this.lightning.style.opacity = String(this.flash);
    }
  }

  destroy() {
    this.points = null;
    this.canvas?.remove();
    this.lightning?.remove();
  }
}
