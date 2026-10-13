// Package core is the page-assembly layer: anchors, numbering, nav, breadcrumb,
// the page shell, CSS dedup, and the node/section/evidence emission the
// core owns around primitive output. The core owns the shell; the registry owns blocks.
package core

import (
	"regexp"
	"sort"
	"strconv"
	"strings"

	"stddoc/internal/wire"
)

// esc is the engine escaper (None/nil -> "", else Python str() + html.escape).
func esc(v any) string { return wire.Esc(v) }

// mdLinkRe matches a markdown link [text](url) in prose where the URL is an
// explicit http(s) URL. Requiring the scheme is deliberate on two counts: it
// refuses javascript:/data: (and every other scheme) so nothing dangerous
// reaches an href, and it avoids linkifying code-shaped prose like
// ctx['anchor_attr'](block) — a scheme-less target is left as plain text. The
// URL forbids whitespace, quotes and angle brackets so a link cannot break out
// of its own attribute. (An https anchor also freezes cleanly now — see NEW 2.)
var mdLinkRe = regexp.MustCompile(`\[([^\]]+)\]\((https?://[^\s()<>"']+)\)`)

// codeRe matches a single-backtick inline code span `like this` — the GAPS.md
// leaf gap #2 (the template GAPS worklist, stddoc-template-scout): "backticks in
// prose render as literal characters; there is no <code> anywhere in the
// render path," filed as the single highest-value fix for the Domain/System
// Reference template family, whose prose is mostly file:line and symbol
// citations threaded inline. No nested backtick, no newline crossing — a
// single flat span, matching every corpus usage observed (`IndexService`,
// `Pipeline/IQLayer.swift:51`). The content is escaped exactly like any other
// text, so a doc author cannot smuggle markup through a code span.
//
// DELIBERATELY NOT wired into richInline/richText: this repo's OWN self-doc
// corpus (conformance/cases/self-doc, self-doc/source.json) already contains
// abundant single-backtick prose (`` `type` ``, `` `stddoc publish` ``, …)
// written in anticipation of exactly this feature but pinned into the golden-
// master BEFORE it existed. Wiring code-span support into the shared
// richInline path flips every one of those into <code> chips and breaks
// byte-identity on 11 self-doc/m2-extends pages — a real, MEASURED collision
// (see git history on this file), not a hypothetical one. Rather than either
// silently regenerate pinned goldens or drop a real leaf-gap fix, this ships
// as a SEPARATE opt-in path (richInlineCode/richTextCode below, the
// interpreter's new "richcode" node) that new templates request explicitly.
// Existing "rich"/"esc" fields are untouched — zero risk, zero golden drift.
var codeRe = regexp.MustCompile("`([^`\n]+)`")

// inlineSpan is one matched markdown span (link or code), used to merge the
// two patterns into a single left-to-right pass over the string.
type inlineSpan struct {
	start, end int
	html       string
}

// richText escapes prose AND turns markdown links [text](url) into real anchors
// (finding 2026-08-12 NEW 4: a doc-tree could state a URL but never link to it).
// It escapes every non-link segment exactly as esc would, so text with no link
// is byte-identical to esc(raw) — existing pages don't use the syntax, so the
// conformance golden-master holds. A reader-clickable anchor also freezes
// cleanly now (pairs with the NEW 2 gate change). Only http(s) and scheme-less
// relative URLs are emitted; anything else is escaped as ordinary text.
// olRe matches an ordered-list marker at the start of a (trimmed) line: "1. ".
var olRe = regexp.MustCompile(`^\d+\.\s+`)

// blankLineRe splits prose into blocks on a blank line (a run of newlines with
// only whitespace between them).
var blankLineRe = regexp.MustCompile(`\n[ \t]*\n`)

// richText renders prose. Single-line input with no block markers is
// byte-IDENTICAL to the old link-only richText (so the conformance golden-master
// holds — no existing page uses newlines in a prose field). Multi-line input
// gains real structure: blank line → paragraph, single newline → <br>, and a run
// of "- "/"* " or "1. " lines → a <ul>/<ol>. This is the fix for prose that
// "spewed" as one wall of text (a great header then an unbroken run-on). Inline
// escaping + markdown links are applied within every segment via richInline.
func richText(raw string) string {
	if !strings.Contains(raw, "\n") {
		return richInline(raw) // fast path — identical to the historical output
	}
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	var b strings.Builder
	for _, blk := range blankLineRe.Split(raw, -1) {
		var lines []string
		for _, ln := range strings.Split(blk, "\n") {
			if strings.TrimSpace(ln) != "" {
				lines = append(lines, strings.TrimSpace(ln))
			}
		}
		if len(lines) == 0 {
			continue
		}
		allUL, allOL := true, true
		for _, ln := range lines {
			if !(strings.HasPrefix(ln, "- ") || strings.HasPrefix(ln, "* ")) {
				allUL = false
			}
			if !olRe.MatchString(ln) {
				allOL = false
			}
		}
		switch {
		case allUL:
			b.WriteString("<ul>")
			for _, ln := range lines {
				b.WriteString("<li>" + richInline(strings.TrimSpace(ln[2:])) + "</li>")
			}
			b.WriteString("</ul>")
		case allOL:
			b.WriteString("<ol>")
			for _, ln := range lines {
				b.WriteString("<li>" + richInline(olRe.ReplaceAllString(ln, "")) + "</li>")
			}
			b.WriteString("</ol>")
		default:
			b.WriteString("<p>")
			for i, ln := range lines {
				if i > 0 {
					b.WriteString("<br>")
				}
				b.WriteString(richInline(ln))
			}
			b.WriteString("</p>")
		}
	}
	return b.String()
}

