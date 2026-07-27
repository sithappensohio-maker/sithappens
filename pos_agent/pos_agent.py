#!/usr/bin/env python3
"""Sit Happens front-desk POS hardware agent.

Runs ONLY on the front-desk Linux Mint laptop, bound to 127.0.0.1. Owns the
physical USB ESC/POS receipt printer + cash drawer (kicked through the
printer's RJ12 port) using the exact raw-device path proven during hardware
discovery: /dev/usb/lp0, raw ESC/POS bytes, no CUPS.

Exposes exactly three endpoints:

    GET  /health          -> {"status": "ok", "printer": "ready"|"offline"}
    POST /print-receipt   -> {"token": "..."}  (opaque, server-issued)
    POST /open-drawer     -> {"token": "..."}  (opaque, server-issued)

Nothing else. No shell execution, no arbitrary byte-print endpoint, no
arbitrary file access, no way for a caller to supply raw ESC/POS bytes or
receipt content directly. Every action is authorized by a short-lived,
signed, single-use token that this agent verifies with the real Sit Happens
backend BEFORE touching the printer:

  - /print-receipt: fetches the ACTUAL canonical receipt payload from the
    Sit Happens server using the token (GET /pos/receipt-payload). The
    browser can never forge totals — this agent never trusts browser-
    supplied receipt content, only what the server itself returns.
  - /open-drawer: asks the Sit Happens server to verify+consume the token
    (POST /pos/verify-drawer-token) before ever sending the drawer-kick
    command.

Configure SIT_HAPPENS_API_BASE / ALLOWED_ORIGIN / DEVICE_PATH below (or via
the matching environment variables) before running.
"""
import os
import json
import datetime
import urllib.request
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

# ── Configuration ───────────────────────────────────────────────────────────
SIT_HAPPENS_API_BASE = os.environ.get("SIT_HAPPENS_API_BASE", "https://sithappens.app/api")
ALLOWED_ORIGIN = os.environ.get("POS_AGENT_ALLOWED_ORIGIN", "https://sithappens.app")
DEVICE_PATH = os.environ.get("POS_PRINTER_DEVICE", "/dev/usb/lp0")
BIND_HOST = "127.0.0.1"  # never change — this agent must never be LAN/internet reachable
BIND_PORT = int(os.environ.get("POS_AGENT_PORT", "8765"))
HTTP_TIMEOUT_S = 10
RECEIPT_WIDTH = 42  # 80mm paper, Font A — matches the printer proven during hardware discovery

# ── ESC/POS primitives — the exact command set proven during hardware testing ──
ESC = b"\x1b"
GS = b"\x1d"
INIT = ESC + b"@"
ALIGN_LEFT = ESC + b"a\x00"
ALIGN_CENTER = ESC + b"a\x01"
BOLD_ON = ESC + b"E\x01"
BOLD_OFF = ESC + b"E\x00"
CUT = GS + b"V\x00"
DRAWER_KICK = ESC + b"p\x00\x19\xfa"  # ESC p 0 25 250 — proven during hardware testing


def _money(v):
    try:
        return f"${float(v or 0):.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def _line(left, right="", width=RECEIPT_WIDTH):
    left = str(left)
    right = str(right)
    pad = max(1, width - len(left) - len(right))
    return (left + (" " * pad) + right)[:width] + "\n"


def _center(text, width=RECEIPT_WIDTH):
    text = str(text)
    if len(text) >= width:
        return text[:width] + "\n"
    pad = (width - len(text)) // 2
    return (" " * pad) + text + "\n"


def _receipt_header_footer(payload: dict):
    """Shared header (business name/date/receipt#/client) and footer
    (thank-you + cut) — identical across both receipt kinds."""
    out = [INIT, ALIGN_CENTER]
    out.append(BOLD_ON + _center(payload.get("business_name") or "Sit Happens").encode() + BOLD_OFF)
    out.append(_center("DOG TRAINING").encode())
    out.append(b"\n")

    when = payload.get("date_time") or ""
    try:
        when = datetime.datetime.fromisoformat(when.replace("Z", "+00:00")).strftime("%Y-%m-%d %I:%M %p")
    except Exception:
        pass
    out.append(ALIGN_LEFT)
    out.append(f"{when}\n".encode())
    if payload.get("receipt_number"):
        out.append(f"Receipt #{payload['receipt_number']}\n".encode())
    if payload.get("invoice_id"):
        out.append(f"Invoice #{str(payload['invoice_id'])[:8].upper()}\n".encode())
    out.append(b"\n")

    if payload.get("client_name"):
        out.append(f"Client: {payload['client_name']}\n".encode())
    dogs = payload.get("dogs") or []
    if dogs:
        out.append(f"Dog(s): {', '.join(dogs)}\n".encode())
    out.append(b"\n")
    return out


