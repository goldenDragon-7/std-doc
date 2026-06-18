package core

import "stddoc/internal/wire"

// buildTree builds the recursive node forest with legal numbering (1, 1.1, …)
// and parent links, supporting unlimited depth and the three input shapes
// (author-nested children, parent-linked, flat groups). Annotates each node in
// place with _number / _parent / children, and caches _roots/_all/_by_slug on
// the doc. Idempotent. Port of publish.build_tree.
func buildTree(doc *wire.OrderedMap) []any {
	if r := get(doc, "_roots"); r != nil {
		return r.([]any)
	}
	nodes := list(doc, "nodes")
	for _, nv := range nodes {
		n, _ := omap(nv)
		if _, ok := n.Get("children"); !ok {
			n.Set("children", []any{})
		}
	}
	bySlug := map[string]*wire.OrderedMap{}
	for _, nv := range nodes {
		n, _ := omap(nv)
		bySlug[str(n, "slug")] = n
	}

	authorNested := false
	for _, nv := range nodes {
		n, _ := omap(nv)
		if len(list(n, "children")) > 0 {
			authorNested = true
			break
		}
	}

	var roots []any
	if authorNested {
		childSlugs := map[string]bool{}
		var collect func(ns []any)
		collect = func(ns []any) {
			for _, nv := range ns {
				n, _ := omap(nv)
				for _, cv := range list(n, "children") {
					c, _ := omap(cv)
					childSlugs[str(c, "slug")] = true
				}
				collect(list(n, "children"))
			}
		}
		collect(nodes)
		for _, nv := range nodes {
			n, _ := omap(nv)
			if !childSlugs[str(n, "slug")] {
				roots = append(roots, n)
			}
		}
	} else {
		var top []any
		for _, nv := range nodes {
			n, _ := omap(nv)
			p := str(n, "parent")
			if p != "" && bySlug[p] != nil && p != str(n, "slug") {
				appendChild(bySlug[p], n)
			} else {
				top = append(top, n)
			}
		}
		used := map[string]bool{}
		for _, nv := range nodes {
			n, _ := omap(nv)
			used[str(n, "slug")] = true
		}
		gnode := func(g string) *wire.OrderedMap {
			sl := slugify(g)
			for used[sl] {
				sl += "-section"
			}
			used[sl] = true
			m := wire.NewOrderedMap()
			m.Set("slug", sl)
			m.Set("title", g)
			m.Set("is_group", true)
			m.Set("tagline", "")
			m.Set("children", []any{})
			return m
		}
		seen := map[string]*wire.OrderedMap{}
		var order []string
		for _, gv := range list(doc, "groups") {
			g, _ := gv.(string)
			seen[g] = gnode(g)
			order = append(order, g)
		}
		for _, nv := range top {
			n, _ := omap(nv)
			g := str(n, "group")
			if _, ok := n.Get("group"); !ok {
				g = "Other"
			}
			if _, ok := seen[g]; !ok {
				seen[g] = gnode(g)
				order = append(order, g)
			}
			appendChild(seen[g], n)
		}
		for _, g := range order {
			roots = append(roots, seen[g])
		}
	}

	numberTree(roots, "")
	parentTree(roots, nil)
	doc.Set("_roots", roots)
	all := walkTree(roots)
	doc.Set("_all", all)
	bySlugAll := wire.NewOrderedMap()
	for _, nv := range all {
		n, _ := omap(nv)
		bySlugAll.Set(str(n, "slug"), n)
	}
	doc.Set("_by_slug", bySlugAll)
	return roots
}

func appendChild(parent, child *wire.OrderedMap) {
	parent.Set("children", append(list(parent, "children"), child))
}

func numberTree(ns []any, prefix string) {
	for i, nv := range ns {
		n, _ := omap(nv)
		num := prefix + itoa(i+1)
		n.Set("_number", num)
		numberTree(list(n, "children"), num+".")
	}
}

func parentTree(ns []any, parent *wire.OrderedMap) {
	for _, nv := range ns {
		n, _ := omap(nv)
		if parent == nil {
			n.Set("_parent", nil)
		} else {
			n.Set("_parent", parent)
		}
		parentTree(list(n, "children"), n)
	}
}

func walkTree(roots []any) []any {
	var out []any
	for _, nv := range roots {
		n, _ := omap(nv)
		out = append(out, n)
		out = append(out, walkTree(list(n, "children"))...)
	}
	return out
}

// ancestors returns nearest-first ancestor nodes (excludes n).
func ancestors(n *wire.OrderedMap) []*wire.OrderedMap {
	var out []*wire.OrderedMap
	p, _ := get(n, "_parent").(*wire.OrderedMap)
	for p != nil {
		out = append(out, p)
		p, _ = get(p, "_parent").(*wire.OrderedMap)
	}
	return out
}

func bySlug(doc *wire.OrderedMap, slug string) *wire.OrderedMap {
	bs, _ := get(doc, "_by_slug").(*wire.OrderedMap)
	if bs == nil {
		return nil
	}
	v, _ := bs.Get(slug)
	m, _ := v.(*wire.OrderedMap)
	return m
}
