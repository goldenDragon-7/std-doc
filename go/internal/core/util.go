// Package core is the page-assembly layer: anchors, numbering, nav, breadcrumb,
// the page shell, CSS dedup, and the node/section/evidence emission the Python
// engine owns around primitive output. Port of engine/scripts/publish.py +
// engine/core/blocks.py. The core owns the shell; the registry owns blocks.
package core

import (
	"regexp"
	"strconv"
	"strings"

	"stddoc/internal/wire"
)

// esc is the engine escaper (None/nil -> "", else Python str() + html.escape).
func esc(v any) string { return wire.Esc(v) }

func itoa(i int) string { return strconv.Itoa(i) }

// --- node accessors (a node is a *wire.OrderedMap) -------------------------

func get(n *wire.OrderedMap, key string) any {
	if n == nil {
		return nil
	}
	v, _ := n.Get(key)
	return v
}

// str returns a string-typed field, "" if absent/nil. Non-strings stringify via
// Python str() parity (matches n.get(k, "") then esc/f-string usage).
func str(n *wire.OrderedMap, key string) string {
	v := get(n, key)
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return wire.PyStr(v)
}

func list(n *wire.OrderedMap, key string) []any {
	if l, ok := get(n, key).([]any); ok {
		return l
	}
	return nil
}

func omap(v any) (*wire.OrderedMap, bool) {
	m, ok := v.(*wire.OrderedMap)
	return m, ok
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case bool:
		return x
	case []any:
		return len(x) > 0
	case *wire.OrderedMap:
		return x.Len() > 0
	default:
		return true
	}
}

// --- string helpers (publish.py parity) ------------------------------------

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	out := slugRe.ReplaceAllString(strings.ToLower(s), "-")
	out = strings.Trim(out, "-")
	if out == "" {
		return "section"
	}
	return out
}

// navLabel trims a title at its first separator (publish.nav_label).
func navLabel(t string) string {
	for _, sep := range []string{" — ", " · ", " (", " - "} {
		t = strings.Split(t, sep)[0]
	}
	return t
}

func statusClass(s string) string {
	switch strings.ToUpper(s) {
	case "LIVE":
		return "b-live"
	case "PARTIAL":
		return "b-partial"
	case "WIP":
		return "b-wip"
	case "DEBT":
		return "b-debt"
	default:
		return "b-wip"
	}
}

// anchor is the deterministic, content-addressed anchor for a node/section/item
// (publish.anchor). parts holds 0, 1 (section) or 2 (section,item) numbers.
func anchor(slug string, parts ...int) (id, name string) {
	id, name = "cf-"+slug, "n="+slug
	if len(parts) >= 1 {
		id += "-s" + strconv.Itoa(parts[0])
		name += "§" + strconv.Itoa(parts[0])
		if len(parts) >= 2 {
			id += "-i" + strconv.Itoa(parts[1])
			name += "." + strconv.Itoa(parts[1])
		}
	}
	return id, name
}
