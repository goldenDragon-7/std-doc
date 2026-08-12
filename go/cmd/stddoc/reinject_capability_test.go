package main

// reinject_capability_test.go — the self-test for finding 2026-08-12 NEW 1:
// serve injects the feedback widget; a plain publish regenerates every page and
// used to SILENTLY strip commenting from a doc that had it, killing the loop.
// publish now re-wires ONLY when the dir is being served (feedback/ present), so
// a rebake preserves the conversation while a never-served dir stays clean.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const feedbackJSTag = `<script src="/lib/feedback.js" defer></script>`

// pageHasWidget reports whether any published *.html carries the feedback tag.
func anyPageHasWidget(t *testing.T, dir string) bool {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".html") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), feedbackJSTag) {
			return true
		}
	}
	return false
}

// CAPABILITY: publish into a FRESH (never-served) dir stays clean — no widget,
// so the conformance golden-master holds; publish into a SERVED dir (feedback/
// present) re-injects the widget so a rebake never silently kills commenting.
func TestCapability_PublishReinjectsOnlyWhenServed(t *testing.T) {
	root := repoRootCmd(t)
	t.Setenv("STDDOC_LIB", filepath.Join(root, "go", "stddoc-lib"))
	src := filepath.Join(root, "examples", "data-derived-example", "source.json")
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("fixture source.json not found: %v", err)
	}

	// 1) fresh dir: publish must NOT inject the widget (byte-identical clean).
	fresh := t.TempDir()
	if err := cmdPublish([]string{src, fresh}); err != nil {
		t.Fatalf("publish (fresh) failed: %v", err)
	}
	if anyPageHasWidget(t, fresh) {
		t.Error("publish into a never-served dir must NOT inject the widget (conformance golden-master must hold)")
	}

	// 2) served dir: the feedback/ marker means serve wired this dir. A rebake
	//    must re-inject so commenting survives (the NEW 1 harm).
	served := t.TempDir()
	if err := cmdPublish([]string{src, served}); err != nil {
		t.Fatalf("publish (served, first pass) failed: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(served, "feedback"), 0o755); err != nil {
		t.Fatal(err)
	}
	if anyPageHasWidget(t, served) {
		t.Fatal("precondition: pages should be clean before the re-publish")
	}
	if err := cmdPublish([]string{src, served}); err != nil {
		t.Fatalf("publish (served, rebake) failed: %v", err)
	}
	if !anyPageHasWidget(t, served) {
		t.Error("publish into a served dir (feedback/ present) must re-inject the widget — a rebake must not silently kill commenting")
	}
}
