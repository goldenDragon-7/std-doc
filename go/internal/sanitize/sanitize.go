// Package sanitize implements the gate for std-doc's ONE untrusted slot: the
// `html` bounded-value primitive.
//
// Design rationale lives in the HTML value-sanitizer design note. The short
// version, because it determines every choice in this file:
//
// std-doc's covenant is "JSON is canon, HTML is derived." HTML-as-canon was
// investigated and rejected (the html-first design note) — down-projection does
// not terminate, and 51% of real Claude-written documents contain <script>,
// which would force a choice between "sanitize and break half the corpus" and
// "ship arbitrary JS to strangers under a signed binary."
//
// The resolution is a CONTAINMENT INVERSION: JSON stays canon, and HTML
// becomes a bounded VALUE inside it, never the container. That turns an
// unbounded proof-over-a-document into a whitelist over ONE node type at a
// KNOWN schema location — which is what makes this file small enough to be
// adversarially testable.
//
// TWO COMMITMENTS, both load-bearing, both from the spec:
//
//  1. PARSE AND RESERIALIZE — never regex. A regex filter over author markup
//     is how sanitizers get bypassed, and this repo has already been bitten by
//     order-pinned regex against HTML (the freeze-canvas-v2 attribute-order
//     bug). We parse with x/net/html — the spec-compliant HTML5 parser, whose
//     tokenizer matches what a browser does — and re-emit from the parsed
//     tree. That also neutralises mutation-XSS: whatever the parser
//     understood is exactly what the reader's parser will see.
//
//     On the zero-dep covenant: golang.org/x/net is ALREADY in this module's
//     graph (via d2, which the binary ships for in-process diagrams), so this
//     adds no new supply chain to the signed artifact.
//
//  2. FAIL LOUDLY, NEVER STRIP. On violation we refuse and name the offending
//     element/attribute and the rule. A sanitizer that silently removes
//     content is a silent-drop bug with a security label on it, and Covenant
//     IV already says freeze fails loudly rather than shipping something
//     broken.
package sanitize

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Policy is the parsed whitelist (html_whitelist.json).
type Policy struct {
	Elements          []string            `json:"elements"`
	GlobalAttributes  []string            `json:"global_attributes"`
	GlobalPrefixes    []string            `json:"global_attribute_prefixes"`
	ElementAttributes map[string][]string `json:"element_attributes"`
	SVGAttributes     []string            `json:"svg_attributes"`
	URLSchemes        []string            `json:"url_schemes"`
	SchemesServeOnly  []string            `json:"url_schemes_serve_only"`
	MaxDepth          int                 `json:"max_depth"`
	IDPrefix          string              `json:"id_prefix"`

	elems, globals, svgAttrs map[string]bool
	elemAttrs                map[string]map[string]bool
}

// LoadPolicy parses html_whitelist.json. A malformed or absent policy is a
// loud error: without a policy there is no gate, and no gate must never be
// mistaken for an empty one.
func LoadPolicy(raw []byte) (*Policy, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("sanitize: html_whitelist.json is missing or empty — refusing to run without a policy")
	}
	p := &Policy{}
	if err := json.Unmarshal(raw, p); err != nil {
		return nil, fmt.Errorf("sanitize: html_whitelist.json: %w", err)
	}
	if len(p.Elements) == 0 {
		return nil, fmt.Errorf("sanitize: html_whitelist.json declares no elements — refusing to run with an empty policy")
	}
	if p.MaxDepth <= 0 {
		p.MaxDepth = 100
	}
	p.elems = set(p.Elements)
	p.globals = set(p.GlobalAttributes)
	p.svgAttrs = set(p.SVGAttributes)
	p.elemAttrs = map[string]map[string]bool{}
	for el, attrs := range p.ElementAttributes {
		p.elemAttrs[strings.ToLower(el)] = set(attrs)
	}
	return p, nil
}

func set(xs []string) map[string]bool {
	m := make(map[string]bool, len(xs))
	for _, x := range xs {
		m[strings.ToLower(x)] = true
	}
	return m
}

// Mode selects how external links are treated. Serving may permit http(s);
// freeze must not (Covenant IV: a frozen doc reaches out to nothing).
type Mode int

const (
	ModeServe Mode = iota
	ModeFreeze
)

func (m Mode) String() string {
	if m == ModeFreeze {
		return "freeze"
	}
	return "publish/serve"
}

// Violation is a single rejection, reported rather than silently applied.
type Violation struct {
	Rule    string // short machine-ish rule name
	Detail  string // human sentence naming exactly what was found
	Element string
}

