// Package lifecycle is the doc-archive layer: the Go port of engine/scripts/
// roll.py + graduate.py. It owns Covenant V — "the palace is the archive":
//
//   - Roll snapshots the canonical source.json as the next monotonic version
//     (<slug>-v<N>-<UTCstamp>.json) and commits THAT JSON to the doc's git home.
//     The artifact that goes to git is the JSON, never the derived HTML.
//   - Graduate sheds a comment round: the live feedback/inbox.jsonl + history.json
//     are quarantined under feedback/archive/<version>/ and the live files reset,
//     so the doc keeps serving and keeps listening for the next round.
//
// ZERO Python: the only subprocess is `git`, exactly as the reference does
// (roll.py shells to git via subprocess). Side-effecting inputs — the timestamp
// and the git runner — are injectable so tests are deterministic and never touch
// a real repo.
package lifecycle

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"stddoc/internal/wire"
)

// stampFmt mirrors Python's "%Y%m%dT%H%MZ" — self-describing, sortable, UTC.
const stampFmt = "20060102T1504Z"

// verRe matches "<slug>-v<N>-<stamp>.json"; N is the monotonic version.
var verRe = regexp.MustCompile(`-v(\d+)-[0-9A-Za-z]+\.json$`)

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// NowFn yields the encoded UTC stamp; injectable for deterministic tests.
type NowFn func() string

// Runner runs a command and returns combined error context; injectable so a
// test rolls without touching a real git repo. Matches subprocess.run(check=True).
type Runner func(name string, args ...string) error

// UTCStamp is the default NowFn: the current time encoded as the Python stamp.
func UTCStamp() string { return time.Now().UTC().Format(stampFmt) }

// execRunner is the default Runner: shells out to the real command (git).
func execRunner(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Slugify mirrors roll.py: lowercase, non-alphanumeric runs -> "-", trimmed; "doc" if empty.
func Slugify(text string) string {
	s := slugRe.ReplaceAllString(strings.ToLower(text), "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "doc"
	}
	return s
}

// nextVersion is max existing version for slug + 1 (1 when none) — stateless,
// drift-proof, derived from the files already on disk.
func nextVersion(versionsDir, slug string) int {
	hi := 0
	matches, _ := filepath.Glob(filepath.Join(versionsDir, slug+"-v*.json"))
	for _, p := range matches {
		if m := verRe.FindStringSubmatch(filepath.Base(p)); m != nil {
			if n, err := strconv.Atoi(m[1]); err == nil && n > hi {
				hi = n
			}
		}
	}
	return hi + 1
}

// gitHome resolves the repo top-level containing start, or "" if none.
func gitHome(start string) string {
	out, err := exec.Command("git", "-C", start, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// RollOptions are the optional knobs of Roll (all may be zero-valued).
type RollOptions struct {
	VersionsDir  string // default: <source-dir>/versions
	Slug         string // default: slugify(doc.title or source-dir name)
	GitHome      string // default: discover from the source via git rev-parse
	NoCommit     bool   // write the snapshot but do not git-commit
	GraduateDir  string // a published/ dir to ALSO graduate on this roll
	Now          NowFn  // default: UTCStamp
	Runner       Runner // default: shell out to git
}

// RollRecord is what a Roll did — mirrors roll.py's return dict.
type RollRecord struct {
	Version     int
	Stamp       string
	Slug        string
	Filename    string
	Path        string
	Committed   bool
	CommitError string
	Graduated   *ShedRecord // set when GraduateDir was given
}

// Roll snapshots source.json as the next version and commits that JSON to the
// doc's git home. Returns the roll record; commit failures are surfaced on the
// record (CommitError), never panicked — the JSON is always written first.
func Roll(sourcePath string, opts RollOptions) (*RollRecord, error) {
	now := opts.Now
	if now == nil {
		now = UTCStamp
	}
	runner := opts.Runner
	if runner == nil {
		runner = execRunner
	}

	src, err := filepath.Abs(sourcePath)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return nil, err
	}
	doc, err := wire.ParseOrderedJSON(data) // validate it parses
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", src, err)
	}

	slug := opts.Slug
	if slug == "" {
		title, _ := doc.Get("title")
		base := ""
		if s, ok := title.(string); ok {
			base = s
		}
		if base == "" {
			base = filepath.Base(filepath.Dir(src))
		}
		slug = Slugify(base)
	}

	versionsDir := opts.VersionsDir
	if versionsDir == "" {
		versionsDir = filepath.Join(filepath.Dir(src), "versions")
	}
	if err := os.MkdirAll(versionsDir, 0o755); err != nil {
		return nil, err
	}

	version := nextVersion(versionsDir, slug)
	stamp := now()
	filename := fmt.Sprintf("%s-v%d-%s.json", slug, version, stamp)
	out := filepath.Join(versionsDir, filename)

	// Compact canonical JSON — the artifact. Key order preserved; UTF-8 kept.
	blob, err := wire.MarshalCompact(doc)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(out, blob, 0o644); err != nil {
		return nil, err
	}

	rec := &RollRecord{Version: version, Stamp: stamp, Slug: slug,
		Filename: filename, Path: out}

	if !opts.NoCommit {
		home := opts.GitHome
		if home == "" {
			home = gitHome(versionsDir)
		}
		if home == "" {
			rec.CommitError = "no git home found; JSON written but not committed"
		} else {
			msg := fmt.Sprintf("roll(%s): v%d @ %s", slug, version, stamp)
			if err := runner("git", "-C", home, "add", out); err != nil {
				rec.CommitError = err.Error()
			} else if err := runner("git", "-C", home, "commit", "-m", msg, "--", out); err != nil {
				rec.CommitError = err.Error()
			} else {
				rec.Committed = true
			}
		}
	}

	if opts.GraduateDir != "" {
		shed, gerr := Graduate(opts.GraduateDir, fmt.Sprintf("v%d-%s", version, stamp), now)
		if gerr != nil {
			return rec, gerr
		}
		rec.Graduated = shed
	}
	return rec, nil
}

const emptyHistory = "[]" // the page polls a JSON array of reply batches

// ShedRecord is what a Graduate shed — mirrors graduate.py's return dict.
type ShedRecord struct {
	Version  string
	At       string
	Comments int
	Archive  string
	Files    []string
}

func countLines(p string) int {
	data, err := os.ReadFile(p)
	if err != nil {
		return 0
	}
	n := 0
	for _, ln := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(ln) != "" {
			n++
		}
	}
	return n
}

