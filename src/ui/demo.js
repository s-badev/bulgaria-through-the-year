// Demo: one loop through a day and a year. Runs muted on the first visit, stops at the first touch of a control.
import { lerp } from '../engine/blend.js';

export class Demo {
  constructor(state, ui, life) { this.state = state; this.ui = ui; this.life = life; this.on = false; this.t = 0; this.step = 0; }
  script() {
    const s = this.state, ui = this.ui, set = (y, m, d, w, wind = 0.3) => { s.setDate(y, m, d); s.setWeather(w); s.set('wind', wind); s.set('fogLvl', 0.55); ui.syncDate(); };
    return [
      { at: 0, hours: [19.1, 21.45], dur: 11.5, run: () => { set(2026, 6, 15, 'clear'); this.life.birds.spawn('swallow'); ui.caption('Лято, привечер. Фонтаните работят'); } },
      { at: 3.6, run: () => { this.life.planes.spawn(true); ui.caption('Слънцето залязва вдясно, Витоша порозовява'); } },
      { at: 7.6, run: () => ui.caption('Светват лампите и прозорците, трафикът тече') },
      { at: 11.5, hours: [7.4, 9.2], dur: 5.5, run: () => { set(2026, 9, 20, 'fog', 0.15); ui.caption('Есенна утрин: мъглата скрива града, Витоша остава'); } },
      { at: 17, hours: [16.2, 17.2], dur: 5.5, run: () => { set(2026, 9, 20, 'storm', 0.6); ui.caption('Буря над Витоша, листата летят'); } },
      { at: 22.5, hours: [15.6, 17.9], dur: 7, run: () => { set(2026, 0, 18, 'snow', 0.25); ui.caption('Зима: фонтаните спират, вали сняг'); } },
      { at: 29.5, hours: [7.2, 9.5], dur: 5.5, run: () => { set(2026, 3, 22, 'clear', 0.25); ui.caption('Пролет: утринното слънце идва отляво'); } },
      { at: 35, hours: [12.5, 15], dur: 5, run: () => { set(2026, 6, 15, 'cloudy', 0.4); ui.caption('И пак лято. Сега е твой ред'); } },
      { at: 40, run: () => { this.t = 0; this.step = 0; } },
    ];
  }
  start() { this.on = true; this.t = 0; this.step = 0; this.steps = this.script(); this.seg = null; this.state.set('playing', false); this.ui.syncPlay(); this.ui.setDemo(true); }
  stop() { if (!this.on) return; this.on = false; this.ui.setDemo(false); }
  update(dt) {
    if (!this.on) return;
    this.t += dt;
    while (this.step < this.steps.length && this.t >= this.steps[this.step].at) { const st = this.steps[this.step++]; if (st.hours) this.seg = st; st.run(); if (!this.on) return; }
    const g = this.seg; if (g) { const k = Math.min(1, Math.max(0, (this.t - g.at) / g.dur)); this.state.setHour(lerp(g.hours[0], g.hours[1], k)); this.ui.syncTime(); }
  }
}
