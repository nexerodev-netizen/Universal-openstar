import { NextResponse } from 'next/server';

// Словарь кодов погоды WMO
const WEATHER_CODES = {
  0: { code: 'clear_sky', text: 'Clear sky' },
  1: { code: 'mainly_clear', text: 'Mainly clear' },
  2: { code: 'partly_cloudy', text: 'Partly cloudy' },
  3: { code: 'overcast', text: 'Overcast' },
  45: { code: 'fog', text: 'Fog' },
  48: { code: 'depositing_rime_fog', text: 'Depositing rime fog' },
  51: { code: 'light_drizzle', text: 'Light drizzle' },
  53: { code: 'moderate_drizzle', text: 'Moderate drizzle' },
  55: { code: 'dense_drizzle', text: 'Dense drizzle' },
  61: { code: 'slight_rain', text: 'Slight rain' },
  63: { code: 'moderate_rain', text: 'Moderate rain' },
  65: { code: 'heavy_rain', text: 'Heavy rain' },
  71: { code: 'slight_snow', text: 'Slight snow' },
  73: { code: 'moderate_snow', text: 'Moderate snow' },
  75: { code: 'heavy_snow', text: 'Heavy snow' },
  77: { code: 'snow_grains', text: 'Snow grains' },
  80: { code: 'slight_rain_showers', text: 'Slight rain showers' },
  81: { code: 'moderate_rain_showers', text: 'Moderate rain showers' },
  82: { code: 'violent_rain_showers', text: 'Violent rain showers' },
  85: { code: 'slight_snow_showers', text: 'Slight snow showers' },
  86: { code: 'heavy_snow_showers', text: 'Heavy snow showers' },
  95: { code: 'thunderstorm', text: 'Thunderstorm' },
  96: { code: 'thunderstorm_with_slight_hail', text: 'Thunderstorm with slight hail' },
  99: { code: 'thunderstorm_with_heavy_hail', text: 'Thunderstorm with heavy hail' }
};

function getWeatherCondition(code) {
  return WEATHER_CODES[code] || { code: 'unknown', text: 'Unknown conditions' };
}

function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return 'N/A';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees % 360) / 45)) % 8;
  return directions[index];
}

