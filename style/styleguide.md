# The Styleguide — Dialect A + the Diagram Kit

*How to make a living document feel consistent and considered.*

The whole look comes from disciplined reuse of a fixed palette and six diagram
idioms. The skeleton (`skeleton.html`) ships every piece live — **copy from
there**; don't reinvent.

---

## 1. The palette — never invent a hue

Paste the `:root` block from the skeleton verbatim. Adding a novel colour is the
#1 tell of an off-style doc.

```css
--bg:#0a0e17; --surface:#111827; --surface2:#1a2236; --border:#1e293b;
--glow:#22d3ee;     /* cyan — primary accent, "the spine" */
--amber:#f59e0b;    /* section rails, headings */
--green:#10b981;    /* "we stand here" / built / good */
--red:#ef4444;      /* the gap / the problem / RED tests */
--purple:#a78bfa; --lavender:#c4b5fd;  /* questions, cruxes, "your call" */
--gold:#fbbf24;     /* the tender / relational lane / held-not-actioned */
--blue:#3b82f6;     /* a second "built" axis */
--text:#f1f5f9; --text-2:#cbd5e1; --text-dim:#94a3b8; --text-faint:#64748b;
--mono:'SF Mono','Cascadia Code','Fira Code',ui-monospace,monospace;
```

**Semantic colour grammar** — use colour to *mean* something, consistently:

| Hue | Means |
|-----|-------|
| 🟢 green | already built · we stand here · a passing test |
| 🔴 red | the gap · the missing axis · the root-cause column · a failing test |
| 🟡 gold | the tender / relational lane · held, not actioned |
| 🟣 lavender/purple | a *question* · a crux · "◀ YOUR CALL" · the delegatable lane |
| 🔵 cyan (glow) | the spine · the endpoint · the primary action |
| 🔷 blue | a second built-axis (sits beside green without clashing) |

---

## 2. Dialect A basics

- **Body font is `--mono`.** (Dialect A = Dense Report; use it for a proposal.)
- `max-width:1000px` content column, generous top padding, dark radial glow at top.
- `h2` are tiny uppercase amber labels with a leading rule (`::before`), not big titles.
- Prose caps at `~78ch`. Inline `code` is cyan on `--surface2`.
- A `.divider` is a left-bright cyan gradient hairline between sections.

---

## 3. The six diagram idioms

Each is one CSS block in the skeleton. Pick by what you're trying to *show*:

| Idiom | Class | Use it when you need to show… |
|-------|-------|-------------------------------|
| **Descent** | `.descent` / `.layer` / `.conscript` | a dependency stack, endpoint → ground; the spine of a by-descent doc |
| **Two-column compare** | `.svt` (`.bad` / `.good`) | a root cause: what's wrong vs what fixes it, side by side |
| **Spectrum** | `.spectrum` / `.spec-bar` | the *missing axis* — a gradient with 3 named states along it |
| **Decision matrix** | `.matrix` (`.v-a…d`) | **the heart** — rows × cols → a verdict; argue by the *shape* of the colour |
| **Three axes** | `.axes` (`.have` / `.have2` / `.missing`) | "two things we compute, one we never have" — the gap, in one row |
| **Seam / pipeline** | `.seam` / `.node` | a flow with a step that has *teeth* (a contract, a gate) |

### The two that carry the most weight

**The decision matrix** is the showpiece. Put your hardest design call here:
challenger/row meets incumbent/col, the cell is the verdict, four verdict colours
(`v-a` glow, `v-b` gold, `v-c` lavender, `v-d` faint). Then write one paragraph
that says **"read the shape, not the cells"** and name the *corner* each verdict
clusters in. The shape *is* the argument.

**The spectrum** names the one input the system has never had, as a single axis
with 3 stops. Add a `.cap` cross-linking it to a sibling doc — it makes a family
of docs feel like a family.

### When the diagram is genuinely a graph — reach for mermaid

The six idioms above are hand-built CSS for *arguing* a shape. When you instead
need a real **flowchart / sequence / state graph**, use the mermaid kit: a
`.diagram-card` wrapping a `.mermaid` source block (skeleton "Diagram 6"). You get
dark-theme rendering + fullscreen pan-zoom for free — author the card, nothing
else. `inject.py` wires it; `freeze.py` bakes it to static SVG for snapshots. The
authoring idiom + the dark-theme source-text traps live in
**`protocol/mermaid-gotchas.md`**. Prefer a hand idiom when you're arguing; reach
for mermaid when you're diagramming.

---

## 4. The mockup-the-endpoint rule

Layer 0 must show a **live render of the actual artifact**, not a description of
it. Build the endpoint as real HTML — the actual rows, the actual affordances,
the actual emotional centre. **Colour and absence are both tools**: an *absent*
button can carry an idea (a row that is "held, not actioned" and deliberately has
no action button) more sharply than any label.

---

## 5. Two small things that read as considered

- **A footline** in faint italic restating the thesis, closed with a single glyph.
- **`net-new` / `reuse` tags** on descent layers and a `.pill` column in the build
  table. Honesty rendered as colour.

---

## 6. Structured controls — ask a question the reader can *answer*, not type

A cruxes section ends in decisions. Most decisions are **multiple-choice** — so
let the reader *pick* instead of typing prose. Mark a question block with
`data-cf-control` and the library turns it into a real control (radio / checkbox /
select) with a "submit answer" button; the pick lands in the inbox as a
**structured** `control` comment the agent reads directly (see
`protocol/responding.md`). The styling ships in `feedback.css` (scoped to `.cf-q`)
and uses the palette automatically — **no new hue, nothing to copy.**

The whole authoring contract is the markup:

```html
<!-- RADIO — pick exactly one -->
<div class="cf-q" data-cf-control="radio"
     data-cf-id="deploy-first" data-cf-prompt="Which surface ships first?">
  <label><input type="radio" value="dashboard"> Dashboard</label>
  <label><input type="radio" value="api"> API</label>
  <label><input type="radio" value="cli"> CLI</label>
</div>

<!-- CHECKBOX — pick any number -->
<div class="cf-q" data-cf-control="checkbox"
     data-cf-id="ship-blockers" data-cf-prompt="What must land before we ship?">
  <label><input type="checkbox" value="auth"> Auth</label>
  <label><input type="checkbox" value="billing"> Billing</label>
  <label><input type="checkbox" value="docs"> Docs</label>
</div>

<!-- SELECT — one of many, compact -->
<div class="cf-q" data-cf-control="select"
     data-cf-id="rollout-ring" data-cf-prompt="Start the rollout on which ring?">
  <select>
    <option value="">— pick one —</option>
    <option value="canary">Canary</option>
    <option value="release">Release</option>
    <option value="fleet">Whole fleet</option>
  </select>
</div>
```

Three attributes carry everything:

| attribute | role |
|-----------|------|
| `data-cf-control` | `radio` · `checkbox` · `select` |
| `data-cf-id` | a **stable** id for the question — it becomes the answer's `field` **and** the agent's anchor, so make it meaningful (`deploy-first`, not `q1`) |
| `data-cf-prompt` | the question, rendered as the block's heading |

**When to reach for which:** `radio` for a true fork (the decision-matrix verdict
made answerable); `checkbox` for "tick all that apply" (scope, blockers);
`select` when the options are many or self-evident and you want it compact. Use a
control wherever you'd otherwise write *"let me know which option"* — that's the
tell. The reader can still add a free-text note alongside any pick.
