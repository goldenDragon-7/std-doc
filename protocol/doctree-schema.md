# The Doc-Tree Schema — `source.json` (std-doc v2)

When a living document is *structured*, its canonical form is a JSON **doc-tree**,
not hand-written HTML. The HTML becomes a build artifact (`publish.py`). This
sits beside the existing `meta.json` (durable identity) and `feedback/` (comments)
— it does not replace them.

```
library/<slug>/
├── source.json     # NEW (v2) — canonical doc-tree; HTML is derived from this
├── index.html      # derived (publish.py) — never hand-edited
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
              "name": "string", "desc": "string",
              "citations": [
                { "path": "src/x.py", "line": "10-14",
                  "evidence": "MEASURED|CITED|INFERRED", "note": "string" }
              ],
              "evidence": { … }      // OPTIONAL item-level drill-down (additive)
            }
          ]
        }
      ],
      "evidence": { … }              // OPTIONAL node-level drill-down (additive)
    }
  ]
}
```

### Required vs optional

- **Required:** `title`, `nodes[]`, each node's `slug` + `title`.
- Everything else is optional. A minimal doc is `{title, nodes:[{slug,title}]}`.

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
