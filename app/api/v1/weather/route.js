import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { randomUUID } from 'crypto';

// Настройки
export const dynamic = 'force-dynamic'; 
const CACHE_TTL_SECONDS = 60; // Кэш на 1 минуту

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/reverse';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

/* ============================================================
   WMO коды погоды -> Текст и Иконки
   ============================================================ */
const WMO_CODE_MAP = {
  0: { text: 'Clear', icon: 'clear_day' },
  1: { text: 'Mostly Clear', icon: 'mostly_clear_day' },
  2: { text: 'Partly Cloudy', icon: 'partly_cloudy_day' },
  3: { text: 'Overcast', icon: 'cloudy' },
  45: { text: 'Fog', icon: 'fog' },
  48: { text: 'Depositing Rime Fog', icon: 'fog' },
  51: { text: 'Light Drizzle', icon: 'drizzle' },
  53: { text: 'Drizzle', icon: 'drizzle' },
  55: { text: 'Dense Drizzle', icon: 'drizzle' },
  61: { text: 'Light Rain', icon: 'rain' },
  63: { text: 'Rain', icon: 'rain' },
  65: { text: 'Heavy Rain', icon: 'rain' },
  71: { text: 'Light Snow', icon: 'snow' },
  73: { text: 'Snow', icon: 'snow' },
  75: { text: 'Heavy Snow', icon: 'snow' },
  80: { text: 'Light Rain Showers', icon: 'rain' },
  95: { text: 'Thunderstorm', icon: 'thunderstorm' },
  96: { text: 'Thunderstorm with Light Hail', icon: 'thunderstorm' },
  99: { text: 'Thunderstorm with Heavy Hail', icon: 'thunderstorm' },
};

function resolveCondition(code, isDay = true) {
  const base = WMO_CODE_MAP[code] || { text: 'Unknown', icon: 'unknown' };
  if (!isDay && (code === 0 || code === 1)) {
    return { text: base.text, icon: base.icon.replace('_day', '_night') };
  }
  if (!isDay && code === 2) {
    return { text: base.text, icon: 'partly_cloudy_night' };
  }
  return base;
}

function degToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(deg / 22.5) % 16;
  return dirs[idx];
}

