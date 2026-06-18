package wire

// Trailing-newline policy (wire-spec §4). The two render modes differ and the
// difference is canonical — emit exactly these bytes, normalize neither way.
//
//	DocTreePage  — publish.build() output ends "</html>"   (NO trailing newline)
//	StandalonePage — core.page.render_page() ends "</html>\n" (ONE trailing newline)
//
// These helpers make the policy explicit at the call sites that assemble final
// page bytes, so the distinction is named rather than implicit.

// DocTreePageBytes finalizes a doc-tree page: no trailing newline.
func DocTreePageBytes(html string) string { return html }

// StandalonePageBytes finalizes a standalone (layout:page) page: exactly one
// trailing newline. If the body already ends in one it is left as-is.
func StandalonePageBytes(html string) string {
	if len(html) > 0 && html[len(html)-1] == '\n' {
		return html
	}
	return html + "\n"
}
