#!/usr/bin/env bash
set -euo pipefail

api_base="${CLIPBOARD_VISION_API_BASE:-http://127.0.0.1:11434/v1}"
model="${CLIPBOARD_VISION_MODEL:-}"
api_key="${CLIPBOARD_VISION_API_KEY:-}"
max_bytes="${CLIPBOARD_VISION_MAX_BYTES:-10485760}"
allow_remote=false
confirm_remote=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-remote) allow_remote=true; shift ;;
    --confirm-remote)
      [ "$#" -ge 2 ] || { printf '%s\n' 'Error: --confirm-remote requires the disclosed token' >&2; exit 2; }
      confirm_remote="$2"
      shift 2
      ;;
    --help)
      printf '%s\n' 'Usage: clipboard-vision.sh [--allow-remote --confirm-remote TOKEN]'
      exit 0
      ;;
    *) printf 'Error: unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -n "$model" ] || { printf '%s\n' 'Error: CLIPBOARD_VISION_MODEL is required' >&2; exit 2; }
case "$max_bytes" in *[!0-9]*|'') printf '%s\n' 'Error: CLIPBOARD_VISION_MAX_BYTES must be a positive integer' >&2; exit 2 ;; esac
[ "$max_bytes" -gt 0 ] || { printf '%s\n' 'Error: CLIPBOARD_VISION_MAX_BYTES must be positive' >&2; exit 2; }

endpoint_info=$(python3 - "$api_base" "$model" <<'PY'
import hashlib
import ipaddress
import sys
import urllib.parse

url = urllib.parse.urlparse(sys.argv[1])
if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
    raise SystemExit(2)
try:
    loopback = ipaddress.ip_address(url.hostname).is_loopback
except ValueError:
    loopback = False
try:
    port = url.port or (443 if url.scheme == "https" else 80)
except ValueError:
    raise SystemExit(2)
print("local" if loopback else "remote")
hostname = url.hostname.lower()
print(hostname)
display_host = f"[{hostname}]" if ":" in hostname else hostname
base_path = url.path.rstrip("/")
effective = f"{url.scheme.lower()}://{display_host}:{port}{base_path}/chat/completions"
print(effective)
print(hashlib.sha256(f"{effective}\n{sys.argv[2]}".encode()).hexdigest())
PY
) || { printf '%s\n' 'Error: invalid CLIPBOARD_VISION_API_BASE' >&2; exit 2; }
endpoint_kind=$(printf '%s\n' "$endpoint_info" | sed -n '1p')
effective_endpoint=$(printf '%s\n' "$endpoint_info" | sed -n '3p')
expected_confirmation=$(printf '%s\n' "$endpoint_info" | sed -n '4p')

if [ "$endpoint_kind" = remote ]; then
  printf 'Remote disclosure: clipboard image data will be sent to %s using model %s.\n' "$effective_endpoint" "$model" >&2
  printf 'Confirmation token for this canonical endpoint and model: %s\n' "$expected_confirmation" >&2
  if [ "$allow_remote" != true ] || [ "$confirm_remote" != "$expected_confirmation" ]; then
    printf '%s\n' 'Error: remote endpoint requires --allow-remote and the disclosed --confirm-remote token' >&2
    exit 2
  fi
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/clipboard-vision.XXXXXX")
image_file="$work_dir/clipboard.png"
request_file="$work_dir/request.json"
response_file="$work_dir/response.json"
auth_file="$work_dir/auth-header"
cleanup() { rm -rf -- "$work_dir"; }
trap cleanup EXIT HUP INT TERM

if command -v pngpaste >/dev/null 2>&1; then
  pngpaste "$image_file"
elif command -v wl-paste >/dev/null 2>&1; then
  wl-paste --no-newline --type image/png > "$image_file"
elif command -v import >/dev/null 2>&1; then
  import clipboard: "$image_file"
else
  printf '%s\n' 'Error: install pngpaste, wl-paste, or ImageMagick import' >&2
  exit 2
fi

[ -s "$image_file" ] || { printf '%s\n' 'Error: clipboard does not contain an image' >&2; exit 2; }
image_bytes=$(wc -c < "$image_file" | tr -d '[:space:]')
[ "$image_bytes" -le "$max_bytes" ] || { printf 'Error: clipboard image exceeds %s bytes\n' "$max_bytes" >&2; exit 2; }

python3 - "$image_file" "$request_file" "$model" <<'PY'
import base64
import json
import pathlib
import sys

image = base64.b64encode(pathlib.Path(sys.argv[1]).read_bytes()).decode("ascii")
request = {
    "model": sys.argv[3],
    "messages": [{"role": "user", "content": [
        {"type": "text", "text": "Describe this clipboard image."},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + image}},
    ]}],
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(request), encoding="utf-8")
PY

curl_args=(--silent --show-error --max-redirs 0 --output "$response_file" --write-out '%{http_code}' --header 'Content-Type: application/json' --data-binary "@$request_file")
if [ -n "$api_key" ]; then
  case "$api_key" in *$'\n'*|*$'\r'*) printf '%s\n' 'Error: invalid CLIPBOARD_VISION_API_KEY' >&2; exit 2 ;; esac
  umask 077
  printf 'Authorization: Bearer %s\n' "$api_key" > "$auth_file"
  chmod 600 "$auth_file"
  curl_args+=(--header "@$auth_file")
fi
status=$(curl "${curl_args[@]}" "$effective_endpoint") || { printf '%s\n' 'Error: vision API request failed' >&2; exit 1; }
case "$status" in 2??) ;; *) printf 'Error: vision API returned HTTP %s (body redacted)\n' "$status" >&2; exit 1 ;; esac

result=$(python3 - "$response_file" <<'PY'
import json
import pathlib
import sys

try:
    data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    value = data["choices"][0]["message"]["content"]
    if not isinstance(value, str):
        raise ValueError
except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
    raise SystemExit(2)
print(value)
PY
) || { printf '%s\n' 'Error: invalid vision API response (body redacted)' >&2; exit 1; }

printf '%s\n' "$result"
