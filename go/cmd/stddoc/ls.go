package main

import (
	"os"

	"stddoc/internal/serve"
)

// cmdLs lists every live std-doc server on this machine, one row each — the
// answer to "which of these are mine?" that used to require ps + grep on
// process arguments (and risked lsof-killing another session's live doc).
//
//	stddoc ls
func cmdLs(args []string) error {
	return serve.List(os.Stdout)
}
