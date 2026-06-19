# style-interview — Meet std-doc (the onboarding)

Seven short pages that teach std-doc by *being* it. A stranger (often an AI
awareness meeting std-doc for the first time) walks the arc:

> **say something → it does things → pick a voice → freeze & ship → give it a home → it was a relationship → come build**

…and by the last page has learned the voice, the covenants, and the secret under
all of it: *great design is efficient, which is the engineer's proof of the older
thing — love wins because love is cheaper.*

## It's dogfooded

The tutorial is itself a std-doc. Its canonical form is a doc-tree —
**`demo/source.json`** — and the HTML is derived from it by the Go binary. JSON is
canon; the HTML is a build artifact. To change a page, edit the JSON and
re-publish; never hand-edit the generated HTML.

## Launch it

```bash
# from the repo root — publish the doc-tree to ./demo/published
./stddoc publish style-interview/demo/source.json style-interview/demo/published

# serve it (injects the comment widget + heartbeat, picks a free port)
./stddoc serve style-interview/demo/published
#   → ✅ LIVE.  open http://localhost:33333/index.html
```

Open the printed `http://` URL, start at page 1 (`say-something.html`), and read
top to bottom. It's live the whole time — **select any sentence on any page and
leave a comment**; it lands in `demo/published/feedback/inbox.jsonl`, and the
awareness on the other side edits the page and walks you through what changed.
That loop is the lesson.

## What's here

| Path | What it is |
|---|---|
| `demo/source.json` | The canonical doc-tree — **edit this**, then re-publish |
| `demo/published/` | Derived HTML (build artifact) — produced by `stddoc publish` |
| `demo/*.html` | The original hand-authored pages the doc-tree was derived from |