func (v Violation) Error() string { return v.Detail }

// Error aggregates every violation found, so an author fixes all of them in
// one pass instead of playing whack-a-mole one publish at a time.
type Error struct {
	Violations []Violation
}

func (e *Error) Error() string {
	var b strings.Builder
	fmt.Fprintf(&b, "html block rejected — %d violation(s):", len(e.Violations))
	for _, v := range e.Violations {
		fmt.Fprintf(&b, "\n  · [%s] %s", v.Rule, v.Detail)
	}
	b.WriteString("\n  (Nothing was stripped. Fix the source and re-publish — " +
		"a sanitizer that silently removed content would be a silent-drop bug.)")
	return b.String()
}

// dangerousSchemes are rejected in every mode, including obfuscations.
var dangerousSchemes = []string{"javascript", "vbscript", "data", "file", "blob", "about"}

// Sanitize validates an author-supplied HTML fragment against the policy and
// returns it RE-SERIALIZED FROM THE PARSE TREE. On any violation it returns a
// *Error and an empty string — never a partially-cleaned fragment.
func Sanitize(fragment string, p *Policy, mode Mode) (string, error) {
	if p == nil {
		return "", fmt.Errorf("sanitize: no policy loaded — refusing to emit author HTML ungated")
	}
	if strings.TrimSpace(fragment) == "" {
		return "", nil
	}

	// Parse as a fragment inside <div> so table/li/etc. parse in a sane
	// context. x/net/html applies the real HTML5 tree-construction rules.
	ctx := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := html.ParseFragment(strings.NewReader(fragment), ctx)
	if err != nil {
		return "", fmt.Errorf("sanitize: unparseable html block: %w", err)
	}

	var vs []Violation
	for _, n := range nodes {
		walk(n, p, mode, 0, &vs)
	}
	if len(vs) > 0 {
		sort.SliceStable(vs, func(i, j int) bool { return vs[i].Rule < vs[j].Rule })
		return "", &Error{Violations: vs}
	}

	// Re-emit from the tree. Whatever the parser understood is what ships.
	var b strings.Builder
	for _, n := range nodes {
		if err := html.Render(&b, n); err != nil {
			return "", fmt.Errorf("sanitize: re-serialize: %w", err)
		}
	}
	return b.String(), nil
}

func walk(n *html.Node, p *Policy, mode Mode, depth int, vs *[]Violation) {
	if depth > p.MaxDepth {
		*vs = append(*vs, Violation{
			Rule:   "depth",
			Detail: fmt.Sprintf("nesting deeper than %d elements", p.MaxDepth),
		})
		return
	}

	switch n.Type {
	case html.ElementNode:
		name := strings.ToLower(n.Data)
		if !p.elems[name] {
			*vs = append(*vs, Violation{
				Rule:    "element",
				Element: name,
				Detail: fmt.Sprintf("<%s> is not on the element whitelist "+
					"(html_whitelist.json). Interactivity and embedding belong to "+
					"primitives the engine implements, where the ENGINE writes the script.", name),
			})
			// Do not descend: a rejected container's children are moot and
			// reporting them all would bury the real cause.
			return
		}
		checkAttrs(n, name, p, mode, vs)

	case html.CommentNode:
		// Comments are dropped by policy, but dropping is a change — say so.
		*vs = append(*vs, Violation{
			Rule:   "comment",
			Detail: "HTML comments are not permitted in an html block (they survive into the shipped page and can carry conditional-comment payloads); remove it",
		})
		return

	case html.DoctypeNode:
		*vs = append(*vs, Violation{
			Rule:   "doctype",
			Detail: "a <!DOCTYPE> declaration cannot appear in an html block — this is a fragment, not a document",
		})
		return
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		walk(c, p, mode, depth+1, vs)
	}
}

func checkAttrs(n *html.Node, name string, p *Policy, mode Mode, vs *[]Violation) {
	inSVG := isSVGContext(n)
	for _, a := range n.Attr {
		key := strings.ToLower(a.Key)
		if a.Namespace != "" {
			key = strings.ToLower(a.Namespace) + ":" + key
		}

		// on* handlers get their own rule so the message is unambiguous.
		if strings.HasPrefix(key, "on") && len(key) > 2 {
			*vs = append(*vs, Violation{Rule: "event-handler", Element: name,
				Detail: fmt.Sprintf("<%s %s=…> — inline event handlers are never permitted; "+
					"the engine writes every line of script that ships", name, a.Key)})
			continue
		}
		if key == "style" {
			*vs = append(*vs, Violation{Rule: "style-attr", Element: name,
				Detail: fmt.Sprintf("<%s style=…> — inline style is not permitted: it carries url() "+
					"(a network vector) and hard-codes colour outside the palette, which breaks --style. "+
					"Use the utility classes instead (class=\"u-amber u-tight\"); they bind to palette "+
					"tokens and theme correctly under every style.", name)})
			continue
		}

		if allowedAttr(key, name, inSVG, p) {
			if key == "href" || key == "cite" {
				checkURL(a.Val, name, key, p, mode, vs)
			}
			continue
		}
		*vs = append(*vs, Violation{Rule: "attribute", Element: name,
			Detail: fmt.Sprintf("<%s %s=…> — attribute not on the whitelist for this element", name, a.Key)})
	}
}

