package core

import (
	"regexp"
	"strings"
)

// mermaid_fix.go — make Mermaid source safe for a dark-theme living document.
// Ported faithfully from engine/scripts/mermaid_fix.py (the Python->Go port
// dropped it). Each transform otherwise produces the silent "bomb icon" with
// no useful error. techno-dark is the DEFAULT style, so without these the
// default surface ships flat (Covenant II). The three transforms run in order:
//
//  1. strip emoji from `subgraph id["..."]` quoted labels   (parse error)
//  2. flatten `\n` -> space inside pipe edge labels `|...|`  (parse error)
//  3. convert Bootstrap light-mode classDef colors -> dark   (unreadable text)
//
// fix() is idempotent: running twice is a no-op.

// emojiRE — emoji ranges that break subgraph quoted labels. Mirrors the Python
// EMOJI_RE ranges exactly.
var emojiRE = regexp.MustCompile(`[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{3000}-\x{3300}]+`)

// subgraphLabelRE matches `subgraph id["..."]` quoted labels (only those;
// regular node labels are left alone). RE2 supports the non-greedy `*?`.
var subgraphLabelRE = regexp.MustCompile(`(subgraph\s+\w+\[")([^"]*?)(")`)

// edgeLabelRE matches pipe edge labels `|...|`. `[^|\n]` keeps the match from
// spanning real newlines.
var edgeLabelRE = regexp.MustCompile(`\|([^|\n]+?)\|`)

// darkClassDefs — Bootstrap light-mode classDef triples -> dark-mode
// equivalents. The longer `,font-weight:bold` variant is handled first so the
// bare replacement doesn't clip it.
var darkClassDefs = [...][2]string{
	{"fill:#d4edda,stroke:#28a745,color:#155724", "fill:#14532d,stroke:#4ade80,color:#bbf7d0"}, // green/pass
	{"fill:#f8d7da,stroke:#dc3545,color:#721c24", "fill:#7f1d1d,stroke:#f87171,color:#fee2e2"}, // red/fail
	{"fill:#fff3cd,stroke:#ffc107,color:#856404", "fill:#78350f,stroke:#fbbf24,color:#fef3c7"}, // yellow/msg
	{"fill:#cce5ff,stroke:#004085,color:#004085", "fill:#1e3a5f,stroke:#60a5fa,color:#dbeafe"}, // blue/note
	{"fill:#e2e3e5,stroke:#6c757d,color:#383d41", "fill:#1e293b,stroke:#94a3b8,color:#e2e8f0"}, // grey/data
	{"fill:#d1ecf1,stroke:#0c5460,color:#0c5460", "fill:#164e63,stroke:#22d3ee,color:#cffafe"}, // cyan/delta
}

// stripEmojiSubgraph — Bug 1: emoji inside `subgraph id["..."]` labels
// parse-error. Strip them from the quoted subgraph label only.
func stripEmojiSubgraph(content string) string {
	return subgraphLabelRE.ReplaceAllStringFunc(content, func(m string) string {
		g := subgraphLabelRE.FindStringSubmatch(m)
		return g[1] + strings.TrimSpace(emojiRE.ReplaceAllString(g[2], "")) + g[3]
	})
}

// fixEdgeLabels — Bug 2: literal `\n` inside pipe edge labels `|...|`
// parse-errors. Flatten to a space.
func fixEdgeLabels(content string) string {
	return edgeLabelRE.ReplaceAllStringFunc(content, func(m string) string {
		g := edgeLabelRE.FindStringSubmatch(m)
		return "|" + strings.ReplaceAll(g[1], `\n`, " ") + "|"
	})
}

// darkClassdefs — Bug 3: swap light-mode Bootstrap classDef colors for dark
// equivalents.
func darkClassdefs(content string) string {
	for _, pair := range darkClassDefs {
		old, new := pair[0], pair[1]
		content = strings.ReplaceAll(content, old+",font-weight:bold", new+",font-weight:bold")
		content = strings.ReplaceAll(content, old, new)
	}
	return content
}

// mermaidFix applies all three transforms in order. Idempotent.
func mermaidFix(content string) string {
	content = stripEmojiSubgraph(content)
	content = fixEdgeLabels(content)
	content = darkClassdefs(content)
	return content
}
