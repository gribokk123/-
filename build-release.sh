#!/bin/bash

echo "🚀 Сборка финальной версии APK для публикации"
echo "=============================================="

# 1. Очистка проекта
echo "📦 Очистка проекта..."
./gradlew clean

# 2. Проверка кода
echo "🔍 Проверка кода..."
./gradlew lint

# 3. Запуск тестов
echo "🧪 Запуск тестов..."
./gradlew test

# 4. Сборка release APK
echo "🔨 Сборка release APK..."
./gradlew assembleRelease

# 5. Сборка App Bundle (рекомендуется для Google Play)
echo "📱 Сборка App Bundle..."
./gradlew bundleRelease

echo "✅ Сборка завершена!"
echo "📁 APK: app/build/outputs/apk/release/app-release.apk"
echo "📁 AAB: app/build/outputs/bundle/release/app-release.aab"
