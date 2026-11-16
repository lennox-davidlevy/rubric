#!/usr/bin/env bash
# Task 5's window numbers: ten launches of the release app, each giving Rune's first frame
# (`ready_ms`, from process start) and the first `page loaded` (ms from the top of main), then
# closed through i3 and waited for. Needs an X display with i3, and the site's process already
# running (`bun src/cli.ts "$PWD/sites/app-slice" --stub` from the repo, in another terminal).
#
# Usage, from the repo: app/scripts/measure-window.sh [runs]
# I3SOCK names another i3's socket; by default it is the display's own. WORKSPACE names an i3
# workspace to move each window to as soon as it appears (keep it a visible one: a hidden
# window isn't drawn, which skews ready_ms); it opens where focus is for that moment.
set -u
repo=$(cd "$(dirname "$0")/../.." && pwd)
runs=${1:-10}
out=$(mktemp -d)
i3=(i3-msg)
[ -n "${I3SOCK:-}" ] && i3=(i3-msg -s "$I3SOCK")
mkdir -p "$out/ready"
for i in $(seq "$runs"); do
  rm -f "$out/ready"/*
  RUNE_READY_DIR="$out/ready" "$repo/app/target/release/rubric-app" "$repo/sites/app-slice/pages/posts/long.md" > "$out/run$i.log" 2>&1 &
  pid=$!
  win=
  if [ -n "${WORKSPACE:-}" ]; then
    for _ in $(seq 400); do win=$(xdotool search --pid $pid --name '^Rubric$' 2>/dev/null | head -1); [ -n "$win" ] && break; sleep 0.005; done
    [ -n "${win:-}" ] && "${i3[@]}" "[id=$win] move to workspace \"$WORKSPACE\"" > /dev/null
  fi
  for _ in $(seq 200); do grep -q "page loaded http" "$out/run$i.log" && break; sleep 0.05; done
  sleep 0.3
  ready=$(cat "$out"/ready/* 2>/dev/null | sed -n 's/.*"ready_ms":\([0-9.]*\).*/\1/p')
  root=$(grep -m1 "page loaded http" "$out/run$i.log" | awk '{print $(NF-1)}')
  post=$(grep -m1 "page loaded http.*/posts/" "$out/run$i.log" | awk '{print $(NF-1)}')
  echo "run $i ready_ms=${ready:-none} page_ms=${root:-none} post_ms=${post:-none}"
  "${i3[@]}" '[title="^Rubric$"] kill' > /dev/null
  for _ in $(seq 100); do kill -0 $pid 2>/dev/null || break; sleep 0.05; done
  kill -0 $pid 2>/dev/null && { echo "run $i: still running, killed"; kill $pid; }
  sleep 0.5
done
rm -rf "$out"
