#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# setup.sh — wake a static HTML doc into a live conversation surface.
#
# Usage:   ./setup.sh <doc-dir> [port]
# Example: ./setup.sh examples/hello-living-doc        # serves on :33333, lives 24h past the last touch
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
# macOS-safe: there is no `setsid` here, and none is needed. We launch the
# server, read its real port, print the banner, and EXIT — the server is
# reparented to init and keeps serving, because its life is measured by whether
# anyone touches the doc (a page load or an edit), not by whether this script is
# still running. It stays up 24h past the last touch.
#
# This used to be the bug: the server ran a parent-death watchdog by default, so
# this script's own exit killed it ~5s after printing "LIVE" — every user hit it.
# If you want a doc that dies with your session, pass --exit-with-parent through
# to `stddoc serve` deliberately.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── resolve the stddoc binary ───────────────────────────────────────
# Order: explicit $STDDOC, then THIS REPO'S BUILD, then PATH.
#
# The repo build deliberately beats a `stddoc` already on PATH. It used to be
# the other way round, and that silently invalidated test results: you change
# the source, run setup.sh, watch it pass — and you were exercising the stale
# binary installed in ~/.local/bin, not your change. It fooled me exactly once,
# and only a stray log line gave it away. A harness that can test something
# other than the code under change is worse than no harness.
#
# If you genuinely want the installed one, ask for it: STDDOC_USE_PATH=1.
# Either way we PRINT the resolved path on every run — a test that doesn't say
# what it tested is not evidence.
resolve_stddoc() {
  if [[ -n "${STDDOC:-}" && -x "${STDDOC:-}" ]]; then echo "$STDDOC"; return; fi
  if [[ "${STDDOC_USE_PATH:-}" == "1" ]] && command -v stddoc >/dev/null 2>&1; then
    command -v stddoc; return
  fi
  if [[ -x "$HERE/go/stddoc" ]]; then echo "$HERE/go/stddoc"; return; fi
  if [[ -d "$HERE/go" ]]; then
    echo "▶ no stddoc binary in this repo — building $HERE/go/stddoc ..." >&2
    ( cd "$HERE/go" && go build -o stddoc ./cmd/stddoc ) >&2
    echo "$HERE/go/stddoc"; return
  fi
  if command -v stddoc >/dev/null 2>&1; then command -v stddoc; return; fi
  echo "error: no stddoc binary (set \$STDDOC, keep go/, or put one on PATH)" >&2
  exit 1
}
STDDOC="$(resolve_stddoc)"
echo "▶ stddoc binary: $STDDOC"

DIR="${1:-}"
# Port is OPTIONAL. If the caller gives one ($2) we honor it exactly. If not,
# we let `stddoc serve` pick a STABLE per-doc default (a hash of the doc path
# into the 333xx band) — so concurrent docs spread out instead of dogpiling
# 33333, and the same doc reliably returns to the same port. We learn the
# ACTUAL bound port from feedback/.port after launch, never by assuming it.
USER_PORT="${2:-}"

if [[ -z "$DIR" ]]; then
  echo "usage: ./setup.sh <doc-dir> [port]" >&2
  exit 1
fi
if [[ ! -d "$DIR" ]]; then
  echo "error: '$DIR' is not a directory" >&2
  exit 1
fi
DIR="$(cd "$DIR" && pwd)"

mkdir -p "$DIR/feedback"

# free / reuse the port if something is already holding it.
# Reuse if THIS dir is already being served. We don't know the port up front
# (the server picks a stable per-doc default), so we check the port this doc
# used last time — its own feedback/.port — not a hardcoded 33333.
PORT=""
CHECK_PORT="${USER_PORT:-$(cat "$DIR/feedback/.port" 2>/dev/null || true)}"
EXISTS=0
if [[ -n "$CHECK_PORT" ]] && lsof -ti:"$CHECK_PORT" >/dev/null 2>&1; then
  echo "▶ port $CHECK_PORT busy — checking /info ..."
  if curl -s --max-time 2 "http://localhost:$CHECK_PORT/info" | grep -q "$DIR"; then
    echo "  already serving THIS dir; reusing :$CHECK_PORT."
    PORT="$CHECK_PORT"
    EXISTS=1
  else
    echo "  :$CHECK_PORT held by something else — the server will pick a free port."
  fi
fi

if [[ "$EXISTS" != "1" ]]; then
  # The server picks the real port and writes it to feedback/.port. Clear any
  # stale marker first so we read THIS launch's port, not a previous run's.
  rm -f "$DIR/feedback/.port"
  if [[ -n "$USER_PORT" ]]; then
    echo "▶ injecting + serving $DIR (requested :$USER_PORT, auto-advances if busy; lives 24h past the last touch) ..."
  else
    echo "▶ injecting + serving $DIR (stable per-doc default port, auto-advances if busy; lives 24h past the last touch) ..."
  fi
  # macOS-safe background start: no setsid, and none needed. `&` is enough —
  # the server is reparented to init when this script exits and keeps serving,
  # because its life is measured by whether anyone TOUCHES the doc (a page load
  # or an edit), not by whether this script is still around. This script exiting
  # used to kill it within ~5s, right after printing "LIVE" below.
  #
  # No --idle-timeout here: the binary's 24h default is the behaviour we want.
  # Pass --port only when the caller asked for one; otherwise let the binary
  # pick the stable per-doc default.
  "$STDDOC" serve "$DIR" ${USER_PORT:+--port "$USER_PORT"} \
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

  # NEVER print "LIVE" without proving it. This script used to declare success
  # whether or not the server had actually come up: if the binary died at
  # startup, .port was never written and the banner cheerfully printed
  # "http://localhost:/index.html" — an empty port, nothing listening. From the
  # reader's side that is indistinguishable from "the server grabbed a bad
  # port", and it sent them back to their agent saying "it stopped".
  #
  # So: confirm the server answers on the port it claims, or fail loudly with
  # the reason, which is already sitting in server.log.
  SERVING=0
  if [[ -n "$PORT" ]]; then
    for _ in $(seq 1 25); do
      if curl -s --max-time 1 "http://localhost:$PORT/info" >/dev/null 2>&1; then
        SERVING=1
        break
      fi
      sleep 0.2
    done
  fi

  if [[ "$SERVING" != "1" ]]; then
    echo "" >&2
    echo "✖ FAILED to serve $DIR — the server did not come up." >&2
    if [[ -z "$PORT" ]]; then
      echo "  It never reported a port (no $DIR/feedback/.port)." >&2
    else
      echo "  It claimed port $PORT but never answered there." >&2
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "  The server process exited." >&2
    fi
    echo "" >&2
    echo "  ── $DIR/feedback/server.log ──" >&2
    sed 's/^/  /' "$DIR/feedback/server.log" >&2 2>/dev/null || echo "  (empty)" >&2
    echo "" >&2
    exit 1
  fi
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

# Return. Do NOT block.
#
# This script used to end with `wait "$SERVER_PID"` — blocking forever on
# purpose, because the server's watchdog killed it the moment it was reparented
# to PID 1, so the script had to stay alive as its parent. That workaround cost
# more than the bug: setup.sh never returned, so the caller had to background it
# or let the call time out, and whenever that shell finally died it took the
# document with it. "I ran setup.sh and it stopped."
#
# The server no longer needs a babysitter. It survives being orphaned and lives
# 24h past the last touch, so we print the URL and get out of the way — the
# caller gets their prompt back and the doc stays up.
