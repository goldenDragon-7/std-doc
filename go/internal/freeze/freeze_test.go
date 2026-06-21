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
