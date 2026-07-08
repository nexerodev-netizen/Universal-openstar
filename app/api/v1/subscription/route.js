// app/api/v1/subscription/route.js
import { NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'super-secret-key-123');
const SUB_FILE_PATH = path.join(process.cwd(), 'sub-test.txt'); // Возвращаем общий файл, как ты просил

const BROWSER_KEYWORDS = ['mozilla', 'chrome', 'safari', 'firefox', 'edge', 'opera', 'msie', 'trident'];

function isBrowser(userAgent) {
    if (!userAgent) return false;
    const ua = userAgent.toLowerCase();
    const hasBrowser = BROWSER_KEYWORDS.some(kw => ua.includes(kw));
    const isVpnClient = /v2ray|clash|hiddify|streisand|shadowrocket|surge|okhttp|java/i.test(ua);
    return hasBrowser && !isVpnClient;
}

function parseDuration(durationStr) {
    if (!durationStr) return '10m';
    const match = durationStr.match(/^(\d+)([mhd])$/);
    if (!match) return '10m';
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    if (unit === 'm' && value > 1440) return '1440m';
    if (unit === 'h' && value > 720) return '720h';
    if (unit === 'd' && value > 365) return '365d';
    
    return `${value}${unit}`;
}

function generateUserId() {
    return 'user_' + crypto.randomBytes(6).toString('hex');
}

