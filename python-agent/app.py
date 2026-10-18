"""Tiny HTTP wrapper (standard library only) so the Node backend can call the shared agent."""
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from agent import respond


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "engine": "local-rules", "llm": False})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/respond":
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > 1_000_000:
                return self._send(413, {"error": "payload too large"})
            self._send(200, respond(json.loads(self.rfile.read(n))))
        except Exception as e:  # never leak a traceback to callers
            sys.stderr.write(f"agent error: {e!r}\n")
            self._send(500, {"error": "agent failure"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("AGENT_PORT", "5001"))
    print(f"Python agent listening on 127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
