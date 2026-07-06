# Duplicate Merge Response Hotfix

Fixed a backend response serialization bug in the dog duplicate merge/archive endpoint.

The safe merge/archive could complete successfully, but the API could still return `Internal server error` because MongoDB mutates inserted dictionaries by adding a raw `_id` ObjectId after `insert_one()`. Returning that mutated audit dictionary is not JSON-serializable.

Change:
- Insert a copy of the audit row into `duplicate_merge_audit`.
- Return the original clean audit row to the frontend.

No client, dog, booking, payment, vaccine, credit, or message data is deleted or rewritten by this hotfix beyond the intended safe duplicate merge workflow.
