#!/bin/bash
set -e

echo "Starting supervisor (Xvfb, fluxbox, x11vnc, noVNC)..."
/usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf &

# Attendre que Xvfb soit prêt
echo "Waiting for X server to start..."
for i in {1..30}; do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "✅ X server is ready!"
    break
  fi
  echo "Waiting... ($i/30)"
  sleep 1
done

if ! xdpyinfo -display :99 >/dev/null 2>&1; then
  echo "❌ X server failed to start"
  exit 1
fi

# Attendre un peu pour que tous les services soient vraiment prêts
sleep 2

echo "Installing Playwright browsers..."
npx playwright install chromium
npx playwright install-deps chromium

echo "✅ Ready! Open http://localhost:6080 in your browser"
echo "🚀 Running test..."
npm test
