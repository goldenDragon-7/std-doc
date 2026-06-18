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

Clone this repo into your Claude skills directory and build the binary once:

```bash
git clone <this-repo> ~/.claude/skills/std-doc
cd ~/.claude/skills/std-doc && make build      # builds the stddoc binary (needs Go)
```

Then just talk to Claude: **`/std-doc`**, *"write a living document"*, or *"turn
this into a doc I can talk to."* `SKILL.md` carries the trigger phrases and the
four moves; Claude drives the `stddoc` binary for you.

**First time?** Say **`/std-doc` and ask it to introduce you** (or *"give me the
tour"*) — it'll walk you through **Meet std-doc** (the onboarding) in `style-interview/`,
the warmest way to meet what a living document is.

---

## The 60-second first run

In Claude, say **`/std-doc`** (or *"turn this into a doc I can talk to"*). Claude
writes the doc, publishes it, serves it, hands you a `http://localhost:33333/…`
URL, and watches the inbox. **Select any sentence and leave a comment** — Claude
edits the doc and it reloads, walking you through exactly what changed. That loop
— comment → edit → reload-with-walkthrough — *is* std-doc.

New here? Just say *"introduce yourself"* — it'll open with **Meet std-doc**.

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
