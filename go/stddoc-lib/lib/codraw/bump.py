#!/usr/bin/env python3
"""After the agent edits scene.json, run this so the human's browser picks it up:
   python3 bump.py            # bump _rev, author=agent
It increments _rev above the current value and stamps author so the poll fires.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SCENE = os.path.join(HERE, "scene.json")
with open(SCENE) as f:
    s = json.load(f)
s["_rev"] = int(s.get("_rev", 0)) + 1
s["_author"] = "agent"
tmp = SCENE + ".tmp"
with open(tmp, "w") as f:
    json.dump(s, f, indent=2)
os.replace(tmp, SCENE)
print(f"bumped to rev {s['_rev']} (author agent)")
