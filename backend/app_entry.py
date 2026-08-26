"""Production ASGI entrypoint for Sit Happens.

Keep ``server.py`` as the canonical application module, then install small
runtime extensions that need all of server's routes/helpers to already exist.
This avoids parallel booking APIs: extensions wrap or extend the same canonical
application and data model.
"""
import server

from board_train_scheduling import install_board_train_scheduling
from board_train_workspace_access import install_board_train_workspace_access
from school_experience_feedback import install_school_experience_feedback
from trainer_delivery_enforcement import install_trainer_delivery_enforcement

install_board_train_scheduling(server_module=server, db=server.db)
install_school_experience_feedback(server_module=server, db=server.db)
install_trainer_delivery_enforcement(server_module=server, db=server.db)
install_board_train_workspace_access(server_module=server, db=server.db)

app = server.app
