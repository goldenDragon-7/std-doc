package core

import "stddoc/internal/wire"

// labels.go — the page-layout-language "on this page" fix (see the
// layout-language design note §4.3). The reference layout's aside used to derive
// ONLY from node["sections"]; it must now also see band.label/band.title at
// any depth, in the SAME document order the page actually renders, or the
// TOC becomes a reason to avoid the expressive path (Covenant III, inverted
// inside our own engine — the failure mode this file exists to prevent).

// tocLabel is one entry in the "on this page" aside.
type tocLabel struct{ Text, Anchor string }

// collectTOCLabels walks the ADAPTED block stream (nblocks — the same value
// renderBlocks consumes) in render order and returns every anchorable label:
// sections[].name (today's source, byte-identical for a doc with no band)
// plus band.label/band.title found at any depth via walkNestedBlocks (the
// one shared walker — §6.2 of the design doc).
//
// Walking nblocks instead of the raw node is deliberate and load-bearing:
// adaptNode hoists `at:"lead"` blocks BEFORE the synthetic "sections" entry,
// so a lead band's label must precede every section name in the aside. A
// single pass over nblocks in order gets this right by construction; two
// separate loops (sections, then bands) would not.
func collectTOCLabels(n *wire.OrderedMap, nblocks []streamBlock) []tocLabel {
	var out []tocLabel
	for _, sb := range nblocks {
		if sb.Type == "sections" {
			for j0, sv := range list(n, "sections") {
				s, ok := omap(sv)
				if !ok {
					continue
				}
				sid, _ := anchor(str(n, "slug"), j0+1)
				out = append(out, tocLabel{str(s, "name"), sid})
			}
			continue
		}
		if sb.Data == nil {
			continue
		}
		// Only walk AUTHORED block data (Data["type"] == sb.Type) — mirrors the
		// guard collectBlockCSS and assignCanvasBoardIDs both use to skip the
		// synthetic node-level entries (badges, diagrams, children, evidence),
		// whose Data is the whole node, not a block.
		t, ok := sb.Data.Get("type")
		if !ok {
			continue
		}
		if ts, _ := t.(string); ts != sb.Type {
			continue
		}
		walkNestedBlocks(sb.Data, func(node *wire.OrderedMap, typ string) {
			if typ != "band" {
				return
			}
			lbl := firstNonEmpty(str(node, "label"), str(node, "title"))
			if lbl == "" {
				return
			}
			out = append(out, tocLabel{lbl, str(node, "id")})
		})
	}
	return out
}

// firstNonEmpty returns the first non-empty string, or "".
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
