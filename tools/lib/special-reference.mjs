// Coordinates in the registered 1672 × 941 NDK camera image. Mask A stores
// sky in red and mountain in green, with nearer buildings excluded.
export const reference = {
  photo: 'photos/master.webp',
  winter: 'photos/winter-snow.webp',
  mask: 'masks-a.png',
  width: 1672,
  height: 941,
  landmarks: {
    summit: [1017, 191],
    tower: [1247, 258],
    emblem: [800, 502],
    ndkCorner: [562, 474],
    fountain: [840, 653],
    boulevard: [246, 414],
  },
};
