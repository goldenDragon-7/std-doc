// expand.go — LAYER 2: the template (lego-assembly) layer.
//
// A PRIMITIVE (templates.json) turns one block's fields into HTML. A TEMPLATE
// (page_templates.json) turns a whole friendly DATA shape — {kpis[], sections[]}
// — into an ordered stream of primitive blocks. This file is the one generic
// evaluator that does the second job, so that adding a new KIND of document is
// adding a data entry, never writing a per-document build script.
//
// It deliberately reuses this package's proven path resolver (resolve), scope
// chain (Frame), truthiness (pyTruthy) and condition grammar (evalCond): the
// assembly language and the render language share one interpreter, exactly as
// the primitives already do. The expander emits *wire.OrderedMap BLOCKS (not
// HTML); those blocks then flow through the unchanged renderBlocks → lint →
// anchor → CSS pipeline, which is what keeps the golden-master strangler proof
// intact for every document that does not name a template.
//
// Grammar — an assembly spec is a []any of EMIT nodes. Each emit node is a
// single-key-ish map:
//
//	{"block": "<type>", "set": {field: <val>, ...}}   emit one block
//	{"foreach": "<path>", "do": [emit...]}            iterate a data list
//	{"when": <cond>, "do": [emit...], "else": [...]}  conditional (evalCond grammar)
//
// A <val> is resolved by evalVal:
//
//	"literal string"                         verbatim (static chrome: class names, headings)
//	{"@": "dotted.path"}                      resolve against scope; optional "default"
//	{"lit": <any>}                            an explicit non-string literal
//	{"join": "path", "sep": "..."}            resolve a list, PyStr each, join
//	{"map": "path", "table": {...}}           lookup a scalar; optional "default"
//	{"list": "path", "set": {field:<val>...}} build []*wire.OrderedMap, one per item
//
// Every unknown op is a LOUD error (never a silent drop) — that silent-drop
// class is the exact thing layer 2 exists to kill.
package template

import (
	"encoding/json"
	"sort"
	"strconv"

	"stddoc/internal/wire"
)

// jsonNum mirrors the render-side `each` op's index encoding (json.Number), so
// @index/@len compare numerically the same way in both layers.
func jsonNum(i int) json.Number { return json.Number(strconv.Itoa(i)) }

// Expand evaluates an assembly spec against friendly source DATA and returns the
// ordered primitive blocks it assembles. The data is bound as both @item and
// @root at the top scope (same convention as Render), so bare fields resolve
// against the document and {"@":"@root.x"} always reaches the top.
func Expand(spec []any, data *wire.OrderedMap) ([]*wire.OrderedMap, error) {
	env := []Frame{{"@item": data, "@root": data}}
	return emitNodes(spec, env)
}

func emitNodes(nodes any, env []Frame) ([]*wire.OrderedMap, error) {
	list, ok := nodes.([]any)
	if !ok {
		if nodes == nil {
			return nil, nil
		}
		return nil, terr("template: assembly body must be a list of emit nodes, got %T", nodes)
	}
	var out []*wire.OrderedMap
	for _, n := range list {
		got, err := emitNode(n, env)
		if err != nil {
			return nil, err
		}
		out = append(out, got...)
	}
	return out, nil
}

func emitNode(node any, env []Frame) ([]*wire.OrderedMap, error) {
	m, ok := node.(map[string]any)
	if !ok {
		return nil, terr("template: emit node must be a map, got %#v", node)
	}

	if typ, ok := m["block"]; ok {
		ts, _ := typ.(string)
		if ts == "" {
			return nil, terr("template: \"block\" op needs a non-empty type string, got %#v", typ)
		}
		b := wire.NewOrderedMap()
		b.Set("type", ts)
		if err := applySet(b, m["set"], env); err != nil {
			return nil, err
		}
		return []*wire.OrderedMap{b}, nil
	}

	if path, ok := m["foreach"]; ok {
		ps, _ := path.(string)
		items := asList(resolve(ps, env))
		var out []*wire.OrderedMap
		for i, item := range items {
			frame := loopFrame(item, i, items)
			got, err := emitNodes(m["do"], append([]Frame{frame}, env...))
			if err != nil {
				return nil, err
			}
			out = append(out, got...)
		}
		return out, nil
	}

	if cond, ok := m["when"]; ok {
		yes, err := evalCond(cond, env)
		if err != nil {
			return nil, err
		}
		if yes {
			return emitNodes(m["do"], env)
		}
		return emitNodes(m["else"], env)
	}

	// Name the offending key so the author is told WHICH op is unknown.
	return nil, terr("template: unknown assembly op in emit node %s", firstKey(m))
}

// applySet binds each field of a "set" map onto the block via evalVal. Keys are
// applied in sorted order purely for deterministic block construction; field
// order never reaches rendered output (primitives read fields by name).
func applySet(b *wire.OrderedMap, raw any, env []Frame) error {
	if raw == nil {
		return nil
	}
	set, ok := raw.(map[string]any)
	if !ok {
		return terr("template: \"set\" must be a map, got %T", raw)
	}
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v, err := evalVal(set[k], env)
		if err != nil {
			return err
		}
		b.Set(k, v)
	}
	return nil
}

// evalVal resolves one field value. A bare string is a literal (static chrome);
// a single-key map is a value op.
func evalVal(v any, env []Frame) (any, error) {
	switch x := v.(type) {
	case string:
		return x, nil
	case map[string]any:
		if p, ok := x["@"]; ok {
			val := resolve(asStr(p), env)
			if val == nil {
				if def, ok := x["default"]; ok {
					return def, nil
				}
			}
			return val, nil
		}
		if lit, ok := x["lit"]; ok {
			return lit, nil
		}
		if p, ok := x["join"]; ok {
			sep := asStr(x["sep"])
			parts := asList(resolve(asStr(p), env))
			out := ""
			for i, it := range parts {
				if i > 0 {
					out += sep
				}
				out += wire.PyStr(it)
			}
			return out, nil
		}
		if p, ok := x["map"]; ok {
			key := wire.PyStr(resolve(asStr(p), env))
			table, _ := x["table"].(map[string]any)
			if hit, ok := table[key]; ok {
				return hit, nil
			}
			if def, ok := x["default"]; ok {
				return def, nil
			}
			return nil, terr("template: map miss for %q and no default", key)
		}
		if p, ok := x["list"]; ok {
			items := asList(resolve(asStr(p), env))
			built := make([]any, 0, len(items))
			for i, item := range items {
				frame := loopFrame(item, i, items)
				sub := wire.NewOrderedMap()
				if err := applySet(sub, x["set"], append([]Frame{frame}, env...)); err != nil {
					return nil, err
				}
				built = append(built, sub)
			}
			return built, nil
		}
		return nil, terr("template: unknown value op %s", firstKey(x))
	default:
		// numbers/bools/nil pass through as literals
		return v, nil
	}
}

// loopFrame builds the same @item/@index/@first/@last/@len/@next/@prev scope the
// render-side `each` op uses, so a template author's mental model is identical
// across the two layers.
func loopFrame(item any, i int, items []any) Frame {
	return Frame{
		"@item": item, "@index": jsonNum(i),
		"@first": i == 0, "@last": i == len(items)-1,
		"@len":  jsonNum(len(items)),
		"@next": nextOr(items, i+1), "@prev": prevOr(items, i-1),
	}
}

func firstKey(m map[string]any) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return "(empty)"
	}
	return "\"" + keys[0] + "\""
}
