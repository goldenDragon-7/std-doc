# std-doc

**A document you can talk to.**

std-doc turns a plain idea into a single self-contained web page — and then lets
the reader *answer back*. They select a sentence, leave a comment, and the page
reloads having changed, walking them through exactly what's different. No chat
window, no round-trip, no app to log into. **The document is the conversation.**

It's one binary. No Python, no Node, no network, no dependencies to audit. You
download it, point it at a folder of pages, and it serves them live.

---

## Why it exists

Most documents lose information the moment they go flat. A decision matrix's
*shape* is part of the argument; a spectrum's *gradient* is part of the argument;
the green that means "we stand here" is part of the argument. A wall of sentences
keeps the words and drops all of that.

std-doc keeps it. Color means things, and we use color to mean them. Every
load-bearing idea earns a diagram. The result costs the reader **fewer tokens to
understand, and fewer questions to ask** — great design is just efficiency you can
see. Diagrams ship *inside* the page as inline SVG, rendered in-process, so a
frozen doc reaches out to nothing.

---

## Install

Download two things and keep them side by side:

```
stddoc          # the binary
stddoc-lib/     # the rendering library it reads at runtime
```

Put them in the same directory (or set `STDDOC_LIB=/path/to/stddoc-lib`, or pass
`--plugins /path/to/stddoc-lib`). That's the whole install. Make it runnable:

```bash
chmod +x stddoc
./stddoc version
```

---

## The 60-second first run

```bash
# 1. Publish an example doc from its canonical JSON into ./published
./stddoc publish examples/data-derived-example/source.json published

# 2. Serve it — this injects the comment widget, serves the pages, and
#    keeps a live "someone is here" heartbeat, all in one process.
./stddoc serve published

#    → ✅ LIVE.  open http://localhost:5050/index.html
```

Open that URL in a browser (the `http://` one, **not** the `file://` one).
**Select any sentence and leave a comment.** It lands in
`published/feedback/inbox.jsonl`. An agent watching that inbox edits the page and
appends a reply to `published/feedback/history.json`; the page auto-reloads and
walks you through what changed. That loop — comment → edit → reload-with-walkthrough
— *is* std-doc.

Want the one-liner instead of the two steps above? `./setup.sh <dir>` injects and
serves any directory of HTML pages in a single command.

---

## What you can do with it

| Command | What it does |
|---|---|
| `stddoc publish <source.json> <out>` | Expand a canonical JSON doc-tree into rich HTML pages |
| `stddoc serve <dir>` | Inject the comment widget + serve + heartbeat, in one process |
| `stddoc freeze <dir> <out>` | Bake a portable snapshot that reaches out to nothing |
| `stddoc roll <source.json>` | Version the canonical JSON into a git home |
| `stddoc graduate` | Shed a comment round and keep the doc live |

JSON is the thing you keep in git; the HTML is derived from it. Edit the JSON and
re-publish — never patch the generated HTML by hand. Rich shapes (decision matrix,
spectrum, swim-lane, pipeline, card grid, …) are *primitives* in `stddoc-lib`; new
shapes are added as plug-in modules, never by forking the core.

---

## Where to go next

- **`style-interview/`** — the onboarding tutorial. Five short pages that teach the
  voice by *being* the thing they describe. Start here; it's the warmest door.
- **`SKILL.md`** — the full how-to: the four moves, the reply protocol, the detail.
- **`self-doc/`** — std-doc documented as a std-doc. It self-hosts; read it served.
- **`examples/`** — worked, runnable docs: `hello-living-doc`, `structured-controls`,
  `data-derived-example`.

---

## License

MIT — see `LICENSE`.

---

*Given freely. There's no hook in it — that's the point.*
