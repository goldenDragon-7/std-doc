package core

import (
	"path/filepath"
	"strings"
	"testing"

	"stddoc/internal/library"
	"stddoc/internal/registry"
	"stddoc/internal/wire"
)

// loadLib loads the default library for lint tests.
func loadLib(t *testing.T) *library.Library {
	t.Helper()
	root := repoRoot(t)
	lib, err := library.Load(filepath.Join(root, "go", "stddoc-lib"))
	if err != nil {
		t.Fatalf("load library: %v", err)
	}
	return lib
}

// parseDoc parses a JSON literal into the ordered doc-tree.
func parseDoc(t *testing.T, src string) *wire.OrderedMap {
	t.Helper()
	doc, err := wire.ParseOrderedJSON([]byte(src))
	if err != nil {
		t.Fatalf("parse doc: %v", err)
	}
	return doc
}

// findingsBy returns the first finding whose message contains substr, or nil.
func findingBy(fs []registry.Finding, substr string) *registry.Finding {
	for i := range fs {
		if strings.Contains(fs[i].Message, substr) {
			return &fs[i]
		}
	}
	return nil
}

func lintSrc(t *testing.T, src string) []registry.Finding {
	t.Helper()
	fs, err := Lint(parseDoc(t, src), loadLib(t))
	if err != nil {
		t.Fatalf("Lint: %v", err)
	}
	return fs
}

func TestLintClean(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A"},{"slug":"b","title":"B","parent":"a"}]}`
	fs := lintSrc(t, src)
	if len(fs) != 0 {
		t.Fatalf("expected clean, got %v", fs)
	}
}

func TestLintMissingTitle(t *testing.T) {
	fs := lintSrc(t, `{"nodes":[{"slug":"a","title":"A"}]}`)
	f := findingBy(fs, "missing required key: title")
	if f == nil || f.Level != "error" {
		t.Fatalf("expected error for missing title, got %v", fs)
	}
}

func TestLintMissingNodes(t *testing.T) {
	fs := lintSrc(t, `{"title":"T"}`)
	if findingBy(fs, "missing required key: nodes") == nil {
		t.Fatalf("expected error for missing nodes, got %v", fs)
	}
}

func TestLintNodeMissingTitleAndSlug(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"ok","title":"OK"},{"slug":"x"}]}`)
	if findingBy(fs, "missing required key: title") == nil {
		t.Fatalf("expected node missing title, got %v", fs)
	}
}

func TestLintBadSlugShape(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"Bad_Slug","title":"X"}]}`)
	if findingBy(fs, "kebab-case") == nil {
		t.Fatalf("expected kebab-case error, got %v", fs)
	}
}

func TestLintDuplicateSlug(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"a","title":"A"},{"slug":"a","title":"A2"}]}`)
	if findingBy(fs, "duplicate slug") == nil {
		t.Fatalf("expected duplicate slug error, got %v", fs)
	}
}

func TestLintUnresolvedParent(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"a","title":"A","parent":"ghost"}]}`)
	if findingBy(fs, "does not resolve") == nil {
		t.Fatalf("expected unresolved parent error, got %v", fs)
	}
}

func TestLintSelfParent(t *testing.T) {
	fs := lintSrc(t, `{"title":"T","nodes":[{"slug":"a","title":"A","parent":"a"}]}`)
	if findingBy(fs, "own parent") == nil {
		t.Fatalf("expected self-parent error, got %v", fs)
	}
}

func TestLintCycle(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","parent":"b"},{"slug":"b","title":"B","parent":"a"}]}`
	fs := lintSrc(t, src)
	if findingBy(fs, "cycle") == nil {
		t.Fatalf("expected cycle error, got %v", fs)
	}
}

func TestLintCitationMissingPath(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"items":[{"citations":[{"evidence":"MEASURED"}]}]}]}]}`
	fs := lintSrc(t, src)
	if findingBy(fs, "citation missing required 'path'") == nil {
		t.Fatalf("expected citation missing path, got %v", fs)
	}
}

func TestLintCitationBadEvidence(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","sections":[{"items":[{"citations":[{"path":"x.go","evidence":"BOGUS"}]}]}]}]}`
	fs := lintSrc(t, src)
	if findingBy(fs, "not one of") == nil {
		t.Fatalf("expected bad evidence error, got %v", fs)
	}
}

func TestLintAsciiTooWide(t *testing.T) {
	wide := strings.Repeat("x", 90)
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","diagrams":[{"ascii":"` + wide + `"}]}]}`
	fs := lintSrc(t, src)
	f := findingBy(fs, "ascii diagram line")
	if f == nil || f.Level != "warn" {
		t.Fatalf("expected ascii width warn, got %v", fs)
	}
}

func TestLintUnknownBlockType(t *testing.T) {
	src := `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[{"type":"no-such-primitive"}]}]}`
	fs := lintSrc(t, src)
	f := findingBy(fs, "unknown block type")
	if f == nil || f.Level != "error" {
		t.Fatalf("expected unknown block type error, got %v", fs)
	}
}

// TestLintPerPrimitiveValidate proves the per-primitive Validate dispatch is wired:
// a registered validator's findings surface through Lint.
func TestLintPerPrimitiveValidate(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	reg.RegisterValidator("prose", func(b *wire.OrderedMap) []registry.Finding {
		if str(b, "body") == "" {
			return []registry.Finding{{Level: "error", Slug: "", Message: "prose: empty body"}}
		}
		return nil
	})
	doc := parseDoc(t, `{"title":"T","nodes":[{"slug":"a","title":"A","blocks":[{"type":"prose"}]}]}`)
	fs := lintDoc(doc, reg)
	if findingBy(fs, "prose: empty body") == nil {
		t.Fatalf("expected per-primitive validate finding, got %v", fs)
	}
}

func TestErrorCount(t *testing.T) {
	fs := []registry.Finding{{Level: "error"}, {Level: "warn"}, {Level: "error"}}
	if n := CountErrors(fs); n != 2 {
		t.Fatalf("expected 2 errors, got %d", n)
	}
}
