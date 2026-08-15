---
name: codraw
description: >-
  Co-draw diagrams LIVE with a human on one shared canvas — you author shapes as
  code, they drag/edit in the browser, and both sides see each other's changes
  within ~1s. A self-hosted Excalidraw surface (local server + shared scene.json)
  plus a Python builder library (boxes, lanes, arrows, notes) with bound arrows,
  SVG/PNG export, and a text-feedback channel the agent can Monitor live. Use when
  someone wants to sketch a flow/architecture/workflow/mind-map TOGETHER with you,
  not just receive a static image. Trigger phrases — "draw this with me", "co-draw",
  "let's diagram this together", "can we draw on a shared canvas", "make a diagram I
  can edit", "interactive whiteboard", "draw X as a workflow".
---

# codraw — live collaborative diagramming

You and the human are **peers on one canvas**. `scene.json` IS the canvas.
- The human edits in the browser → auto-saves (server bumps `_rev`).
- You edit by writing `scene.json` (via the `codraw` library) → the human's
  browser polls every ~1.2s and pulls your change (status pill turns amber).
- Last-write-wins; take turns on the same element and narrate big moves.
- The human can also send you **typed feedback** through a widget on the canvas;
  it lands in `feedback.jsonl`, which you watch with a Monitor (see below).

## Setup (once per session)

1. Copy the assets into a working directory (anywhere writable):
   ```bash
   mkdir -p codraw && cp -r <skill>/assets/* codraw/ && cd codraw
   ```
2. Start the server (background) and open the canvas:
   ```bash
   CODRAW_PORT=8747 python3 server.py &
   open -a "Google Chrome" http://localhost:8747/     # macOS; else share the URL
   ```
3. **Arm the feedback channel** so the human's typed comments push to you live:
   ```bash
   touch feedback.jsonl
   # then Monitor: tail -f feedback.jsonl   (one event per comment they send)
   ```
4. Optional, offline-proof: vendor the libraries so a CDN outage can't blank it:
   ```bash
   mkdir -p vendor && cd vendor
   curl -sL https://unpkg.com/react@18/umd/react.production.min.js -o react.production.min.js
   curl -sL https://unpkg.com/react-dom@18/umd/react-dom.production.min.js -o react-dom.production.min.js
   curl -sL https://unpkg.com/@excalidraw/excalidraw@0.17.6/dist/excalidraw.production.min.js -o excalidraw.production.min.js
   cd ..
   ```
   `index.html` loads local-first with automatic CDN fallback, so `vendor/` is optional.

## Drawing (your half of the pen)

Author diagrams with the bundled `codraw.py` library, then `save()` — it bumps
`_rev` above the current file so the browser pulls your change automatically.

```python
from codraw import Board
b = Board()
lane = b.lane("Skeleton", 60, 150, 400, 700, color=Board.BLUE)
a = b.box("INPUT", 110, 240, 300, 90)
c = b.box("EVALUATE", 560, 300, 320, 90, bg=Board.PROC)
b.arrow(a, c, label="feeds", dashed=False)   # arrow FOLLOWS boxes when dragged
b.note(520, 850, "the caption / thesis line")
b.save("scene.json")                          # -> browser repaints in ~1.2s
```

API: `box(text,x,y,w,h,bg=,stroke=,size=,ellipse=)` · `lane(title,x,y,w,h,color=)` ·
`arrow(a_id,b_id,label=,dashed=,both=)` · `note(x,y,text,size=,color=,w=)` ·
`save(path,author=)` · `Board.load(path)` (read the human's live edits back).
Palette: `Board.BLUE/GREEN/PROC/GOLD/WHITE/PINK/GREY`.

To tweak a few things without regenerating, edit `scene.json` directly, then run
`python3 bump.py` so the browser pulls it.

## Reading the human's edits

They may drag boxes, retype labels, add shapes. To see the current state:
```python
scene = Board.load("scene.json")
for e in scene["elements"]:
    if e["type"] == "rectangle": print(e["id"], e["x"], e["y"])
```

## The feedback channel (text alongside drawing)

Drawing changes tell you *what* moved; the feedback widget tells you *why*, in
words. A box at the bottom of the canvas lets the human type a comment and hit
Send (or Enter). If they have shapes selected, the selected element ids ride
along as `ref`, so you know which shapes they mean.

Each comment appends one JSON line to `feedback.jsonl`:
```json
{"ts":"2026-08-14T15:05:57","text":"move RESULT left, colors clash","ref":["box_2_..."],"rev":7}
```

**Watch it live** with a Monitor on the file — you get one event per comment, the
instant they send it, with no "go check" needed:
```bash
tail -f feedback.jsonl
```
When a comment lands, read the `text`, resolve any `ref` ids against the current
`Board.load("scene.json")`, edit the scene, and `save()` — the canvas repaints and
the loop closes.

## Export

Top-bar **SVG** / **PNG** buttons download the finished visual (Excalidraw
`exportToSvg` / `exportToBlob`).

## Verify it rendered (recommended)

If you have a browser-automation tool available, open an isolated tab and confirm
`document.querySelector('.excalidraw')` exists and the status pill reads
`synced (rev N)`. Then close that tab so it doesn't cause spurious saves.

## Files
- `assets/server.py`  — stdlib HTTP server: GET/POST `/scene` (bumps `_rev`),
  POST `/feedback` (appends to `feedback.jsonl`).
- `assets/index.html` — the live canvas (Excalidraw 0.17.6 UMD, local-first + CDN
  fallback, self-injecting styles, SVG/PNG export, feedback widget).
- `assets/codraw.py`  — the diagram builder library.
- `assets/bump.py`    — bump `_rev` after hand-editing `scene.json`.
- `assets/example_flow.py` — a runnable example.

## Gotchas
- **Rev continuity:** always use `Board.save()` or `bump.py` — a raw write that
  leaves `_rev` unchanged won't be pulled by the browser.
- **Bound arrows:** pass box *ids* to `arrow()` so arrows follow boxes on drag.
- **One human + you:** designed for turn-taking, not N-way multiplayer.
- **Feedback needs the Monitor armed:** if you don't tail `feedback.jsonl`, typed
  comments still record — you just won't be notified until you read the file.
- **Needs a browser with internet** unless you vendored `vendor/`.
