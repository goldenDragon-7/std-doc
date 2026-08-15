# codraw — a live canvas you and your agent share

Most "draw with AI" tools hand you a static image. **codraw gives you a pen each.**
You drag shapes in the browser; your agent authors shapes as code. Both of you
poll one `scene.json` and see each other's changes within ~1.2 seconds. And a
small feedback box lets you *tell the agent things in words* — those comments land
in a JSONL inbox the agent watches live.

It's small on purpose: a stdlib Python server, one HTML file (Excalidraw UMD),
and a ~200-line builder library. No build step, no database, no framework.

## 60-second start

```bash
cp -r codraw/assets/* ./ && cd ./     # or into any working dir
CODRAW_PORT=8747 python3 server.py &
open http://localhost:8747/            # macOS; else open the URL yourself
python3 example_flow.py                # draws a small flow; watch it appear
```

Now drag a box in the browser. Then, from Python:

```python
from codraw import Board
scene = Board.load("scene.json")       # you just read the human's live edit
```

## The two channels

| Channel | Human → Agent | Agent → Human |
|---|---|---|
| **Canvas** (`scene.json`) | drag / retype / add shapes | `Board(...).save()` |
| **Feedback** (`feedback.jsonl`) | type a comment, hit Send | (agent reads & acts) |

Arm the feedback channel by tailing the inbox — one event per comment:

```bash
touch feedback.jsonl && tail -f feedback.jsonl
```

Each comment is one line. If shapes were selected when the human hit Send, their
ids ride along in `ref`:

```json
{"ts":"2026-08-14T15:05:57","text":"move RESULT left, colors clash","ref":["box_2_..."],"rev":7}
```

## Why this shape

codraw is one instance of a general pattern: **a living surface** — canonical
state in a file, a tiny server that serves edits and collects comments, and an
agent that watches the inbox and edits the artifact in place. Swap the canvas for
prose and you have a living *document*; swap it for arbitrary HTML and you have a
living *page*. Same substrate, different renderer. codraw is the canvas renderer.

## Files

```
codraw/
├── SKILL.md              # agent-facing skill card (Claude Code / Agent SDK)
├── README.md             # this file
├── LICENSE               # MIT
└── assets/
    ├── server.py         # stdlib server: /scene (canvas) + /feedback (inbox)
    ├── index.html        # the live Excalidraw canvas + feedback widget
    ├── codraw.py         # Board: boxes, lanes, bound arrows, notes, save/load
    ├── bump.py           # bump _rev after hand-editing scene.json
    └── example_flow.py   # runnable example
```

## Requirements

Python 3 (stdlib only) and a browser. Internet for the Excalidraw CDN, unless you
vendor the three UMD bundles into `vendor/` (see SKILL.md → Setup step 4); the page
loads local-first and falls back to CDN automatically.
