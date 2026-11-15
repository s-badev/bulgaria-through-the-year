// Hand-traced geometry of the NDK scene, in master-photo pixels (1672x941).
// Traced on the master photo; the night variant was used only to confirm which carriageway carries which direction.
export const CAMERA = { focalPx: 1150, horizonY: 318 }; // assumed FOV ~72deg; horizon hidden behind Vitosha

// Rough road hints (NOT traffic lanes): only used to build the wettable 'paved' mask and to find the baked light trails in the
// night variants. Live traffic geometry comes from tools/roads-config.mjs + tools/build-traffic.mjs.
export const ROAD_HINTS = [
  { id: 'left-in', kind: 'head', width: 5, pts: [[267, 400], [263, 418], [254, 436], [242, 452], [233, 470], [231, 488], [237, 506], [245, 524], [247, 540], [232, 556], [196, 572], [160, 588], [120, 604], [80, 620], [40, 637], [0, 655]] },
  { id: 'left-out', kind: 'tail', width: 5, pts: [[0, 626], [40, 610], [80, 595], [120, 581], [160, 568], [200, 556], [240, 548], [275, 538], [300, 522], [296, 503], [280, 483], [269, 462], [268, 440], [272, 420], [274, 402]] },
  { id: 'right-in', kind: 'head', width: 5, pts: [[1447, 505], [1456, 525], [1462, 545], [1455, 566], [1436, 588], [1414, 608], [1394, 628], [1378, 648], [1368, 664]] },
  { id: 'right-out', kind: 'tail', width: 5, pts: [[1452, 664], [1458, 645], [1468, 622], [1482, 598], [1494, 574], [1499, 550], [1492, 528], [1478, 508], [1468, 496]] },
  { id: 'corner-out', kind: 'tail', width: 6, pts: [[1572, 738], [1600, 756], [1632, 776], [1672, 800]] },
  { id: 'corner-in', kind: 'head', width: 6, pts: [[1672, 786], [1640, 766], [1610, 748], [1584, 732]] },
];

// Fountain basins (water surface) and jets, traced on the master.
export const BASINS = [
  [[806, 684], [906, 684], [922, 752], [818, 752]],
  [[850, 784], [951, 782], [1003, 932], [904, 934]],
];
export const JETS = (() => {
  const j = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) j.push({ x: 845 + c * 22 + r * 3, y: 700 + r * 13, h: 16 + (c % 2) * 6 });
  for (let r = 0; r < 9; r++) for (let c = 0; c < 2; c++) j.push({ x: 893 + c * 22 + r * 6.2, y: 800 + r * 15.5, h: 22 + (r % 2) * 6 });
  return j;
})();

// Glass surfaces (bounding boxes; refined by colour in build-masks).
export const GLASS_BOXES = [
  { id: 'glass-tower', box: [1226, 238, 1348, 458] },
  { id: 'ndk', box: [546, 438, 1008, 612] },
  { id: 'blue-block', box: [170, 350, 220, 428] },
];
export const NDK_BOX = [546, 404, 1008, 614];
export const EMBLEM = { x: 800, y: 502, r: 22 };

// Aviation obstacle lights (blink at night).
export const BEACONS = [{ x: 1015, y: 186 }, { x: 1286, y: 240 }];

// Flight corridors (image px). Planes: Sofia airport is to the east/north-east, approach paths cross the southern sky left<->right.
export const CORRIDORS = {
  planesLow: { y0: [70, 110], y1: [150, 180], dir: 'rtl' },
  planesHigh: { y: [30, 80] },
  birds: { y: [60, 180] },
  swallows: { y: [380, 500] },
};
