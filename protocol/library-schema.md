# The Library Schema — durable doc identity

A living document worth keeping stops being an ephemeral `index.html` on a guessed
port and becomes a **directory with a stable slug**:

```
library/<slug>/
├── index.html              # the doc itself
├── meta.json               # durable identity + lifecycle state
└── feedback/
    ├── inbox.jsonl         # comments (append-only)
    └── history.json        # agent replies / walkthrough batches (append-only array)
```

Sealing a doc *moves* the whole `<slug>/` folder to a sibling `archive/<slug>/`
(see SKILL.md → Lifecycle). **Nothing is ever deleted.**

## `meta.json`

The durable record. One object:

```json
{
  "slug": "the-dogfood-note",
  "title": "The Dogfood Note",
  "project": "std-doc",
  "state": "live",
  "created": "2026-06-05T17:29:00",
  "touched": "2026-06-05T17:30:40",
  "tags": ["proof", "loop", "dogfood"],
  "port": 5074
}
```

| field | type | notes |
|-------|------|-------|
| `slug` | string | stable id; matches the directory name; `[a-z0-9-]+` |
| `title` | string | human title (shown on the shelf) |
| `project` | string | grouping key (the shelf groups by project) |
| `state` | enum | one of `live` · `shelved` · `locked` · `sealed` |
| `created` | ISO 8601 | first registration time |
| `touched` | ISO 8601 | last lifecycle change or edit |
| `tags` | string[] | free tags for search/filter (may be empty) |
| `port` | int \| null | the port it serves on when live; `null` when not live |
| `links` | object[] | *(optional, Cartography)* outbound references — the link graph |
| `embedding` | number[] \| null | *(optional, Cartography)* reserved; `null` until computed |

### The Cartography substrate (optional fields)

Two optional fields carry the coordinate system the downstream map reads. They
are absent on a hand-registered doc and present on an ingested one.

- **`links`** — an array of outbound references parsed from the doc. Each is
  `{ "to": "<slug-or-ref>", "kind": "wikilink" | "href" | "phrase", "raw": "…" }`.
  Sources: `[[slug]]` wiki-links, internal hrefs (`/api/knowledge/docs/<slug>`,
  sibling `*.html`), and `"<X> runbook/PRD/spec/guide/brief"` phrases. This IS
  the link graph the dragon-ranking rides — a directed edge `this.slug → link.to`.
- **`embedding`** — reserved as `null`. The Cartography MVP computes the vector;
  the field just carves the slot so nothing reshapes the schema later.

### The four states

| state | axis | meaning |
|-------|------|---------|
| `live` | liveness | server up, page listening |
| `shelved` | liveness | server off, history kept, trivially reversible |
| `locked` | decision | declared final; can be live or shelved underneath |
| `sealed` | cold storage | tags stripped → clean static, folder moved to `archive/` |

`live`/`shelved` are the mechanical liveness axis. `locked` is a sticky decision
that can coexist with either. `sealed` is the one move to cold storage.

## `STATUS.json` (optional, written beside the served page)

A lightweight stamp the served page and the lifecycle verbs read, so liveness is
visible without re-deriving it:

```json
{
  "state": "live",
  "since": "2026-06-05T17:29:00",
  "reason": "registered + served on :5074"
}
```

| field | type | notes |
|-------|------|-------|
| `state` | enum | same enum as `meta.json.state` (kept in sync) |
| `since` | ISO 8601 | when the doc entered this state |
| `reason` | string | short human note (why it changed) |

`meta.json.state` and `STATUS.json.state` are mirrors — a lifecycle verb writes
both. `meta.json` is the durable record; `STATUS.json` is the at-a-glance stamp.

## Validation rules

- `slug` matches `^[a-z0-9][a-z0-9-]*$` and equals the directory name.
- `state` ∈ {`live`, `shelved`, `locked`, `sealed`}.
- `created` ≤ `touched`.
- `port` is an int in `[1, 65535]` when `state == "live"`, else `null`.
- A `sealed` doc lives under `archive/`, not `library/`, and its `index.html`
  has no injected `/lib/feedback.*` tags (clean static).
