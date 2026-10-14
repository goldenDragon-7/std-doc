package serve

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// canvas_font_gate_test.go — THE PIXEL GATE.
//
// WHAT IT CATCHES: container-bound canvas text silently rendering in serif
// fallback while free-standing text in the SAME font renders correctly.
// MEASURED on Excalidraw 0.17.6 (2026-10-13); fixed by the 0.18.1 upgrade.
//
// WHY A PIXEL GATE AND NOT A FONT CHECK. Every document-level font probe is
// GREEN on both the broken and the fixed build — `document.fonts` reports the
// family loaded, and its text-advance width differs from serif, on BOTH. The
// defect lives only in what the canvas PAINTS. An earlier attempt gated on
// text-advance width and would have passed a visibly broken canvas; see
// examples/canvas/fixtures/README.md for that retraction and for four other
// probes that cannot fail.
//
// HOW IT MEASURES. The fixture holds (bound, free) PAIRS with identical text,
// family and size. Same string + same font => same rendered ink width. If
// bound text falls back to serif it is materially wider than its free twin
// (serif 387.98 vs hand-drawn 303.20 for the probe string at 20px). So the
// assertion is a RATIO between two things measured in the same screenshot on
// the same machine — no golden image, no font files, no per-platform baseline.
//
// TWO TRAPS, both paid for in blood:
//
//  1. DO NOT pass --virtual-time-budget (or use --screenshot, which implies a
//     load-event capture). Virtual time lets the fonts resolve BEFORE the scene
//     applies, so the bug never manifests and the gate is a permanent false
//     green. Verified: with --virtual-time-budget the broken build renders
//     correctly and byte-identically to the fixed one.
//  2. The profile dir must be FRESH every run. Bound text resolves its font
//     once, at scene-apply; a warm HTTP cache makes the font available in time
//     and masks the defect.
//
// The harness measures inside the page and POSTs its verdict through the
// board's own /feedback endpoint, which this test then reads. That keeps the
// gate stdlib-only — Go has no WebSocket, so driving CDP would mean a
// dependency, and the zero-dep covenant outranks the convenience.
//
// This test FAILS LOUD when it cannot run. It never skips on a missing Chrome:
// a gate that quietly skips is the same false green it exists to prevent.
// Set STDDOC_SKIP_PIXEL_GATE=1 to opt out deliberately (and own that choice).

// chromeBinary returns the platform Chrome path, or "" if absent.
func chromeBinary() string {
	if env := os.Getenv("STDDOC_CHROME"); env != "" {
		return env
	}
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		}
	default:
		candidates = []string{"google-chrome", "chromium", "chromium-browser"}
	}
	for _, c := range candidates {
		if strings.ContainsRune(c, os.PathSeparator) {
			if _, err := os.Stat(c); err == nil {
				return c
			}
			continue
		}
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	return ""
}

// gateScene builds the (bound, free) pair fixture. Containers are opacity 0 so
// ONLY text paints, which makes ink-row clustering unambiguous.
func gateScene() []byte {
	const probe = "HHWWiimmOO"
	families := []struct {
		name string
		id   int
	}{{"Virgil", 1}, {"Cascadia", 3}}

	var els []map[string]any
	for i, fam := range families {
		top := 100 + i*400
		cid, tid := fmt.Sprintf("c%d", i), fmt.Sprintf("t%d", i)
		common := func(extra map[string]any) map[string]any {
			m := map[string]any{
				"angle": 0, "strokeColor": "#e0e0e0", "backgroundColor": "transparent",
				"fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
				"roughness": 1, "opacity": 100, "groupIds": []any{}, "frameId": nil,
				"roundness": nil, "version": 1, "isDeleted": false,
				"boundElements": nil, "updated": 1, "link": nil, "locked": false,
			}
			for k, v := range extra {
				m[k] = v
			}
			return m
		}
		els = append(els, common(map[string]any{
			"id": cid, "type": "rectangle", "x": 100, "y": top,
			"width": 600, "height": 200, "opacity": 0, // invisible: only text paints
			"seed": 100 + i, "versionNonce": 100 + i,
			"boundElements": []any{map[string]any{"id": tid, "type": "text"}},
		}))
		els = append(els, common(map[string]any{
			"id": tid, "type": "text", "x": 120, "y": top + 80,
			"width": 560, "height": 45, "seed": 200 + i, "versionNonce": 200 + i,
			"text": probe, "originalText": probe, "fontSize": 36, "fontFamily": fam.id,
			"textAlign": "center", "verticalAlign": "middle",
			"containerId": cid, "lineHeight": 1.25, "baseline": 32,
		}))
		els = append(els, common(map[string]any{
			"id": fmt.Sprintf("f%d", i), "type": "text", "x": 120, "y": top + 250,
			"width": 560, "height": 45, "seed": 300 + i, "versionNonce": 300 + i,
			"text": probe, "originalText": probe, "fontSize": 36, "fontFamily": fam.id,
			"textAlign": "left", "verticalAlign": "top",
			"containerId": nil, "lineHeight": 1.25, "baseline": 32,
		}))
	}
	b, _ := json.Marshal(map[string]any{
		"type": "excalidraw", "version": 2, "source": "stddoc-font-gate",
		"elements": els, "files": map[string]any{},
		"appState": map[string]any{"theme": "dark", "viewBackgroundColor": "#ffffff"},
		"_rev": 1, "_author": "gate",
	})
	return b
}

