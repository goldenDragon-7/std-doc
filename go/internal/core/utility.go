package core

import (
	"encoding/json"
	"sort"
	"strings"
)

// The UTILITY LAYER — an orthogonal axis, not a primitive.
//
// MEASURED (the leaf-gap worklist §4, Tier 3): across the 73
// content-unique corpus documents, the most-shared vocabulary after `subtitle`
// is a set of bare tone modifiers applied to arbitrary elements — `green` in 27
// documents, `amber` 25, `purple` 23, `red` 20, `tight` 12. No primitive can
// absorb that, because a tone is not a thing; it is a property of any thing.
// Containers cannot absorb it either. It needs its own layer.
//
// Two independent lines of reasoning arrived at this component: the corpus
// measurement above, and html-value-sanitizer.md §3.2, where a curated utility
// set is the mitigation for rejecting author `style=` (inline colour hard-codes
// a value outside the palette, which breaks `--style` and quietly violates
// Covenant II). When two unrelated arguments land on the same component, it is
// the right component.
//
// TWO PROPERTIES MAKE THIS SAFE, and both are load-bearing:
//
//  1. USAGE-SCANNED EMISSION. A page receives CSS only for the utility classes
//     that actually appear in its rendered HTML. A page using none receives
//     ZERO BYTES — which is exactly what keeps every pre-existing conformance
//     golden byte-identical (the strangler proof). body.css could not be used
//     for this: it is inlined into every page, so a rule there would
//     re-baseline every golden, including pages with no utility class at all.
//     That is the same trap documented in the parked inline-code finding.
//
//  2. WHITELISTED BY CONSTRUCTION. Authors never supply a raw class string.
//     Templates map an author TOKEN through a lookup table (the `code`
//     primitive's established pattern), so the only classes that can ever reach
//     a page are the keys of utility_css.json. This layer is therefore not an
//     injection surface, and it stays consistent with the sanitizer's posture:
//     the author declares intent, the engine emits the markup.

// loadUtilityCSS parses utility_css.json into a class -> rule table. Keys
// beginning with "_" are documentation and are skipped. A nil/empty input
// yields a nil table, which makes collectUtilityCSS a no-op — the backward
// compatible, byte-identical behaviour for older library trees.
func loadUtilityCSS(raw []byte) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		// A malformed table must never take the renderer down or silently
		// half-apply: emit nothing, exactly as if the file were absent.
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		if k == "" || strings.HasPrefix(k, "_") || v == "" {
			continue
		}
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// classTokens extracts every class token appearing in html, handling both
// single- and double-quoted class attributes (the engine emits both).
func classTokens(html string) map[string]bool {
	seen := map[string]bool{}
	for _, marker := range []string{"class=\"", "class='"} {
		quote := marker[len(marker)-1:]
		rest := html
		for {
			i := strings.Index(rest, marker)
			if i < 0 {
				break
			}
			rest = rest[i+len(marker):]
			j := strings.Index(rest, quote)
			if j < 0 {
				break
			}
			for _, tok := range strings.Fields(rest[:j]) {
				seen[tok] = true
			}
			rest = rest[j+1:]
		}
	}
	return seen
}

// collectUtilityCSS returns the concatenated rules for exactly those utility
// classes present in html, in deterministic (sorted) order — determinism
// matters because conformance is byte-identity, not set equality.
//
// Returns "" when the table is empty or no utility class is used, so callers
// can skip the <style> wrapper entirely and produce byte-identical output to
// the pre-utility engine.
func collectUtilityCSS(html string, table map[string]string) string {
	if len(table) == 0 || html == "" {
		return ""
	}
	used := classTokens(html)
	if len(used) == 0 {
		return ""
	}
	names := make([]string, 0, len(table))
	for name := range table {
		if used[name] {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return ""
	}
	sort.Strings(names)
	var out strings.Builder
	for _, n := range names {
		out.WriteString(table[n])
	}
	return out.String()
}
