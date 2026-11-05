"""Sert ./site sous /branche/ comme GitHub Pages (404.html pour les routes inconnues).
Usage : python3 scripts/serve-site.py [port]"""
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site')
PREFIX = '/branche'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def translate_path(self, path):
        path = path.split('?', 1)[0].split('#', 1)[0]
        if path.startswith(PREFIX):
            path = path[len(PREFIX):] or '/'
        return super().translate_path(path)

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            body = open(os.path.join(ROOT, '404.html'), 'rb').read()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8080), Handler).serve_forever()
