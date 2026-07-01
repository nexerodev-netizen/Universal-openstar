import { NextResponse } from 'next/server';

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

function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return 'N/A';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees % 360) / 45)) % 8;
  return directions[index];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat') || '55.75';
  const lon = searchParams.get('lon') || '37.62';

  try {
    // Запрашиваем основную модель (best_match) + дополнительные для ИИ
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m` +
      `&hourly=temperature_2m,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant` +
      `&forecast_days=14` +
      `&models=best_match,ecmwf_ifs04,gfs_seamless` +
      `&timezone=auto`;

    const response = await fetch(openMeteoUrl, {
      next: { revalidate: 900 },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch from Open-Meteo' }, { status: response.status });
    }

    const data = await response.json();

    // Проверяем наличие базовых массивов, чтобы избежать краша
    const hourlyTimes = data.hourly?.time || [];
    const dailyTimes = data.daily?.time || [];

    // Безопасно собираем почасовой прогноз (первые 24 часа)
    const hourlyForecast = hourlyTimes.slice(0, 24).map((time, idx) => {
      // Если из-за мультимоделей ключи называются иначе, ищем их динамически или берем дефолтные
      const temp = data.hourly?.temperature_2m?.[idx] ?? data.hourly?.temperature_2m_best_match?.[idx] ?? null;
      const code = data.hourly?.weather_code?.[idx] ?? data.hourly?.weather_code_best_match?.[idx] ?? 0;
      const wind = data.hourly?.wind_speed_10m?.[idx] ?? data.hourly?.wind_speed_10m_best_match?.[idx] ?? null;

      return {
        time,
        temp,
        condition: getWeatherDesc(code),
        wind_speed: wind,
      };
    });

    // Безопасно собираем прогноз на 14 дней
    const dailyForecast = dailyTimes.map((date, idx) => {
      const maxTemp = data.daily?.temperature_2m_max?.[idx] ?? data.daily?.temperature_2m_max_best_match?.[idx] ?? null;
      const minTemp = data.daily?.temperature_2m_min?.[idx] ?? data.daily?.temperature_2m_min_best_match?.[idx] ?? null;
      const code = data.daily?.weather_code?.[idx] ?? data.daily?.weather_code_best_match?.[idx] ?? 0;
      const maxWind = data.daily?.wind_speed_10m_max?.[idx] ?? data.daily?.wind_speed_10m_max_best_match?.[idx] ?? null;
      const windDeg = data.daily?.wind_direction_10m_dominant?.[idx] ?? data.daily?.wind_direction_10m_dominant_best_match?.[idx] ?? 0;

      return {
        date,
        temp_max: maxTemp,
        temp_min: minTemp,
        condition: getWeatherDesc(code),
        max_wind_speed: maxWind,
        wind_dir: getWindDirection(windDeg),
      };
    });

    // Формируем финальный ответ
    const responseData = {
      meta: {
        lat: data.latitude,
        lon: data.longitude,
        timezone: data.timezone,
        elevation: data.elevation,
      },
      current: {
        temp: data.current?.temperature_2m ?? data.current?.temperature_2m_best_match,
        feels_like: data.current?.apparent_temperature ?? data.current?.apparent_temperature_best_match,
        humidity: data.current?.relative_humidity_2m ?? data.current?.relative_humidity_2m_best_match,
        condition: getWeatherDesc(data.current?.weather_code ?? data.current?.weather_code_best_match),
        wind: {
          speed: data.current?.wind_speed_10m ?? data.current?.wind_speed_10m_best_match,
          deg: data.current?.wind_direction_10m ?? data.current?.wind_direction_10m_best_match,
          direction: getWindDirection(data.current?.wind_direction_10m ?? data.current?.wind_direction_10m_best_match),
        }
      },
      hourly: hourlyForecast,
      daily: dailyForecast,
      // Сохраняем сырые данные моделей, если они пришли в ответе
      models_raw: {
        ecmwf: data.hourly?.temperature_2m_ecmwf_ifs04 ? {
          hourly_temp: data.hourly.temperature_2m_ecmwf_ifs04.slice(0, 24)
        } : null,
        gfs: data.hourly?.temperature_2m_gfs_seamless ? {
          hourly_temp: data.hourly.temperature_2m_gfs_seamless.slice(0, 24)
        } : null,
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
