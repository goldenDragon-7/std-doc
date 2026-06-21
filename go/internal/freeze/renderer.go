package freeze

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"

	"stddoc/internal/core"
)

// mermaidConfig is the dark-theme block copied verbatim from freeze.py's
// _MERMAID_CONFIG, so the frozen SVG matches the served render.
var mermaidConfig = map[string]any{
	"theme": "dark",
	"themeVariables": map[string]any{
		"darkMode": true, "background": "#0d1526", "primaryColor": "#1a2236",
		"primaryTextColor": "#e2e8f0", "primaryBorderColor": "#334155",
		"lineColor": "#60a5fa", "secondaryColor": "#1e293b", "tertiaryColor": "#0a0e17",
		"edgeLabelBackground": "#1a2236", "clusterBkg": "#111827",
		"clusterBorder": "#334155", "titleColor": "#e2e8f0", "nodeTextColor": "#e2e8f0",
	},
	"flowchart": map[string]any{"curve": "basis", "padding": 20},
}

// svgOnly strips the XML prolog/doctype mmdc emits; keeps only the <svg> element.
var svgOnly = regexp.MustCompile(`(?s)<svg\b.*</svg>`)

// FindRenderer returns a Renderer backed by the mermaid CLI, or nil if none is
// available. Prefers `mmdc` on PATH; falls back to `npx -y @mermaid-js/mermaid-cli`.
// This is the author-side, freeze-time dependency — it bakes once; the frozen
// output stays zero-network.
func FindRenderer() Renderer {
	var base []string
	if p, err := exec.LookPath("mmdc"); err == nil {
		base = []string{p}
	} else if p, err := exec.LookPath("npx"); err == nil {
		base = []string{p, "-y", "@mermaid-js/mermaid-cli"}
	} else {
		return nil
	}

	return func(source string) (string, error) {
		work, err := os.MkdirTemp("", "stddoc-mmd-")
		if err != nil {
			return "", err
		}
		defer os.RemoveAll(work)

		mmd := filepath.Join(work, "d.mmd")
		out := filepath.Join(work, "d.svg")
		cfg := filepath.Join(work, "c.json")
		pup := filepath.Join(work, "p.json")

		// source-text fixes (emoji/edge-label/classDef dark) before rendering.
		if err := os.WriteFile(mmd, []byte(core.MermaidFix(trimSpace(source))), 0o644); err != nil {
			return "", err
		}
		cfgBytes, _ := json.Marshal(mermaidConfig)
		if err := os.WriteFile(cfg, cfgBytes, 0o644); err != nil {
			return "", err
		}
		if err := os.WriteFile(pup, []byte(`{"args":["--no-sandbox"]}`), 0o644); err != nil {
			return "", err
		}

		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer cancel()
		args := append(append([]string{}, base[1:]...),
			"-i", mmd, "-o", out, "-b", "transparent", "-c", cfg, "-p", pup)
		cmd := exec.CommandContext(ctx, base[0], args...)
		if combined, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("mmdc render failed: %w\n%s", err, combined)
		}

		svg, err := os.ReadFile(out)
		if err != nil {
			return "", err
		}
		if m := svgOnly.Find(svg); m != nil {
			return string(m), nil
		}
		return string(svg), nil
	}
}

func trimSpace(s string) string {
	// match Python source.strip() before rendering.
	start, end := 0, len(s)
	for start < end && isSpace(s[start]) {
		start++
	}
	for end > start && isSpace(s[end-1]) {
		end--
	}
	return s[start:end]
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\v' || b == '\f'
}
