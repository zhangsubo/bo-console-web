#!/usr/bin/env zsh
set -euo pipefail

EXTENSION_ID="${1:-}"

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Usage: $0 <32-char-extension-id>" >&2
  echo "Extension ID must be exactly 32 lowercase letters a-p." >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
ENV_FILE="$PROJECT_DIR/helper/.env"
ENV_EXAMPLE="$PROJECT_DIR/helper/.env.example"
PLIST_NAME="com.bo.console.helper"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$PLIST_NAME.plist"

mkdir -p "$PLIST_DIR"

# Create .env if missing
if [[ ! -f "$ENV_FILE" ]]; then
  HELPER_TOKEN="$(/usr/bin/openssl rand -hex 32)"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  sed -i '' "s/^HELPER_TOKEN=$/HELPER_TOKEN=$HELPER_TOKEN/" "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

# Update ALLOWED_EXTENSION_ID (preserves HELPER_TOKEN and NEZHA_PAT)
sed -i '' "s/^ALLOWED_EXTENSION_ID=.*$/ALLOWED_EXTENSION_ID=$EXTENSION_ID/" "$ENV_FILE"

# Back up existing plist
if [[ -f "$PLIST_PATH" ]]; then
  BACKUP="$PLIST_PATH.bak.$(date +%Y%m%d%H%M%S)"
  mv "$PLIST_PATH" "$BACKUP"
  echo "Backed up existing plist to $BACKUP"
fi

# Generate launchd plist
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--env-file=$ENV_FILE</string>
    <string>$PROJECT_DIR/helper/server.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$PROJECT_DIR/helper/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$PROJECT_DIR/helper/stderr.log</string>
</dict>
</plist>
PLIST

if [[ "${BO_CONSOLE_DRY_RUN:-}" == "1" ]]; then
  echo "[dry-run] Would bootstrap $PLIST_PATH"
else
  # Boot out old label if present
  launchctl bootout "gui/$UID/$PLIST_NAME" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$PLIST_PATH"
  echo "Helper installed and started."
fi

echo ""
echo "Environment: $ENV_FILE"
echo "Plist: $PLIST_PATH"
echo ""
echo "To restart later:"
echo "  launchctl kickstart -k gui/$UID/$PLIST_NAME"
