package core

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"stddoc/internal/library"
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

var evidenceOK = map[string]bool{"MEASURED": true, "CITED": true, "INFERRED": true}

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
		return append(out, lintBlocks(doc, "<page>", reg)...)
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
					if len(ln) > asciiMax {
						clip := ln
						if len(clip) > 40 {
							clip = clip[:40]
						}
						out = append(out, warnf(slug, "ascii diagram line > %d cols (%d): '%s'…", asciiMax, len(ln), clip))
						break
					}
				}
				if strings.ContainsAny(asciiTxt, "<>") {
					out = append(out, warnf(slug, "raw '<'/'>' in ascii diagram text"))
				}
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
							out = append(out, errf(slug, "citation evidence '%s' not one of [CITED INFERRED MEASURED]", evs))
						}
					}
				}
			}
		}
		// per-primitive validate + unknown-type check over authored blocks[].
		out = append(out, lintBlocks(node, slug, reg)...)
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

// lintBlocks dispatches the assembled per-primitive validation over a node's
// authored blocks[]. An unknown type is a lint error (mirrors the render-time
// error boundary); a known type with a registered validator surfaces its
// findings, re-scoped to the node slug when the validator left the slug blank.
func lintBlocks(node *wire.OrderedMap, slug string, reg *registry.Registry) []registry.Finding {
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
	}
	return out
}
