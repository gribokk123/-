#!/bin/bash

echo "🔐 Создание keystore для подписи APK"
echo "===================================="

# Создание keystore файла
keytool -genkey -v -keystore release-key.keystore -alias mafia_game_key -keyalg RSA -keysize 2048 -validity 10000

echo "✅ Keystore создан: release-key.keystore"
echo "⚠️  ВАЖНО: Сохраните этот файл и пароли в безопасном месте!"
echo "⚠️  Без них вы не сможете обновлять приложение в Google Play!"
