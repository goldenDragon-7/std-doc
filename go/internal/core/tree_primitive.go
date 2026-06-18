package core

import (
	"strings"

	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// treeRender is the hand-coded renderer for the tree primitive — a first-class
// decision hierarchy rendered as nested semantic <ul>/<li> lists. The parent ->
// child nesting IS the cascade; a node's `decision` ∈ {keep,refactor,rewrite,
// trash} colors its left border and pill via the td-<key> class (color means the
// decision). Output is byte-identical to the Python primitive — the conformance
// gate is the proof.

// treeDecisions is the ordered decision vocabulary (key -> legend/pill label),
// the canonical decision set. Order drives the legend.
var treeDecisions = []struct{ key, label string }{
	{"keep", "KEEP"},
	{"refactor", "REFACTOR"},
	{"rewrite", "REWRITE"},
	{"trash", "TRASH"},
}

var treeDecLabel = map[string]string{
	"keep": "KEEP", "refactor": "REFACTOR", "rewrite": "REWRITE", "trash": "TRASH",
}

func treeRender(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
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
		for _, d := range treeDecisions {
			h.WriteString("<span class='tl-item td-" + d.key + "'>" +
				"<span class='tl-dot'></span>" + d.label + "</span>")
		}
		h.WriteString("</div>")
	}
	h.WriteString("<ul class='tree'>")
	for _, nv := range list(block, "nodes") {
		n, _ := omap(nv)
		treeNode(n, &h)
	}
	h.WriteString("</ul></div>")
	return h.String(), nil
}

func treeNode(node *wire.OrderedMap, h *strings.Builder) {
	dec := str(node, "decision")
	declbl, known := treeDecLabel[dec]
	cls := ""
	if known {
		cls = " td-" + dec
	}
	h.WriteString("<li class='tnode" + cls + "'><div class='tn-row'>" +
		"<span class='tn-label'>" + esc(get(node, "label")) + "</span>")
	if known {
		h.WriteString("<span class='tn-dec'>" + declbl + "</span>")
	}
	if subv := get(node, "sublabel"); truthy(subv) {
		h.WriteString("<span class='tn-sub'>" + esc(subv) + "</span>")
	}
	h.WriteString("</div>")
	if notev := get(node, "note"); truthy(notev) {
		h.WriteString("<div class='tn-note'>" + esc(notev) + "</div>")
	}
	children := list(node, "children")
	if len(children) > 0 {
		h.WriteString("<ul class='tree-children'>")
		for _, cv := range children {
			c, _ := omap(cv)
			treeNode(c, h)
		}
		h.WriteString("</ul>")
	}
	h.WriteString("</li>")
}