func allowedAttr(key, elem string, inSVG bool, p *Policy) bool {
	if p.globals[key] {
		return true
	}
	for _, pre := range p.GlobalPrefixes {
		if strings.HasPrefix(key, strings.ToLower(pre)) {
			return true
		}
	}
	if attrs, ok := p.elemAttrs[elem]; ok && attrs[key] {
		return true
	}
	if inSVG && p.svgAttrs[key] {
		return true
	}
	return false
}

func isSVGContext(n *html.Node) bool {
	for cur := n; cur != nil; cur = cur.Parent {
		if cur.Type == html.ElementNode && strings.EqualFold(cur.Data, "svg") {
			return true
		}
	}
	return false
}

// checkURL enforces the link policy, including the obfuscations a naive
// prefix check misses: case variation, embedded control characters and HTML
// entities (the parser already decodes entities, so we normalise what is
// left), and protocol-relative //host.
func checkURL(raw, elem, attr string, p *Policy, mode Mode, vs *[]Violation) {
	v := normaliseURL(raw)

	if strings.HasPrefix(v, "#") {
		return // in-document fragment — always fine
	}
	if strings.HasPrefix(v, "//") {
		*vs = append(*vs, Violation{Rule: "url-scheme", Element: elem,
			Detail: fmt.Sprintf("<%s %s=%q> — protocol-relative URLs are a remote fetch in disguise", elem, attr, raw)})
		return
	}

	scheme := ""
	if i := strings.Index(v, ":"); i > 0 {
		scheme = v[:i]
	}
	if scheme == "" {
		// Relative path. Harmless when serving a directory; still a reach at
		// freeze time only if it leaves the doc, which the freeze link gate
		// already owns. Allow.
		return
	}
	for _, bad := range dangerousSchemes {
		if scheme == bad {
			*vs = append(*vs, Violation{Rule: "url-scheme", Element: elem,
				Detail: fmt.Sprintf("<%s %s=%q> — the %q scheme is never permitted", elem, attr, raw, scheme)})
			return
		}
	}
	for _, ok := range p.SchemesServeOnly {
		if scheme == strings.ToLower(ok) {
			// DELIBERATELY permitted in BOTH modes, including freeze — this
			// aligns with the project's existing, considered ruling in
			// internal/gate: "A reader-clickable <a href='https://…'> is
			// DELIBERATELY not [flagged]". Covenant IV forbids a frozen doc
			// from REACHING OUT — an automatic fetch (src, <link>, url()) —
			// not from containing a hyperlink the reader may choose to click.
			//
			// My own spec (html-value-sanitizer.md §3.3) originally called for
			// rejecting these at freeze. That was stricter than the project's
			// ruling and would have broken legitimate documents, so the spec
			// was corrected to match the code rather than the reverse.
			//
			// Freeze-safety of an html block is STRUCTURAL rather than
			// mode-dependent: the whitelist contains no auto-fetching
			// construct at all — no src anywhere, no img/iframe/link/object/
			// embed/audio/video, and style= (which carries url()) is rejected
			// unconditionally. There is nothing left that can phone home.
			_ = mode
			return
		}
	}
	*vs = append(*vs, Violation{Rule: "url-scheme", Element: elem,
		Detail: fmt.Sprintf("<%s %s=%q> — scheme %q is not on the whitelist", elem, attr, raw, scheme)})
}

// normaliseURL lowercases and removes the whitespace/control characters that
// browsers ignore inside a scheme — "java\tscript:", "JaVaScRiPt:",
// "\x01javascript:" all normalise to "javascript:".
func normaliseURL(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r <= 0x20 || r == 0x7f {
			continue // control chars and whitespace are ignored by parsers
		}
		b.WriteRune(r)
	}
	return strings.ToLower(strings.TrimSpace(b.String()))
}
