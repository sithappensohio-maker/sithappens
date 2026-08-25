"""Production ASGI entrypoint for Sit Happens.

Keep ``server.py`` as the canonical application module, then install small
runtime extensions that need all of server's routes/helpers to already exist.
This avoids parallel booking APIs: extensions wrap or extend the same canonical
application and data model.
"""
import server

from board_train_scheduling import install_board_train_scheduling
from school_experience_feedback import install_school_experience_feedback

install_board_train_scheduling(server_module=server, db=server.db)
install_school_experience_feedback(server_module=server, db=server.db)

app = server.app
