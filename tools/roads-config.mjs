// Carriageways of the NDK scene, traced on the master photo at 6x (image pixels, 1672x941).
// Each carriageway is a list of cross-sections in the direction of travel (right-hand traffic):
//   [ [leftKerbX, leftKerbY], [rightKerbX, rightKerbY] ]   — left/right as the driver sees them.
// tools/build-traffic.mjs turns these into a polygon, checks every pixel against the photograph (strict asphalt mask),
// and derives the lanes from the mask. Nothing else in the project knows where the roads are.
//   seen : 'head' = traffic comes toward the camera (we see headlights), 'tail' = it drives away (taillights)
//   start/end : how cars may appear/disappear there — 'far' (fade through the haze at the far end),
//               'hide' (under tree crowns / behind buildings), 'edge' (frame edge)
//   cleanOnly : remove the baked cars here but never trace a lane (no honest way in or out)
//   markings : the carriageway has painted arrows / zebra that must survive the car removal
//   signal : optional stop line, metres before the end of the carriageway, with a cycle in seconds
export const CAMERA_HEIGHT_M = 72; // from measured car widths (about 2 m = 5 px at y = 500)

export const CARRIAGEWAYS = [
  { id: 'left-in', seen: 'head', start: 'far', end: 'hide', signal: { beforeEnd: 62, green: 26, red: 15 },
    sections: [
      [[249.5, 448], [236, 448]], [[249, 460], [233.5, 460]], [[248.5, 470], [231.5, 470]], [[249, 480], [231, 480]], [[251, 490], [233, 490]],
      [[256, 500], [233, 500]], [[265, 510], [233, 510]], [[274, 519], [239, 521]], [[280, 529], [243, 531]], [[283, 539], [246, 541]],
      [[283, 548], [248, 549]], [[282, 556], [251, 557]], [[281, 563], [254, 564]],
    ] },
  { id: 'left-out', seen: 'tail', start: 'hide', end: 'far',
    sections: [
      [[315, 542], [331, 526]], [[306, 527], [319, 510]], [[295.5, 513], [308, 500]], [[278.5, 500.5], [298, 491]], [[269, 490], [291.5, 482.5]],
      [[265, 480], [287, 475]], [[263.5, 470], [284.5, 468]], [[263, 460], [282.5, 459]], [[263, 448], [281, 448]],
    ] },
  // the slip toward the plaza beside the outbound carriageway: its baked cars are removed so nothing stands frozen next to live
  // traffic, but no lane runs here (cars would have to appear in the open)
  { id: 'left-out-slip', cleanOnly: true, seen: 'tail', start: 'hide', end: 'hide',
    sections: [[[331, 526], [347, 515]], [[319, 510], [337, 506.5]], [[308, 500], [320, 499.5]], [[298, 491], [304, 492.5]]] },
];

// NOT LIVE (decided after tracing, see docs/TRAFFIC.md):
//  - right avenue: its far half lies in deep building shadow where asphalt and cars cannot be separated reliably, and the lit
//    half ends in a junction with no honest place for a car to appear or leave. The photograph is left untouched there.
//  - west road (lower left), corner street (lower right), streets around the plaza: mostly under crowns or lined with parked cars.

// Photographs whose road differs too much from the master inside a carriageway: their pixels are left exactly as they are
// (baked cars stay) and no live traffic runs there while that photo is on screen.
//  - autumn.png redrew the outbound left carriageway (kerb and island moved several pixels); see docs/TRAFFIC.md.
//  - dawn-golden.png drew the median island a few pixels into the outbound carriageway (cleaning erased its yellow kerb lines),
//    and on the inbound one the detector misses cars against the low golden light (one car and faint ghosts stayed). The
//    whole golden photo keeps its own pixels; while it is on screen every live carriageway is closed to new cars and the cars
//    already on the road drive on to their end (src/life/traffic.js closedFor). Sunrise shows the photograph's own cars.
//  - winter-snow.png redrew the avenue (the median edge crosses the inbound lanes diagonally) and its small grey cars stay below
//    the detector's contrast threshold. It keeps its own pixels; live carriageways are closed while it is on screen (winter
//    days and dusk). Winter nights show the relit, cleaned master road and have live traffic.
export const UNTOUCHED = { autumn: ['left-out', 'left-out-slip'], 'dawn-golden': ['left-in', 'left-out', 'left-out-slip'], 'winter-snow': ['left-in', 'left-out', 'left-out-slip'],
  // optional, not delivered yet: kept untouched and closed until its plate has been checked by eye (then remove this entry)
  'evening-golden': ['left-in', 'left-out', 'left-out-slip'] };
