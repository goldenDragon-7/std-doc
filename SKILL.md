---
name: std-doc
description: Write a living document — a standalone HTML doc the reader can talk to. They select a sentence and leave a comment; you edit the document back in place and it reloads with a walkthrough of what changed. Bundles the writing method, the visual style, a stdlib-only server, and the reply protocol behind one trigger. Optionally derive a multi-page doc from a canonical JSON doc-tree (source.json) that auto-rebakes and freezes to a portable snapshot. Trigger phrases — "write a living document", "make this a living doc", "/std-doc", "create a standard doc", "make a std-doc", "std-doc this", "a standard document", "draft a proposal I can comment on", "turn this into a doc I can talk to", "make a data-derived doc", "a doc-tree I can ship as frozen pages".
---

# std-doc — the Living-Document Standard

A *living document* is the default shape for anything worth a reader's attention:
a single self-contained HTML page, served locally, that the reader can **talk
to**. They select a sentence, pick an element, or leave a page note; the comment
lands in a local inbox; you (the agent) read it, edit the page in place, and the
page reloads and walks them through exactly what changed. No chat round-trip —
the document *is* the conversation.

This skill is self-contained and MIT-licensed. It depends on nothing but the
single `stddoc` Go binary (one static executable, no runtime) and a browser.
Everything it needs is in this directory.

## When to invoke

The reader says any of:
- "write a living document" / "make this a living doc" / "/std-doc"
- **"create a standard doc" / "make a std-doc" / "std-doc this" / "a standard document"** (it's the name — take it)
- "draft a proposal I can comment on" / "turn this into a doc I can talk to"
- "I want to be able to select text and comment on it"

**First run / "introduce yourself" / "give me the tour" / "I'm new"** → don't
explain, *show*: serve **Meet std-doc** (the onboarding) in `style-interview/demo/`
(`stddoc serve style-interview/demo/published`) and let them meet a living
document by talking to one. It's the warmest door, and the fastest way to
understand the whole tool.

If they hand you existing static HTML and only want commenting (no authoring),
you can skip straight to **Move 3 (Serve)** — the engine works on any folder of
`*.html`.

## Move 0 — Model (DEFAULT: data-derived docs)

**Default to the canonical `source.json` doc-tree.** Author the JSON first and let
the HTML be **100% derived** (`stddoc publish`) for anything beyond a one-off,
single-page, prose-only note — i.e. any doc that is **multi-page**, **structured**
(tables, matrices, repeated components, decision lists), or that you expect to
**iterate on**. Hand-authored single-page HTML is the *exception*, reserved for a
genuinely one-shot prose page.

**Why this is the default, not a nicety — it is a token-cost decision.** Hand-editing
rendered HTML is the expensive anti-pattern: every table reorder, column add, or row
change becomes a full-markup rewrite (the block appears *twice* — old_string +
new_string), plus reading the file back for exact-match strings. The *same* change
against `source.json` is a one-line data edit + a cheap `publish`. A doc iterated a
dozen times as hand-HTML can burn 10–20× the tokens of the JSON-derived equivalent.
**The rule: if you will edit it more than once, start from `source.json`.** (Still
strictly additive: no `source.json` → std-doc falls back to hand-authored single page.)

**One caveat when authoring the JSON:** the bundled publisher renders node **prose**
(+ the `evidence` drill-down layer) into the styled multi-page shell. Bespoke
interactive components beyond the built-in comment widget — custom dot-matrices,
`data-cf-control` radios embedded mid-page, a non-default visual theme — are **not**
native doctree constructs. Express structured data as prose/markdown tables the
template renders; if a doc genuinely needs a custom component, that is the one case
where a small hand-authored escape is justified — keep the rest JSON-derived.

The win is a **forcing function**: a publisher that renders a *complete* page
from JSON alone proves the JSON had everything; the HTML can't drift because it's
regenerated, never edited. Four capabilities fall out: (1) JSON-as-source-of-
truth, (2) multi-page + auto-generated nav, (3) auto-rebake on every change,
(4) freeze to a portable server-free snapshot + `.zip`. A fifth additive
`evidence` drill-down layer renders as collapsed `<details>`.

> **Go-only.** The engine is the single `stddoc` Go binary (`go/cmd/stddoc`,
> built from `go/`); the library is **data** in `go/stddoc-lib/`. There is no
> Python in this package anymore. The commands below are the whole surface:
> `publish · freeze · serve · roll · graduate`. (`serve` folds in the old
> inject + server + watch jobs.)

```bash
stddoc publish source.json published            # derive HTML from canonical JSON
stddoc serve   published                         # inject widget + serve + presence heartbeat
stddoc freeze  published                          # portable server-free snapshot + .zip
```

`publish` only renders the pages — `serve` injects the comment widget. A published
dir is not comment-ready until `serve` runs, so open the **serve URL**, not the
published HTML directly.

Contract: **`protocol/doctree-schema.md`**; worked tree:
**`examples/data-derived-example/source.json`**. **Multi-page note:** all pages
share one `feedback/` dir, so when you reply set the change's `page` (see
`protocol/responding.md`) — that's what makes History click-to-navigate across
pages. Moves 1–2 still govern the *prose inside* nodes; Moves 3–4 are unchanged.

