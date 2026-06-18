package core

import (
	"regexp"
	"strings"

	"stddoc/internal/library"
	"stddoc/internal/wire"
)

// The pager layout: a single-column reading tour with a slim
// progress header, prev/next controls, arrow-key paging, and a per-page accent /
// sky atmosphere. A doc opts in with "nav":"pager". Everything here mirrors the
// Python oracle byte-for-byte; the conformance test (pager_test.go) proves it.

const pagerCSS = `
.shell.pager-shell{grid-template-columns:1fr;max-width:840px}
.pager-shell .wrap{max-width:780px;padding-top:18px}
.pagerbar{display:flex;align-items:center;gap:14px;margin:0 0 26px;padding-bottom:13px;border-bottom:1px solid var(--border)}
.pagerbar a.pg-home{font-size:15px;color:var(--text-faint)}.pagerbar a.pg-home:hover{color:var(--glow);text-decoration:none}
.pagerbar .pg-dots{display:flex;gap:7px;flex:1;justify-content:center}
.pagerbar .pg-dots i{width:7px;height:7px;border-radius:50%;background:var(--border);display:block;transition:background .2s,box-shadow .2s}
.pagerbar .pg-dots i.on{background:var(--glow);box-shadow:0 0 9px var(--glow)}
.pagerbar .pg-pos{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--text-faint);white-space:nowrap}
.pagernav{display:flex;gap:14px;margin:56px 0 0;padding-top:24px;border-top:1px solid var(--border)}
.pagernav a{display:flex;flex-direction:column;gap:4px;flex:1 1 0;min-width:0;padding:15px 18px;border:1px solid var(--border);border-radius:13px;background:var(--surface);transition:border-color .15s,transform .15s,box-shadow .15s}
.pagernav a:hover{border-color:var(--glow);transform:translateY(-1px);box-shadow:0 6px 22px -12px var(--glow);text-decoration:none}
.pagernav a.nxt{text-align:right;align-items:flex-end}
.pagernav .pg-spacer{flex:1 1 0}
.pagernav .pg-dir{font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--text-faint)}
.pagernav .pg-ttl{font-size:14.5px;color:var(--glow);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
@media(max-width:560px){.pagernav{flex-direction:column}}
/* atmosphere — the bespoke radial sky, pager-only so tree pages stay byte-identical.
   --accent defaults to the voice glow; a page sets it (purple palace, rose relationship)
   via an inline style on the shell, and the h1 gradient + kicker pick it up. */
body:has(.pager-shell){background:radial-gradient(120% 90% at var(--sky,0%) 0%, var(--surface2) 0%, var(--bg) 60%)}
.pager-shell{--accent:var(--glow)}
.pager-shell h1{background:linear-gradient(90deg,var(--text),var(--accent));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.pager-shell .pagerbar .pg-home{color:var(--accent)}
.pager-shell .pg-dots i.on{background:var(--accent);box-shadow:0 0 9px var(--accent)}
/* editorial-prose corrections (pager-only) — the bespoke pages read as calm prose,
   not a doc-tree report. Lede is a plain paragraph (no glow headline); the flow row
   shares width so steps sit horizontally and wrap their text instead of ballooning. */
.pager-shell .hero-ask{font-size:17px;font-weight:400;line-height:1.6;background:none;-webkit-text-fill-color:var(--text-2);color:var(--text-2);margin:0 0 .25rem}
.pager-shell .hero-sub{color:var(--text-2);font-size:15px}
.pager-shell .flow .step{flex:1 1 0;min-width:0}
`

