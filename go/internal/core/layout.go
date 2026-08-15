package core

import "stddoc/internal/wire"

// layout.go — the `layout` MODE field: the left-nav is one mode, not the frame.
//
// the maintainer's call (2026-08-15): the fixed 250px left rail should not be the
// universal wrapper. This adds selectable layout modes, mirroring the proven
// isPager pattern in pager.go — the mode's CSS rides ONLY when the mode is
// active, so a doc with NO `layout` field is byte-IDENTICAL to today (left-nav)
// and the conformance golden-master (the strangler proof) holds untouched.
//
// CONVENTION: new docs default to no-nav by AUTHORING `layout:"no-nav"` in
// their own source.json — NOT by changing this absent-value default — so
// existing published docs never change (constraint: "don't change existing
// docs, only new ones"). There is no code-generated scaffold path (no `stddoc
// new` command) as of this writing; copy examples/starter-no-nav/source.json
// as the starting point for a brand-new doc-tree.
//
// Slice 1 shipped `no-nav` (a clean centered essay, no rail). Slice 2 added
// `top-nav` (sticky horizontal hub) and `hero` (full-bleed header), and
// decoupled search + breadcrumb from the sidebar so they render in every mode
// (see renderBreadcrumb/renderTopNav in nav.go — both fire unconditionally
// from renderNode/head, not gated on the left-nav aside).

// layoutMode returns the doc's requested layout mode, or "" for the default
// (left-nav). Unknown values fall through to the default, so a typo degrades to
// today's shell rather than a broken page.
func layoutMode(doc *wire.OrderedMap) string {
	switch str(doc, "layout") {
	case "no-nav":
		return "no-nav"
	case "top-nav":
		return "top-nav"
	case "hero":
		return "hero"
	default:
		return "" // left-nav (unchanged) — conformance-safe absent default
	}
}

// nonavCSS renders a centered single-column essay with no left rail. It rides
// only under .nonav-shell, so it cannot affect any left-nav page.
const nonavCSS = `
.shell.nonav-shell{grid-template-columns:1fr;max-width:880px;margin:0 auto}
.nonav-shell .wrap{max-width:820px;padding-top:22px}
body:has(.nonav-shell){background:radial-gradient(120% 90% at 0% 0%, var(--surface2) 0%, var(--bg) 60%)}
.nonav-shell h1{background:linear-gradient(90deg,var(--text),var(--glow));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}`

// topnavCSS renders the sticky horizontal "hub" bar + full-width content. Rides
// only under .topnav-shell, so left-nav pages are unaffected.
const topnavCSS = `
.shell.topnav-shell{grid-template-columns:1fr;max-width:1100px;margin:0 auto}
.topnav-shell .wrap{max-width:none;padding-top:20px}
.topnav{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:11px 2px;margin-bottom:8px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.topnav .brand{font-weight:700;color:var(--text);font-size:15px}
.topnav .brand:hover{text-decoration:none;color:var(--glow)}
.topnav-links{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.topnav .tn-link{color:var(--text-faint);font-size:13.5px}
.topnav .tn-link:hover{color:var(--glow);text-decoration:none}
.topnav .tn-link.active{color:var(--glow);font-weight:600}
.topnav .cf-search-box{margin-left:auto;position:relative;min-width:180px}`

// heroCSS renders a full-bleed magazine header with no rail. Rides only under
// .hero-shell.
const heroCSS = `
.shell.hero-shell{grid-template-columns:1fr;max-width:1000px;margin:0 auto}
.hero-shell .wrap{max-width:860px;margin:0 auto;padding-top:8px}
body:has(.hero-shell){background:radial-gradient(130% 80% at 50% 0%, var(--surface2) 0%, var(--bg) 55%)}
.hero-shell h1{font-size:2.6rem;line-height:1.1;margin:.2em 0 .3em;background:linear-gradient(90deg,var(--text),var(--glow));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero-shell .tagline{font-size:1.15rem;color:var(--text-2)}`
