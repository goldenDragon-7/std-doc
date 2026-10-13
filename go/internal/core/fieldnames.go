package core

import (
	"encoding/json"
	"sort"
	"strings"

	"stddoc/internal/registry"
	"stddoc/internal/wire"
)

// A misspelled FIELD inside a primitive used to degrade in silence: authoring
// `colums:` instead of `columns:` rendered a table with no headers, rc=0, not a
// word. The fix does NOT hand-write a validator per primitive — the library is
// data, so each template already declares which fields it reads. We derive the
// known-field set from the template itself and flag an authored key that is a
// near-miss of one of them.
//
// Deliberately conservative: an unknown key is only reported when it is CLOSE to
// a field the template actually reads. Authors carry extra keys on purpose
// (notes, ids, provenance) and those must stay silent.

// templateFieldNames walks a primitive's raw template and collects every field
// name it references. Over-collecting is the safe direction — a larger known set
// means fewer false positives, never a missed silent drop.
func templateFieldNames(raw any) map[string]bool {
	out := map[string]bool{}
	var walk func(any)
	walk = func(n any) {
		switch v := n.(type) {
		case map[string]any:
			for k, val := range v {
				if s, ok := val.(string); ok && k != "then" && k != "else" && k != "body" {
					if name := fieldHead(s); name != "" {
						out[name] = true
					}
				}
				walk(val)
			}
		case []any:
			for _, item := range v {
				walk(item)
			}
		}
	}
	walk(raw)
	return out
}

// fieldHead reduces a template reference to the top-level field it names.
// "left.title" -> "left"; "@root.columns" -> "columns"; "@item" -> "" (loop
// variable, not a field); anything containing markup -> "" (a literal, not a
// reference).
func fieldHead(ref string) string {
	if ref == "" || strings.ContainsAny(ref, "<>= /") {
		return ""
	}
	ref = strings.TrimPrefix(ref, "@root.")
	if strings.HasPrefix(ref, "@") {
		return ""
	}
	if i := strings.IndexByte(ref, '.'); i >= 0 {
		ref = ref[:i]
	}
	if ref == "" || !isPlainIdent(ref) {
		return ""
	}
	return ref
}