def _receipt_footer():
    out = [("-" * RECEIPT_WIDTH + "\n").encode(), ALIGN_CENTER]
    out.append(BOLD_ON + _center("THANK YOU").encode() + BOLD_OFF)
    out.append(("-" * RECEIPT_WIDTH + "\n").encode())
    out.append(b"\n" * 3)
    out.append(CUT)
    return out


def format_receipt(payload: dict) -> bytes:
    """Builds the raw ESC/POS byte stream for one receipt. `payload` is the
    canonical, server-authoritative data from GET /pos/receipt-payload —
    this function NEVER computes or adjusts any dollar amount; it only
    formats what the server already decided. Branches on payload["kind"]:
    a booking/invoice receipt (Total/Credits/Paid/Balance) is a genuinely
    different layout from a Front Desk POS retail sale receipt
    (Subtotal/Discount/Tax/Total) — this only ever reads that discriminator,
    it never infers the kind from which fields happen to be present."""
    if payload.get("kind") == "pos_sale":
        return format_pos_sale_receipt(payload)
    if payload.get("kind") == "tab_payment":
        return format_tab_payment_receipt(payload)
    return format_invoice_receipt(payload)


def format_tab_payment_receipt(payload: dict) -> bytes:
    """Generic account/tab payment receipt — not tied to a booking or
    invoice, so there's no Total/Balance line, just what was paid."""
    out = _receipt_header_footer(payload)

    out.append(("-" * RECEIPT_WIDTH + "\n").encode())
    for li in (payload.get("line_items") or []):
        out.append(_line(li.get("description") or "Account payment", _money(li.get("amount"))).encode())
    out.append(("-" * RECEIPT_WIDTH + "\n").encode())

    out.append((BOLD_ON + _line("Paid", _money(payload.get("payment_amount"))).encode() + BOLD_OFF))
    out.append(b"\n")

    method = (payload.get("payment_method") or "").upper()
    if method:
        out.append(f"Payment: {method}\n".encode())
    if payload.get("tendered_amount") is not None:
        out.append(_line("Cash Received", _money(payload.get("tendered_amount"))).encode())
        out.append(_line("Change", _money(payload.get("change_given"))).encode())

    out.extend(_receipt_footer())
    return b"".join(out)


def format_invoice_receipt(payload: dict) -> bytes:
    out = _receipt_header_footer(payload)

    out.append(("-" * RECEIPT_WIDTH + "\n").encode())
    for li in (payload.get("line_items") or []):
        desc = li.get("description") or "Service"
        qty = li.get("qty")
        if qty and qty != 1:
            desc = f"{desc} x{qty}"
        out.append(_line(desc, _money(li.get("amount"))).encode())
    out.append(("-" * RECEIPT_WIDTH + "\n").encode())

    out.append((BOLD_ON + _line("Total", _money(payload.get("invoice_total"))).encode() + BOLD_OFF))
    if float(payload.get("credits_applied") or 0) > 0.005:
        out.append(_line("Credits", _money(payload.get("credits_applied"))).encode())
    out.append(_line("Paid", _money(payload.get("payment_amount"))).encode())
    out.append(_line("Balance", _money(payload.get("remaining_balance"))).encode())
    out.append(b"\n")

    method = (payload.get("payment_method") or "").upper()
    if method:
        out.append(f"Payment: {method}\n".encode())

    # Only ever present when Phase 2 actually captured them — never
    # fabricated for a group checkout that never recorded a real tender.
    if payload.get("tendered_amount") is not None:
        out.append(_line("Cash Received", _money(payload.get("tendered_amount"))).encode())
        out.append(_line("Change", _money(payload.get("change_given"))).encode())

    out.extend(_receipt_footer())
    return b"".join(out)


