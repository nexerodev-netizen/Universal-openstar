import { NextResponse } from 'next/server';

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

// Обновленный встроенный генератор аналитики
function generateLocalAnalysis(weatherData) {
  const current = weatherData.current;
  const daily = weatherData.daily || [];
  const hourly = weatherData.hourly || [];
  const gfs = weatherData.models_raw?.gfs_hourly_temp || [];

  let alerts = [];
  let maxWindDay = { speed: 0, date: '' };

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

  const alertText = alerts.length > 0 ? `⚠️ ALERTS: ${alerts.join('. ')}.` : "✅ No severe weather alerts for the upcoming days.";
  const tip = current.temp > 25 ? "Wear lightweight clothing and stay hydrated." : current.temp < 10 ? "Dress warmly and watch out for wind chill." : "Weather is moderate, standard seasonal clothing recommended.";

  return `[Local AI Engine]: Currently it's ${current.temp}°C, feels like ${current.feels_like}°C with ${current.condition.text}. ${alertText} ${modelComparison} Practical tip: ${tip}`;
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

    // Унифицированный маппинг часов (объект wind внутри)
    const hourlyForecast = hourlyTimes.slice(0, 24).map((time, idx) => ({
      time,
      temp: data.hourly?.temperature_2m?.[idx] ?? data.hourly?.temperature_2m_best_match?.[idx] ?? null,
      condition: getWeatherCondition(data.hourly?.weather_code?.[idx] ?? data.hourly?.weather_code_best_match?.[idx] ?? 0),
      wind: {
        speed: data.hourly?.wind_speed_10m?.[idx] ?? data.hourly?.wind_speed_10m_best_match?.[idx] ?? null
      }
    }));

    // Унифицированный маппинг дней (объект wind внутри)
    const dailyForecast = dailyTimes.map((date, idx) => ({
      date,
      temp_max: data.daily?.temperature_2m_max?.[idx] ?? data.daily?.temperature_2m_max_best_match?.[idx] ?? null,
      temp_min: data.daily?.temperature_2m_min?.[idx] ?? data.daily?.temperature_2m_min_best_match?.[idx] ?? null,
      condition: getWeatherCondition(data.daily?.weather_code?.[idx] ?? data.daily?.weather_code_best_match?.[idx] ?? 0),
      wind: {
        speed: data.daily?.wind_speed_10m_max?.[idx] ?? data.daily?.wind_speed_10m_max_best_match?.[idx] ?? null,
        direction: getWindDirection(data.daily?.wind_direction_10m_dominant?.[idx] ?? data.daily?.wind_direction_10m_dominant_best_match?.[idx] ?? 0)
      }
    }));

    const weatherData = {
      meta: { 
        lat: data.latitude, 
        lon: data.longitude, 
        timezone: data.timezone, 
        elevation: data.elevation,
        generated_at: new Date().toISOString() // Добавили таймстемп
      },
      // Справочник единиц измерения
      units: {
        temp: "°C",
        wind_speed: "m/s",
        humidity: "%"
      },
      current: {
        temp: data.current?.temperature_2m ?? data.current?.temperature_2m_best_match,
        feels_like: data.current?.apparent_temperature ?? data.current?.apparent_temperature_best_match,
        humidity: data.current?.relative_humidity_2m ?? data.current?.relative_humidity_2m_best_match,
        condition: getWeatherCondition(data.current?.weather_code ?? data.current?.weather_code_best_match),
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
        const systemPrompt = "You are an expert AI Meteorologist. Analyze the weather JSON and provide a brief, smart summary in English.";
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
