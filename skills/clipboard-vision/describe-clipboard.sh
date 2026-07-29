#!/usr/bin/env bash
# describe-clipboard.sh
# Cross-platform: reads clipboard image, calls vision API, writes description.
# Works on: Windows (Git Bash / MSYS2), WSL/Linux (xclip), macOS (osascript)
set -euo pipefail

OUTPUT_FILE="${1:-/tmp/clipboard_desc.txt}"
API_KEY="ailab_YL+F7NNalGHNiJUHB46TaCAiMPJk2Q9PrgOcdm2aSqbEHUtxgnQjudORt2Z5BxP2BZ/qMmtBdRHHxCg6rcDlWf+CpV6em2iubEdJzVy5AiDQ"
API_BASE="https://lab.iwhalecloud.com/gpt-proxy"
MODEL="LOCAL/Qwen3.5-122B-A10B"
TEMP_PNG=""

cleanup() {
    if [ -n "$TEMP_PNG" ] && [ -f "$TEMP_PNG" ]; then
        rm -f "$TEMP_PNG"
    fi
}
trap cleanup EXIT

# --- Detect platform ---
get_base64_from_clipboard() {
    if [ "$(uname -s)" = "Linux" ]; then
        # WSL / Linux: use xclip
        if command -v xclip &>/dev/null; then
            TARGETS=$(xclip -selection clipboard -o -t TARGETS 2>/dev/null || echo "")
            if echo "$TARGETS" | grep -q "image/png"; then
                TEMP_PNG=$(mktemp /tmp/clipboard_XXXXXX.png)
                xclip -selection clipboard -o -t image/png > "$TEMP_PNG"
                base64 -w 0 "$TEMP_PNG"
            else
                echo "ERROR: No image in clipboard (xclip targets: ${TARGETS:-none})" >&2
                exit 1
            fi
        elif command -v wl-paste &>/dev/null; then
            TEMP_PNG=$(mktemp /tmp/clipboard_XXXXXX.png)
            wl-paste -t image/png > "$TEMP_PNG"
            base64 -w 0 "$TEMP_PNG"
        else
            echo "ERROR: No clipboard tool found (install xclip or wl-clipboard)" >&2
            exit 1
        fi
    elif [ "$(uname -s)" = "MINGW64_NT" ] || [ "$(uname -s)" = "MSYS_NT" ] || [ "${OS:-}" = "Windows_NT" ]; then
        # Windows Git Bash: use PowerShell via /c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
        PS_EXE="/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        if [ ! -f "$PS_EXE" ]; then
            # Fallback: try PATH
            PS_EXE="powershell.exe"
        fi
        TEMP_PNG=$(mktemp --suffix=.png)
        WIN_TEMP=$(cygpath -w "$TEMP_PNG" 2>/dev/null || echo "$TEMP_PNG")
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
        base64 -w 0 "$TEMP_PNG"
    else
        # macOS fallback
        if command -v osascript &>/dev/null; then
            TEMP_PNG=$(mktemp /tmp/clipboard_XXXXXX.png)
            osascript -e "set theFile to (open for access POSIX file \"$TEMP_PNG\" with write permission)" \
                       -e "write (the clipboard as «class PNGf») to theFile" \
                       -e "close access theFile" 2>/dev/null || true
            if [ ! -s "$TEMP_PNG" ]; then
                echo "ERROR: No image in clipboard" >&2
                exit 1
            fi
            base64 -b 0 "$TEMP_PNG" 2>/dev/null || base64 -w 0 "$TEMP_PNG"
        else
            echo "ERROR: Unsupported platform" >&2
            exit 1
        fi
    fi
}

# --- Main ---
echo "[clipboard-vision] Reading clipboard..." >&2
B64=$(get_base64_from_clipboard)

echo "[clipboard-vision] Calling vision model ($MODEL)..." >&2

REQUEST_BODY=$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Describe this image in detail. Include all visible text, UI elements, code, error messages, objects, people, and any information conveyed. Be specific and thorough but concise. If it contains code or terminal output, quote it exactly."
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,$B64"
          }
        }
      ]
    }
  ],
  "max_tokens": 1024,
  "temperature": 0.1
}
EOF
)

# Determine curl binary (Windows Git Bash has curl.exe, not curl)
if command -v curl &>/dev/null; then
    CURL="curl"
elif command -v curl.exe &>/dev/null; then
    CURL="curl.exe"
else
    echo "ERROR: curl not found" >&2
    exit 1
fi

RESPONSE=$("$CURL" -s -S --max-time 30 \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY" \
    "$API_BASE/chat/completions" 2>&1) || {
    echo "ERROR: API call failed: $RESPONSE" >&2
    exit 1
}

DESCRIPTION=$(echo "$RESPONSE" | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//;s/"$//' | sed 's/\\n/\n/g; s/\\"/"/g; s/\\\\/\\/g' 2>/dev/null)

# Fallback: use python for JSON parsing if available
if [ -z "$DESCRIPTION" ] && command -v python3 &>/dev/null; then
    DESCRIPTION=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'])" 2>/dev/null || echo "")
fi

if [ -z "$DESCRIPTION" ]; then
    echo "ERROR: Empty response from vision model" >&2
    echo "Raw response: $RESPONSE" >&2
    exit 1
fi

echo "$DESCRIPTION" > "$OUTPUT_FILE"
echo "[clipboard-vision] Description saved to: $OUTPUT_FILE" >&2

# Output to stdout
echo "---"
echo "$DESCRIPTION"
echo "---"
