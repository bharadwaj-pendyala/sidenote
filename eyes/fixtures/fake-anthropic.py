"""A stand-in for the Anthropic Messages API, for the playground's real-model cases.

Accepts only the key sk-ant-test-key (as a Bearer token or x-api-key), records every request it gets (headers it
cares about plus the body) to the log file, and answers edit prompts with a
fixed rewrite and other prompts with a fixed answer.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
LOG = sys.argv[2]
KEY = "sk-ant-test-key"


def key_of(headers):
    """The key as the SDK sends it: Authorization: Bearer <key> (or x-api-key)."""
    auth = headers.get("authorization") or ""
    return auth[len("Bearer "):] if auth.startswith("Bearer ") else headers.get("x-api-key")


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        self.reply(200, {"ok": True})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        with open(LOG, "a") as log:
            log.write(json.dumps({
                "path": self.path,
                "key_ok": key_of(self.headers) == KEY,
                "beta": self.headers.get("anthropic-beta"),
                "body": body,
            }) + "\n")
        if key_of(self.headers) != KEY:
            return self.reply(401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
        prompt = body["messages"][0]["content"]
        text = "EDITED BY FAKE CLAUDE." if "Rewrite ONLY" in prompt else "FAKE CLAUDE ANSWER: yes, trim the intro."
        self.reply(200, {
            "id": "msg_fake", "type": "message", "role": "assistant", "model": body.get("model"),
            "content": [{"type": "text", "text": text}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 5},
        })

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
