/* std-doc mermaid kit — FROZEN-mode controller.
 *
 * NOT served at runtime. freeze.py inlines this file (preceded by an inlined
 * copy of vendor/svg-pan-zoom.min.js) into a frozen snapshot, AFTER it has baked
 * every .mermaid block into static inline <svg>. So there is no mermaid engine
 * here and no network: the SVG already exists, and this only re-adds the
 * fullscreen pan-zoom interaction on top of the baked SVG.
 *
 * Self-containment contract: this is the ONE inline <script> a frozen diagram doc
 * carries. It references nothing external (svg-pan-zoom is inlined right before
 * it). That is why freeze.py's leak gate forbids EXTERNAL refs, not <script>.
 */
(function () {
  "use strict";

  function ensureOverlay() {
    var o = document.getElementById("fz-overlay");
    if (o) return o;
    o = document.createElement("div");
    o.id = "fz-overlay";
    o.innerHTML =
      '<div id="fz-toolbar">' +
        '<span id="fz-title">diagram</span>' +
        '<span id="fz-hint">scroll to zoom &middot; drag to pan &middot; double-click to reset</span>' +
        '<button class="fz-ctrl" id="fz-zoomin">+ zoom</button>' +
        '<button class="fz-ctrl" id="fz-zoomout">&minus; zoom</button>' +
        '<button class="fz-ctrl" id="fz-reset">reset</button>' +
        '<button class="fz-ctrl" id="fz-close">&#x2715; close</button>' +
      '</div><div id="fz-body"></div>';
    document.body.appendChild(o);
    return o;
  }

  var pz = null;

  function openFullscreen(label, svg) {
    var overlay = document.getElementById("fz-overlay");
    var fzBody = document.getElementById("fz-body");
    var fzTitle = document.getElementById("fz-title");
    var clone = svg.cloneNode(true);
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.style.width = clone.style.height = "100%";
    clone.style.maxWidth = "none";
    fzBody.innerHTML = "";
    fzBody.appendChild(clone);
    if (fzTitle) fzTitle.textContent = label;
    overlay.classList.add("active");
    if (pz) { try { pz.destroy(); } catch (e) {} pz = null; }
    setTimeout(function () {
      pz = svgPanZoom(clone, {
        zoomEnabled: true, controlIconsEnabled: false,
        fit: true, center: true,
        minZoom: 0.05, maxZoom: 30, zoomScaleSensitivity: 0.3,
        dblClickZoomEnabled: false,
      });
      clone.addEventListener("dblclick", function () { pz.resetZoom(); pz.center(); });
    }, 80);
  }

  function closeFullscreen() {
    var overlay = document.getElementById("fz-overlay");
    overlay.classList.remove("active");
    if (pz) { try { pz.destroy(); } catch (e) {} pz = null; }
    document.getElementById("fz-body").innerHTML = "";
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (typeof svgPanZoom === "undefined") return;  // no lib inlined → static cards, no crash
    var overlay = ensureOverlay();
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeFullscreen(); });
    var byId = function (id) { return document.getElementById(id); };
    if (byId("fz-close")) byId("fz-close").addEventListener("click", closeFullscreen);
    if (byId("fz-zoomin")) byId("fz-zoomin").addEventListener("click", function () { if (pz) pz.zoomIn(); });
    if (byId("fz-zoomout")) byId("fz-zoomout").addEventListener("click", function () { if (pz) pz.zoomOut(); });
    if (byId("fz-reset")) byId("fz-reset").addEventListener("click", function () { if (pz) { pz.resetZoom(); pz.center(); } });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeFullscreen(); });

    document.querySelectorAll(".diagram-card").forEach(function (card) {
      var svg = card.querySelector("svg");
      var labelEl = card.querySelector(".dc-label");
      var label = labelEl ? labelEl.textContent : "diagram";
      var btn = card.querySelector(".fz-btn");
      if (svg && btn) btn.addEventListener("click", function () { openFullscreen(label, svg); });
    });
  });
})();
