// Solar position after the NOAA Solar Calculator (Meeus-based), plus civil time for Europe/Sofia.
// Nothing here is hardcoded per date: sunrise and sunset are found by search on the computed elevation.
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const HOUR = 3600000, DAY = 86400000;

/** Last Sunday of a month (0-based), 01:00 UTC — the EU daylight-saving switch instant. */
function lastSundayUtc(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0, 1));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}
/** UTC offset in hours for Europe/Sofia (EET +2 / EEST +3) at a UTC instant. */
export function sofiaOffset(utcMs) {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= lastSundayUtc(y, 2) && utcMs < lastSundayUtc(y, 9) ? 3 : 2;
}
/** Local Sofia wall time (y, m 0-based, d, decimal hour) -> UTC ms. */
export function sofiaToUtc(y, m, d, hour) {
  const base = Date.UTC(y, m, d);
  let off = sofiaOffset(base + (hour - 2) * HOUR);
  off = sofiaOffset(base + (hour - off) * HOUR);
  return base + (hour - off) * HOUR;
}
/** UTC ms -> Sofia wall time parts. */
export function utcToSofia(utcMs) {
  const off = sofiaOffset(utcMs), t = new Date(utcMs + off * HOUR);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), hour: t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600, offset: off };
}
export function dayOfYear(y, m, d) { return Math.round((Date.UTC(y, m, d) - Date.UTC(y, 0, 1)) / DAY) + 1; }

/** NOAA solar position. Returns azimuth (deg from north, clockwise), geometric and refracted elevation (deg). */
export function sunPosition(utcMs, lat, lon) {
  const jd = utcMs / DAY + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const yy = Math.tan(eps * RAD / 2) ** 2;
  const eot = 4 * DEG * (yy * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * yy * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * yy * yy * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const minutes = ((utcMs % DAY) + DAY) % DAY / 60000;
  const tst = (((minutes + eot + 4 * lon) % 1440) + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const cosZen = Math.min(1, Math.max(-1, Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(ha * RAD)));
  const zen = Math.acos(cosZen) * DEG, elev = 90 - zen;
  let refr = 0;
  if (elev <= 85) {
    const te = Math.tan(elev * RAD);
    if (elev > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elev > -0.575) refr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  const den = Math.cos(lat * RAD) * Math.sin(zen * RAD);
  let az = 180;
  if (Math.abs(den) > 1e-6) {
    const a = Math.acos(Math.min(1, Math.max(-1, (Math.sin(lat * RAD) * Math.cos(zen * RAD) - Math.sin(decl)) / den))) * DEG;
    az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { azimuth: az, elevation: elev, apparentElevation: elev + refr, declination: decl * DEG, hourAngle: ha, eqTime: eot };
}

/** Sunrise, sunset (local decimal hours, Sofia wall time) and solar noon for a civil day, found by search. */
export function sunTimes(y, m, d, lat, lon, toUtc = sofiaToUtc) {
  const H0 = -0.833; // centre of the disc at the standard refraction + semi-diameter
  const alt = h => sunPosition(toUtc(y, m, d, h), lat, lon).elevation;
  const refine = (a, b, rising) => { for (let i = 0; i < 26; i++) { const mid = (a + b) / 2; if ((alt(mid) >= H0) === rising) b = mid; else a = mid; } return (a + b) / 2; };
  let rise = null, set = null, noon = 12, best = -91, prev = alt(0);
  for (let k = 1; k <= 720; k++) {
    const h = k / 30, a = alt(h);
    if (prev < H0 && a >= H0 && rise === null) rise = refine(h - 1 / 30, h, true);
    if (prev >= H0 && a < H0) set = refine(h - 1 / 30, h, false);
    if (a > best) { best = a; noon = h; }
    prev = a;
  }
  return { rise, set, noon, maxElevation: best };
}
export const formatClock = h => {
  if (h == null || Number.isNaN(h)) return '—';
  h = ((h % 24) + 24) % 24; let H = Math.floor(h), M = Math.round((h - H) * 60);
  if (M === 60) { M = 0; H = (H + 1) % 24; }
  return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
};