// richInline escapes one line of prose and turns markdown links [text](url) into
// real anchors (finding 2026-08-12 NEW 4: a doc-tree could state a URL but never
// link to it). Every non-link segment is escaped exactly as esc would, so text
// with no link is byte-identical to esc(raw) — the conformance golden-master
// holds. Only http(s) URLs are emitted; anything else is escaped as ordinary
// text (a reader-clickable https anchor also freezes cleanly — see NEW 2 gate).
// inlineCodeStyle is carried on the element rather than added to body.css ON
// PURPOSE. body.css is inlined into EVERY page, so a new rule there would
// re-baseline every conformance golden — including pages that contain no code
// span at all. Inline keeps the change surgical: only pages that actually use
// backticks change, and they change because they were rendering the backticks
// literally. It still themes, because every value is a token lookup.
const inlineCodeStyle = "font-family:var(--mono,ui-monospace,monospace);font-size:.92em;" +
	"padding:.08em .34em;border-radius:.28em;" +
	"background:color-mix(in srgb,var(--glow,#22d3ee) 11%,transparent);" +
	"border:1px solid color-mix(in srgb,var(--glow,#22d3ee) 22%,transparent);" +
	"color:var(--text,inherit)"

// richInline renders the inline markup a document actually needs, in one pass:
//
//	`code`   -> a themed inline code chip   (the citation atom)
//	**bold** -> <strong>
//	[t](url) -> a real anchor (http/https only)
//
// Code spans are resolved FIRST so backticked content is never re-interpreted —
// a literal `**not bold**` inside a code chip stays literal, and a URL inside
// one is not linkified.
//
// The inline code chip was missing entirely until 2026-09-01: richInline handled
// links and nothing else, so every backtick in every doc reached the reader as a
// literal backtick — including std-doc's own self-doc ("The block's `type`
// selects exactly this handler"). For a project whose covenant is that the
// file:line citation and the beauty are equally the author's responsibility,
// being unable to render an inline citation was the sharpest possible gap.
//
// Text containing none of these markers is byte-identical to esc(raw), so the
// golden-master holds for every page that does not use them.
func richInline(raw string) string {
	if !strings.ContainsAny(raw, "`*[") {
		return esc(raw) // fast path — unchanged, and the common case
	}
	var b strings.Builder
	for i, seg := range strings.Split(raw, "`") {
		if i%2 == 1 {
			// Odd segments sit between a matched pair of backticks.
			b.WriteString("<code style='" + inlineCodeStyle + "'>" + esc(seg) + "</code>")
			continue
		}
		b.WriteString(richEmphasis(seg))
	}
	return b.String()
}

// richEmphasis renders links then bold over a span known to contain no code.
func richEmphasis(raw string) string {
	var b strings.Builder
	last := 0
	for _, m := range mdLinkRe.FindAllStringSubmatchIndex(raw, -1) {
		b.WriteString(richBold(raw[last:m[0]]))
		text, url := raw[m[2]:m[3]], raw[m[4]:m[5]]
		b.WriteString(`<a href="` + esc(url) + `">` + esc(text) + `</a>`)
		last = m[1]
	}
	b.WriteString(richBold(raw[last:]))
	return b.String()
}

// richBold turns **paired** asterisks into <strong>. An unpaired ** is left as
// literal text rather than swallowing the rest of the paragraph.
func richBold(raw string) string {
	if !strings.Contains(raw, "**") {
		return esc(raw)
	}
	parts := strings.Split(raw, "**")
	// An even number of parts means an unpaired delimiter — emit verbatim.
	if len(parts)%2 == 0 {
		return esc(raw)
	}
	var b strings.Builder
	for i, p := range parts {
		if i%2 == 1 {
			b.WriteString("<strong>" + esc(p) + "</strong>")
		} else {
			b.WriteString(esc(p))
		}
	}
	return b.String()
}

