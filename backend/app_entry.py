"""Production ASGI entrypoint for Sit Happens.

Keep ``server.py`` as the canonical application module, then install small
runtime extensions that need all of server's routes/helpers to already exist.
This avoids parallel booking APIs: extensions wrap the same canonical helpers
used by Quick Check-In, normal bookings, client bookings, and group bookings.
"""
import server

from board_train_scheduling import install_board_train_scheduling

install_board_train_scheduling(server_module=server, db=server.db)

app = server.app
