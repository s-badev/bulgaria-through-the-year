// Relative levels for the existing Web Audio noise buses. None is music.
export const SPECIAL_AUDIO = Object.freeze({
  planet: { wind: .09, highWind: .008, rain: 0, city: .025, drone: 0, event: null },
  aurora: { wind: .08, highWind: .006, rain: 0, city: .015, drone: 0, event: null },
  'ice-age': { wind: .24, highWind: .022, rain: 0, city: 0, drone: 0, event: 'ice' },
  sandstorm: { wind: .28, highWind: .04, rain: 0, city: 0, drone: 0, event: null },
  abandoned: { wind: .1, highWind: .007, rain: 0, city: 0, drone: 0, event: 'creak' },
  cyberpunk: { wind: .045, highWind: .004, rain: 0, city: .07, drone: .035, event: null },
  supercell: { wind: .2, highWind: .025, rain: .18, city: .012, drone: 0, event: null },
});
