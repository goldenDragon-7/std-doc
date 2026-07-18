package core

import (
	"context"
	"io"
	"log/slog"
	"regexp"
	"strings"

	"oss.terrastruct.com/d2/d2graph"
	"oss.terrastruct.com/d2/d2layouts/d2dagrelayout"
	"oss.terrastruct.com/d2/d2lib"
	"oss.terrastruct.com/d2/d2renderers/d2svg"
	"oss.terrastruct.com/d2/d2themes/d2themescatalog"
	d2log "oss.terrastruct.com/d2/lib/log"
	"oss.terrastruct.com/d2/lib/textmeasure"

	"stddoc/internal/wire"
)

// d2Version is the version string the reference `d2` CLI bakes into every SVG's
// data-d2-version attribute. The in-process library (built as a dependency)
// reports "v0.7.1-HEAD" instead — pure build metadata, not diagram content — so
// we normalize it to keep the rendered SVG byte-identical to the oracle. Pinned
// to the go.mod d2 version.
const d2Version = "0.7.1"

var d2VersionRe = regexp.MustCompile(`data-d2-version="[^"]*"`)

// renderD2SVG compiles D2 source to an inline SVG, IN-PROCESS (no external
// tool — the §6 mission). Returns "" on any error; a diagram must never break
// the build (mirrors d2.render_svg's None). Theme 0 matches the reference's
// `d2 --theme 0`.
func renderD2SVG(src string) string {
	// Theme 0 (NeutralDefault) is the byte-identical oracle path used by the
	// built-in structured primitives (swimlane, statetrack) — do not change it.
	return renderD2SVGThemed(src, d2themescatalog.NeutralDefault.ID)
}

// renderD2SVGThemed is renderD2SVG parameterized by theme ID — the additive
// entry point for the diagram primitive, which routes structural types through
// D2 on a DARK theme (DarkMauve, ID 200 — the diagram team's vetted default) so
// they match the vetted quality on the dark default page. Still fully
// in-process (no external tool) and freeze-safe. renderD2SVG delegates here
// with theme 0, so the conformance oracle is preserved byte-for-byte.
func renderD2SVGThemed(src string, themeID int64) string {
	defer func() { _ = recover() }()
	ruler, err := textmeasure.NewRuler()
	if err != nil || ruler == nil {
		return ""
	}
	layout := func(ctx context.Context, g *d2graph.Graph) error {
		return d2dagrelayout.DefaultLayout(ctx, g)
	}
	compileOpts := &d2lib.CompileOptions{
		Ruler:          ruler,
		LayoutResolver: func(string) (d2graph.LayoutGraph, error) { return layout, nil },
	}
	theme := themeID
	renderOpts := &d2svg.RenderOpts{ThemeID: &theme}
	// Inject a discard logger so d2's "missing slog.Logger" WARN + stack trace
	// never reaches our stderr; this is a render detail, not an error path.
	ctx := d2log.With(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	diagram, _, err := d2lib.Compile(ctx, src, compileOpts, renderOpts)
	if err != nil || diagram == nil {
		return ""
	}
	out, err := d2svg.Render(diagram, renderOpts)
	if err != nil {
		return ""
	}
	// The reference `d2 - -` CLI writes the SVG with a trailing newline; the
	// in-process Render omits it. Match the oracle's bytes.
	svg := d2VersionRe.ReplaceAllString(string(out), `data-d2-version="`+d2Version+`"`)
	if !strings.HasSuffix(svg, "\n") {
		svg += "\n"
	}
	return svg
}

// d2DiagramCard wraps a rendered inline SVG in the standard chrome (d2.diagram_card).
func d2DiagramCard(svg, label string) string {
	return "<div class='diagram-card'><div class='dc-top'>" +
		"<span class='dc-label'>" + wire.HTMLEscape(label) + "</span>" +
		"<button class='fz-btn'>&#x26F6; fullscreen</button></div>" +
		"<div class='diagram-svg'>" + svg + "</div></div>"
}

// d2SourceBlock is the degrade path: a labeled source block + a loud skip note
// (d2.source_block). reason defaults to "d2 binary not on PATH".
func d2SourceBlock(src, label, reason string) string {
	if reason == "" {
		reason = "d2 binary not on PATH"
	}
	return "<div class='diagram-card diagram-degraded'><div class='dc-top'>" +
		"<span class='dc-label'>" + wire.HTMLEscape(label) + "</span>" +
		"<span class='dc-skip' style='color:#b58900;font-weight:600'>" +
		"&#9888; diagram not rendered (" + wire.HTMLEscape(reason) + ") — source shown</span>" +
		"</div><pre class='diagram-source' style='overflow:auto'>" +
		wire.HTMLEscape(src) + "</pre></div>"
}

var identRe = regexp.MustCompile(`[^A-Za-z0-9_]+`)

func d2Ident(s string) string {
	out := strings.Trim(identRe.ReplaceAllString(s, "_"), "_")
	if out == "" {
		return "n"
	}
	return out
}
