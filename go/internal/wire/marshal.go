package wire

import (
	"encoding/json"
	"fmt"
	"strings"
)

// MarshalCompact serializes a parsed doc-tree the way the Python engine writes a
// rolled snapshot: json.dumps(doc, separators=(",", ":"), ensure_ascii=False).
//
//   - objects (*OrderedMap) keep insertion order — never sorted (wire-spec §3);
//   - no spaces after ':' or ',';
//   - strings are escaped exactly as Python's ensure_ascii=False encoder does:
//     only "\"", "\\", and the C0 control set are escaped (\b \t \n \f \r and
//     \u00xx for the rest); '/' is left bare and non-ASCII is emitted raw UTF-8
//     (Go's stdlib encoder diverges here — it escapes <, >, &, U+2028, U+2029);
//   - numbers are canonicalized like json.loads→json.dumps (an int literal
//     stays an int, a fractional/exponent literal becomes a repr-shortest float)
//     via the same pyNumStr the renderer uses.
//
// The result is the byte-exact artifact roll commits to git.
func MarshalCompact(v any) ([]byte, error) {
	var b strings.Builder
	if err := marshalValue(&b, v); err != nil {
		return nil, err
	}
	return []byte(b.String()), nil
}

func marshalValue(b *strings.Builder, v any) error {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		writeJSONString(b, x)
	case json.Number:
		b.WriteString(pyNumStr(string(x)))
	case *OrderedMap:
		b.WriteByte('{')
		for i, k := range x.keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSONString(b, k)
			b.WriteByte(':')
			if err := marshalValue(b, x.values[k]); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := marshalValue(b, e); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	default:
		return fmt.Errorf("wire: cannot marshal %T (source must parse through ParseOrderedJSON)", v)
	}
	return nil
}

// writeJSONString reproduces Python's json string encoding with
// ensure_ascii=False: escape only the JSON-mandatory set, leave everything
// >= U+0020 (including non-ASCII and '/') as raw bytes.
func writeJSONString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}
