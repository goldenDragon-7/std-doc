package main

import (
	"fmt"

	"stddoc/internal/lifecycle"
)

// cmdGraduate sheds a comment round: the live feedback inbox/history are
// quarantined under feedback/archive/<version>/ and reset, keeping the doc live
// and listening (Covenant V).
//
//	stddoc graduate <dir> [--version v3]
//
// --version is the archive key. the legacy tool required it; here it is OPTIONAL —
// when omitted the round is keyed by the current UTC stamp, so `graduate <dir>`
// works standalone while `--version v3` still matches the reference exactly.
func cmdGraduate(args []string) error {
	var dir, version string
	rest := []string{}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--version":
			if i+1 >= len(args) {
				return fmt.Errorf("--version needs a value")
			}
			version = args[i+1]
			i++
		default:
			rest = append(rest, args[i])
		}
	}
	if len(rest) < 1 {
		return fmt.Errorf("usage: stddoc graduate <dir> [--version v3]")
	}
	dir = rest[0]
	if version == "" {
		version = lifecycle.UTCStamp()
	}

	rec, err := lifecycle.Graduate(dir, version, nil)
	if err != nil {
		return err
	}
	fmt.Printf("graduate: shed %d comment(s) → %s  (doc stays live + listening)\n", rec.Comments, rec.Archive)
	return nil
}
