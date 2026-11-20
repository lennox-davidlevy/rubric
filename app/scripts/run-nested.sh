#!/usr/bin/env bash
# The app in a nested X server: Xephyr as one window on the current display, a private i3
# inside it, and the release app inside that, drawing in software (Mesa's lavapipe for Vulkan,
# Mesa's software GL for WebKit). Nothing the app draws touches the host's GPU driver: Xephyr
# shows the nested screen on the host as an ordinary window, without glamor.
#
# Usage, from anywhere: app/scripts/run-nested.sh [post.md]
#   SIZE       the nested screen, WIDTHxHEIGHT (default 1600x1000); the window resizes with it.
#   WORKSPACE  the host i3 workspace the window goes to (default 6:Slack; empty leaves it).
#   LIVE=1     the real server in place of the stub: Jev picks, and a draft is a real one, which
#              costs a few cents. It reads the key from the repo's .env, as Neovim's does.
#
# The app starts the site's process itself (the stub, through `rubric lsp`, unless LIVE=1),
# as it does outside. Closing the Xephyr window (the window manager's close, which Xephyr answers by
# destroying the window but not exiting), closing the app, or Ctrl+C stops everything this
# started: the app, i3, Xephyr, and the site's process if it was not running before.
set -u

repo=$(cd "$(dirname "$0")/../.." && pwd)
post=${1:-$repo/sites/app-slice/pages/posts/long.md}
size=${SIZE:-1600x1000}
workspace=${WORKSPACE-6:Slack}
live=()
if [ "${LIVE:-}" = 1 ]; then
  live=(--live)
  echo "run-nested: LIVE: real picks and real drafts, which cost money" >&2
fi
lvp=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json
mesa_egl=/usr/share/glvnd/egl_vendor.d/50_mesa.json

die() { echo "run-nested: $*" >&2; exit 1; }
[ -n "${DISPLAY:-}" ] || die "no DISPLAY to put the Xephyr window on"
command -v Xephyr > /dev/null || die "Xephyr is not installed (xorg-x11-server-Xephyr)"
command -v i3 > /dev/null || die "i3 is not installed"
command -v xdotool > /dev/null || die "xdotool is not installed"
[ -f "$lvp" ] || die "no lavapipe ($lvp; mesa-vulkan-drivers)"
[ -f "$mesa_egl" ] || die "no Mesa EGL vendor file ($mesa_egl)"
[ -f "$post" ] || die "no such post: $post"

# The site of the post, and whether its process runs already (then it is left running).
site=$(cd "$(dirname "$post")" && while [ "$PWD" != / ] && [ ! -f rubric.md ]; do cd ..; done; [ -f rubric.md ] && pwd)
site_was_running=no
if [ -n "$site" ] && [ -f "$site/.rubric/serve.json" ]; then
  pid=$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$site/.rubric/serve.json")
  [ -n "$pid" ] && kill -0 "$pid" 2> /dev/null && site_was_running=yes
fi

echo "run-nested: building the release app" >&2
cargo build --release --manifest-path "$repo/app/Cargo.toml" --bin rubric-app -q || die "the build failed"