const pagerKeysJS = `
(function(){
  var bar=document.querySelector('nav.pagernav');if(!bar)return;
  document.addEventListener('keydown',function(e){
    if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey)return;
    var t=e.target;if(t&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||''))return;
    if(t&&t.isContentEditable)return;
    // Yield ←/→ to the feedback widget when its tour or editor owns the page,
    // so paging doesn't fight the change-walkthrough.
    if(document.querySelector('.cf-tour-bar.cf-visible, .cf-editor, .cf-selection-popup'))return;
    if(e.key==='ArrowRight'){var nx=bar.getAttribute('data-next');if(nx)location.href=nx;}
    else if(e.key==='ArrowLeft'){var pv=bar.getAttribute('data-prev');if(pv)location.href=pv;}
  });
})();
`

// pagerNumPrefixRe strips the "N · " legal-number prefix from a narrative title.
var pagerNumPrefixRe = regexp.MustCompile(`^\s*\d+(\.\d+)*\s*[·.)\-]\s*`)

// accentHex maps a palette-entity key to its hex for the per-page --accent.
var accentHex = map[string]string{
	"purple": "#a78bfa", "rose": "#fb7faf", "glow": "#22d3ee",
	"green": "#34d399", "gold": "#fbbf24", "red": "#f87171",
}

func isPager(doc *wire.OrderedMap) bool {
	return getOr(doc, "nav", "") == "pager"
}

type pagerPage struct {
	href, slug, label string
}

// pagerPages is the linear reading-order tour: the cover, then every non-group
// node depth-first (_all order). (publish._pager_pages)
func pagerPages(doc *wire.OrderedMap) []pagerPage {
	buildTree(doc)
	seq := []pagerPage{{href: "index.html", slug: "", label: navLabel(getOr(doc, "title", "Doc"))}}
	for _, nv := range list(doc, "_all") {
		n, ok := omap(nv)
		if !ok || truthy(get(n, "is_group")) {
			continue
		}
		lbl := pagerNumPrefixRe.ReplaceAllString(str(n, "title"), "")
		seq = append(seq, pagerPage{href: str(n, "slug") + ".html", slug: str(n, "slug"), label: lbl})
	}
	return seq
}

// pagerPos returns the index whose slug == current ("" == the cover).
func pagerPos(seq []pagerPage, current string) int {
	for i, p := range seq {
		if p.slug == current {
			return i
		}
	}
	return 0
}

// renderPagerTop is the slim progress header (publish.render_pager_top). isCover
// distinguishes the cover (Python's current==None) from a node with empty slug.
func renderPagerTop(doc *wire.OrderedMap, current string, isCover bool) string {
	seq := pagerPages(doc)
	i := pagerPos(seq, current)
	contentTotal := len(seq) - 1
	dots := ""
	if contentTotal <= 12 {
		var b strings.Builder
		b.WriteString("<span class='pg-dots'>")
		for k := 0; k < contentTotal; k++ {
			cls := ""
			if k+1 == i {
				cls = "on"
			}
			b.WriteString("<i class='" + cls + "'></i>")
		}
		b.WriteString("</span>")
		dots = b.String()
	}
	pos := itoa(i) + " / " + itoa(contentTotal)
	if isCover {
		pos = "start"
	}
	return "<nav class='pagerbar'>" +
		"<a class='pg-home' href='index.html' title='Overview'>&#9672;</a>" +
		dots + "<span class='pg-pos'>" + esc(pos) + "</span></nav>"
}

