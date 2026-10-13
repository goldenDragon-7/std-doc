package core

import (
	"strings"

	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// treeRender is the hand-coded renderer for the tree primitive — a first-class
// decision hierarchy rendered as nested semantic <ul>/<li> lists. The parent ->
// child nesting IS the cascade; a node's `decision` colors its left border and
// pill via the td-<key> class (color means the decision). Output is
// byte-identical to the Python primitive — the conformance gate is the proof.
//
// Three additive capabilities ride on top, each INERT unless the doc asks:
//
//   - collapse/expand — `collapsible: true` on the block renders every node
//     that has children as <details>/<summary>. A 375-node atlas is unusable as
//     a flat <ul>; this is what makes it navigable. Node `open: true` starts
//     that branch expanded.
//   - open vocabulary — `decisions: [{key,label,color}]` REPLACES the built-in
//     keep/refactor/rewrite/trash set, so a tree can classify by any axis. An
//     undeclared decision no longer renders as nothing: it gets an uppercased
//     pill (silent drops are the bug class we keep killing).
//   - leaf links — `href` on a node makes its label a link.
//
// Absent all three fields the emitted bytes are exactly what they were before
// they existed, which is what keeps the strangler proof honest.

// treeDec is one entry of a tree's decision vocabulary.
type treeDec struct{ key, label, color string }

// treeDefaultDecisions is the built-in vocabulary (key -> pill/legend label),
// used whenever the block declares no `decisions`. Order drives the legend, and
// the colors live in the stylesheet (.td-keep{--dc:var(--green)} …).
var treeDefaultDecisions = []treeDec{
	{key: "keep", label: "KEEP"},
	{key: "refactor", label: "REFACTOR"},
	{key: "rewrite", label: "REWRITE"},
	{key: "trash", label: "TRASH"},
}

// treeVocab resolves the block's decision vocabulary: the declared one if the
// block carries `decisions`, else the built-in four.
func treeVocab(block *wire.OrderedMap) []treeDec {
	declared := list(block, "decisions")
	if len(declared) == 0 {
		return treeDefaultDecisions
	}
	out := make([]treeDec, 0, len(declared))
	for _, dv := range declared {
		d, ok := omap(dv)
		if !ok {
			continue
		}
		key := strings.TrimSpace(str(d, "key"))
		if key == "" {
			continue
		}
		label := str(d, "label")
		if label == "" {
			label = strings.ToUpper(key)
		}
		out = append(out, treeDec{key: key, label: label, color: cssColorSafe(str(d, "color"))})
	}
	if len(out) == 0 {
		return treeDefaultDecisions
	}
	return out
}

// treeSlug reduces a decision key to a safe CSS class suffix, so an
// author-supplied key can never break out of the class attribute.
func treeSlug(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteByte('-')
		}
	}
	return b.String()
}

// cssColorSafe admits only characters that can appear in a CSS color value —
// hex, rgb()/hsl(), var(), or a keyword. Anything else yields "" (no color
// rather than an injection point). The value lands in a style attribute.
func cssColorSafe(s string) string {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 64 {
		return ""
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '#' || r == '(' || r == ')' || r == ',' || r == ' ' ||
			r == '.' || r == '%' || r == '-' || r == '_':
		default:
			return ""
		}
	}
	return s
}

// treeVariantCSS contributes styling ONLY for the capabilities a given tree
// actually uses — the collapse affordance and the link treatment. A tree that
// uses neither contributes nothing, keeping every existing page byte-identical.
func treeVariantCSS(block *wire.OrderedMap) string {
	collapsible := truthy(get(block, "collapsible"))
	linked := treeHasHref(list(block, "nodes"))
	var css strings.Builder
	if collapsible {
		css.WriteString(".tn-det>summary{cursor:pointer;list-style:none}" +
			".tn-det>summary::-webkit-details-marker{display:none}" +
			".tn-det>summary::after{content:'\\25B8';margin-left:auto;font-size:.7rem;" +
			"color:var(--text-dim);transition:transform .15s ease}" +
			".tn-det[open]>summary::after{transform:rotate(90deg)}")
	}
	if linked {
		css.WriteString(".tn-label a{color:inherit;text-decoration:none;" +
			"border-bottom:1px dotted color-mix(in srgb,currentColor 45%,transparent)}" +
			".tn-label a:hover{border-bottom-color:currentColor}")
	}
	return css.String()
}

