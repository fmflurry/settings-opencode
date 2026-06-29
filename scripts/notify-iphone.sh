#!/usr/bin/env bash
#
# notify-iphone.sh — send push notification to iPhone/Apple Watch via Bark.
#
set -euo pipefail

KEY="${BARK_DEVICE_KEY:-}"
if [ -z "$KEY" ]; then
    printf "Error: BARK_DEVICE_KEY not set\n" >&2
    exit 1
fi
unset BARK_DEVICE_KEY

strip_emoji() {
    printf '%s' "$1" | perl -pe 's/[^\x00-\x7F]//g'
}

curl_config_value() {
    printf '%s' "$1" | perl -0pe 's/\\/\\\\/g; s/"/\\"/g; s/\r/\\r/g; s/\n/\\n/g; s/\t/\\t/g'
}

TITLE=$(strip_emoji "${1:-OpenCode}")
BODY=$(strip_emoji "${2:-Done!}")
CATEGORY=$(strip_emoji "${3:-}")

{
    printf 'url = "https://api.day.app/push"\n'
    printf 'request = "POST"\n'
    printf 'data-urlencode = "device_key=%s"\n' "$(curl_config_value "$KEY")"
    printf 'data-urlencode = "title=%s"\n' "$(curl_config_value "$TITLE")"
    printf 'data-urlencode = "body=%s"\n' "$(curl_config_value "$BODY")"
    if [ -n "$CATEGORY" ]; then
        printf 'data-urlencode = "category=%s"\n' "$(curl_config_value "$CATEGORY")"
    fi
} | curl -fsS -o /dev/null --max-time 10 --config -
