#!/bin/bash

echo "🚀 Подготовка к деплою на Render"
echo "================================"

# Проверяем наличие необходимых файлов
if [ ! -f "package.json" ]; then
    echo "❌ package.json не найден!"
    exit 1
fi

if [ ! -f "server.js" ]; then
    echo "❌ server.js не найден!"
    exit 1
fi

echo "✅ Все файлы на месте"

# Проверяем зависимости
echo "📦 Проверяем зависимости..."
npm audit --audit-level moderate

# Тестируем локально
echo "🧪 Тестируем сервер локально..."
timeout 10s npm start &
SERVER_PID=$!

sleep 5

# Проверяем что сервер запустился
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ Сервер работает локально"
else
    echo "❌ Сервер не запускается локально"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

kill $SERVER_PID 2>/dev/null

echo "🎉 Готово к деплою на Render!"
echo ""
echo "📋 Следующие шаги:"
echo "1. Загрузите код в GitHub"
echo "2. Создайте Web Service на Render.com"
echo "3. Подключите GitHub репозиторий"
echo "4. Установите Root Directory: server"
echo "5. Build Command: npm install"
echo "6. Start Command: npm start"
echo "7. Deploy!"
