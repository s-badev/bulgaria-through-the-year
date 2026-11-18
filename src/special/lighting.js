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
  planet: { sky: .82, mountain: .82, city: .82, warm: .38, daylight: .3 },
  aurora: { sky: .08, mountain: .14, city: .1, warm: .04, daylight: .64 },
  'ice-age': { sky: .91, mountain: .83, city: .9, warm: .11, daylight: 0 },
  sandstorm: { sky: .77, mountain: .8, city: .88, warm: .38, daylight: 0 },
  abandoned: { sky: .94, mountain: .84, city: .75, warm: .47, daylight: 0 },
  cyberpunk: { sky: .08, mountain: .1, city: .08, warm: .03, daylight: .55 },
  supercell: { sky: .88, mountain: .86, city: .93, warm: .18, daylight: 0 },
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
    const weatherHaze = ['fog', 'cloudy', 'partly'].includes(setting.condition) ? setting.intensity : this.id === 'ice-age' && setting.condition !== 'light' ? setting.intensity * (setting.condition === 'blizzard' ? 1.4 : .65) : this.id === 'sandstorm' ? setting.intensity * ({ light: .4, strong: .8, extreme: 1.35 }[setting.condition] || .8) : this.id === 'supercell' ? setting.intensity * ({ approaching: .3, heavy: .7, violent: 1.1 }[setting.condition] || .7) : 0;
    const cloud = setting.condition === 'cloudy' ? .23 : setting.condition === 'fog' ? .19 : setting.condition === 'rain' ? .27 : this.id === 'supercell' ? ({ approaching: .08, heavy: .2, violent: .35 }[setting.condition] || .2) : 0;
    const values = {
      sky: mix.night * p.sky * nightScale + mix.day * cloud * setting.intensity,
      mountain: mix.night * p.mountain * nightScale,
      city: mix.night * p.city * nightScale,
      warm: mix.warm * p.warm,
      daylight: mix.day * p.daylight,
      haze: weatherHaze * (this.id === 'abandoned' && setting.condition === 'fog' ? .34 : this.id === 'ice-age' ? .18 : this.id === 'sandstorm' ? .26 : this.id === 'supercell' ? .13 : .08 + mix.twilight * .08),
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

// Saved photographs use the same regional light strengths as the live view.
// Canvas gradients are intentionally drawn only when the visitor saves a frame.
export function paintSpecialLighting(ctx, width, height, values) {
  if (!values) return;
  const layer = (alpha, gradient) => {
    if (alpha < .001) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  };
  const linear = stops => {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    for (const [stop, color] of stops) gradient.addColorStop(stop, color);
    return gradient;
  };
  layer(values.sky, linear([[0, '#081326'], [.23, 'rgba(17,31,51,.94)'], [.37, 'rgba(18,32,50,.46)'], [.52, 'transparent']]));
  layer(values.mountain, linear([[0, 'transparent'], [.28, 'transparent'], [.4, 'rgba(10,24,42,.5)'], [.58, 'transparent']]));
  layer(values.city, linear([[0, 'transparent'], [.3, 'transparent'], [.45, 'rgba(14,27,45,.44)'], [.76, 'rgba(8,19,34,.83)'], [1, '#07111f']]));
  layer(values.daylight, linear([[0, 'rgba(142,168,185,.58)'], [.38, 'rgba(112,144,164,.23)'], [.68, 'transparent']]));
  if (values.warm > .001) {
    const x = values.evening ? width : 0;
    const gradient = ctx.createRadialGradient(x, height * .48, 0, x, height * .48, width * .7);
    gradient.addColorStop(0, 'rgba(207,139,74,.48)'); gradient.addColorStop(1, 'transparent');
    layer(values.warm, gradient);
  }
  if (values.haze > .001) {
    const gradient = ctx.createRadialGradient(width * .5, height * .45, 0, width * .5, height * .45, width * .5);
    gradient.addColorStop(0, 'rgba(196,202,202,.6)'); gradient.addColorStop(1, 'transparent');
    layer(values.haze, gradient);
  }
  ctx.globalAlpha = 1;
}