// harnessHTML measures inside the page: it embeds the board (same origin, so
// the iframe's canvas is readable), waits for the scene to paint, clusters ink
// rows on the static canvas, and POSTs per-cluster ink widths back through the
// board's /feedback endpoint.
const harnessHTML = `<!doctype html><meta charset=utf-8><title>font gate</title>
<style>html,body{margin:0;background:#000}iframe{width:1400px;height:1400px;border:0}</style>
<iframe id=f src="/board/gate/"></iframe>
<script>
function report(o){
  fetch("/board/gate/feedback",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({text:"GATE "+JSON.stringify(o),ref:"font-gate",rev:1})});
}
function measure(doc){
  var cs=[].slice.call(doc.querySelectorAll("canvas"));
  if(!cs.length) return {error:"no canvas"};
  // the STATIC scene canvas is the largest one
  cs.sort(function(a,b){return b.width*b.height-a.width*a.height});
  var cv=cs[0], g=cv.getContext("2d"), W=cv.width, H=cv.height, d;
  try{ d=g.getImageData(0,0,W,H).data; }catch(e){ return {error:"getImageData: "+e.message}; }
  function lum(x,y){var o=(y*W+x)*4;return (d[o]*299+d[o+1]*587+d[o+2]*114)/1000;}
  var bg=lum(2,H-2), rows=[];
  for(var y=0;y<H;y++){var c=0;for(var x=0;x<W;x++){if(Math.abs(lum(x,y)-bg)>12)c++;}rows.push(c);}
  var clusters=[],start=null;
  for(var y=0;y<H;y++){
    if(rows[y]>0&&start===null)start=y;
    else if(rows[y]===0&&start!==null){ if(y-start>=6)clusters.push([start,y]); start=null; }
  }
  if(start!==null&&H-start>=6)clusters.push([start,H]);
  var out=[];
  for(var i=0;i<clusters.length;i++){
    var y0=clusters[i][0],y1=clusters[i][1],lo=1e9,hi=-1;
    for(var yy=y0;yy<y1;yy++)for(var xx=0;xx<W;xx++){
      if(Math.abs(lum(xx,yy)-bg)>12){ if(xx<lo)lo=xx; if(xx>hi)hi=xx; }
    }
    if(hi>=0)out.push({band:[y0,y1],width:hi-lo+1});
  }
  return {clusters:out};
}
var f=document.getElementById("f");
setTimeout(function(){
  var r;
  try{ r=measure(f.contentDocument); }catch(e){ r={error:"access: "+e.message}; }
  report(r);
}, 14000);
</script>`

