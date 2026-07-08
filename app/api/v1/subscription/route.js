// app/api/v1/subscription/route.js
import { NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import fs from 'fs';
import path from 'path';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'super-secret-key-123');
const SUB_FILE_PATH = path.join(process.cwd(), 'sub-test.txt');

async function generateToken(userId) {
    return await new SignJWT({ userId })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(SECRET);
}

async function verifyToken(token) {
    try {
        const { payload } = await jwtVerify(token, SECRET);
        return { valid: true, userId: payload.userId };
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

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    
    // 1. Генерация токена: ?generate&userId=...
    if (searchParams.has('generate')) {
        const userId = searchParams.get('userId');
        if (!userId) return new NextResponse('Нужен userId', { status: 400 });
        
        const token = await generateToken(userId);
        return new NextResponse(token, { headers: { 'Content-Type': 'text/plain' } });
    }

    // 2. Проверка токена: ?token=...
    const token = searchParams.get('token');
    if (!token) return new NextResponse('Нет токена', { status: 400 });

    const check = await verifyToken(token);
    
    // ЕСЛИ ТОКЕН ИСТЕК -> ОТДАЕМ ТОЛЬКО ЗАГЛУШКУ (старые серверы пропадут)
    if (!check.valid) {
        const stubLink = getExpiredStubLink();
        return new NextResponse(stubLink, { headers: { 'Content-Type': 'text/plain' } });
    }

    // 3. Если токен АКТИВЕН -> отдаем содержимое файла
    try {
        if (!fs.existsSync(SUB_FILE_PATH)) {
            return new NextResponse('Файл sub-test.txt не найден', { status: 404 });
        }
        const content = fs.readFileSync(SUB_FILE_PATH, 'utf-8').trim();
        return new NextResponse(content, { headers: { 'Content-Type': 'text/plain' } });
    } catch (err) {
        console.error('Ошибка чтения файла:', err);
        return new NextResponse('Ошибка доступа к файлу', { status: 500 });
    }
}
