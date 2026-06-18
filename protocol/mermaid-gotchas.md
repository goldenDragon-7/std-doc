# Mermaid Dark-Theme Gotchas

*Three silent bombs when embedding Mermaid in a dark-theme living document.*

**Mermaid version:** 11.x (CDN `mermaid@11`)
**Discovered:** 2026-06-09 (prmgfsc req-assign-v3 living document) · folded into the
skill so nobody hits them twice.

A living document is Dialect-A dark by default (`style/styleguide.md`). Mermaid's
defaults assume a light page, so three things blow up — each produces the **bomb
icon with no useful error**, which is why they cost hours the first time.

These three all fail *silently* (the bomb icon, no useful error), so the rule is
simple: **author them out using the three fixes below, then open the page and
confirm zero bombs** — your own eyes are the only honest check.

---

## Bug 1 — Emoji in subgraph quoted labels → parse error

Any diagram using `subgraph id["emoji text"]` explodes.

```
subgraph T1["🔧 Trigger: AssignmentActivationTrigger"]   ← BOMBS
subgraph T2["⚡ Flow: ..."]                               ← BOMBS
```

Emoji in **regular node** labels (`NODE["🔧 ..."]`) are fine — **only** the
`subgraph id["..."]` form is affected.

**Fix — keep emoji out of `subgraph id["…"]` titles.** Put the emoji in a regular
node label instead (those render fine), or drop it from the subgraph title.

---

## Bug 2 — `\n` inside pipe edge labels → parse error

```
A -->|NO — Prospect channel\nnot a reassignment| B    ← BOMBS
```

`\n` is valid inside **node** labels (`["line1\nline2"]`) but **not** inside
pipe-style **edge** labels (`|...|`). Mermaid parses the label terminator
differently and chokes.

**Fix — never put `\n` inside a pipe edge label `|…|`.** Keep edge labels on one
line (use a space). `\n` is fine inside **node** labels (`["line1\nline2"]`) — just
not in the `|…|` edge form.

---

## Bug 3 — Dark theme + light-mode `classDef` colors → unreadable text

Diagrams authored with Bootstrap light-mode `classDef` colors render illegibly
when `theme: 'dark'` is active. Dark text on dark fills; both disappear.

**Root cause:** `classDef` fill/stroke/color values override theme defaults. A
`color:#155724` (dark green) is invisible on a `fill:#14532d` (dark green fill).

**Fix A — convert Bootstrap classDefs to dark-mode equivalents** (use this mapping):

| Bootstrap (light) | Dark-mode equivalent | meaning |
|---|---|---|
| `fill:#d4edda,stroke:#28a745,color:#155724` | `fill:#14532d,stroke:#4ade80,color:#bbf7d0` | green / pass |
| `fill:#f8d7da,stroke:#dc3545,color:#721c24` | `fill:#7f1d1d,stroke:#f87171,color:#fee2e2` | red / fail |
| `fill:#fff3cd,stroke:#ffc107,color:#856404` | `fill:#78350f,stroke:#fbbf24,color:#fef3c7` | yellow / msg |
| `fill:#cce5ff,stroke:#004085,color:#004085` | `fill:#1e3a5f,stroke:#60a5fa,color:#dbeafe` | blue / note |
| `fill:#e2e3e5,stroke:#6c757d,color:#383d41` | `fill:#1e293b,stroke:#94a3b8,color:#e2e8f0` | grey / data |
| `fill:#d1ecf1,stroke:#0c5460,color:#0c5460` | `fill:#164e63,stroke:#22d3ee,color:#cffafe` | cyan / delta |

**Fix B — always set explicit `themeVariables`** in `mermaid.initialize()`:

```js
mermaid.initialize({
  startOnLoad: true,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#0d1526',
    primaryColor: '#1a2236',
    primaryTextColor: '#e2e8f0',
    primaryBorderColor: '#334155',
    lineColor: '#60a5fa',
    secondaryColor: '#1e293b',
    tertiaryColor: '#0a0e17',
    edgeLabelBackground: '#1a2236',
    clusterBkg: '#111827',
    clusterBorder: '#334155',
    titleColor: '#e2e8f0',
    nodeTextColor: '#e2e8f0',
  },
  flowchart: { curve: 'basis', padding: 20 }
});
```

**Fix C — match the diagram card background to `themeVariables.background`:**

```css
.diagram-card { background: #0d1526; }
```