**Style preference (remembering a reader's default).** Three named styles ship:
`techno-dark` (default), `parchment-light`, `playful`. `publish --style <name>`
picks one. Precedence: **`--style` flag › `STDDOC_STYLE` env › `techno-dark`** —
so a reader can set `STDDOC_STYLE=playful` once for a persistent default. And if
they ever say *"make `<style>` my default,"* **record it as a one-line note in
their `~/.claude/CLAUDE.md`** (e.g. `Default std-doc style: playful`) and honor it
on every publish thereafter. That note is where a per-reader preference lives —
the skill has no other persistent state.

## The four moves

Writing a living document is four moves, in order. Each has a bundled reference
file with the full detail; the essentials are inline here.

### Move 1 — Method: write it top-down by dependency

Don't write a wish-list bottom-up ("here's what we have, here's what we could
add"). Write **top-down by descent**: start with the single artifact the reader
will *look at* — the one screen, the one line that matters — then at every layer
ask *"for this to exist, what must be true the layer below?"* until you hit ground
you already stand on. The forward build order is that chain reversed.

The endpoint is the **forcing function**: every layer beneath it is conscripted
by the line above, so you never have to *argue* for the prerequisites — the top
line visibly demands them. The proof of the proposal is the unwind itself.

Seven beats (the skeleton has a block for each):
1. **The one-sentence ask** — concrete, human, what-they-get (not "a system").
2. **The method box** — state that the endpoint is the forcing function.
3. **Layer 0 — render the endpoint** in colour; list its hard properties (each
   property secretly names a prerequisite).
4. **The descent** — the vertical stack, each layer joined by `↑ cannot … without`;
   tag every layer `net-new` or `reuse`; light the bottom layer green: *HERE*.
5. **The diagrams** — one per load-bearing idea (six idioms; see Move 2).
6. **Fold it forward** — the same chain as a build table, Phase 0…N; call out
   reuse vs the honest first brick.
7. **The calls** — end on the 1–3 decisions that are genuinely the reader's to
   make; mark them `◀ YOUR CALL`; commit your own lean first, then invite override.

Two honesty rules: separate `net-new` from `reuse` ruthlessly (trust comes from
*not* rebuilding what exists), and name the one unglamorous gotcha out loud as its
own layer. Full detail: **`method/prd-by-descent.md`**.

The method and the interactivity fit like puzzle pieces: a descent doc *ends in
calls and arguable cells* — questions that already have a home in the page. Write
the doc so its open decisions are sitting there waiting to be clicked.

### Move 2 — Style: make it consistent

One dark dense-report dialect, a fixed palette, six diagram idioms. **Never invent
a hue** — paste the `:root` block from the skeleton verbatim and use colour to
*mean* something, consistently:

| Hue | Means |
|-----|-------|
| green | already built · "we stand here" · a passing test |
| red | the gap · the missing piece · the root-cause column |
| gold | the tender/relational lane · held, not actioned |
| lavender/purple | a question · a call · "◀ YOUR CALL" |
| cyan | the spine · the endpoint · the primary action |
| blue | a second "built" axis (sits beside green without clashing) |

The six diagram idioms (each is one CSS block in the skeleton): **descent** (a
dependency stack), **two-column compare** (root cause: bad vs good), **spectrum**
(a missing axis as a gradient with 3 named stops), **decision matrix** (the
showpiece — rows × cols → a verdict; argue by the *shape* of the colour),
**three axes** (two things you compute, one you never have), **seam/pipeline** (a
flow with a step that has teeth).

Layer 0 must show a **live render of the actual artifact**, not a description —
colour and absence are both tools. Full palette, all six idioms, and the
copy-from skeleton: **`style/styleguide.md`** + **`style/skeleton.html`**.

### Move 3 — Serve: make the page listen

The `stddoc` binary does it all in one process. **`stddoc serve <dir>`** injects a
`<link>`/`<script>` pair into every `*.html` (idempotent) and creates
`feedback/inbox.jsonl` + `feedback/history.json`, serves the pages over HTTP
(accepts the comment POST, exposes `/info`), **and** writes the presence
heartbeat — the old inject + server + watch jobs folded into one command. The
client (`go/stddoc-lib/lib/feedback.{js,css}`) is the floating 💬:
select-to-comment, polls `history.json`, auto-reloads on a new batch.

One command does inject + serve + heartbeat:

```bash
~/.claude/skills/std-doc/setup.sh <your-doc-dir> [port]   # wraps `stddoc serve`
```

It injects, picks a free port (33333+), and prints the URL. The server **keeps
serving after `setup.sh` exits** and stays up for **24 hours past the last
touch** — a page load or an edit to the doc. Open the **`http://localhost:…`**
URL, *not* the `file://` one (only the served copy listens). Direct equivalent:

```bash
stddoc serve <dir> --port 33333            # --recursive for subfolders
```

`--port` is a **preference, not a claim**: the server force-checks it by binding
(atomic — no lsof race), and if it's busy it **advances to the next free port**,
prints the real URL, and writes the chosen port to `<dir>/feedback/.port`. So
concurrent docs never stomp each other on 33333/33334. Pass `--strict-port` to
fail instead of advancing (when you need an exact port); `--port-scan N` bounds
how far it climbs (default 50).

Then **arm a persistent Monitor** on the inbox — this is the load-bearing step;
without it you are just collecting comments nobody reads. `stddoc serve` already
writes the presence heartbeat to `feedback/watcher.json` every few seconds (pass
`--note "<your session>"` to label it) — so you only need a Monitor that streams
each new inbox line:

```
Monitor (persistent, long timeout) on:
  tail -n 0 -F <dir>/feedback/inbox.jsonl | grep --line-buffered .
```

The heartbeat is what tells the reader's page **you're home**: a fresh beat
shows a calm "● watching" dot and an animated "Claude is on it ✨" pulse while a
batch is in flight — and it **suppresses the false "no session is watching this
directory" warning** that otherwise fires when your reply just hasn't landed
*yet*.

Do not poll in a loop — let the Monitor notification arrive. Gotchas that *will*
bite are in **`protocol/responding.md`** and below.

### Pre-ship checklist (before you call it done)

```
- [ ] Open in a browser — verify it renders (the only honest check)
- [ ] If embedding Mermaid: author it dark-safe — the 3 silent traps are in
      protocol/mermaid-gotchas.md:
- [ ]   …strip emoji from  subgraph id["…"]  labels
- [ ]   …flatten  \n  inside pipe edge labels  |…|
- [ ]   …convert Bootstrap classDefs to dark-mode values + set themeVariables
- [ ] Diagram-card + fullscreen pan-zoom is AUTOMATIC: author a .diagram-card with a
      .mermaid block; `stddoc serve` wires the kit (mermaid-gotchas.md Feature 4). No copy-paste.
- [ ] If embedding Mermaid: open the served page and confirm ZERO bomb icons, all readable, fullscreen works
- [ ] To freeze: `stddoc freeze <dir>` — d2 diagrams bake in-process (no tool needed);
      Mermaid diagrams need the Mermaid CLI (npm i -g @mermaid-js/mermaid-cli), and freeze
      refuses (won't ship broken) if a diagram can't be baked
- [ ] If you rewrote the HTML after a prior serve: re-run `stddoc serve <dir>` (re-injects);
      for a data-derived doc, re-run `stddoc publish`
```

### Move 4 — Respond: reply inside the page

When the Monitor fires, read the full inbox entry (`cat <dir>/feedback/inbox.jsonl`
— newest line is last) for the exact ids. Each comment carries `id`, `type`,
`quote`/`text_snippet`, `comment`, and an `anchor.cf_id` that is assigned at
page-load and is **not** in your file — locate the spot by the **`quote` text**,
never by `cf_id`.

Two-part reply:

**Part A — edit the HTML.** Make the change they asked for and wrap the changed
region in an anchor: `<… data-cf-change="ch-<slug>">…</…>`. One anchor per change.

**Part B — append a batch to `history.json`** (newest last; the file starts as
`[]`, keep it a valid array):

```json
{
  "batch_id": "b-<slug>",
  "timestamp": "<ISO 8601>",
  "comments": [{ "id": "<cf_id from inbox>", "comment": "echoed back", "quote": "selected text" }],
  "changes": [{
    "id": "ch-<slug>",
    "in_response_to": ["<cf_id from inbox>"],
    "anchor": "ch-<slug>",
    "title": "short, concrete — shows in the walkthrough",
    "description": "longer prose for the record (hidden in UI)"
  }]
}
```

`in_response_to` must contain the comment's `id` (that clears the "processing…"
banner); `anchor` must equal a `data-cf-change` you actually placed. The page
polls `history.json`, sees the new `batch_id`, reloads (scroll preserved), and
walks the reader to each change.