func TestCanvasPixelGate_BoundTextUsesRequestedFont(t *testing.T) {
	if os.Getenv("STDDOC_SKIP_PIXEL_GATE") == "1" {
		t.Skip("STDDOC_SKIP_PIXEL_GATE=1 — opted out deliberately")
	}
	chrome := chromeBinary()
	if chrome == "" {
		// NOT a skip. A gate that vanishes when its tool is missing is the
		// false green it exists to prevent.
		t.Fatal("pixel gate cannot run: no Chrome/Chromium found. Install one, " +
			"set STDDOC_CHROME=/path/to/chrome, or set STDDOC_SKIP_PIXEL_GATE=1 to opt out on purpose")
	}

	// Serve the REAL codraw runtime plus the harness page from one origin.
	runtimeRoot := filepath.Join(repoRoot(t), "go", "stddoc-lib", "lib", "codraw")
	if _, err := os.Stat(filepath.Join(runtimeRoot, "index.html")); err != nil {
		t.Fatalf("codraw runtime missing at %s: %v", runtimeRoot, err)
	}
	feedbackDir := t.TempDir()
	cs := newCodrawServer(runtimeRoot, feedbackDir)

	// Seed the gate board's scene before anything can touch it.
	cs.seedScene(cs.scenePath("gate"))
	if err := os.WriteFile(cs.scenePath("gate"), gateScene(), 0o644); err != nil {
		t.Fatalf("write gate scene: %v", err)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("/harness.html", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(harnessHTML))
	})
	mux.Handle("/", cs)
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	defer func() { _ = srv.Close() }()
	base := "http://" + ln.Addr().String()

	// FRESH profile, REAL time. No --virtual-time-budget, no --screenshot.
	profile := t.TempDir()
	cmd := exec.Command(chrome,
		"--headless=new", "--disable-gpu", "--no-first-run",
		"--no-default-browser-check", "--disable-extensions",
		"--window-size=1400,1400",
		"--user-data-dir="+profile,
		base+"/harness.html",
	)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start chrome: %v", err)
	}
	defer func() { _ = cmd.Process.Kill() }()

	inbox := cs.inboxPath("gate")
	var payload string
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if b, err := os.ReadFile(inbox); err == nil {
			for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
				var entry map[string]any
				if json.Unmarshal([]byte(line), &entry) != nil {
					continue
				}
				if txt, _ := entry["text"].(string); strings.HasPrefix(txt, "GATE ") {
					payload = strings.TrimPrefix(txt, "GATE ")
				}
			}
		}
		if payload != "" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if payload == "" {
		t.Fatal("pixel gate produced no measurement within 60s — the harness never " +
			"reported. This is a FAILURE, not an inconclusive run: treat it as red " +
			"until you can see why (run chrome without --headless=new to watch).")
	}

	var res struct {
		Error    string `json:"error"`
		Clusters []struct {
			Band  []int `json:"band"`
			Width int   `json:"width"`
		} `json:"clusters"`
	}
	if err := json.Unmarshal([]byte(payload), &res); err != nil {
		t.Fatalf("unparseable gate payload %q: %v", payload, err)
	}
	if res.Error != "" {
		t.Fatalf("harness could not measure: %s", res.Error)
	}

	// 2 families x (bound, free), top to bottom: bound0, free0, bound1, free1.
	if len(res.Clusters) != 4 {
		t.Fatalf("expected 4 text clusters (2 bound + 2 free), got %d: %+v\n"+
			"If this is 0, the scene never painted; if 2, a bound/free pair collapsed.",
			len(res.Clusters), res.Clusters)
	}

	families := []string{"Virgil", "Cascadia"}
	for i, fam := range families {
		bound := res.Clusters[i*2].Width
		free := res.Clusters[i*2+1].Width
		if bound <= 0 || free <= 0 {
			t.Fatalf("%s: degenerate ink widths bound=%d free=%d", fam, bound, free)
		}
		ratio := float64(bound) / float64(free)
		// Same string, same family, same size => same advance. Serif fallback
		// is ~25% wider; 10% is slack for antialiasing and hinting only.
		if ratio < 0.90 || ratio > 1.10 {
			t.Errorf("%s: container-bound text does NOT render in the requested font.\n"+
				"  bound ink width = %d px\n  free  ink width = %d px  (same string, same family, same size)\n"+
				"  ratio = %.3f, want 1.00 +/- 0.10\n"+
				"  A ratio near 1.25 means bound text fell back to serif — the 0.17.6 "+
				"bound-text defect. See examples/canvas/fixtures/README.md.",
				fam, bound, free, ratio)
		} else {
			t.Logf("%s OK: bound=%d free=%d ratio=%.3f", fam, bound, free, ratio)
		}
	}
}