function aqiCategory(usAqi) {
  if (usAqi == null) return null;
  if (usAqi <= 50) return 'Good';
  if (usAqi <= 100) return 'Moderate';
  if (usAqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (usAqi <= 200) return 'Unhealthy';
  if (usAqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

const MOON_PHASES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
];

function moonPhaseForDate(isoDate) {
  const known = new Date('2000-01-06T18:14:00Z').getTime();
  const synodic = 29.53058867;
  const date = new Date(isoDate + 'T12:00:00Z').getTime();
  const daysSince = (date - known) / 86400000;
  const phaseIndex = Math.floor(((daysSince % synodic) / synodic) * 8 + 0.5) % 8;
  return MOON_PHASES[(phaseIndex + 8) % 8];
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDateEn(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}`;
}

/* ============================================================
   Запросы к Open-Meteo
   ============================================================ */
async function fetchJson(url, revalidate = CACHE_TTL_SECONDS) {
  const res = await fetch(url, { next: { revalidate } });
  if (!res.ok) throw new Error(`Upstream request failed: ${res.status} (${url})`);
  return res.json();
}

async function geocodeByCity(city) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const data = await fetchJson(url, 60 * 60 * 24);
  if (!data.results || data.results.length === 0) return null;
  const r = data.results[0];
  return { name: r.name, country: r.country, lat: r.latitude, lon: r.longitude, timezone: r.timezone };
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `${REVERSE_GEOCODE_URL}?latitude=${lat}&longitude=${lon}&language=en&format=json`;
    const data = await fetchJson(url, 60 * 60 * 24);
    if (data.results && data.results.length > 0) {
      const r = data.results[0];
      return { name: r.name, country: r.country, lat: r.latitude, lon: r.longitude, timezone: r.timezone };
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function fetchWeather(lat, lon, units) {
  const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
  const windUnit = units === 'imperial' ? 'mph' : 'kmh';

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    temperature_unit: tempUnit,
    wind_speed_unit: windUnit,
    timezone: 'auto',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure,cloud_cover,dew_point_2m,visibility,precipitation,uv_index,is_day',
    hourly: 'temperature_2m,apparent_temperature,weather_code,precipitation_probability,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,uv_index',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset',
    forecast_days: '14',
  });

  return fetchJson(`${FORECAST_URL}?${params.toString()}`);
}

async function fetchAirQuality(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'pm2_5,pm10,ozone,us_aqi',
    timezone: 'auto',
  });
  return fetchJson(`${AIR_QUALITY_URL}?${params.toString()}`);
}

async function fetchClimateHistory(lat, lon) {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: fmt(start),
    end_date: fmt(end),
    daily: 'temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max',
    timezone: 'auto',
  });

  return fetchJson(`${ARCHIVE_URL}?${params.toString()}`, 60 * 60 * 24);
}

/* ============================================================
   AI Climate Analysis Logic
   ============================================================ */
function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr, avg) {
  if (arr.length < 2) return 0;
  const m = avg || mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function buildClimateStats(archiveDaily) {
  if (!archiveDaily || !archiveDaily.time) return null;

  const tMax = archiveDaily.temperature_2m_max.filter((v) => v !== null);
  const tMin = archiveDaily.temperature_2m_min.filter((v) => v !== null);
  const tMean = archiveDaily.temperature_2m_mean.filter((v) => v !== null);
  const precip = archiveDaily.precipitation_sum.filter((v) => v !== null);
  const windMax = archiveDaily.wind_speed_10m_max.filter((v) => v !== null);
  const gustMax = archiveDaily.wind_gusts_10m_max.filter((v) => v !== null);

  const avgTMean = mean(tMean);
  const avgWind = mean(windMax);
  const avgGust = mean(gustMax);

  return {
    avg_temp_mean: round1(avgTMean),
    avg_temp_max: round1(mean(tMax)),
    avg_temp_min: round1(mean(tMin)),
    temp_std_dev: round1(stdDev(tMean, avgTMean)),
    avg_daily_precipitation_mm: round1(mean(precip)),
    rainy_days_ratio: precip.length ? round1((precip.filter((v) => v > 1).length / precip.length) * 100) : null,
    avg_wind_speed_max: round1(avgWind),
    wind_std_dev: round1(stdDev(windMax, avgWind)),
    avg_wind_gust_max: round1(avgGust),
    sample_days: archiveDaily.time.length,
    period: { from: archiveDaily.time[0], to: archiveDaily.time[archiveDaily.time.length - 1] },
  };
}

function findDailyAnomalies(dailyForecast, climateStats) {
  const anomalies = [];
  if (!dailyForecast || !dailyForecast.time) return anomalies;

  for (let i = 0; i < dailyForecast.time.length; i++) {
    const date = dailyForecast.time[i];
    const tMax = dailyForecast.temperature_2m_max?.[i];
    const gustMax = dailyForecast.wind_gusts_10m_max?.[i];
    const precipProb = dailyForecast.precipitation_probability_max?.[i];

    if (climateStats?.avg_temp_max != null && tMax != null) {
      const diff = tMax - climateStats.avg_temp_max;
      if (diff >= 7) {
        anomalies.push({
          date, type: 'heat', severity: diff >= 12 ? 'severe' : 'moderate',
          message: `${formatDateEn(date)}: температура до ${Math.round(tMax)}°C — на ${Math.round(diff)}° выше нормы.`,
        });
      }
    }
    
    if (gustMax != null && gustMax >= 50) {
       anomalies.push({
          date, type: 'wind', severity: gustMax >= 70 ? 'severe' : 'moderate',
          message: `${formatDateEn(date)}: сильный ветер, порывы до ${Math.round(gustMax)} км/ч.`,
       });
    }
  }
  return anomalies;
}

function buildClimateAnalysis({ dailyForecast, archiveDaily, locationName }) {
  const climateStats = buildClimateStats(archiveDaily);
  const anomalies = findDailyAnomalies(dailyForecast, climateStats);

  const forecastAvgMax = dailyForecast?.temperature_2m_max
    ? round1(mean(dailyForecast.temperature_2m_max.filter((v) => v !== null)))
    : null;

  const parts = [];
  if (climateStats && forecastAvgMax !== null && climateStats.avg_temp_max !== null) {
    const diff = round1(forecastAvgMax - climateStats.avg_temp_max);
    if (Math.abs(diff) < 1.5) {
      parts.push(`Температура в ближайшие 14 дней в районе ${locationName} близка к норме.`);
    } else if (diff > 0) {
      parts.push(`Ближайшие 14 дней в ${locationName} ожидаются теплее обычного: в среднем на ${diff}°C выше нормы.`);
    } else {
      parts.push(`Ближайшие 14 дней в ${locationName} ожидаются холоднее обычного.`);
    }
  }

  const heatDays = anomalies.filter((a) => a.type === 'heat');
  if (heatDays.length) parts.push(`Аномальная жара ожидается: ${heatDays.map((a) => formatDateEn(a.date)).join(', ')}.`);

  return {
    summary: parts.join(' ') || 'Нет значительных отклонений от климатической нормы.',
    climate_normals: climateStats,
    forecast_vs_normal: {
      forecast_avg_temp_max: forecastAvgMax,
      temp_deviation: climateStats && forecastAvgMax !== null ? round1(forecastAvgMax - climateStats.avg_temp_max) : null,
    },
    daily_warnings: anomalies,
  };
}

/* ============================================================
   Сборка финального JSON
   ============================================================ */
function buildWeatherResponse({ lat, lon, locationMeta, weatherData, aqiData, climateAnalysis, units, requestId }) {
  const current = weatherData.current || {};
  const hourly = weatherData.hourly || {};
  const daily = weatherData.daily || {};
  const isDay = current.is_day === 1;
  const condition = resolveCondition(current.weather_code, isDay);
  const tempUnit = units === 'imperial' ? '°F' : '°C';
  const aqiCurrent = aqiData?.current || null;

  // Почасовой прогноз (берем следующие 24 часа)
  const hourlyOut = [];
  if (hourly.time) {
    const nowIdx = hourly.time.findIndex((t) => new Date(t) >= new Date());
    const startIdx = nowIdx >= 0 ? nowIdx : 0;
    for (let i = startIdx; i < Math.min(startIdx + 24, hourly.time.length); i++) {
      hourlyOut.push({
        time: hourly.time[i],
        temperature: Math.round(hourly.temperature_2m[i]),
        feels_like: Math.round(hourly.apparent_temperature[i]),
        condition: resolveCondition(hourly.weather_code[i]).text,
        precipitation_probability: hourly.precipitation_probability?.[i] ?? null,
        humidity: hourly.relative_humidity_2m?.[i] ?? null,
        wind_speed: hourly.wind_speed_10m?.[i] != null ? Math.round(hourly.wind_speed_10m[i]) : null,
        uv_index: hourly.uv_index?.[i] != null ? round1(hourly.uv_index[i]) : null, // UV по часам!
      });
    }
  }

  // Ежедневный прогноз (14 дней)
  const dailyOut = [];
  if (daily.time) {
    for (let i = 0; i < daily.time.length; i++) {
      const date = daily.time[i];
      dailyOut.push({
        date,
        sunrise: daily.sunrise?.[i] ? daily.sunrise[i].split('T')[1] : undefined,
        sunset: daily.sunset?.[i] ? daily.sunset[i].split('T')[1] : undefined,
        moon_phase: moonPhaseForDate(date),
        temp_min: Math.round(daily.temperature_2m_min[i]),
        temp_max: Math.round(daily.temperature_2m_max[i]),
        condition: resolveCondition(daily.weather_code[i]).text,
        precipitation_probability: daily.precipitation_probability_max?.[i] ?? null,
        uv_index: daily.uv_index_max?.[i] != null ? round1(daily.uv_index_max[i]) : undefined,
        wind_speed_max: daily.wind_speed_10m_max?.[i] != null ? Math.round(daily.wind_speed_10m_max[i]) : undefined,
      });
    }
  }

  // Алерты
  const alerts = [];
  if (climateAnalysis?.daily_warnings?.length) {
    for (const w of climateAnalysis.daily_warnings) {
      if (w.severity === 'severe' || w.severity === 'moderate') {
        alerts.push({
          type: w.type === 'wind' ? 'Wind' : 'Heat',
          severity: w.severity === 'severe' ? 'Severe' : 'Moderate',
          title: w.type === 'wind' ? 'Сильный ветер' : 'Жара',
          description: w.message,
        });
      }
    }
  }

  return {
    location: {
      name: locationMeta?.name || 'Unknown',
      country: locationMeta?.country || 'Unknown',
      lat, lon,
      timezone: weatherData.timezone || locationMeta?.timezone || 'UTC',
      local_time: current.time || new Date().toISOString(),
    },
    current: {
      temperature: { value: round1(current.temperature_2m), unit: tempUnit, feels_like: round1(current.apparent_temperature) },
      condition: { code: current.weather_code, text: condition.text, icon: condition.icon },
      wind: {
        speed: round1(current.wind_speed_10m),
        gust: round1(current.wind_gusts_10m),
        direction: current.wind_direction_10m,
        cardinal: current.wind_direction_10m != null ? degToCardinal(current.wind_direction_10m) : null,
      },
      humidity: current.relative_humidity_2m,
      pressure: { value: current.surface_pressure != null ? Math.round(current.surface_pressure) : null, unit: 'hPa' },
      visibility: { value: current.visibility != null ? round1(current.visibility / 1000) : null, unit: 'km' },
      uv_index: current.uv_index != null ? round1(current.uv_index) : null,
      dew_point: round1(current.dew_point_2m),
      cloud_cover: current.cloud_cover,
      precipitation: { probability: hourlyOut[0]?.precipitation_probability ?? null, intensity: current.precipitation ?? 0 },
      air_quality: {
        aqi: aqiCurrent?.us_aqi ?? null,
        category: aqiCategory(aqiCurrent?.us_aqi ?? null),
        pm2_5: aqiCurrent?.pm2_5 ?? null,
        pm10: aqiCurrent?.pm10 ?? null,
        o3: aqiCurrent?.ozone ?? null,
      },
    },
    hourly: hourlyOut,
    daily: dailyOut,
    alerts,
    ai_analysis: climateAnalysis ? {
      summary: climateAnalysis.summary,
      climate_normals: climateAnalysis.climate_normals,
      forecast_vs_normal: climateAnalysis.forecast_vs_normal,
      daily_warnings: climateAnalysis.daily_warnings,
    } : null,
    metadata: {
      provider: 'Open-Meteo (via custom backend)',
      generated_at: new Date().toISOString(),
      units,
      request_id: requestId,
    },
  };
}

/* ============================================================
   Кэширование данных
   ============================================================ */
function getCachedWeatherBundle(lat, lon, units) {
  return unstable_cache(
    async () => {
      const [weatherData, aqiData, archiveData] = await Promise.all([
        fetchWeather(lat, lon, units),
        fetchAirQuality(lat, lon).catch(() => null),
        fetchClimateHistory(lat, lon).catch(() => null),
      ]);
      return { weatherData, aqiData, archiveData };
    },
    ['weather-bundle', lat.toFixed(2), lon.toFixed(2), units],
    { revalidate: CACHE_TTL_SECONDS }
  )();
}

const getCachedLocation = (city) =>
  unstable_cache(async () => geocodeByCity(city), ['geocode-city', city.toLowerCase()], { revalidate: 60 * 60 * 24 })();

const getCachedReverseLocation = (lat, lon) =>
  unstable_cache(async () => reverseGeocode(lat, lon), ['geocode-reverse', lat.toFixed(2), lon.toFixed(2)], { revalidate: 60 * 60 * 24 })();

/* ============================================================
   Главный обработчик GET
   ============================================================ */
export async function GET(request) {
  const requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const { searchParams } = new URL(request.url);

  const units = searchParams.get('units') === 'imperial' ? 'imperial' : 'metric';
  const city = searchParams.get('city');
  let lat = parseFloat(searchParams.get('lat'));
  let lon = parseFloat(searchParams.get('lon'));
  let locationMeta = null;

  try {
    // Если нет координат, ищем город
    if ((isNaN(lat) || isNaN(lon)) && city) {
      locationMeta = await getCachedLocation(city);
      if (!locationMeta) {
        return NextResponse.json({ error: 'location_not_found', message: `City not found: ${city}`, request_id: requestId }, { status: 404 });
      }
      lat = locationMeta.lat;
      lon = locationMeta.lon;
    }

    if (isNaN(lat) || isNaN(lon)) {
      return NextResponse.json({ error: 'bad_request', message: 'Provide ?city=Name or ?lat=..&lon=..', request_id: requestId }, { status: 400 });
    }

    // Получаем все данные параллельно
    const { weatherData, aqiData, archiveData } = await getCachedWeatherBundle(lat, lon, units);

    if (!locationMeta) {
      locationMeta = await getCachedReverseLocation(lat, lon).catch(() => null);
    }

    // Генерируем AI анализ
    const climateAnalysis = buildClimateAnalysis({
      dailyForecast: weatherData.daily,
      archiveDaily: archiveData?.daily,
      locationName: locationMeta?.name || 'this area',
    });

    const responseBody = buildWeatherResponse({
      lat, lon, locationMeta, weatherData, aqiData, climateAnalysis, units, requestId,
    });

    return NextResponse.json(responseBody, {
      headers: { 'Cache-Control': `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=30` },
    });
  } catch (err) {
    console.error('Weather fetch failed:', err);
    return NextResponse.json({ error: 'upstream_error', message: 'Failed to fetch weather data', details: err.message, request_id: requestId }, { status: 502 });
  }
}
