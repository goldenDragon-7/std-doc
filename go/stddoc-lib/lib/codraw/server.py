#!/usr/bin/env python3
"""Co-Draw Studio server (stdlib only).

Serves the shared Excalidraw canvas. The file scene.json IS the canvas:
  GET  /scene    -> current scene JSON (includes _rev)
  POST /scene    -> save scene; server bumps _rev, writes, returns {"_rev": N}
  POST /feedback -> append a text comment to feedback.jsonl (one JSON per line)
The human (browser) and the agent (editing scene.json + bumping _rev) are peers.

The feedback inbox mirrors the std-doc pattern: the agent runs a Monitor on
feedback.jsonl, so the human's typed comments push to the agent live — alongside
the drawing changes that already flow through scene.json.
"""
import json, os, time, http.server, socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
SCENE = os.path.join(HERE, "scene.json")
FEEDBACK = os.path.join(HERE, "feedback.jsonl")
PORT = int(os.environ.get("CODRAW_PORT", "8747"))

def read_scene():
    with open(SCENE) as f:
        return json.load(f)

def write_scene(s):
    tmp = SCENE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, SCENE)

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/scene"):
            try:
                self._json(200, read_scene())
            except Exception as e:
                self._json(500, {"error": str(e)})
            return
        if self.path == "/" or self.path == "":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/scene"):
            n = int(self.headers.get("Content-Length", 0))
            incoming = json.loads(self.rfile.read(n) or b"{}")
            try:
                cur = read_scene()
                rev = int(cur.get("_rev", 0)) + 1
            except Exception:
                rev = 1
            incoming["_rev"] = rev
            incoming.setdefault("_author", "human")
            write_scene(incoming)
            self._json(200, {"_rev": rev})
            return
        if self.path.startswith("/feedback"):
            n = int(self.headers.get("Content-Length", 0))
            msg = json.loads(self.rfile.read(n) or b"{}")
            entry = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "text": str(msg.get("text", "")).strip(),
                "ref": msg.get("ref"),      # optional: selected element ids
                "rev": msg.get("rev"),      # scene rev the comment was made against
            }
            with open(FEEDBACK, "a") as f:
                f.write(json.dumps(entry) + "\n")
            self._json(200, {"ok": True})
            return
        self._json(404, {"error": "not found"})

    def log_message(self, *a):
        pass

class TCP(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    print(f"co-draw studio: http://localhost:{PORT}")
    TCP(("127.0.0.1", PORT), H).serve_forever()