// Локальный анализ (Fallback, если внешний AI недоступен)
function generateLocalAnalysis(weatherData) {
  const current = weatherData.current;
  const daily = weatherData.daily || [];
  const hourly = weatherData.hourly || [];
  const gfs = weatherData.models?.gfs?.hourly || [];

  let alerts = [];
  let maxWindDay = { speed: 0, date: '' };

  // Поиск опасных явлений
  daily.forEach(day => {
    if (day.condition.code.includes('thunderstorm')) {
      alerts.push(`Thunderstorm predicted on ${day.date}`);
    }
    if (day.condition.code.includes('heavy_rain') || day.condition.code.includes('heavy_snow')) {
      alerts.push(`Heavy precipitation expected on ${day.date}`);
    }
    if (day.wind.speed > maxWindDay.speed) {
      maxWindDay = { speed: day.wind.speed, date: day.date };
    }
  });

  if (maxWindDay.speed > 12) {
    alerts.push(`High winds up to ${maxWindDay.speed} m/s expected on ${maxWindDay.date}`);
  }

  // Сравнение моделей (только если есть данные GFS)
  let modelComparison = "Main forecast matches global trends.";
  
  // Ищем индекс текущего часа в массиве hourly для корректного сравнения "+12 hours"
  const now = new Date();
  const currentHourStr = now.toISOString().slice(0, 13); 
  const currentIndex = hourly.findIndex(h => h.time.startsWith(currentHourStr));
  
  if (currentIndex !== -1 && hourly[currentIndex + 12] && gfs[currentIndex + 12]) {
    const mainTempAhead = hourly[currentIndex + 12]?.temp;
    const gfsTempAhead = gfs[currentIndex + 12]?.temp;
    
    if (mainTempAhead !== null && gfsTempAhead !== null) {
      const diff = Math.abs(mainTempAhead - gfsTempAhead).toFixed(1);
      if (diff > 1.5) {
        modelComparison = `Model variance detected: GFS predicts ${gfsTempAhead}°C while main forecast shows ${mainTempAhead}°C in 12 hours.`;
      } else {
        modelComparison = `High model consensus: GFS and main forecast temperatures align closely (${mainTempAhead}°C vs ${gfsTempAhead}°C).`;
      }
    }
  }

  const summary = `Currently it's ${current.temp}°C, feels like ${current.feels_like}°C with ${current.condition.text}. ${modelComparison}`;
  const tip = current.temp > 25 
    ? "Wear lightweight clothing and stay hydrated." 
    : current.temp < 10 
      ? "Dress warmly and watch out for wind chill." 
      : "Standard seasonal clothing recommended.";

  return { summary, alerts, tip };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat') || '55.75';
  const lon = searchParams.get('lon') || '37.62';
  const needAI = searchParams.get('ai') === 'true';

  try {
    // Запрос данных с Open-Meteo
    // Добавлены: surface_pressure, precipitation_probability, precipitation, cloudcover, uv_index
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure` +
      `&hourly=temperature_2m,weather_code,wind_speed_10m,precipitation_probability,precipitation,cloudcover,uv_index,surface_pressure` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant,uv_index_max,precipitation_sum,precipitation_probability_max` +
      `&forecast_days=14` +
      `&models=best_match,gfs_seamless` + 
      `&timezone=auto`;

    // Кэш 5 минут (300 сек) для баланса актуальности и скорости
    const response = await fetch(openMeteoUrl, { next: { revalidate: 300 } });
    if (!response.ok) throw new Error('Open-Meteo API connection failed');
    const data = await response.json();

    const hourlyTimes = data.hourly?.time || [];
    const dailyTimes = data.daily?.time || [];

    // ✅ ИСПРАВЛЕНИЕ СКАЧКА ТЕМПЕРАТУРЫ:
    // Определяем текущий час локально, чтобы подменить данные ТОЛЬКО для него
    const now = new Date();
    // Open-Meteo с timezone=auto возвращает время в локальном поясе запроса.
    // Формат time: "2026-07-02T10:00". Нам нужно "2026-07-02T10"
    // Важно: new Date() дает UTC. Нужно скорректировать под пояс пользователя или использовать toLocaleString.
    // Для простоты и надежности берем UTC час, так как Open-Meteo часто отдает UTC в raw, но с timezone=auto конвертирует.
    // Безопаснее сравнивать по индексу, если мы знаем смещение, но здесь используем строковое совпадение.
    
    // Получаем текущее время в формате ISO, но без минут/секунд/мс
    // Примечание: Если сервер Vercel в UTC, а пользователь в Москве, new Date() даст UTC.
    // Open-Meteo с &timezone=auto адаптирует ответы под часовой пояс клиента (если передан заголовок) или сервера.
    // Предположим, что time в ответе уже в нужном поясе.
    
    // Чтобы точно попасть в час, возьмем текущий час сервера (или клиента через заголовки, но тут GET).
    // Для универсальности просто найдем ближайший час в массиве hourlyTimes к new Date()
    
    let currentHourIndex = -1;
    const nowIso = now.toISOString(); 
    
    // Простой поиск индекса текущего часа
    for(let i=0; i<hourlyTimes.length; i++) {
        // hourlyTimes[i] выглядит как "2026-07-02T10:00"
        // nowIso начинается с "2026-07-02T10..." (если UTC) или смещено.
        // Самый надежный способ: парсить время
        const hTime = new Date(hourlyTimes[i]);
        // Разница во времени должна быть меньше 30 минут
        if (Math.abs(hTime.getTime() - now.getTime()) < 30 * 60 * 1000) {
            currentHourIndex = i;
            break;
        }
    }

    const hourlyForecast = hourlyTimes.slice(0, 24).map((time, idx) => {
      // Берем температуру из модели по умолчанию
      let temp = data.hourly?.temperature_2m_best_match?.[idx] ?? data.hourly?.temperature_2m?.[idx] ?? null;
      
      // ✅ ПОДМЕНА ТОЛЬКО ДЛЯ ТЕКУЩЕГО ЧАСА
      if (idx === currentHourIndex && data.current) {
         temp = data.current.temperature_2m_best_match ?? data.current.temperature_2m;
      }

      return {
        time,
        temp,
        condition: getWeatherCondition(data.hourly?.weather_code_best_match?.[idx] ?? data.hourly?.weather_code?.[idx] ?? 0),
        wind: {
          speed: data.hourly?.wind_speed_10m_best_match?.[idx] ?? data.hourly?.wind_speed_10m?.[idx] ?? null
        },
        // Новые поля
        precipitation_probability: data.hourly?.precipitation_probability_best_match?.[idx] ?? data.hourly?.precipitation_probability?.[idx] ?? null,
        precipitation_mm: data.hourly?.precipitation_best_match?.[idx] ?? data.hourly?.precipitation?.[idx] ?? null,
        cloud_cover: data.hourly?.cloudcover_best_match?.[idx] ?? data.hourly?.cloudcover?.[idx] ?? null,
        uv_index: data.hourly?.uv_index_best_match?.[idx] ?? data.hourly?.uv_index?.[idx] ?? null,
        pressure: data.hourly?.surface_pressure_best_match?.[idx] ?? data.hourly?.surface_pressure?.[idx] ?? null
      };
    });

    const dailyForecast = dailyTimes.map((date, idx) => ({
      date,
      temp_max: data.daily?.temperature_2m_max_best_match?.[idx] ?? data.daily?.temperature_2m_max?.[idx] ?? null,
      temp_min: data.daily?.temperature_2m_min_best_match?.[idx] ?? data.daily?.temperature_2m_min?.[idx] ?? null,
      condition: getWeatherCondition(data.daily?.weather_code_best_match?.[idx] ?? data.daily?.weather_code?.[idx] ?? 0),
      wind: {
        speed: data.daily?.wind_speed_10m_max_best_match?.[idx] ?? data.daily?.wind_speed_10m_max?.[idx] ?? null,
        direction: getWindDirection(data.daily?.wind_direction_10m_dominant_best_match?.[idx] ?? data.daily?.wind_direction_10m_dominant?.[idx] ?? 0)
      },
      // Новые поля для Daily
      uv_index_max: data.daily?.uv_index_max_best_match?.[idx] ?? data.daily?.uv_index_max?.[idx] ?? null,
      precipitation_sum_mm: data.daily?.precipitation_sum_best_match?.[idx] ?? data.daily?.precipitation_sum?.[idx] ?? null,
      precipitation_probability_max: data.daily?.precipitation_probability_max_best_match?.[idx] ?? data.daily?.precipitation_probability_max?.[idx] ?? null
    }));

    // Структурирование моделей (GFS с временем)
    const gfsHourlyStructured = (data.hourly?.temperature_2m_gfs_seamless || []).slice(0, 24).map((t, i) => ({
      time: hourlyTimes[i],
      temp: t
    }));

    const weatherData = {
      meta: { 
        lat: data.latitude, 
        lon: data.longitude, 
        timezone: data.timezone, 
        elevation: data.elevation,
        generated_at: new Date().toISOString()
      },
      units: {
        temp: "°C",
        wind_speed: "m/s",
        humidity: "%",
        pressure: "hPa",
        precipitation: "mm"
      },
      current: {
        temp: data.current?.temperature_2m_best_match ?? data.current?.temperature_2m,
        feels_like: data.current?.apparent_temperature_best_match ?? data.current?.apparent_temperature,
        humidity: data.current?.relative_humidity_2m_best_match ?? data.current?.relative_humidity_2m,
        pressure: data.current?.surface_pressure_best_match ?? data.current?.surface_pressure,
        condition: getWeatherCondition(data.current?.weather_code_best_match ?? data.current?.weather_code),
        wind: {
          speed: data.current?.wind_speed_10m_best_match ?? data.current?.wind_speed_10m,
          deg: data.current?.wind_direction_10m_best_match ?? data.current?.wind_direction_10m,
          direction: getWindDirection(data.current?.wind_direction_10m_best_match ?? data.current?.wind_direction_10m),
        }
      },
      hourly: hourlyForecast,
      daily: dailyForecast,
      models: {
        gfs: {
          hourly: gfsHourlyStructured 
        }
      }
    };

    // Логика AI анализа
    let aiAnalysisObj = null;
    if (needAI) {
      try {
        const systemPrompt = "You are an expert AI Meteorologist. Analyze the weather JSON and provide a brief summary, list of alerts, and a practical tip in valid JSON format matching fields: summary, alerts (array), tip.";
        const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(systemPrompt + "\n\n" + JSON.stringify(weatherData))}?model=searchshadow&cache=false`, {
          signal: AbortSignal.timeout(5000)
        });
        
        if (res.ok) {
          const txt = await res.text();
          if (txt && !txt.includes('overloaded') && !txt.includes('unavailable')) {
            try {
              // Очистка от markdown и лишнего текста
              const cleanedTxt = txt.substring(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
              aiAnalysisObj = JSON.parse(cleanedTxt);
            } catch {
              // Если парсинг не удался, отдаем как текст
              aiAnalysisObj = { summary: txt, alerts: [], tip: "Review full data for recommendations." };
            }
          }
        }
      } catch (e) {
        console.log("External AI fetch omitted or failed:", e.message);
      }

      // Fallback на локальный анализ, если внешний AI не ответил
      if (!aiAnalysisObj) {
        aiAnalysisObj = generateLocalAnalysis(weatherData);
      }
    }

    return NextResponse.json({
      weather: weatherData,
      ...(needAI && { ai_analysis: aiAnalysisObj })
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 }
    );
  }
    }
