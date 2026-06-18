# std-doc — standalone binary

std-doc ships as a single self-contained binary with no runtime dependencies.
This page covers using it without Claude — just the binary, by hand.

If you want Claude to drive it for you (the usual way), see `README.md`.

---

## Install

Grab a prebuilt binary from the repo's **Releases** — each archive bundles the
binary and its `stddoc-lib/`. Or build from source with `make build` (needs Go).

Keep the binary and `stddoc-lib/` side by side, or point to the lib explicitly:

```bash
export STDDOC_LIB=/path/to/stddoc-lib   # or pass --plugins /path/to/stddoc-lib
chmod +x stddoc
./stddoc version
```

---

## Quick start

```bash
./stddoc publish examples/data-derived-example/source.json published
./stddoc serve published          # → ✅ LIVE. open http://localhost:33333/index.html
```

Open the `http://` URL (**not** `file://`) and comment on a sentence. The comment
lands in `published/feedback/inbox.jsonl`; an agent watching that inbox edits the
page and appends to `published/feedback/history.json`; the page auto-reloads with
a walkthrough of what changed.

`./setup.sh <dir>` does inject + serve in one command.

---

## Commands

| Command | What it does |
|---|---|
| `stddoc publish <source.json> <out>` | Expand a canonical JSON doc-tree into rich HTML pages |
| `stddoc serve <dir>` | Inject the comment widget + serve + heartbeat, in one process |
| `stddoc freeze <dir> <out>` | Bake a portable snapshot that reaches out to nothing |
| `stddoc roll <source.json>` | Version the canonical JSON into a git home |
| `stddoc graduate` | Shed a comment round and keep the doc live |

JSON is the thing you keep in git; HTML is derived from it. Edit the JSON and
re-publish — never patch the generated HTML by hand.

---

## Style

Pass `--style` to pick a visual theme:

```bash
stddoc publish source.json published --style parchment-light
```

Three styles ship: `techno-dark` (default), `parchment-light`, `playful`.
Or set `STDDOC_LIB` and `STDDOC_STYLE` in your environment to make defaults permanent.
