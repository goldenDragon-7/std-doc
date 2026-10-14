package core

// capability_test.go — the SELF-TESTING HARNESS.
//
// An audit MEASURES by reading; this harness MEASURES by running. Every
// capability std-doc documents about itself is exercised here against the real
// renderer/registry, so a future regression (a dropped primitive, an unwired
// validator, a doc that drifts from the code) fails `go test` instead of
// waiting for a human to re-read. This is the executable form of the
// doc-truth + port-parity audits done on 2026-06-18.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stddoc/internal/wire"
)

// loadLib + repoRoot are shared helpers from lint_test.go / conformance_test.go.

// CAPABILITY: lint exists, runs, and our own canonical self-doc stays clean.
// (Dogfood — if a self-doc edit introduces a structural error, this goes red.)
func TestCapability_OwnDocLintsClean(t *testing.T) {
	lib := loadLib(t)
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "self-doc", "source.json"))
	if err != nil {
		t.Fatalf("read self-doc: %v", err)
	}
	doc, err := wire.ParseOrderedJSON(raw)
	if err != nil {
		t.Fatalf("parse self-doc: %v", err)
	}
	fs, err := Lint(doc, lib)
	if err != nil {
		t.Fatalf("Lint: %v", err)
	}
	if n := CountErrors(fs); n != 0 {
		t.Fatalf("self-doc/source.json must lint clean, got %d error(s): %v", n, fs)
	}
}

// CAPABILITY: a `layout: page` doc lints (and thus publishes) cleanly — it is
// validated as a page of blocks, NOT wrongly held to the doc-tree `nodes`
// requirement. Guards the fix for the page-atoms-demo trap (a valid page doc
// that `stddoc publish` used to abort on). Uses the real shipped example so a
// regression in either the lint branch or the example goes red.
func TestCapability_LayoutPageDocLintsClean(t *testing.T) {
	lib := loadLib(t)
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "examples", "page-atoms-demo", "source.json"))
	if err != nil {
		t.Fatalf("read page-atoms-demo: %v", err)
	}
	doc, err := wire.ParseOrderedJSON(raw)
	if err != nil {
		t.Fatalf("parse page-atoms-demo: %v", err)
	}
	fs, err := Lint(doc, lib)
	if err != nil {
		t.Fatalf("Lint: %v", err)
	}
	if n := CountErrors(fs); n != 0 {
		t.Fatalf("a layout:page doc must lint clean (no false 'missing nodes'), got %d error(s): %v", n, fs)
	}
}

// CAPABILITY: lint FAILS LOUD (PRD P0) — a malformed doc yields >=1 error.
// This guards the lint/validate capability the Python→Go port had dropped.
func TestCapability_LintFailsLoud(t *testing.T) {
	lib := loadLib(t)
	// missing required keys (title, nodes) — the minimal malformed doc.
	doc, err := wire.ParseOrderedJSON([]byte(`{"meta":{"title":"x"},"docs":[{"slug":"a"}]}`))
	if err != nil {
		t.Fatalf("parse malformed: %v", err)
	}
	fs, err := Lint(doc, lib)
	if err != nil {
		t.Fatalf("Lint: %v", err)
	}
	if CountErrors(fs) == 0 {
		t.Fatal("a malformed doc must produce >=1 lint error (fail-loud); got none")
	}
}

// CAPABILITY: every core primitive the port-parity audit confirmed PORTED is
// actually registered. A dropped primitive (the exact fear that started the
// audit) fails here.
func TestCapability_CorePrimitivesPresent(t *testing.T) {
	reg, err := buildRegistry(loadLib(t))
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	// the data-template + core-block primitives the matrix verified present
	want := []string{
		"evidence", "sections", "statetrack", "swimlane", "tree",
		"call", "mermaid", "gradient-band", "decisionmatrix", "spectrum",
	}
	for _, typ := range want {
		if !reg.Has(typ) {
			t.Errorf("primitive %q must be registered (registry.Has) — possible port regression", typ)
		}
	}
}

// CAPABILITY: mermaid_fix neutralizes the dark-theme "bomb icon" triggers.
// Guards the transform set the port had dropped (live Covenant-II regression).
func TestCapability_MermaidFixNeutralizesDarkThemeBombs(t *testing.T) {
	in := "flowchart TD\n  subgraph G[\"🚀 launch\"]\n    A -->|line one\\nline two| B\n  end"
	out := mermaidFix(in)
	if strings.Contains(out, "🚀") {
		t.Errorf("mermaidFix must strip emoji from subgraph labels; still present in:\n%s", out)
	}
	if strings.Contains(out, `\n`) {
		t.Errorf("mermaidFix must replace literal \\n in edge labels; still present in:\n%s", out)
	}
}

