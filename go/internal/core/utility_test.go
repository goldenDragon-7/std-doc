package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// libRoot locates go/stddoc-lib from the package directory.
func libRoot(t *testing.T) string {
	t.Helper()
	root := filepath.Join("..", "..", "stddoc-lib")
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("stddoc-lib not found at %s: %v", root, err)
	}
	return root
}

func utilityTable(t *testing.T) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(libRoot(t), "utility_css.json"))
	if err != nil {
		t.Fatalf("utility_css.json: %v", err)
	}
	tbl := loadUtilityCSS(raw)
	if len(tbl) == 0 {
		t.Fatal("utility table parsed empty — the layer would silently never emit")
	}
	return tbl
}

// TestUtilityCSS_EmitsOnlyWhatIsUsed is the core contract: rules for classes
// present in the HTML, nothing for classes that are not.
func TestUtilityCSS_EmitsOnlyWhatIsUsed(t *testing.T) {
	tbl := utilityTable(t)
	html := `<p class="u-amber u-tight">measured</p><span class='u-mono'>x</span>`
	got := collectUtilityCSS(html, tbl)

	for _, want := range []string{"u-amber", "u-tight", "u-mono"} {
		if !strings.Contains(got, "."+want+"{") {
			t.Errorf("used class %q produced no rule; got %q", want, got)
		}
	}
	// Unused classes must contribute nothing.
	for _, unused := range []string{"u-green", "u-red", "u-purple", "u-caps"} {
		if strings.Contains(got, "."+unused+"{") {
			t.Errorf("unused class %q leaked into the page", unused)
		}
	}
}

// TestUtilityCSS_ZeroBytesWhenUnused is the strangler proof in miniature and
// the single most important test here: a page that uses no utility class must
// receive EXACTLY nothing, or every pre-existing conformance golden shifts.
func TestUtilityCSS_ZeroBytesWhenUnused(t *testing.T) {
	tbl := utilityTable(t)
	for _, html := range []string{
		"",
		"<p>plain prose with no classes at all</p>",
		`<div class="card"><span class="stat-val">42</span></div>`,
		`<div class='cardgrid variant'><p class='tagline'>x</p></div>`,
	} {
		if got := collectUtilityCSS(html, tbl); got != "" {
			t.Errorf("expected zero bytes for %q, got %q", html, got)
		}
	}
}

// TestUtilityCSS_NilTableIsNoOp — an older library tree without the file must
// behave exactly like the pre-utility engine.
func TestUtilityCSS_NilTableIsNoOp(t *testing.T) {
	if got := collectUtilityCSS(`<p class="u-amber">x</p>`, loadUtilityCSS(nil)); got != "" {
		t.Errorf("absent utility_css.json must emit nothing, got %q", got)
	}
	if got := collectUtilityCSS(`<p class="u-amber">x</p>`, loadUtilityCSS([]byte("{ not json"))); got != "" {
		t.Errorf("malformed utility_css.json must emit nothing, got %q", got)
	}
}

// TestUtilityCSS_Deterministic — conformance is byte-identity, not set
// equality, so emission order must be stable across runs and map iterations.
func TestUtilityCSS_Deterministic(t *testing.T) {
	tbl := utilityTable(t)
	html := `<p class="u-red u-amber u-green u-mono u-tight">x</p>`
	first := collectUtilityCSS(html, tbl)
	for i := 0; i < 50; i++ {
		if got := collectUtilityCSS(html, tbl); got != first {
			t.Fatalf("non-deterministic emission on iteration %d", i)
		}
	}
	if first == "" {
		t.Fatal("expected rules for five used classes")
	}
}

var literalColour = regexp.MustCompile(`(?i)(#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\()`)

// TestUtilityCSS_NoLiteralColours guards Covenant II at build time. A utility
// that hard-codes a colour would render identically in every style and
// silently break `--style` theme swapping — the exact failure the layer exists
// to prevent. Colours must come from palette tokens.
func TestUtilityCSS_NoLiteralColours(t *testing.T) {
	for name, rule := range utilityTable(t) {
		if m := literalColour.FindString(rule); m != "" {
			t.Errorf("utility %q hard-codes colour %q — bind to a palette var(--token) instead", name, m)
		}
	}
}

// TestUtilityCSS_TokensExistInEveryStyle turns the theming CLAIM into a gate.
// Every var(--token) referenced by a utility must be defined by ALL shipped
// styles; otherwise the utility silently renders unstyled under one theme and
// nobody notices until a reader sees it.
func TestUtilityCSS_TokensExistInEveryStyle(t *testing.T) {
	tbl := utilityTable(t)
	varRe := regexp.MustCompile(`var\(\s*(--[a-z0-9-]+)\s*\)`)

	tokens := map[string]bool{}
	for _, rule := range tbl {
		for _, m := range varRe.FindAllStringSubmatch(rule, -1) {
			tokens[m[1]] = true
		}
	}
	if len(tokens) == 0 {
		t.Fatal("no palette tokens referenced — the layer cannot be themeable")
	}

	styleDir := filepath.Join(libRoot(t), "styles")
	entries, err := os.ReadDir(styleDir)
	if err != nil {
		t.Fatalf("styles dir: %v", err)
	}
	styles := 0
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".css") {
			continue
		}
		styles++
		css, err := os.ReadFile(filepath.Join(styleDir, e.Name()))
		if err != nil {
			t.Fatalf("%s: %v", e.Name(), err)
		}
		var missing []string
		for tok := range tokens {
			if !strings.Contains(string(css), tok+":") {
				missing = append(missing, tok)
			}
		}
		sort.Strings(missing)
		if len(missing) > 0 {
			t.Errorf("style %s does not define %v — utilities using them would not theme",
				e.Name(), missing)
		}
	}
	if styles < 3 {
		t.Fatalf("expected the three shipped styles, found %d", styles)
	}
}

// TestUtilityCSS_KeysAreNamespaced — every utility must carry the u- prefix so
// it can never collide with a primitive's class or an engine-owned anchor.
func TestUtilityCSS_KeysAreNamespaced(t *testing.T) {
	for name := range utilityTable(t) {
		if !strings.HasPrefix(name, "u-") {
			t.Errorf("utility %q must be namespaced with the u- prefix", name)
		}
	}
}

// TestUtilityCSS_RuleMatchesItsKey — a rule filed under one key that styles a
// different selector would be emitted on the wrong trigger (usage-scanned
// emission keys off the class name).
func TestUtilityCSS_RuleMatchesItsKey(t *testing.T) {
	for name, rule := range utilityTable(t) {
		if !strings.HasPrefix(rule, "."+name+"{") {
			t.Errorf("utility %q must define exactly its own selector .%s{…}, got %q",
				name, name, rule)
		}
	}
}

// TestUtilityCSS_DocKeyIsSkipped — the "_doc" explainer must never be emitted.
func TestUtilityCSS_DocKeyIsSkipped(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(libRoot(t), "utility_css.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("utility_css.json is not valid JSON: %v", err)
	}
	if _, ok := m["_doc"]; !ok {
		t.Skip("no _doc key present")
	}
	if _, ok := utilityTable(t)["_doc"]; ok {
		t.Error("_doc leaked into the emitted table")
	}
}
