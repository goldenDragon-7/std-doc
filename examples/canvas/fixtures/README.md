# Canvas bound-text fixture — and the probe that actually discriminates

**Status: fixture committed, discriminator CORRECTED 2026-10-13, PR #9 NOT merged.**

> **A previous version of this file claimed, as PROVEN, that 0.17.6 "fails to
> resolve the hand-drawn font, so every canvas label renders in serif." That
> claim is FALSE and has been retracted — see "The retracted diagnosis" below.
> The *symptom* is real and PR #9 does fix it; the *mechanism* was wrong, and
> the probe built on it could not have detected the actual bug.**

## What this guards

On Excalidraw 0.17.6, **container-bound text renders in serif fallback** even
though the font is fully loaded and resolvable. Free-standing text in the
**same `fontFamily`, in the same scene**, renders correctly in the hand-drawn
face. 0.18.1 (PR #9) renders both correctly.

```
                        0.17.6 (public)        0.18.1 (PR #9)
FREE-standing text      hand-drawn  OK         hand-drawn  OK
CONTAINER-BOUND text    SERIF       BUG        hand-drawn  OK
```

So the discriminator is **BOUND vs FREE within one scene** — never font
availability, which is identical on both builds.

## The fixture

`bound-text-scene.json` — 39 elements: **18 container-bound text** labels
(3 font families × 3 container shapes × 2) plus **3 free-standing text**
controls *in the same three families*. That pairing is the whole probe: a free
control in a family no bound text uses would prove nothing. Regenerate with
`python3 make-fixture.py <out.json>`.

### Font codes — the trap that caused the false diagnosis

Excalidraw's enum: **1=Virgil (hand-drawn), 2=Helvetica, 3=Cascadia,
5=Excalifont, 6=Nunito.** 0.18 **renamed** the hand-drawn family
`Virgil` → `Excalifont`, and **codes 5 and 6 do not exist in 0.17.6.**

The earlier generator mapped `{"Virgil": 6}` — but 6 is *Nunito*. 15 of 27
labels therefore asked 0.17.6 for families it never shipped and painted serif
for a reason unrelated to the bug. **Only use families present in BOTH builds
for any cross-version comparison.** The fixture now uses 1/2/3 only.

## Install it into a served doc

```bash
stddoc publish examples/canvas/source.json /tmp/out
cp examples/canvas/fixtures/bound-text-scene.json \
   /tmp/out/feedback/canvas-canvas-canvas-0-scene.json
stddoc serve /tmp/out --port 34901
# board URL is in the SERVED canvas.html (codraw runs on its own ephemeral port):
curl -s localhost:34901/canvas.html | grep -o "http://localhost:[0-9]*/board/[^']*"
```

> **Load the board URL WITH A TRAILING SLASH** — `/board/canvas-canvas-0/`.
> Without it the page's `fetch("./scene")` resolves to `/board/scene`, which
> returns the HTML page; `r.json()` throws, the scene never applies, and you
> get a blank canvas plus a "offline — retrying" banner and `POST /board/scene
> → 404`. Three empty screenshots were spent on this. It is a real bug in its
> own right, filed separately.

## The probe — bound vs free, by rendered pixels

Font metrics cannot see this bug. You must compare what is PAINTED. Load the
board cold, let it settle, then compare a bound label's glyph shapes against
its free-standing twin in the same family — screenshot diff, or per-row ink
profile. The honest, cheap version is the screenshot: on a buggy build the
difference is obvious to the eye, which is how it was finally caught.

### MEASURED (2026-10-13, real Chrome 155 via browse-as-me, CDP :9222)

Same fixture, same cold path, both arms:

| signal | 0.17.6 (main `5dd3122`) | 0.18.1 (PR #9 `1c71b67`) |
|---|---|---|
| `document.fonts` Virgil | **loaded**, 303.20 ≠ serif 387.98 | **loaded**, 303.20 |
| `document.fonts` Cascadia | **loaded**, 351.56 | **loaded**, 351.56 |
| `Virgil.woff2` fetch | HTTP **200** | HTTP 200 |
| free-standing text | hand-drawn | hand-drawn |
| **container-bound text** | **SERIF** | **hand-drawn** |
| ink pixels | 167019 | 166725 |

Note the top four rows are **identical across the arms**. Any probe reading
only those is green on a broken build.

## The retracted diagnosis

The earlier claim — *"0.17.6 does not resolve the hand-drawn font; the defect
is live in public v0.10.0–v0.12.0; every canvas label renders serif"* — was
produced by two compounding mistakes:

1. **The rename.** The probe measured `Excalifont`, a family 0.18 introduced.
   `document.fonts.load('20px Excalifont')` returns **0 faces** on 0.17.6, so
   it measured == serif by definition. That is a tautology, not a failure.
   The same run's GREEN arm showed the mirror image — `Virgil` "unresolved" on
   0.18.1 — and that tell was not followed.
2. **The font-code map** above, which guaranteed most labels painted serif.

Under its real name, 0.17.6 loads and resolves the hand-drawn font fine
(**303.20 vs serif 387.98**). Do not restate the font-resolution claim, and do
not put it in release notes.

## Probes that CANNOT fail — do not rebuild these

Each produced a green that meant nothing:

1. **bound-text `width`/`height` via `getSceneElements()`** — 24/24 non-zero on
   BOTH builds. The renderer returns authored values (`196×25`) untouched. The
   PR's "58/58 bound-text elements get non-zero width/height" claim does **not**
   reproduce and should not be repeated as verified.
2. **Ink-pixel count** — 167019 vs 166725, ~0.2% apart. Serif still paints.
3. **`document.fonts` loaded-family set** — tracks the version bump, not the
   fix. A third arm (0.18.1, preload DELETED) also showed it present.
4. **`document.fonts.check('20px Excalifont')`** — returns `true` on BOTH,
   including where the family was never loaded.
5. **Text-advance width** (the retracted probe) — *identical on both builds*
   for every family that exists in both. It is a document-level font check
   wearing a rendering probe's clothes.

## What is PROVEN vs BELIEVED

- **PROVEN:** 0.17.6 renders container-bound text in serif while rendering
  free-standing text in the same family correctly; 0.18.1 renders both
  correctly. Screenshots + numbers, same fixture, both arms.
- **PROVEN:** 0.17.6 loads and resolves Virgil and Cascadia. The font-loading
  story is a dead end.
- **UNPROVEN:** that the font *preload* in `codraw/index.html` does anything.
  A third arm (preload removed, `refresh()` kept) was indistinguishable.
- **UNPROVEN:** the precise mechanism inside Excalidraw for the bound-text
  serif. We know the symptom and that the upgrade fixes it; we have not traced
  the cause in the bundle.
