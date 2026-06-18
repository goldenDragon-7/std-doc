// Package wire is the byte-level rendering layer: the rules where two
// implementations could plausibly disagree by a byte. It is the honest first
// brick of the Go port — escape ordering, Python str() parity, insertion-order
// maps, and the trailing-newline policy. Contract: protocol/wire-spec.md.
package wire

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// PyStr reproduces Python's str() for the scalar kinds that reach the renderer
// (wire-spec §2). It is what esc() stringifies with before HTML-escaping.
//
//	nil      -> ""           (esc treats None as the empty string)
//	bool     -> "True"/"False"  (capitalized — Python str(bool))
//	int      -> "5"
//	float    -> "1.0"        (repr-shortest, integral floats keep ".0")
//	string   -> unchanged
//
// JSON numbers arrive as json.Number (the decoder runs with UseNumber so the
// int/float distinction Python preserves is not flattened to float64).
func PyStr(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "True"
		}
		return "False"
	case json.Number:
		return pyNumStr(string(x))
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return pyFloatStr(x)
	default:
		// Maps/slices should never reach esc directly; fall back conservatively.
		return ""
	}
}

// pyNumStr renders a JSON number literal the way Python would after json.load
// then str(): an integer literal stays an int, a fractional/exponential literal
// becomes a float and is formatted repr-shortest.
func pyNumStr(lit string) string {
	if !strings.ContainsAny(lit, ".eE") {
		// Integer literal. JSON ints are already canonical; normalize "-0".
		if n, err := strconv.ParseInt(lit, 10, 64); err == nil {
			return strconv.FormatInt(n, 10)
		}
		// Out of int64 range: Python has bigints; emit the literal verbatim.
		return strings.TrimPrefix(lit, "+")
	}
	f, err := strconv.ParseFloat(lit, 64)
	if err != nil {
		return lit
	}
	return pyFloatStr(f)
}

// pyFloatStr matches Python's str(float) / repr(float): shortest round-trip,
// integral values keep a ".0", and the exponent form uses Python's e+NN / e-NN
// with a sign and at least two exponent digits.
func pyFloatStr(f float64) string {
	switch {
	case math.IsNaN(f):
		return "nan"
	case math.IsInf(f, 1):
		return "inf"
	case math.IsInf(f, -1):
		return "-inf"
	}
	// Go's 'g' with precision -1 is shortest round-trip, the same target as
	// Python's repr. The two differ only in surface form, normalized below.
	s := strconv.FormatFloat(f, 'g', -1, 64)
	if i := strings.IndexAny(s, "eE"); i >= 0 {
		return normalizeExp(s, i)
	}
	if !strings.Contains(s, ".") {
		// Integral magnitude in fixed form: Python writes "1.0", not "1".
		return s + ".0"
	}
	return s
}

// normalizeExp rewrites Go's exponent form (e.g. "1e+09", "1.5e-07") into
// Python's: a lower-case 'e', an explicit sign, and a minimum of two exponent
// digits — and ensures the mantissa carries a decimal point as Python does.
func normalizeExp(s string, e int) string {
	mant, exp := s[:e], s[e+1:]
	sign := "+"
	if exp != "" && (exp[0] == '+' || exp[0] == '-') {
		if exp[0] == '-' {
			sign = "-"
		}
		exp = exp[1:]
	}
	for len(exp) < 2 {
		exp = "0" + exp
	}
	if !strings.Contains(mant, ".") {
		mant += ".0"
	}
	return mant + "e" + sign + exp
}
