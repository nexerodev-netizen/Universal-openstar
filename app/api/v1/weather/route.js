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

// Встроенный генератор аналитики на случай, если бесплатный ИИ лежит
function generateLocalAnalysis(weatherData) {
  const current = weatherData.current;
  const daily = weatherData.daily || [];
  const hourly = weatherData.hourly || [];
  const gfs = weatherData.models_raw?.gfs_hourly_temp || [];

  let alerts = [];
  let maxWindDay = { speed: 0, date: '' };

  // Ищем опасную погоду на ближайшие 14 дней
  daily.forEach(day => {
    if (day.condition.toLowerCase().includes('thunderstorm')) {
      alerts.push(`Thunderstorm predicted on ${day.date}`);
    }
    if (day.condition.toLowerCase().includes('heavy rain') || day.condition.toLowerCase().includes('heavy snow')) {
      alerts.push(`Heavy precipitation expected on ${day.date}`);
    }
    if (day.max_wind_speed > maxWindDay.speed) {
      maxWindDay = { speed: day.max_wind_speed, date: day.date };
    }
  });

  if (maxWindDay.speed > 12) {
    alerts.push(`High winds up to ${maxWindDay.speed} m/s expected on ${maxWindDay.date}`);
  }

  // Сравниваем базовую модель и GFS на ближайшие часы
  let modelComparison = "Main forecast matches global trends.";
  if (hourly.length > 0 && gfs.length > 0) {
    const mainTempAhead = hourly[12]?.temp;
    const gfsTempAhead = gfs[12];
    if (mainTempAhead && gfsTempAhead) {
      const diff = Math.abs(mainTempAhead - gfsTempAhead).toFixed(1);
      if (diff > 1.5) {
        modelComparison = `Model variance detected: GFS predicts ${gfsTempAhead}°C while ECMWF/BestMatch shows ${mainTempAhead}°C in 12 hours.`;
      } else {
        modelComparison = `High model consensus: GFS and main forecast temperatures align closely (${mainTempAhead}°C vs ${gfsTempAhead}°C).`;
      }
    }
  }

  // Строим финальный текст
  const alertText = alerts.length > 0 ? `⚠️ ALERTS: ${alerts.join('. ')}.` : "✅ No severe weather alerts for the upcoming days.";
  const tip = current.temp > 25 ? "Wear lightweight clothing and stay hydrated." : current.temp < 10 ? "Dress warmly and watch out for wind chill." : "Weather is moderate, standard seasonal clothing recommended.";

  return `[Local AI Engine]: Currently it's ${current.temp}°C, feels like ${current.feels_like}°C with ${current.condition}. ${alertText} ${modelComparison} Practical tip: ${tip}`;
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
      try {
        // Пробуем достучаться до бесплатной Llama
        const systemPrompt = "You are an expert AI Meteorologist. Analyze the weather JSON and provide a brief, smart summary in English. Alert about dangerous weather (thunderstorms, high winds), compare main forecast with GFS model, and give a practical tip for today.";
        const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(systemPrompt + "\n\n" + JSON.stringify(weatherData))}?model=searchshadow&cache=false`, {
          signal: AbortSignal.timeout(5000)
        });
        
        if (res.ok) {
          const txt = await res.text();
          if (txt && !txt.includes('overloaded') && !txt.includes('unavailable')) {
            aiText = txt;
          }
        }
      } catch (e) {
        console.log("External AI failed, using built-in generator...");
      }

      // Фолбек: если ИИ упал, генерируем качественную сводку прямо на сервере
      if (!aiText) {
        aiText = generateLocalAnalysis(weatherData);
      }
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
