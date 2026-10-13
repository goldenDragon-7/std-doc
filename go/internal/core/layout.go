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
	case "reference":
		return "reference"
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

// referenceCSS renders the THIRD column std-doc never had: rail + content +
// a sticky aside. Every other mode (and the default shell) is a single content
// column, which is why docs here come out as vertical stacks — the frame has
// never offered anything else.
//
// SCOPE, honestly: this closes the COMPOSITION gap, not the density gap. It
// gives a doc somewhere to put an index and metadata other than the main
// column, and a wider main column to put content in. Measured on the demo,
// vertical density did NOT improve (1357 chars/1000px against a 2108 baseline)
// because the airiness lives in the PRIMITIVES — `sections` renders as roomy
// cards — not in the frame. Density is a separate, later lever; do not read
// this mode as having fixed it.
//
// Rides only under .reference-shell, so no existing page is touched. The aside
// collapses below 1200px (content first), and prints away entirely.
const referenceCSS = `
.shell.reference-shell{grid-template-columns:250px minmax(0,1fr) 232px;max-width:1560px;gap:0 34px}
.reference-shell .wrap{max-width:none;padding-top:22px}
.otp{position:sticky;top:18px;align-self:start;max-height:calc(100vh - 36px);overflow-y:auto;padding:20px 0 28px;font-size:.72rem;line-height:1.5}
.otp-head{font-size:.58rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--text-faint);margin-bottom:.7rem}
.otp-list{list-style:none;margin:0 0 1.5rem;padding:0;border-left:1px solid var(--border)}
.otp-list li{margin:0}
.otp-list a{display:block;padding:.3rem 0 .3rem .8rem;margin-left:-1px;border-left:1px solid transparent;color:var(--text-dim);text-decoration:none}
.otp-list a:hover{color:var(--glow);border-left-color:var(--glow);text-decoration:none}
.otp-meta{border-top:1px solid var(--border);padding-top:.9rem}
.otp-meta dt{font-size:.55rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);margin-top:.7rem}
.otp-meta dd{margin:.15rem 0 0;color:var(--text-dim)}
@media(max-width:1200px){.shell.reference-shell{grid-template-columns:250px minmax(0,1fr)}.otp{display:none}}
@media print{.otp{display:none}}`

// heroCSS renders a full-bleed magazine header with no rail. Rides only under
// .hero-shell.
const heroCSS = `
.shell.hero-shell{grid-template-columns:1fr;max-width:1000px;margin:0 auto}
.hero-shell .wrap{max-width:860px;margin:0 auto;padding-top:8px}
body:has(.hero-shell){background:radial-gradient(130% 80% at 50% 0%, var(--surface2) 0%, var(--bg) 55%)}
.hero-shell h1{font-size:2.6rem;line-height:1.1;margin:.2em 0 .3em;background:linear-gradient(90deg,var(--text),var(--glow));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero-shell .tagline{font-size:1.15rem;color:var(--text-2)}`
