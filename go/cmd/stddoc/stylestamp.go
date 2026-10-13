package main

import (
	"regexp"
	"strings"
)

// htmlOpenTagRE matches the opening <html …> tag (the renderer emits
// `<html lang="en">`, but a hand-authored or plugin page may write it any way,
// including bare `<html>` or with existing attributes).
var htmlOpenTagRE = regexp.MustCompile(`(?is)<html\b[^>]*>`)

// alreadyStampedRE detects a data-style-default we (or a prior publish) already
// placed, so re-publishing is idempotent rather than accumulating attributes.
var alreadyStampedRE = regexp.MustCompile(`(?is)\bdata-style-default\s*=`)

// pageOwnStyle is the sentinel stamped on a standalone (layout:"page") doc.
// Such a doc carries its own `theme`, not one of the named styles, so it must
// not claim a style name — and because style-lock.css has no block for this
// sentinel, stamping it contributes no rules and the page's own baked theme
// wins. That is precisely the intent.
const pageOwnStyle = "_page"

// applyStyleStamp records, ON THE PAGE, which style the doc was published in,
// as <html data-style-default="<name>">. style-lock.js (injected into every page
// by serve) reads it and defaults to that style instead of hardcoding
// techno-dark.
//
// WHY THIS IS NEEDED: `publish --style X` bakes X's tokens into the page's
// :root, then `serve` injects style-lock.{js,css} at the END of <head>.
// Specificity ties (:root is 0,1,0; [data-style] is 0,1,0), so source order
// decides and the injected lock WINS — repainting the page in whatever style
// style-lock.js stamped. With no stored reader pick it stamped "techno-dark"
// unconditionally, which silently discarded --style for every doc. MEASURED
// before this fix: a doc published --style parchment-light computed --bg
// #0a0e17 (techno-dark) instead of #faf8f3.
//
// Like applyOverlay, this is deliberately a POST-render rewrite in the publish
// command rather than a change to core.Publish — so the byte-identical
// conformance goldens (which test core.Publish directly) are untouched by
// construction.
//
// Idempotent: a page already carrying data-style-default is returned unchanged.
// A page with no <html> tag at all is returned unchanged (nothing to stamp),
// which leaves style-lock.js on its "techno-dark" fallback — the old behaviour,
// so a fragment can never be made worse by this.
func applyStyleStamp(html, styleName string) string {
	if styleName == "" || alreadyStampedRE.MatchString(html) {
		return html
	}
	loc := htmlOpenTagRE.FindStringIndex(html)
	if loc == nil {
		return html
	}
	tag := html[loc[0]:loc[1]]
	// Insert before the closing '>' (and before a self-closing '/', though
	// <html/> is not legal — be defensive rather than corrupt the tag).
	end := len(tag) - 1
	for end > 0 && (tag[end] == '>' || tag[end] == '/' || tag[end] == ' ') {
		end--
	}
	stamped := tag[:end+1] + ` data-style-default="` +
		strings.ReplaceAll(styleName, `"`, "&quot;") + `"` + tag[end+1:]
	return html[:loc[0]] + stamped + html[loc[1]:]
}
