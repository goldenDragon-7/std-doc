/* style-lock — the voice chosen on page 3 (style-ab) LOCKS IN across every page.
 *
 * Page 3 tells the reader "choose once, generate free" and "this locks in." This is
 * the half that makes that true: every other page loads this synchronously in <head>,
 * reads the reader's pick from localStorage, and stamps <html data-style="..."> BEFORE
 * first paint — so the palette in style-lock.css swaps with zero flash. Default is the
 * house dialect, techno-dark, until a voice is chosen.
 */
(function () {
  var ALLOWED = { "techno-dark": 1, "parchment-light": 1, "playful": 1 };
  var v = "techno-dark";
  try {
    var stored = localStorage.getItem("stddoc-style");
    if (stored && ALLOWED[stored]) v = stored;
  } catch (e) { /* private mode / no storage — fall back to the default voice */ }
  document.documentElement.setAttribute("data-style", v);
})();