// treeHasHref reports whether any node in the subtree carries a link.
func treeHasHref(nodes []any) bool {
	for _, nv := range nodes {
		n, ok := omap(nv)
		if !ok {
			continue
		}
		if truthy(get(n, "href")) {
			return true
		}
		if treeHasHref(list(n, "children")) {
			return true
		}
	}
	return false
}

func treeRender(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	vocab := treeVocab(block)
	labels := make(map[string]string, len(vocab))
	colors := make(map[string]string, len(vocab))
	for _, d := range vocab {
		labels[d.key] = d.label
		colors[d.key] = d.color
	}
	collapsible := truthy(get(block, "collapsible"))

	var h strings.Builder
	h.WriteString("<div class='tree-wrap'>")
	if labelv := get(block, "label"); truthy(labelv) {
		h.WriteString("<div class='tree-cap'>" + esc(labelv) + "</div>")
	}
	legend := true
	if v, ok := block.Get("legend"); ok {
		legend = truthy(v)
	}
	if legend {
		h.WriteString("<div class='tree-legend'>")
		for _, d := range vocab {
			style := ""
			if d.color != "" {
				style = " style='--dc:" + d.color + "'"
			}
			h.WriteString("<span class='tl-item td-" + treeSlug(d.key) + "'" + style + ">" +
				"<span class='tl-dot'></span>" + wire.HTMLEscape(d.label) + "</span>")
		}
		h.WriteString("</div>")
	}
	h.WriteString("<ul class='tree'>")
	for _, nv := range list(block, "nodes") {
		n, _ := omap(nv)
		treeNode(n, &h, labels, colors, collapsible)
	}
	h.WriteString("</ul></div>")
	return h.String(), nil
}

func treeNode(node *wire.OrderedMap, h *strings.Builder, labels, colors map[string]string, collapsible bool) {
	dec := str(node, "decision")
	declbl, declared := labels[dec]
	known := declared
	// Open vocabulary: an undeclared decision still shows, uppercased. Before,
	// it rendered as nothing at all — authored content silently discarded.
	if !declared && strings.TrimSpace(dec) != "" {
		declbl, known = strings.ToUpper(dec), true
	}
	cls, style := "", ""
	if known {
		if s := treeSlug(dec); s != "" {
			cls = " td-" + s
		}
		switch {
		case colors[dec] != "":
			style = " style='--dc:" + colors[dec] + "'"
		case !declared:
			// An UNCLASSIFIED node must not inherit its parent's color: --dc
			// cascades, so without this a stray key wears its ancestor's verdict
			// and the page asserts something the data never said. Colour means
			// things; neutral is the honest answer for "not in the vocabulary".
			//
			// `initial` — not a concrete color — because the stylesheet gives each
			// element a DIFFERENT fallback (--text-dim for the pill, --border for
			// the rule). Setting --dc to the guaranteed-invalid value makes every
			// var(--dc, …) resolve to its own fallback; pinning one color instead
			// painted the pill's text in the border color and made it unreadable.
			style = " style='--dc:initial'"
		}
	}
	children := list(node, "children")
	// A node folds only when it is collapsible AND has something to fold.
	fold := collapsible && len(children) > 0

	h.WriteString("<li class='tnode" + cls + "'" + style + ">")
	if fold {
		open := ""
		if truthy(get(node, "open")) {
			open = " open"
		}
		h.WriteString("<details class='tn-det'" + open + "><summary class='tn-row'>")
	} else {
		h.WriteString("<div class='tn-row'>")
	}

	h.WriteString("<span class='tn-label'>")
	if hrefv := get(node, "href"); truthy(hrefv) {
		h.WriteString("<a href='" + esc(hrefv) + "'>" + esc(get(node, "label")) + "</a>")
	} else {
		h.WriteString(esc(get(node, "label")))
	}
	h.WriteString("</span>")

	if known {
		h.WriteString("<span class='tn-dec'>" + wire.HTMLEscape(declbl) + "</span>")
	}
	if subv := get(node, "sublabel"); truthy(subv) {
		h.WriteString("<span class='tn-sub'>" + esc(subv) + "</span>")
	}
	if fold {
		h.WriteString("</summary>")
	} else {
		h.WriteString("</div>")
	}

	if notev := get(node, "note"); truthy(notev) {
		h.WriteString("<div class='tn-note'>" + esc(notev) + "</div>")
	}
	if len(children) > 0 {
		h.WriteString("<ul class='tree-children'>")
		for _, cv := range children {
			c, _ := omap(cv)
			treeNode(c, h, labels, colors, collapsible)
		}
		h.WriteString("</ul>")
	}
	if fold {
		h.WriteString("</details>")
	}
	h.WriteString("</li>")
}
