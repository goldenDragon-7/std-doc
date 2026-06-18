package main

import (
	"fmt"

	"stddoc/internal/lifecycle"
)

// cmdRoll snapshots a doc's canonical source.json as the next monotonic version
// and commits THAT JSON to the doc's git home (Covenant V). Mirrors roll.py.
//
//	stddoc roll <source.json> [--slug S] [--versions-dir D] [--git-home G]
//	            [--no-commit] [--graduate-dir D]
func cmdRoll(args []string) error {
	var opts lifecycle.RollOptions
	rest := []string{}
	for i := 0; i < len(args); i++ {
		needsVal := func() (string, error) {
			if i+1 >= len(args) {
				return "", fmt.Errorf("%s needs a value", args[i])
			}
			i++
			return args[i], nil
		}
		var err error
		switch args[i] {
		case "--slug":
			opts.Slug, err = needsVal()
		case "--versions-dir":
			opts.VersionsDir, err = needsVal()
		case "--git-home":
			opts.GitHome, err = needsVal()
		case "--graduate-dir":
			opts.GraduateDir, err = needsVal()
		case "--no-commit":
			opts.NoCommit = true
		default:
			rest = append(rest, args[i])
		}
		if err != nil {
			return err
		}
	}
	if len(rest) < 1 {
		return fmt.Errorf("usage: stddoc roll <source.json> [--slug S] [--versions-dir D] [--git-home G] [--no-commit] [--graduate-dir D]")
	}

	rec, err := lifecycle.Roll(rest[0], opts)
	if err != nil {
		return err
	}

	where := "written"
	switch {
	case rec.Committed:
		where = "committed"
	case rec.CommitError != "":
		where = "written (commit skipped: " + rec.CommitError + ")"
	}
	fmt.Printf("roll: %s  → v%d @ %s  [%s]\n", rec.Filename, rec.Version, rec.Stamp, where)
	if rec.Graduated != nil {
		g := rec.Graduated
		fmt.Printf("  graduated: shed %d comment(s) → %s (doc stays live)\n", g.Comments, g.Archive)
	}
	return nil
}
