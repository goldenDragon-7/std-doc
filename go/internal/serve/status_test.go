package serve

import (
	"os"
	"path/filepath"
	"testing"
)

func TestComputeStatusThreeStates(t *testing.T) {
	dir := t.TempDir()
	fb := filepath.Join(dir, "feedback")
	if err := os.MkdirAll(fb, 0o755); err != nil {
		t.Fatal(err)
	}
	inbox := `{"comments":[{"id":"c-open","comment":"still open","quote":"x"}],"page_url":"/a.html"}
{"comments":[{"id":"c-ans","comment":"answered one","quote":"y"}],"page_url":"/a.html"}
{"comments":[{"id":"c-dec","comment":"declined one","quote":"z"}],"page_url":"/a.html"}
`
	if err := os.WriteFile(filepath.Join(fb, "inbox.jsonl"), []byte(inbox), 0o644); err != nil {
		t.Fatal(err)
	}
	history := `[
	  {"batch_id":"b1","changes":[
	    {"in_response_to":["c-ans"]},
	    {"in_response_to":["c-dec"],"disposition":"declined"}
	  ]}
	]`
	if err := os.WriteFile(filepath.Join(fb, "history.json"), []byte(history), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := computeStatus(fb)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"c-open": statePending, "c-ans": stateAnswered, "c-dec": stateDeclined}
	if len(got) != len(want) {
		t.Fatalf("got %d comments, want %d", len(got), len(want))
	}
	for _, c := range got {
		if want[c.ID] != c.State {
			t.Errorf("%s: state=%q want %q", c.ID, c.State, want[c.ID])
		}
	}
}

func TestComputeStatusNoFeedback(t *testing.T) {
	// A doc with no inbox yet must be empty, not an error.
	got, err := computeStatus(filepath.Join(t.TempDir(), "feedback"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected 0 comments, got %d", len(got))
	}
}
