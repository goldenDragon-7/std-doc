# Responding Promptly — Reply Inside the Page

*The part that's yours, and the part that makes it feel alive.*

The engine carries the comment to you. **Everything after that is craft.** A slow
or ticket-shaped reply kills the magic; a fast, warm, in-place reply is the whole
gift.

---

## The moment a comment lands

Your Monitor fires with a JSONL line. **Read the full inbox entry** (don't work
from the truncated event) so you get the exact ids:

```bash
cat <dir>/feedback/inbox.jsonl     # newest line is last
```

Each comment carries:

| field | what it is | you need it for |
|-------|-----------|-----------------|
| `id` | stable comment id, e.g. `c-1780675305538-psqe` | → `in_response_to` in your history batch |
| `type` | `selection` / `element` / `page` | how literal their anchor is |
| `quote` / `text_snippet` | the text they selected | finding the spot in the HTML |
| `anchor.cf_id` | runtime DOM id (e.g. `el-5`) | **assigned at page-load — NOT in your file.** Don't grep for it. |
| `comment` | what they actually said | the thing to answer |

> **Gotcha:** `anchor.cf_id` (`el-5`, `el-12`…) is assigned by the client at
> page-load, so it does **not** exist in the HTML file. Locate the spot by the
> **`quote` text**, not the cf_id.

---

## Structured answers — the `control` comment

A lot of feedback is really *"which of these?"* — and prose is a clumsy way to
say "option B." When the doc author embeds a **control** (`radio` / `checkbox` /
`select` — see the styleguide), the reader answers by *picking*, and the inbox
gets a **structured** entry you read directly. No NLP, no guessing.

A `control` comment looks like this (one inbox line):

```json
{
  "id": "c-1780675312000-a1b2",
  "type": "control",
  "control": "radio",
  "field": "deploy-first",
  "prompt": "Which surface ships first?",
  "value": "dashboard",
  "label": "Dashboard",
  "choices": [
    { "value": "dashboard", "label": "Dashboard" },
    { "value": "api",       "label": "API" },
    { "value": "cli",       "label": "CLI" }
  ],
  "comment": "optional free-text note they added (often empty)"
}
```

