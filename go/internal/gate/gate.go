// Package gate is the freeze security gate (covenant IV): a frozen page must
// reference nothing external — no CDN, no remote font/script/img, no phone-home.
//
// The frozen-page leak detector is the freeze DEP regex, which by design
// flags src=/href= ATTRIBUTES whose quoted value is absolute (https?:) or
// root-relative (/), and CSS url(https://…) references (a remote font/image
// phones home too). A frozen page may carry inline scripts and prose that
// mentions a URL — only a real external *reference* is a leak. d2's inline SVG
// (xmlns="http://www.w3.org/…", xlink:href="#id", url(#gradient)) passes: those
// are not src/href values nor url(https:) references.
package gate

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	// DEP: an external/root reference in a src=/href= attribute, or
	// a CSS url(https://…) — a remote font/image via url() phones home too.
	reDep     = regexp.MustCompile(`(?i)(?:src|href)\s*=\s*['"](?:/|https?:)|url\(\s*['"]?https?:`)
	reMermaid = regexp.MustCompile(`(?i)<div\s+class=['"]mermaid['"]\s*>`)
)

// Scan returns the external-reference substrings found in html (empty == clean),
// mirroring freeze.DEP.findall.
func Scan(html string) []string {
	if html == "" {
		return nil
	}
	return reDep.FindAllString(html, -1)
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
