package wire

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// OrderedMap is an insertion-order-preserving JSON object. Go's encoding/json
// decodes objects into map[string]any (hash order) and Marshal sorts keys —
// either would silently reorder palette :root declarations, each_pairs loops,
// badges and facets, diverging from the Python engine which iterates
// dict.items() in document order (wire-spec §3). ALL source data is parsed
// through this type; a bare map[string]any is never used for source.
type OrderedMap struct {
	keys   []string
	values map[string]any
}

// NewOrderedMap returns an empty, ready-to-use OrderedMap.
func NewOrderedMap() *OrderedMap {
	return &OrderedMap{values: map[string]any{}}
}

// Keys returns the keys in insertion order. The slice is owned by the map; do
// not mutate it.
func (m *OrderedMap) Keys() []string { return m.keys }

// Len reports the number of keys.
func (m *OrderedMap) Len() int { return len(m.keys) }

// Get returns the value for key and whether it was present.
func (m *OrderedMap) Get(key string) (any, bool) {
	v, ok := m.values[key]
	return v, ok
}

// GetOr returns the value for key, or def if absent.
func (m *OrderedMap) GetOr(key string, def any) any {
	if v, ok := m.values[key]; ok {
		return v
	}
	return def
}

// Set inserts or updates key, preserving first-insertion position on update.
func (m *OrderedMap) Set(key string, val any) {
	if m.values == nil {
		m.values = map[string]any{}
	}
	if _, ok := m.values[key]; !ok {
		m.keys = append(m.keys, key)
	}
	m.values[key] = val
}

// UnmarshalJSON decodes a JSON object token-by-token so key order is captured
// as the document presents it. Numbers are kept as json.Number (UseNumber) so
// the int/float distinction Python preserves survives to PyStr.
func (m *OrderedMap) UnmarshalJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	if d, ok := tok.(json.Delim); !ok || d != '{' {
		return fmt.Errorf("wire: OrderedMap expects a JSON object, got %v", tok)
	}
	return m.decodeObject(dec)
}

func (m *OrderedMap) decodeObject(dec *json.Decoder) error {
	m.values = map[string]any{}
	m.keys = nil
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return err
		}
		key, ok := keyTok.(string)
		if !ok {
			return fmt.Errorf("wire: object key is not a string: %v", keyTok)
		}
		val, err := decodeValue(dec)
		if err != nil {
			return err
		}
		m.Set(key, val)
	}
	// Consume the closing '}'.
	if _, err := dec.Token(); err != nil {
		return err
	}
	return nil
}

// decodeValue reads one JSON value, recursing into objects (as *OrderedMap) and
// arrays (as []any) so order is preserved at every depth.
func decodeValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	if d, ok := tok.(json.Delim); ok {
		switch d {
		case '{':
			child := NewOrderedMap()
			if err := child.decodeObject(dec); err != nil {
				return nil, err
			}
			return child, nil
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			if _, err := dec.Token(); err != nil { // closing ']'
				return nil, err
			}
			return arr, nil
		}
	}
	// Scalar: string, bool, nil, or json.Number (UseNumber is set on dec).
	return tok, nil
}

// ParseOrderedJSON decodes a JSON document whose top level is an object.
func ParseOrderedJSON(data []byte) (*OrderedMap, error) {
	m := NewOrderedMap()
	if err := m.UnmarshalJSON(data); err != nil {
		return nil, err
	}
	return m, nil
}