// richInlineCode is richInline PLUS single-backtick code-span support (GAPS.md
// leaf gap #2) — a separate function, not a modification of richInline, so
// every existing "rich"/"esc" template field is completely unaffected (see the
// long comment on codeRe for why: this repo's own self-doc corpus already has
// pinned-golden backtick prose that would flip meaning if code-span parsing
// rode inside the shared richInline path). Reached only via the interpreter's
// "richcode" node — a template opts in explicitly.
func richInlineCode(raw string) string {
	linkLocs := mdLinkRe.FindAllStringSubmatchIndex(raw, -1)
	codeLocs := codeRe.FindAllStringSubmatchIndex(raw, -1)
	if linkLocs == nil && codeLocs == nil {
		return esc(raw)
	}
	spans := make([]inlineSpan, 0, len(linkLocs)+len(codeLocs))
	for _, m := range linkLocs {
		text, url := raw[m[2]:m[3]], raw[m[4]:m[5]]
		spans = append(spans, inlineSpan{m[0], m[1], `<a href="` + esc(url) + `">` + esc(text) + `</a>`})
	}
	for _, m := range codeLocs {
		spans = append(spans, inlineSpan{m[0], m[1], `<code>` + esc(raw[m[2]:m[3]]) + `</code>`})
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })

	var b strings.Builder
	last := 0
	for _, s := range spans {
		if s.start < last {
			continue // overlapping match (e.g. a backtick inside a link's text) — first-found wins
		}
		b.WriteString(esc(raw[last:s.start]))
		b.WriteString(s.html)
		last = s.end
	}
	b.WriteString(esc(raw[last:]))
	return b.String()
}

// richTextCode mirrors richText's block-structure handling (paragraphs, <br>,
// list detection) but routes inline segments through richInlineCode instead
// of richInline, so multi-line "richcode" fields also get code-span support.
func richTextCode(raw string) string {
	if !strings.Contains(raw, "\n") {
		return richInlineCode(raw)
	}
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	var b strings.Builder
	for _, blk := range blankLineRe.Split(raw, -1) {
		var lines []string
		for _, ln := range strings.Split(blk, "\n") {
			if strings.TrimSpace(ln) != "" {
				lines = append(lines, strings.TrimSpace(ln))
			}
		}
		if len(lines) == 0 {
			continue
		}
		allUL, allOL := true, true
		for _, ln := range lines {
			if !(strings.HasPrefix(ln, "- ") || strings.HasPrefix(ln, "* ")) {
				allUL = false
			}
			if !olRe.MatchString(ln) {
				allOL = false
			}
		}
		switch {
		case allUL:
			b.WriteString("<ul>")
			for _, ln := range lines {
				b.WriteString("<li>" + richInlineCode(strings.TrimSpace(ln[2:])) + "</li>")
			}
			b.WriteString("</ul>")
		case allOL:
			b.WriteString("<ol>")
			for _, ln := range lines {
				b.WriteString("<li>" + richInlineCode(olRe.ReplaceAllString(ln, "")) + "</li>")
			}
			b.WriteString("</ol>")
		default:
			b.WriteString("<p>")
			for i, ln := range lines {
				if i > 0 {
					b.WriteString("<br>")
				}
				b.WriteString(richInlineCode(ln))
			}
			b.WriteString("</p>")
		}
	}
	return b.String()
}

func itoa(i int) string { return strconv.Itoa(i) }

// --- node accessors (a node is a *wire.OrderedMap) -------------------------

func get(n *wire.OrderedMap, key string) any {
	if n == nil {
		return nil
	}
	v, _ := n.Get(key)
	return v
}

// str returns a string-typed field, "" if absent/nil. Non-strings stringify via
// Python str() parity (matches n.get(k, "") then esc/f-string usage).
func str(n *wire.OrderedMap, key string) string {
	v := get(n, key)
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return wire.PyStr(v)
}

func list(n *wire.OrderedMap, key string) []any {
	if l, ok := get(n, key).([]any); ok {
		return l
	}
	return nil
}

func omap(v any) (*wire.OrderedMap, bool) {
	m, ok := v.(*wire.OrderedMap)
	return m, ok
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case bool:
		return x
	case []any:
		return len(x) > 0
	case *wire.OrderedMap:
		return x.Len() > 0
	default:
		return true
	}
}

// --- string helpers ------------------------------------

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	out := slugRe.ReplaceAllString(strings.ToLower(s), "-")
	out = strings.Trim(out, "-")
	if out == "" {
		return "section"
	}
	return out
}

// navLabel trims a title at its first separator (publish.nav_label).
func navLabel(t string) string {
	for _, sep := range []string{" — ", " · ", " (", " - "} {
		t = strings.Split(t, sep)[0]
	}
	return t
}

func statusClass(s string) string {
	switch strings.ToUpper(s) {
	case "LIVE":
		return "b-live"
	case "PARTIAL":
		return "b-partial"
	case "WIP":
		return "b-wip"
	case "DEBT":
		return "b-debt"
	default:
		return "b-wip"
	}
}

// anchor is the deterministic, content-addressed anchor for a node/section/item
// (publish.anchor). parts holds 0, 1 (section) or 2 (section,item) numbers.
func anchor(slug string, parts ...int) (id, name string) {
	id, name = "cf-"+slug, "n="+slug
	if len(parts) >= 1 {
		id += "-s" + strconv.Itoa(parts[0])
		name += "§" + strconv.Itoa(parts[0])
		if len(parts) >= 2 {
			id += "-i" + strconv.Itoa(parts[1])
			name += "." + strconv.Itoa(parts[1])
		}
	}
	return id, name
}