async function generateToken(userId, duration = '10m') {
    const safeDuration = parseDuration(duration);
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

function renderSubscriptionPage(token, isValid, expiresAt, userId, action = null) {
    const isExpired = !isValid;
    const statusColor = isExpired ? '#ef4444' : '#10b981';
    let statusText = isExpired ? 'ПОДПИСКА ИСТЕКЛА' : 'АКТИВНА';
    let statusIcon = isExpired ? '' : '✅';
    
    if (action === 'renewed') {
        statusText = 'ПОДПИСКА ПРОДЛЕНА';
        statusColor = '#3b82f6';
        statusIcon = '🔄';
    } else if (action === 'deleted') {
        statusText = 'ДОСТУП УДАЛЁН';
        statusColor = '#ef4444';
        statusIcon = '🗑️';
    }
    
    const expireDate = expiresAt ? new Date(expiresAt * 1000).toLocaleString('ru-RU') : '-';
    const displayUserId = userId || (isValid ? token.split('.').pop() : '-');

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
            padding: 20px;
        }
        .card { 
            background: rgba(255,255,255,0.05); backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
            padding: 40px 30px; max-width: 420px; width: 100%; text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }
        .status { 
            font-size: 26px; font-weight: bold; margin-bottom: 15px;
            color: ${statusColor}; display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .info-row { 
            background: rgba(255,255,255,0.05); border-radius: 12px; 
            padding: 12px; margin-bottom: 10px; text-align: left;
        }
        .info-label { font-size: 12px; color: #94a3b8; margin-bottom: 4px; }
        .info-value { font-size: 16px; font-weight: 500; word-break: break-all; }
        .timer { 
            font-size: 42px; font-weight: bold; margin: 25px 0;
            font-variant-numeric: tabular-nums; letter-spacing: 2px;
        }
        .copy-btn {
            background: ${statusColor}; color: white; border: none;
            padding: 16px 28px; border-radius: 12px; font-size: 16px; font-weight: 600;
            cursor: pointer; transition: all 0.2s; width: 100%; margin-top: 10px;
        }
        .copy-btn:hover { opacity: 0.9; transform: translateY(-1px); }
        .copy-btn:active { transform: scale(0.98); }
        .hint { font-size: 12px; color: #64748b; margin-top: 15px; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="card">
        <div class="status">${statusIcon} ${statusText}</div>
        
        <div class="info-row">
            <div class="info-label">User ID</div>
            <div class="info-value">${displayUserId}</div>
        </div>
        
        <div class="info-row">
            <div class="info-label">Истекает</div>
            <div class="info-value">${expireDate}</div>
        </div>
        
        ${!isExpired && !action ? `<div class="timer" id="timer">--:--:--</div>` : ''}
        
        <button class="copy-btn" onclick="copyLink()"> Скопировать ссылку подписки</button>
        <div class="hint">Вставьте эту ссылку в V2RayNG / Hiddify / Streisand<br>для автоматического обновления серверов</div>
    </div>
    
    <script>
        const currentUrl = window.location.href;
        
        function copyLink() {
            navigator.clipboard.writeText(currentUrl).then(() => {
                const btn = document.querySelector('.copy-btn');
                const original = btn.textContent;
                btn.textContent = '✅ Скопировано!';
                btn.style.background = '#10b981';
                setTimeout(() => {
                    btn.textContent = original;
                    btn.style.background = '${statusColor}';
                }, 2000);
            });
        }
        
        ${!isExpired && !action ? `
        const expiresAt = ${expiresAt};
        function updateTimer() {
            const diff = Math.max(0, Math.floor((expiresAt * 1000 - Date.now()) / 1000));
            const h = String(Math.floor(diff / 3600)).padStart(2, '0');
            const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
            const s = String(diff % 60).padStart(2, '0');
            document.getElementById('timer').textContent = h + ':' + m + ':' + s;
            if (diff <= 0) location.reload();
        }
        updateTimer();
        setInterval(updateTimer, 1000);
        ` : ''}
    </script>
</body>
</html>`;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userAgent = request.headers.get('user-agent') || '';
    const isBrowserRequest = isBrowser(userAgent);

    // 1. Генерация новой подписки (?generate&duration=8m)
    if (searchParams.has('generate')) {
        const duration = searchParams.get('duration') || '10m';
        const userId = generateUserId();
        const fullToken = await generateToken(userId, duration);
        const baseUrl = request.nextUrl.origin + '/api/v1/subscription';
        const subscriptionLink = `${baseUrl}?token=${fullToken}`;
        
        return new NextResponse(subscriptionLink, { headers: { 'Content-Type': 'text/plain' } });
    }

    // 2. Продление подписки (?renew&token=...&duration=7d)
    // ТЕПЕРЬ РАБОТАЕТ ДАЖЕ С ИСТЕКШИМИ ТОКЕНАМИ!
    if (searchParams.has('renew')) {
        const rawToken = searchParams.get('token');
        const duration = searchParams.get('duration') || '7d';
        
        if (!rawToken) {
            return new NextResponse('Нет токена для продления', { status: 400 });
        }
        
        // ИЗВЛЕКАЕМ USERID ПРЯМО ИЗ СТРУКТУРЫ ТОКЕНА (без проверки срока!)
        let userId;
        const parts = rawToken.split('.');
        if (parts.length === 4) {
            userId = parts[3]; // Берем userID из конца ссылки
        } else {
            // Если формат странный, пробуем стандартную проверку
            const check = await verifyToken(rawToken);
            if (!check.valid) {
                return new NextResponse('Неверный формат токена', { status: 400 });
            }
            userId = check.userId;
        }
        
        // Создаем НОВЫЙ токен для этого же пользователя с новым сроком
        const newToken = await generateToken(userId, duration);
        const baseUrl = request.nextUrl.origin + '/api/v1/subscription';
        const newLink = `${baseUrl}?token=${newToken}`;
        
        if (isBrowserRequest) {
            const newCheck = await verifyToken(newToken);
            return new NextResponse(renderSubscriptionPage(newToken, true, newCheck.exp, userId, 'renewed'), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        
        return new NextResponse(newLink, { headers: { 'Content-Type': 'text/plain' } });
    }

    // 3. Удаление подписки (?delete&token=...)
    if (searchParams.has('delete')) {
        const rawToken = searchParams.get('token');
        
        if (!rawToken) {
            return new NextResponse('Нет токена для удаления', { status: 400 });
        }
        
        const check = await verifyToken(rawToken);
        
        if (isBrowserRequest) {
            return new NextResponse(renderSubscriptionPage(rawToken, false, null, check.valid ? check.userId : '', 'deleted'), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        
        return new NextResponse(getExpiredStubLink(), { headers: { 'Content-Type': 'text/plain' } });
    }

    // 4. Обычная проверка токена
    const rawToken = searchParams.get('token');
    if (!rawToken) {
        return new NextResponse(renderSubscriptionPage('', false, null, ''), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }

    const check = await verifyToken(rawToken);

    if (!check.valid) {
        if (isBrowserRequest) {
            return new NextResponse(renderSubscriptionPage(rawToken, false, null, ''), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        return new NextResponse(getExpiredStubLink(), { headers: { 'Content-Type': 'text/plain' } });
    }

    try {
        // Читаем общий файл для всех
        if (!fs.existsSync(SUB_FILE_PATH)) {
            return new NextResponse('Файл sub-test.txt не найден', { status: 404 });
        }
        const content = fs.readFileSync(SUB_FILE_PATH, 'utf-8').trim();
        
        if (isBrowserRequest) {
            return new NextResponse(renderSubscriptionPage(rawToken, true, check.exp, check.userId), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
        
        return new NextResponse(content, { headers: { 'Content-Type': 'text/plain' } });
    } catch (err) {
        console.error('Ошибка:', err);
        return new NextResponse('Ошибка сервера', { status: 500 });
    }
                }
