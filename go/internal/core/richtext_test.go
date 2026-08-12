package core

import "testing"

// TestRichText covers finding 2026-08-12 NEW 4: a doc-tree prose field can now
// author a real hyperlink via markdown [text](url), while plain text stays
// byte-identical to esc() and dangerous schemes are refused.
func TestRichText(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain text is esc-identical", "a < b & c > d \"q\"", esc("a < b & c > d \"q\"")},
		{"no link, bare url stays text", "see https://example.com/x now",
			esc("see https://example.com/x now")},
		{"https link becomes anchor", "ticket [#51](https://gitea.example/issues/51) open",
			`ticket <a href="https://gitea.example/issues/51">#51</a> open`},
		{"scheme-less target is NOT a link (code-shaped prose stays text)",
			"call ctx['anchor_attr'](block) here",
			esc("call ctx['anchor_attr'](block) here")},
		{"link text is escaped", "[a & b](https://e.test/p)",
			`<a href="https://e.test/p">a &amp; b</a>`},
		{"javascript scheme is NOT a link", "[click](javascript:alert(1))",
			esc("[click](javascript:alert(1))")},
		{"data scheme is NOT a link", "[x](data:text/html,<b>)",
			esc("[x](data:text/html,<b>)")},
	}
	for _, c := range cases {
		if got := richText(c.in); got != c.want {
			t.Errorf("%s:\n  in   %q\n  got  %q\n  want %q", c.name, c.in, got, c.want)
		}
	}
}
