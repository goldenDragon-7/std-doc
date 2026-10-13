package core

import (
	"stddoc/internal/palette"
	"stddoc/internal/registry"
	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// lint_reachability.go — the reachability diff.
//
// Field-name near-miss (fieldnames.go) and variant-selector (also
// fieldnames.go) both work by ANTICIPATING a specific mistake shape. Between
// them they catch three of the four orphan-authoring rows a container
// composition can produce:
//
//	band.content[]  -> callout with `bodyy`             caught: near-miss FIELD
//	band.contents[] (near-miss of "content")             caught: near-miss FIELD
//	                                                        (containers are template
//	                                                        primitives too, so their
//	                                                        OWN fields validate for
//	                                                        free — no per-container work)
//	band.items[]    (not a near-miss of anything)         NOT caught — no field is
//	                                                        close enough to warn on
//	band.content[] -> band.sections[] (wrong key, deep)   NOT caught — same shape
//
// A fourth check keyed on "items" or "sections" specifically would be an
// allowlist wearing a different hat — it would catch exactly the mistakes we
// happened to think of and nothing else, including nothing from any future
// container. The general fix needs no anticipation at all: A = every
// known-type block reachable in the AUTHORED DATA (walkNestedBlocks, Job 1),
// R = every block the REAL render pass actually dispatched to
// registry.Render (recorded by literally running it, not re-implementing its
// resolution rules). A \ R is "authored but never rendered" — it doesn't
// matter which field was misspelled or misnamed, only that the data exists
// and the renderer never touched it.

// recordingRegistry wraps the real registry, remembering (by pointer
// identity — blocks.go's own comment on assignCanvasBoardIDs already leans on
// "Data pointers alias the authored block") every block that actually got
// dispatched to Render, then delegates for real. It implements
// template.Registry so it can stand in for the real one inside a Ctx without
// changing a single line of the render/compose machinery it is watching.
type recordingRegistry struct {
	inner   template.Registry
	reached map[*wire.OrderedMap]bool
}

func (r *recordingRegistry) Render(typ string, block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	if block != nil {
		r.reached[block] = true
	}
	return r.inner.Render(typ, block, ctx)
}

// reachabilityOrphan is one authored-but-never-rendered finding.
type reachabilityOrphan struct {
	node *wire.OrderedMap
	typ  string
}

// reachabilityScan walks v (the same "what counts as a child" shape as
// walkNestedBlocks: every field, every array element, unbounded depth) and
// records every KNOWN-type object NOT present in reached. Deliberately its
// own traversal rather than walkNestedBlocks itself: it needs to STOP
// descending the moment it confirms an orphan (an unreached container's own
// descendants are equally unreached — reporting all of them would be a
// warning storm over one root cause, not new information), and it needs that
// decision to be independent of JSON key order (walkNestedBlocks's visit
// fires interleaved with key iteration, which is fine for CSS/field checks
// that don't prune, but wrong for a decision that must not depend on where
// "type" happens to sit among a block's keys). Reusing walkNestedBlocks here
// with a mutated, order-dependent pruning contract would be the same kind of
// drift Job 1 exists to prevent, just relocated — so this stays a sibling,
// not a patch to the shared walker.
func reachabilityScan(v any, reg *registry.Registry, reached map[*wire.OrderedMap]bool, out *[]reachabilityOrphan) {
	switch x := v.(type) {
	case *wire.OrderedMap:
		if tv, ok := x.Get("type"); ok {
			if ts, ok2 := tv.(string); ok2 && ts != "" && reg.Has(ts) {
				if !reached[x] {
					*out = append(*out, reachabilityOrphan{node: x, typ: ts})
					return // the rest of this subtree is fallout, not a new finding
				}
			}
		}
		for _, k := range x.Keys() {
			val, _ := x.Get(k)
			reachabilityScan(val, reg, reached, out)
		}
	case []any:
		for _, e := range x {
			reachabilityScan(e, reg, reached, out)
		}
	}
}

// lintReachability actually RENDERS b (output discarded — Lint's contract is
// "never changes output", and it doesn't: nothing here is written anywhere)
// through the real registry, wrapped to record every block it touches, then
// diffs that against every known-type block reachable in b's own data. This
// is the one check in this file that runs the real renderer rather than
// re-deriving its rules, on purpose: re-implementing "which field does each
// template's compose op read" would drift from the template data the moment
// someone edits templates.json, exactly the class of bug this whole worktree
// exists to close.
//
// Recovers from a panic in the primitive it renders (a hand-coded primitive
// reached for the first time with genuinely malformed data could, in
// principle, panic on an unchecked assertion) and gives up on THIS block's
// reachability finding rather than let lint — which promises never to
// crash — go down with it. Every other check on this and every other block
// still runs.
func lintReachability(b *wire.OrderedMap, typ, slug string, reg *registry.Registry, pal *palette.Palette) (out []registry.Finding) {
	defer func() {
		if recover() != nil {
			out = nil
		}
	}()

	reached := map[*wire.OrderedMap]bool{}
	wrapped := &recordingRegistry{inner: reg, reached: reached}
	if pal == nil {
		pal = palette.New(nil)
	}
	ctx := &template.Ctx{
		Registry: wrapped,
		// A nil RenderEvidence would panic if ever reached (the "evidence" type
		// calls it directly, unguarded); it is not reachable from authored
		// blocks[] composition today, but a no-op stand-in costs nothing and
		// keeps this probe inert no matter what a future primitive composes.
		RenderEvidence: func(*wire.OrderedMap) string { return "" },
		// The doc's real palette. A container that pairs tone/kind
		// (palette_var) with composed content — band is the first to do
		// both — would otherwise hit "palette_var requires a palette in
		// ctx" partway through its own template and abort BEFORE reaching
		// the each/compose that walks its children, which reads to
		// reachabilityScan as "authored but never rendered". See lintDoc's
		// comment on pal for why an empty palette (the nil fallback above)
		// is still the right default: it stays LOUD for an undeclared key,
		// it just no longer confuses "undeclared" with "unreachable".
		Palette: pal,
	}
	wrapped.Render(typ, b, ctx)

	var orphans []reachabilityOrphan
	for _, k := range b.Keys() {
		if k == "type" {
			continue
		}
		val, _ := b.Get(k)
		reachabilityScan(val, reg, reached, &orphans)
	}
	for _, o := range orphans {
		out = append(out, warnf(slug,
			"%s: authored '%s' block was never rendered — it exists in the data but the field it's under isn't one '%s' composes (a near-miss like a wrong container key silently drops everything under it)",
			typ, o.typ, typ))
	}
	return out
}
