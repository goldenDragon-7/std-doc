package core

import (
	"strings"

	"stddoc/internal/library"
	"stddoc/internal/registry"
	"stddoc/internal/wire"
)

func suggestf(slug, msg string) registry.Finding {
	return registry.Finding{Level: "suggest", Slug: slug, Message: msg}
}

// suggest.go — v0.11 "the discoverability release" S3: lint-suggestions.
//
// HARD RULES (the maintainer, 2026-08-15) — load-bearing, not decoration:
//   - notes only, NEVER errors
//   - NEVER blocks publish
//   - conservative, curated triggers — a wrong-but-loud suggestion violates
//     MEASURED>CLAIMED on our own surface
//
// This is why LintSuggest is a COMPLETELY SEPARATE function from Lint, not a
// new Level added to Lint's output: Lint's findings feed exit-code decisions
// (CountErrors aborts publish; `stddoc lint --lint-only` exits nonzero on ANY
// finding). Merging suggestions into that stream would make `--lint-only`
// start failing existing CI on docs that were previously clean, purely
// because a suggestion now exists — the opposite of "never blocks publish".
// LintSuggest's output is NEVER counted by CountErrors/CountWarns and is
// NEVER consulted by any exit-code path; only `stddoc lint`'s own printing
// (cmd/stddoc/lint.go) reads it, as a clearly-labeled informational section.
//
// Each trigger below is 100% STRUCTURAL (block type + field shape), never a
// guess at authorial intent — the "conservative, curated" half of the rule.
// Every message is phrased "consider X → see gallery", per the letter of the
// mandate, never "you should" or "this is wrong".

const gallerySee = " → see gallery: examples/primitive-gallery/p-"

// LintSuggest walks a doc-tree's authored blocks and returns conservative,
// curated primitive suggestions. It NEVER renders, NEVER mutates the doc, and
// its output NEVER affects any exit code — see the file doc comment.
func LintSuggest(doc *wire.OrderedMap, lib *library.Library) ([]registry.Finding, error) {
	if doc == nil {
		return nil, nil
	}
	if str(doc, "layout") == "page" {
		return suggestBlocks(list(doc, "blocks"), "<page>"), nil
	}
	var out []registry.Finding
	var walk func(node *wire.OrderedMap)
	walk = func(node *wire.OrderedMap) {
		slug := str(node, "slug")
		if slug == "" {
			slug = "<node>"
		}
		out = append(out, suggestBlocks(list(node, "blocks"), slug)...)
		for _, cv := range list(node, "children") {
			if c, ok := omap(cv); ok {
				walk(c)
			}
		}
	}
	for _, nv := range list(doc, "nodes") {
		if n, ok := omap(nv); ok && str(n, "slug") != "" {
			walk(n)
		}
	}
	return out, nil
}

// suggestBlocks applies every curated trigger to one blocks[] stream.
func suggestBlocks(blocks []any, slug string) []registry.Finding {
	var out []registry.Finding
	for _, bv := range blocks {
		b, ok := omap(bv)
		if !ok {
			continue
		}
		switch str(b, "type") {
		case "table":
			if f, hit := suggestStatusboard(b, slug); hit {
				out = append(out, f)
			}
		case "flow":
			if f, hit := suggestPipeline(b, slug); hit {
				out = append(out, f)
			}
		case "call":
			if f, hit := suggestDecision(b, slug); hit {
				out = append(out, f)
			}
		}
	}
	return out
}

// Trigger 1: a `table` with a column literally named "status" (case-insensitive,
// exact match — not a substring guess) is a strong, structural signal that
// `statusboard` (per-cell colored status badges, grouped rows) would read
// better than plain table cells.
func suggestStatusboard(b *wire.OrderedMap, slug string) (registry.Finding, bool) {
	for _, cv := range list(b, "columns") {
		if s, ok := cv.(string); ok && strings.EqualFold(strings.TrimSpace(s), "status") {
			return suggestf(slug, "table has a 'status' column — consider `statusboard`"+gallerySee+"statusboard.html (grouped rows + colored status badges)"), true
		}
	}
	return registry.Finding{}, false
}

// Trigger 2: a `flow` with 3+ steps is a real sequence, but `flow` carries no
// done/active/pending state coloring — `pipeline` does. Gated at 3+ so a
// simple 2-step before/after flow (which pipeline offers nothing extra for)
// stays quiet.
func suggestPipeline(b *wire.OrderedMap, slug string) (registry.Finding, bool) {
	steps := list(b, "steps")
	if len(steps) >= 3 {
		return suggestf(slug, "flow has 3+ sequential steps — if any step is 'in progress' or 'done', consider `pipeline`"+gallerySee+"pipeline.html (phase-strip cards with done/active/pending state)"), true
	}
	return registry.Finding{}, false
}

// Trigger 3: a `call` box (weighed options — the primitive's own description)
// with 2+ options is presenting a choice; if the author DID make the call,
// `decision` records the chosen answer + rationale, not just the options.
func suggestDecision(b *wire.OrderedMap, slug string) (registry.Finding, bool) {
	if len(list(b, "options")) >= 2 {
		return suggestf(slug, "call box weighs 2+ options — if a call was already made, consider `decision`"+gallerySee+"decision.html (records the chosen answer + rationale, not just the options)"), true
	}
	return registry.Finding{}, false
}
