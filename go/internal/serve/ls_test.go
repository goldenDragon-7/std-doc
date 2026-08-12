package serve

import "testing"

func TestAgo(t *testing.T) {
	const now = 1_000_000
	cases := []struct {
		ts   int64
		want string
	}{
		{0, "?"},
		{now, "just now"},
		{now - 3, "just now"},
		{now - 30, "30s ago"},
		{now - 120, "2m ago"},
		{now - 3600, "60m ago"},
		{now - 3*3600, "3h ago"},
		{now - 3*86400, "3d ago"},
	}
	for _, c := range cases {
		if got := ago(c.ts, now); got != c.want {
			t.Errorf("ago(%d, %d) = %q, want %q", c.ts, now, got, c.want)
		}
	}
}
