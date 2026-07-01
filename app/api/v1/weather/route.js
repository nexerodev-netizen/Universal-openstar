import { NextResponse } from 'next/server';

// 1. Словарь для перевода кодов погоды WMO в понятный английский текст
const WEATHER_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail'
};

function getWeatherDesc(code) {
  return WEATHER_CODES[code] || 'Unknown conditions';
}

// 2. Перевод градусов ветра (0°-360°) в направления (N, NE, E...)
function getWindDirection(degrees) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees % 360) / 45)) % 8;
  return directions[index];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat') || '55.75'; // По дефолту Москва
  const lon = searchParams.get('lon') || '37.62';

  try {
    // Собираем URL: запрашиваем 14 дней, текущую, почасовую, ежедневную погоду + мультимодели прогноза
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m` +
      `&hourly=temperature_2m,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant` +
      `&forecast_days=14` +
      `&models=best_match,ecmwf_ifs04,gfs_seamless` +
      `&timezone=auto`;

    // Next.js кеширует этот fetch запрос на 15 минут (900 секунд) автоматически
    const response = await fetch(openMeteoUrl, {
      next: { revalidate: 900 },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch from Open-Meteo' }, { status: response.status });
    }

    const data = await response.json();

    // 3. Форматируем почасовой прогноз на ближайшие 24 часа
    const hourlyForecast = data.hourly.time.slice(0, 24).map((time, idx) => ({
      time,
      temp: data.hourly.temperature_2m[idx],
      condition: getWeatherDesc(data.hourly.weather_code[idx]),
      wind_speed: data.hourly.wind_speed_10m[idx],
    }));

    // 4. Форматируем прогноз на 14 дней
    const dailyForecast = data.daily.time.map((date, idx) => ({
      date,
      temp_max: data.daily.temperature_2m_max[idx],
      temp_min: data.daily.temperature_2m_min[idx],
      condition: getWeatherDesc(data.daily.weather_code[idx]),
      max_wind_speed: data.daily.wind_speed_10m_max[idx],
      wind_dir: getWindDirection(data.daily.wind_direction_10m_dominant[idx]),
    }));

    // 5. Собираем чистый JSON-ответ для фронтенда или ИИ-анализатора
    const responseData = {
      meta: {
        lat: data.latitude,
        lon: data.longitude,
        timezone: data.timezone,
        elevation: data.elevation,
      },
      current: {
        temp: data.current.temperature_2m,
        feels_like: data.current.apparent_temperature,
        humidity: data.current.relative_humidity_2m,
        condition: getWeatherDesc(data.current.weather_code),
        wind: {
          speed: data.current.wind_speed_10m,
          deg: data.current.wind_direction_10m,
          direction: getWindDirection(data.current.wind_direction_10m),
        }
      },
      hourly: hourlyForecast,
      daily: dailyForecast,
      // Сырые срезы данных от разных моделей для сравнения ИИ
      models_raw: {
        ecmwf: data.current_ecmwf_ifs04 || null,
        gfs: data.current_gfs_seamless || null,
      }
    };

    return NextResponse.json(responseData);

  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
}
