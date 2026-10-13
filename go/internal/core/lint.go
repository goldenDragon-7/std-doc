package core

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"stddoc/internal/library"
	"stddoc/internal/palette"
	"stddoc/internal/registry"
	"stddoc/internal/wire"
)

// lint.go — the Go port of engine/scripts/lint.py (PRD P0 "fail loud").
//
// A bad source.json used to fail late or silently (the Python lint, lost in the
// port). This validates the doc-tree up front and fails LOUD, every finding
// scoped to the offending slug, so publish aborts on any ERROR rather than
// rendering a broken page. Two layers:
//
//   - structural checks (this file) — required keys, slug shape/uniqueness,
//     parent/children topology + cycles, citation shape, ascii diagram width;
//     a faithful port of lint.py.
//   - per-primitive Validate dispatch — each installed primitive may register an
//     OPTIONAL validator (registry.RegisterValidator); the lint assembles every
//     installed primitive's check, so it can never drift from the renderer. An
//     unknown authored block type is itself a lint error, mirroring the
//     render-time error boundary.

var slugShapeRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// evidenceBuiltin is the kingdom's canonical evidence vocabulary (the ANSI
// Knight's five levels), a SUPERSET of the original three so every existing doc
// stays valid. A doc that grades on its own scale declares `evidence_levels`
// (a list of strings) at the root; effectiveEvidence merges the two. This
// closes the 2026-08-12 CARRIED-4 finding: the set was locked at three with no
// way to discover or extend it except by failing.
var evidenceBuiltin = map[string]bool{
	"MEASURED": true, "CALCULATED": true, "CITED": true,
	"INFERRED": true, "ESTIMATED": true, "SPECULATIVE": true,
}

// effectiveEvidence returns the accepted evidence set (built-in ∪ doc-declared)
// and its sorted labels for a self-documenting error message.
func effectiveEvidence(doc *wire.OrderedMap) (map[string]bool, []string) {
	ok := map[string]bool{}
	for k := range evidenceBuiltin {
		ok[k] = true
	}
	for _, lv := range list(doc, "evidence_levels") {
		if s, is := lv.(string); is && s != "" {
			ok[s] = true
		}
	}
	labels := make([]string, 0, len(ok))
	for k := range ok {
		labels = append(labels, k)
	}
	sort.Strings(labels)
	return ok, labels
}

const asciiMax = 78

func errf(slug, format string, a ...any) registry.Finding {
	return registry.Finding{Level: "error", Slug: slug, Message: fmt.Sprintf(format, a...)}
}

func warnf(slug, format string, a ...any) registry.Finding {
	return registry.Finding{Level: "warn", Slug: slug, Message: fmt.Sprintf(format, a...)}
}

// Lint loads the primitive registry from lib and validates a parsed doc-tree,
// returning every finding (possibly none). It NEVER renders — lint must not
// change output — and never mutates the doc.
func Lint(doc *wire.OrderedMap, lib *library.Library) ([]registry.Finding, error) {
	// A `layout: page` doc is composed of page atoms (lanes/swim/track/heading/…)
	// and publishes through the page registry (core.RenderStandalone). Lint it
	// with that same registry, or its page-atom blocks read as "unknown type".
	build := buildRegistry
	if doc != nil && str(doc, "layout") == "page" {
		build = buildPageRegistry
	}
	reg, err := build(lib)
	if err != nil {
		return nil, err
	}
	return lintDoc(doc, reg), nil
}

// CountErrors returns the number of error-level findings.
func CountErrors(fs []registry.Finding) int {
	n := 0
	for _, f := range fs {
		if f.Level == "error" {
			n++
		}
	}
	return n
}

// CountWarns returns the number of warn-level findings.
func CountWarns(fs []registry.Finding) int {
	n := 0
	for _, f := range fs {
		if f.Level == "warn" {
			n++
		}
	}
	return n
}

