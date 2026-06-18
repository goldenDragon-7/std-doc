// Command stddoc is the Go port of the std-doc engine: one signed static binary
// that renders a source.json byte-identical to the Python reference, freezes
// self-contained, and shells out to nothing at runtime.
//
//	stddoc publish  <source.json> <out-dir> [--style <name>]
//	stddoc freeze   <dir>
//	stddoc serve    <dir>
//	stddoc roll     <source.json> --slug <slug>
//	stddoc graduate <dir>
//
// Acceptance gate: conformance/run_go.sh — empty diff vs the language-neutral
// goldens in conformance/cases/<case>/expected/ for all 7 cases.
package main

import (
	"fmt"
	"os"
)

// version is stamped at build time via -ldflags "-X main.version=…".
// Unstamped dev builds report "dev".
var version = "dev"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "stddoc:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: stddoc <publish|freeze|serve|roll|graduate> ...")
	}
	cmd, rest := args[0], args[1:]
	switch cmd {
	case "version", "--version", "-v":
		fmt.Println("stddoc", version)
		return nil
	case "publish":
		return cmdPublish(rest)
	case "freeze":
		return cmdFreeze(rest)
	case "serve":
		return cmdServe(rest)
	case "roll":
		return cmdRoll(rest)
	case "graduate":
		return cmdGraduate(rest)
	default:
		return fmt.Errorf("unknown command %q", cmd)
	}
}
