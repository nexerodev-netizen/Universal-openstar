import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Инициализируем клиент. Он автоматически подтянет процесс GEMINI_API_KEY из .env.local
const ai = new GoogleGenAI();

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat') || '55.75';
  const lon = searchParams.get('lon') || '37.62';

  try {
    // 1. Запрашиваем данные у нашего же бэкенда погоды
    const origin = new URL(request.url).origin;
    const weatherRes = await fetch(`${origin}/api/weather?lat=${lat}&lon=${lon}`);
    
    if (!weatherRes.ok) throw new Error('Failed to get data from weather API');
    const weatherData = await weatherRes.json();

    // 2. Формируем промпт для ИИ
    const prompt = `
      You are an expert AI Meteorologist. Analyze the following weather JSON data and provide a brief, smart summary in English.
      
      Tasks:
      1. Alert about any dangerous weather in the next 14 days (look for Thunderstorms, heavy rain, or high winds like near July 3rd-6th).
      2. Compare the main forecast with the GFS model data (does GFS predict higher or lower temperatures?).
      3. Give a practical tip for today based on current conditions and hourly forecast.
      
      Weather Data:
      ${JSON.stringify(weatherData, null, 2)}
    `;

    // 3. Вызываем современную модель gemini-2.5-flash
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    // 4. Отдаем результат
    return NextResponse.json({
      weather: weatherData,
      ai_analysis: response.text
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'AI Analysis failed', details: error.message },
      { status: 500 }
    );
  }
}