// lintDoc is the registry-injected core of Lint (testable without a library).
func lintDoc(doc *wire.OrderedMap, reg *registry.Registry) []registry.Finding {
	var out []registry.Finding

	// ---- top-level shape -------------------------------------------------
	if doc == nil {
		return []registry.Finding{errf("<doc>", "source is not a JSON object")}
	}
	// The doc's real palette (not nil, not an empty stand-in): lintReachability
	// actually RENDERS a block to see what it composes, and a container that
	// pairs `tone`/`kind` (palette_var) with composed content — band is the
	// first primitive to do both — would hit "palette_var requires a palette
	// in ctx" partway through its own template and abort BEFORE reaching the
	// `each`/`compose` that walks its children, which reachabilityScan then
	// misreads as "authored but never rendered". An empty palette would still
	// error loudly for any key not declared in it (by design — undeclared
	// palette keys are a real authoring mistake), so only the doc's own
	// palette avoids both the false positive and the missed real one.
	palMap, _ := get(doc, "palette").(*wire.OrderedMap)
	pal := palette.New(palMap)
	// the accepted evidence vocabulary for this doc (canonical five ∪ any the
	// doc declares in evidence_levels), computed once and used by the citation
	// check below — CARRIED-4.
	evidenceOK, evidenceLabels := effectiveEvidence(doc)
	if str(doc, "title") == "" {
		out = append(out, errf("<doc>", "missing required key: title"))
	}
	// A `layout: page` doc is a single standalone page composed of `blocks`, not
	// a doc-tree of `nodes` (it publishes via core.RenderStandalone, not
	// core.Publish). It has no nodes/parent/children topology, so validate its
	// page shape and return — otherwise lint wrongly demands `nodes` and aborts
	// `stddoc publish` on a perfectly valid page doc (the page-atoms-demo trap).
	if str(doc, "layout") == "page" {
		if _, has := doc.Get("blocks"); !has {
			out = append(out, errf("<doc>", "layout:page doc missing required key: blocks (must be a list)"))
			return out
		}
		// Reuse the per-primitive block validator over the page's top-level
		// blocks[] (same dispatch a node's blocks get).
		return append(out, lintBlocks(doc, "<page>", reg, pal)...)
	}
	nodesV, _ := doc.Get("nodes")
	nodes, ok := nodesV.([]any)
	if !ok {
		out = append(out, errf("<doc>", "missing required key: nodes (must be a list)"))
		return out
	}
	if len(nodes) == 0 {
		out = append(out, warnf("<doc>", "nodes is empty — nothing to render"))
	}

	// ---- per-node required keys + slug shape + uniqueness ----------------
	seen := map[string]int{}
	for i, nv := range nodes {
		n, ok := omap(nv)
		if !ok {
			out = append(out, errf(fmt.Sprintf("nodes[%d]", i), "node is not a JSON object"))
			continue
		}
		slug := str(n, "slug")
		if slug == "" {
			out = append(out, errf(fmt.Sprintf("nodes[%d]", i), "missing required key: slug"))
			continue
		}
		if str(n, "title") == "" {
			out = append(out, errf(slug, "missing required key: title"))
		}
		if !slugShapeRe.MatchString(slug) {
			out = append(out, errf(slug, "slug '%s' is not kebab-case [a-z0-9-]+", slug))
		}
		if j, dup := seen[slug]; dup {
			out = append(out, errf(slug, "duplicate slug (also nodes[%d])", j))
		} else {
			seen[slug] = i
		}
	}
	valid := map[string]bool{}
	for s := range seen {
		valid[s] = true
	}

	// ---- parent / children topology --------------------------------------
	// A node may declare hierarchy via `parent: <slug>` OR via nested `children`.
	// Build a single child->parent map from both, catching multi-parent + cycles.
	childParent := map[string]string{}
	claim := func(child, parent, how string) {
		if child == parent {
			out = append(out, errf(child, "%s: node is its own parent", how))
			return
		}
		if p, exists := childParent[child]; exists && p != parent {
			out = append(out, errf(child, "appears under two parents (%s and %s)", p, parent))
			return
		}
		childParent[child] = parent
	}
	for _, nv := range nodes {
		n, ok := omap(nv)
		if !ok {
			continue
		}
		slug := str(n, "slug")
		if slug == "" {
			continue
		}
		if pv, has := n.Get("parent"); has && pv != nil {
			p := str(n, "parent")
			if !valid[p] {
				out = append(out, errf(slug, "parent '%s' does not resolve to a node", p))
			} else {
				claim(slug, p, "parent")
			}
		}
		for _, cv := range list(n, "children") {
			if c, ok := omap(cv); ok {
				if cs := str(c, "slug"); cs != "" {
					claim(cs, slug, "children")
				}
			}
		}
	}
	// cycle detection over the child->parent map (deterministic start order).
	starts := make([]string, 0, len(childParent))
	for s := range childParent {
		starts = append(starts, s)
	}
	sort.Strings(starts)
	for _, start := range starts {
		chain := map[string]bool{}
		cur := start
		for {
			next, ok := childParent[cur]
			if !ok {
				break
			}
			if chain[cur] {
				out = append(out, errf(start, "cycle detected in parent/children chain"))
				break
			}
			chain[cur] = true
			cur = next
		}
	}

	// ---- citations + ascii diagrams (recursive walk) ---------------------
	var walk func(node *wire.OrderedMap)
	walk = func(node *wire.OrderedMap) {
		slug := str(node, "slug")
		if slug == "" {
			slug = "<node>"
		}
		for _, dv := range list(node, "diagrams") {
			d, ok := omap(dv)
			if !ok {
				continue
			}
			if asciiTxt, ok := get(d, "ascii").(string); ok {
				for _, ln := range strings.Split(asciiTxt, "\n") {
					// COLUMNS, not bytes. Every box-drawing glyph (─ │ ► ◄ ·)
					// is 3 bytes in UTF-8, so len() over-measured a diagram by
					// roughly a third and reported widths no reader ever saw.
					// The clip must be rune-sliced too — byte-slicing split a
					// glyph mid-sequence and printed mojibake into the warning.
					cols := utf8.RuneCountInString(ln)
					if cols > asciiMax {
						clip := []rune(ln)
						if len(clip) > 40 {
							clip = clip[:40]
						}
						out = append(out, warnf(slug, "ascii diagram line > %d cols (%d): '%s'…", asciiMax, cols, string(clip)))
						break
					}
				}
				// NOTE: there was a "raw '<'/'>' in ascii diagram text" warning
				// here. It was removed 2026-08-22: ascii is escaped on every
				// output path (verified published AND frozen — `<your-doc-dir>`
				// emits as `&lt;your-doc-dir&gt;` in both), so the rule fired on
				// correct content and named no action the author could take.
				// Now that warnings actually print, a rule like that teaches
				// people to ignore warnings — which is more expensive than the
				// non-problem it flagged. The escaping is covered by a real test
				// instead: TestAsciiAngleBracketsAreEscaped.
			}
		}
		for _, secV := range list(node, "sections") {
			sec, ok := omap(secV)
			if !ok {
				continue
			}
			for _, itV := range list(sec, "items") {
				it, ok := omap(itV)
				if !ok {
					continue
				}
				for _, cv := range list(it, "citations") {
					c, ok := omap(cv)
					if !ok {
						out = append(out, errf(slug, "citation is not an object"))
						continue
					}
					if str(c, "path") == "" {
						out = append(out, errf(slug, "citation missing required 'path'"))
					}
					if ev, has := c.Get("evidence"); has && ev != nil {
						if evs, _ := ev.(string); !evidenceOK[evs] {
							out = append(out, errf(slug, "citation evidence '%s' not one of %v (declare more via the doc-root evidence_levels list)", evs, evidenceLabels))
						}
					}
				}
			}
		}
		// per-primitive validate + unknown-type check over authored blocks[].
		out = append(out, lintBlocks(node, slug, reg, pal)...)
		// a primitive authored into sections[] instead of blocks[] renders as
		// NOTHING and says nothing — the silent drop this check exists to end.
		out = append(out, lintMisplacedPrimitives(node, slug, reg)...)
		// `sections` is a SYNTHETIC node-level block: it is never present in
		// blocks[], so lintBlocks above can never reach its validator. Without
		// this call, registering that validator does nothing at all — the unit
		// test would pass while publish stayed silent. Same silent-drop class,
		// one level up.
		for _, f := range reg.Validate("sections", node) {
			if f.Slug == "" {
				f.Slug = slug
			}
			out = append(out, f)
		}
		for _, cv := range list(node, "children") {
			if c, ok := omap(cv); ok {
				walk(c)
			}
		}
	}
	for _, nv := range nodes {
		if n, ok := omap(nv); ok && str(n, "slug") != "" {
			walk(n)
		}
	}

	return out
}

