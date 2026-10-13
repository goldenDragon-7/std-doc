package core

import (
	"stddoc/internal/registry"
	"stddoc/internal/wire"
)

// sections_validator.go — close the silent-drop hole on the `sections` primitive.
//
// Template-driven primitives derive their field names from templates.json and
// get a near-miss warning for free (fieldValidator, fieldnames.go). The
// HAND-CODED primitives have no template to derive from, so they got no
// validator at all: an unrecognised key inside a section or an item was simply
// never read, and the authored content vanished with no error and no warning.
//
// MEASURED 2026-09-01 across the 23 shipped source.json files: sections use
// exactly {name, icon, tag, summary, items, citations} and items exactly
// {name, desc, citations, evidence} — and every one of those IS read by
// sectionsRender (`evidence` via ctx.RenderEvidence(it), content.go:221). The
// shipped corpus is clean; this validator protects future authors, not past
// ones.
//
// Because that field set is closed and clean, this validator warns on ANY
// unknown key rather than only on near-misses. That is the stronger check and
// it is what the evidence supports: the near-miss rule would NOT have caught
// the authoring mistake that motivated this (a section written with `blocks:`
// instead of `summary:`/`items:` — `blocks` is nowhere near either word, so it
// slipped through silently and rendered an empty heading).
//
// Warnings never abort a publish (level "warn"); they surface the drop.

// sectionFields is every key sectionsRender reads on a section object.
var sectionFields = map[string]bool{
	"name": true, "icon": true, "tag": true,
	"summary": true, "items": true, "citations": true,
}

// itemFields is every key sectionsRender reads on an item object. `evidence` is
// read via ctx.RenderEvidence(it) (content.go:221) — it belongs here, and
// omitting it would fire a false warning on
// examples/data-derived-example/source.json.
var itemFields = map[string]bool{
	"name": true, "desc": true, "citations": true, "evidence": true,
}

// sectionsValidator walks a node's sections and items, reporting any key the
// renderer will not read. It deliberately does NOT inspect the node's own keys:
// the "sections" block is synthetic and carries the WHOLE node as its data, so
// the node's legitimate fields (slug, title, status, blocks, group, tagline, …)
// are not this primitive's business and flagging them would be pure noise.
func sectionsValidator(block *wire.OrderedMap) []registry.Finding {
	slug := str(block, "slug")
	var out []registry.Finding
	for si, sv := range list(block, "sections") {
		s, ok := omap(sv)
		if !ok {
			continue
		}
		label := sectionLabel(s, si)
		for _, k := range s.Keys() {
			if !sectionFields[k] {
				out = append(out, warnf(slug,
					"sections: %s has field '%s', which no primitive reads — it renders as NOTHING. Sections take name/icon/tag/summary/items/citations; prose belongs in 'summary' and sub-points in 'items':[{name,desc}].",
					label, k))
			}
		}
		for ii, iv := range list(s, "items") {
			it, ok := omap(iv)
			if !ok {
				continue
			}
			for _, k := range it.Keys() {
				if !itemFields[k] {
					out = append(out, warnf(slug,
						"sections: %s item %d ('%s') has field '%s', which no primitive reads — it renders as NOTHING. Items take name/desc/citations.",
						label, ii+1, str(it, "name"), k))
				}
			}
		}
	}
	return out
}

// sectionLabel names a section for a warning message — by its own name when it
// has one, else by position, so the author can find it.
func sectionLabel(s *wire.OrderedMap, idx int) string {
	if n := str(s, "name"); n != "" {
		return "section '" + n + "'"
	}
	return "section " + itoa(idx+1)
}
