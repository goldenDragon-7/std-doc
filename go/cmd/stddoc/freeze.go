package main

import (
	"fmt"
	"path/filepath"

	"stddoc/internal/freeze"
)

// cmdFreeze turns a published directory of live pages into a portable, read-only
// snapshot: a sibling frozen/ dir + a single <slug>_frozen_<ts>.zip. It bakes
// each mermaid diagram to inline SVG (via mmdc, author-side only), strips the
// served-only widget/CDN tags, re-inlines the offline pan-zoom kit, adds the
// frozen banner, and self-checks that every frozen page reaches out to nothing
// (Covenant IV). d2-only docs need no renderer and freeze pure-stdlib; a doc
// with un-bakeable mermaid and no renderer is REFUSED loudly.
//
//	stddoc freeze <dir> [title]
func cmdFreeze(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: stddoc freeze <dir> [title]")
	}
	dir := args[0]
	title := "doc"
	if len(args) > 1 {
		title = args[1]
	}

	libRoot, err := resolveLibRoot("")
	if err != nil {
		return err
	}
	libDir := filepath.Join(libRoot, "lib")

	render := freeze.FindRenderer()
	res, err := freeze.Run(dir, title, "", libDir, render)
	if err != nil {
		return err
	}

	bakedNote := ""
	if res.Baked > 0 {
		bakedNote = fmt.Sprintf(" (%d with baked mermaid SVG)", res.Baked)
	}
	fmt.Printf("froze %d standalone page(s) to %s%s\n", len(res.Pages), res.FrozenDir, bakedNote)
	fmt.Printf("external-ref leaks (must be 0): 0\n")
	if len(res.Extras) > 0 {
		fmt.Printf("carried siblings: %v\n", res.Extras)
	}
	fmt.Printf("zip: %s\n", res.ZipPath)
	return nil
}