// lintMisplacedPrimitives catches a primitive authored into sections[] rather
// than blocks[]. sections[] carries prose ({name, icon, summary}); primitives
// live in blocks[]. A typed entry in sections[] is dropped at render time
// WITHOUT a word — the author gets a clean exit code and a page missing its
// diagrams. Covenant VI: a silent failure is the one we do not ship.
func lintMisplacedPrimitives(node *wire.OrderedMap, slug string, reg *registry.Registry) []registry.Finding {
	var out []registry.Finding
	for _, sv := range list(node, "sections") {
		s, ok := omap(sv)
		if !ok {
			continue
		}
		typ := str(s, "type")
		if typ == "" {
			continue
		}
		if reg.Has(typ) {
			out = append(out, errf(slug, "primitive '%s' authored in sections[] — primitives belong in blocks[]; it would render as nothing", typ))
			continue
		}
		out = append(out, errf(slug, "sections[] entry carries type '%s'; sections[] holds prose (name/icon/summary), primitives belong in blocks[]", typ))
	}
	out = append(out, lintNearMissContainers(node, slug)...)
	for _, cv := range list(node, "children") {
		c, ok := omap(cv)
		if !ok {
			continue
		}
		if typ := str(c, "type"); typ != "" && reg.Has(typ) {
			out = append(out, errf(slug, "primitive '%s' authored in children[] — children[] holds child NODES, not primitives; it would render as nothing", typ))
		}
	}
	return out
}

