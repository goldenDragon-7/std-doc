package core

import (
	"strings"
	"testing"
)

// TestStatusboardPrimitive covers P1 #3: `statusboard` — a grid with grouped
// rows and per-cell status color, reusing the existing global .b-live/.b-partial/
// .b-wip/.b-debt badge classes (nav.go's statusClass mapping, mirrored here as a
// declarative `lookup` table since data-driven templates can't call Go funcs).
func TestStatusboardPrimitive(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("build registry: %v", err)
	}

	doc := parseDoc(t, `{
		"title": "x",
		"nodes": [{
			"slug": "a", "title": "A",
			"blocks": [{
				"type": "statusboard",
				"columns": ["build1", "build2"],
				"groups": [{
					"label": "Core",
					"rows": [
						{"label": "gateway", "cells": [{"status": "LIVE"}, {"status": "DEBT"}]},
						{"label": "doctor", "cells": [{"status": "wip"}, {"status": "PARTIAL"}]}
					]
				}]
			}]
		}]
	}`)
	buildTree(doc)
	n := bySlug(doc, "a")
	h := renderNode(n, doc, reg, "", lib)

	for _, want := range []string{"build1", "build2", "Core", "gateway", "doctor"} {
		if !strings.Contains(h, want) {
			t.Errorf("statusboard: expected %q in output", want)
		}
	}
	if !strings.Contains(h, "class='s b-live'") {
		t.Error("statusboard: expected LIVE cell mapped to b-live")
	}
	if !strings.Contains(h, "class='s b-debt'") {
		t.Error("statusboard: expected DEBT cell mapped to b-debt")
	}
	// lowercase status must still map correctly (upper:true in the lookup).
	if !strings.Contains(h, "class='s b-wip'") {
		t.Error("statusboard: expected lowercase 'wip' status mapped to b-wip")
	}
	if !strings.Contains(h, "class='s b-partial'") {
		t.Error("statusboard: expected PARTIAL cell mapped to b-partial")
	}
}
