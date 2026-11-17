// The photographs define the worlds; effects are deliberately secondary.
export const SPECIAL_BASE = '/scenes/ndk/special/';
export const SPECIAL_SCENES = Object.freeze([
  { id: 'planet', name: 'Планета над София', category: 'Космос', source: 'planet.png', animation: 'planet-atmosphere', quality: 'light', effects: ['sky-light'], audio: null, fallback: 'image' },
  { id: 'aurora', name: 'Полярно сияние', category: 'Небе', source: 'aurora.png', animation: 'aurora-glow', quality: 'light', effects: ['sky-light'], audio: null, fallback: 'image' },
  { id: 'ice-age', name: 'Ледникова София', category: 'Климат', source: 'ice-age.png', animation: 'snow', quality: 'adaptive', effects: ['snow'], audio: null, fallback: 'image' },
  { id: 'sandstorm', name: 'Пясъчна буря', category: 'Климат', source: 'sandstorm.png', animation: 'dust', quality: 'adaptive', effects: ['dust'], audio: null, fallback: 'image' },
  { id: 'abandoned', name: 'София след 100 години без хора', category: 'Бъдеще', source: 'abandoned.png', animation: 'quiet-haze', quality: 'light', effects: ['haze'], audio: null, fallback: 'image' },
  { id: 'cyberpunk', name: 'София 2150 — Cyberpunk', category: 'Бъдеще', source: 'cyberpunk.png', animation: 'neon', quality: 'adaptive', effects: ['neon'], audio: null, fallback: 'image' },
  { id: 'supercell', name: 'Суперклетъчна буря', category: 'Климат', source: 'supercell.png', animation: 'storm', quality: 'adaptive', effects: ['rain', 'lightning'], audio: null, fallback: 'image' },
]);

export const specialScene = id => SPECIAL_SCENES.find(scene => scene.id === id) || null;
