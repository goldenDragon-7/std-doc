package main

import (
	"fmt"
	"os"

	"stddoc/internal/serve"
)

// cmdStatus prints which reader comments are still open vs answered vs declined,
// by joining feedback/inbox.jsonl against feedback/history.json's in_response_to.
// The resolution data was always complete; it just never reached a surface, so a
// fresh session re-opened comments settled hours ago. This is that surface.
//
//	stddoc status <dir>
func cmdStatus(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: stddoc status <dir>")
	}
	return serve.Status(args[0], os.Stdout)
}
