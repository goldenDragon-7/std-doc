package serve

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
)

// Comment disposition. A comment is:
//   - answered  — a history change names it in in_response_to[]
//   - declined  — a history change names it AND marks disposition:"declined"
//     (considered, deliberately not acted on — distinct from ignored)
//   - pending   — no history change references it yet
//
// The join is total: no heuristics, no NLP. inbox.jsonl is an append-only event
// log ("every comment ever received"); "what is still open?" is a queue question
// event logs can't answer alone. This computes the queue from the two files that
// already hold the truth, so a fresh session stops re-opening settled comments.
const (
	statePending  = "pending"
	stateAnswered = "answered"
	stateDeclined = "declined"
)

type inboxComment struct {
	ID      string `json:"id"`
	Comment string `json:"comment"`
	Quote   string `json:"quote"`
}

type inboxLine struct {
	Comments []inboxComment `json:"comments"`
	PageURL  string         `json:"page_url"`
}

type historyChange struct {
	InResponseTo []string `json:"in_response_to"`
	Disposition  string   `json:"disposition"` // "" (default answered) or "declined"
}

type historyBatch struct {
	Changes []historyChange `json:"changes"`
}

// CommentStatus is one comment's resolution, ready to print.
type CommentStatus struct {
	ID    string
	Text  string
	Quote string
	Page  string
	State string
}

// computeStatus performs the inbox×history join and returns every comment with
// its state, plus the disposition maps. Exposed shape kept small on purpose.
func computeStatus(feedbackDir string) ([]CommentStatus, error) {
	inbox, err := readInbox(filepath.Join(feedbackDir, "inbox.jsonl"))
	if err != nil {
		return nil, err
	}
	answered, declined, err := readDispositions(filepath.Join(feedbackDir, "history.json"))
	if err != nil {
		return nil, err
	}
	var out []CommentStatus
	seen := map[string]bool{}
	for _, line := range inbox {
		for _, c := range line.Comments {
			if c.ID == "" || seen[c.ID] {
				continue
			}
			seen[c.ID] = true
			st := statePending
			if declined[c.ID] {
				st = stateDeclined
			} else if answered[c.ID] {
				st = stateAnswered
			}
			out = append(out, CommentStatus{ID: c.ID, Text: c.Comment, Quote: c.Quote, Page: line.PageURL, State: st})
		}
	}
	return out, nil
}

func readInbox(path string) ([]inboxLine, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // no inbox yet = no comments
		}
		return nil, err
	}
	defer f.Close()
	var lines []inboxLine
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024) // comments can carry big outer_html
	for sc.Scan() {
		b := sc.Bytes()
		if len(b) == 0 {
			continue
		}
		var l inboxLine
		if json.Unmarshal(b, &l) == nil {
			lines = append(lines, l)
		}
	}
	return lines, sc.Err()
}

// readDispositions returns the set of comment ids answered and the set declined.
// declined is a subset semantically distinct from plain answered.
func readDispositions(path string) (answered, declined map[string]bool, err error) {
	answered, declined = map[string]bool{}, map[string]bool{}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return answered, declined, nil
		}
		return nil, nil, err
	}
	var batches []historyBatch
	if json.Unmarshal(b, &batches) != nil {
		// tolerate a single-object history too
		var one historyBatch
		if json.Unmarshal(b, &one) == nil {
			batches = []historyBatch{one}
		}
	}
	for _, bt := range batches {
		for _, ch := range bt.Changes {
			for _, id := range ch.InResponseTo {
				answered[id] = true
				if ch.Disposition == stateDeclined {
					declined[id] = true
				}
			}
		}
	}
	return answered, declined, nil
}

// Status prints the resolution report for a doc directory to w. dir is the doc
// root (its feedback/ subdir holds inbox.jsonl + history.json).
func Status(dir string, w io.Writer) error {
	feedbackDir := filepath.Join(dir, "feedback")
	all, err := computeStatus(feedbackDir)
	if err != nil {
		return err
	}
	if len(all) == 0 {
		fmt.Fprintf(w, "No comments in %s.\n", filepath.Join(feedbackDir, "inbox.jsonl"))
		return nil
	}

	var open, ans, dec []CommentStatus
	for _, c := range all {
		switch c.State {
		case statePending:
			open = append(open, c)
		case stateDeclined:
			dec = append(dec, c)
		default:
			ans = append(ans, c)
		}
	}
	sort.SliceStable(open, func(i, j int) bool { return open[i].ID < open[j].ID })

	fmt.Fprintf(w, "%d comment(s): %d open · %d answered · %d declined\n",
		len(all), len(open), len(ans), len(dec))
	if len(open) == 0 {
		fmt.Fprintln(w, "\n✓ Nothing open — every comment has been answered or declined.")
		return nil
	}
	fmt.Fprintln(w, "\nOPEN (unaddressed):")
	for _, c := range open {
		fmt.Fprintf(w, "  • %s  [%s]\n", c.ID, c.Page)
		if c.Quote != "" {
			fmt.Fprintf(w, "      on: %q\n", truncate(c.Quote, 70))
		}
		if c.Text != "" {
			fmt.Fprintf(w, "      said: %s\n", truncate(c.Text, 100))
		}
	}
	return nil
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}
