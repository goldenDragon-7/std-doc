// Package library loads the engine's verbatim data (the primitive/style/theme
// library) from a data directory at RUNTIME — it is data, not code, and is
// fully replaceable. The frozen binary is the engine only; a stranger can
// delete our defaults in stddoc-lib/ and supply their own wholesale. Reading
// these files is no different in trust from reading the source.json the engine
// already reads (bounded interpreter, no eval/network/shell).
//
// The Library struct mirrors the old go:embed assets package field-for-field so
// every byte of output stays identical: the 17 templates, the per-primitive CSS
// dump, the body CSS, the named-style :root files, the page atoms, the two
// inline JS blobs, and the inline themes.
package library

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DefaultStyle mirrors publish.DEFAULT_STYLE.
const DefaultStyle = "techno-dark"

// Library holds the loaded data the renderer needs. Fields mirror the old
// assets package exactly so consumers (template.LoadTemplates, json.Unmarshal)
// are fed identical bytes.
type Library struct {
	TemplatesJSON      []byte            // templates.json — raw
	PageAtomsJSON      []byte            // page_atoms.json — raw
	PrimitiveCSSJSON   []byte            // primitive_css.json — raw
	DiagramEnginesJSON []byte            // diagram_engines.json — raw; OPTIONAL (nil if absent, so older library trees still load)
	BodyCSS            string            // body.css — raw
	SearchJS           string            // search.js — raw
	NavScrollJS        string            // nav_scroll.js — raw
	Styles             map[string]string // styles/*.css — trimmed, keyed by basename w/o .css
	Themes             map[string]string // themes/*.css — raw, keyed by basename w/o .css
	Root               string            // the directory this library was loaded from — for self-diagnosing errors
}

// Style returns the :root token block for a named style, trimmed exactly as the
// reference's load_style() does (file.read().strip()).
func (l *Library) Style(name string) (string, error) {
	if s, ok := l.Styles[name]; ok {
		return s, nil
	}
	return "", fmt.Errorf("unknown style %q; available: parchment-light, playful, techno-dark", name)
}

// Theme returns the inline theme stylesheet for a layout:page doc
// (core.page.load_theme): the file's raw bytes, or "" if the theme is absent.
func (l *Library) Theme(name string) string {
	return l.Themes[name]
}

// Load reads the full default library from root: templates.json, page_atoms.json,
// primitive_css.json, body.css, search.js, nav_scroll.js, styles/*.css, and
// themes/*.css. Pure runtime — a missing required file is a loud error naming
// the path, never a silent fallback.
func Load(root string) (*Library, error) {
	lib := &Library{
		Root:   root,
		Styles: map[string]string{},
		Themes: map[string]string{},
	}

	var err error
	if lib.TemplatesJSON, err = readBytes(root, "templates.json"); err != nil {
		return nil, err
	}
	if lib.PageAtomsJSON, err = readBytes(root, "page_atoms.json"); err != nil {
		return nil, err
	}
	if lib.PrimitiveCSSJSON, err = readBytes(root, "primitive_css.json"); err != nil {
		return nil, err
	}
	// diagram_engines.json — OPTIONAL. The best-engine-per-type routing table
	// (the diagram team's vetted standard). Absent in older library trees; a
	// nil value simply means the diagram primitive falls back to its built-in
	// default routing, so a missing file must never fail Load (backward-compat +
	// the byte-identical strangler proof for pre-existing pages).
	if b, rerr := os.ReadFile(filepath.Join(root, "diagram_engines.json")); rerr == nil {
		lib.DiagramEnginesJSON = b
	}
	if lib.BodyCSS, err = readString(root, "body.css"); err != nil {
		return nil, err
	}
	if lib.SearchJS, err = readString(root, "search.js"); err != nil {
		return nil, err
	}
	if lib.NavScrollJS, err = readString(root, "nav_scroll.js"); err != nil {
		return nil, err
	}

	// styles/*.css — trimmed (str.strip semantics). Required dir.
	stylesDir := filepath.Join(root, "styles")
	styleFiles, err := os.ReadDir(stylesDir)
	if err != nil {
		return nil, fmt.Errorf("library: reading styles dir %s: %w", stylesDir, err)
	}
	for _, f := range styleFiles {
		// Skip dirs, non-.css, and dotfiles — e.g. macOS AppleDouble "._*.css"
		// cruft that survives a careless tar would otherwise register a junk
		// style key and silently pollute the library.
		if f.IsDir() || strings.HasPrefix(f.Name(), ".") || !strings.HasSuffix(f.Name(), ".css") {
			continue
		}
		b, rerr := os.ReadFile(filepath.Join(stylesDir, f.Name()))
		if rerr != nil {
			return nil, fmt.Errorf("library: reading style %s: %w", f.Name(), rerr)
		}
		key := strings.TrimSuffix(f.Name(), ".css")
		lib.Styles[key] = trimSpace(string(b))
	}

	// themes/*.css — raw bytes, optional (absent theme => "" via Theme()).
	themesDir := filepath.Join(root, "themes")
	themeFiles, terr := os.ReadDir(themesDir)
	if terr == nil {
		for _, f := range themeFiles {
			// Same dotfile guard as styles (AppleDouble "._*.css" cruft).
			if f.IsDir() || strings.HasPrefix(f.Name(), ".") || !strings.HasSuffix(f.Name(), ".css") {
				continue
			}
			b, rerr := os.ReadFile(filepath.Join(themesDir, f.Name()))
			if rerr != nil {
				return nil, fmt.Errorf("library: reading theme %s: %w", f.Name(), rerr)
			}
			key := strings.TrimSuffix(f.Name(), ".css")
			lib.Themes[key] = string(b)
		}
	} else if !os.IsNotExist(terr) {
		return nil, fmt.Errorf("library: reading themes dir %s: %w", themesDir, terr)
	}

	return lib, nil
}

func readBytes(root, name string) ([]byte, error) {
	p := filepath.Join(root, name)
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, fmt.Errorf("library: required file missing: %s: %w", p, err)
	}
	return b, nil
}

func readString(root, name string) (string, error) {
	b, err := readBytes(root, name)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// trimSpace replicates Python str.strip() for the ASCII whitespace that appears
// in these files (space, tab, newline, carriage return, form feed, vertical tab).
func trimSpace(s string) string {
	isSpace := func(b byte) bool {
		return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\f' || b == '\v'
	}
	i, j := 0, len(s)
	for i < j && isSpace(s[i]) {
		i++
	}
	for j > i && isSpace(s[j-1]) {
		j--
	}
	return s[i:j]
}