// nearMissContainers maps a singular (or otherwise mistyped) container key to
// the real one. Authoring `block:` instead of `blocks:` drops EVERY primitive
// on the node and, before this check, said nothing at all — publish exits 0 and
// the page is simply empty. Same class as lintMisplacedPrimitives: content the
// author wrote, silently discarded.
var nearMissContainers = map[string]string{
	"block":   "blocks",
	"section": "sections",
	"child":   "children",
	"node":    "nodes",
	"blocs":   "blocks",
	"secions": "sections",
}

func lintNearMissContainers(node *wire.OrderedMap, slug string) []registry.Finding {
	var out []registry.Finding
	for _, k := range node.Keys() {
		real, ok := nearMissContainers[k]
		if !ok {
			continue
		}
		if _, exists := node.Get(real); exists {
			// both present: the real one is authoritative, the stray is dead weight.
			out = append(out, warnf(slug, "key '%s' is ignored ('%s' is the real container and is also present)", k, real))
			continue
		}
		out = append(out, errf(slug, "key '%s' is not a container std-doc reads — did you mean '%s'? everything under it renders as nothing", k, real))
	}
	return out
}

// lintBlocks dispatches the assembled per-primitive validation over a node's
// authored blocks[]. An unknown type is a lint error (mirrors the render-time
// error boundary); a known type with a registered validator surfaces its
// findings, re-scoped to the node slug when the validator left the slug blank.
func lintBlocks(node *wire.OrderedMap, slug string, reg *registry.Registry, pal *palette.Palette) []registry.Finding {
	var out []registry.Finding
	for _, bv := range list(node, "blocks") {
		b, ok := omap(bv)
		if !ok {
			continue
		}
		typ := str(b, "type")
		if typ == "" {
			out = append(out, errf(slug, "authored block missing required 'type'"))
			continue
		}
		if !reg.Has(typ) {
			out = append(out, errf(slug, "unknown block type '%s'", typ))
			continue
		}
		for _, f := range reg.Validate(typ, b) {
			if f.Slug == "" {
				f.Slug = slug
			}
			out = append(out, f)
		}
		// A misspelled field inside a COMPOSED primitive used to be invisible —
		// lintBlocks only ever checked the top-level authored blocks[], so the
		// exact same 'bodyy' typo that warned at depth 0 said nothing one
		// container deep (a callout nested inside a band/row/grid, or inside a
		// style_ab voice's preview[]). Route through the shared walker (Job 1,
		// blocks.go) to reach every nested block, at any depth.
		out = append(out, lintNestedBlocks(b, slug, reg)...)
		// The reachability diff (lint_reachability.go): a container's field can
		// be MISNAMED in a way that isn't close enough to any real field to
		// trip the near-miss check above (band.items[] isn't a near-miss of
		// "content"), or the mismatch can be several containers deep. Runs the
		// real render for b and reports anything authored under it that the
		// render never actually touched.
		out = append(out, lintReachability(b, typ, slug, reg, pal)...)
	}
	return out
}

// lintNestedBlocks recurses into an authored block's own fields (never the
// block itself — the caller already validated that at its own level) and
// validates every nested object that carries a "type" the registry KNOWS.
//
// Deliberately silent on an unknown nested type: composition mixes real
// primitives (callout, figure, decisionmatrix, …) with a small inline-atom
// vocabulary that also happens to use a "type" key (text/strong/soft/kbd, the
// content spans inside e.g. a reveal's paras[].content[]) — those ARE
// registered (buildRegistry installs them), so reg.Has covers them too, but a
// hypothetical future data shape that reuses "type" for something else again
// must not be flagged as "unknown block type" just because it is nested; that
// class of false positive is exactly the "cries wolf" failure mode the gate
// forbids. A misspelled TYPE name at the top level of an authored blocks[]
// entry is still caught (lintBlocks, unchanged); this only adds depth to the
// per-primitive FIELD/VALUE validation for types the registry already knows
// about, unbounded depth, matching how the renderer itself recurses.
func lintNestedBlocks(b *wire.OrderedMap, slug string, reg *registry.Registry) []registry.Finding {
	var out []registry.Finding
	for _, k := range b.Keys() {
		if k == "type" {
			continue
		}
		val, _ := b.Get(k)
		walkNestedBlocks(val, func(node *wire.OrderedMap, typ string) {
			if !reg.Has(typ) {
				return
			}
			for _, f := range reg.Validate(typ, node) {
				if f.Slug == "" {
					f.Slug = slug
				}
				out = append(out, f)
			}
		})
	}
	return out
}
