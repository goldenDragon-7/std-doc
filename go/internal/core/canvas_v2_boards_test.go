package core

import (
	"strings"
	"testing"

	"stddoc/internal/palette"
	"stddoc/internal/wire"
)

// canvas_v2_boards_test.go — S1 of the canvas v2 per-board design:
// board id assignment + the codraw: placeholder + data-canvas-board attribute.
// Purely additive (no golden page uses `canvas`).

// TestAssignCanvasBoardIDs_ZeroConfig covers "zero-config still works": two
// canvas blocks on the same node with no authored `id` get distinct,
// deterministic ids derived from the node slug + ordinal.
func TestAssignCanvasBoardIDs_ZeroConfig(t *testing.T) {
	doc := parseDoc(t, `{"title":"x","nodes":[{"slug":"arch","title":"A","blocks":[
		{"type":"canvas"},
		{"type":"canvas"}
	]}]}`)
	buildTree(doc)
	n := bySlug(doc, "arch")
	nblocks := adaptNode(n)
	assignCanvasBoardIDs(nblocks, str(n, "slug"))

	var ids []string
	for _, sb := range nblocks {
		if sb.Type != "canvas" {
			continue
		}
		id, _ := sb.Data.Get("id")
		ids = append(ids, id.(string))
	}
	if len(ids) != 2 {
		t.Fatalf("expected 2 canvas blocks, got %d", len(ids))
	}
	if ids[0] == ids[1] {
		t.Errorf("two zero-config canvas blocks must get DISTINCT ids, got %q twice", ids[0])
	}
	if !strings.HasPrefix(ids[0], "arch-canvas-") || !strings.HasPrefix(ids[1], "arch-canvas-") {
		t.Errorf("expected ids derived from the node slug, got %v", ids)
	}
}

// TestAssignCanvasBoardIDs_AuthoredIDWins covers the override path.
func TestAssignCanvasBoardIDs_AuthoredIDWins(t *testing.T) {
	doc := parseDoc(t, `{"title":"x","nodes":[{"slug":"arch","title":"A","blocks":[
		{"type":"canvas","id":"my-board"}
	]}]}`)
	buildTree(doc)
	n := bySlug(doc, "arch")
	nblocks := adaptNode(n)
	assignCanvasBoardIDs(nblocks, str(n, "slug"))
	for _, sb := range nblocks {
		if sb.Type != "canvas" {
			continue
		}
		id, _ := sb.Data.Get("id")
		if id.(string) != "my-board" {
			t.Errorf("authored id must win, got %q", id)
		}
	}
}

// TestCanvasRender_ZeroConfigPlaceholder covers the primitive side: with an id
// assigned (as the doc-tree renderer always does) and no authored `src`, the
// mount is NOT degraded — it emits the `codraw:<id>` placeholder for serve to
// rewrite, plus the `data-canvas-board` routing attribute.
func TestCanvasRender_ZeroConfigPlaceholder(t *testing.T) {
	reg, err := buildRegistry(loadLib(t))
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	node, err := wire.ParseOrderedJSON([]byte(`{"type":"canvas","id":"arch-canvas-0","label":"sketch"}`))
	if err != nil {
		t.Fatal(err)
	}
	ctx := makeCtx(wire.NewOrderedMap(), reg, palette.New(wire.NewOrderedMap()))
	out, err := reg.Render("canvas", node, ctx)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "canvas-degraded") {
		t.Errorf("a canvas with an assigned board id must NOT degrade even with no authored src\n got: %s", out)
	}
	if !strings.Contains(out, "data-canvas-board='arch-canvas-0'") {
		t.Errorf("expected the data-canvas-board routing attribute\n got: %s", out)
	}
	if !strings.Contains(out, "src='codraw:arch-canvas-0'") {
		t.Errorf("expected the codraw:<id> placeholder as both srcs\n got: %s", out)
	}
	if !strings.Contains(out, "data-canvas-src='codraw:arch-canvas-0'") {
		t.Errorf("expected the codraw:<id> placeholder on data-canvas-src too\n got: %s", out)
	}
}

// TestCanvasRender_ExplicitSrcStillGetsBoardID covers the back-compat path: an
// author-explicit `src` still wins as the mount's actual src, but the board id
// attribute is emitted too (S2's per-mount rewrite keys on the attribute, not
// on the src content, so serve can still route this mount to its own board).
func TestCanvasRender_ExplicitSrcStillGetsBoardID(t *testing.T) {
	reg, err := buildRegistry(loadLib(t))
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	node, err := wire.ParseOrderedJSON([]byte(`{"type":"canvas","id":"legacy","src":"http://localhost:9999/"}`))
	if err != nil {
		t.Fatal(err)
	}
	ctx := makeCtx(wire.NewOrderedMap(), reg, palette.New(wire.NewOrderedMap()))
	out, err := reg.Render("canvas", node, ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "data-canvas-board='legacy'") {
		t.Errorf("explicit-src mount must still carry data-canvas-board\n got: %s", out)
	}
	if !strings.Contains(out, "src='http://localhost:9999/'") {
		t.Errorf("explicit src must be honored as the mount's src\n got: %s", out)
	}
}

// TestAssignCanvasBoardIDs_NestedGetsID is the fourth caller of the shared
// walker (blocks.go's walkNestedBlocks doc comment): assignCanvasBoardIDs used
// to loop only the TOP-LEVEL stream, so a canvas COMPOSED inside a container
// (style_ab's voices[].preview[] here — real production composition, same as
// the lint recursion tests) never got a board id at all. Latent today (no
// shipped doc nests a canvas), live the moment one does.
func TestAssignCanvasBoardIDs_NestedGetsID(t *testing.T) {
	doc := parseDoc(t, `{"title":"x","nodes":[{"slug":"arch","title":"A","blocks":[
		{"type":"canvas"},
		`+styleABWrap(`{"type":"canvas"}`)+`
	]}]}`)
	buildTree(doc)
	n := bySlug(doc, "arch")
	nblocks := adaptNode(n)
	assignCanvasBoardIDs(nblocks, str(n, "slug"))

	// Reuse the shared walker itself (blocks.go) rather than a hand-rolled
	// traversal — it is already proven safe over real authored data. Mirror
	// collectBlockCSS's own guard: only walk AUTHORED block data
	// (Data["type"] == sb.Type). A synthetic node-level entry (badges,
	// children, sections, …) carries the WHOLE NODE as Data, which buildTree
	// has wired with a real *wire.OrderedMap back-pointer at "_parent" —
	// walking that generically is a self-reference hazard this test has no
	// business poking at; production code (assignCanvasBoardIDs itself) has
	// the identical guard for the identical reason.
	var ids []string
	for _, sb := range nblocks {
		if sb.Data == nil {
			continue
		}
		t2, ok := sb.Data.Get("type")
		if !ok {
			continue
		}
		if ts, _ := t2.(string); ts != sb.Type {
			continue
		}
		walkNestedBlocks(sb.Data, func(node *wire.OrderedMap, typ string) {
			if typ != "canvas" {
				return
			}
			id, ok := node.Get("id")
			if !ok {
				t.Fatalf("nested canvas block has no id at all: %#v", node)
			}
			ids = append(ids, id.(string))
		})
	}

	if len(ids) != 2 {
		t.Fatalf("expected 2 canvas blocks (1 top-level, 1 nested in style_ab), got %d: %v", len(ids), ids)
	}
	if ids[0] == ids[1] {
		t.Errorf("top-level and nested zero-config canvases must get DISTINCT ids, got %q twice", ids[0])
	}
}
