#!/usr/bin/env bash
# Runs the release app in a private Xvfb display, drawing in software (Mesa's lavapipe for
# Vulkan, Mesa's software GL for WebKit), without touching the host's display or GPU driver.
#
# Usage, from anywhere: app/scripts/run-nested.sh [post.md | site-folder]
#   SIZE       the virtual screen, WIDTHxHEIGHT (default 1400x900).
#   LIVE=1     the real server in place of the stub: Jev picks, and a draft is a real one, which
#              costs a few cents. It reads the key from the repo's .env, as Neovim's does.
#
# The app starts the site's process itself (the stub, through `rubric lsp`, unless LIVE=1),
# as it does outside. Closing the app or Ctrl+C stops everything this started: the app, Xvfb,
# and the site's process if it was not running before.
set -u

repo=$(cd "$(dirname "$0")/../.." && pwd)
target=${1:-$repo/sites/app-slice/pages/posts/long.md}
size=${SIZE:-1400x900}
live=()
if [ "${LIVE:-}" = 1 ]; then
  live=(--live)
  echo "run-nested: LIVE: real picks and real drafts, which cost money" >&2
fi

# Arch uses lvp_icd.json; Fedora uses lvp_icd.x86_64.json.
lvp=/usr/share/vulkan/icd.d/lvp_icd.json
[ -f "$lvp" ] || lvp=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json
mesa_egl=/usr/share/glvnd/egl_vendor.d/50_mesa.json

die() { echo "run-nested: $*" >&2; exit 1; }
command -v Xvfb > /dev/null || die "Xvfb is not installed (xorg-server-xvfb)"
[ -f "$lvp" ] || die "no lavapipe (/usr/share/vulkan/icd.d/lvp_icd.json)"
[ -f "$mesa_egl" ] || die "no Mesa EGL vendor file ($mesa_egl)"
[ -e "$target" ] || die "no such file or folder: $target"

# The site of the file or folder, and whether its process runs already (then it is left running).
start_dir=$([ -d "$target" ] && echo "$target" || dirname "$target")
site=$(cd "$start_dir" && while [ "$PWD" != / ] && [ ! -f rubric.md ]; do cd ..; done; [ -f rubric.md ] && pwd)
site_was_running=no
if [ -n "$site" ] && [ -f "$site/.rubric/serve.json" ]; then
  pid=$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$site/.rubric/serve.json")
  [ -n "$pid" ] && kill -0 "$pid" 2> /dev/null && site_was_running=yes
fi

echo "run-nested: building the release app" >&2
cargo build --release --manifest-path "$repo/app/Cargo.toml" --bin rubric-app -q || die "the build failed"

# A free display number for Xvfb.
n=90
while [ -e "/tmp/.X11-unix/X$n" ] || [ -e "/tmp/.X11-lock" ]; do n=$((n + 1)); done
nested=":$n"

tmp=$(mktemp -d)
log="$repo/app/target/nested-$(date -u +%Y%m%dT%H%M%SZ).log"

xvfb= app=
cleanup() {
  trap - EXIT INT TERM
  for p in $app $xvfb; do kill "$p" 2> /dev/null; done
  for p in $app $xvfb; do
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

Xvfb "$nested" -screen 0 "${size}x24" -nolisten tcp > "$tmp/xvfb.log" 2>&1 &
xvfb=$!
for _ in $(seq 100); do [ -S "/tmp/.X11-unix/X$n" ] && break; kill -0 "$xvfb" 2> /dev/null || break; sleep 0.05; done
[ -S "/tmp/.X11-unix/X$n" ] || { cat "$tmp/xvfb.log" >&2; die "Xvfb did not start"; }

# Everything below draws on the virtual display, in software, never on the host's GPU.
unset WAYLAND_DISPLAY
export DISPLAY=$nested
export GDK_BACKEND=x11
export VK_ICD_FILENAMES=$lvp VK_DRIVER_FILES=$lvp
export __GLX_VENDOR_LIBRARY_NAME=mesa __EGL_VENDOR_LIBRARY_FILENAMES=$mesa_egl LIBGL_ALWAYS_SOFTWARE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

echo "run-nested: Xvfb on $nested ($size), the app's output in $log" >&2
"$repo/app/target/release/rubric-app" "$target" "${live[@]}" > "$log" 2>&1 &
app=$!
wait "$app"
