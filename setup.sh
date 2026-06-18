#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# setup.sh — wake a static HTML doc into a live conversation surface.
#
# Usage:   ./setup.sh <doc-dir> [port]
# Example: ./setup.sh examples/hello-living-doc        # serves on :33333, never idles out
#          ./setup.sh examples/hello-living-doc 5070
#
# One binary, zero Python. `stddoc serve` does all three jobs that used to
# be three separate Python scripts:
#   1. injects the feedback layer into every *.html in <doc-dir>
#   2. serves the directory + the feedback inbox API            
#   3. writes the presence heartbeat so the page shows "Claude is
#      on it ✨" instead of falsely going stale
#
# It does NOT arm the comment-watcher in your agent session — that has to
# happen inside the session (see protocol/responding.md). The Monitor
# command to tail the inbox is printed at the end.
#
# macOS-safe: there is no `setsid` here. The native server has a parent-death
# watchdog (it shuts down when reparented to PID 1), so we must NOT exit while
# it runs — we launch it, read its real port, print the banner, then `wait` on
# it. That keeps THIS script as its parent: the server outlives nothing extra,
# and dies with the agent session that launched ./setup.sh (by design). Run
# this script in the background of your session if you want your prompt back.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── resolve the stddoc binary ───────────────────────────────────────
# Prefer $STDDOC if set, then one already on PATH, then the repo build
# at go/stddoc (building it on demand if it isn't there yet).
resolve_stddoc() {
  if [[ -n "${STDDOC:-}" && -x "${STDDOC:-}" ]]; then echo "$STDDOC"; return; fi
  if command -v stddoc >/dev/null 2>&1; then command -v stddoc; return; fi
  if [[ -x "$HERE/go/stddoc" ]]; then echo "$HERE/go/stddoc"; return; fi
  if [[ -d "$HERE/go" ]]; then
    echo "▶ no stddoc binary found — building $HERE/go/stddoc ..." >&2
    ( cd "$HERE/go" && go build -o stddoc ./cmd/stddoc ) >&2
    echo "$HERE/go/stddoc"; return
  fi
  echo "error: no stddoc binary (set \$STDDOC, put it on PATH, or keep go/)" >&2
  exit 1
}
STDDOC="$(resolve_stddoc)"

DIR="${1:-}"
PORT="${2:-33333}"   # SIP floor — std-doc serves on 33333 or higher (never below)

if [[ -z "$DIR" ]]; then
  echo "usage: ./setup.sh <doc-dir> [port]" >&2
  exit 1
fi
if [[ ! -d "$DIR" ]]; then
  echo "error: '$DIR' is not a directory" >&2
  exit 1
fi
DIR="$(cd "$DIR" && pwd)"

# free / reuse the port if something is already holding it.
# Reuse if THIS dir is already being served on the requested port; otherwise
# launch and let the server FORCE-CHECK the port (it auto-advances to the next
# free one if $PORT is busy — no more stomping on 33333/33334).
EXISTS=0
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "▶ port $PORT busy — checking /info ..."
  if curl -s --max-time 2 "http://localhost:$PORT/info" | grep -q "$DIR"; then
    echo "  already serving THIS dir; reusing :$PORT."
    EXISTS=1
  else
    echo "  :$PORT held by something else — the server will advance to a free port."
  fi
fi

mkdir -p "$DIR/feedback"
if [[ "$EXISTS" != "1" ]]; then
  # The server picks the real port and writes it to feedback/.port. Clear any
  # stale marker first so we read THIS launch's port, not a previous run's.
  rm -f "$DIR/feedback/.port"
  echo "▶ injecting + serving $DIR (preferred :$PORT, auto-advances if busy; idle-timeout disabled) ..."
  # macOS-safe background start: no setsid. nohup + & + disown so the server
  # outlives this script but still dies with the launching session.
  "$STDDOC" serve "$DIR" --port "$PORT" --idle-timeout 0 \
    >"$DIR/feedback/server.log" 2>&1 &
  SERVER_PID=$!
  # learn the ACTUAL port the server bound (it writes feedback/.port) — never
  # assume the requested port — then wait for it to answer.
  for _ in $(seq 1 25); do
    [[ -f "$DIR/feedback/.port" ]] && break
    sleep 0.2
  done
  if [[ -f "$DIR/feedback/.port" ]]; then
    PORT="$(cat "$DIR/feedback/.port")"
  fi
  for _ in $(seq 1 25); do
    if curl -s --max-time 1 "http://localhost:$PORT/info" >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
fi

# find the first html to suggest as the URL
FIRST_HTML="$(cd "$DIR" && ls -1 *.html 2>/dev/null | head -1 || true)"
FIRST_HTML="${FIRST_HTML:-index.html}"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ LIVE.  Open this (NOT the file:// version):"
echo ""
echo "      http://localhost:$PORT/$FIRST_HTML"
echo ""
echo "  The server already writes the presence heartbeat (feedback/watcher.json)"
echo "  every 5s, so the page shows 'Claude is on it ✨' on its own — no separate"
echo "  watcher to run. You only need to WATCH THE INBOX in your agent session so"
echo "  you reply when a comment lands. Arm this Monitor (persistent):"
echo ""
echo "      tail -n0 -F $DIR/feedback/inbox.jsonl"
echo ""
echo "  When a comment lands: edit the HTML, append a batch to"
echo "  $DIR/feedback/history.json — the page auto-reloads.  (see protocol/responding.md)"
echo ""
echo "  Stop later with:  lsof -ti:$PORT | xargs kill"
echo "════════════════════════════════════════════════════════════════"

# Stay alive as the server's parent: the native server's watchdog kills it the
# moment it is reparented to PID 1, so if we exited here the doc would go dark.
# Blocking here keeps the page live; the server dies when this script (and the
# session that launched it) does. If we reused an already-running server above,
# there is nothing to wait on — just return.
if [[ "$EXISTS" != "1" && -n "${SERVER_PID:-}" ]]; then
  wait "$SERVER_PID"
fi
