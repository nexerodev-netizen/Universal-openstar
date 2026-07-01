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

// Хелпер для поочередного опроса бесплатных ИИ шлюзов
async function fetchAIAnalysisWithFallback(systemPrompt, userPrompt) {
  const fullPrompt = `${systemPrompt}\n\nData to analyze:\n${userPrompt}`;
  
  // Пул бесплатных независимых провайдеров
  const providers = [
    // Провайдер 1: Pollinations (POST)
    async () => {
      const res = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          model: 'llama',
          private: true
        }),
        signal: AbortSignal.timeout(6000) // таймаут 6 секунд
      });
      if (!res.ok) throw new Error('Pollinations failed');
      const txt = await res.text();
      if (txt.includes('temporary unavailable')) throw new Error('Pollinations rate limit');
      return txt;
    },
    // Провайдер 2: Pollinations GET-шлюз (с другим распределением нагрузки)
    async () => {
      const encodedPrompt = encodeURIComponent(fullPrompt);
      const res = await fetch(`https://text.pollinations.ai/${encodedPrompt}?model=searchshadow&cache=false`, {
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) throw new Error('Pollinations GET failed');
      return await res.text();
    },
    // Провайдер 3: Ускоренный резервный текстовый инстанс (Llama-3-free)
    async () => {
      const res = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: fullPrompt }],
          model: 'mistral',
          private: true
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) throw new Error('Mistral fallback failed');
      return await res.text();
    }
  ];

  // Перебираем провайдеров по очереди, пока один не ответит успешно
  for (let i = 0; i < providers.length; i++) {
    try {
      const result = await providers[i]();
      if (result && result.trim().length > 10) {
        return result; // Возвращаем успешный ответ
      }
    } catch (e) {
      console.warn(`AI Provider ${i + 1} failed, trying next...`);
    }
  }

  return "All free AI systems are currently overloaded. Please try again in a few minutes.";
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat') || '55.75';
  const lon = searchParams.get('lon') || '37.62';
  const needAI = searchParams.get('ai') === 'true';

  try {
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

    const hourlyForecast = hourlyTimes.slice(0, 24).map((time, idx) => ({
      time,
      temp: data.hourly?.temperature_2m?.[idx] ?? data.hourly?.temperature_2m_best_match?.[idx] ?? null,
      condition: getWeatherDesc(data.hourly?.weather_code?.[idx] ?? data.hourly?.weather_code_best_match?.[idx] ?? 0),
      wind_speed: data.hourly?.wind_speed_10m?.[idx] ?? data.hourly?.wind_speed_10m_best_match?.[idx] ?? null,
    }));

    const dailyForecast = dailyTimes.map((date, idx) => ({
      date,
      temp_max: data.daily?.temperature_2m_max?.[idx] ?? data.daily?.temperature_2m_max_best_match?.[idx] ?? null,
      temp_min: data.daily?.temperature_2m_min?.[idx] ?? data.daily?.temperature_2m_min_best_match?.[idx] ?? null,
      condition: getWeatherDesc(data.daily?.weather_code?.[idx] ?? data.daily?.weather_code_best_match?.[idx] ?? 0),
      max_wind_speed: data.daily?.wind_speed_10m_max?.[idx] ?? data.daily?.wind_speed_10m_max_best_match?.[idx] ?? null,
      wind_dir: getWindDirection(data.daily?.wind_direction_10m_dominant?.[idx] ?? data.daily?.wind_direction_10m_dominant_best_match?.[idx] ?? 0),
    }));

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

    let aiText = null;
    if (needAI) {
      const systemPrompt = "You are an expert AI Meteorologist. Analyze the weather JSON and provide a brief, smart summary in English. Alert about dangerous weather (thunderstorms, high winds), compare main forecast with GFS model, and give a practical tip for today.";
      const userPrompt = JSON.stringify(weatherData);
      
      // Вызываем каскадный опрос моделей
      aiText = await fetchAIAnalysisWithFallback(systemPrompt, userPrompt);
    }

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
