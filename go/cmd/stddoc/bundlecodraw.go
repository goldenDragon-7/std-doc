package main

import (
	"fmt"
	"os"
	"path/filepath"

	esbuild "github.com/evanw/esbuild/pkg/api"
)

// cmdBundleCodraw rebundles codraw-glue.js (the ONE hand-authored source that
// reaches Excalidraw's ESM entry point) into vendor/codraw-bundle.js — a
// single, self-contained, minified ESM file. Zero Node/npm at RUNTIME: this
// is a dev-time rebuild step, run only when the vendored Excalidraw version
// changes, exactly like the esbuild-in-Go proposal (Path A) describes.
//
// Requires a prepared node_modules next to codraw-glue.js (the dependency
// graph — react, react-dom, @excalidraw/excalidraw, and @excalidraw's own
// deps like roughjs/jotai/@radix-ui — is real and not pre-bundled by the
// npm package itself, so esbuild needs it on disk to resolve bare imports).
// That node_modules is NEVER committed; see BUNDLE.md for the one-time setup.
//
//	stddoc bundle-codraw [--dir <codraw-dir>]
func cmdBundleCodraw(args []string) error {
	dir := "go/stddoc-lib/lib/codraw"
	for i := 0; i < len(args); i++ {
		if args[i] == "--dir" && i+1 < len(args) {
			dir = args[i+1]
			i++
		}
	}
	entry := filepath.Join(dir, "codraw-glue.js")
	if _, err := os.Stat(entry); err != nil {
		return fmt.Errorf("bundle-codraw: entry not found: %s: %w", entry, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "node_modules")); err != nil {
		return fmt.Errorf("bundle-codraw: %s/node_modules missing — run the one-time `npm install` described in %s/BUNDLE.md first", dir, dir)
	}
	out := filepath.Join(dir, "vendor", "codraw-bundle.js")
	entry = mustAbs(entry)
	out = mustAbs(out)

	// Excalidraw's i18n lazily `import()`s a locale file per language code.
	// esbuild can't tree-shake a dynamic import with a variable path, so a
	// naive single-file bundle inlines EVERY vendored language (~1.3MB for
	// languages codraw never uses — English only, per protocol/canvas.md).
	// Mark the whole locales/ family external instead: the import stays a
	// real (lazy, never-fired-by-default) runtime import(), resolvable
	// against the vendored excalidraw-0.18.1/locales/ tree if it ever does.
	localesExternal := esbuild.Plugin{
		Name: "codraw-locales-external",
		Setup: func(build esbuild.PluginBuild) {
			build.OnResolve(esbuild.OnResolveOptions{Filter: `/locales/`},
				func(a esbuild.OnResolveArgs) (esbuild.OnResolveResult, error) {
					return esbuild.OnResolveResult{Path: a.Path, External: true}, nil
				})
		},
	}

	result := esbuild.Build(esbuild.BuildOptions{
		EntryPoints:       []string{entry},
		Bundle:            true,
		Format:            esbuild.FormatESModule,
		Outfile:           out,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
		Target:            esbuild.ES2020,
		Define:            map[string]string{"process.env.NODE_ENV": `"production"`},
		Plugins:           []esbuild.Plugin{localesExternal},
		Write:             true,
	})
	if len(result.Errors) > 0 {
		msgs := esbuild.FormatMessages(result.Errors, esbuild.FormatMessagesOptions{Color: false})
		return fmt.Errorf("bundle-codraw: esbuild failed:\n%s", joinLines(msgs))
	}
	for _, w := range esbuild.FormatMessages(result.Warnings, esbuild.FormatMessagesOptions{Color: false}) {
		fmt.Fprintln(os.Stderr, "bundle-codraw: warning:", w)
	}
	fi, err := os.Stat(out)
	if err != nil {
		return fmt.Errorf("bundle-codraw: output missing after build: %w", err)
	}
	fmt.Printf("bundle-codraw: wrote %s (%.1f MB)\n", out, float64(fi.Size())/(1<<20))
	return nil
}

func mustAbs(p string) string {
	a, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return a
}

func joinLines(lines []string) string {
	out := ""
	for _, l := range lines {
		out += l + "\n"
	}
	return out
}
