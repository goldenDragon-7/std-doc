package core

import (
	"fmt"
	"strings"

	"stddoc/internal/sanitize"
	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// The `html` bounded-value primitive — the escape hatch, and the ONLY
// untrusted slot in a std-doc.
//
// WHY IT EXISTS (the leaf-gap worklist, measured): the corpus holds
// 1,070 distinct CSS classes across 73 content-unique documents, and ~75% of
// them appear in exactly ONE document. That tail is not a backlog to work
// through — it is per-document invention, and no primitive library will ever
// enumerate it. Containers converge (0.53 new/doc) and the shared skin core is
// bounded (72 shapes at >=5 docs), but the tail does not converge (11.83
// new/doc). This primitive is what the tail gets, so an author is never
// blocked on a shape the library lacks.
//
// WHY IT IS SAFE (the HTML value-sanitizer design note): it is a bounded VALUE
// inside JSON-canon, never the container. That means exactly one untrusted
// slot at a known schema location, so the gate is a whitelist over one node
// type instead of a proof over a whole document. Everything the block contains
// is parsed and RE-SERIALIZED FROM THE PARSE TREE, and any violation is a LOUD
// refusal — never a silent strip.
//
// This primitive is core-owned (Go) rather than a data-template for one
// reason: it is the only one that must run a security gate, and a gate
// expressed as data could be disabled by editing data.
//
//	{ "type": "html", "content": "<div class=\"lane-map\">…</div>" }
//
// THE SUCCESS METRIC IS THAT USAGE FALLS. A shape appearing in many documents'
// html blocks is a promotion candidate for a real primitive. If html usage
// rises indefinitely while the leaf-gap count falls, the library is building
// the wrong shapes — see `stddoc primitives --html-usage`.
func htmlBlockRenderWith(pol *sanitize.Policy) func(*wire.OrderedMap, *template.Ctx) (string, error) {
	return func(block *wire.OrderedMap, ctx *template.Ctx) (string, error) {
		content := str(block, "content")
		if strings.TrimSpace(content) == "" {
			return "", nil
		}

		if pol == nil {
			// No policy loaded means no gate. Refusing is the only safe answer:
			// an absent gate must never be mistaken for a permissive one.
			return "", fmt.Errorf("html block: no sanitizer policy loaded " +
				"(html_whitelist.json missing from the library) — refusing to emit " +
				"author HTML ungated")
		}

		// Mode is ModeServe always: freeze-safety is STRUCTURAL, not
		// mode-dependent. The whitelist admits no auto-fetching construct (no src
		// anywhere, no img/iframe/link/object/embed, and style= — which carries
		// url() — is rejected unconditionally), so there is nothing in a passing
		// block that can phone home. See sanitize.checkURL for why a
		// reader-clickable <a href> is deliberately not a Covenant IV leak.
		clean, err := sanitize.Sanitize(content, pol, sanitize.ModeServe)
		if err != nil {
			return "", fmt.Errorf("html block: %w", err)
		}
		return "<div class='html-block'>" + clean + "</div>", nil
	}
}
