#!/usr/bin/env bash
# Puts the app slice's site back as it was before section C of testing/TESTING.md: the post
# from git, and no kept parts, drafts or removed parts. Refuses while the app or the site's
# process runs, since either may write there again.
#
# Usage, from anywhere: app/scripts/clean-test.sh
set -u

repo=$(cd "$(dirname "$0")/../.." && pwd)
site=$repo/sites/app-slice

if pgrep -x rubric-app > /dev/null; then
  echo "clean-test: the app is running; close it first" >&2
  exit 1
fi
# The site's process: `rubric` run for this folder (its command line names the site).
pid=$(pgrep -f "cli\.ts $site( |\$)" | head -n 1)
if [ -n "$pid" ]; then
  echo "clean-test: the site's process is running (pid $pid); it stops a minute after the app closes" >&2
  exit 1
fi

git -C "$repo" checkout -- sites/app-slice/pages/posts/long.md
rm -rf "$site/parts" "$site/.rubric/logs/removed"
find "$site/.rubric/drafts" -mindepth 1 -delete 2> /dev/null
git -C "$repo" status --short -- sites/app-slice
