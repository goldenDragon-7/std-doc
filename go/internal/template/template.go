// Package template is the ONE interpreter that makes the port a transcription.
//
// A primitive's render logic is structured data (a list of nodes), not code and
// not a string mini-language. The engine carries one small interpreter; every
// data-driven primitive copies across unchanged. Verbatim-in-behavior port of
// Spec: protocol/declarative-format.md, wire-spec.
//
// Type mapping (Python -> Go):
//   - source data objects  -> *wire.OrderedMap   (insertion order preserved)
//   - source data arrays    -> []any
//   - scalars               -> string / bool / json.Number / nil
//   - template nodes         -> string | map[string]any  (order-independent)
package template

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"stddoc/internal/palette"
	"stddoc/internal/wire"
)

// TemplateError is a malformed-template / loud-authoring error, never silent.
type TemplateError struct{ msg string }

func (e *TemplateError) Error() string { return e.msg }

func terr(format string, a ...any) error { return &TemplateError{fmt.Sprintf(format, a...)} }

// Registry draws a nested primitive block (for the compose op). Defined here as
// an interface so the registry package can depend on this one without a cycle.
type Registry interface {
	Render(typ string, block *wire.OrderedMap, ctx *Ctx) (string, error)
}

// Ctx carries the engine services a template needs while rendering. It also
// holds the helpers the hand-coded (non-template) primitives consume — esc,
// anchor, render_evidence — mirroring the dict ctx the Python engine threads.
type Ctx struct {
	Palette  *palette.Palette
	Registry Registry
	// AnchorAttr returns the core-owned ` data-cf-change="id"` attribute (with a
	// leading space) for a block, or "". May be nil in non-page contexts.
	AnchorAttr func(block any) string
	// Anchor is the content-addressed anchor for a node/section/item: pass the
	// slug plus 0, 1 or 2 numeric parts (section, item). Returns (id, cf-name).
	Anchor func(slug string, parts ...int) (string, string)
	// RenderEvidence renders the additive evidence drill-down for a node/item.
	RenderEvidence func(block *wire.OrderedMap) string
	// Doc is the whole source doc-tree (compose/evidence may consult it).
	Doc any
}

// Esc is the engine escaper: None/nil -> "", else Python str() + html.escape.
func (c *Ctx) Esc(v any) string { return wire.Esc(v) }

// Frame is one scope-chain entry: @-prefixed loop/root bindings.
type Frame = map[string]any

const sentinelMissing = "\x00__missing__\x00"

// resolve walks a dotted path against the scope chain (innermost first).
// THE scope rule (load-bearing): a bare field resolves
// against the NEAREST @item only; it does NOT fall through to an enclosing
// scope. Reach outward with an explicit @root/@next/@prev. Any missing leg -> nil.
func resolve(path string, env []Frame) any {
	if path == "" {
		return nil
	}
	toks := strings.Split(path, ".")
	head, rest := toks[0], toks[1:]

	var val any = sentinelMissing
	for _, frame := range env {
		if v, ok := frame[head]; ok {
			val = v
			break
		}
	}
	if s, ok := val.(string); ok && s == sentinelMissing {
		// Bare field: nearest @item only, no parent fall-through.
		val = nil
		for _, frame := range env {
			if obj, ok := frame["@item"]; ok {
				if om, ok := obj.(*wire.OrderedMap); ok {
					val, _ = om.Get(head)
				} else {
					val = nil
				}
				break
			}
		}
	}

	for _, t := range rest {
		if val == nil {
			return nil
		}
		switch cur := val.(type) {
		case *wire.OrderedMap:
			val, _ = cur.Get(t)
		case []any:
			idx, err := strconv.Atoi(t)
			if err != nil || idx < 0 || idx >= len(cur) {
				return nil
			}
			val = cur[idx]
		default:
			return nil
		}
	}
	return val
}

// --- truthiness & equality (Python semantics) ------------------------------

func pyTruthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		f, err := x.Float64()
		return err == nil && f != 0
	case float64:
		return x != 0
	case int:
		return x != 0
	case []any:
		return len(x) > 0
	case *wire.OrderedMap:
		return x.Len() > 0
	default:
		return true
	}
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}

