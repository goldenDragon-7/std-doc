package core

import (
	"strings"

	"stddoc/internal/library"
	"stddoc/internal/palette"
	"stddoc/internal/registry"
	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// head renders the page shell up to <main> (publish.head). styleRoot is the
// selected :root token block; current is the node slug (isIndex => index page).
func head(title string, doc *wire.OrderedMap, current string, isIndex bool, styleRoot string, lib *library.Library) string {
	css := styleRoot + "\n" + lib.BodyCSS
	shell := "shell"
	nav := renderNav(doc, current, isIndex)
	shellStyle := ""
	if isPager(doc) {
		// Pager docs drop the left-nav tree for a single-column shell; PAGER_CSS
		// rides only here so tree-nav output stays byte-identical.
		css += "\n" + pagerCSS
		shell = "shell pager-shell"
		nav = ""
		shellStyle = pagerShellStyle(doc, current, isIndex)
	} else {
		// Layout MODES (see layout.go). Each mode's CSS rides ONLY here, so a doc
		// with no `layout` field is byte-identical to today's left-nav shell
		// (conformance holds). Unknown/absent → left-nav (this switch is a no-op).
		switch layoutMode(doc) {
		case "no-nav":
			css += "\n" + nonavCSS
			shell = "shell nonav-shell"
			nav = ""
		case "top-nav":
			css += "\n" + topnavCSS
			shell = "shell topnav-shell"
			nav = renderTopNav(doc, current, isIndex)
		case "hero":
			css += "\n" + heroCSS
			shell = "shell hero-shell"
			nav = ""
		case "reference":
			// Keeps the rail (it is a reference doc — the nav is load-bearing) and
			// adds the third column. The aside itself is emitted after </main> by
			// renderNode, since it is derived from the NODE, not the doc.
			css += "\n" + referenceCSS
			shell = "shell reference-shell"
		}
	}
	return "<!doctype html><html><head><meta charset='utf-8'>" +
		"<meta name='viewport' content='width=device-width,initial-scale=1'>" +
		"<title>" + esc(title) + "</title><style>" + css + "</style>" +
		"<script src='search-index.js' defer></script>" +
		"<script>" + lib.SearchJS + "</script>" +
		"<script>" + lib.NavScrollJS + "</script></head><body>" +
		"<div class='" + shell + "'" + shellStyle + ">" + nav + "<main class='wrap'>"
}

// makeCtx assembles the render ctx for a doc page (mirrors render_node's ctx).
// AnchorAttr stays nil in doc-tree mode (no anchor_attr in publish's ctx), so a
// template anchor op renders "".
func makeCtx(doc *wire.OrderedMap, reg *registry.Registry, pal *palette.Palette) *template.Ctx {
	return &template.Ctx{
		Palette:        pal,
		Registry:       reg,
		Anchor:         anchor,
		RenderEvidence: renderEvidence,
		RichText:       richText,
		RichTextCode:   richTextCode,
		Doc:            doc,
	}
}

func renderNode(n, doc *wire.OrderedMap, reg *registry.Registry, styleRoot string, lib *library.Library) string {
	buildTree(doc)
	num := str(n, "_number")
	nid, nanchor := anchor(str(n, "slug"))
	pgr := isPager(doc)
	var h strings.Builder
	h.WriteString(head(str(n, "title"), doc, str(n, "slug"), false, styleRoot, lib))
	// Narrative (pager) pages read as editorial prose: a progress header instead
	// of a breadcrumb, no legal number, no "N · " title prefix. The doc-tree path
	// keeps the breadcrumb + number, byte-identical.
	if pgr {
		h.WriteString(renderPagerTop(doc, str(n, "slug"), false))
	} else {
		h.WriteString(renderBreadcrumb(n))
	}
	title := str(n, "title")
	h1num := "<span class='h1num'>" + esc(num) + "</span>"
	if pgr {
		title = pagerNumPrefixRe.ReplaceAllString(title, "")
		h1num = ""
	}
	h.WriteString("<h1 id='" + nid + "' data-cf-anchor='" + esc(nanchor) + "'>" +
		h1num + esc(title) + "</h1>")
	// tagline is PROSE — richText, not esc. Deliberate, and reversible in two
	// lines: it completes the inline-code work rather than extending it, since
	// tagline was excluded from prose features by accident. See
	// summary_tagline_richtext_test.go for the full contract.
	if truthy(get(n, "tagline")) {
		h.WriteString("<p class='tagline'>" + richText(str(n, "tagline")) + "</p>")
	}
	palMap, _ := get(doc, "palette").(*wire.OrderedMap)
	pal := palette.New(palMap)
	ctx := makeCtx(doc, reg, pal)
	if pcss := pal.CSS(); pcss != "" {
		h.WriteString("<style>" + pcss + "</style>")
	}
	nblocks := adaptNode(n)
	assignCanvasBoardIDs(nblocks, str(n, "slug"))
	assignBandAnchorIDs(nblocks, str(n, "slug"))
	if icss := collectBlockCSS(nblocks, reg); icss != "" {
		h.WriteString("<style>" + icss + "</style>")
	}
	// Utility layer (utility.go): render the body FIRST, then emit CSS for only
	// the utility classes it actually contains. A page using none gets zero
	// bytes and stays byte-identical to the pre-utility engine.
	body := renderBlocks(nblocks, ctx, reg)
	if ucss := collectUtilityCSS(body, loadUtilityCSS(lib.UtilityCSSJSON)); ucss != "" {
		h.WriteString("<style>" + ucss + "</style>")
	}
	h.WriteString(body)
	if pgr {
		h.WriteString(renderPagerNav(doc, str(n, "slug")))
	}
	h.WriteString("<div class='footer'>Derived from source.json &middot; std-doc v2 &middot; JSON canonical, HTML rendered</div>")
	h.WriteString("</main>")
	if layoutMode(doc) == "reference" {
		h.WriteString(renderOnThisPage(n, nblocks))
	}
	h.WriteString("</div></body></html>")
	return h.String()
}

// renderOnThisPage builds the reference layout's third column. It is DERIVED —
// the label list comes from collectTOCLabels, which walks the SAME adapted
// block stream the page body renders (sections[].name, unchanged, plus any
// band.label/band.title at any depth) — so nothing is authored twice and the
// aside cannot drift from the page it indexes. Emitted only in reference mode;
// every other layout never calls it, which is what keeps the strangler proof
// intact. A doc with no band collects nothing from step 2, so its aside is
// byte-identical to before this function grew a second source.
func renderOnThisPage(n *wire.OrderedMap, nblocks []streamBlock) string {
	labels := collectTOCLabels(n, nblocks)
	status := str(n, "status")
	updated := str(n, "updated")
	// An aside with nothing in it is chrome, not information.
	if len(labels) == 0 && status == "" && updated == "" {
		return ""
	}
	var h strings.Builder
	h.WriteString("<aside class='otp'>")
	if len(labels) > 0 {
		h.WriteString("<div class='otp-head'>On this page</div><ul class='otp-list'>")
		for _, l := range labels {
			h.WriteString("<li><a href='#" + esc(l.Anchor) + "'>" + esc(l.Text) + "</a></li>")
		}
		h.WriteString("</ul>")
	}
	if status != "" || updated != "" {
		h.WriteString("<dl class='otp-meta'>")
		if status != "" {
			h.WriteString("<dt>Status</dt><dd>" + esc(status) + "</dd>")
		}
		if updated != "" {
			h.WriteString("<dt>Updated</dt><dd>" + esc(updated) + "</dd>")
		}
		h.WriteString("</dl>")
	}
	h.WriteString("</aside>")
	return h.String()
}

func renderIndex(doc *wire.OrderedMap, reg *registry.Registry, styleRoot string, lib *library.Library) string {
	if isPager(doc) {
		return renderIndexPager(doc, styleRoot, lib)
	}
	r, _ := get(doc, "root").(*wire.OrderedMap)
	title := getOr(doc, "title", "Doc")
	var h strings.Builder
	h.WriteString(head(title, doc, "", true, styleRoot, lib))
	h.WriteString("<h1>" + esc(title) + "</h1>")
	if r != nil {
		// root.summary is PROSE — same CHOICE, same reversibility as node tagline.
		if truthy(get(r, "summary")) {
			h.WriteString("<p class='tagline'>" + richText(str(r, "summary")) + "</p>")
		}
		// Hero: the index DRAWS the doc's architecture (root.diagrams) right after
		// the summary — so a data-derived doc opens with a picture, not a list
		// (Covenant II). Mirrors renderNode's diagram path exactly, via the same
		// synthetic "diagrams" block + collectBlockCSS, for byte-parity of style.
		if len(list(r, "diagrams")) > 0 {
			hero := []streamBlock{{Type: "diagrams", Data: r}}
			palMap, _ := get(doc, "palette").(*wire.OrderedMap)
			ctx := makeCtx(doc, reg, palette.New(palMap))
			if css := collectBlockCSS(hero, reg); css != "" {
				h.WriteString("<style>" + css + "</style>")
			}
			h.WriteString(renderBlocks(hero, ctx, reg))
		}
		if facets, _ := get(r, "facets").(*wire.OrderedMap); facets != nil && facets.Len() > 0 {
			h.WriteString("<div class='facets'>")
			for _, k := range facets.Keys() {
				v, _ := facets.Get(k)
				h.WriteString("<div class='facet'><div class='label'>" + esc(k) + "</div><p>" + esc(v) + "</p></div>")
			}
			h.WriteString("</div>")
		}
	}
	roots := buildTree(doc)
	h.WriteString("<h2>Contents</h2>")
	h.WriteString(renderOutline(roots, 0))
	all := list(doc, "_all")
	h.WriteString("<div class='footer'>" + itoa(len(all)) + " nodes &middot; generated " +
		esc(get(doc, "generated_date")) + "</div>")
	h.WriteString("</main></div></body></html>")
	return h.String()
}

// anchorAttr is the core-owned ` data-cf-change="<id>"` attribute (with a
// leading space) for a block declaring an anchor, else "" (page.anchor_attr).
func anchorAttr(block any) string {
	b, ok := block.(*wire.OrderedMap)
	if !ok {
		return ""
	}
	a := get(b, "anchor")
	if !truthy(a) {
		return ""
	}
	return ` data-cf-change="` + wire.HTMLEscape(wire.PyStr(a)) + `"`
}

// RenderStandalone renders a layout:page doc into one bespoke page through the
// library + page atoms (core.page.render_page). Returns (html, filename).
func RenderStandalone(doc *wire.OrderedMap, lib *library.Library) (string, string, error) {
	reg, err := buildPageRegistry(lib)
	if err != nil {
		return "", "", err
	}
	palMap, _ := get(doc, "palette").(*wire.OrderedMap)
	pal := palette.New(palMap)
	ctx := &template.Ctx{
		Palette:        pal,
		Registry:       reg,
		Anchor:         anchor,
		RenderEvidence: renderEvidence,
		AnchorAttr:     anchorAttr,
		RichText:       richText,
		RichTextCode:   richTextCode,
		Doc:            doc,
	}
	title := getOr(doc, "title", "doc")
	theme := lib.Theme(str(doc, "theme"))
	extra := ""
	if truthy(get(doc, "page_css")) {
		extra = str(doc, "page_css")
	}
	var body []string
	pageBlocks := list(doc, "blocks")
	var pageStream []streamBlock
	for _, bv := range pageBlocks {
		b, _ := omap(bv)
		pageStream = append(pageStream, streamBlock{Type: str(b, "type"), Data: b})
	}
	assignCanvasBoardIDs(pageStream, getOr(doc, "slug", "page"))
	for _, bv := range pageBlocks {
		b, _ := omap(bv)
		s, _ := reg.Render(str(b, "type"), b, ctx)
		body = append(body, s)
	}
	page := "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
		"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
		"<title>" + wire.HTMLEscape(title) + "</title>\n<style>\n" + theme + extra + "\n</style>\n" +
		"</head>\n<body>\n<div class=\"wrap\">\n\n" +
		strings.Join(body, "\n") +
		"\n</div>\n</body>\n</html>\n"
	name := getOr(doc, "slug", "")
	if name == "" {
		name = "index"
	}
	return page, name + ".html", nil
}

// Publish renders a doc-tree into {filename: html} (publish.build). style picks
// the :root token block; "" uses the default (techno-dark).
func Publish(doc *wire.OrderedMap, style string, lib *library.Library) (map[string]string, error) {
	if style == "" {
		style = library.DefaultStyle
	}
	styleRoot, err := lib.Style(style)
	if err != nil {
		return nil, err
	}
	reg, err := buildRegistry(lib)
	if err != nil {
		return nil, err
	}
	buildTree(doc)
	// In pager mode synthetic group nodes aren't tour stops (no content, no
	// left-nav to anchor), so they get no page — the tour is exactly the cover +
	// real content pages. (publish.build)
	skipGroups := isPager(doc)
	pages := map[string]string{}
	for _, nv := range list(doc, "_all") {
		n, _ := omap(nv)
		if skipGroups && truthy(get(n, "is_group")) {
			continue
		}
		pages[str(n, "slug")+".html"] = renderNode(n, doc, reg, styleRoot, lib)
	}
	pages["index.html"] = renderIndex(doc, reg, styleRoot, lib)
	return pages, nil
}
