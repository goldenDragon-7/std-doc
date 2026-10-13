# Onboarding Tutorial

## When you reach for this template
**A stranger is arriving cold and needs to go from zero to "I made a thing"
in one sitting.** This is std-doc's own onboarding form — the "Meet std-doc"
demo (`style-interview/demo/`) is the in-repo exemplar. This is the
highest-value family in the whole survey: it's the shape a
newcomer needs FIRST and is least likely to be able to derive themselves.

Don't reach for this for internal documentation aimed at people who already
know the system — every other family in this library assumes an already-
oriented reader. This one assumes nothing and earns trust page by page.

## The topology is different — this is the point

All six prior families use `layout: "top-nav"` — sections stacked or tabbed
under one page, reader jumps around freely. This family uses **`"nav":
"pager"`** at the document root instead of `layout`: a linear, numbered
sequence of standalone pages with forward/back navigation and a page-count
indicator. **MEASURED**: publishing this family's worked example renders a
literal `1 / 4` page counter and a `pager` CSS class not present in any of
the other five families' output. A tutorial's whole value is sequence — the
reader should not be able to skip ahead to page 4 without earning pages 1-3 —
and `pager` is the only nav mode in std-doc that enforces that shape.

## The document's shape

| # | Page | What it's FOR |
|---|---|---|
| 1 | Say something | Proves interactivity FIRST, before explaining anything — the reader does the thing, then understands why it matters |
| 2 | Meet the vocabulary | The 3-4 primitives a total beginner needs, no more — this is not the full primitive catalog |
| 3 | Draw with me / try it | The exact copy-pasteable command that produces a first rendered page |
| 4 | Come build with us | The invitation — states explicitly that everything they just experienced was itself written in the same format |

## Primitives used

| Section | Primitive | Notes |
|---|---|---|
| Root | `"nav": "pager"` | NOT a primitive — a document-root topology switch, orthogonal to every primitive in the catalog |
| Say-something | `callout` with `lead_content` | `lead_content` is a real, wired `compose` directive (`go/stddoc-lib/templates.json:408-435`) that lets a callout's lead line be built from typed inline items (`text`, `kbd`, …) instead of one escaped string — this is how the corpus's "press `C`" keyboard-hint styling gets its own `<kbd>` chip. I initially suspected this was dead/aspirational (`install.go` didn't reference it) before confirming it lives in the data-driven `templates.json` path, not the hand-coded Go one — worth remembering that split when auditing what's "real": data-driven primitives never show up in `.go` grep. |
| Vocabulary tour | `cardgrid` | same primitive as every other family — the vocabulary being TAUGHT is a subset, but the primitive teaching it is ordinary |
| Try it | `flow` + `code` (mode `command`) | |
| Invitation | `callout` + `prose` | closes by pointing at `docs/templates/README.md` — this family and the reference index are meant to hand off to each other |

## Worked example

`source.json` in this directory, 4 pages (the real demo has 11 — trimmed for
a worked example, not a replacement). Published with `--style playful`
(deliberately different from the other five families' `techno-dark` — this
register earns a lighter voice) and **rendered clean**: zero `std-doc-error`
markers, `1 / 4` page counter confirmed present, `stddoc lint` clean.

## Anti-patterns

- **Explaining before demonstrating.** `style-interview/demo/`'s page 1 is
  "Say something to this page," not "Here is how commenting works" — the
  reader acts first, understands second. A tutorial that opens with prose
  about the system instead of a thing to DO has inverted the form.
- **Teaching the whole primitive catalog on page 2.** The real demo's
  "new-vocabulary" page teaches a handful, not all ~35 declarative
  primitives. Overloading the vocabulary page defeats the "zero to one thing"
  promise this format exists to keep.
- **A pager tutorial with no invitation at the end.** If the last page is
  just a summary, the format has wasted its own thesis (the project conventions §6): the
  document IS the pitch. End on "go build," not "the end."
- **Treating `layout: "top-nav"` habits as portable here.** A `tab-bar` or
  free-jump table of contents defeats the sequencing this format exists to
  enforce — don't decorate a pager doc with escape hatches back to
  non-linear reading unless the content genuinely branches.

## Evidence (corpus `file:line`)

- `style-interview/demo/source.json` — `"nav": "pager"`, 11-page structure
  (`say-something` → … → `come-build`), `lead_content`/`hint_content` compose
  pattern, per-page `group`/`tagline` fields not used by any of the other six
  families
- `style-interview/demo/published/` — rendered proof the topology works at
  full scale (11 pages, not my 4-page trim)
- MEMORY.md `soul-download-lost-originals` — flags that this demo's original
  bespoke hand-crafted form was flattened to `source.json` in commit
  `1896dee`, with a "bespoke-vs-derived decision open" — worth reading before
  treating this family's `source.json` as the final word on the format;
  the bespoke original may carry texture this worked example doesn't capture
