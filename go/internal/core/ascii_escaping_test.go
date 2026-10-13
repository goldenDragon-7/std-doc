package core

// ascii_escaping_test.go — replaces a warning with a proof.
//
// The linter used to emit "raw '<'/'>' in ascii diagram text" on every ascii
// diagram containing angle brackets. Verified 2026-08-22 on the real output:
// ascii is escaped on BOTH the published and frozen paths, so the rule fired on
// correct content and named no action. It was removed — and replaced by this,
// which asserts the property the warning was gesturing at.
//
// A warning that fires on correct content is worse than no warning, because it
// teaches readers to ignore the ones that matter.

import (
	"strings"
	"testing"

	"stddoc/internal/palette"
	"stddoc/internal/wire"
)

func TestAsciiAngleBracketsAreEscaped(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	node, err := wire.ParseOrderedJSON([]byte(
		`{"diagrams":[{"caption":"c","ascii":"setup.sh <your-doc-dir> [port]\n  a -> b <script>x</script>"}]}`))
	if err != nil {
		t.Fatalf("parse node: %v", err)
	}
	ctx := makeCtx(wire.NewOrderedMap(), reg, palette.New(wire.NewOrderedMap()))
	out, err := reg.Render("diagrams", node, ctx)
	if err != nil {
		t.Fatalf("render diagrams: %v", err)
	}

	if !strings.Contains(out, "&lt;your-doc-dir&gt;") {
		t.Fatalf("expected angle brackets escaped, got: %s", out)
	}
	// The load-bearing half: authored markup must never become live markup.
	if strings.Contains(out, "<script>") {
		t.Fatalf("ascii text was emitted as live markup — escaping is broken: %s", out)
	}
}
