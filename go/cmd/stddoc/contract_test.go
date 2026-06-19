package main

// contract_test.go — the CLI half of the self-testing harness. Pins the exact
// subcommand surface and the port floor by RUNNING the real dispatch, so a
// dropped verb, a re-introduced phantom verb, or a moved port floor fails
// `go test` automatically.

import (
	"strings"
	"testing"

	"stddoc/internal/serve"
)

// CAPABILITY: the documented subcommand surface is exactly the real one.
//   - every documented verb dispatches (does NOT report "unknown command")
//   - every retired/phantom verb is gone (DOES report "unknown command")
func TestContract_SubcommandSurface(t *testing.T) {
	documented := []string{"version", "publish", "lint", "freeze", "serve", "roll", "graduate"}
	for _, v := range documented {
		err := run([]string{v})
		if err != nil && strings.Contains(err.Error(), "unknown command") {
			t.Errorf("documented verb %q must dispatch, got unknown-command error", v)
		}
	}
	// the 6 retired lifecycle verbs (Python→Go port dropped them on purpose) —
	// they must STAY gone; a re-added phantom verb is a regression to flag.
	phantom := []string{"shelve", "wake", "lock", "seal", "register", "validate"}
	for _, v := range phantom {
		err := run([]string{v})
		if err == nil || !strings.Contains(err.Error(), "unknown command") {
			t.Errorf("retired verb %q must report 'unknown command', got: %v", v, err)
		}
	}
}

// CAPABILITY: the SIP port floor is 33333 (the original beta bug was a doc
// claiming 5050). This pins the constant the docs are written against.
func TestContract_PortFloor(t *testing.T) {
	if serve.MinPort != 33333 {
		t.Errorf("serve.MinPort must be 33333 (SIP floor), got %d", serve.MinPort)
	}
}
