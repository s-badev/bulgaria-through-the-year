// One solar timeline for every world. Photographic plates take priority; these
// region masks are deliberately limited approximations when plates are absent.
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function solarMix(sun) {
  const altitude = sun.elevation;
  const day = smooth(-3, 9, altitude);
  const night = 1 - smooth(-11, -3, altitude);
  const twilight = Math.max(0, 1 - day - night);
  const warm = (1 - smooth(9, 28, altitude)) * smooth(-7, 2, altitude);
  return { day, night, twilight, warm, evening: sun.hourAngle >= 0 };
}

const PROFILES = {
  planet: { sky: .82, mountain: .77, city: .66, warm: .38, daylight: .16 },
  aurora: { sky: .08, mountain: .14, city: .1, warm: .04, daylight: .46 },
  'ice-age': { sky: .91, mountain: .83, city: .9, warm: .11, daylight: 0 },
  sandstorm: { sky: .77, mountain: .73, city: .64, warm: .38, daylight: 0 },
  abandoned: { sky: .94, mountain: .84, city: .75, warm: .47, daylight: 0 },
  cyberpunk: { sky: .08, mountain: .1, city: .08, warm: .03, daylight: .42 },
  supercell: { sky: .83, mountain: .8, city: .68, warm: .18, daylight: 0 },
};

export class SpecialLighting {
  constructor(id, layer) {
    this.id = id;
    this.profile = PROFILES[id];
    this.root = document.createElement('div');
    this.root.className = 'special-lighting';
    this.root.innerHTML = '<div class="special-light-sky"></div><div class="special-light-mountain"></div><div class="special-light-city"></div><div class="special-light-warm"></div><div class="special-light-day"></div><div class="special-light-haze"></div><div class="special-light-moon"></div>';
    layer.append(this.root);
    this.values = null;
  }

  update(state, setting, photographicNight = false) {
    const mix = solarMix(state.sun), p = this.profile;
    const nightScale = photographicNight ? .14 : 1;
    const weatherHaze = ['fog', 'cloudy', 'partly'].includes(setting.condition) ? setting.intensity : this.id === 'ice-age' && setting.condition !== 'light' ? setting.intensity * (setting.condition === 'blizzard' ? 1.4 : .65) : 0;
    const cloud = setting.condition === 'cloudy' ? .23 : setting.condition === 'fog' ? .19 : setting.condition === 'rain' ? .27 : 0;
    const values = {
      sky: mix.night * p.sky * nightScale + mix.day * cloud * setting.intensity,
      mountain: mix.night * p.mountain * nightScale,
      city: mix.night * p.city * nightScale,
      warm: mix.warm * p.warm,
      daylight: mix.day * p.daylight,
      haze: weatherHaze * (this.id === 'abandoned' && setting.condition === 'fog' ? .34 : this.id === 'ice-age' ? .18 : .08 + mix.twilight * .08),
      moon: mix.night * (this.id === 'abandoned' ? .11 : this.id === 'ice-age' ? .13 : .04) * (setting.condition === 'clear' || setting.condition === 'light' ? 1 : .2),
    };
    this.values = { ...mix, ...values };
    const elements = this.root.children;
    for (const [index, key] of ['sky', 'mountain', 'city', 'warm', 'daylight', 'haze', 'moon'].entries()) {
      const value = values[key];
      if (Math.abs(+(elements[index].style.opacity || 0) - value) > .003) elements[index].style.opacity = value.toFixed(3);
    }
    this.root.classList.toggle('is-evening', mix.evening);
    return this.values;
  }
}