| field | what it is |
|-------|-----------|
| `control` | `radio` (one) · `checkbox` (many) · `select` (dropdown) |
| `field` | the author's stable `data-cf-id` for the question — **this IS the anchor**; it exists in the HTML |
| `prompt` | the question text |
| `value` | the chosen value — a **string** for radio/select, an **array** for checkbox |
| `label` | the human label(s) for the chosen value(s) |
| `choices` | every option offered, for your context |
| `comment` | optional note; may be empty (that's fine — the *pick* is the answer) |

**Replying to a control answer is the normal two-part reply, with one nicety:**
because `field` is an author-set id that really exists in the HTML, you anchor on
the control block itself. Read `value`, then **lock the decision in** (this is the
"commit, don't waffle" rule made literal):

- **Part A** — edit the chosen `<label>` inside `[data-cf-id="<field>"]` to a
  decided state (e.g. add `data-cf-change="ch-<field>"` + a ✓/colour), and
  optionally dim the rejected options. The reader *sees* their pick become the
  decision.
- **Part B** — append the history batch as usual, with
  `in_response_to: ["<the control comment id>"]` and `anchor: "ch-<field>"`.

A checkbox answer (`value` is an array) is handled the same way — mark each
chosen option.

---

## The two-part reply

### Part A — edit the HTML

Find the spot by its quoted text and make the change the reader asked for —
re-colour a matrix cell, lock in a call, redraw a diagram, add a clarifying line.
**Wrap your changed region** in an anchor the walkthrough can find:

```html
<p data-cf-change="ch-loop-confirmed" style="...">
  ✓ Your answer, rendered right here in the doc.
</p>
```

One `data-cf-change="ch-<slug>"` per change. It can be a new element or an
attribute added to an existing wrapper.

> **Data-derived docs (`source.json`): prefer the stable renderer anchor.**
> A hand-placed `data-cf-change` is **wiped the next time `stddoc publish` re-bakes
> the page** — the change anchor doesn't survive a re-publish, so the
> walkthrough lands on "couldn't find region." For these docs, **don't invent a
> `ch-<slug>`** — point the change at the renderer's content-addressed anchor,
> which regenerates identically on every bake (PRD P0-1):
>
> | level | `data-cf-anchor` (use as `changes[].anchor`) | `id` |
> |-------|----------------------------------------------|------|
> | node | `n=<slug>` | `cf-<slug>` |
> | section *j* | `n=<slug>§<j>` | `cf-<slug>-s<j>` |
> | item *k* in section *j* | `n=<slug>§<j>.<k>` | `cf-<slug>-s<j>-i<k>` |
>
> The widget resolves a change anchor against `data-cf-change`, then the stable
> `data-cf-anchor`, then the element `id` — so setting `changes[].anchor` to
> `n=the-binary§1` (Part B) walks the reader to that section with **no HTML edit
> required and no re-bake fragility**. Still make a *visible* edit inside that
> region (a confirmation line, a re-style) so the reader sees the answer — just
> anchor the batch on the stable id instead of a throwaway `ch-`.

### Part B — append a batch to `history.json`

This is what triggers the auto-reload + walkthrough. **Append** (newest last) to
the array in `<dir>/feedback/history.json`. The file starts as `[]`; keep it a
valid JSON array.

**The `history.json` schema** — each batch object:

```json
{
  "batch_id": "b-<slug>",
  "timestamp": "<ISO 8601>",
  "comments": [
    {
      "id": "c-1780675305538-psqe",
      "comment": "the thing they said (echoed back)",
      "quote": "the text they selected",
      "author": "Dana"
    }
  ],
  "changes": [
    {
      "id": "ch-loop-confirmed",
      "in_response_to": ["c-1780675305538-psqe"],
      "anchor": "ch-loop-confirmed",
      "page": "mem-biography.html",
      "title": "short, concrete — shows in the walkthrough",
      "description": "longer prose for the record (hidden in UI)"
    }
  ]
}
```

- **`in_response_to`** must contain the comment's `id` — that is how the page
  knows the "processing…" banner can clear.
- **`author`** (optional) — if the reader signed their comment (it carries an
  `author` in the inbox), **copy it through** onto the echoed comment. The
  History thread shows it in place of "you", so a multi-author doc says *who*
  said what. Omit it and the bubble falls back to "you" exactly as before.
- **`anchor`** must resolve to a node in the page — either a `data-cf-change`
  you placed, or (preferred for data-derived docs) a renderer-stable
  `data-cf-anchor` / `id` from the table above (e.g. `n=the-binary§1`).
- **`page`** (optional but **required for multi-page docs**) — the basename of the
  HTML file you placed the anchor in. A data-derived (std-doc v2) doc is many
  pages sharing one `feedback/` dir, so the History thread is site-wide while
  each anchor lives on one page. Set `page` and the History entry becomes
  click-to-navigate (the widget opens that page and jumps to the change);
  **omit it and an off-page change shows "couldn't find region."** Get it from
  the comment's batch `page_url` in the inbox. For a single-page doc, omit it.
- **Append-only.** Keep it a valid JSON array; the client walks from the *end* to
  find the latest batch. Never prepend or overwrite.

The page polls `history.json`, sees the new `batch_id`, reloads (scroll
preserved), and walks the reader to each change. Loop closed.

---

## Promptness standards (this is the soul of it)

Latency is felt as care or its absence.

1. **Answer the comment that's there, not the one you wish was there.** Even a
   test comment ("just confirm you see it") deserves a real in-doc reply — that
   *is* the proof the loop works, and the delight is the point.
2. **Act in the document first, chat second.** The whole pitch is "no chat
   round-trip." Make the change land in the page; only send a chat line if there's
   something they'd act on *now*.
3. **Make the change visible.** A green confirmation panel, a re-coloured cell, a
   redrawn block. They should *see* the answer on reload, not have to hunt.
4. **Be warm and specific in the `title`.** "Confirmed — I see you" beats "Updated
   doc." The walkthrough text is a tiny note to the reader.
5. **Batch coherently.** If they leave 3 comments at once, one batch with 3
   `changes` is cleaner than 3 batches — they get one reload, one walkthrough.
6. **Commit, don't waffle.** When they answer a call, *lock it in* — restyle the
   chosen option as decided, update the build table. The doc should evolve toward
   a settled artifact, not accumulate maybes.

---

## A worked example

The reader selected the Layer-0 paragraph and wrote *"This is a test comment…
just confirm you see it."* The reply:

- **Part A:** added a green-railed `<p data-cf-change="ch-loop-confirmed">` right
  under that paragraph — *"✓ Seen you, loud and clear… your comment landed at
  09:01, the monitor pinged me, this paragraph is my reply."*
- **Part B:** appended a `b-loop-confirmed` batch with `in_response_to:
  ["c-…"]` and `anchor: "ch-loop-confirmed"`.

The page reloaded and walked them to the green panel. That reaction — *"oh wow"* —
is the spec. Build for it.
