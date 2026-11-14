// "Сега": the real current Sofia weather from Open-Meteo (free, no key). Falls back to time only when offline.
import { clamp } from '../engine/blend.js';

export function openMeteoUrl({ lat, lon, timeZone }) {
  const p = new URLSearchParams({ latitude: lat, longitude: lon, timezone: timeZone, current: 'temperature_2m,precipitation,rain,showers,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m,weather_code,visibility,is_day', wind_speed_unit: 'kmh' });
  return 'https://api.open-meteo.com/v1/forecast?' + p;
}
/** Map an Open-Meteo "current" block to the scene environment. Pure: unit-tested. */
export function mapWeather(cur) {
  const code = cur.weather_code ?? 0, cloud = clamp((cur.cloud_cover ?? 0) / 100), vis = cur.visibility ?? 30000;
  const snowing = (cur.snowfall ?? 0) > 0 || (code >= 71 && code <= 77) || code === 85 || code === 86;
  const storm = code >= 95;
  const liquid = (cur.rain ?? 0) + (cur.showers ?? 0), raining = !snowing && (liquid > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || storm);
  const fogCode = code === 45 || code === 48, fog = fogCode ? 1 : clamp((6000 - vis) / 5000) * 0.8;
  const mm = cur.precipitation ?? liquid;
  const env = {
    cloud: Math.max(cloud, raining || snowing ? 0.85 : 0, storm ? 1 : 0, fogCode ? 0.3 : 0),
    rain: raining ? clamp(0.35 + mm / 4, 0.35, 1) : 0,
    snow: snowing ? clamp(0.4 + (cur.snowfall ?? 0.5) / 1.5, 0.4, 1) : 0,
    fog: clamp(Math.max(fog, raining ? 0.12 : 0)), storm: storm ? 1 : 0,
  };
  const preset = storm ? 'storm' : snowing ? 'snow' : raining ? 'rain' : fog > 0.5 ? 'fog' : cloud > 0.55 ? 'cloudy' : 'clear';
  const label = { clear: 'ясно', cloudy: 'облачно', fog: 'мъгла', rain: 'дъжд', storm: 'буря', snow: 'сняг' }[preset];
  return { env, preset, label, wind: clamp((cur.wind_speed_10m ?? 0) / 45), fogLvl: clamp(0.35 + (2000 - Math.min(vis, 2000)) / 2000 * 0.5), temperature: cur.temperature_2m, windKmh: cur.wind_speed_10m, cloudPct: Math.round(cloud * 100) };
}
export async function fetchNow(location, { timeout = 6000, fetchImpl = fetch } = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetchImpl(openMeteoUrl(location), { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); if (!j.current) throw new Error('няма текущи данни');
    return { ok: true, ...mapWeather(j.current), raw: j.current };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; } finally { clearTimeout(timer); }
}