def format_pos_sale_receipt(payload: dict) -> bytes:
    """Front Desk POS retail-sale receipt: Subtotal / Discount / Tax / TOTAL
    — no Credits/Paid/Balance section, since a POS sale is always fully
    settled at time of sale (never partial, never AR)."""
    out = _receipt_header_footer(payload)

    out.append(("-" * RECEIPT_WIDTH + "\n").encode())
    for li in (payload.get("line_items") or []):
        desc = li.get("description") or "Item"
        qty = li.get("qty")
        if qty and qty != 1:
            desc = f"{desc} x{qty}"
        out.append(_line(desc, _money(li.get("amount"))).encode())
    out.append(("-" * RECEIPT_WIDTH + "\n").encode())

    out.append(_line("Subtotal", _money(payload.get("subtotal"))).encode())
    if float(payload.get("discount_amount") or 0) > 0.005:
        out.append(_line("Discount", "-" + _money(payload.get("discount_amount"))).encode())
    out.append(_line("Tax", _money(payload.get("tax_amount"))).encode())
    out.append((BOLD_ON + _line("TOTAL", _money(payload.get("total"))).encode() + BOLD_OFF))
    out.append(b"\n")

    method = (payload.get("payment_method") or "").upper()
    if method:
        out.append(f"Payment: {method}\n".encode())
    if payload.get("tendered_amount") is not None:
        out.append(_line("Cash Received", _money(payload.get("tendered_amount"))).encode())
        out.append(_line("Change", _money(payload.get("change_given"))).encode())

    out.extend(_receipt_footer())
    return b"".join(out)


def _device_ready() -> bool:
    try:
        return os.path.exists(DEVICE_PATH) and os.access(DEVICE_PATH, os.W_OK)
    except OSError:
        return False


def _write_device(data: bytes):
    with open(DEVICE_PATH, "wb") as f:
        f.write(data)
        f.flush()


def _http_get_json(url: str):
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
        return json.loads(resp.read().decode())


def _http_post_json(url: str, body: dict):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
        return json.loads(resp.read().decode())


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Quiet by default; real errors are logged explicitly below via print().
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode())
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "printer": "ready" if _device_ready() else "offline"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/print-receipt":
            self._handle_print_receipt()
        elif self.path == "/open-drawer":
            self._handle_open_drawer()
        else:
            self._json(404, {"error": "not found"})

    def _handle_print_receipt(self):
        body = self._read_json_body()
        token = body.get("token")
        if not token:
            self._json(400, {"ok": False, "error": "Missing token"})
            return
        try:
            payload = _http_get_json(f"{SIT_HAPPENS_API_BASE}/pos/receipt-payload?token={urllib.parse.quote(token)}")
        except urllib.error.HTTPError as e:
            try:
                detail = json.loads(e.read().decode()).get("detail", str(e))
            except Exception:
                detail = str(e)
            self._json(200, {"ok": False, "error": f"Token rejected by server: {detail}"})
            return
        except Exception as e:
            self._json(200, {"ok": False, "error": f"Could not reach Sit Happens server: {e}"})
            return
        if not _device_ready():
            self._json(200, {"ok": False, "error": "Printer not detected/writable"})
            return
        try:
            _write_device(format_receipt(payload))
        except Exception as e:
            self._json(200, {"ok": False, "error": f"Printer write failed: {e}"})
            return
        self._json(200, {"ok": True})

    def _handle_open_drawer(self):
        body = self._read_json_body()
        token = body.get("token")
        if not token:
            self._json(400, {"ok": False, "error": "Missing token"})
            return
        try:
            _http_post_json(f"{SIT_HAPPENS_API_BASE}/pos/verify-drawer-token", {"token": token})
        except urllib.error.HTTPError as e:
            try:
                detail = json.loads(e.read().decode()).get("detail", str(e))
            except Exception:
                detail = str(e)
            self._json(200, {"ok": False, "error": f"Token rejected by server: {detail}"})
            return
        except Exception as e:
            self._json(200, {"ok": False, "error": f"Could not reach Sit Happens server: {e}"})
            return
        if not _device_ready():
            self._json(200, {"ok": False, "error": "Printer/drawer not detected/writable"})
            return
        try:
            _write_device(DRAWER_KICK)
        except Exception as e:
            self._json(200, {"ok": False, "error": f"Drawer kick failed: {e}"})
            return
        self._json(200, {"ok": True})


def main():
    server = HTTPServer((BIND_HOST, BIND_PORT), Handler)
    print(f"Sit Happens POS agent listening on http://{BIND_HOST}:{BIND_PORT} (loopback only)")
    print(f"  Device: {DEVICE_PATH}")
    print(f"  Sit Happens API: {SIT_HAPPENS_API_BASE}")
    print(f"  Allowed origin (CORS): {ALLOWED_ORIGIN}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
