import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat') || '55.75';
  const lon = searchParams.get('lon') || '37.62';

  try {
    // 1. Получаем данные о погоде из нашего первого рабочего роута
    const origin = new URL(request.url).origin;
    const weatherRes = await fetch(`${origin}/api/weather?lat=${lat}&lon=${lon}`);
    
    if (!weatherRes.ok) throw new Error('Failed to get data from weather API');
    const weatherData = await weatherRes.json();

    // 2. Создаем четкий промпт для бесплатной нейросети
    const systemPrompt = "You are an expert AI Meteorologist. Analyze the weather JSON and provide a brief, smart summary in English. Alert about dangerous weather (thunderstorms, high winds), compare main forecast with GFS model, and give a practical tip for today.";
    const userPrompt = `Weather JSON Data:\n${JSON.stringify(weatherData)}`;

    // 3. Отправляем запрос в бесплатный ИИ-сервис (используем модель llama-3 для высокого качества текста)
    const aiUrl = `https://text.pollinations.ai/`;
    
    const aiResponse = await fetch(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'llama', // Бесплатная модель Llama 3
        private: true
      }),
      next: { revalidate: 900 } // Кешируем ответ ИИ на 15 минут вместе с погодой!
    });

    if (!aiResponse.ok) throw new Error('AI service is temporary unavailable');
    const aiText = await aiResponse.text();

    // 4. Отдаем клиенту результат
    return NextResponse.json({
      weather: weatherData,
      ai_analysis: aiText
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Free AI Analysis failed', details: error.message },
      { status: 500 }
    );
  }
      }
