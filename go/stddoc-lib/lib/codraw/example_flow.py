#!/usr/bin/env python3
"""Runnable codraw example: a small generative-workflow diagram.
    python3 example_flow.py        # writes scene.json for the running studio
"""
from codraw import Board

b = Board()
b.lane("INPUT", 60, 120, 320, 320, color=Board.BLUE)
b.lane("OUTPUT", 900, 120, 320, 320, color=Board.GREEN)

spec = b.box("SPEC\n(the skeleton)", 110, 200, 220, 90)
loop = b.box("FOR EACH step", 480, 170, 260, 70, bg=Board.PROC)
work = b.box("EVALUATE\n(pull richness)", 480, 290, 260, 90, bg=Board.PROC)
out = b.box("RESULT", 950, 210, 220, 90, bg=Board.GOLD, size=22)

b.arrow(spec, loop, label="indices")
b.arrow(loop, work)
b.arrow(work, loop, label="advance ⟲", dashed=True)
b.arrow(work, out, label="⊕ fold")
b.note(120, 470, "Edit any box in the browser — codraw sees your changes on load.",
       size=14, w=700)

b.save("scene.json")