// pyEqual mirrors Python ==: numbers compare numerically (5 == 5.0), strings to
// strings, bools to bools; a number is never equal to a string.
func pyEqual(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if ab, ok := a.(bool); ok {
		bb, ok := b.(bool)
		return ok && ab == bb
	}
	if bb, ok := b.(bool); ok {
		_ = bb
		return false
	}
	af, aok := toFloat(a)
	bf, bok := toFloat(b)
	if aok && bok {
		return af == bf
	}
	if aok != bok {
		return false // number vs non-number
	}
	as, aok := a.(string)
	bs, bok := b.(string)
	if aok && bok {
		return as == bs
	}
	return false
}

// --- conditions ------------------------------------------------------------

func evalCond(cond any, env []Frame) (bool, error) {
	m, ok := cond.(map[string]any)
	if !ok || len(m) != 1 {
		return false, terr("condition must be a single-key dict, got %#v", cond)
	}
	var op string
	var arg any
	for k, v := range m {
		op, arg = k, v
	}
	switch op {
	case "truthy":
		return pyTruthy(resolve(asStr(arg), env)), nil
	case "falsy":
		return !pyTruthy(resolve(asStr(arg), env)), nil
	case "eq":
		pair, _ := arg.([]any)
		if len(pair) != 2 {
			return false, terr("eq needs [path, value], got %#v", arg)
		}
		return pyEqual(resolve(asStr(pair[0]), env), pair[1]), nil
	case "and":
		for _, c := range asList(arg) {
			ok, err := evalCond(c, env)
			if err != nil {
				return false, err
			}
			if !ok {
				return false, nil
			}
		}
		return true, nil
	case "or":
		for _, c := range asList(arg) {
			ok, err := evalCond(c, env)
			if err != nil {
				return false, err
			}
			if ok {
				return true, nil
			}
		}
		return false, nil
	case "not":
		ok, err := evalCond(arg, env)
		return !ok, err
	case "any":
		am, _ := arg.(map[string]any)
		lst := asList(resolve(asStr(am["in"]), env))
		field := asStr(am["field"])
		for _, it := range lst {
			if om, ok := it.(*wire.OrderedMap); ok {
				if v, _ := om.Get(field); pyTruthy(v) {
					return true, nil
				}
			}
		}
		return false, nil
	case "in":
		pair, _ := arg.([]any)
		if len(pair) != 2 {
			return false, terr("in needs [path, choices], got %#v", arg)
		}
		val := resolve(asStr(pair[0]), env)
		for _, c := range asList(pair[1]) {
			if pyEqual(val, c) {
				return true, nil
			}
		}
		return false, nil
	case "eqp":
		pair, _ := arg.([]any)
		if len(pair) != 2 {
			return false, terr("eqp needs [pathA, pathB], got %#v", arg)
		}
		return pyEqual(resolve(asStr(pair[0]), env), resolve(asStr(pair[1]), env)), nil
	case "isdict":
		_, ok := resolve(asStr(arg), env).(*wire.OrderedMap)
		return ok, nil
	}
	return false, terr("unknown condition op %q", op)
}

// --- rendering -------------------------------------------------------------

// Render renders a template (list of nodes) for a data block.
func Render(tmpl []any, data *wire.OrderedMap, ctx *Ctx) (string, error) {
	env := []Frame{{"@item": data, "@root": data}}
	return renderNodes(tmpl, env, ctx)
}

func renderNodes(nodes any, env []Frame, ctx *Ctx) (string, error) {
	list, ok := nodes.([]any)
	if !ok {
		if nodes == nil {
			return "", nil
		}
		return "", terr("template body must be a list of nodes, got %T", nodes)
	}
	var b strings.Builder
	for _, n := range list {
		s, err := renderNode(n, env, ctx)
		if err != nil {
			return "", err
		}
		b.WriteString(s)
	}
	return b.String(), nil
}

