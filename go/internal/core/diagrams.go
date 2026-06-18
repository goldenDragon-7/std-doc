package core

import (
	"strings"

	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// arrStr returns the i-th element of an array as a string ("" if absent/non-string).
func arrStr(a []any, i int) string {
	if i < 0 || i >= len(a) {
		return ""
	}
	if s, ok := a[i].(string); ok {
		return s
	}
	return wire.PyStr(a[i])
}

// diagramsRender is the node-level dispatcher: iterate node['diagrams'] and
// dispatch each to mermaid (if it carries mermaid source) or ascii (diagram.py).
func diagramsRender(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	var b strings.Builder
	for _, dv := range list(block, "diagrams") {
		d, _ := omap(dv)
		typ := "ascii"
		if truthy(get(d, "mermaid")) {
			typ = "mermaid"
		}
		s, err := ctx.Registry.Render(typ, d, ctx)
		if err != nil {
			return "", err
		}
		b.WriteString(s)
	}
	return b.String(), nil
}

// statetrackSource builds the D2 source for a state machine (statetrack.py).
func statetrackSource(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	lines := []string{"direction: right"}
	for _, sv := range list(block, "states") {
		st, _ := omap(sv)
		id := getOr(st, "id", "s")
		sid := d2Ident(id)
		label := sid
		if _, ok := st.Get("id"); ok {
			label = str(st, "id")
		}
		lines = append(lines, sid+`: "`+label+`"`)
		if truthy(get(st, "ent")) {
			color, err := ctx.Palette.Color(str(st, "ent"))
			if err != nil {
				return "", err
			}
			lines = append(lines, sid+`.style.fill: "`+color+`"`)
		}
	}
	for _, tv := range list(block, "transitions") {
		tr, _ := tv.([]any)
		if len(tr) >= 2 {
			edge := d2Ident(arrStr(tr, 0)) + " -> " + d2Ident(arrStr(tr, 1))
			if len(tr) >= 3 && truthy(tr[2]) {
				edge += `: "` + arrStr(tr, 2) + `"`
			}
			lines = append(lines, edge)
		}
	}
	return strings.Join(lines, "\n"), nil
}

func statetrackRender(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	label := getOr(block, "label", "state-track")
	src, err := statetrackSource(block, ctx)
	if err != nil {
		return "", err
	}
	if svg := renderD2SVG(src); svg != "" {
		return d2DiagramCard(svg, label), nil
	}
	return d2SourceBlock(src, label, "d2/mermaid renderer not on PATH"), nil
}

// swimlaneSource builds the D2 source for a swimlane (swimlane.py).
func swimlaneSource(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	lines := []string{"direction: right"}
	for _, lv := range list(block, "lanes") {
		lane, _ := omap(lv)
		name := getOr(lane, "name", "lane")
		color := "#888888"
		if truthy(get(lane, "ent")) {
			c, err := ctx.Palette.Color(str(lane, "ent"))
			if err != nil {
				return "", err
			}
			color = c
		}
		key := d2Ident(name)
		lines = append(lines, key+`: "`+name+`" {`)
		lines = append(lines, `  style.fill: "`+color+`"`)
		prev := ""
		havePrev := false
		for _, stepv := range list(lane, "steps") {
			step := ""
			if s, ok := stepv.(string); ok {
				step = s
			} else {
				step = wire.PyStr(stepv)
			}
			skey := d2Ident(name + "_" + step)
			lines = append(lines, `  `+skey+`: "`+step+`"`)
			if havePrev {
				lines = append(lines, "  "+prev+" -> "+skey)
			}
			prev = skey
			havePrev = true
		}
		lines = append(lines, "}")
	}
	for _, ev := range list(block, "flow") {
		edge, _ := ev.([]any)
		if len(edge) == 2 {
			lines = append(lines, d2Ident(arrStr(edge, 0))+" -> "+d2Ident(arrStr(edge, 1)))
		}
	}
	return strings.Join(lines, "\n"), nil
}

func swimlaneRender(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
	label := getOr(block, "label", "swimlane")
	src, err := swimlaneSource(block, ctx)
	if err != nil {
		return "", err
	}
	if svg := renderD2SVG(src); svg != "" {
		return d2DiagramCard(svg, label), nil
	}
	return d2SourceBlock(src, label, ""), nil
}
