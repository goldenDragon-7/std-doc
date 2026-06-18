# The Method — Write by Descent

*How to write a proposal that proves itself.*

---

## The trap to avoid

The natural way to write a proposal is **bottom-up**: "here's what we have,
here's what we could add, here's the roadmap." It reads like a wish-list, and the
reader has to take the whole thing on faith — they can't *see* why each piece is
needed.

## The move: start from what they SEE, and unwind

Write it **top-down by dependency**. Begin with the single artifact the reader
will look at — the screen, the list, the one line that matters. Then ask, at
every layer:

> *For this to exist, what must be true the layer below?*

Keep asking until you hit **ground you already stand on today.** Now flip it: the
forward build order is just that chain reversed.

The endpoint is not the last feature. **It is the forcing function.** Every layer
beneath it is *conscripted* by the line above. This is the trick: you don't
*argue* for the prerequisites — the top line *demands* them, visibly, and the
reader watches the demand cascade. The proof of the proposal is the unwind itself.

### Worked shape

```
Layer 0   The endpoint — the one artifact the reader looks at
   ↑ cannot render that line without
Layer −1  an assembler + an item schema
   ↑ cannot shape the item without
Layer −2  the routing grammar + the core contract   [net-new]
   ↑ cannot run the grammar without
Layer −3  the classifiers / extractors it depends on  [net-new]
   ↑ cannot classify without
Layer −4  a unified pool + normalization   [the gotcha]
   ↑ cannot pool without
Layer −5  HERE — the substrate you already have today   [we stand here]
```

You literally cannot draw the top line without the contract at Layer −2 existing.
That sentence *conscripts* the whole stack. That is the method working.

---

## The seven beats of the doc

Use these in order. The skeleton (`../style/skeleton.html`) has a block for each.

1. **The one-sentence ask.** Concrete, human, what-they-get. Not "a system."
2. **The method box.** State that the endpoint is the forcing function. (Yes,
   tell them the trick — it makes the rest legible.)
3. **Layer 0 — render the endpoint.** Mock the actual artifact, in colour. Then
   list its *hard properties*, because **each property secretly names a
   prerequisite.** ("never padded" → you need a gate. "a deadline on every line"
   → you need deadline extraction.)
4. **The descent.** The vertical stack, each layer separated by `↑ cannot … without`.
   Tag every layer `net-new` or `reuse`. Light the bottom layer green: *HERE*.
5. **The diagrams.** One per load-bearing idea (six idioms; see `../style/styleguide.md`).
   The best ones make an argument *by shape*: a root-cause in two columns, the
   **missing axis** as a spectrum, **the heart** as a decision matrix (read the
   corners, not the cells), the axes you have vs the one you don't, the
   **pipeline with teeth** as a seam.
6. **Fold it forward.** The same chain as a build table — Phase 0…N. Call out
   which phases are *reuse* (you'd be amazed how much already exists) and which is
   the **honest first brick** (often NOT where the brief said to start).
7. **The calls.** End on the 1–3 decisions that are genuinely the reader's to
   make. These become the **interactive questions** the page invites them to
   answer in place. Mark them `◀ YOUR CALL`. Commit your own lean first, then
   invite the override.

---

## Three honesty rules (MEASURED > CLAIMED)

- **Separate `net-new` from `reuse` ruthlessly.** The reader's trust comes from
  seeing you *not* rebuild what exists. Naming the part that already runs earns
  more credibility than any new feature would.
- **Name the gotcha out loud.** Every real design has one unglamorous landmine.
  Put it in the descent as its own layer. Hiding it reads as not having found it.
- **Mark the arguable cells.** In the decision matrix, flag the verdicts you're
  least sure of (a small `✎`). It tells the reader *exactly* where their judgment
  is needed — and it is the perfect target for the interactive layer.

---

## Why this pairs with interactivity

A descent doc ends in calls and arguable cells — i.e. it ends in **questions
that already have a home in the document.** That is why the writing method and the
interactive loop fit like puzzle pieces: the method produces the questions; the
loop lets the reader answer them *in place*. Don't write the doc and then bolt on
feedback. Write the doc so its open decisions are sitting there waiting to be
clicked.
