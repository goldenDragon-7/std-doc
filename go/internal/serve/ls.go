package serve

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// liveDoc is one running std-doc server as seen from outside.
type liveDoc struct {
	Port      int
	Pages     int
	Note      string
	Dir       string
	LastTouch int64 // unix seconds from watcher.json; 0 = unknown
}

// probeInfo asks one port's /info endpoint who it is. Returns nil if nothing
// std-doc-shaped answers there within the timeout.
func probeInfo(port int) *liveDoc {
	client := http.Client{Timeout: 300 * time.Millisecond}
	resp, err := client.Get(fmt.Sprintf("http://localhost:%d/info", port))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var info struct {
		ArtifactDir string `json:"artifact_dir"`
		FeedbackDir string `json:"feedback_dir"`
		Port        int    `json:"port"`
		Pages       int    `json:"pages"`
		Note        string `json:"note"`
	}
	if json.NewDecoder(resp.Body).Decode(&info) != nil {
		return nil
	}
	// artifact_dir is the field that proves this is a std-doc server and not some
	// other service that happens to answer /info in the band.
	if info.ArtifactDir == "" {
		return nil
	}
	d := &liveDoc{Port: info.Port, Pages: info.Pages, Note: info.Note, Dir: info.ArtifactDir}
	if info.Port == 0 {
		d.Port = port
	}
	// Last touch: the server rewrites feedback/watcher.json every 5s with a ts.
	if b, err := os.ReadFile(filepath.Join(info.FeedbackDir, "watcher.json")); err == nil {
		var w struct {
			TS int64 `json:"ts"`
		}
		if json.Unmarshal(b, &w) == nil {
			d.LastTouch = w.TS
		}
	}
	return d
}

// ago renders a unix-seconds timestamp as a short human interval relative to now.
func ago(ts, now int64) string {
	if ts == 0 {
		return "?"
	}
	d := now - ts
	switch {
	case d < 5:
		return "just now"
	case d < 90:
		return fmt.Sprintf("%ds ago", d)
	case d < 90*60:
		return fmt.Sprintf("%dm ago", d/60)
	case d < 48*3600:
		return fmt.Sprintf("%dh ago", d/3600)
	default:
		return fmt.Sprintf("%dd ago", d/86400)
	}
}

// List sweeps the std-doc serving band and writes one row per live server. It is
// the "whose server is this?" answer that used to require ps + grep: with more
// than one doc alive — especially two sessions on one machine — there was no way
// to ask the tool what it was serving. The sweep covers the stable-default band
// (MinPort..MinPort+PortSpread-1); a doc served on an explicit --port outside
// that band will not appear, which is noted in the empty-state message.
func List(w io.Writer) error {
	results := make([]*liveDoc, PortSpread)
	var wg sync.WaitGroup
	sem := make(chan struct{}, 32) // bound concurrency; 200 ports otherwise open 200 sockets at once
	for i := 0; i < PortSpread; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i] = probeInfo(MinPort + i)
		}(i)
	}
	wg.Wait()

	live := []*liveDoc{}
	for _, d := range results {
		if d != nil {
			live = append(live, d)
		}
	}
	sort.Slice(live, func(a, b int) bool { return live[a].Port < live[b].Port })

	if len(live) == 0 {
		fmt.Fprintf(w, "No live std-doc servers in the default band (%d-%d).\n", MinPort, MinPort+PortSpread-1)
		fmt.Fprintln(w, "(A doc served on an explicit --port outside that band won't show here.)")
		return nil
	}

	now := time.Now().Unix()
	fmt.Fprintf(w, "%-6s %5s  %-22s %-11s %s\n", "PORT", "PAGES", "NOTE", "LAST TOUCH", "DIR")
	for _, d := range live {
		note := d.Note
		if note == "" {
			note = "—"
		}
		if len(note) > 22 {
			note = note[:21] + "…"
		}
		fmt.Fprintf(w, "%-6d %5d  %-22s %-11s %s\n", d.Port, d.Pages, note, ago(d.LastTouch, now), d.Dir)
	}
	return nil
}
