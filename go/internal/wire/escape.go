package wire

import "strings"

// HTMLEscape mirrors Python's html.escape(s, quote=True): it replaces the five
// characters & < > " ' and passes everything else (including all non-ASCII)
// through unchanged (wire-spec §1).
//
// A single pass maps each input byte independently, so the "ampersand first"
// ordering is satisfied by construction — there is no sequential replace that
// could re-escape an introduced '&' (the &lt; -> &amp;lt; double-escape hazard).
func HTMLEscape(s string) string {
	// Fast path: nothing to escape.
	if !strings.ContainsAny(s, "&<>\"'") {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 16)
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		case '\'':
			b.WriteString("&#x27;")
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

// Esc is the engine's esc() wrapper (publish.esc / page-mode esc): None/nil
// becomes "" (never "None"), every other value is stringified with Python str()
// parity (PyStr) and then HTML-escaped.
func Esc(v any) string {
	if v == nil {
		return ""
	}
	return HTMLEscape(PyStr(v))
}
