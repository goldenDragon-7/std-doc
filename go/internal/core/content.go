package core

import (
	"strings"

	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// pyOr returns a if truthy, else b (Python `a or b`).
func pyOr(a, b any) any {
	if truthy(a) {
		return a
	}
	return b
}

func isScalar(v any) bool {
	switch v.(type) {
	case nil, string, bool, wire.OrderedMap:
		return true
	}
	switch v.(type) {
	case []any, *wire.OrderedMap:
		return false
	}
	return true // json.Number, int, float
}

func isEmpty(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return x == ""
	case []any:
		return len(x) == 0
	case *wire.OrderedMap:
		return x.Len() == 0
	}
	return false
}

// renderGeneric is the shape-agnostic renderer — nothing dropped, any JSON
// shape (publish.render_generic).
func renderGeneric(v any) string {
	if isEmpty(v) {
		return ""
	}
	if isScalar(v) {
		return esc(v)
	}
	if l, ok := v.([]any); ok {
		allScalar := true
		for _, x := range l {
			if !isScalar(x) {
				allScalar = false
				break
			}
		}
		if allScalar {
			var b strings.Builder
			b.WriteString("<ul class='gen-list'>")
			for _, x := range l {
				b.WriteString("<li>" + esc(x) + "</li>")
			}
			b.WriteString("</ul>")
			return b.String()
		}
		var b strings.Builder
		for _, x := range l {
			b.WriteString("<div class='gen-block'>" + renderGeneric(x) + "</div>")
		}
		return b.String()
	}
	if m, ok := v.(*wire.OrderedMap); ok {
		var b strings.Builder
		for _, k := range m.Keys() {
			val, _ := m.Get(k)
			inner := renderGeneric(val)
			if inner != "" {
				b.WriteString("<div class='kv'><span class='k'>" + esc(k) + "</span>" + inner + "</div>")
			}
		}
		return b.String()
	}
	return esc(v)
}

// renderEvidence is the additive evidence drill-down for a node or item
// (publish.render_evidence). Returns "" when absent.
func renderEvidence(obj *wire.OrderedMap) string {
	ev, _ := get(obj, "evidence").(*wire.OrderedMap)
	if ev == nil || ev.Len() == 0 {
		return ""
	}
	var h strings.Builder
	h.WriteString("<div class='evidence'><h2>Evidence &amp; provenance</h2>")

	prov, _ := get(ev, "provenance").(*wire.OrderedMap)
	if prov != nil {
		if srcs := list(prov, "sources"); len(srcs) > 0 {
			h.WriteString("<div class='prov'>")
			for _, sv := range srcs {
				s, _ := omap(sv)
				h.WriteString("<span class='src'>" + esc(get(s, "ref")) + "</span>")
			}
			h.WriteString("</div>")
		}
	}

	forensic, _ := get(ev, "forensic").(*wire.OrderedMap)
	if forensic != nil {
		for _, dv := range list(forensic, "documents") {
			d, _ := omap(dv)
			md := str(d, "markdown")
			lines := strings.Count(md, "\n") + 1
			h.WriteString("<details class='ev-node'><summary>&#128196; " +
				esc(pyOr(get(d, "title"), get(d, "ref"))) +
				"<span class='ev-meta'>" + itoa(lines) + " lines</span></summary>" +
				"<div class='ev-body'><pre class='ev-md'>" + esc(md) + "</pre></div></details>")
		}
	}

	for _, key := range ev.Keys() {
		if key == "provenance" || key == "related" {
			continue
		}
		val, _ := ev.Get(key)
		if key == "forensic" {
			if fm, ok := val.(*wire.OrderedMap); ok && onlyKey(fm, "documents") {
				continue
			}
		}
		inner := renderGeneric(val)
		if inner != "" {
			h.WriteString("<details class='ev-node'><summary>&#128300; " + esc(key) +
				"</summary><div class='ev-body'>" + inner + "</div></details>")
		}
	}

	for _, rv := range list(ev, "related") {
		r, _ := omap(rv)
		h.WriteString("<div class='kv'>&#8627; <b>" + esc(pyOr(get(r, "title"), get(r, "ref"))) +
			"</b> &mdash; " + esc(get(r, "note")) + "</div>")
	}

	h.WriteString("</div>")
	return h.String()
}

// onlyKey reports whether m's keys are a subset of {only}.
func onlyKey(m *wire.OrderedMap, only string) bool {
	for _, k := range m.Keys() {
		if k != only {
			return false
		}
	}
	return true
}

// sectionsRender is the hand-coded sections/items/citations region
// (primitives/sections.py). The block IS the node.
func sectionsRender(n *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	num := str(n, "_number")
	var h strings.Builder
	secs := list(n, "sections")
	if len(secs) > 0 {
		h.WriteString("<h2>Sections</h2>")
	}
	for j0, sv := range secs {
		j := j0 + 1
		s, _ := omap(sv)
		sid, sanchor := ctx.Anchor(str(n, "slug"), j)
		h.WriteString("<div class='section' id='" + sid + "' data-cf-anchor='" + esc(sanchor) + "'>" +
			"<div class='section-head'>")
		if truthy(get(s, "icon")) {
			h.WriteString("<span>" + esc(str(s, "icon")) + "</span>")
		}
		secNo := "&sect;" + itoa(j)
		if num != "" {
			secNo = num + " &sect;" + itoa(j)
		}
		h.WriteString("<h3><span class='secnum'>" + secNo + "</span>" + esc(get(s, "name")) + "</h3>")
		if truthy(get(s, "tag")) {
			h.WriteString("<span class='tag'>" + esc(str(s, "tag")) + "</span>")
		}
		h.WriteString("</div>")
		if truthy(get(s, "summary")) {
			h.WriteString("<div class='summary'>" + esc(str(s, "summary")) + "</div>")
		}
		for k0, iv := range list(s, "items") {
			k := k0 + 1
			it, _ := omap(iv)
			iid, ianchor := ctx.Anchor(str(n, "slug"), j, k)
			h.WriteString("<div class='item' id='" + iid + "' data-cf-anchor='" + esc(ianchor) + "'>" +
				"<div class='item-name'>" + esc(get(it, "name")) + "</div>")
			if truthy(get(it, "desc")) {
				h.WriteString("<div class='item-desc'>" + esc(str(it, "desc")) + "</div>")
			}
			if cites := list(it, "citations"); len(cites) > 0 {
				h.WriteString("<ul class='impl'>")
				for _, cv := range cites {
					c, _ := omap(cv)
					line := ""
					if truthy(get(c, "line")) {
						line = "<span class='line'>:" + esc(get(c, "line")) + "</span>"
					}
					evd := ""
					if truthy(get(c, "evidence")) {
						evd = "<span class='ev " + esc(get(c, "evidence")) + "'>" + esc(get(c, "evidence")) + "</span>"
					}
					note := ""
					if truthy(get(c, "note")) {
						note = "<span class='note'>" + esc(get(c, "note")) + "</span>"
					}
					h.WriteString("<li>" + esc(get(c, "path")) + line + evd + note + "</li>")
				}
				h.WriteString("</ul>")
			}
			h.WriteString(ctx.RenderEvidence(it))
			h.WriteString("</div>")
		}
		h.WriteString("</div>")
	}
	return h.String(), nil
}
