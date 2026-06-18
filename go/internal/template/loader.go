package template

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// DecodeNodes decodes a JSON document (template tree or test data) into the Go
// shape the interpreter walks: objects -> map[string]any, arrays -> []any,
// numbers -> json.Number (UseNumber, so int/float survives), strings/bools/nil
// as themselves. Template structure is order-independent, so a plain map is fine
// here — source DATA still uses *wire.OrderedMap (parsed separately).
func DecodeNodes(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}

// LoadTemplates decodes a templates.json document into a map of type -> node
// list (each value is a []any template body).
func LoadTemplates(data []byte) (map[string][]any, error) {
	v, err := DecodeNodes(data)
	if err != nil {
		return nil, err
	}
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("template: templates.json must be a JSON object")
	}
	out := make(map[string][]any, len(obj))
	for k, val := range obj {
		body, ok := val.([]any)
		if !ok {
			return nil, fmt.Errorf("template: template %q is not a list of nodes", k)
		}
		out[k] = body
	}
	return out, nil
}
