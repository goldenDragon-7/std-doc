package core

import "testing"

// TestMermaidFix is the golden test for the three dark-theme transforms ported
// from engine/scripts/mermaid_fix.py (the Python port dropped them). Each
// transform otherwise produces the silent mermaid "bomb icon".
func TestMermaidFix(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "strip emoji from subgraph quoted label",
			in:   `subgraph s1["🎉 Launch 🚀"]`,
			want: `subgraph s1["Launch"]`,
		},
		{
			name: "leave regular node labels alone",
			in:   `A["🎉 keep me"]`,
			want: `A["🎉 keep me"]`,
		},
		{
			name: "flatten literal backslash-n in pipe edge label",
			in:   `A -->|first\nsecond| B`,
			want: `A -->|first second| B`,
		},
		{
			name: "convert light classDef green to dark",
			in:   `classDef pass fill:#d4edda,stroke:#28a745,color:#155724`,
			want: `classDef pass fill:#14532d,stroke:#4ade80,color:#bbf7d0`,
		},
		{
			name: "convert light classDef with font-weight bold",
			in:   `classDef pass fill:#d4edda,stroke:#28a745,color:#155724,font-weight:bold`,
			want: `classDef pass fill:#14532d,stroke:#4ade80,color:#bbf7d0,font-weight:bold`,
		},
		{
			name: "all six classDef colors",
			in: `classDef a fill:#f8d7da,stroke:#dc3545,color:#721c24
classDef b fill:#fff3cd,stroke:#ffc107,color:#856404
classDef c fill:#cce5ff,stroke:#004085,color:#004085
classDef d fill:#e2e3e5,stroke:#6c757d,color:#383d41
classDef e fill:#d1ecf1,stroke:#0c5460,color:#0c5460`,
			want: `classDef a fill:#7f1d1d,stroke:#f87171,color:#fee2e2
classDef b fill:#78350f,stroke:#fbbf24,color:#fef3c7
classDef c fill:#1e3a5f,stroke:#60a5fa,color:#dbeafe
classDef d fill:#1e293b,stroke:#94a3b8,color:#e2e8f0
classDef e fill:#164e63,stroke:#22d3ee,color:#cffafe`,
		},
		{
			name: "all three transforms together",
			in: `flowchart TD
subgraph g1["💡 Ideas 🎯"]
  A -->|do\nthing| B
end
classDef ok fill:#d4edda,stroke:#28a745,color:#155724`,
			want: `flowchart TD
subgraph g1["Ideas"]
  A -->|do thing| B
end
classDef ok fill:#14532d,stroke:#4ade80,color:#bbf7d0`,
		},
		{
			name: "idempotent",
			in:   `subgraph g1["Ideas"]` + "\n" + `A -->|do thing| B`,
			want: `subgraph g1["Ideas"]` + "\n" + `A -->|do thing| B`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mermaidFix(tc.in)
			if got != tc.want {
				t.Errorf("mermaidFix mismatch\n in:   %q\n got:  %q\n want: %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestMermaidFixIdempotent verifies running twice is a no-op (Python contract).
func TestMermaidFixIdempotent(t *testing.T) {
	in := `subgraph g1["💡 Ideas 🎯"]
  A -->|do\nthing| B
classDef ok fill:#d4edda,stroke:#28a745,color:#155724`
	once := mermaidFix(in)
	twice := mermaidFix(once)
	if once != twice {
		t.Errorf("not idempotent:\n once:  %q\n twice: %q", once, twice)
	}
}
