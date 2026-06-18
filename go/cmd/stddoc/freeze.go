package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"stddoc/internal/gate"
)

// cmdFreeze enforces covenant IV over a published directory: every page must be
// self-contained (no external refs, no un-freezable mermaid). It does not bake
// — the renderer already emits inline d2 SVG + embedded CSS/JS — it verifies.
//
//	stddoc freeze <dir>
func cmdFreeze(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: stddoc freeze <dir>")
	}
	dir := args[0]
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	pages := map[string]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".html") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return err
		}
		pages[e.Name()] = string(b)
	}
	if err := gate.Enforce(pages); err != nil {
		return err
	}
	fmt.Printf("freeze OK — %d page(s) self-contained, zero external references\n", len(pages))
	return nil
}
