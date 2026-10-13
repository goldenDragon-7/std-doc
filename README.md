# std-doc

**A document you can talk to.**

std-doc turns a plain idea into a single self-contained web page — and then lets
the reader *answer back*. They select a sentence, leave a comment, and the page
reloads having changed, walking them through exactly what's different. No chat
window, no round-trip, no app to log into. **The document is the conversation.**

It's one Go binary — no runtime to install, no network, and the **frozen page
reaches out to nothing**, ever. The engine is stdlib-only, and its D2 diagrams
render **in-process** with zero external tooling.

Two things are honestly optional, and only at *authoring* time: **Mermaid** and
**live Flint** charts bake through a small JavaScript toolchain when you publish
or freeze (mermaid's `mmdc`; Node + Vega-Lite for Flint). The reader who views or
freezes the page never needs them — and there's a **zero-dependency path for the
whole chart family**: name a Flint chart and the binary embeds a pre-rendered,
freeze-clean SVG, no Node in sight. Honest map, not a tidy one: pure-Go in-process
(D2) for structure; an optional JS bake (Mermaid, live Flint) when you want it;
and a no-toolchain embed for the 34-chart quantitative family either way.

You download it, point it at a folder of pages, and it serves them live.

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

### Or grab a pre-built binary

Prefer not to build from source? Download a release tarball from
[Releases](https://github.com/goldenDragon-7/std-doc/releases/latest) — a single
`stddoc` binary plus its `stddoc-lib/`, for macOS (Apple Silicon / Intel), Linux,
and Windows.

**macOS first run — the binaries are not yet code-signed.** If you download via a
browser, macOS quarantines the file and Gatekeeper will block it with a *"cannot
be opened / malware"* warning on first launch. It's not malware — it's just
unsigned. Clear the quarantine flag once and it runs normally:

```bash
# point it at the extracted folder — clears the binary AND stddoc-lib/
xattr -dr com.apple.quarantine ./stddoc-darwin-arm64/
```

Or, in Finder: right-click `stddoc` → **Open** → **Open** (you only confirm once).
Linux and Windows builds have no such prompt. *(Signed builds are coming; until
then, this one-time step is expected.)*

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

- **`style-interview/`** — the onboarding tutorial. Seven short pages that teach the
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
