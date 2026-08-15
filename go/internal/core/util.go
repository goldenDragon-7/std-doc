// Package core is the page-assembly layer: anchors, numbering, nav, breadcrumb,
// the page shell, CSS dedup, and the node/section/evidence emission the
// core owns around primitive output. The core owns the shell; the registry owns blocks.
package core

import (
	"regexp"
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
func richInline(raw string) string {
	locs := mdLinkRe.FindAllStringSubmatchIndex(raw, -1)
	if locs == nil {
		return esc(raw)
	}
	var b strings.Builder
	last := 0
	for _, m := range locs {
		b.WriteString(esc(raw[last:m[0]]))
		text, url := raw[m[2]:m[3]], raw[m[4]:m[5]]
		b.WriteString(`<a href="` + esc(url) + `">` + esc(text) + `</a>`)
		last = m[1]
	}
	b.WriteString(esc(raw[last:]))
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