// renderPagerNav is the bottom prev/next + arrow-key handler (publish.render_pager_nav).
func renderPagerNav(doc *wire.OrderedMap, current string) string {
	seq := pagerPages(doc)
	i := pagerPos(seq, current)
	var prev, nxt *pagerPage
	if i > 0 {
		prev = &seq[i-1]
	}
	if i < len(seq)-1 {
		nxt = &seq[i+1]
	}
	attrs := ""
	if prev != nil {
		attrs += " data-prev='" + esc(prev.href) + "'"
	}
	if nxt != nil {
		attrs += " data-next='" + esc(nxt.href) + "'"
	}
	var h strings.Builder
	h.WriteString("<nav class='pagernav'" + attrs + ">")
	if prev != nil {
		h.WriteString("<a class='prv' href='" + esc(prev.href) + "'>" +
			"<span class='pg-dir'>&lsaquo; Back</span>" +
			"<span class='pg-ttl'>" + esc(prev.label) + "</span></a>")
	} else {
		h.WriteString("<span class='pg-spacer'></span>")
	}
	if nxt != nil {
		h.WriteString("<a class='nxt' href='" + esc(nxt.href) + "'>" +
			"<span class='pg-dir'>Next &rsaquo;</span>" +
			"<span class='pg-ttl'>" + esc(nxt.label) + "</span></a>")
	} else if len(seq) > 1 && i == len(seq)-1 {
		// last page: a gentle loop back to the start (bespoke "start over → page 1")
		first := seq[0]
		h.WriteString("<a class='nxt' href='" + esc(first.href) + "'>" +
			"<span class='pg-dir'>Start over &#8634;</span>" +
			"<span class='pg-ttl'>" + esc(first.label) + "</span></a>")
	} else {
		h.WriteString("<span class='pg-spacer'></span>")
	}
	h.WriteString("</nav>")
	h.WriteString("<script>" + pagerKeysJS + "</script>")
	return h.String()
}

// pagerShellStyle is the per-page accent + sky inline style on the shell
// (publish._pager_shell_style). isCover => use only doc-level accent/sky.
func pagerShellStyle(doc *wire.OrderedMap, current string, isCover bool) string {
	var n *wire.OrderedMap
	if !isCover {
		n = bySlug(doc, current)
	}
	accent := ""
	if n != nil && truthy(get(n, "accent")) {
		accent = str(n, "accent")
	} else if truthy(get(doc, "accent")) {
		accent = str(doc, "accent")
	}
	sky := ""
	if n != nil && truthy(get(n, "sky")) {
		sky = str(n, "sky")
	} else if truthy(get(doc, "sky")) {
		sky = str(doc, "sky")
	}
	var decls []string
	if accent != "" {
		hex, ok := accentHex[accent]
		if !ok {
			hex = accent
		}
		decls = append(decls, "--accent:"+hex)
	}
	if sky == "right" {
		decls = append(decls, "--sky:100%")
	}
	if len(decls) == 0 {
		return ""
	}
	return " style='" + strings.Join(decls, ";") + "'"
}

// renderIndexPager is the pager cover: title, tagline, facets, a single Begin
// control into the first node (publish.render_index_pager).
func renderIndexPager(doc *wire.OrderedMap, styleRoot string, lib *library.Library) string {
	r, _ := get(doc, "root").(*wire.OrderedMap)
	title := getOr(doc, "title", "Doc")
	var h strings.Builder
	h.WriteString(head(title, doc, "", true, styleRoot, lib))
	h.WriteString(renderPagerTop(doc, "", true))
	h.WriteString("<h1>" + esc(title) + "</h1>")
	if r != nil {
		if truthy(get(r, "summary")) {
			h.WriteString("<p class='tagline'>" + esc(str(r, "summary")) + "</p>")
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
	seq := pagerPages(doc)
	if len(seq) > 1 {
		nxt := seq[1]
		h.WriteString("<nav class='pagernav' data-next='" + esc(nxt.href) + "'>" +
			"<span class='pg-spacer'></span>" +
			"<a class='nxt' href='" + esc(nxt.href) + "'>" +
			"<span class='pg-dir'>Begin &rsaquo;</span>" +
			"<span class='pg-ttl'>" + esc(nxt.label) + "</span></a></nav>")
		h.WriteString("<script>" + pagerKeysJS + "</script>")
	}
	all := list(doc, "_all")
	h.WriteString("<div class='footer'>" + itoa(len(all)) + " pages &middot; generated " +
		esc(get(doc, "generated_date")) + "</div>")
	h.WriteString("</main></div></body></html>")
	return h.String()
}
