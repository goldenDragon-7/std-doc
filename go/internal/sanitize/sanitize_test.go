package sanitize

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The 22 adversarial vectors from the HTML value-sanitizer design note §5.
// These ARE the acceptance criteria — the primitive does not ship until every
// one behaves as specified.
//
// Vectors 21 and 22 must PASS. A sanitizer that rejects everything is
// trivially "secure" and useless, and shipping one would quietly re-create the
// straightjacket this whole layer exists to remove.

func policy(t *testing.T) *Policy {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "stddoc-lib", "html_whitelist.json"))
	if err != nil {
		t.Fatalf("html_whitelist.json: %v", err)
	}
	p, err := LoadPolicy(raw)
	if err != nil {
		t.Fatalf("LoadPolicy: %v", err)
	}
	return p
}

type vector struct {
	n       int
	name    string
	in      string
	mode    Mode
	wantErr bool
	rule    string // expected rule tag, when rejected
}

func vectors() []vector {
	return []vector{
		{1, "script element", `<script>fetch('//evil')</script>`, ModeServe, true, "element"},
		{2, "onclick handler", `<div onclick="fetch('//evil')">x</div>`, ModeServe, true, "event-handler"},
		{3, "ONCLICK case variation", `<div ONCLICK="x()">x</div>`, ModeServe, true, "event-handler"},
		{4, "javascript: href", `<a href="javascript:alert(1)">x</a>`, ModeServe, true, "url-scheme"},
		{5, "mixed-case javascript:", `<a href="JaVaScRiPt:alert(1)">x</a>`, ModeServe, true, "url-scheme"},
		{6, "entity/control obfuscation", "<a href=\"java\tscript:alert(1)\">x</a>", ModeServe, true, "url-scheme"},
		{7, "protocol-relative", `<a href="//evil.example/x">x</a>`, ModeServe, true, "url-scheme"},
		{8, "data: URI href", `<a href="data:text/html,<b>hi">x</a>`, ModeServe, true, "url-scheme"},
		{9, "img remote src", `<img src="https://evil/pixel.gif">`, ModeServe, true, "element"},
		{10, "style with remote url()", `<div style="background:url(https://evil/p)">x</div>`, ModeServe, true, "style-attr"},
		{11, "iframe", `<iframe src="https://evil"></iframe>`, ModeServe, true, "element"},
		{12, "svg foreignObject script", `<svg><foreignObject><script>x()</script></foreignObject></svg>`, ModeServe, true, "element"},
		{13, "svg xlink:href javascript", `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`, ModeServe, true, ""},
		{14, "MathML vector", `<math><mtext>x</mtext></math>`, ModeServe, true, "element"},
		{15, "CDATA confusion", `<div><![CDATA[<script>x()</script>]]></div>`, ModeServe, true, ""},
		{16, "mutation-XSS via noscript reparse", `<noscript><p title="</noscript><script>x()</script>">y</p></noscript>`, ModeServe, true, "element"},
		{17, "form in table", `<table><tr><td><form action="/x"></form></td></tr></table>`, ModeServe, true, "element"},
		{18, "template with script", `<template><script>x()</script></template>`, ModeServe, true, "element"},
		{19, "engine id capture", `<div class="a" id="page-nav">x</div>`, ModeServe, false, ""},
		{20, "depth bomb", strings.Repeat("<div>", 200) + "x" + strings.Repeat("</div>", 200), ModeServe, true, "depth"},
		// Vector 21 was CORRECTED against the code. The spec originally
		// demanded rejection at freeze; internal/gate already rules that a
		// reader-clickable <a href> is deliberately NOT a Covenant IV leak,
		// because the doc does not fetch it — the reader chooses to click.
		// Freeze-safety here is structural instead: the whitelist admits no
		// auto-fetching construct at all (vectors 9, 10, 11 cover that).
		{21, "external link passes at FREEZE (matches gate policy)", `<a href="https://ok.example">x</a>`, ModeFreeze, false, ""},
		{22, "the happy path", `<div class="lane-map"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"></circle></svg><p class="u-amber">measured</p></div>`, ModeServe, false, ""},
	}
}