A white card behind a dark-theme diagram produces the same clash in reverse —
card and diagram must agree.

---

## Bug 4 (process) — injected tags are wiped by full HTML rewrites

The feedback widget tags live *in* the HTML. If you regenerate a page from
scratch (a full `index.html` rewrite), those tags are gone and the page silently
stops listening for comments. **Re-run `stddoc serve <dir>` after every
hand-rewrite** (it re-injects). (`stddoc publish` re-wires the widget on every
run for data-derived docs; this only bites hand-rewrites.)

---

## Feature 4 — Diagram-card + pan-zoom (now an ENGINE feature)

Complex flowcharts are unreadable at page scale. The kit gives each diagram a
**scrollable inline card** (SVG at natural full size) plus a **⛶ fullscreen**
button → full-viewport overlay with mouse-wheel zoom, click-drag pan, double-click
reset, ESC to close.

**This is no longer a copy-paste pattern — it is baked into the engine** (promoted
2026-06-10). You author *only* the card; the kit supplies the styles, the overlay,
the dark-theme render, and the controller:

- **Assets:** `go/stddoc-lib/lib/mermaid.css` + `mermaid.js`, served at
  `/lib/mermaid.{css,js}` (a single traversal-safe passthrough over the lib dir —
  no per-asset allow-list).
- **Wiring:** `stddoc serve` detects `class="mermaid"` on a page and auto-adds the two
  CDNs (mermaid@11 + svg-pan-zoom) + the mermaid.css/js tags. Pages with no diagram
  get nothing (zero CDN cost). `stddoc publish` emits the card for a source.json
  `diagrams[].mermaid` node, then serve wires it.
- **Authoring idiom** (copy this — nothing else):

  ```html
  <div class="diagram-card">
    <div class="dc-top">
      <span class="dc-label">What this diagram shows</span>
      <button class="fz-btn">⛶ fullscreen</button>
    </div>
    <div class="mermaid-wrap"><div class="mermaid">flowchart TD
      A --> B</div></div>
  </div>
  ```

  No overlay markup, no `<script>`, no CSS — `mermaid.js` creates the `#fz-overlay`
  node itself and wires every `.diagram-card`.

### Served vs frozen — two artifacts from one source

A *served* doc renders client-side via the CDN (interactive). A *frozen* snapshot
must be self-contained (zero EXTERNAL refs — the freeze gate enforces it), and mermaid renders
via JS, so **`stddoc freeze` bakes each `.mermaid` block to static inline `<svg>` once**
(via the `mmdc` CLI; it refuses a diagram doc if no renderer is found rather than
emit a broken snapshot), strips the engine + CDN, and inlines only `svg-pan-zoom`
(~30 KB) + `frozen-panzoom.js` so fullscreen pan-zoom still works offline. The
snapshot is deterministic (rendered once, never re-executed). You don't manage any
of this — just author the card and freeze normally.

### Dependency (served mode; `stddoc serve` adds these for you)

```html
<!-- after the mermaid CDN -->
<script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
```

### CSS

```css
/* scrollable card — natural SVG size, no shrinking */
.diagram-card { position: relative; }
.mermaid-wrap  { overflow: auto; max-height: 420px;
                 scrollbar-color: #334155 #0d1526; scrollbar-width: thin; }
.mermaid svg   { max-width: none !important; display: block; }

/* fullscreen overlay */
#fz-overlay        { display:none; position:fixed; inset:0;
                     background:rgba(5,8,20,.96); z-index:9999; flex-direction:column; }
#fz-overlay.active { display:flex; }
#fz-toolbar        { display:flex; align-items:center; gap:.8rem; padding:.6rem 1rem;
                     border-bottom:1px solid #1e293b; flex-shrink:0; }
#fz-title          { flex:1; font-size:.62rem; text-transform:uppercase; color:#94a3b8; }
#fz-hint           { font-size:.6rem; color:#64748b; }
#fz-body           { flex:1; overflow:hidden; position:relative; }
#fz-body svg       { width:100% !important; height:100% !important; display:block; }
.fz-btn  { /* per-card button — style to taste */ }
.fz-ctrl { /* toolbar buttons — style to taste */ }
```

### HTML structure

Wrap each `.mermaid` div in a `.mermaid-wrap`, add a header row, and include one
shared overlay:

```html
<div class="diagram-card">
  <div class="dc-top">
    <span class="dc-label">Diagram title</span>
    <button class="fz-btn">⛶ fullscreen</button>
  </div>
  <div class="mermaid-wrap">
    <div class="mermaid">…mermaid source…</div>
  </div>
</div>

<!-- one overlay, shared by all diagrams -->
<div id="fz-overlay">
  <div id="fz-toolbar">
    <span id="fz-title"></span>
    <span id="fz-hint">scroll to zoom · drag to pan · double-click to reset</span>
    <button class="fz-ctrl" id="fz-zoomin">+ zoom</button>
    <button class="fz-ctrl" id="fz-zoomout">− zoom</button>
    <button class="fz-ctrl" id="fz-reset">reset</button>
    <button class="fz-ctrl" id="fz-close">✕ close</button>
  </div>
  <div id="fz-body"></div>
</div>
```

### JavaScript

```js
// startOnLoad:false so YOU control the render lifecycle (see gotchas below)
mermaid.initialize({ startOnLoad: false, /* …themeVariables from Bug 3… */ });

const overlay = document.getElementById('fz-overlay');
const fzBody  = document.getElementById('fz-body');
const fzTitle = document.getElementById('fz-title');
let pz = null;

function openFullscreen(label, svg) {
  const clone = svg.cloneNode(true);              // clone — never move the original
  clone.removeAttribute('width');                 // let svg-pan-zoom measure the element
  clone.removeAttribute('height');
  clone.style.width = clone.style.height = '100%';
  clone.style.maxWidth = 'none';
  fzBody.innerHTML = '';
  fzBody.appendChild(clone);
  fzTitle.textContent = label;
  overlay.classList.add('active');
  if (pz) { try { pz.destroy(); } catch (e) {} pz = null; }
  setTimeout(() => {                              // 80ms: needs one paint before measuring
    pz = svgPanZoom(clone, {
      zoomEnabled: true, controlIconsEnabled: false,
      fit: true, center: true,
      minZoom: 0.05, maxZoom: 30, zoomScaleSensitivity: 0.3,
      dblClickZoomEnabled: false,
    });
    clone.addEventListener('dblclick', () => { pz.resetZoom(); pz.center(); });
  }, 80);
}

function closeFullscreen() {
  overlay.classList.remove('active');
  if (pz) { try { pz.destroy(); } catch (e) {} pz = null; }
  fzBody.innerHTML = '';
}

document.getElementById('fz-close').addEventListener('click', closeFullscreen);
document.getElementById('fz-zoomin').addEventListener('click',  () => pz?.zoomIn());
document.getElementById('fz-zoomout').addEventListener('click', () => pz?.zoomOut());
document.getElementById('fz-reset').addEventListener('click',   () => { pz?.resetZoom(); pz?.center(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFullscreen(); });
overlay.addEventListener('click',    e => { if (e.target === overlay) closeFullscreen(); });

document.addEventListener('DOMContentLoaded', async () => {
  await mermaid.run({ querySelector: '.mermaid' });   // real promise to await
  document.querySelectorAll('.diagram-card').forEach(card => {
    const svg   = card.querySelector('svg');
    const label = card.querySelector('.dc-label')?.textContent ?? 'diagram';
    const btn   = card.querySelector('.fz-btn');
    if (svg && btn) btn.addEventListener('click', () => openFullscreen(label, svg));
  });
});
```

### Four gotchas that cost the team hours

- **`startOnLoad:false` + `await mermaid.run()`** — gives a real promise to await
  before wiring buttons. With `startOnLoad:true` there's no clean "render done"
  hook, so buttons wire before the `<svg>` exists.
- **Clone, don't move the SVG** — moving the original out of the card breaks the
  inline view. Always `cloneNode(true)`.
- **Strip `width`/`height` attrs on the clone** — mermaid sets explicit pixel
  dimensions; `svg-pan-zoom` reads them to size its viewport and gets confused
  when they disagree with the CSS `100%`. Remove both after cloning.
- **80ms delay before `svgPanZoom()`** — the clone needs one paint cycle after
  insertion before it can be measured. `setTimeout(…, 80)` works;
  `requestAnimationFrame` (~16ms) is not enough for layout.

---

## The rule

Living docs are dark. Mermaid assumes light. **Author the three fixes above, then
open the page in a browser to confirm zero bomb icons** —
these three all fail silently, so the only honest check is your own eyes on the
rendered page. The pre-ship checklist in `SKILL.md` (Move 3 — Serve) encodes this.
