# Sit Happens POS Agent (front-desk hardware)

This is a tiny, standalone service meant to run **only** on the physical
front-desk Linux Mint laptop that owns the USB thermal printer and cash
drawer. It is not part of the main `backend/`/`frontend/` app and is not
deployed by any existing pipeline — copy this folder to that laptop by hand.

It exposes exactly three endpoints, bound only to `127.0.0.1:8765`:

- `GET /health` — printer detected/writable?
- `POST /print-receipt` — body `{"token": "..."}`; fetches the canonical
  receipt payload from the real Sit Happens server using the token, then
  prints it. The token is issued by the Sit Happens server after a real
  payment; this agent never accepts receipt content directly.
- `POST /open-drawer` — body `{"token": "..."}`; asks the Sit Happens server
  to verify+consume the token, then kicks the drawer.

It does **not** accept arbitrary ESC/POS bytes, arbitrary file paths, or
shell commands from the browser. It does not listen on any LAN or public
interface.

## Prerequisites (already proven working on this hardware)

- `garrett` (or whichever account runs this) is a member of the `lp` group:
  ```bash
  sudo usermod -aG lp garrett
  ```
  (log out/in, or reboot, for the group change to take effect)
- The printer enumerates at `/dev/usb/lp0`. Confirm with:
  ```bash
  ls -l /dev/usb/
  ```
- No CUPS queue is fighting the kernel `usblp` driver for this printer. If
  one exists, remove it (do not touch any other CUPS queue):
  ```bash
  sudo cupsdisable <queue-name>
  sudo lpadmin -x <queue-name>
  ```
- Python 3 is installed (`python3 --version`). No pip packages are required —
  the agent uses only the standard library.

## Configuration

All configuration is via environment variables, all optional (defaults match
the real Sit Happens deployment):

| Variable | Default | Purpose |
|---|---|---|
| `SIT_HAPPENS_API_BASE` | `https://sithappens.app/api` | Real backend base URL the agent calls back to for token verification/receipt data |
| `POS_AGENT_ALLOWED_ORIGIN` | `https://sithappens.app` | Only browser origin allowed to call this agent (CORS) |
| `POS_PRINTER_DEVICE` | `/dev/usb/lp0` | Raw device path for the thermal printer |
| `POS_AGENT_PORT` | `8765` | Loopback port |

## Quick install (recommended)

Copy this whole `pos_agent/` folder to the Mint laptop, then:

```bash
cd pos_agent
chmod +x install.sh
./install.sh
```

This checks Python, adds you to the `lp` group if needed, generates the
systemd unit file with your actual username/path (no manual editing),
enables + starts the service, and runs a health check. Safe to re-run any
time — it just re-checks everything and reinstalls the service.

If it added you to the `lp` group for the first time, log out/in (or
reboot) once for that to take effect, then re-run `./install.sh`.

## Running manually (for testing, without installing the service)

```bash
cd ~/pos_agent
python3 pos_agent.py
```

You should see:
```
Sit Happens POS agent listening on http://127.0.0.1:8765 (loopback only)
```

Test health:
```bash
curl http://127.0.0.1:8765/health
```

## Manual systemd install (if you'd rather not use install.sh)

1. Copy this folder to `/home/garrett/pos_agent` (or update the paths in the
   unit file to match wherever you put it).
2. Copy the unit file:
   ```bash
   sudo cp sit-happens-pos-agent.service /etc/systemd/system/
   ```
3. Edit `/etc/systemd/system/sit-happens-pos-agent.service` if your username
   or path differs from `garrett` / `/home/garrett/pos_agent`.
4. Enable and start it:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable sit-happens-pos-agent
   sudo systemctl start sit-happens-pos-agent
   ```
5. Check status/logs:
   ```bash
   sudo systemctl status sit-happens-pos-agent
   tail -f ~/pos_agent/pos_agent.log
   ```

It will now start on boot and restart automatically if it crashes, with no
terminal window required.

## Security notes

- Binds only to `127.0.0.1` — never reachable from the LAN or internet.
- CORS only permits `https://sithappens.app` (or whatever you set
  `POS_AGENT_ALLOWED_ORIGIN` to) — no `*`.
- Every action requires a short-lived, single-use, signed token issued by the
  real Sit Happens server after an authorized action there. This agent
  cannot be used to print or open the drawer without that server's
  cooperation.
- No shell execution, no arbitrary file access, no raw-byte print endpoint.
