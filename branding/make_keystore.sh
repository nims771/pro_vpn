#!/usr/bin/env bash
# Создаёт ключ подписи Android для релизных сборок.
# Нужен установленный JDK (команда keytool).
#
#   bash branding/make_keystore.sh
#
# Результат:
#   branding/release-keystore.p12      — сам ключ. ХРАНИТЕ В НАДЁЖНОМ МЕСТЕ:
#                                        без него нельзя выпустить обновление.
#   branding/release-keystore.base64   — то же в base64, для секрета GitHub
#                                        ANDROID_KEY_STORE_CONTENTS.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v keytool >/dev/null; then
  echo "keytool не найден — установите JDK 21 (например, Temurin) и повторите." >&2
  exit 1
fi
if [ -e release-keystore.p12 ]; then
  echo "release-keystore.p12 уже существует — не перезаписываю." >&2
  exit 1
fi

read -r -s -p "Придумайте пароль для ключа (минимум 6 символов): " PASS; echo
read -r -s -p "Повторите пароль: " PASS2; echo
[ "$PASS" = "$PASS2" ] || { echo "Пароли не совпадают." >&2; exit 1; }
[ ${#PASS} -ge 6 ] || { echo "Слишком короткий пароль." >&2; exit 1; }

NAME=$(python3 -c "import json;print(json.load(open('brand.json'))['name'])" 2>/dev/null || echo "ProClient")

# Сборка Outline ждёт PKCS#12 с алиасом privatekey (см. client/capacitor/README.md).
keytool -genkeypair -v \
  -storetype PKCS12 -keystore release-keystore.p12 \
  -alias privatekey -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=${NAME}, O=${NAME}"

base64 < release-keystore.p12 | tr -d '\n' > release-keystore.base64

cat <<EOF

Готово.
  Ключ:   branding/release-keystore.p12
  Base64: branding/release-keystore.base64

Добавьте в GitHub → Settings → Secrets and variables → Actions:
  ANDROID_KEY_STORE_CONTENTS = содержимое release-keystore.base64
  ANDROID_KEY_STORE_PASSWORD = ваш пароль

Файлы ключа уже в .gitignore — не публикуйте их.
EOF
