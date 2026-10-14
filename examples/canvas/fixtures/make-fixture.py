#!/usr/bin/env python3
"""Build the bound-text canvas fixture.

THE BUG THIS GUARDS (measured 2026-10-13, real Chrome via browse-as-me):
on Excalidraw 0.17.6, **container-bound text renders in serif fallback** even
though the font is fully loaded and resolvable. Free-standing text in the SAME
fontFamily, in the SAME scene, renders correctly in the hand-drawn face.
0.18.1 (PR #9) renders both correctly.

So the discriminator is BOUND vs FREE *within one scene*, not font
availability. Document-level font checks cannot see this bug at all: on both
builds `document.fonts` reports Virgil/Cascadia loaded and their advance widths
differ from serif. See README.md for the probes that cannot fail.

FONT CODES — the trap that produced a false diagnosis once already.
Excalidraw's enum is: 1=Virgil (hand-drawn), 2=Helvetica, 3=Cascadia,
5=Excalifont, 6=Nunito. 0.18 RENAMED the hand-drawn family Virgil -> Excalifont,
and codes 5/6 DO NOT EXIST in 0.17.6. An earlier version of this file mapped
{"Virgil": 6} -- which is Nunito -- so 15 of 27 labels asked 0.17.6 for fonts it
never shipped and painted serif for a reason that had nothing to do with the
bug. Only use families present in BOTH builds for cross-version comparison.
"""
import json, sys

# Families that exist in BOTH 0.17.6 and 0.18.x, so a RED/GREEN comparison is
# about rendering and never about a missing family.
FONT = {"Virgil": 1, "Helvetica": 2, "Cascadia": 3}
SHAPES = ["rectangle", "ellipse", "diamond"]

els = []
n = 0
COLS = 4
for fam_name, fam_id in FONT.items():
    for shape_i, shape in enumerate(SHAPES):
        for rep in range(2):           # 2 per (font, shape) = 18 bound pairs
            n += 1
            col, row = (n - 1) % COLS, (n - 1) // COLS
            x, y = 60 + col * 260, 60 + row * 160
            cid, tid = f"cont{n}", f"text{n}"
            els.append({
                "id": cid, "type": shape, "x": x, "y": y,
                "width": 220, "height": 110, "angle": 0,
                "strokeColor": "#1e88e5", "backgroundColor": "transparent",
                "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
                "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None,
                "roundness": {"type": 3} if shape == "rectangle" else None,
                "seed": 1000 + n, "version": 1, "versionNonce": 1000 + n,
                "isDeleted": False,
                "boundElements": [{"id": tid, "type": "text"}],
                "updated": 1, "link": None, "locked": False,
            })
            els.append({
                "id": tid, "type": "text", "x": x + 12, "y": y + 40,
                "width": 196, "height": 25, "angle": 0,
                "strokeColor": "#e0e0e0", "backgroundColor": "transparent",
                "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
                "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None,
                "roundness": None, "seed": 2000 + n, "version": 1,
                "versionNonce": 2000 + n, "isDeleted": False,
                "boundElements": None, "updated": 1, "link": None,
                "locked": False,
                "text": f"{fam_name} {shape} #{rep+1}",
                "originalText": f"{fam_name} {shape} #{rep+1}",
                "fontSize": 20, "fontFamily": fam_id,
                "textAlign": "center", "verticalAlign": "middle",
                "containerId": cid, "lineHeight": 1.25, "baseline": 18,
            })

# FREE-STANDING controls, one per family, in the SAME families as the bound
# text above. This pairing is the whole probe: on a build with the bug, the
# free control renders hand-drawn while its bound twin renders serif. A free
# control in a family no bound text uses would prove nothing.
for i, (fam_name, fam_id) in enumerate(FONT.items()):
    els.append({
        "id": f"free{i}", "type": "text", "x": 60, "y": 1000 + i * 50,
        "width": 300, "height": 25, "angle": 0, "strokeColor": "#9ccc65",
        "backgroundColor": "transparent", "fillStyle": "solid",
        "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1,
        "opacity": 100, "groupIds": [], "frameId": None, "roundness": None,
        "seed": 3000 + i, "version": 1, "versionNonce": 3000 + i,
        "isDeleted": False, "boundElements": None, "updated": 1,
        "link": None, "locked": False,
        "text": f"FREE control {fam_name}",
        "originalText": f"FREE control {fam_name}",
        "fontSize": 20, "fontFamily": fam_id, "textAlign": "left",
        "verticalAlign": "top", "containerId": None,
        "lineHeight": 1.25, "baseline": 18,
    })

scene = {
    "type": "excalidraw", "version": 2, "source": "codraw-studio-fixture",
    "elements": els, "files": {},
    "appState": {"theme": "dark", "viewBackgroundColor": "#ffffff"},
    "_rev": 1, "_author": "fixture",
}
out = sys.argv[1]
with open(out, "w") as f:
    json.dump(scene, f, indent=1)

bound = [e for e in els if e.get("type") == "text" and e.get("containerId")]
free = [e for e in els if e.get("type") == "text" and not e.get("containerId")]
print(f"wrote {out}")
print(f"  container-bound text: {len(bound)}   <-- renders SERIF on the buggy build")
print(f"  free-standing text:   {len(free)}   <-- control, renders correctly on BOTH")
print(f"  families: {FONT}  (all present in 0.17.6 AND 0.18.x)")
print(f"  total elements:       {len(els)}")
