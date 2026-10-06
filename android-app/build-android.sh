#!/usr/bin/env bash
# Gera o APK Android do Minhas Contas.
# Uso:  cd android-app && bash build-android.sh
# Resultado: android-app/MinhasContas.apk
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

# ---------- 1. Ferramentas ----------
say "Conferindo ferramentas"

command -v node >/dev/null || fail "Node.js não encontrado. Instale a versão 22 ou mais nova (https://nodejs.org)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js $NODE_MAJOR encontrado; o Capacitor 8 precisa do 22 ou mais novo."

# Java: o Capacitor 8 precisa do JDK 21; o Gradle dele roda até o 24.
# Procura um Java compatível, mesmo que o JAVA_HOME aponte para outro (ex.: o 17 do Laps).
java_major() { "$1/bin/java" -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1; }
FOUND=""
for d in "${JAVA_HOME:-}" /usr/lib/jvm/java-21-openjdk* /usr/lib/jvm/*-21* /usr/lib/jvm/*21* \
         "$HOME/android-studio/jbr" /opt/android-studio/jbr /snap/android-studio/current/jbr \
         /usr/lib/jvm/java-2[2-4]-openjdk* /usr/lib/jvm/*; do
  [ -n "$d" ] && [ -x "$d/bin/java" ] || continue
  m=$(java_major "$d"); [ -n "$m" ] && [ "$m" -ge 21 ] && [ "$m" -le 24 ] && FOUND="$d" && break
done
[ -n "$FOUND" ] || fail "Nenhum JDK 21 encontrado (o 17 e o 25 não servem para o Capacitor 8). Instale com:  sudo apt install openjdk-21-jdk"
export JAVA_HOME="$FOUND"
JAVA_MAJOR=$(java_major "$JAVA_HOME")

# SDK do Android (o mesmo do Laps fica em ~/.local/share/Android/sdk)
if [ -z "${ANDROID_HOME:-}" ]; then
  for d in "${ANDROID_SDK_ROOT:-}" "$HOME/.local/share/Android/sdk" "$HOME/Android/Sdk"; do
    [ -n "$d" ] && [ -d "$d/platforms" -o -d "$d/platform-tools" ] && ANDROID_HOME="$d" && break
  done
fi
export ANDROID_HOME="${ANDROID_HOME:-}"
[ -n "$ANDROID_HOME" ] && [ -d "$ANDROID_HOME" ] || fail "SDK do Android não encontrado. Defina ANDROID_HOME (ex.: export ANDROID_HOME=~/.local/share/Android/sdk)."
export ANDROID_SDK_ROOT="$ANDROID_HOME"
echo "  Node $NODE_MAJOR · Java $JAVA_MAJOR ($JAVA_HOME) · SDK em $ANDROID_HOME"

# ---------- 2. Dependências e arquivos do app ----------
say "Instalando dependências (npm install)"
npm install --no-audit --no-fund

say "Copiando o app para dentro do projeto Android"
node copy-web.mjs

if [ ! -d android ]; then
  say "Criando o projeto Android (primeira vez)"
  npx cap add android
fi

say "Gerando ícones do app"
npx @capacitor/assets generate --android --assetPath assets \
  --iconBackgroundColor '#0f766e' --iconBackgroundColorDark '#0f766e' >/dev/null

# Ícone da notificação
mkdir -p android/app/src/main/res/drawable
cp res/drawable/ic_stat_contas.xml android/app/src/main/res/drawable/

say "Sincronizando plugins"
npx cap sync android

# ---------- 3. Build ----------
say "Gerando o APK (a primeira vez demora alguns minutos)"
( cd android && ./gradlew --quiet assembleDebug )
cp android/app/build/outputs/apk/debug/app-debug.apk MinhasContas.apk

# ---------- 4. Impressão digital para o Google Cloud ----------
KEYSTORE="$HOME/.android/debug.keystore"
SHA1=""
if [ -f "$KEYSTORE" ]; then
  KEYTOOL="$JAVA_HOME/bin/keytool"
  SHA1=$("$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias androiddebugkey -storepass android 2>/dev/null \
         | sed -n 's/.*SHA1: *//p' | head -1)
fi

printf '\n\033[1;32m✓ Pronto: %s\033[0m\n' "$(pwd)/MinhasContas.apk"
echo
echo "Para o login com Google funcionar, cadastre no Google Cloud um cliente OAuth do tipo Android com:"
echo "  Nome do pacote:  br.app.minhascontas"
echo "  SHA-1:           ${SHA1:-(não encontrado; rode: keytool -list -v -keystore ~/.android/debug.keystore -storepass android)}"
echo
echo "Guarde o arquivo $KEYSTORE: se ele mudar, o SHA-1 muda e o login no Android para de funcionar."
