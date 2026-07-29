// Package flintbake is the live Flint render bridge (engine #3, Slice 1).
//
// It is the ONE place std-doc shells out to Node, and only when a document
// actually asks for a live Flint chart (a `spec` on a diagram block). It runs
// the vendored, MIT-licensed pipeline in stddoc-lib/flint/bake/render.mjs
// (flint-chart assembleVegaLite -> vega-lite -> vega toSVG) to turn a chart spec
// into a self-contained inline SVG with zero external refs.
//
// The honest dependency boundary: live Flint needs Node.js + the bake deps
// installed (npm install in the bake dir). The Slice-0 embed path — name a chart
// by dtype and std-doc embeds a pre-rendered catalog SVG — needs NO Node at all
// and remains the zero-dependency default. When Node or the script is absent,
// Renderer returns a clear error and the diagram primitive degrades loudly,
// never silently, and points the author back to the zero-dep path.
package flintbake

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// bakeTimeout bounds a single chart render so a pathological spec can never hang
// a publish/freeze.
const bakeTimeout = 30 * time.Second

// Renderer returns a bake function bound to a library root. The returned closure
// turns a Flint chart spec (raw JSON) into an inline SVG string, or returns a
// clear error the caller surfaces as a loud degrade. libRoot is the stddoc-lib
// directory; the script is <libRoot>/flint/bake/render.mjs.
func Renderer(libRoot string) func([]byte) (string, error) {
	script := filepath.Join(libRoot, "flint", "bake", "render.mjs")
	return func(spec []byte) (string, error) {
		if _, err := os.Stat(script); err != nil {
			return "", fmt.Errorf("live Flint bake unavailable: %s not found — name a chart by dtype for the zero-dep catalog path", script)
		}
		node, err := exec.LookPath("node")
		if err != nil {
			return "", fmt.Errorf("live Flint bake needs Node.js on PATH — name a chart by dtype for the zero-dep catalog path")
		}
		ctx, cancel := context.WithTimeout(context.Background(), bakeTimeout)
		defer cancel()
		cmd := exec.CommandContext(ctx, node, script, "-")
		cmd.Stdin = bytes.NewReader(spec)
		var out, errb bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &errb
		if err := cmd.Run(); err != nil {
			msg := strings.TrimSpace(errb.String())
			if ctx.Err() == context.DeadlineExceeded {
				return "", fmt.Errorf("flint bake timed out after %s", bakeTimeout)
			}
			return "", fmt.Errorf("flint bake failed: %v: %s", err, msg)
		}
		svg := strings.TrimSpace(out.String())
		if !strings.HasPrefix(svg, "<svg") {
			return "", fmt.Errorf("flint bake produced no SVG")
		}
		return svg, nil
	}
}

// Available reports whether the live bake could run from libRoot right now.
// Used by tests to skip when the optional toolchain is absent, and callable by
// tooling that wants to pre-flight.
//
// It requires all THREE legs, and the third one is the one that bit us: the
// vendored deps under bake/node_modules are untracked, so a FRESH CLONE has the
// script and has node, but has nothing to import. Checking only the first two
// made Available() answer "yes" on a machine where the bake could not possibly
// run — so the test didn't skip, it FAILED, and "the suite is green" quietly
// became a property of whoever had once run `npm install` rather than of the
// repository. Same class of lie twice over; this is where it stops.
//
// Note the scope: only the LIVE bake (a chart spec → SVG) needs Node at all.
// The Slice-0 embed path — name a chart, get its pre-baked catalog SVG — needs
// none of this and is always available.
func Available(libRoot string) bool {
	return Unavailable(libRoot) == ""
}

// Unavailable returns a human-readable reason the live bake cannot run, or ""
// when it can. Tests skip WITH this reason, so a skipped run says exactly what
// is missing and how to fix it instead of looking like a pass.
func Unavailable(libRoot string) string {
	bakeDir := filepath.Join(libRoot, "flint", "bake")

	if _, err := os.Stat(filepath.Join(bakeDir, "render.mjs")); err != nil {
		return fmt.Sprintf("live Flint bake script not found at %s", filepath.Join(bakeDir, "render.mjs"))
	}
	if _, err := exec.LookPath("node"); err != nil {
		return "node is not on PATH (the live Flint bake shells out to Node; the embed path does not)"
	}
	// The deps are untracked, so their absence is the normal state of a fresh
	// clone — not a broken checkout.
	if _, err := os.Stat(filepath.Join(bakeDir, "node_modules", "vega-lite")); err != nil {
		return fmt.Sprintf("live Flint bake deps not installed — run: (cd %s && npm install)", bakeDir)
	}
	return ""
}
