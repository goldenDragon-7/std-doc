// Package freeze turns a published directory of live std-doc pages into a
// portable, read-only snapshot: a sibling frozen/ dir plus a single
// <slug>_frozen_<ts>.zip you can hand to anyone.
//
// It is a faithful port of engine/scripts/freeze.py (the Python->Go port had
// silently gutted freeze down to a leak-checker). The pipeline:
//
//  1. bake each <div class="mermaid">SOURCE</div> to inline <svg> via a Renderer
//     (the served form renders client-side from a CDN; the frozen form renders
//     ONCE here so the snapshot is deterministic and never re-executed),
//  2. strip the feedback widget tags and the mermaid/svg-pan-zoom CDN scripts,
//  3. if the page had mermaid, re-inline the offline kit (mermaid.css +
//     svg-pan-zoom + frozen-panzoom.js, ~30KB) so fullscreen pan-zoom still
//     works over file://,
//  4. add the frozen-snapshot banner after the first <main>,
//  5. self-check: every frozen page must have ZERO external references
//     (Covenant IV — a frozen doc reaches out to nothing).
//
// mmdc is an author-side, freeze-time dependency only. It bakes once; the frozen
// OUTPUT stays zero-network. If a doc has diagrams and no renderer is found,
// freeze REFUSES it loudly rather than ship a silently-broken snapshot. d2-only
// docs need no renderer and freeze pure-stdlib.
package freeze

import (
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"stddoc/internal/gate"
)

var (
	// a live .mermaid source block (the form serve injects). Non-greedy body.
	mermaidBlock = regexp.MustCompile(`(?is)<div\s+class=['"]mermaid['"]\s*>(.*?)</div>`)
	// the feedback widget + anything served from /lib/ — always stripped.
	widgetScript = regexp.MustCompile(`(?i)\s*<script[^>]*(?:feedback|/lib/)[^>]*>\s*</script>`)
	widgetLink   = regexp.MustCompile(`(?i)\s*<link[^>]*(?:feedback|/lib/)[^>]*>`)
	// the mermaid kit's CDN deps (external -> must go; re-inlined when needed).
	cdnScript = regexp.MustCompile(`(?i)\s*<script[^>]*src=['"][^'"]*(?:mermaid|svg-pan-zoom)[^'"]*['"][^>]*>\s*</script>`)
	// the first <main ...> opener, for banner insertion.
	mainOpen = regexp.MustCompile(`(?i)<main[^>]*>`)
)

// Renderer renders mermaid source to an inline "<svg>…</svg>" element, or an
// error. nil means no renderer is available (the caller turns that into a clean
// per-doc refusal). Injectable so tests never depend on a real mmdc install.
type Renderer func(source string) (string, error)

// BakeMermaid replaces each <div class="mermaid">SOURCE</div> with the rendered
// inline SVG. Returns (html, hadMermaid, error). If diagrams exist but render is
// nil it returns an error (the caller surfaces a clean refusal).
func BakeMermaid(htmlStr string, render Renderer) (string, bool, error) {
	locs := mermaidBlock.FindAllStringSubmatchIndex(htmlStr, -1)
	if len(locs) == 0 {
		return htmlStr, false, nil
	}
	if render == nil {
		return "", true, fmt.Errorf("doc has mermaid diagrams but no renderer found — " +
			"install the mermaid CLI (`npm i -g @mermaid-js/mermaid-cli`) to freeze it, or keep it served")
	}
	var b strings.Builder
	last := 0
	for _, m := range locs {
		// m[0:2] = full match, m[2:4] = capture group (the source).
		b.WriteString(htmlStr[last:m[0]])
		// the source may be HTML-escaped (publish esc()s it); mmdc wants raw.
		svg, err := render(html.UnescapeString(htmlStr[m[2]:m[3]]))
		if err != nil {
			return "", true, err
		}
		b.WriteString(`<div class="mermaid">`)
		b.WriteString(svg)
		b.WriteString(`</div>`)
		last = m[1]
	}
	b.WriteString(htmlStr[last:])
	return b.String(), true, nil
}

// FreezePage bakes mermaid, strips the served-only tags, re-inlines the offline
// kit when the page had diagrams, and adds the frozen banner. libDir is the
// stddoc-lib/lib directory (for mermaid.css, vendor/svg-pan-zoom.min.js,
// frozen-panzoom.js).
func FreezePage(htmlStr, title, generated, libDir string, render Renderer) (string, error) {
	htmlStr, hadMermaid, err := BakeMermaid(htmlStr, render)
	if err != nil {
		return "", err
	}
	htmlStr = widgetScript.ReplaceAllString(htmlStr, "")
	htmlStr = widgetLink.ReplaceAllString(htmlStr, "")
	htmlStr = cdnScript.ReplaceAllString(htmlStr, "")

	if hadMermaid {
		css, err := readLib(libDir, "mermaid.css")
		if err != nil {
			return "", err
		}
		style := "<style>\n/* std-doc mermaid kit (frozen, inlined) */\n" + css + "\n</style>"
		if strings.Contains(htmlStr, "</head>") {
			htmlStr = strings.Replace(htmlStr, "</head>", style+"\n</head>", 1)
		}
		panzoom, err := readLib(libDir, filepath.Join("vendor", "svg-pan-zoom.min.js"))
		if err != nil {
			return "", err
		}
		controller, err := readLib(libDir, "frozen-panzoom.js")
		if err != nil {
			return "", err
		}
		script := "<script>\n/* svg-pan-zoom (inlined) */\n" + panzoom +
			"\n</script>\n<script>\n/* frozen pan-zoom controller (inlined) */\n" + controller + "\n</script>"
		if strings.Contains(htmlStr, "</body>") {
			htmlStr = strings.Replace(htmlStr, "</body>", script+"\n</body>", 1)
		}
	}

	banner := "<div class='frozen-banner'>&#128230; <b>Frozen snapshot</b> &middot; " +
		"read-only &middot; " + title + " &middot; " + generated + " &middot; opens anywhere, no server</div>"
	// insert after the first <main ...> only.
	if loc := mainOpen.FindStringIndex(htmlStr); loc != nil {
		htmlStr = htmlStr[:loc[1]] + banner + htmlStr[loc[1]:]
	}
	return htmlStr, nil
}