Promptness is the soul of it: answer the comment that's there (even a test comment
deserves a real in-doc reply — that *is* the proof the loop works); act in the
document first, chat second; make the change visible (a green panel, a re-coloured
cell); be warm and specific in the `title`; batch coherently; and when they answer
a call, *commit* — restyle the chosen option as decided. Full etiquette:
**`protocol/responding.md`**.

### Structured controls — when the answer is multiple-choice

A lot of feedback is really *"which of these?"*. Instead of asking the reader to
type prose, the doc author can embed a **control** — a `radio`, `checkbox`, or
`select` — and the reader answers by *picking*. The selection lands in the inbox
as a structured `control` comment (`value` / `label` / `choices`) you read
directly, with no language to parse. Authoring is pure markup:

```html
<div class="cf-q" data-cf-control="radio"
     data-cf-id="deploy-first" data-cf-prompt="Which surface ships first?">
  <label><input type="radio" value="dashboard"> Dashboard</label>
  <label><input type="radio" value="api"> API</label>
</div>
```

The library wires the control + a "submit answer" button and styles it from the
palette (nothing to copy). To reply, read `value` and **lock the choice in** —
anchor on the control's `data-cf-id` (it's a real id in the HTML, unlike runtime
`cf_id`s). Authoring idiom: **`style/styleguide.md` §6**; the `control` inbox
shape + reply: **`protocol/responding.md`**; worked example:
**`examples/structured-controls/`**.

