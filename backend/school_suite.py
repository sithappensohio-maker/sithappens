"""Compatibility export for the School suite implementation.

Phase 4 moved trainer-controlled manual In-Person progression into
``domains.training.routes``.  The established School suite itself remains in
``school_suite_base`` and is registered explicitly by the School domain.
"""
from school_suite_base import *  # noqa: F401,F403
from school_suite_base import register_school_suite
