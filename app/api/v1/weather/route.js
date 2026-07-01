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
  
  // Проверяем параметр: если передали ?ai=true, то включаем ИИ-аналитику
  const needAI = searchParams.get('ai') === 'true';

  try {
    // 1. Запрос напрямую в Open-Meteo
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m` +
      `&hourly=temperature_2m,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant` +
      `&forecast_days=14` +
      `&models=best_match,ecmwf_ifs04,gfs_seamless` +
      `&timezone=auto`;

    const response = await fetch(openMeteoUrl, { next: { revalidate: 900 } });
    if (!response.ok) throw new Error('Open-Meteo API connection failed');
    const data = await response.json();

    const hourlyTimes = data.hourly?.time || [];
    const dailyTimes = data.daily?.time || [];

    // Форматируем часы (ближайшие 24 часа)
    const hourlyForecast = hourlyTimes.slice(0, 24).map((time, idx) => ({
      time,
      temp: data.hourly?.temperature_2m?.[idx] ?? data.hourly?.temperature_2m_best_match?.[idx] ?? null,
      condition: getWeatherDesc(data.hourly?.weather_code?.[idx] ?? data.hourly?.weather_code_best_match?.[idx] ?? 0),
      wind_speed: data.hourly?.wind_speed_10m?.[idx] ?? data.hourly?.wind_speed_10m_best_match?.[idx] ?? null,
    }));

    // Форматируем 14 дней
    const dailyForecast = dailyTimes.map((date, idx) => ({
      date,
      temp_max: data.daily?.temperature_2m_max?.[idx] ?? data.daily?.temperature_2m_max_best_match?.[idx] ?? null,
      temp_min: data.daily?.temperature_2m_min?.[idx] ?? data.daily?.temperature_2m_min_best_match?.[idx] ?? null,
      condition: getWeatherDesc(data.daily?.weather_code?.[idx] ?? data.daily?.weather_code_best_match?.[idx] ?? 0),
      max_wind_speed: data.daily?.wind_speed_10m_max?.[idx] ?? data.daily?.wind_speed_10m_max_best_match?.[idx] ?? null,
      wind_dir: getWindDirection(data.daily?.wind_direction_10m_dominant?.[idx] ?? data.daily?.wind_direction_10m_dominant_best_match?.[idx] ?? 0),
    }));

    // Собираем чистый объект погоды
    const weatherData = {
      meta: { lat: data.latitude, lon: data.longitude, timezone: data.timezone, elevation: data.elevation },
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
      models_raw: {
        gfs_hourly_temp: data.hourly?.temperature_2m_gfs_seamless?.slice(0, 24) || null
      }
    };

    // 2. Если нужен ИИ-анализ, делаем запрос к бесплатной Llama 3
    let aiText = null;
    if (needAI) {
      try {
        const systemPrompt = "You are an expert AI Meteorologist. Analyze the weather JSON and provide a brief, smart summary in English. Alert about dangerous weather (thunderstorms, high winds), compare main forecast with GFS model, and give a practical tip for today.";
        
        const aiResponse = await fetch('https://text.pollinations.ai/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Weather JSON Data:\n${JSON.stringify(weatherData)}` }
            ],
            model: 'llama',
            private: true
          }),
          next: { revalidate: 900 }
        });

        if (aiResponse.ok) {
          aiText = await aiResponse.text();
        } else {
          aiText = "AI analysis temporary unavailable due to external service load.";
        }
      } catch (aiErr) {
        aiText = `AI processing failed: ${aiErr.message}`;
      }
    }

    // Возвращаем результат в зависимости от того, запрашивали ли ИИ
    return NextResponse.json({
      weather: weatherData,
      ...(needAI && { ai_analysis: aiText })
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
               }