func isPlainIdent(s string) bool {
	for _, r := range s {
		if !(r == '_' || r == '-' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

// editDistance is a bounded Levenshtein — it stops caring past `max`.
func editDistance(a, b string, max int) int {
	if len(a) > len(b) {
		a, b = b, a
	}
	if len(b)-len(a) > max {
		return max + 1
	}
	prev := make([]int, len(a)+1)
	cur := make([]int, len(a)+1)
	for i := range prev {
		prev[i] = i
	}
	for j := 1; j <= len(b); j++ {
		cur[0] = j
		best := cur[0]
		for i := 1; i <= len(a); i++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[i] = min3(cur[i-1]+1, prev[i]+1, prev[i-1]+cost)
			if cur[i] < best {
				best = cur[i]
			}
		}
		if best > max {
			return max + 1
		}
		prev, cur = cur, prev
	}
	return prev[len(a)]
}

func min3(a, b, c int) int {
	if b < a {
		a = b
	}
	if c < a {
		a = c
	}
	return a
}

// nearMissField returns the field `key` was probably meant to be. Short keys are
// excluded — at 3 characters or fewer, edit distance stops being evidence.
func nearMissField(key string, known map[string]bool) (string, bool) {
	if len(key) < 4 {
		return "", false
	}
	names := make([]string, 0, len(known))
	for k := range known {
		names = append(names, k)
	}
	sort.Strings(names) // deterministic suggestion when two are equally close
	best, bestD := "", 3
	for _, n := range names {
		if len(n) < 4 {
			continue
		}
		if d := editDistance(strings.ToLower(key), strings.ToLower(n), 2); d < bestD && d > 0 {
			best, bestD = n, d
		}
	}
	return best, best != ""
}

// fieldValidator builds the per-primitive validator registered in buildRegistry.
func fieldValidator(typ string, tmplRaw any) func(*wire.OrderedMap) []registry.Finding {
	known := templateFieldNames(tmplRaw)
	return func(b *wire.OrderedMap) []registry.Finding {
		var out []registry.Finding
		for _, k := range b.Keys() {
			if k == "type" || known[k] {
				continue
			}
			if want, ok := nearMissField(k, known); ok {
				out = append(out, warnf("", "%s: field '%s' is not read by this primitive — did you mean '%s'? it renders as nothing", typ, k, want))
			}
		}
		return out
	}
}

// rawTemplates re-parses templates.json as generic JSON so field names can be
// derived without depending on the renderer's internal template types.
func rawTemplates(data []byte) (map[string]any, error) {
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}

// variantSelector describes a primitive whose ENTIRE template body is a
// discriminated union — a list of `{"if":{"eq":["<field>", <value>]}, "then":
// […]}` nodes on the SAME field, with no `else` anywhere and no unconditional
// (bare-string) node either. When none of the branches match, renderNodes has
// nothing left to fall back to and the primitive renders "" — no warning, no
// error block, at any nesting depth. `figure` is the known case (name:
// "balloon-playful" is the only registered variant; any other name, or none,
// renders the empty string): protocol/library.md documents `name` as figure's
// selector but nothing ever validated the VALUE against what the template
// actually recognizes. This is scoped deliberately narrow (whole-body-is-the-
// union, single shared field) so it does not fire on the many templates that
// use an `if` with no `else` for one optional decoration alongside other,
// unconditional content — those already degrade gracefully by design.
type variantSelector struct {
	field  string
	values map[string]bool
}

// detectVariantSelector inspects one primitive's raw template and returns the
// selector it discriminates on, if the whole body has that pure-union shape.
func detectVariantSelector(tmplRaw any) (variantSelector, bool) {
	nodes, ok := tmplRaw.([]any)
	if !ok || len(nodes) == 0 {
		return variantSelector{}, false
	}
	field := ""
	values := map[string]bool{}
	for _, nv := range nodes {
		n, ok := nv.(map[string]any)
		if !ok {
			return variantSelector{}, false // a bare-string node is an unconditional fallback
		}
		if _, hasElse := n["else"]; hasElse {
			return variantSelector{}, false
		}
		condV, hasIf := n["if"]
		if !hasIf || len(n) != 2 { // exactly {if, then} — anything else isn't the pure shape
			return variantSelector{}, false
		}
		if _, hasThen := n["then"]; !hasThen {
			return variantSelector{}, false
		}
		cond, ok := condV.(map[string]any)
		if !ok || len(cond) != 1 {
			return variantSelector{}, false
		}
		eq, ok := cond["eq"]
		if !ok {
			return variantSelector{}, false
		}
		pair, ok := eq.([]any)
		if !ok || len(pair) != 2 {
			return variantSelector{}, false
		}
		f, ok := pair[0].(string)
		if !ok || f == "" {
			return variantSelector{}, false
		}
		if field == "" {
			field = f
		} else if field != f {
			return variantSelector{}, false // more than one selector field — not this shape
		}
		if val, ok := pair[1].(string); ok {
			values[val] = true
		}
	}
	if field == "" || len(values) == 0 {
		return variantSelector{}, false
	}
	return variantSelector{field: field, values: values}, true
}

// variantValidator warns when the selector field is present but its value
// matches none of the template's known branches — the "unmatched name/variant"
// class of silent drop (Job 3). Missing-field is left to fieldValidator/the
// author's judgment (an omitted selector is a different, already-visible
// authoring mistake if the field is otherwise required elsewhere); this only
// covers the case that previously said nothing at all.
func variantValidator(typ string, sel variantSelector) func(*wire.OrderedMap) []registry.Finding {
	return func(b *wire.OrderedMap) []registry.Finding {
		v, has := b.Get(sel.field)
		if !has || v == nil {
			return nil
		}
		s, ok := v.(string)
		if !ok || s == "" || sel.values[s] {
			return nil
		}
		names := make([]string, 0, len(sel.values))
		for k := range sel.values {
			names = append(names, k)
		}
		sort.Strings(names)
		return []registry.Finding{warnf("", "%s: %s '%s' is not a recognized value (known: %s) — it renders as nothing",
			typ, sel.field, s, strings.Join(names, ", "))}
	}
}
