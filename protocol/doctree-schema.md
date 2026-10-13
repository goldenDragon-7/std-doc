# The Doc-Tree Schema — `source.json` (std-doc v2)

When a living document is *structured*, its canonical form is a JSON **doc-tree**,
not hand-written HTML. The HTML becomes a build artifact (`stddoc publish`). This
sits beside the existing `meta.json` (durable identity) and `feedback/` (comments)
— it does not replace them.

```
library/<slug>/
├── source.json     # NEW (v2) — canonical doc-tree; HTML is derived from this
├── index.html      # derived (stddoc publish) — never hand-edited
├── <node>.html     # derived — one per node
├── meta.json       # unchanged (protocol/library-schema.md)
└── feedback/       # unchanged
```

If `source.json` is absent, std-doc behaves exactly as v1 (author HTML by hand).

## Shape

```jsonc
{
  "title": "string",                 // doc title (nav brand + index h1)
  "generated_date": "YYYY-MM-DD",    // optional, shown in footers/banner
  "evidence_levels": ["OBSERVED"],   // optional: extra citation-evidence labels
                                     //   accepted on top of the canonical five
  "groups": ["A", "B"],              // optional nav-group order; else inferred + sorted
  "root": {                          // the index/landing page
    "summary": "string",
    "facets": { "label": "text" }    // optional labelled cards (e.g. mission/vision/core)
  },
  "nodes": [                         // one HTML page each
    {
      "slug": "kebab-id",            // [a-z0-9-]+  -> <slug>.html ; nav + cross-links use it
      "group": "A",                  // optional nav grouping
      "title": "string",
      "tagline": "string",           // optional
      "status": "LIVE|PARTIAL|WIP|DEBT",  // optional badge + nav chip
      "badges": { "repo": "x", "schema": "y" },  // optional free badges
      "diagrams": [ { "caption": "string", "ascii": "string" } ],  // optional
      "sections": [
        {
          "name": "string", "icon": "🔌",          // icon optional
          "tag": "string",                          // optional chip (e.g. a category)
          "summary": "string",
          "items": [
            {
              "name": "string", "desc": "string",   // desc/summary accept [text](https://…) links
              "citations": [
                { "path": "src/x.go", "line": "10-14",
                  // one of the canonical five, or any label the doc declares in
                  // the root evidence_levels list (below):
                  "evidence": "MEASURED|CALCULATED|CITED|INFERRED|ESTIMATED|SPECULATIVE",
                  "note": "string" }
              ],
              "evidence": { … }      // OPTIONAL item-level drill-down (additive)
            }
          ]
        }
      ],
      "blocks": [                    // OPTIONAL — this is where PRIMITIVES go
        { "type": "table",    "name": "…", "columns": […], "groups": […] },
        { "type": "callout",  "kind": "green", "lead": "…", "body": "…" },
        { "type": "diagram",  "dtype": "c4-architecture", "label": "…", "d2": "…" }
        // …any of the ~40 declarative primitives; `stddoc primitives` lists them.
        // Three of those primitives — row/grid/band — are CONTAINERS: they
        // compose other blocks/[content] the same way sections/children/blocks
        // compose the node. See protocol/primitives.md "The page layout
        // language" for the grammar; `blocks[]` is still the only place a
        // container (or any primitive) gets authored at the node level.
      ],
      "children": [ { "slug": "…", "title": "…" } ],  // OPTIONAL child NODES
      "evidence": { … }              // OPTIONAL node-level drill-down (additive)
    }
  ]
}
```

### The three node containers — and the trap

A node has exactly three containers, and **putting content in the wrong one used
to discard it in silence.** This is the single most common authoring mistake, so
it is stated here plainly:

| Container | Holds | Shape |
|---|---|---|
| `sections[]` | **prose only** | `{name, icon, tag, summary, items}` — no `type` key |
| `blocks[]` | **primitives** | `{type: "table" \| "callout" \| "diagram" \| …}` |
| `children[]` | **child nodes** | `{slug, title, …}` — a node, not a primitive |

> **A primitive authored into `sections[]` renders as nothing.** So does a
> primitive in `children[]`, and so does everything under a mistyped container
> key (`block:` for `blocks:`, `section:` for `sections:`). Before 2026-08-22
> all of these exited 0 with no message and simply produced a page missing its
> diagrams. The linter now catches every one and names the correct key — believe
> it when it fires, and never reach for `--no-lint` to make it quiet.

Field names inside a primitive are checked the same way: a near-miss of a field
the primitive actually reads (`colums` for `columns`, `bodyy` for `body`) is a
warning naming the right one. Deliberate extra keys you carry for your own
purposes (`internal_note`, `ticket`) are left alone.

### Required vs optional

- **Required:** `title`, `nodes[]`, each node's `slug` + `title`.
- Everything else is optional. A minimal doc is `{title, nodes:[{slug,title}]}`.

### Citation evidence vocabulary (the `evidence` string)

A `citation.evidence` string — distinct from the additive `evidence` *object*
below — is graded against a fixed vocabulary at publish time. The **canonical
five** are `MEASURED`, `CALCULATED`, `CITED`, `INFERRED`, `ESTIMATED`,
`SPECULATIVE` (a superset of the original three, so older docs stay valid). If
your doc grades on its own scale, declare the extra labels once at the doc root:

```jsonc
{ "title": "…", "evidence_levels": ["OBSERVED", "THEORIZED"], "nodes": [ … ] }
```

Lint accepts the union of the five and whatever you declare, and its reject
message names the whole effective set — so you never have to discover it by
failing twice.

### Links in prose (`desc` / `summary`)

Prose fields (`desc`, `summary`) accept a markdown link `[text](https://…)`,
rendered as a real `<a>`. Only `http(s)` URLs become links — a scheme-less or
`javascript:`/`data:` target is left as plain text, so code-shaped prose like
`ctx['x'](block)` is never mangled and nothing dangerous reaches an `href`. A
reader-clickable link also survives `freeze` (it fetches nothing on load), so a
data-derived doc can cite the web and still ship as a frozen snapshot.

## The additive `evidence` object

`evidence` is **free-form and ignored by any renderer that doesn't opt in** —
that is what makes adding it safe. The bundled renderer understands:

```jsonc
"evidence": {
  "provenance": { "sources": [ { "kind": "string", "ref": "string", "path": "string" } ] },
  "forensic":   { "documents": [ { "kind": "prose-doc", "ref": "string",
                                   "title": "string", "markdown": "string" } ] },
  "<any-other-key>": <any JSON>,     // rendered by a shape-agnostic walker, nothing dropped
  "related":    [ { "title": "string", "note": "string" } ]
}
```

**Faithfulness rule:** to absorb heterogeneous source documents without losing
fields, store the *whole* source object under an `evidence` sub-key and let the
shape-agnostic walker render it (scalars→text, list→bullets, list-of-dicts→
labelled blocks, dict→k/v rows). Different shapes render correctly with no
schema change.

## Additivity is testable

To prove `evidence` (or any new optional key) is additive: inject a sample block
on every node in memory, render with the current renderer, diff against the
un-injected render. **Byte-identical output = invisible until a renderer opts in.**
(Reference impl proved render byte-identical, citation count unchanged, at every
absorb step.)

## Naming note

std-doc already uses **"Cartography"** for its knowledge-map coordinate substrate
(`meta.json.links`/`embedding`). This feature is unrelated; call it **"doc-tree"
/ "data-derived docs,"** not "cartography," to avoid collision.