// Graduate quarantines this round's comments under feedback/archive/<version>/
// and resets the live inbox/history, keeping the doc live + listening. Nothing
// is ever deleted. ``version`` is the archive key (e.g. "v3" or "v3-<stamp>").
func Graduate(publishedDir, version string, now NowFn) (*ShedRecord, error) {
	if now == nil {
		now = UTCStamp
	}
	pub, err := filepath.Abs(publishedDir)
	if err != nil {
		return nil, err
	}
	fb := filepath.Join(pub, "feedback")
	if info, err := os.Stat(fb); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("no feedback/ dir under %s (is it published?)", pub)
	}

	arch := filepath.Join(fb, "archive", version)
	if _, err := os.Stat(arch); err == nil {
		return nil, fmt.Errorf("already graduated: %s exists", arch)
	}
	if err := os.MkdirAll(arch, 0o755); err != nil {
		return nil, err
	}

	inbox := filepath.Join(fb, "inbox.jsonl")
	shed := &ShedRecord{Version: version, At: now(),
		Comments: countLines(inbox), Archive: arch, Files: []string{}}

	// QUARANTINE first (copy, preserving bytes), THEN reset the live file — so the
	// round's record always survives even if a reset is interrupted. Never delete.
	resets := []struct {
		name  string
		reset string
	}{
		{"inbox.jsonl", ""},
		{"history.json", emptyHistory},
	}
	for _, r := range resets {
		live := filepath.Join(fb, r.name)
		if info, err := os.Stat(live); err == nil && !info.IsDir() {
			data, rerr := os.ReadFile(live)
			if rerr != nil {
				return nil, rerr
			}
			if werr := os.WriteFile(filepath.Join(arch, r.name), data, 0o644); werr != nil {
				return nil, werr
			}
			shed.Files = append(shed.Files, r.name)
		}
		// Reset the live file so the next round starts clean; the doc keeps listening.
		if werr := os.WriteFile(live, []byte(r.reset), 0o644); werr != nil {
			return nil, werr
		}
	}

	// A tiny manifest in the archive so the round is self-describing. indent=2,
	// keys in graduate.py's order (version, at, comments, files).
	manifest := wire.NewOrderedMap()
	manifest.Set("version", shed.Version)
	manifest.Set("at", shed.At)
	manifest.Set("comments", json.Number(strconv.Itoa(shed.Comments)))
	files := make([]any, len(shed.Files))
	for i, f := range shed.Files {
		files[i] = f
	}
	manifest.Set("files", files)
	mblob, err := marshalIndent2(manifest)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(arch, "graduated.json"), mblob, 0o644); err != nil {
		return nil, err
	}
	return shed, nil
}

// marshalIndent2 renders an OrderedMap with Python json.dumps(indent=2) shape:
// 2-space indent, ", " item sep collapses to ",\n", ": " key sep. Small and
// self-describing — only used for the graduate manifest.
func marshalIndent2(m *wire.OrderedMap) ([]byte, error) {
	var b strings.Builder
	if err := indentValue(&b, m, 0); err != nil {
		return nil, err
	}
	return []byte(b.String()), nil
}

func indentValue(b *strings.Builder, v any, depth int) error {
	pad := strings.Repeat("  ", depth+1)
	closePad := strings.Repeat("  ", depth)
	switch x := v.(type) {
	case *wire.OrderedMap:
		if x.Len() == 0 {
			b.WriteString("{}")
			return nil
		}
		b.WriteString("{\n")
		for i, k := range x.Keys() {
			if i > 0 {
				b.WriteString(",\n")
			}
			b.WriteString(pad)
			kb, _ := wire.MarshalCompact(k)
			b.Write(kb)
			b.WriteString(": ")
			val, _ := x.Get(k)
			if err := indentValue(b, val, depth+1); err != nil {
				return err
			}
		}
		b.WriteString("\n")
		b.WriteString(closePad)
		b.WriteString("}")
	case []any:
		if len(x) == 0 {
			b.WriteString("[]")
			return nil
		}
		b.WriteString("[\n")
		for i, e := range x {
			if i > 0 {
				b.WriteString(",\n")
			}
			b.WriteString(pad)
			if err := indentValue(b, e, depth+1); err != nil {
				return err
			}
		}
		b.WriteString("\n")
		b.WriteString(closePad)
		b.WriteString("]")
	default:
		cb, err := wire.MarshalCompact(v)
		if err != nil {
			return err
		}
		b.Write(cb)
	}
	return nil
}