## Gotchas (these will bite)

- **A doc's life is measured in touches, not in shells.** `serve` stays up for
  **24 hours after the last touch**, where a touch is a page load *or* an edit to
  the served files. An open tab polls, so a reader keeps it alive for free; so
  does an author editing with no tab open. `--idle-timeout N` sets a different
  window, `--idle-timeout 0` means never exit.
- **The server outlives the thing that started it — on purpose.** It used to run
  a parent-death watchdog by default, which meant `setup.sh`, `nohup … &`, and an
  agent's `run_in_background` all killed the doc ~5s after launching it, usually
  before the reader had clicked the link. Parentage says nothing about whether
  anyone wants the document. If you *do* want a doc that dies with the session
  that made it, ask for it: `--exit-with-parent`.
- **macOS has no `setsid`.** Don't reach for it — and you don't need it. A plain
  `&` or `run_in_background` is enough now that the server no longer kills itself
  when orphaned.
- **`history.json` is append-only** — append, never prepend or overwrite. The
  client walks from the end to find the latest batch.
- **`anchor.cf_id` is runtime-only** — assigned at page load, not in your file.
  Locate edits by the `quote` text.
- Injected tags reference `/lib/feedback.css` + `/lib/feedback.js`, which the
  server routes to this skill's `go/stddoc-lib/lib/`. Pages only show the widget when
  opened *through* the server — `file://` renders the page but no widget.