// CAPABILITY (doc-truth, executable): the canonical docs must not assert
// surfaces the binary no longer has. This is the doc-truth auditor as a GATE —
// it would have caught every doc bug found on 2026-06-18.
func TestCapability_DocsDoNotLie(t *testing.T) {
	root := repoRoot(t)
	docs := []string{"SKILL.md", "STANDALONE.md", "README.md", "self-doc/source.json"}
	// (string, mustBeAbsent, why)
	banned := []struct{ s, why string }{
		{"5050", "stale port floor — the real floor is 33333 (serve.MinPort)"},
		{"shelve", "retired lifecycle verb — superseded by roll/graduate"},
		{"seal →", "retired lifecycle transition (seal → archive)"},
		{"600s", "inverted idle-timeout claim — Go default is 0 (never idles)"},
		{"SecurityGateError", "Python-era gate type — Go gate exports Scan/Enforce/HasMermaid only (Enforce returns a plain fmt.Errorf)"},
		{"enforce_blocks", "Python-era gate function — absent from the Go gate (two-pass Scan + Enforce)"},
		{"EXTERNAL_REF", "Python-era gate regex name — the Go gate uses reDep + reInlineHTTP (two-pass Scan)"},
	}
	for _, d := range docs {
		raw, err := os.ReadFile(filepath.Join(root, d))
		if err != nil {
			t.Fatalf("read %s: %v", d, err)
		}
		body := string(raw)
		for _, b := range banned {
			if strings.Contains(body, b.s) {
				t.Errorf("%s contains banned string %q (%s)", d, b.s, b.why)
			}
		}
		// the floor MUST be documented in the user-facing docs
		if d != "self-doc/source.json" && !strings.Contains(body, "33333") {
			t.Errorf("%s should document the 33333 port floor", d)
		}
	}
}

// CAPABILITY: the codraw canvas runtime is fully self-contained offline — a live
// canvas must reach ZERO third parties. Guards the 404-class regression found on
// 2026-08-14 (EXCALIDRAW_ASSET_PATH pointed local, but fonts/chunks weren't
// vendored, so they silently 404'd) — and, since the 0.18 ESM upgrade, ALSO
// guards the newer trap: @excalidraw/excalidraw's own asset loader always
// appends a real esm.sh CDN URL as a final fallback candidate (verified by
// reading the bundled source), so a wrong/missing local path silently
// degrades to a network fetch instead of failing loud. MEASURED offline
// (2026-09-06): with EXCALIDRAW_ASSET_PATH set to the vendored dir below,
// devtools network capture showed 100% localhost font requests, zero CDN.
func TestCapability_CodrawVendoredOffline(t *testing.T) {
	codraw := filepath.Join(repoRoot(t), "go", "stddoc-lib", "lib", "codraw")

	// The runtime must resolve assets LOCALLY, never a third-party CDN.
	idx, err := os.ReadFile(filepath.Join(codraw, "index.html"))
	if err != nil {
		t.Fatalf("read codraw/index.html: %v", err)
	}
	if !strings.Contains(string(idx), `EXCALIDRAW_ASSET_PATH = "/vendor/excalidraw-0.18.1/"`) {
		t.Error("codraw must set EXCALIDRAW_ASSET_PATH to a local /vendor/excalidraw-0.18.1/ path (not a CDN)")
	}

	// The one vendored ESM bundle (esbuild-in-Go, `stddoc bundle-codraw`) the
	// loader depends on — replaces the three 0.17.6 UMD files (react.js,
	// react-dom.js, excalidraw.js) that 0.18 no longer ships (UMD dropped).
	if _, err := os.Stat(filepath.Join(codraw, "vendor", "codraw-bundle.js")); err != nil {
		t.Errorf("missing vendored vendor/codraw-bundle.js — live canvas would have nothing to load: %v", err)
	}

	// The runtime assets Excalidraw loads from EXCALIDRAW_ASSET_PATH: the
	// fonts codraw's own preload block (index.html) requests by name, plus
	// the stylesheet the 0.18 ESM build no longer self-injects (that was a
	// UMD-era behavior; the ESM package expects the consumer to link it).
	assets := filepath.Join(codraw, "vendor", "excalidraw-0.18.1")
	if _, err := os.Stat(filepath.Join(assets, "index.css")); err != nil {
		t.Errorf("missing vendored index.css — 0.18's ESM build does not self-inject styles: %v", err)
	}
	for _, font := range []string{
		filepath.Join("fonts", "Virgil", "Virgil-Regular.woff2"),
		filepath.Join("fonts", "Cascadia", "CascadiaCode-Regular.woff2"),
		filepath.Join("fonts", "Assistant", "Assistant-Regular.woff2"),
		filepath.Join("fonts", "Assistant", "Assistant-Medium.woff2"),
		filepath.Join("fonts", "Assistant", "Assistant-SemiBold.woff2"),
		filepath.Join("fonts", "Assistant", "Assistant-Bold.woff2"),
	} {
		if _, err := os.Stat(filepath.Join(assets, font)); err != nil {
			t.Errorf("missing vendored font %s — hand-drawn text would silently fall back to the esm.sh CDN: %v", font, err)
		}
	}
}

