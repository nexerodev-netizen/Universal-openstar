// app/api/subscription/route.js
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

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    
    // 1. Генерация: /api/subscription?generate&userId=user1
    if (searchParams.has('generate')) {
        const userId = searchParams.get('userId');
        if (!userId) return new NextResponse('Нужен userId', { status: 400 });
        
        const token = await generateToken(userId);
        return new NextResponse(token, { headers: { 'Content-Type': 'text/plain' } });
    }

    // 2. Проверка и выдача файла: /api/subscription?token=eyJ...
    const token = searchParams.get('token');
    if (!token) return new NextResponse('Нет токена', { status: 400 });

    const check = await verifyToken(token);
    if (!check.valid) return new NextResponse('Токен истек или неверен', { status: 401 });

    // Читаем файл и отдаем его содержимое
    try {
        const content = fs.readFileSync(SUB_FILE_PATH, 'utf-8');
        return new NextResponse(content, { headers: { 'Content-Type': 'text/plain' } });
    } catch (err) {
        return new NextResponse('Файл sub-test.txt не найден', { status: 404 });
    }
}
