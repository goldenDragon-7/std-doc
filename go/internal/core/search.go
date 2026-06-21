// search.go — the build-time full-text index (PRD P0-2), ported faithfully from
// publish.py's search_index()/_node_text()/_section_text(). The Python→Go port
// shipped the client (every page emits <script src='search-index.js'> and the
// inlined search.js reads window.CF_SEARCH_INDEX) but NEVER generated the index
// → 404 on every page and a search box that always returned zero hits. This
// restores the generator.
//
// One entry per non-group node, each with per-section anchors (so a hit
// deep-links to the exact region) and a flattened lowercased text blob. The
// shape mirrors what stddoc-lib/search.js consumes: entry.url/.title/.number/
// .text and section.anchor/.number/.name/.text (slug carried for parity).
package core

import (
	"bytes"
	"encoding/json"
	"strings"

	"stddoc/internal/wire"
)

// SearchSection is one section anchor inside a node entry.
type SearchSection struct {
	Anchor string `json:"anchor"`
	Number string `json:"number"`
	Name   string `json:"name"`
	Text   string `json:"text"`
}

// SearchEntry is one indexed node (publish.py search_index out[] element).
type SearchEntry struct {
	Slug     string          `json:"slug"`
	URL      string          `json:"url"`
	Number   string          `json:"number"`
	Title    string          `json:"title"`
	Sections []SearchSection `json:"sections"`
	Text     string          `json:"text"`
}

// SearchIndex builds the full-text index for a doc-tree. It is a no-op-safe to
// call after Publish (buildTree is idempotent). Group nodes are skipped — they
// have no page.
func SearchIndex(doc *wire.OrderedMap) []SearchEntry {
	buildTree(doc)
	var out []SearchEntry
	for _, nv := range list(doc, "_all") {
		n, ok := omap(nv)
		if !ok || truthy(get(n, "is_group")) {
			continue
		}
		num := str(n, "_number")
		slug := str(n, "slug")
		var secs []SearchSection
		for j, sv := range list(n, "sections") {
			s, ok := omap(sv)
			if !ok {
				continue
			}
			sid, _ := anchor(slug, j+1)
			number := "§" + itoa(j+1)
			if num != "" {
				number = num + " §" + itoa(j+1)
			}
			secs = append(secs, SearchSection{
				Anchor: sid,
				Number: number,
				Name:   str(s, "name"),
				Text:   sectionText(s),
			})
		}
		out = append(out, SearchEntry{
			Slug:     slug,
			URL:      slug + ".html",
			Number:   num,
			Title:    navLabel(str(n, "title")),
			Sections: secs,
			Text:     nodeText(n),
		})
	}
	return out
}

// MarshalSearchIndex serializes the index the way publish.py did:
// json.dumps(..., ensure_ascii=False) — no HTML-escaping of < > &, so prose in
// the text blobs survives verbatim. (Go's default Marshal escapes them.)
func MarshalSearchIndex(entries []SearchEntry) ([]byte, error) {
	if entries == nil {
		entries = []SearchEntry{}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(entries); err != nil {
		return nil, err
	}
	// Encode appends a trailing newline; strip it to match json.dumps.
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// nodeText flattens a node's prose into one lowercased blob (publish._node_text).
func nodeText(n *wire.OrderedMap) string {
	var parts []string
	parts = appendNonEmpty(parts, str(n, "title"), str(n, "tagline"))
	for _, sv := range list(n, "sections") {
		s, ok := omap(sv)
		if !ok {
			continue
		}
		parts = appendNonEmpty(parts, str(s, "name"), str(s, "summary"))
		for _, iv := range list(s, "items") {
			it, ok := omap(iv)
			if !ok {
				continue
			}
			parts = appendNonEmpty(parts, str(it, "name"), str(it, "desc"))
		}
	}
	return strings.ToLower(strings.Join(parts, " "))
}

// sectionText flattens one section's prose (publish._section_text).
func sectionText(s *wire.OrderedMap) string {
	var parts []string
	parts = appendNonEmpty(parts, str(s, "name"), str(s, "summary"))
	for _, iv := range list(s, "items") {
		it, ok := omap(iv)
		if !ok {
			continue
		}
		parts = appendNonEmpty(parts, str(it, "name"), str(it, "desc"))
	}
	return strings.ToLower(strings.Join(parts, " "))
}

func appendNonEmpty(parts []string, vals ...string) []string {
	for _, v := range vals {
		if v != "" {
			parts = append(parts, v)
		}
	}
	return parts
}
