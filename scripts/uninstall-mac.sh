#!/usr/bin/env bash
# LearnMate — macOS uninstaller. Removes the launchd service (keeps your data).
set -euo pipefail

LABEL="com.learnmate"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> Stopping and removing LearnMate service…"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "✅ Removed. Your learning data is untouched (in ./data/app.db)."
echo "   To start it manually again:  node server/index.js"
