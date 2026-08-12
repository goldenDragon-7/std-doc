package main

import (
	"fmt"

	"stddoc/internal/serve"
)

// cmdInject wires the feedback library into every *.html under a directory,
// idempotently, WITHOUT starting a server. It exists so a caller that is
// reusing an already-running server can still restore the widget tags after a
// doc was rewritten (a rewrite strips them). `serve` injects at startup; the
// reuse path never restarts, so without this the served page silently loses its
// widget while the banner still says LIVE.
//
//	stddoc inject <dir> [--recursive|-r]
func cmdInject(args []string) error {
	recursive := false
	rest := []string{}
	for _, a := range args {
		switch a {
		case "--recursive", "-r":
			recursive = true
		default:
			rest = append(rest, a)
		}
	}
	if len(rest) < 1 {
		return fmt.Errorf("usage: stddoc inject <dir> [--recursive|-r]")
	}
	return serve.Inject(rest[0], recursive)
}
