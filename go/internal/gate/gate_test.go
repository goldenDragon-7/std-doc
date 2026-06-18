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

func TestMermaidRefused(t *testing.T) {
	page := `<body><div class="mermaid">graph TD; A-->B</div></body>`
	if !HasMermaid(page) {
		t.Fatal("should detect live mermaid div")
	}
	if err := Enforce(map[string]string{"p.html": page}); err == nil {
		t.Error("un-baked mermaid must be refused loudly")
	}
}
