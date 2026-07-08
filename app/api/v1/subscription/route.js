// app/api/v1/subscription/route.js
import { NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'super-secret-key-123');
const SUB_FILE_PATH = path.join(process.cwd(), 'sub-test.txt');

function generateUserId() {
    return 'user_' + crypto.randomBytes(6).toString('hex');
}

async function generateToken(userId, duration = '10m') {
    const safeDuration = duration && duration.length < 10 ? duration : '10m';
    const token = await new SignJWT({ userId })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(safeDuration)
        .sign(SECRET);
    return `${token}.${userId}`;
}

async function verifyToken(rawToken) {
    try {
        const parts = rawToken.split('.');
        if (parts.length !== 4) return { valid: false };
        
        const jwtPart = parts.slice(0, 3).join('.');
        const embeddedUserId = parts[3];
        
        const { payload } = await jwtVerify(jwtPart, SECRET);
        if (payload.userId !== embeddedUserId) return { valid: false };
        
        return { 
            valid: true, 
            userId: payload.userId,
            exp: payload.exp 
        };
    } catch (e) {
        return { valid: false };
    }
}

function getExpiredStubLink() {
    const uuid = '00000000-0000-0000-0000-000000000000';
    const address = 'expired.subscription'; 
    const port = '443';
    const remark = encodeURIComponent('⛔ ПОДПИСКА ЗАКОНЧИЛАСЬ - ОБНОВИТЕ ДОСТУП ⛔');
    return `vless://${uuid}@${address}:${port}?security=none&type=tcp#${remark}`;
}

// Генерация HTML страницы подписки
function renderSubscriptionPage(token, isValid, expiresAt) {
    const isExpired = !isValid;
    const statusColor = isExpired ? '#ef4444' : '#10b981';
    const statusText = isExpired ? 'ПОДПИСКА ИСТЕКЛА' : 'АКТИВНА';
    const statusIcon = isExpired ? '⛔' : '✅';
    
    // Форматируем время истечения
    const expireDate = expiresAt ? new Date(expiresAt * 1000).toLocaleString('ru-RU') : '-';
    
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenStar VPN - Подписка</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: white; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .card { 
            background: rgba(255,255,255,0.05); backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
            padding: 40px; max-width: 420px; width: 90%; text-align: center;
        }
        .status { 
            font-size: 28px; font-weight: bold; margin-bottom: 10px;
            color: ${statusColor}; display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .info { color: #94a3b8; margin-bottom: 20px; line-height: 1.6; }
        .timer { 
            font-size: 36px; font-weight: bold; margin: 20px 0;
            font-variant-numeric: tabular-nums;
        }
        .copy-btn {
            background: ${statusColor}; color: white; border: none;
            padding: 14px 28px; border-radius: 12px; font-size: 16px;
            cursor: pointer; transition: opacity 0.2s; width: 100%; margin-top: 10px;
        }
        .copy-btn:hover { opacity: 0.9; }
        .copy-btn:active { transform: scale(0.98); }
        .hint { font-size: 12px; color: #64748b; margin-top: 15px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="status">${statusIcon} ${statusText}</div>
        <div class="info">
            User ID: ${isExpired ? '-' : token.split('.').pop()}<br>
            Истекает: ${expireDate}
        </div>
        ${!isExpired ? `<div class="timer" id="timer">--:--:--</div>` : ''}
        <button class="copy-btn" onclick="copyLink()">📋 Скопировать ссылку подписки</button>
        <div class="hint">Вставьте эту ссылку в V2RayNG / Hiddify / Streisand</div>
    </div>
    <script>
        const link = '${token}';
        function copyLink() {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const btn = document.querySelector('.copy-btn');
                btn.textContent = '✅ Скопировано!';
                setTimeout(() => btn.textContent = '📋 Скопировать ссылку подписки', 2000);
            });
        }
        ${!isExpired ? `
        function updateTimer() {
            const diff = Math.max(0, Math.floor((${expiresAt} * 1000 - Date.now()) / 1000));
            const h = String(Math.floor(diff / 3600)).padStart(2, '0');
            const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
            const s = String(diff % 60).padStart(2, '0');
            document.getElementById('timer').textContent = h + ':' + m + ':' + s;
            if (diff <= 0) location.reload();
        }
        updateTimer(); setInterval(updateTimer, 1000);
        ` : ''}
    </script>
</body>
</html>`;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userAgent = request.headers.get('user-agent') || '';
    const isBrowser = !userAgent.toLowerCase().includes('v2ray') && 
                      !userAgent.toLowerCase().includes('clash') &&
                      !userAgent.toLowerCase().includes('hiddify') &&
                      !userAgent.toLowerCase().includes('streisand');

    // 1. Генерация новой подписки
    if (searchParams.has('generate') || !searchParams.has('token')) {
        const duration = searchParams.get('duration') || '10m';
        const userId = generateUserId();
        const fullToken = await generateToken(userId, duration);
        const baseUrl = request.nextUrl.origin + '/api/v1/subscription';
        const subscriptionLink = `${baseUrl}?token=${fullToken}`;
        
        // Для браузера — показываем страницу, для клиента — чистую ссылку
        if (isBrowser) {
            return new NextResponse(renderSubscriptionPage(fullToken, true, null), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        return new NextResponse(subscriptionLink, { headers: { 'Content-Type': 'text/plain' } });
    }

    // 2. Проверка токена
    const rawToken = searchParams.get('token');
    if (!rawToken) return new NextResponse('Нет токена', { status: 400 });

    const check = await verifyToken(rawToken);

    // Если токен истек
    if (!check.valid) {
        // Браузеру — красивая страница об истечении
        if (isBrowser) {
            return new NextResponse(renderSubscriptionPage(rawToken, false, null), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        // Клиенту — заглушка VLESS
        return new NextResponse(getExpiredStubLink(), { headers: { 'Content-Type': 'text/plain' } });
    }

    // Токен активен
    try {
        if (!fs.existsSync(SUB_FILE_PATH)) {
            return new NextResponse('Файл sub-test.txt не найден', { status: 404 });
        }
        const content = fs.readFileSync(SUB_FILE_PATH, 'utf-8').trim();
        
        // Браузеру — страница статуса, клиенту — серверы
        if (isBrowser) {
            return new NextResponse(renderSubscriptionPage(rawToken, true, check.exp), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        return new NextResponse(content, { headers: { 'Content-Type': 'text/plain' } });
    } catch (err) {
        console.error('Ошибка чтения файла:', err);
        return new NextResponse('Ошибка доступа к файлу', { status: 500 });
    }
            }
