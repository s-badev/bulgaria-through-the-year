import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWeather, fetchNow, openMeteoUrl } from '../../src/weather/now.js';

test('Open-Meteo codes map to the scene weather', () => {
  assert.equal(mapWeather({ weather_code: 0, cloud_cover: 5, visibility: 40000, wind_speed_10m: 9 }).preset, 'clear');
  assert.equal(mapWeather({ weather_code: 3, cloud_cover: 96, visibility: 20000 }).preset, 'cloudy');
  const fog = mapWeather({ weather_code: 45, cloud_cover: 100, visibility: 300 }); assert.equal(fog.preset, 'fog'); assert.equal(fog.env.fog, 1); assert.ok(fog.fogLvl > 0.7);
  const rain = mapWeather({ weather_code: 63, cloud_cover: 100, rain: 2.4, precipitation: 2.4, visibility: 9000 }); assert.equal(rain.preset, 'rain'); assert.ok(rain.env.rain > 0.8 && rain.env.snow === 0 && rain.env.cloud >= 0.85);
  const snow = mapWeather({ weather_code: 73, cloud_cover: 100, snowfall: 0.7, precipitation: 0.7 }); assert.equal(snow.preset, 'snow'); assert.ok(snow.env.snow > 0.4 && snow.env.rain === 0);
  const storm = mapWeather({ weather_code: 95, cloud_cover: 100, rain: 6, precipitation: 6 }); assert.equal(storm.preset, 'storm'); assert.equal(storm.env.storm, 1); assert.equal(storm.env.rain, 1);
  assert.ok(Math.abs(mapWeather({ wind_speed_10m: 22.5 }).wind - 0.5) < 1e-9);
});

test('offline fallback: a failed request reports ok=false and never throws', async () => {
  const r = await fetchNow({ lat: 42.6977, lon: 23.3219, timeZone: 'Europe/Sofia' }, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(r.ok, false); assert.match(r.error, /offline/);
  const r2 = await fetchNow({ lat: 1, lon: 2, timeZone: 'UTC' }, { fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(r2.ok, false);
  const good = await fetchNow({ lat: 1, lon: 2, timeZone: 'UTC' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ current: { weather_code: 61, cloud_cover: 90, rain: 1, precipitation: 1, temperature_2m: 7, wind_speed_10m: 12 } }) }) });
  assert.equal(good.ok, true); assert.equal(good.preset, 'rain');
  const url = openMeteoUrl({ lat: 42.6977, lon: 23.3219, timeZone: 'Europe/Sofia' });
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?') && url.includes('latitude=42.6977') && !url.includes('key'));
});
