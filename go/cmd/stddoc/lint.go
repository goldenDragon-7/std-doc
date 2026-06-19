package main

import (
	"fmt"
	"os"
	"sort"

	"stddoc/internal/core"
	"stddoc/internal/library"
	"stddoc/internal/registry"
	"stddoc/internal/wire"
)

// cmdLint validates a source.json doc-tree and prints findings grouped by level,
// exiting nonzero on any ERROR. The Go port of engine/scripts/lint.py.
//
//	stddoc lint <source.json> [--lint-only] [--quiet] [--plugins <dir>]
//
// --lint-only exits nonzero on ANY finding (errors OR warnings); the default
// exits nonzero only on errors.
func cmdLint(args []string) error {
	var src, plugins string
	lintOnly, quiet := false, false
	rest := []string{}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--plugins":
			if i+1 >= len(args) {
				return fmt.Errorf("--plugins needs a value")
			}
			plugins = args[i+1]
			i++
		case "--lint-only":
			lintOnly = true
		case "--quiet":
			quiet = true
		default:
			rest = append(rest, args[i])
		}
	}
	if len(rest) < 1 {
		return fmt.Errorf("usage: stddoc lint <source.json> [--lint-only] [--quiet] [--plugins <dir>]")
	}
	src = rest[0]

	root, err := resolveLibRoot(plugins)
	if err != nil {
		return err
	}
	lib, err := library.Load(root)
	if err != nil {
		return err
	}

	findings, err := lintSource(src, lib)
	if err != nil {
		return err
	}

	nErr := core.CountErrors(findings)
	nWarn := core.CountWarns(findings)
	if len(findings) > 0 {
		reportFindings(findings)
		fmt.Fprintf(os.Stderr, "std-doc lint %s: %d error(s), %d warning(s)\n", src, nErr, nWarn)
	} else if !quiet {
		fmt.Printf("std-doc lint %s: clean ✓\n", src)
	}

	// exit policy: --lint-only fails on ANY finding; otherwise only on errors.
	if lintOnly && len(findings) > 0 {
		os.Exit(1)
	}
	if nErr > 0 {
		os.Exit(1)
	}
	return nil
}

// lintSource reads + parses a source.json and lints it.
func lintSource(src string, lib *library.Library) ([]registry.Finding, error) {
	data, err := os.ReadFile(src)
	if err != nil {
		return nil, err
	}
	doc, err := wire.ParseOrderedJSON(data)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", src, err)
	}
	return core.Lint(doc, lib)
}

// reportFindings prints findings to stderr, errors first then warnings, each
// scoped to its slug — mirrors lint.py report().
func reportFindings(findings []registry.Finding) {
	ordered := make([]registry.Finding, len(findings))
	copy(ordered, findings)
	sort.SliceStable(ordered, func(i, j int) bool {
		// errors before warnings; otherwise preserve discovery order.
		return ordered[i].Level == "error" && ordered[j].Level != "error"
	})
	for _, f := range ordered {
		tag := "warn "
		if f.Level == "error" {
			tag = "ERROR"
		}
		fmt.Fprintf(os.Stderr, "  [%s] %s: %s\n", tag, f.Slug, f.Message)
	}
}
