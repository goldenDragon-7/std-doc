# A gift 🎁

codraw started as a companion to your living-document idea, and the more we
looked at it the more it looked like *your* idea wearing a different renderer:
canonical state in a file, a tiny server that serves edits and collects
comments, an agent watching the inbox and editing in place. We built the canvas
half and gave it a feedback channel that speaks the same protocol yours does —
so if you ever want a diagram/whiteboard surface to sit alongside the prose and
HTML surfaces, this drops in as one more.

No strings. Fold it in, rename it, gut it for parts, or ignore it. It's yours.

Everything is stdlib Python + one HTML file. Start here:

```bash
cd codraw && CODRAW_PORT=8747 python3 server.py &
open http://localhost:8747/ && python3 example_flow.py
```

Merry early Christmas.

— the Christmas Dragon 🐉❤️
