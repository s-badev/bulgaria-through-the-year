// The photographs define the worlds; effects are deliberately secondary.
export const SPECIAL_BASE = '/scenes/ndk/special/';
export const SPECIAL_SCENES = Object.freeze([
  { id: 'planet', name: 'Планета над София', category: 'Космос', source: 'planet.png', basePhase: 'dusk', animation: 'planet-atmosphere', quality: 'light', effects: ['sky-light'], audio: 'planet', fallback: 'image', conditions: [['clear', 'Ясно'], ['partly', 'Разкъсана облачност'], ['cloudy', 'Облачно']], defaultCondition: 'clear' },
  { id: 'aurora', name: 'Полярно сияние', category: 'Небе', source: 'aurora.png', basePhase: 'night', animation: 'aurora-glow', quality: 'light', effects: ['sky-light'], audio: 'aurora', fallback: 'image', conditions: [['clear', 'Ясно'], ['partly', 'Разкъсана облачност']], defaultCondition: 'clear' },
  { id: 'ice-age', name: 'Ледникова София', category: 'Климат', source: 'ice-age.png', basePhase: 'day', animation: 'snow', quality: 'adaptive', effects: ['snow'], audio: 'ice-age', fallback: 'image', conditions: [['light', 'Лек сняг'], ['storm', 'Снежна буря'], ['blizzard', 'Силна виелица']], defaultCondition: 'light' },
  { id: 'sandstorm', name: 'Пясъчна буря', category: 'Климат', source: 'sandstorm.png', basePhase: 'day', animation: 'dust', quality: 'adaptive', effects: ['dust'], audio: 'sandstorm', fallback: 'image', conditions: [['light', 'Лек прах'], ['strong', 'Силна буря'], ['extreme', 'Пясъчна стихия']], defaultCondition: 'strong' },
  { id: 'abandoned', name: 'София след 100 години без хора', category: 'Бъдеще', source: 'abandoned.png', basePhase: 'day', animation: 'quiet-haze', quality: 'light', effects: ['haze'], audio: 'abandoned', fallback: 'image', conditions: [['clear', 'Ясно'], ['cloudy', 'Облачно'], ['fog', 'Мъгла'], ['rain', 'Дъжд']], defaultCondition: 'clear' },
  { id: 'cyberpunk', name: 'София 2150 — Cyberpunk', category: 'Бъдеще', source: 'cyberpunk.png', basePhase: 'night', animation: 'neon', quality: 'adaptive', effects: ['neon'], audio: 'cyberpunk', fallback: 'image', conditions: [['clear', 'Ясно'], ['rain', 'Дъжд'], ['fog', 'Мъгла']], defaultCondition: 'clear' },
  { id: 'supercell', name: 'Суперклетъчна буря', category: 'Климат', source: 'supercell.png', basePhase: 'day', animation: 'storm', quality: 'adaptive', effects: ['rain', 'lightning'], audio: 'supercell', fallback: 'image', conditions: [['approaching', 'Приближаваща буря'], ['heavy', 'Силна буря'], ['violent', 'Мощна буря']], defaultCondition: 'heavy' },
]);

export const specialScene = id => SPECIAL_SCENES.find(scene => scene.id === id) || null;