func readLib(libDir, name string) (string, error) {
	b, err := os.ReadFile(filepath.Join(libDir, name))
	if err != nil {
		return "", fmt.Errorf("freeze: reading offline-kit asset %s: %w", name, err)
	}
	return string(b), nil
}

// Result reports what a freeze run produced.
type Result struct {
	ZipPath string   // the emitted <slug>_frozen_<ts>.zip
	FrozenDir string // the sibling frozen/ directory
	Pages   []string // page names frozen
	Baked   int      // pages that had mermaid baked
	Extras  []string // leak-clean siblings carried (e.g. search-index.js)
}

// Run is the orchestrator (port of freeze.py:freeze). It builds a sibling
// frozen/ dir, refuses if any page needs mermaid and render is nil, freezes
// every page, runs the leak self-check, carries leak-clean siblings, and emits
// the zip. libDir is stddoc-lib/lib.
func Run(outDir, title, generated, libDir string, render Renderer) (*Result, error) {
	if title == "" {
		title = "doc"
	}
	abs, err := filepath.Abs(strings.TrimRight(outDir, string(os.PathSeparator)))
	if err != nil {
		return nil, err
	}
	base := filepath.Dir(abs)
	frozen := filepath.Join(base, "frozen")
	if err := os.RemoveAll(frozen); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(frozen, 0o755); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(outDir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".html") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	// per-doc refusal: which pages carry a live mermaid block?
	srcByName := map[string]string{}
	var needs []string
	for _, n := range names {
		b, err := os.ReadFile(filepath.Join(outDir, n))
		if err != nil {
			return nil, err
		}
		srcByName[n] = string(b)
		if mermaidBlock.MatchString(srcByName[n]) {
			needs = append(needs, n)
		}
	}
	if len(needs) > 0 && render == nil {
		return nil, fmt.Errorf("REFUSED: %d page(s) contain mermaid diagrams but no renderer was found: %v\n"+
			"  Install the mermaid CLI to freeze them:  npm i -g @mermaid-js/mermaid-cli\n"+
			"  (or keep the doc served — served docs render diagrams from the CDN.)", len(needs), needs)
	}

	needsSet := map[string]bool{}
	for _, n := range needs {
		needsSet[n] = true
	}
	baked := 0
	for _, n := range names {
		body, err := FreezePage(srcByName[n], title, generated, libDir, render)
		if err != nil {
			return nil, err
		}
		if needsSet[n] {
			baked++
		}
		if err := os.WriteFile(filepath.Join(frozen, n), []byte(body), 0o644); err != nil {
			return nil, err
		}
	}

	// leak self-check: every frozen page must have ZERO external references.
	var leaks []string
	for _, n := range names {
		b, err := os.ReadFile(filepath.Join(frozen, n))
		if err != nil {
			return nil, err
		}
		if found := gate.Scan(string(b)); len(found) > 0 {
			leaks = append(leaks, fmt.Sprintf("%s: %v", n, found))
		}
	}
	if len(leaks) > 0 {
		sort.Strings(leaks)
		return nil, fmt.Errorf("freeze blocked — %d frozen page(s) still carry external references (Covenant IV):\n  %s",
			len(leaks), strings.Join(leaks, "\n  "))
	}

	// carry leak-clean sibling assets the pages reference relatively (they load
	// over file:// and are not external-ref leaks).
	var extras []string
	for _, n := range []string{"search-index.js"} {
		if _, err := os.Stat(filepath.Join(outDir, n)); err == nil {
			b, err := os.ReadFile(filepath.Join(outDir, n))
			if err != nil {
				return nil, err
			}
			if err := os.WriteFile(filepath.Join(frozen, n), b, 0o644); err != nil {
				return nil, err
			}
			extras = append(extras, n)
		}
	}

	slug := slugify(title)
	stamp := time.Now().Format("20060102-150405")
	zipPath := filepath.Join(base, fmt.Sprintf("%s_frozen_%s.zip", slug, stamp))
	if err := writeZip(zipPath, frozen, slug, append(append([]string{}, names...), extras...)); err != nil {
		return nil, err
	}

	return &Result{ZipPath: zipPath, FrozenDir: frozen, Pages: names, Baked: baked, Extras: extras}, nil
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(title string) string {
	s := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(title), "-"), "-")
	if s == "" {
		return "doc"
	}
	return s
}
