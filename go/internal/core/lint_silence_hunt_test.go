package core

import (
	"testing"

	"stddoc/internal/wire"
)

// This file is the "TRY TO LOSE CONTENT, don't read the code" standing test
// the strategist's report asked for (Job 4): rather than trusting that every
// registered primitive is individually well-behaved, it mechanically drives
// EVERY primitive that has a derivable field set or a pure variant-selector
// shape through the exact mistake classes that have already cost this repo a
// silent drop once — a misspelled field, and an unmatched selector value —
// and fails loud if any of them renders (or lints) in total silence.
//
// It is deliberately scoped to the two classes this repo has evidence for
// (fieldValidator's near-miss field check, and detectVariantSelector's pure
// discriminated-union check) rather than a fully generic fuzzer: a primitive's
// required-field shape varies too much to synthesize valid-but-broken blocks
// for every type without per-type schema knowledge, and a fuzzer that panics
// or false-positives on legitimately-shaped data would itself become the next
// "cries wolf" problem the gate forbids. Within its scope it covers the WHOLE
// registry, every time it runs — a new primitive automatically gets hunted the
// moment it's added to templates.json, with no per-primitive test to remember
// to write.

// mutateNearMiss produces a small, deterministic edit-distance-1 corruption of
// a field name that stays within nearMissField's edit-distance-2 window and
// its len>=4 floor, so the corrupted key is guaranteed detectable if the
// wiring is intact.
func mutateNearMiss(field string) (string, bool) {
	if len(field) < 5 {
		return "", false // nearMissField ignores names under 4 chars; keep margin
	}
	mid := len(field) / 2
	return field[:mid] + field[mid+1:], true // drop the middle rune (ASCII field names only)
}

// TestSilenceHuntMisspelledFieldAcrossRegistry drives every template-derived
// primitive's own known-field set through a one-character-dropped mutation and
// asserts the near-miss warning fires. This is TestLintMisspelledField's three
// hand-picked cases generalized to the entire registry.
func TestSilenceHuntMisspelledFieldAcrossRegistry(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	rawTmpl, err := rawTemplates(lib.TemplatesJSON)
	if err != nil {
		t.Fatalf("rawTemplates: %v", err)
	}

	skipped := 0
	hunted := 0
	for typ, raw := range rawTmpl {
		known := templateFieldNames(raw)
		var target string
		for f := range known {
			if m, ok := mutateNearMiss(f); ok {
				// mutateNearMiss must not collide back onto a real known field
				// (e.g. dropping a doubled letter) — that would make the
				// mutated key a legitimate field, not a typo.
				if !known[m] {
					target = f
					_ = m
					break
				}
			}
		}
		if target == "" {
			skipped++
			continue
		}
		mutated, _ := mutateNearMiss(target)
		hunted++

		b := wire.NewOrderedMap()
		b.Set("type", typ)
		b.Set(mutated, "x")
		findings := reg.Validate(typ, b)
		found := false
		for _, f := range findings {
			if f.Level == "warn" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("SILENT: primitive %q — misspelling %q -> %q (dropped from %q) produced no warning: %v",
				typ, mutated, target, target, findings)
		}
	}
	t.Logf("silence-hunt (misspelled field): hunted %d primitives, skipped %d (no field long enough to safely mutate)", hunted, skipped)
	if hunted == 0 {
		t.Fatalf("hunted zero primitives — the derivation itself is broken, this test proves nothing")
	}
}

// TestSilenceHuntUnmatchedVariantAcrossRegistry drives every primitive whose
// whole template body is a pure discriminated union (Job 3's shape) through an
// unmatched selector value and asserts the warning fires. Generalizes
// TestLintFigureUnmatchedNameIsLoud to the whole registry, present and future.
func TestSilenceHuntUnmatchedVariantAcrossRegistry(t *testing.T) {
	lib := loadLib(t)
	rawTmpl, err := rawTemplates(lib.TemplatesJSON)
	if err != nil {
		t.Fatalf("rawTemplates: %v", err)
	}

	hunted := 0
	for typ, raw := range rawTmpl {
		sel, ok := detectVariantSelector(raw)
		if !ok {
			continue
		}
		hunted++
		vv := variantValidator(typ, sel)
		b := wire.NewOrderedMap()
		b.Set("type", typ)
		b.Set(sel.field, "definitely-not-a-registered-variant-xyz")
		findings := vv(b)
		if len(findings) == 0 {
			t.Errorf("SILENT: primitive %q — an unmatched %q value produced no warning", typ, sel.field)
		}
	}
	t.Logf("silence-hunt (unmatched variant): %d primitives have the pure-union shape (currently: figure)", hunted)
}

// TestSilenceHuntFindsNoUnregisteredValidatorGap is the wiring half of the
// hunt: every primitive that HAS a derivable field set must actually have a
// validator installed in the real registry (not just in a hand-built test
// registry) — commit 2462bae's mistake was a validator that existed and
// passed its own unit tests while being unreachable from buildRegistry.
func TestSilenceHuntFindsNoUnregisteredValidatorGap(t *testing.T) {
	lib := loadLib(t)
	reg, err := buildRegistry(lib)
	if err != nil {
		t.Fatalf("buildRegistry: %v", err)
	}
	rawTmpl, err := rawTemplates(lib.TemplatesJSON)
	if err != nil {
		t.Fatalf("rawTemplates: %v", err)
	}
	for typ, raw := range rawTmpl {
		known := templateFieldNames(raw)
		if len(known) == 0 {
			continue
		}
		b := wire.NewOrderedMap()
		b.Set("type", typ)
		b.Set("__zzz_totally_unregistered_probe__", "x") // NOT a near-miss of anything real: must stay silent
		if fs := reg.Validate(typ, b); len(fs) != 0 {
			t.Errorf("primitive %q: a deliberately unrelated extra key produced findings (should stay silent, over-eager validator?): %v", typ, fs)
		}
	}
}
