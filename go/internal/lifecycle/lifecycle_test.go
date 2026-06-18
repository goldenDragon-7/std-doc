package lifecycle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fixedStamp = "20260614T0558Z"

func fixedNow() string { return fixedStamp }

// recordingRunner captures git invocations instead of running them — so a roll
// can be exercised end-to-end without touching a real repo.
func recordingRunner(log *[]string) Runner {
	return func(name string, args ...string) error {
		*log = append(*log, name+" "+strings.Join(args, " "))
		return nil
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Hello World":      "hello-world",
		"  Trim--Me  ":     "trim-me",
		"already-good":     "already-good",
		"Sym!!bols??here":  "sym-bols-here",
		"":                 "doc",
		"////":             "doc",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRollWritesCompactSnapshotAndCommits(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.json")
	// Deliberately pretty-printed input with non-ASCII + key order that must survive.
	in := `{
  "title": "My Doc",
  "blocks": [ {"type": "para", "text": "café — über"} ],
  "n": 3
}`
	if err := os.WriteFile(src, []byte(in), 0o644); err != nil {
		t.Fatal(err)
	}

	var gitLog []string
	rec, err := Roll(src, RollOptions{
		Slug:    "demo",
		GitHome: dir,
		Now:     fixedNow,
		Runner:  recordingRunner(&gitLog),
	})
	if err != nil {
		t.Fatal(err)
	}

	if rec.Version != 1 || rec.Stamp != fixedStamp || rec.Slug != "demo" {
		t.Fatalf("unexpected record: %+v", rec)
	}
	wantName := "demo-v1-" + fixedStamp + ".json"
	if rec.Filename != wantName {
		t.Errorf("filename = %q, want %q", rec.Filename, wantName)
	}
	if !rec.Committed {
		t.Errorf("expected committed, got error %q", rec.CommitError)
	}

	got, err := os.ReadFile(rec.Path)
	if err != nil {
		t.Fatal(err)
	}
	// Compact, key order preserved, non-ASCII raw (ensure_ascii=False parity).
	want := `{"title":"My Doc","blocks":[{"type":"para","text":"café — über"}],"n":3}`
	if string(got) != want {
		t.Errorf("snapshot bytes:\n got %q\nwant %q", got, want)
	}

	// Commit message format is canonical.
	if len(gitLog) != 2 || !strings.Contains(gitLog[1], "roll(demo): v1 @ "+fixedStamp) {
		t.Errorf("git log = %v", gitLog)
	}
}

func TestRollMonotonicVersion(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.json")
	os.WriteFile(src, []byte(`{"title":"x"}`), 0o644)
	vdir := filepath.Join(dir, "versions")
	os.MkdirAll(vdir, 0o755)
	// Pre-seed v1 and v2 on disk; next must be 3 (stateless, drift-proof).
	os.WriteFile(filepath.Join(vdir, "demo-v1-20260101T0000Z.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(vdir, "demo-v2-20260101T0000Z.json"), []byte("{}"), 0o644)

	rec, err := Roll(src, RollOptions{Slug: "demo", VersionsDir: vdir, NoCommit: true, Now: fixedNow})
	if err != nil {
		t.Fatal(err)
	}
	if rec.Version != 3 {
		t.Errorf("next version = %d, want 3", rec.Version)
	}
}

func TestGraduateShedsAndResets(t *testing.T) {
	pub := t.TempDir()
	fb := filepath.Join(pub, "feedback")
	os.MkdirAll(fb, 0o755)
	os.WriteFile(filepath.Join(fb, "inbox.jsonl"), []byte("{\"a\":1}\n{\"b\":2}\n"), 0o644)
	os.WriteFile(filepath.Join(fb, "history.json"), []byte(`[{"reply":"hi"}]`), 0o644)

	rec, err := Graduate(pub, "v3", fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Comments != 2 {
		t.Errorf("comments = %d, want 2", rec.Comments)
	}

	// Live files reset; the doc keeps listening.
	if b, _ := os.ReadFile(filepath.Join(fb, "inbox.jsonl")); string(b) != "" {
		t.Errorf("inbox not reset: %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(fb, "history.json")); string(b) != "[]" {
		t.Errorf("history not reset: %q", b)
	}

	// Round quarantined, byte-preserved; manifest present.
	arch := filepath.Join(fb, "archive", "v3")
	if b, _ := os.ReadFile(filepath.Join(arch, "inbox.jsonl")); string(b) != "{\"a\":1}\n{\"b\":2}\n" {
		t.Errorf("archived inbox wrong: %q", b)
	}
	man, err := os.ReadFile(filepath.Join(arch, "graduated.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"version": "v3"`, `"comments": 2`, `"inbox.jsonl"`} {
		if !strings.Contains(string(man), want) {
			t.Errorf("manifest missing %q:\n%s", want, man)
		}
	}

	// Second graduate to the same key must refuse (never silently overwrite).
	if _, err := Graduate(pub, "v3", fixedNow); err == nil {
		t.Error("expected error on re-graduate to existing archive")
	}
}
