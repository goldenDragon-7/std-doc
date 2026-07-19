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

// Available reports whether the live bake could run from libRoot right now
// (script present AND node on PATH). Used by tests to skip when the optional
// toolchain is absent, and callable by tooling that wants to pre-flight.
func Available(libRoot string) bool {
	if _, err := os.Stat(filepath.Join(libRoot, "flint", "bake", "render.mjs")); err != nil {
		return false
	}
	_, err := exec.LookPath("node")
	return err == nil
}
