#!/bin/bash

echo "🔍 Проверка готовности APK к публикации"
echo "======================================"

APK_PATH="app/build/outputs/apk/release/app-release.apk"

if [ ! -f "$APK_PATH" ]; then
    echo "❌ APK файл не найден: $APK_PATH"
    exit 1
fi

echo "📁 Проверяем APK: $APK_PATH"

# Проверка подписи
echo "🔐 Проверка подписи..."
jarsigner -verify -verbose -certs "$APK_PATH"

# Проверка zipalign
echo "📦 Проверка zipalign..."
zipalign -c -v 4 "$APK_PATH"

# Информация об APK
echo "📊 Информация об APK:"
aapt dump badging "$APK_PATH" | grep -E "(package|sdkVersion|targetSdkVersion)"

# Размер файла
echo "📏 Размер APK:"
ls -lh "$APK_PATH"

echo "✅ Проверка завершена!"