- **Mermaid dark-theme traps** — three *silent* parse/render bombs (emoji in
  `subgraph` labels, `\n` in pipe edge labels, Bootstrap `classDef` colors on a
  dark theme), each yielding the bomb icon with no useful error. Author them out
  (the three rules are in the pre-ship checklist above) and confirm zero bombs in a
  browser. `stddoc serve` also wires a drop-in **pan-zoom viewer** (scrollable card +
  fullscreen wheel-zoom/drag-pan) for complex diagrams. Full details + copy-paste
  code: **`protocol/mermaid-gotchas.md`**.
- **Injected tags are wiped by full HTML rewrites** — the feedback widget tags live
  *in* the HTML, so regenerating a page from scratch silently strips them. Re-run
  `stddoc serve <dir>` after any hand-rewrite (it re-injects). (For data-derived
  docs, `stddoc publish` re-wires the widget on every run; this only bites hand-rewrites.)

## Lifecycle (when a doc earns a durable home)

An ad-hoc doc can live and die with the session. A doc worth keeping earns a
**durable home** — its canonical `source.json` versioned into a git repo, so
every revision is a room you can walk back into (Covenant V). Two verbs:

```bash
# roll — snapshot the canonical JSON into a versioned git home (commits the version)
stddoc roll source.json --slug <slug> --git-home <git-url-or-path> [--graduate-dir published]

# graduate — shed the current comment round and keep the doc live
stddoc graduate <published-dir> [--version v3]
```

`roll` writes a timestamped, named version of the **JSON** into the git home and
commits it (unless `--no-commit`); `--versions-dir` sets where versions land, and
`--graduate-dir` lets you graduate in the same step. `graduate` advances a served
doc to a clean comment round *without tearing it down* — the prior batches stay
in `history.json`, the inbox starts fresh. **JSON is the artifact that travels to
the git home, never the derived HTML** (Covenant I). Every version is a room; the
git home is the archive of rooms.

To bring an archived doc back, re-`publish` from its versioned `source.json` and
`serve` the result — the JSON is canon, so the page rebuilds from it. Keep a
`PROPOSED vs RUNNING` banner distinct from the liveness stamp — `◉ LIVE` means
"the server is up," not "the system this doc describes is live."

## Files in this skill

```
~/.claude/skills/std-doc/
├── SKILL.md                      # this file
├── LICENSE                       # MIT
├── setup.sh                      # inject + serve (24h touch-based lifetime, macOS-safe)
├── method/
│   └── prd-by-descent.md         # Move 1 — the writing method, full
├── style/
│   ├── styleguide.md             # Move 2 — palette + 6 diagram idioms
│   └── skeleton.html             # copy-from starter: every piece live
├── protocol/
│   ├── responding.md             # Move 4 — reply etiquette + schemas (+ control comment, page field)
│   ├── doctree-schema.md         # Move 0 — the source.json doc-tree contract
│   └── mermaid-gotchas.md        # dark-theme Mermaid traps + fixes + pan-zoom viewer
├── go/                          # the engine — one static binary, built from here
│   ├── cmd/stddoc/              # the CLI: publish · freeze · serve · roll · graduate
│   ├── internal/               # renderer CORE + serve / gate / palette / template / d2
│   └── stddoc-lib/             # the library as DATA (no code to ship)
│       ├── templates.json      # the primitives, as data templates
│       ├── primitive_css.json · page_atoms.json
│       ├── lib/                # assets served at /lib/*
│       │   ├── feedback.{js,css}        # comments + controls + presence + threaded history
│       │   ├── mermaid.{css,js}         # diagram-card + fullscreen pan-zoom (served mode)
│       │   └── vendor/svg-pan-zoom.min.js  # inlined into frozen diagram docs
│       ├── styles/             # the three named styles (:root token blocks)
│       └── themes/
└── examples/
    ├── hello-living-doc/         # a served, worked single-page example
    ├── structured-controls/      # radio / checkbox / select, answered by picking
    └── data-derived-example/     # a worked source.json doc-tree (Move 0)
```