// CAPABILITY: the codraw client's scene/feedback calls are RELATIVE (Seam 4,
// the canvas v2 per-board design — v2 per-canvas boards). An
// absolute "/scene" would always hit the server ROOT (the v1 default board)
// no matter which board's index.html served it; "./scene" resolves against
// the document's own URL, so serving the SAME shared client under
// "/board/<id>/" auto-scopes every request back to that board with ZERO
// client-side knowledge of ids — the whole point of routing by URL path
// instead of by, say, a query param the client would have to thread through.
// EXCALIDRAW_ASSET_PATH stays absolute ("/vendor/") on purpose — the vendored
// runtime IS shared across every board (one copy, PRD Seam 3 "What does NOT
// change" isn't the right section, but the design doc's seam 3 note: "Static
// assets…stay shared — one copy, served at the root").
func TestCapability_CodrawSceneFeedbackAreRelative(t *testing.T) {
	codraw := filepath.Join(repoRoot(t), "go", "stddoc-lib", "lib", "codraw")
	idx, err := os.ReadFile(filepath.Join(codraw, "index.html"))
	if err != nil {
		t.Fatalf("read codraw/index.html: %v", err)
	}
	body := string(idx)
	for _, absolute := range []string{`fetch("/scene"`, `fetch("/feedback"`} {
		if strings.Contains(body, absolute) {
			t.Errorf("codraw client must NOT fetch an ABSOLUTE %q — that always hits the default board regardless of which board's index.html served it; use a relative \"./...\" path instead", absolute)
		}
	}
	for _, relative := range []string{`fetch("./scene"`, `fetch("./feedback"`} {
		if !strings.Contains(body, relative) {
			t.Errorf("codraw client must fetch the relative %q so /board/<id>/ auto-scopes it", relative)
		}
	}
	// The shared vendored runtime stays absolute — it's the SAME copy for
	// every board, not board-scoped.
	if !strings.Contains(body, `EXCALIDRAW_ASSET_PATH = "/vendor/excalidraw-0.18.1/"`) {
		t.Error("EXCALIDRAW_ASSET_PATH must stay the absolute shared /vendor/excalidraw-0.18.1/ path")
	}
}

// CAPABILITY: the doc-tree schema documents the three node containers, and the
// linter enforces exactly what the schema promises.
//
// The container rule (sections[]=prose, blocks[]=primitives, children[]=nodes)
// was UNDOCUMENTED until 2026-08-22 and cost a full morning: primitives authored
// into sections[] rendered as nothing, silently. Documenting it is only half a
// fix — a doc can drift from the code. This binds the two together: if the
// schema stops describing a container, or the linter stops enforcing it, this
// goes red.
func TestCapability_ContainerRuleDocumentedAndEnforced(t *testing.T) {
	schema, err := os.ReadFile(filepath.Join(repoRoot(t), "protocol", "doctree-schema.md"))
	if err != nil {
		t.Fatalf("read doctree-schema.md: %v", err)
	}
	doc := string(schema)
	for _, container := range []string{"sections[]", "blocks[]", "children[]"} {
		if !strings.Contains(doc, container) {
			t.Errorf("doctree-schema.md must document the %s container — an undocumented container is how the silent-drop class happened", container)
		}
	}

	// …and the promise is kept by the code, not just the prose.
	for _, tc := range []struct{ name, src, want string }{
		{"primitive in sections[]",
			`{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"type":"table","name":"N","columns":["c"],"groups":[]}]}]}`,
			"authored in sections[]"},
		{"primitive in children[]",
			`{"title":"T","nodes":[{"slug":"a","title":"A","children":[{"type":"table","name":"N","columns":["c"],"groups":[]}]}]}`,
			"authored in children[]"},
		{"mistyped container",
			`{"title":"T","nodes":[{"slug":"a","title":"A","block":[]}]}`,
			"did you mean 'blocks'"},
	} {
		if f := findingBy(lintSrc(t, tc.src), tc.want); f == nil || f.Level != "error" {
			t.Errorf("%s: schema documents this as wrong but the linter does not enforce it (want error containing %q)", tc.name, tc.want)
		}
	}
}
