/* style-lock — the voice a doc is PUBLISHED in holds, and a voice the reader
 * chooses LOCKS IN across every page.
 *
 * Loaded synchronously in <head> by serve's injector, on every page, so the
 * palette in style-lock.css swaps BEFORE first paint with zero flash.
 *
 * Precedence (highest first):
 *   1. the reader's own pick      — localStorage["stddoc-style"], ANY installed
 *                                   style name (set by the style_ab picker)
 *   2. the doc's published style  — <html data-style-default="…">, stamped by
 *                                   `stddoc publish` from --style/$STDDOC_STYLE
 *   3. "techno-dark"              — the house dialect, for a page that declares
 *                                   nothing (e.g. hand-authored HTML)
 *
 * WHY #2 EXISTS (the bug it fixes): this file used to hardcode both a
 * three-name whitelist AND a "techno-dark" default. Since a doc with no style
 * picker never has a stored pick, the default was the ONLY branch that ever ran
 * — so `serve` repainted EVERY page techno-dark, discarding whatever
 * `publish --style` had baked in. That silently broke bring-your-own client
 * styles (surge-light) *and* the two shipped non-dark styles (parchment-light,
 * playful). MEASURED before the fix: a doc published --style parchment-light
 * computed --bg #0a0e17 instead of #faf8f3.
 *
 * WHY THERE IS NO WHITELIST ANYMORE: style-lock.css only overrides a page when
 * the stamped name MATCHES one of its [data-style="…"] blocks. Stamping a name
 * it does not know contributes no rules at all, so the page's own baked :root
 * wins by default. That is exactly the behaviour a custom style needs — which
 * means honoring arbitrary names requires NO per-style CSS regeneration.
 *
 * KNOWN LIMIT (deliberate, not an oversight): localStorage is a single global
 * key, so a reader who has clicked a picker carries that voice into every
 * std-doc they open, including a client doc published in a custom style.
 * Scoping the pick per-doc needs a change to the style_ab picker as well and is
 * left as follow-up; rule #1 is kept as-is here so the style-interview demo's
 * "choose once, it follows you" behaviour is preserved byte-for-byte.
 */
(function () {
  var el = document.documentElement;
  var v = el.getAttribute("data-style-default") || "techno-dark";
  try {
    var stored = localStorage.getItem("stddoc-style");
    if (stored) v = stored;
  } catch (e) { /* private mode / no storage — keep the doc's published voice */ }
  el.setAttribute("data-style", v);
})();
