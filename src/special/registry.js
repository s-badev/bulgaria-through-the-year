// The photographs define the worlds; effects are deliberately secondary.
export const SPECIAL_BASE = '/scenes/ndk/special/';
const timeVariants = ['day', 'dusk', 'night'];
const overcastVariants = [...timeVariants, 'overcast'];
const overcast = conditions => ({ key: 'overcast', phase: 'day', conditions });
export const SPECIAL_VARIANTS = {
  planet: { keys: overcastVariants, weather: [overcast(['cloudy'])] },
  abandoned: { keys: overcastVariants, files: { dusk: 'abandoned-up.png' }, weather: [overcast(['cloudy', 'rain'])] },
  sandstorm: {
    keys: [...timeVariants, 'haze', 'dusk-alt'],
    files: { dusk: 'sandstorm-dusk.png.png' },
    weather: [
      { key: 'haze', phase: 'day', conditions: ['strong', 'extreme'] },
      { key: 'dusk-alt', phase: 'dusk', conditions: ['extreme'] },
    ],
  },
  cyberpunk: { keys: overcastVariants, files: { dusk: 'Киберпънк София под неоново небе.png' }, weather: [overcast(['cloudy', 'rain'])] },
  flood: { keys: overcastVariants, weather: [overcast(['cloudy', 'heavy-rain', 'storm'])] },
  'ice-age': {
    keys: [...overcastVariants, 'night-alt'],
    transition: { dayDusk: 2, duskNight: 3, seconds: .08 },
    weather: [
      overcast(['cloudy', 'storm', 'blizzard']),
      { key: 'night-alt', phase: 'night', conditions: ['light', 'storm'] },
    ],
  },
};
export const SPECIAL_SCENES = Object.freeze([
  { id: 'planet', name: 'Планета над София', category: 'Космос', source: 'planet.png', basePhase: 'dusk', animation: 'planet-atmosphere', quality: 'light', effects: ['sky-light'], audio: 'planet', fallback: 'image', conditions: [['clear', 'Ясно'], ['partly', 'Разкъсана облачност'], ['cloudy', 'Облачно']], defaultCondition: 'clear' },
  { id: 'aurora', name: 'Полярно сияние', category: 'Небе', source: 'aurora.png', basePhase: 'night', animation: 'aurora-glow', quality: 'light', effects: ['sky-light'], audio: 'aurora', fallback: 'image', conditions: [['clear', 'Ясно'], ['partly', 'Разкъсана облачност']], defaultCondition: 'clear' },
  { id: 'ice-age', name: 'Ледникова София', category: 'Климат', source: 'ice-age.png', basePhase: 'day', animation: 'snow', quality: 'adaptive', effects: ['snow'], audio: 'ice-age', fallback: 'image', conditions: [['light', 'Лек сняг'], ['cloudy', 'Облачно'], ['storm', 'Снежна буря'], ['blizzard', 'Силна виелица']], defaultCondition: 'light' },
  { id: 'sandstorm', name: 'Пясъчна буря', category: 'Климат', source: 'sandstorm.png', basePhase: 'day', animation: 'dust', quality: 'adaptive', effects: ['dust'], audio: 'sandstorm', fallback: 'image', conditions: [['light', 'Лек прах'], ['strong', 'Силна буря'], ['extreme', 'Пясъчна стихия']], defaultCondition: 'strong' },
  { id: 'abandoned', name: 'София след 100 години без хора', category: 'Бъдеще', source: 'abandoned.png', basePhase: 'day', animation: 'quiet-haze', quality: 'light', effects: ['haze'], audio: 'abandoned', fallback: 'image', conditions: [['clear', 'Ясно'], ['cloudy', 'Облачно'], ['fog', 'Мъгла'], ['rain', 'Дъжд']], defaultCondition: 'clear' },
  { id: 'cyberpunk', name: 'София 2150', category: 'Бъдеще', source: 'cyberpunk.png', basePhase: 'night', animation: 'neon', quality: 'adaptive', effects: ['neon'], audio: 'cyberpunk', fallback: 'image', conditions: [['clear', 'Ясно'], ['cloudy', 'Облачно'], ['rain', 'Дъжд'], ['fog', 'Мъгла']], defaultCondition: 'clear' },
  { id: 'supercell', name: 'Суперклетъчна буря', category: 'Климат', source: 'supercell.png', basePhase: 'day', animation: 'storm', quality: 'adaptive', effects: ['rain', 'lightning'], audio: 'supercell', fallback: 'image', conditions: [['approaching', 'Приближаваща буря'], ['heavy', 'Силна буря'], ['violent', 'Мощна буря']], defaultCondition: 'heavy' },
  { id: 'flood', name: 'Големият потоп', category: 'Климат', source: 'flood.png', basePhase: 'day', animation: 'flood', quality: 'adaptive', effects: ['rain', 'water', 'lightning'], audio: 'flood', fallback: 'image', conditions: [['cloudy', 'Облачно'], ['rain', 'Дъжд'], ['heavy-rain', 'Силен дъжд'], ['storm', 'Буря']], defaultCondition: 'cloudy' },
]);

export const specialScene = id => SPECIAL_SCENES.find(scene => scene.id === id) || null;
export const VISIBLE_SPECIAL_SCENES = ['planet', 'abandoned', 'sandstorm', 'cyberpunk', 'flood', 'ice-age'].map(specialScene);

export const FLOOD_RAIN = { cloudy: 0, rain: .55, 'heavy-rain': 1, storm: 1.3 };
