package main

import (
	"fmt"
	"os"
	"path/filepath"

	"stddoc/internal/core"
	"stddoc/internal/library"
	"stddoc/internal/wire"
)

// cmdPublish renders a source.json doc-tree into an output directory, byte for
// byte as the Python reference does.
//
//	stddoc publish <source.json> <out-dir> [--style <name>] [--plugins <dir>]
func cmdPublish(args []string) error {
	var src, out, style, plugins string
	noLint := false
	rest := []string{}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--style":
			if i+1 >= len(args) {
				return fmt.Errorf("--style needs a value")
			}
			style = args[i+1]
			i++
		case "--plugins":
			if i+1 >= len(args) {
				return fmt.Errorf("--plugins needs a value")
			}
			plugins = args[i+1]
			i++
		case "--no-lint":
			noLint = true
		default:
			rest = append(rest, args[i])
		}
	}
	if len(rest) < 2 {
		return fmt.Errorf("usage: stddoc publish <source.json> <out-dir> [--style <name>] [--plugins <dir>] [--no-lint]")
	}
	src, out = rest[0], rest[1]

	// Style precedence: --style flag > STDDOC_STYLE env > built-in default
	// (techno-dark, applied by core.Publish when style is empty). Lets a user
	// set a persistent default style without passing --style every time.
	if style == "" {
		style = os.Getenv("STDDOC_STYLE")
	}

	root, err := resolveLibRoot(plugins)
	if err != nil {
		return err
	}
	lib, err := library.Load(root)
	if err != nil {
		return err
	}

	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	doc, err := wire.ParseOrderedJSON(data)
	if err != nil {
		return fmt.Errorf("parse %s: %w", src, err)
	}

	// Lint-or-die (default-on): a malformed source.json aborts publish loudly
	// rather than rendering a broken page silently — mirrors Python publish.py's
	// lint_or_die. --no-lint opts out for deliberate WIP iteration.
	if !noLint {
		findings, lerr := core.Lint(doc, lib)
		if lerr != nil {
			return lerr
		}
		if nErr := core.CountErrors(findings); nErr > 0 {
			reportFindings(findings)
			return fmt.Errorf("publish aborted: %s has %d lint error(s) (use --no-lint to override)", src, nErr)
		}
	}

	var pages map[string]string
	docTree := false
	if v, _ := doc.Get("layout"); v == "page" {
		page, name, perr := core.RenderStandalone(doc, lib)
		if perr != nil {
			return perr
		}
		pages = map[string]string{name: page}
	} else {
		pages, err = core.Publish(doc, style, lib)
		if err != nil {
			return err
		}
		docTree = true
	}

	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	for name, html := range pages {
		if err := os.WriteFile(filepath.Join(out, name), []byte(html), 0o644); err != nil {
			return err
		}
	}

	// Full-text search index (PRD P0-2): every doc-tree page emits
	// <script src='search-index.js'> and renders a #cf-search box, so publish
	// MUST emit the index or search 404s and returns zero hits. Shipped as .js
	// (sets window.CF_SEARCH_INDEX; loads over file://, freeze carries it) AND
	// as .json for external consumers. Standalone pages don't carry the index.
	if docTree {
		idx := core.SearchIndex(doc)
		j, err := core.MarshalSearchIndex(idx)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(out, "search-index.js"),
			append(append([]byte("window.CF_SEARCH_INDEX="), j...), ';'), 0o644); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(out, "search-index.json"), j, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// resolveLibRoot picks the default-library data directory by precedence — pure
// runtime, no silent fallback floor:
//  1. --plugins <dir> flag
//  2. STDDOC_LIB env var
//  3. stddoc-lib/ beside the executable
//
// The chosen path must be a readable directory, else a loud error.
func resolveLibRoot(pluginsFlag string) (string, error) {
	if pluginsFlag != "" {
		return mustDir(pluginsFlag, "--plugins")
	}
	if env := os.Getenv("STDDOC_LIB"); env != "" {
		return mustDir(env, "STDDOC_LIB")
	}
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("locating executable to resolve default library: %w", err)
	}
	beside := filepath.Join(filepath.Dir(exe), "stddoc-lib")
	return mustDir(beside, "default library beside the binary")
}

func mustDir(path, source string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("library dir (%s) not readable: %s: %w", source, path, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("library dir (%s) is not a directory: %s", source, path)
	}
	return path, nil
}