# A free display number for the nested server.
host=${DISPLAY#*:}; host=${host%%.*}
n=90
while [ -e "/tmp/.X11-unix/X$n" ] || [ -e "/tmp/.X$n-lock" ] || [ "$n" = "$host" ]; do n=$((n + 1)); done
nested=":$n"

tmp=$(mktemp -d)
log="$repo/app/target/nested-$(date -u +%Y%m%dT%H%M%SZ).log"
cat > "$tmp/i3.conf" << EOF
# The nested i3: nothing from the user's config.
font pango:monospace 8
default_border none
focus_follows_mouse no
ipc-socket $tmp/i3.sock
EOF

xephyr= wm= app=
cleanup() {
  trap - EXIT INT TERM
  for p in $app $wm $xephyr; do kill "$p" 2> /dev/null; done
  for p in $app $wm $xephyr; do
    for _ in $(seq 60); do kill -0 "$p" 2> /dev/null || break; sleep 0.05; done
    kill -9 "$p" 2> /dev/null
  done
  if [ -n "$site" ] && [ "$site_was_running" = no ]; then
    bun "$repo/src/cli.ts" stop "$site" > /dev/null 2>&1
  fi
  rm -rf "$tmp"
  echo "run-nested: stopped; the app's output is in $log" >&2
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Xephyr on the host display, plain (no glamor): an ordinary X client there.
Xephyr "$nested" -screen "$size" -resizeable -nolisten tcp -softCursor > "$tmp/xephyr.log" 2>&1 &
xephyr=$!
for _ in $(seq 100); do [ -S "/tmp/.X11-unix/X$n" ] && break; kill -0 "$xephyr" 2> /dev/null || break; sleep 0.05; done
[ -S "/tmp/.X11-unix/X$n" ] || { cat "$tmp/xephyr.log" >&2; die "Xephyr did not start"; }
# Its window on the host display. Closing it destroys the window but leaves Xephyr running,
# so the window, not the process, is what is watched.
host_display=$DISPLAY
win=
for _ in $(seq 100); do win=$(DISPLAY=$host_display xdotool search --name "^Xephyr on $nested\\." 2> /dev/null | head -1); [ -n "$win" ] && break; sleep 0.05; done
[ -n "$win" ] || die "no Xephyr window on $host_display"
# To its workspace in the host's i3, before its size is taken below.
# A terminal older than the running i3 holds a stale I3SOCK; i3-msg then finds the socket
# from the display. The move waits until i3 manages the window, or it matches nothing.
if [ -n "$workspace" ] && command -v i3-msg > /dev/null; then
  [ -S "${I3SOCK:-}" ] || unset I3SOCK
  moved=no
  for _ in $(seq 60); do
    if i3-msg -t get_tree 2> /dev/null | grep -q "\"window\":$win[,}]"; then
      i3-msg "[id=$win] move to workspace \"$workspace\"" > /dev/null 2>&1 && moved=yes
      break
    fi
    sleep 0.05
  done
  [ "$moved" = yes ] || echo "run-nested: could not move the window to $workspace" >&2
fi

# The host's window manager sizes the window (a tiling one at once), and the nested screen
# follows. Nothing starts inside until that size has held for a second: a later change of
# the nested screen is not followed by i3 (Xephyr's RandR output keeps its first size) nor
# by the web view, so the app would draw on part of it.
screen() { DISPLAY=$nested xdpyinfo 2> /dev/null | sed -n 's/.*dimensions: *\([0-9x]*\).*/\1/p'; }
last=$(screen) held=0
for _ in $(seq 40); do
  sleep 0.1
  now=$(screen)
  if [ "$now" = "$last" ]; then held=$((held + 1)); else held=0 last=$now; fi
  [ "$held" -ge 10 ] && break
done

# Everything below draws on the nested display, in software, never on the host's GPU.
export DISPLAY=$nested
export VK_ICD_FILENAMES=$lvp VK_DRIVER_FILES=$lvp
export __GLX_VENDOR_LIBRARY_NAME=mesa __EGL_VENDOR_LIBRARY_FILENAMES=$mesa_egl LIBGL_ALWAYS_SOFTWARE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

i3 -c "$tmp/i3.conf" > "$tmp/i3.log" 2>&1 &
wm=$!
for _ in $(seq 100); do [ -S "$tmp/i3.sock" ] && break; sleep 0.05; done

echo "run-nested: Xephyr on $nested, the app's output in $log" >&2
"$repo/app/target/release/rubric-app" "$post" "${live[@]}" > "$log" 2>&1 &
app=$!

# Until the Xephyr window closes, or Xephyr or the app ends.
while kill -0 "$xephyr" 2> /dev/null && kill -0 "$app" 2> /dev/null \
  && DISPLAY=$host_display xdotool getwindowname "$win" > /dev/null 2>&1; do
  sleep 0.5
done
