#!/usr/bin/env bash
# LearnMate — macOS auto-start installer.
#
# Installs LearnMate as a launchd agent so it:
#   - starts automatically when you log in
#   - restarts automatically if it crashes
#   - keeps your learning history in ./data (persistent)
#
# Run once:  ./scripts/install-mac.sh
# Open:      http://localhost:4000
#
# Manage afterwards:
#   launchctl list | grep learnmate        # is it running?
#   launchctl stop  com.learnmate          # stop it
#   launchctl start com.learnmate          # start it
#   scripts/uninstall-mac.sh               # remove the service
#
set -euo pipefail

# Resolve the repo directory (parent of this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LABEL="com.learnmate"
PORT="${PORT:-4000}"

echo "==> LearnMate macOS installer"
echo "    App directory : $APP_DIR"
echo "    Port          : $PORT"

# 1. Check for Node.js (v22+ for built-in SQLite)
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js not found. Install it first: https://nodejs.org (v22 or newer)"
  echo "  (easiest:  brew install node@22)"
  exit 1
fi
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "✗ Node.js $NODE_MAJOR detected — LearnMate needs v22+ (uses built-in SQLite)."
  echo "  Upgrade with:  brew install node@22"
  exit 1
fi
echo "✓ Node.js v$(node -v) at $NODE_BIN"

# 2. Install dependencies and build the frontend (one-time)
echo "==> Installing dependencies and building frontend…"
cd "$APP_DIR"
npm install
npm run build

# 3. Write the launchd plist
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$APP_DIR/data"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$APP_DIR/server/index.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$APP_DIR</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>$PORT</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>SEED_DEMO</key>
        <string>false</string>
    </dict>

    <key>StandardOutPath</key>
    <string>$APP_DIR/data/learnmate.log</string>
    <key>StandardErrorPath</key>
    <string>$APP_DIR/data/learnmate.log</string>
</dict>
</plist>
EOF
echo "✓ launchd plist written to $PLIST"

# 4. Load it
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "✓ Service loaded"

# 5. Wait for it to come up and verify
sleep 3
if curl -sf "http://localhost:$PORT/api/config" >/dev/null 2>&1; then
  echo ""
  echo "✅ LearnMate is running!"
  echo "    Open:  http://localhost:$PORT"
  echo ""
  echo "    It will auto-start on every login and restart if it crashes."
  echo "    Your data lives in:  $APP_DIR/data/"
  echo ""
  echo "    Useful commands:"
  echo "      launchctl list | grep $LABEL    # check status"
  echo "      launchctl stop $LABEL           # stop"
  echo "      launchctl start $LABEL          # start"
  echo "      $SCRIPT_DIR/uninstall-mac.sh    # remove the service"
else
  echo "⚠  Service loaded but not reachable yet. Check logs:  tail -f $APP_DIR/data/learnmate.log"
fi
