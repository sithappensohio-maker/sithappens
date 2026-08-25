"""Production ASGI entrypoint for Sit Happens.

Keep ``server.py`` as the canonical application module, then install small
runtime extensions that need all of server's routes/helpers to already exist.
This avoids parallel booking APIs: extensions wrap the same canonical helpers
used by Quick Check-In, normal bookings, client bookings, and group bookings.
"""
import server

from board_train_scheduling import install_board_train_scheduling
from trainer_delivery import install_trainer_delivery
from trainer_delivery_indexes import install_trainer_delivery_indexes
from board_train_client_updates import install_board_train_client_updates
from trainer_delivery_guard import install_trainer_delivery_guard

install_board_train_scheduling(server_module=server, db=server.db)
install_trainer_delivery(server_module=server, db=server.db)
install_trainer_delivery_indexes(app=server.app, db=server.db)
install_board_train_client_updates(server_module=server, db=server.db)
install_trainer_delivery_guard(server_module=server, db=server.db)

app = server.app
