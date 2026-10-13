# Document templates — indexed by the writer's question

This is the first shelf of the community template library: whole-document
shapes (not primitives — see `protocol/primitives.md` for those) that answer
"what kind of document do I need?" Each family below is a directory with a
`STYLEGUIDE.md` (the when/shape/anti-patterns) and a worked, **rendered**
`source.json` you can copy and adapt. Every one has been published with
`stddoc publish` and confirmed to produce zero `std-doc-error` markers — not
trusted from an exit code, grepped out of the actual output HTML.

Modeled on the CF Documentation Guide's structure (`http://localhost:33355/`,
"§0 YOU OWN / YOU DO NOT OWN", question-indexed sections, anti-patterns "each
one we actually shipped", pre-flight checklist). This index does the same
thing one level up: for a WHOLE DOCUMENT, not a single block.

## §0 · YOU OWN / YOU DO NOT OWN

**You own:** picking the family that matches your reader's posture (scrutiny
vs orientation vs lookup), and being honest about which one that is before you
write a line.

**You do not own:** the primitive vocabulary (that's Stream 1 / `stddoc-template-builder`'s
lane — see `protocol/primitives.md` and `examples/primitive-gallery/`), or the
page-layout language (`stddoc-lang-strategist`'s in-flight design — see
`GAPS.md` for what it needs to solve). If your document's shape doesn't fit
any family below, that is signal for one of those two efforts, not a reason to
invent a private renderer.

## Pick by your reader's question

| Your reader is asking… | Reach for… |
|---|---|
| "How do you know that's the problem?" — they want evidence, not just a verdict | [`detective-findings-report/`](detective-findings-report/STYLEGUIDE.md) |
| "Just tell me the verdict and what I need to decide" — they trust your evidence already | [`captain-synthesis-brief/`](captain-synthesis-brief/STYLEGUIDE.md) |
| "What does this system contain, and how do I call it?" — no argument, just facts | [`domain-system-reference/`](domain-system-reference/STYLEGUIDE.md) |
| "I've never seen this landscape — orient me" — many things classified, no verdicts | [`macro-overview/`](macro-overview/STYLEGUIDE.md) |
| "N of us are about to investigate different parts of ONE system — give us a shared starting picture" | [`as-built-dossier/`](as-built-dossier/STYLEGUIDE.md) |
| "What does this capability do, why should I care, and how do I turn it on?" | [`capability-explainer/`](capability-explainer/STYLEGUIDE.md) |
| "I've never used this at all — walk me from zero to 'I made a thing'" | [`onboarding-tutorial/`](onboarding-tutorial/STYLEGUIDE.md) — the only family using `"nav": "pager"` instead of `layout: "top-nav"` |

More families land here as the corpus scout continues — this index is a
living document, not a closed set. See `GAPS.md` for shapes the corpus clearly
needs that std-doc cannot express yet (tagged CONTAINER vs LEAF, so you know
whether to wait on the layout language or ask for a new primitive). See
`acceptance-tests/` for the two real-corpus-document tests staged ahead of
the container axis (band/row/grid + tabs) landing — pre-analyzed so testing
can start the moment `stddoc-layout-builder` ships.

## The three families, side by side

```
                 scrutiny mode                    orientation-free
                 (show the work)                  (state the facts)
   ┌─────────────────────────┐          ┌──────────────────────────┐
   │ detective-findings-report│  ──────▶ │ captain-synthesis-brief  │
   │ thesis → evidence →      │ compress │ verdict-box → matrix →   │
   │ verdict grid → findings  │          │ grouped findings, terse  │
   └─────────────────────────┘          └──────────────────────────┘

   ┌───────────────────────────────┐
   │  domain-system-reference       │   register: descriptive, no verdicts
   │  what it is → inventory →      │   at all — if you want a callout with
   │  schema → call surface → limits│   a verdict in it, you're in the wrong
   └───────────────────────────────┘   family, go to findings-report instead
```

The detective↔captain pair share an investigation; the reference family is
orthogonal — a system gets a reference doc once, findings reports as needed.

## §4 · PRE-FLIGHT — run this before you hand your doc back

1. Does your reader's actual question match the family you picked? (Table
   above — say the question out loud, don't just pick by vibe.)
2. Did you run `stddoc lint your-source.json` — clean, or did you consciously
   override a suggestion (and can you say why, like `detective-findings-report`
   did for its `flow` vs `pipeline` call)?
3. Did you `stddoc publish` and **grep the output HTML for `std-doc-error`**?
   An exit code of 0 does not mean your palette entities resolved — see the
   gotchas section in `detective-findings-report/STYLEGUIDE.md` for exactly
   how this bites you silently.
4. If your palette uses non-default entity names (anything besides the
   built-in tokens), did you declare them in the document's top-level
   `"palette"` block? Missing declarations render a **visible error banner
   in the page**, not a silent drop — but only if you check.
5. Does every finding/verdict/callout in your doc trace to a real
   `file:line` you can cite? If you can't cite it, it doesn't belong in a
   Detective Findings Report or Captain Synthesis Brief.

## Corpus and provenance

Full dialect survey: `~/workspace/curate/samples/SURVEY-NOTES.md` (pre-existing,
read before this index was written — do not redo it). Corpus locations:

```
~/workspace/curate/samples/        77 html
~/workspace/vmshare/docs/          64 html
~/workspace/vmshare/doc-examples/  20 html
```

Each `STYLEGUIDE.md` cites the specific `file:line`/file it was derived from.
