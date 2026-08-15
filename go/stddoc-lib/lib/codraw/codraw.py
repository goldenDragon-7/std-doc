#!/usr/bin/env python3
"""codraw — author Excalidraw diagrams as code for the Co-Draw Studio.

A tiny builder that emits native `.excalidraw` scene JSON. Arrows are *bound* to
their boxes, so when the human drags a box in the browser the arrows follow.

    from codraw import Board
    b = Board()
    lane = b.lane("D1 · Skeleton", 60, 150, 400, 700, color=Board.BLUE)
    a = b.box("SUBJECT\\n{A}·{B}", 110, 240, 300, 90)
    c = b.box("EVALUATE", 560, 300, 300, 90, bg=Board.PROC)
    b.arrow(a, c, label="AIMS")
    b.note(520, 850, "the caption")
    b.save("scene.json")          # writes + bumps _rev so the browser pulls it

Read the human's live edits back:
    scene = Board.load("scene.json")     # dict; scene["elements"] is the canvas
"""
import json, os, random, time

_rng = random.Random(1)
def _nonce(): return _rng.randint(1, 2**31)
def _now(): return int(time.time() * 1000)


class Board:
    # palette
    BLUE  = "#dbe7ff"
    GREEN = "#d9f5e0"
    PROC  = "#fff3c4"   # process / step
    GOLD  = "#ffd873"   # terminal / emphasis
    WHITE = "#ffffff"
    PINK  = "#ffd6e7"
    GREY  = "#eceff4"

    def __init__(self):
        self.elements = []
        self._auto = 0

    def _id(self, prefix):
        self._auto += 1
        return f"{prefix}_{self._auto}_{_nonce()}"

    # ---- shapes ----
    def box(self, text="", x=0, y=0, w=200, h=80, *, bg=WHITE, stroke="#1e1e1e",
            sw=2, size=16, id=None, ellipse=False):
        """A rectangle (or ellipse) with a centered, auto-following label. Returns its id."""
        bid = id or self._id("box")
        e = {"type": "ellipse" if ellipse else "rectangle", "id": bid,
             "x": x, "y": y, "width": w, "height": h, "angle": 0,
             "strokeColor": stroke, "backgroundColor": bg, "fillStyle": "solid",
             "strokeWidth": sw, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
             "groupIds": [], "frameId": None,
             "roundness": None if ellipse else {"type": 3},
             "seed": _nonce(), "versionNonce": _nonce(), "version": 1,
             "isDeleted": False, "boundElements": [], "updated": _now(),
             "link": None, "locked": False}
        self.elements.append(e)
        if text:
            self._label(bid, e, text, size)
        return bid

    def lane(self, title="", x=0, y=0, w=400, h=600, *, color=BLUE, size=16):
        """A big background group box with a title in the top-left. Returns its id."""
        lid = self.box("", x, y, w, h, bg=color, stroke="#b8b8d8", sw=1)
        if title:
            self.note(x + 20, y + 14, title, size=size, color="#2a2a4a", w=w - 40)
        return lid

    def _label(self, cid, cont, text, size):
        nlines = text.count("\n") + 1
        th = size * 1.25 * nlines
        tid = cid + "_t"
        self.elements.append({
            "type": "text", "id": tid, "x": cont["x"] + 10,
            "y": cont["y"] + cont["height"] / 2 - th / 2, "width": cont["width"] - 20,
            "height": th, "angle": 0, "strokeColor": "#1e1e1e",
            "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2,
            "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [],
            "frameId": None, "roundness": None, "seed": _nonce(),
            "versionNonce": _nonce(), "version": 1, "isDeleted": False,
            "boundElements": [], "updated": _now(), "link": None, "locked": False,
            "fontSize": size, "fontFamily": 1, "text": text, "textAlign": "center",
            "verticalAlign": "middle", "containerId": cid, "originalText": text,
            "lineHeight": 1.25})
        cont["boundElements"].append({"type": "text", "id": tid})

    def note(self, x, y, text, *, size=14, color="#4a4a6a", w=260, align="left"):
        """Free-standing text (captions, arrow labels, aphorisms). Returns its id."""
        nid = self._id("note")
        self.elements.append({
            "type": "text", "id": nid, "x": x, "y": y, "width": w,
            "height": size * 1.25 * (text.count("\n") + 1), "angle": 0,
            "strokeColor": color, "backgroundColor": "transparent", "fillStyle": "solid",
            "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
            "groupIds": [], "frameId": None, "roundness": None, "seed": _nonce(),
            "versionNonce": _nonce(), "version": 1, "isDeleted": False,
            "boundElements": [], "updated": _now(), "link": None, "locked": False,
            "fontSize": size, "fontFamily": 1, "text": text, "textAlign": align,
            "verticalAlign": "top", "containerId": None, "originalText": text,
            "lineHeight": 1.25})
        return nid

    def _by_id(self, i):
        for e in self.elements:
            if e["id"] == i:
                return e
        raise KeyError(i)

    def arrow(self, a_id, b_id, *, label=None, dashed=False, both=False):
        """Bound arrow between two box ids. label = optional free text at midpoint."""
        A, B = self._by_id(a_id), self._by_id(b_id)
        ax, ay = A["x"] + A["width"] / 2, A["y"] + A["height"] / 2
        bx, by = B["x"] + B["width"] / 2, B["y"] + B["height"] / 2
        aid = self._id("arrow")
        self.elements.append({
            "type": "arrow", "id": aid, "x": ax, "y": ay, "width": bx - ax,
            "height": by - ay, "angle": 0, "strokeColor": "#1e1e1e",
            "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 2,
            "strokeStyle": "dashed" if dashed else "solid", "roughness": 1,
            "opacity": 100, "groupIds": [], "frameId": None, "roundness": {"type": 2},
            "seed": _nonce(), "versionNonce": _nonce(), "version": 1,
            "isDeleted": False, "boundElements": [], "updated": _now(), "link": None,
            "locked": False, "points": [[0, 0], [bx - ax, by - ay]],
            "lastCommittedPoint": None,
            "startBinding": {"elementId": a_id, "focus": 0, "gap": 4},
            "endBinding": {"elementId": b_id, "focus": 0, "gap": 4},
            "startArrowhead": "arrow" if both else None, "endArrowhead": "arrow"})
        A["boundElements"].append({"type": "arrow", "id": aid})
        B["boundElements"].append({"type": "arrow", "id": aid})
        if label:
            self.note((ax + bx) / 2 - 30, (ay + by) / 2 - 8, label, size=12,
                      color="#4a4a6a", w=120)
        return aid

    # ---- io ----
    def scene(self, author="agent"):
        return {"type": "excalidraw", "version": 2, "source": "codraw-studio",
                "elements": self.elements,
                # drawing surfaces default to DARK (std-doc techno-dark soul)
                "appState": {"theme": "dark", "viewBackgroundColor": "#ffffff", "gridSize": None},
                "files": {}, "_rev": 1, "_author": author}

    def save(self, path="scene.json", author="agent"):
        """Write scene, bumping _rev above any existing file so the browser pulls it."""
        old = 0
        if os.path.exists(path):
            try:
                old = int(json.load(open(path)).get("_rev", 0))
            except Exception:
                old = 0
        s = self.scene(author)
        s["_rev"] = old + 1
        tmp = path + ".tmp"
        json.dump(s, open(tmp, "w"), indent=2)
        os.replace(tmp, path)
        print(f"saved {path}: {len(self.elements)} elements, rev {s['_rev']}")
        return s["_rev"]

    @staticmethod
    def load(path="scene.json"):
        """Read the current canvas (including the human's live edits)."""
        return json.load(open(path))


if __name__ == "__main__":
    b = Board()
    b.lane("Demo", 40, 40, 520, 260, color=Board.BLUE)
    a = b.box("START", 90, 120, 160, 70, bg=Board.PROC)
    c = b.box("FINISH", 360, 120, 160, 70, bg=Board.GOLD)
    b.arrow(a, c, label="do the thing")
    b.note(90, 250, "codraw demo — edit me in the browser")
    b.save("scene.json")
