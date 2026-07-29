package main

import (
	"fmt"
	"strconv"

	"stddoc/internal/serve"
)

// cmdServe injects the feedback library into a directory of HTML pages and runs
// the native Go server — one command that folds inject + serve + presence
// heartbeat together.
//
//	stddoc serve <dir> [--port N] [--strict-port] [--port-scan N]
//	             [--idle-timeout S] [--exit-with-parent] [--recursive]
//	             [--note TEXT] [--plugins DIR]
func cmdServe(args []string) error {
	opt := serve.Options{
		Port:     0, // 0 = auto: pick a stable per-doc default (see serve.DefaultPortFor); an explicit --port overrides
		PortScan: 50,
		// A living document's whole job is to wait for a human (§V: "a room you
		// can walk back into"). So the clock that ends a doc's life measures the
		// one thing that matters — how long since anyone TOUCHED it, where a
		// touch is a page load or an edit to the doc's files. The reader going
		// to lunch doesn't kill it; a day of nobody caring does.
		//
		// This replaces a parent-death watchdog that ran by default and made
		// every documented launch path self-destruct within ~5 seconds, because
		// the parent in each of them is a wrapper shell that exits immediately.
		// Pass --exit-with-parent to opt back into that behaviour deliberately;
		// pass --idle-timeout 0 to never exit at all.
		IdleTimeout: serve.DefaultIdleTimeout,
	}
	var dir, plugins string
	rest := []string{}
	for i := 0; i < len(args); i++ {
		a := args[i]
		next := func() (string, error) {
			if i+1 >= len(args) {
				return "", fmt.Errorf("%s needs a value", a)
			}
			i++
			return args[i], nil
		}
		switch a {
		case "--port":
			v, err := next()
			if err != nil {
				return err
			}
			if opt.Port, err = strconv.Atoi(v); err != nil {
				return fmt.Errorf("--port: %w", err)
			}
		case "--port-scan":
			v, err := next()
			if err != nil {
				return err
			}
			if opt.PortScan, err = strconv.Atoi(v); err != nil {
				return fmt.Errorf("--port-scan: %w", err)
			}
		case "--idle-timeout":
			v, err := next()
			if err != nil {
				return err
			}
			if opt.IdleTimeout, err = strconv.Atoi(v); err != nil {
				return fmt.Errorf("--idle-timeout: %w", err)
			}
		case "--note":
			v, err := next()
			if err != nil {
				return err
			}
			opt.Note = v
		case "--plugins":
			v, err := next()
			if err != nil {
				return err
			}
			plugins = v
		case "--strict-port":
			opt.StrictPort = true
		case "--exit-with-parent":
			opt.ExitWithParent = true
		case "--recursive", "-r":
			opt.Recursive = true
		default:
			rest = append(rest, a)
		}
	}
	if len(rest) < 1 {
		return fmt.Errorf("usage: stddoc serve <dir> [--port N] [--strict-port] [--port-scan N] [--idle-timeout S] [--exit-with-parent] [--recursive] [--note TEXT] [--plugins DIR]")
	}
	dir = rest[0]

	root, err := resolveLibRoot(plugins)
	if err != nil {
		return err
	}
	opt.LibRoot = root

	return serve.Run(dir, opt)
}