func renderNode(node any, env []Frame, ctx *Ctx) (string, error) {
	if s, ok := node.(string); ok {
		return s, nil // authored chrome — trusted, verbatim
	}
	m, ok := node.(map[string]any)
	if !ok || len(m) < 1 {
		return "", terr("node must be a string or a dict, got %#v", node)
	}

	if path, ok := m["esc"]; ok {
		v := resolve(asStr(path), env)
		if v == nil {
			if def, ok := m["default"]; ok {
				v = def
			}
		}
		return ctx.Esc(v), nil
	}

	if path, ok := m["anchor"]; ok {
		if ctx.AnchorAttr == nil {
			return "", nil
		}
		return ctx.AnchorAttr(resolve(asStr(path), env)), nil
	}

	if path, ok := m["palette_var"]; ok {
		if ctx.Palette == nil {
			return "", terr("palette_var requires a palette in ctx")
		}
		key := wire.PyStr(resolve(asStr(path), env))
		return ctx.Palette.Var(key)
	}

	if path, ok := m["count"]; ok {
		lst := asList(resolve(asStr(path), env))
		minN := 0
		if mv, ok := m["min"]; ok {
			if f, ok := toFloat(mv); ok {
				minN = int(f)
			}
		}
		n := len(lst)
		if minN > n {
			n = minN
		}
		return strconv.Itoa(n), nil
	}

	if path, ok := m["lookup"]; ok {
		raw := resolve(asStr(path), env)
		key, isStr := raw.(string)
		if isStr && pyTruthy(m["upper"]) {
			key = strings.ToUpper(key)
		}
		table, _ := m["table"].(map[string]any)
		if isStr {
			if v, ok := table[key]; ok {
				if s, ok := v.(string); ok {
					return s, nil
				}
				return wire.PyStr(v), nil
			}
		}
		if def, ok := m["default"]; ok {
			if s, ok := def.(string); ok {
				return s, nil
			}
			return wire.PyStr(def), nil
		}
		return "", terr("lookup miss for %#v and no default", raw)
	}

	if cond, ok := m["if"]; ok {
		yes, err := evalCond(cond, env)
		if err != nil {
			return "", err
		}
		if yes {
			return renderNodes(m["then"], env, ctx)
		}
		return renderNodes(m["else"], env, ctx)
	}

	if path, ok := m["each"]; ok {
		lst := asList(resolve(asStr(path), env))
		body := m["body"]
		join := asStr(m["join"])
		n := len(lst)
		parts := make([]string, 0, n)
		for i, item := range lst {
			frame := Frame{
				"@item": item, "@index": json.Number(strconv.Itoa(i)),
				"@first": i == 0, "@last": i == n-1,
				"@len":  json.Number(strconv.Itoa(n)),
				"@next": nextOr(lst, i+1), "@prev": prevOr(lst, i-1),
			}
			s, err := renderNodes(body, append([]Frame{frame}, env...), ctx)
			if err != nil {
				return "", err
			}
			parts = append(parts, s)
		}
		return strings.Join(parts, join), nil
	}

	if path, ok := m["each_pairs"]; ok {
		d, _ := resolve(asStr(path), env).(*wire.OrderedMap)
		body := m["body"]
		join := asStr(m["join"])
		var keys []string
		if d != nil {
			keys = d.Keys()
		}
		n := len(keys)
		parts := make([]string, 0, n)
		for i, k := range keys {
			val, _ := d.Get(k)
			frame := Frame{
				"@key": k, "@val": val, "@index": json.Number(strconv.Itoa(i)),
				"@first": i == 0, "@last": i == n-1, "@len": json.Number(strconv.Itoa(n)),
			}
			s, err := renderNodes(body, append([]Frame{frame}, env...), ctx)
			if err != nil {
				return "", err
			}
			parts = append(parts, s)
		}
		return strings.Join(parts, join), nil
	}

	if path, ok := m["compose"]; ok {
		if ctx.Registry == nil {
			return "", terr("compose requires a registry in ctx")
		}
		val := resolve(asStr(path), env)
		var blocks []any
		switch v := val.(type) {
		case []any:
			blocks = v
		case nil:
			blocks = nil
		default:
			blocks = []any{v}
		}
		var b strings.Builder
		for _, blk := range blocks {
			om, ok := blk.(*wire.OrderedMap)
			if !ok {
				continue
			}
			typ := ""
			if t, ok := om.Get("type"); ok {
				typ, _ = t.(string)
			}
			s, err := ctx.Registry.Render(typ, om, ctx)
			if err != nil {
				return "", err
			}
			b.WriteString(s)
		}
		return b.String(), nil
	}

	return "", terr("unknown template op in node %#v", node)
}

// --- small helpers ---------------------------------------------------------

func asStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func asList(v any) []any {
	if l, ok := v.([]any); ok {
		return l
	}
	return nil
}

func nextOr(lst []any, i int) any {
	if i >= 0 && i < len(lst) {
		return lst[i]
	}
	return nil
}

func prevOr(lst []any, i int) any {
	if i >= 0 && i < len(lst) {
		return lst[i]
	}
	return nil
}