func TestAdversarialVectors(t *testing.T) {
	p := policy(t)
	for _, v := range vectors() {
		v := v
		t.Run(v.name, func(t *testing.T) {
			out, err := Sanitize(v.in, p, v.mode)
			if v.wantErr {
				if err == nil {
					t.Fatalf("vector %d (%s): expected REJECTION, got clean output %q", v.n, v.name, out)
				}
				if out != "" {
					t.Errorf("vector %d: rejection must return empty output, got %q", v.n, out)
				}
				if v.rule != "" {
					se, ok := err.(*Error)
					if !ok {
						t.Fatalf("vector %d: expected *Error, got %T: %v", v.n, err, err)
					}
					found := false
					for _, viol := range se.Violations {
						if viol.Rule == v.rule {
							found = true
						}
					}
					if !found {
						t.Errorf("vector %d: expected rule %q; got %v", v.n, v.rule, se.Violations)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("vector %d (%s) must PASS, but was rejected: %v", v.n, v.name, err)
			}
			if strings.TrimSpace(out) == "" {
				t.Fatalf("vector %d must PASS with content, got empty output", v.n)
			}
		})
	}
}

// Vector 21's twin: the SAME link must be accepted when serving. A gate that
// rejected it in both modes would be indistinguishable from a broken one.
func TestExternalLinkAllowedWhenServing(t *testing.T) {
	p := policy(t)
	out, err := Sanitize(`<a href="https://ok.example">x</a>`, p, ModeServe)
	if err != nil {
		t.Fatalf("external link must be permitted while serving: %v", err)
	}
	if !strings.Contains(out, "ok.example") {
		t.Errorf("link lost in re-serialization: %q", out)
	}
}

// The happy path must survive the parse/re-serialize round trip intact —
// otherwise the layer silently degrades exactly the expressiveness it exists
// to enable.
func TestHappyPathRoundTripsIntact(t *testing.T) {
	p := policy(t)
	in := `<div class="lane-map"><p class="u-amber u-tight">measured</p><table><tr><td colspan="2">x</td></tr></table></div>`
	out, err := Sanitize(in, p, ModeServe)
	if err != nil {
		t.Fatalf("rejected: %v", err)
	}
	for _, want := range []string{`class="lane-map"`, `class="u-amber u-tight"`, `colspan="2"`, "measured"} {
		if !strings.Contains(out, want) {
			t.Errorf("round trip lost %q\n  in:  %s\n  out: %s", want, in, out)
		}
	}
}

// NEVER STRIP: a rejection must produce no output at all. Returning a
// partially-cleaned fragment would be the silent-drop failure mode.
func TestRejectionIsLoudAndTotal(t *testing.T) {
	p := policy(t)
	in := `<div class="keep-me"><p>good</p><script>bad()</script></div>`
	out, err := Sanitize(in, p, ModeServe)
	if err == nil {
		t.Fatal("expected rejection")
	}
	if out != "" {
		t.Fatalf("must not return partially-cleaned output, got %q", out)
	}
	if !strings.Contains(err.Error(), "Nothing was stripped") {
		t.Errorf("error must tell the author nothing was silently removed:\n%v", err)
	}
	if !strings.Contains(err.Error(), "script") {
		t.Errorf("error must name the offending element:\n%v", err)
	}
}

// A missing or empty policy must be a loud refusal, never an open gate.
func TestNoPolicyIsRefusal(t *testing.T) {
	if _, err := LoadPolicy(nil); err == nil {
		t.Error("absent policy must be an error, not an empty (permissive) policy")
	}
	if _, err := LoadPolicy([]byte(`{"elements":[]}`)); err == nil {
		t.Error("empty element list must be an error, not a silently-closed gate")
	}
	if _, err := Sanitize(`<p>x</p>`, nil, ModeServe); err == nil {
		t.Error("sanitizing with a nil policy must refuse")
	}
}

// The style= rejection must point the author at the utility layer, because
// that mitigation is what makes rejecting 684 corpus occurrences reasonable
// rather than punitive.
func TestStyleRejectionNamesTheAlternative(t *testing.T) {
	p := policy(t)
	_, err := Sanitize(`<p style="color:#f59e0b">x</p>`, p, ModeServe)
	if err == nil {
		t.Fatal("style= must be rejected")
	}
	if !strings.Contains(err.Error(), "u-amber") {
		t.Errorf("style= rejection should name the utility-class alternative:\n%v", err)
	}
}
