/* std-doc mermaid kit — SERVED-mode controller.
 *
 * Served at /lib/mermaid.js. Depends on two CDN globals that inject.py adds
 * alongside this file: `mermaid` (mermaid@11) and `svgPanZoom` (svg-pan-zoom).
 *
 * Renders every .mermaid block with the dark theme (protocol/mermaid-gotchas.md
 * Bug 3), then wires each .diagram-card's ⛶ button to a fullscreen pan-zoom
 * overlay. The overlay node is created here if the page doesn't already have one,
 * so authoring is just  <div class="diagram-card">…<div class="mermaid">…</div></div>.
 *
 * Frozen docs DO NOT use this file — freeze.py bakes the SVG once and inlines
 * only svg-pan-zoom + frozen-panzoom.js (no mermaid engine). See that script.
 *
 * The four lifecycle gotchas (mermaid-gotchas.md Feature 4) are baked in:
 *   startOnLoad:false + await mermaid.run() · clone the SVG · strip width/height
 *   on the clone · 80ms paint delay before svgPanZoom().
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
    var clone = svg.cloneNode(true);          // clone — never move the original
    clone.removeAttribute("width");            // let svg-pan-zoom measure the element
    clone.removeAttribute("height");
    clone.style.width = clone.style.height = "100%";
    clone.style.maxWidth = "none";
    fzBody.innerHTML = "";
    fzBody.appendChild(clone);
    if (fzTitle) fzTitle.textContent = label;
    overlay.classList.add("active");
    if (pz) { try { pz.destroy(); } catch (e) {} pz = null; }
    setTimeout(function () {                    // 80ms: one paint before measuring
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

  function wireCards() {
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
  }

  if (typeof mermaid !== "undefined") {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      themeVariables: {
        darkMode: true,
        background: "#0d1526",
        primaryColor: "#1a2236",
        primaryTextColor: "#e2e8f0",
        primaryBorderColor: "#334155",
        lineColor: "#60a5fa",
        secondaryColor: "#1e293b",
        tertiaryColor: "#0a0e17",
        edgeLabelBackground: "#1a2236",
        clusterBkg: "#111827",
        clusterBorder: "#334155",
        titleColor: "#e2e8f0",
        nodeTextColor: "#e2e8f0",
      },
      flowchart: { curve: "basis", padding: 20 },
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (typeof mermaid !== "undefined") {
      mermaid.run({ querySelector: ".mermaid" }).then(wireCards).catch(function (e) {
        console.error("[std-doc mermaid] render failed:", e);
        wireCards();
      });
    } else {
      wireCards();
    }
  });
})();
