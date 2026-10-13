package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// THE SPECIFICITY TRAP — found by LOOKING, not by grepping.
//
// The `stats` primitive shipped with `.stats .stat-val{…color:var(--text)…}`
// (specificity 0,2,0) on the very element that carries a tone class like
// `.u-amber` (specificity 0,1,0). The primitive rule won. The result:
//
//   - the author's `"tone":"amber"` was accepted,
//   - the `u-amber` class WAS in the DOM,
//   - the `.u-amber{color:var(--amber)}` rule WAS on the page,
//   - and the value still rendered in the default text colour.
//
// Every string-level check passes. Only the rendered pixels — and the computed
// style — reveal it. That is the "pixel-only defects" class this project has
// been burned by before, so the fix is not enough on its own: the trap has to
// become something the harness catches.
//
// THE RULE: a primitive may not set `color:` on the same element that carries a
// tone class. Style the container, the label, anything else — but leave the
// toned element's colour to the utility layer, which inherits `--text` by
// default and is overridden by a tone when one is present.
//
// This test derives the toned element's class from templates.json (the class
// literal immediately preceding a tone lookup table) and then checks that
// primitive's CSS for a competing `color:` declaration on that class.

// toneTable matches a lookup whose table maps author tokens to u- classes.
var toneTableRe = regexp.MustCompile(`"lookup"\s*:\s*"tone"\s*,\s*"table"\s*:\s*\{[^}]*"u-`)

// classLiteralRe finds the LAST class literal opened before a given offset,
// e.g. `<div class='stat-val` -> stat-val.
// (class literal extraction is done with string scanning, see below)

// colourDeclRe matches a CSS rule that sets colour (not background-color,
// border-color, etc.) on a selector.
var ruleRe = regexp.MustCompile(`([^{}]+)\{([^}]*)\}`)

func setsColour(decls string) bool {
	for _, d := range strings.Split(decls, ";") {
		d = strings.TrimSpace(d)
		if strings.HasPrefix(d, "color:") {
			return true
		}
	}
	return false
}

func TestUtilityLayer_PrimitivesDoNotOverrideTone(t *testing.T) {
	root := libRoot(t)

	rawTemplates, err := os.ReadFile(filepath.Join(root, "templates.json"))
	if err != nil {
		t.Fatalf("templates.json: %v", err)
	}
	var templates map[string]json.RawMessage
	if err := json.Unmarshal(rawTemplates, &templates); err != nil {
		t.Fatalf("templates.json: %v", err)
	}

	rawCSS, err := os.ReadFile(filepath.Join(root, "primitive_css.json"))
	if err != nil {
		t.Fatalf("primitive_css.json: %v", err)
	}
	var cssMap map[string]string
	if err := json.Unmarshal(rawCSS, &cssMap); err != nil {
		t.Fatalf("primitive_css.json: %v", err)
	}

	checked := 0
	for name, tmpl := range templates {
		body := string(tmpl)
		loc := toneTableRe.FindStringIndex(body)
		if loc == nil {
			continue // primitive has no tone support
		}
		// The toned element's class literal is the last one opened before the
		// tone lookup. Templates emit `"<div class='stat-val"` then the lookup.
		prefix := body[:loc[0]]
		// The class literal is the last `class='…` opened before the lookup.
		// Take from that marker to the end of its JSON string literal.
		i := strings.LastIndex(prefix, "class='")
		if i < 0 {
			t.Logf("primitive %q: tone lookup found but no class literal resolved; skipping", name)
			continue
		}
		lit := prefix[i+len("class='"):]
		if j := strings.IndexAny(lit, "\"'"); j >= 0 {
			lit = lit[:j]
		}
		fields := strings.Fields(lit)
		if len(fields) == 0 {
			t.Logf("primitive %q: empty class literal before tone lookup; skipping", name)
			continue
		}
		toned := fields[len(fields)-1]
		checked++

		for _, rule := range ruleRe.FindAllStringSubmatch(cssMap[name], -1) {
			selector, decls := strings.TrimSpace(rule[1]), rule[2]
			if !strings.Contains(selector, "."+toned) {
				continue
			}
			// Selector targets the toned element. A colour here outranks the
			// single-class utility and silently defeats the tone.
			if setsColour(decls) {
				t.Errorf("primitive %q sets `color:` on the toned element .%s\n"+
					"    selector: %s\n"+
					"    A tone utility (.u-amber, specificity 0,1,0) cannot override this.\n"+
					"    The class lands in the DOM, the rule lands on the page, and the\n"+
					"    tone still does not render — a pixel-only defect.\n"+
					"    FIX: remove the colour declaration; .%s inherits --text from body,\n"+
					"    so untoned output is unchanged and a tone can win when present.",
					name, toned, selector, toned)
			}
		}
	}

	if checked == 0 {
		t.Fatal("no tone-capable primitive found — this guard would silently protect nothing")
	}
	t.Logf("checked %d tone-capable primitive(s) for the specificity trap", checked)
}
