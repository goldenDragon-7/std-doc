package core

import (
	"strings"

	"stddoc/internal/wire"
)

// getOr returns the string value at key, or def if the key is absent (Python
// dict.get(key, default) — absent only, an explicit "" is kept).
func getOr(n *wire.OrderedMap, key, def string) string {
	if v, ok := n.Get(key); ok {
		if s, ok := v.(string); ok {
			return s
		}
		return wire.PyStr(v)
	}
	return def
}

// renderNav renders the left sidebar. current is the current node's slug; when
// isIndex is true the index page is current (Python's current=None).
func renderNav(doc *wire.OrderedMap, current string, isIndex bool) string {
	roots := buildTree(doc)
	onPath := map[string]bool{}
	if !isIndex {
		if cur := bySlug(doc, current); cur != nil {
			onPath[str(cur, "slug")] = true
			for _, a := range ancestors(cur) {
				onPath[str(a, "slug")] = true
			}
		}
	}
	var h strings.Builder
	h.WriteString("<aside class='nav'>")
	h.WriteString("<div class='brand'>" + esc(getOr(doc, "title", "Doc")) + "</div>")
	h.WriteString("<div class='cf-search-box'>" +
		"<input id='cf-search' type='search' placeholder='Search…' " +
		"autocomplete='off' spellcheck='false'>" +
		"<div id='cf-search-results'></div></div>")
	ra := ""
	if isIndex {
		ra = " active"
	}
	h.WriteString("<a class='root" + ra + "' href='index.html'>&#9672; index</a>")
	h.WriteString(renderNavLevel(roots, current, isIndex, onPath, 0))
	h.WriteString("</aside>")
	return h.String()
}

func renderNavLevel(roots []any, current string, isIndex bool, onPath map[string]bool, depth int) string {
	if len(roots) == 0 {
		return ""
	}
	var h strings.Builder
	h.WriteString("<ul class='nav-tree d" + itoa(min6(depth)) + "'>")
	for _, nv := range roots {
		n, _ := omap(nv)
		var cls []string
		if !isIndex && str(n, "slug") == current {
			cls = append(cls, "active")
		}
		if onPath[str(n, "slug")] {
			cls = append(cls, "onpath")
		}
		st := strings.ToUpper(str(n, "status"))
		badge := ""
		if st != "" && !truthy(get(n, "is_group")) {
			badge = "<span class='s " + statusClass(st) + "'>" + esc(st) + "</span>"
		}
		h.WriteString("<li><a class='" + strings.Join(cls, " ") + "' href='" + esc(str(n, "slug")) + ".html'>" +
			"<span class='nn'>" + esc(get(n, "_number")) + "</span>" +
			"<span class='nt'>" + esc(navLabel(str(n, "title"))) + "</span>" + badge + "</a>")
		if len(list(n, "children")) > 0 {
			h.WriteString(renderNavLevel(list(n, "children"), current, isIndex, onPath, depth+1))
		}
		h.WriteString("</li>")
	}
	h.WriteString("</ul>")
	return h.String()
}

func renderBreadcrumb(n *wire.OrderedMap) string {
	crumbs := []string{"<a href='index.html'>&#9672;</a>"}
	anc := ancestors(n)
	for i := len(anc) - 1; i >= 0; i-- {
		a := anc[i]
		crumbs = append(crumbs, "<a href='"+esc(str(a, "slug"))+".html'>"+
			esc(get(a, "_number"))+" "+esc(navLabel(str(a, "title")))+"</a>")
	}
	crumbs = append(crumbs, "<span class='here'>"+esc(get(n, "_number"))+" "+
		esc(navLabel(str(n, "title")))+"</span>")
	return "<nav class='crumb'>" + strings.Join(crumbs, " <span class='sep'>&rsaquo;</span> ") + "</nav>"
}

func renderOutline(roots []any, depth int) string {
	if len(roots) == 0 {
		return ""
	}
	var h strings.Builder
	h.WriteString("<ul class='outline d" + itoa(min6(depth)) + "'>")
	for _, nv := range roots {
		n, _ := omap(nv)
		h.WriteString("<li><a href='" + esc(str(n, "slug")) + ".html'>" +
			"<span class='onum'>" + esc(get(n, "_number")) + "</span>" +
			"<b>" + esc(navLabel(str(n, "title"))) + "</b></a>")
		if truthy(get(n, "tagline")) {
			h.WriteString(" <span class='ot'>" + esc(str(n, "tagline")) + "</span>")
		}
		if len(list(n, "children")) > 0 {
			h.WriteString(renderOutline(list(n, "children"), depth+1))
		}
		h.WriteString("</li>")
	}
	h.WriteString("</ul>")
	return h.String()
}

func min6(d int) int {
	if d > 6 {
		return 6
	}
	return d
}
