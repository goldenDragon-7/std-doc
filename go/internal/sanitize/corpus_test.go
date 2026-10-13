package sanitize

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The CORPUS REGRESSION MEASUREMENT promised in
// the HTML value-sanitizer design note §5.
//
// A sanitizer that rejects everything is trivially "secure" and useless. The
// honest question is: how much of real, hand-written Claude HTML does this
// gate actually admit? That number is the measure of how much of the
// straightjacket the escape hatch removes, and the spec says to PUBLISH it
// rather than assume it.
//
// This test never fails on the pass rate — it reports it. It fails only if the
// gate admits NOTHING, which would mean we shipped a reject-everything gate.
//
// Skips cleanly when the reference corpus is absent (it lives outside the
// repo), so this is a measurement on the machines that have it and a no-op
// everywhere else. A SKIP here is honest; a silent pass would not be.

func corpusRoots() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	return []string{
		filepath.Join(home, "workspace", "vmshare", "doc-examples"),
		filepath.Join(home, "workspace", "vmshare", "docs"),
		filepath.Join(home, "workspace", "curate", "samples"),
	}
}

// bodyFragments pulls the inner content of each <section>/<div> that a real
// author would plausibly paste into an html block. We deliberately do NOT feed
// whole documents: an html block is a FRAGMENT inside JSON-canon, so measuring
// whole-document admission would answer a question nobody is asking.
func bodyFragments(src string) []string {
	var out []string
	rest := src
	for {
		i := strings.Index(rest, "<section")
		if i < 0 {
			break
		}
		rest = rest[i:]
		j := strings.Index(rest, "</section>")
		if j < 0 {
			break
		}
		frag := rest[:j+len("</section>")]
		if len(frag) < 40_000 {
			out = append(out, frag)
		}
		rest = rest[j+len("</section>"):]
	}
	return out
}

func TestCorpusAdmissionRate(t *testing.T) {
	p := policy(t)

	var files []string
	for _, root := range corpusRoots() {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			if strings.HasSuffix(path, ".html") {
				files = append(files, path)
			}
			return nil
		})
	}
	if len(files) == 0 {
		t.Skip("reference corpus not present on this machine — measurement skipped (not silently passed)")
	}
	sort.Strings(files)

	var total, admitted int
	reasons := map[string]int{}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		for _, frag := range bodyFragments(string(b)) {
			total++
			if _, err := Sanitize(frag, p, ModeServe); err == nil {
				admitted++
				continue
			} else if se, ok := err.(*Error); ok {
				seen := map[string]bool{}
				for _, v := range se.Violations {
					if !seen[v.Rule] {
						reasons[v.Rule]++
						seen[v.Rule] = true
					}
				}
			}
		}
	}
	if total == 0 {
		t.Skip("no fragments extracted from the corpus")
	}

	rate := 100 * float64(admitted) / float64(total)
	t.Logf("CORPUS ADMISSION: %d/%d fragments admitted (%.1f%%) across %d documents",
		admitted, total, rate, len(files))

	type kv struct {
		r string
		n int
	}
	var rs []kv
	for r, n := range reasons {
		rs = append(rs, kv{r, n})
	}
	sort.Slice(rs, func(i, j int) bool { return rs[i].n > rs[j].n })
	for _, x := range rs {
		t.Logf("    rejected for %-22s %d fragments", x.r, x.n)
	}

	// The only failing condition: a gate that admits nothing is useless, and
	// would silently re-create the straightjacket this layer exists to remove.
	if admitted == 0 {
		t.Fatalf("the gate admitted ZERO of %d real corpus fragments — "+
			"a reject-everything sanitizer is not a security win, it is a broken feature", total)
	}
}
