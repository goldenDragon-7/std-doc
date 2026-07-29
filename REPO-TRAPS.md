# Repo traps

Short, hard-won notes about working *in* this repository. Read before you reach for git.

---

## The worktree that holds `main` silently detaches your root checkout

**Symptom.** You open `~/workspace/std-doc`, run `git log --oneline`, and see a tiny handful of commits — a project that looks like day one. `git status` says `HEAD detached at <sha>`. Everything you know about the project appears to be missing.

**Cause.** Two of our rules collide. Canon says *the live tree is always on `main`*, and canon also says *build in a worktree*. If someone creates a worktree **on `main` itself** (rather than on a branch off main), git will not let a second checkout hold the same branch — so the root checkout is structurally forced off `main` and lands on a detached HEAD. Nobody was careless; the rules did it. It happened here on 2026-07-29, and the root sat 137 commits behind for weeks.

**Before you move anything, find out whether that detached HEAD is disposable or nearly-lost work:**

```bash
git branch -a --contains <sha>      # is it reachable from main / any branch?
git log --oneline main..<sha>       # EMPTY = zero unique commits = disposable
```

If `main..<sha>` is empty, the commit is an ancestor of `main` and nothing is at risk. If it prints anything, those commits exist **only** there and are one checkout away from gone — put them on a named branch and push it *before* you touch HEAD.

**Fix.** Find the worktree holding `main` (`git worktree list`), preserve its untracked files somewhere durable (build output and handoffs are not in git), remove it, then `git switch main` in the root. Untracked files that `main` tracks will block the switch and git will name them — move them aside rather than deleting blind.

**Prevention.** Never point a worktree at `main`. Worktrees get their own `citizen/*` branch; the root keeps `main`.

---

## `go test ./...` is green only where `npm install` has been run

The live-Flint bake capability test (`TestCapability_DiagramFlintLiveBakeRendersFromSpec`) shells out to Node and needs `go/stddoc-lib/flint/bake/node_modules`, which is **untracked**. On a fresh clone it fails with `flint bake fail`. Run `npm install` in that directory first.

This means "green" is currently a property of the machine, not of the repository. Known and flagged — the fix (skip-with-reason vs. install-in-build) touches the zero-dependency story, so it is a deliberate design call, not a quiet patch.

*Note: the Slice-0 embed path — name a chart, get the pre-baked catalog SVG — needs no Node at all. Only baking a chart **from a spec** does.*
