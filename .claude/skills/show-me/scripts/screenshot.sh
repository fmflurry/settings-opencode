#!/usr/bin/env bash
# Chrome and Firefox --screenshot capture only the window, so a first pass renders a
# temp copy of the page with an appended script that reports its scroll height and
# active media queries, and the second pass sizes the window to that height.
# Firefox needs --no-remote and a throwaway --profile, otherwise it exits with
# "Firefox is already running" whenever the user's own Firefox is open.
# Usage: bash screenshot.sh <file.html> [out-dir]

set -u

PW_JS='
const [mode, w, ...rest] = process.argv.slice(1);
let chromium;
try {
  chromium = require("playwright").chromium;
} catch (e) {
  process.exit(3);
}
(async () => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    process.exit(3);
  }
  try {
    const shot = mode === "shot";
    const height = shot ? Number(rest[0]) : 800;
    const url = rest[rest.length - 1];
    const page = await browser.newPage({ viewport: { width: Number(w), height } });
    if (shot) {
      await page.goto(url);
      await page.screenshot({ path: rest[1] });
    } else {
      let seen;
      const measured = new Promise((resolve) => { seen = resolve; });
      page.on("console", (m) => {
        console.log(m.text());
        if (m.text().startsWith("SHOW_ME_MEASURE")) seen();
      });
      await page.goto(url);
      await Promise.race([measured, page.waitForTimeout(3000)]);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
'

MEASURE_SCRIPT='<script>addEventListener("load",function(){var d=document.documentElement,m=[];try{for(var s of document.styleSheets){var r;try{r=s.cssRules}catch(e){continue}for(var x of r){if(x.type===4&&matchMedia(x.media.mediaText).matches)m.push(x.media.mediaText)}}}catch(e){}var l="SHOW_ME_MEASURE h="+Math.ceil(Math.max(d.scrollHeight,document.body?document.body.scrollHeight:0))+" m="+encodeURIComponent(m.join("|"));console.log(l);if(window.dump)dump(l+"\n")})</script>'

MAX_HEIGHT=12000
FALLBACK_HEIGHT=2000
measure_re="SHOW_ME_MEASURE h=([0-9]+) m=([^[:space:]\"']*)"

note() { printf 'show-me: %s\n' "$*" >&2; }
queue_note() { pending="$pending""show-me: $*"$'\n'; }

html=${1:-}
if [ -z "$html" ] || [ ! -f "$html" ]; then
  note 'usage: bash screenshot.sh <file.html> [out-dir]'
  exit 2
fi

base=${html##*/}
src_dir=.
case $html in
  */*)
    src_dir=${html%/*}
    [ -n "$src_dir" ] || src_dir=/
    ;;
esac
src_dir=$(CDPATH='' cd -- "$src_dir" 2>/dev/null && pwd) || {
  note "cannot resolve the directory of $html"
  exit 0
}
case $src_dir in
  /) html=/$base ;;
  *) html=$src_dir/$base ;;
esac
name=${base%.html}
out=${2:-$src_dir}

cands=
chrome_bin=
if command -v node >/dev/null 2>&1; then cands="playwright"; fi
for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$candidate" >/dev/null 2>&1; then
    chrome_bin=$candidate
    break
  fi
done
if [ -z "$chrome_bin" ]; then
  for candidate in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$candidate" ]; then
      chrome_bin=$candidate
      break
    fi
  done
fi
if [ -n "$chrome_bin" ]; then cands="$cands chrome"; fi
if command -v firefox >/dev/null 2>&1; then cands="$cands firefox"; fi

if [ -z "$cands" ]; then
  note 'no headless browser found (looked for playwright, chromium, google-chrome, firefox)'
  exit 0
fi

timeout_bin=
if command -v timeout >/dev/null 2>&1; then
  timeout_bin=timeout
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_bin=gtimeout
fi

if ! mkdir -p "$out" 2>/dev/null || ! out=$(CDPATH='' cd -- "$out" 2>/dev/null && pwd); then
  note "cannot use out-dir $out"
  exit 0
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/show-me.XXXXXX") || {
  note 'cannot create a temp directory'
  exit 0
}
trap 'rm -rf "$work"' EXIT
trap 'exit 1' INT TERM HUP

run_to() {
  if [ -n "$timeout_bin" ]; then
    "$timeout_bin" 60 "$@"
  else
    "$@"
  fi
}

file_url() {
  local p=$1
  p=${p//'%'/%25}
  p=${p// /%20}
  p=${p//'#'/%23}
  p=${p//'?'/%3F}
  printf 'file://%s' "$p"
}

render() {
  local mode=$1 w=$2 h=$3 png=$4 url=$5 prof
  case $backend in
    playwright)
      if [ "$mode" = measure ]; then
        run_to node -e "$PW_JS" measure "$w" "$url"
      else
        run_to node -e "$PW_JS" shot "$w" "$h" "$png" "$url"
      fi
      ;;
    chrome)
      local flags=(--headless)
      if [ "${EUID:-1}" -eq 0 ]; then flags+=(--no-sandbox); fi
      prof=$(mktemp -d "$work/chrome.XXXXXX") || return 1
      run_to "$chrome_bin" "${flags[@]}" --user-data-dir="$prof" --hide-scrollbars \
        --enable-logging=stderr --v=0 --screenshot="$png" --window-size="$w,$h" "$url"
      rm -rf "$prof"
      ;;
    firefox)
      prof=$(mktemp -d "$work/firefox.XXXXXX") || return 1
      printf '%s\n' \
        'user_pref("browser.dom.window.dump.enabled", true);' \
        'user_pref("devtools.console.stdout.content", true);' \
        'user_pref("widget.gtk.overlay-scrollbars.enabled", true);' \
        'user_pref("ui.useOverlayScrollbars", 1);' >"$prof/user.js"
      run_to firefox --headless --no-remote --profile "$prof" --screenshot "$png" \
        --window-size="$w,$h" "$url"
      rm -rf "$prof"
      ;;
  esac
}

measure_page() {
  local w=$1 raw
  m_h=$FALLBACK_HEIGHT
  m_sig=
  m_known=0
  raw=$(render measure "$w" 800 "$work/measure-$w.png" "$measure_url" 2>&1 </dev/null)
  if [[ $raw =~ $measure_re ]]; then
    m_known=1
    m_sig=${BASH_REMATCH[2]}
    m_h=${BASH_REMATCH[1]}
    if [ "${#m_h}" -gt 5 ] || [ "$((10#$m_h))" -gt "$MAX_HEIGHT" ]; then
      m_h=$MAX_HEIGHT
      queue_note "page is taller than $MAX_HEIGHT px at ${w}px width, capped at $MAX_HEIGHT"
    else
      m_h=$((10#$m_h))
    fi
  else
    queue_note "height unknown at ${w}px width (no measure line), using $FALLBACK_HEIGHT"
  fi
}

shoot() {
  local w=$1 png=$2
  render shot "$w" "$m_h" "$png" "$html_url" >/dev/null 2>&1 </dev/null
  if [ -s "$png" ]; then
    return 0
  fi
  rm -f "$png"
  return 1
}

if ! cp "$html" "$work/measure.html"; then
  note 'cannot prepare the measure copy'
  exit 0
fi
printf '%s' "$MEASURE_SCRIPT" >>"$work/measure.html"
html_url=$(file_url "$html")
measure_url=$(file_url "$work/measure.html")

case $cands in
  *playwright*)
    if command -v npm >/dev/null 2>&1; then
      global_root=$(npm root -g 2>/dev/null)
      if [ -n "$global_root" ]; then
        export NODE_PATH="$global_root${NODE_PATH:+:$NODE_PATH}"
      fi
    fi
    ;;
esac

desktop_png=$out/$name.png
phone_png=$out/$name-390.png

for backend in $cands; do
  pending=
  measure_page 1280
  shoot 1280 "$desktop_png" || continue
  printf '%s' "$pending" >&2
  pending=
  printf '%s\n' "$desktop_png"

  desktop_known=$m_known
  desktop_sig=$m_sig
  measure_page 390
  if [ "$desktop_known" = 1 ] && [ "$m_known" = 1 ] && [ "$desktop_sig" = "$m_sig" ]; then
    queue_note 'same layout at 390px, skipping the phone PNG'
  elif shoot 390 "$phone_png"; then
    printf '%s\n' "$phone_png"
  else
    queue_note "the 390px screenshot failed with $backend"
  fi
  printf '%s' "$pending" >&2
  exit 0
done

note "no working headless browser (tried:$cands)"
exit 0
