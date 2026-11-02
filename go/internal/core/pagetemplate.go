package core

import (
	"fmt"
	"sort"

	"stddoc/internal/library"
	"stddoc/internal/template"
	"stddoc/internal/wire"
)

// pagetemplate.go — LAYER 2 wiring. A node may name a page `template` (e.g.
// "decision-board"); the engine looks it up in page_templates.json, runs the
// data-driven assembler (template.Expand) over the node's own fields, and feeds
// the resulting primitive blocks[] into the SAME renderBlocks pipeline every
// other page uses. A node that names no template takes the identical old path,
// which is what keeps the golden-master strangler proof intact.
//
// A pageTemplate entry is:
//
//	"decision-board": {
//	  "binds":    {"required": ["sections"]},   // optional — drives teaching errors
//	  "assemble": [ ...emit nodes (see template/expand.go grammar)... ]
//	}

// pageTemplate is one named entry decoded from page_templates.json.
type pageTemplate struct {
	required []string
	assemble []any
}

// loadPageTemplates parses the library's page_templates.json into name->entry.
// A nil/empty file yields an empty map (no templates available) rather than an
// error, so a library tree without the file renders exactly as before.
func loadPageTemplates(lib *library.Library) (map[string]pageTemplate, error) {
	out := map[string]pageTemplate{}
	if lib == nil || len(lib.PageTemplatesJSON) == 0 {
		return out, nil
	}
	v, err := template.DecodeNodes(lib.PageTemplatesJSON)
	if err != nil {
		return nil, fmt.Errorf("page_templates.json: %w", err)
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("page_templates.json must be a JSON object of name -> template")
	}
	for name, raw := range obj {
		entry, ok := raw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("page template %q must be an object with an \"assemble\" list", name)
		}
		asm, ok := entry["assemble"].([]any)
		if !ok {
			return nil, fmt.Errorf("page template %q is missing its \"assemble\" list (the primitive-assembly spec)", name)
		}
		pt := pageTemplate{assemble: asm}
		if binds, ok := entry["binds"].(map[string]any); ok {
			if req, ok := binds["required"].([]any); ok {
				for _, r := range req {
					if s, ok := r.(string); ok {
						pt.required = append(pt.required, s)
					}
				}
			}
		}
		out[name] = pt
	}
	return out, nil
}

// templateNames returns the available template names, sorted — for teaching
// errors that tell the author exactly what they could have typed.
func templateNames(m map[string]pageTemplate) []string {
	names := make([]string, 0, len(m))
	for k := range m {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

// validateTemplates is the PRE-RUN check: every node that names a template must
// name one that exists, and must carry the fields that template declares
// required. A capability that cannot be found is indistinguishable from one that
// does not exist — so when it cannot be found, we say so, by name, before render.
func validateTemplates(doc *wire.OrderedMap, lib *library.Library) error {
	templates, err := loadPageTemplates(lib)
	if err != nil {
		return err
	}
	for _, nv := range list(doc, "_all") {
		n, ok := omap(nv)
		if !ok {
			continue
		}
		name := str(n, "template")
		if name == "" {
			continue
		}
		pt, ok := templates[name]
		if !ok {
			avail := templateNames(templates)
			if len(avail) == 0 {
				return fmt.Errorf("node %q names template %q, but this library ships no page_templates.json", str(n, "slug"), name)
			}
			return fmt.Errorf("node %q names unknown template %q; available templates: %v", str(n, "slug"), name, avail)
		}
		var missing []string
		for _, f := range pt.required {
			if !truthy(get(n, f)) {
				missing = append(missing, f)
			}
		}
		if len(missing) > 0 {
			return fmt.Errorf("node %q uses template %q but is missing required field(s): %v", str(n, "slug"), name, missing)
		}
	}
	return nil
}

// expandTemplatedNode expands a node's template into a typed block stream. The
// second return is false when the node names no template (caller keeps the
// normal adaptNode path). A non-nil error is a malformed-spec failure; callers
// turn it into a VISIBLE block rather than dropping content silently.
func expandTemplatedNode(n *wire.OrderedMap, lib *library.Library) ([]streamBlock, bool, error) {
	name := str(n, "template")
	if name == "" {
		return nil, false, nil
	}
	templates, err := loadPageTemplates(lib)
	if err != nil {
		return nil, true, err
	}
	pt, ok := templates[name]
	if !ok {
		return nil, true, fmt.Errorf("unknown template %q", name)
	}
	blocks, err := template.Expand(pt.assemble, n)
	if err != nil {
		return nil, true, err
	}
	out := make([]streamBlock, 0, len(blocks))
	for _, b := range blocks {
		out = append(out, streamBlock{Type: str(b, "type"), Data: b})
	}
	return out, true, nil
}

// templateErrorBlock renders a loud, visible error in place of a page whose
// template could not expand — the opposite of a silent empty page.
func templateErrorBlock(slug string, err error) []streamBlock {
	b := wire.NewOrderedMap()
	b.Set("type", "callout")
	b.Set("variant", "gate")
	b.Set("lead", "template error on page "+slug)
	b.Set("body", err.Error())
	return []streamBlock{{Type: "callout", Data: b}}
}
