#!/usr/bin/env bash
# describe-clipboard.sh
# Cross-platform: reads clipboard image, calls vision API, writes description.
# Works on: WSL/Linux (xclip), macOS (osascript), Windows Git Bash (PowerShell)
#
# Requires CLIPBOARD_VISION_API_KEY environment variable.
# WARNING: Do not run with `set -x` — the API key would be logged.
set -euo pipefail

OUTPUT_FILE="${1:-/tmp/clipboard_desc.txt}"
API_KEY="${CLIPBOARD_VISION_API_KEY:-}"
API_BASE="${CLIPBOARD_VISION_API_BASE:-https://lab.iwhalecloud.com/gpt-proxy}"
MODEL="LOCAL/Qwen3.5-122B-A10B"
TEMP_PNG=""

if [ -z "$API_KEY" ]; then
    echo "ERROR: CLIPBOARD_VISION_API_KEY environment variable not set" >&2
    exit 1
fi

cleanup() {
    if [ -n "$TEMP_PNG" ] && [ -f "$TEMP_PNG" ]; then
        rm -f "$TEMP_PNG"
    fi
}
trap cleanup EXIT

# --- Detect platform and read clipboard ---
get_base64_from_clipboard() {
    local platform b64_cmd
    platform="$(uname -s)"

    if [ "$platform" = "Linux" ]; then
        b64_cmd="base64 -w 0"
        # WSL / Linux: use xclip or wl-paste
        if command -v xclip &>/dev/null; then
            TARGETS="$(xclip -selection clipboard -o -t TARGETS 2>/dev/null || echo "")"
            if echo "$TARGETS" | grep -qx "image/png"; then
                TEMP_PNG="$(mktemp /tmp/clipboard_XXXXXX.png)"
                xclip -selection clipboard -o -t image/png > "$TEMP_PNG"
                $b64_cmd "$TEMP_PNG"
            else
                echo "ERROR: No PNG image in clipboard (xclip targets: ${TARGETS:-none})" >&2
                exit 1
            fi
        elif command -v wl-paste &>/dev/null; then
            TEMP_PNG="$(mktemp /tmp/clipboard_XXXXXX.png)"
            wl-paste -t image/png > "$TEMP_PNG"
            $b64_cmd "$TEMP_PNG"
        else
            echo "ERROR: No clipboard tool found (install xclip or wl-clipboard)" >&2
            exit 1
        fi
    elif [ "$platform" = "MINGW64_NT" ] || [ "$platform" = "MSYS_NT" ] || [ "${OS:-}" = "Windows_NT" ]; then
        b64_cmd="base64 -w 0"
        # Windows Git Bash: delegate to PowerShell
        PS_EXE="/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        if [ ! -f "$PS_EXE" ]; then
            PS_EXE="powershell.exe"
        fi
        TEMP_PNG="$(mktemp --suffix=.png)"
        WIN_TEMP="$(cygpath -w "$TEMP_PNG" 2>/dev/null || echo "$TEMP_PNG")"
        "$PS_EXE" -NoProfile -NonInteractive -Command "
            Add-Type -AssemblyName System.Windows.Forms;
            Add-Type -AssemblyName System.Drawing;
            \$img = [System.Windows.Forms.Clipboard]::GetImage();
            if (-not \$img) { Write-Host 'NO_IMAGE'; exit 1 };
            \$img.Save('$WIN_TEMP', [System.Drawing.Imaging.ImageFormat]::Png);
            Write-Host 'OK';
        " > /dev/null
        if [ ! -f "$TEMP_PNG" ] || [ ! -s "$TEMP_PNG" ]; then
            echo "ERROR: No image found in clipboard" >&2
            exit 1
        fi
        $b64_cmd "$TEMP_PNG"
    else
        # macOS
        b64_cmd="base64 -b 0"
        if command -v osascript &>/dev/null; then
            TEMP_PNG="$(mktemp /tmp/clipboard_XXXXXX.png)"
            if ! osascript -e "set theFile to (open for access POSIX file \"$TEMP_PNG\" with write permission)" \
                            -e "write (the clipboard as «class PNGf») to theFile" \
                            -e "close access theFile" 2>/dev/null; then
                echo "ERROR: Failed to read image from macOS clipboard" >&2
                exit 1
            fi
            if [ ! -s "$TEMP_PNG" ]; then
                echo "ERROR: No image in clipboard" >&2
                exit 1
            fi
            $b64_cmd "$TEMP_PNG"
        else
            echo "ERROR: Unsupported platform ($platform)" >&2
            exit 1
        fi
    fi
}

# --- Build and send API request via python3 (safe JSON construction) ---
call_vision_api() {
    local b64="$1"
    python3 -c "
import json, sys, os, urllib.request

api_key = os.environ['CLIPBOARD_VISION_API_KEY']
api_base = os.environ.get('CLIPBOARD_VISION_API_BASE', 'https://lab.iwhalecloud.com/gpt-proxy')
model = 'LOCAL/Qwen3.5-122B-A10B'

body = json.dumps({
    'model': model,
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'text', 'text': 'Describe this image in detail. Include all visible text, UI elements, code, error messages, objects, people, and any information conveyed. Be specific and thorough but concise. If it contains code or terminal output, quote it exactly.'},
            {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{sys.argv[1]}'}}
        ]
    }],
    'max_tokens': 1024,
    'temperature': 0.1
}).encode('utf-8')

req = urllib.request.Request(
    f'{api_base}/chat/completions',
    data=body,
    headers={
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    if not data.get('choices') or not data['choices'][0].get('message'):
        print('ERROR: Unexpected API response structure', file=sys.stderr)
        sys.exit(1)
    content = data['choices'][0]['message'].get('content', '')
    if not content:
        print('ERROR: Empty response from vision model', file=sys.stderr)
        sys.exit(1)
    print(content)
except Exception as e:
    print(f'ERROR: API call failed: {e}', file=sys.stderr)
    sys.exit(1)
" "$b64"
}

# --- Main ---
echo "[clipboard-vision] Reading clipboard..." >&2
B64="$(get_base64_from_clipboard)"

echo "[clipboard-vision] Calling vision model ($MODEL)..." >&2

DESCRIPTION="$(call_vision_api "$B64")"

echo "$DESCRIPTION" > "$OUTPUT_FILE"
echo "[clipboard-vision] Description saved to: $OUTPUT_FILE" >&2

echo "---"
echo "$DESCRIPTION"
echo "---"
