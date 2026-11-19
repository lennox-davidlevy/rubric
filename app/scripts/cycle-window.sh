#!/usr/bin/env bash
# Open, move, close a window, several times, to see whether it crashes the X server.
#
# Each cycle starts the command, waits for its window, moves it to an i3 workspace (a visible
# one, so it draws there), keeps it open a few seconds, closes it as i3 does (`kill`, which
# sends WM_DELETE_WINDOW), and waits for the process to end. After every cycle it checks that
# Xorg is still the same process, and stops at the first cycle it is not.
#
# Usage: cycle-window.sh <title regex> <cycles> -- <command> [args…]
#   WORKSPACE  the workspace to move to (default 6:Slack)
#   HOLD       seconds the window stays open on it (default 3)
#   I3SOCK     another i3's socket (default: the display's own)
#
# Every line also goes to app/target/cycle-<UTC time>.log, written as it happens, so a crash
# that takes the terminal with it still leaves the record.
set -u

if [ $# -lt 4 ] || [ "$3" != "--" ]; then
  echo "usage: $0 <title regex> <cycles> -- <command> [args…]" >&2
  exit 2
fi
title=$1
cycles=$2
shift 3
workspace=${WORKSPACE:-6:Slack}
hold=${HOLD:-3}
i3=(i3-msg)
[ -n "${I3SOCK:-}" ] && i3=(i3-msg -s "$I3SOCK")
repo=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$repo/app/target"
log="$repo/app/target/cycle-$(date -u +%Y%m%dT%H%M%SZ).log"

say() {
  echo "$(date +%T.%3N) $*" | tee -a "$log"
  sync "$log" 2>/dev/null
}

xorg() { pgrep -x Xorg | head -1; }
server=$(xorg)
say "start: $* | title /$title/ | $cycles cycles to $workspace, held ${hold}s | DISPLAY=${DISPLAY:-} | Xorg pid ${server:-none (Xvfb?)} | $(Xorg -version 2>&1 | grep -m1 'X.Org X Server')"

for c in $(seq "$cycles"); do
  "$@" > "$log.cycle$c.out" 2>&1 &
  pid=$!
  win=
  # Its window: by process id first, then by title (vkcube sets no _NET_WM_PID).
  for _ in $(seq 400); do
    win=$(xdotool search --pid "$pid" --name "$title" 2>/dev/null | tail -1)
    [ -z "$win" ] && win=$(xdotool search --onlyvisible --name "$title" 2>/dev/null | tail -1)
    [ -n "$win" ] && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.05
  done
  if [ -z "$win" ]; then
    say "cycle $c: no window (process $(kill -0 "$pid" 2>/dev/null && echo running || echo gone)); see $log.cycle$c.out"
    kill "$pid" 2>/dev/null
    break
  fi
  say "cycle $c: open, window $win"
  "${i3[@]}" "[id=$win] move to workspace \"$workspace\"" > /dev/null
  say "cycle $c: moved to $workspace"
  sleep "$hold"
  "${i3[@]}" "[id=$win] kill" > /dev/null
  for _ in $(seq 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.05; done
  if kill -0 "$pid" 2>/dev/null; then
    say "cycle $c: still running 5 s after close; killed"
    kill "$pid"
  else
    say "cycle $c: closed"
  fi
  sleep 1
  now=$(xorg)
  if [ "$now" != "$server" ]; then
    say "cycle $c: XORG CHANGED (was ${server:-none}, now ${now:-none}): crashed"
    exit 1
  fi
done
say "done: Xorg still pid ${server:-none}"
