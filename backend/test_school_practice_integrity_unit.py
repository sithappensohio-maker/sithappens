"""Focused unit checks for the School Practice referential-integrity layer.

These use tiny async fakes so the repair logic can run without Mongo. The
repository's existing School integration suite remains the end-to-end gate.
"""
from pathlib import Path

import asyncio


def run(awaitable):
    return asyncio.run(awaitable)
from school_practice_integrity import install_school_practice_integrity


class Result:
    def __init__(self, modified_count=1):
        self.modified_count = modified_count


class Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, projection=None, sort=None):
        def get(row, dotted):
            cur = row
            for part in dotted.split('.'):
                if not isinstance(cur, dict):
                    return None
                cur = cur.get(part)
            return cur
        for row in reversed(self.rows) if sort else self.rows:
            ok = True
            for key, value in query.items():
                if key.startswith('$'):
                    continue
                if get(row, key) != value:
                    ok = False; break
            if ok:
                return dict(row)
        return None

    async def update_one(self, query, update, upsert=False):
        row = await self.find_one(query)
        target = next((r for r in self.rows if row and r.get('id') == row.get('id')), None)
        if target is None and upsert:
            target = {k: v for k, v in query.items() if not k.startswith('$')}
            self.rows.append(target)
        if target is None:
            return Result(0)
        for key, value in update.get('$set', {}).items():
            target[key] = value
        for key, value in update.get('$setOnInsert', {}).items():
            target.setdefault(key, value)
        for key in update.get('$unset', {}):
            target.pop(key, None)
        pull = update.get('$pull', {}).get('auto_homework_log')
        if pull is not None:
            target['auto_homework_log'] = [
                item for item in target.get('auto_homework_log', [])
                if not all(item.get(k) == v for k, v in pull.items())
            ]
        return Result(1)

    async def count_documents(self, query):
        return 0


class DB:
    pass


def _fixture(*, stale_template=False, stale_claim=False):
    db = DB()
    valid = 'tpl-live'
    frozen = 'tpl-stale' if stale_template else valid
    lesson = {'id': 'lesson-1', 'suggested_homework_template_ids': [frozen]}
    enrollment = {
        'id': 'enr-1', 'program_id': 'prog-1',
        'program_snapshot': {'modules': [{'lessons': [dict(lesson)]}]},
        'auto_homework_log': ([{'trigger': 'school_lesson:lesson-1', 'template_id': valid,
                               'homework_id': 'gone'}] if stale_claim else []),
    }
    db.programs = Collection([{'id': 'prog-1', 'modules': [{'lessons': [
        {'id': 'lesson-1', 'suggested_homework_template_ids': [valid]}
    ]}]}])
    db.dog_programs = Collection([enrollment])
    db.homework_templates = Collection([{'id': valid, 'name': 'Practice'}])
    db.homework = Collection([])
    db.dogs = Collection([{'id': 'dog-1', 'owner_id': 'client-1', 'name': 'Dog'}])
    db.clients = Collection([{'id': 'client-1', 'name': 'Client'}])
    db.school_enrollments = Collection([])

    async def lesson_hw(dog_id, lesson_id, school_enrollment_record_id=None):
        return next((dict(h) for h in db.homework.rows
                     if h.get('dog_id') == dog_id and h.get('source_lesson_id') == lesson_id), None)

    async def conflict(*_): return None

    async def claim(enrollment_id, template_id, trigger):
        row = db.dog_programs.rows[0]
        if any(x.get('trigger') == trigger for x in row.get('auto_homework_log', [])):
            return False
        row.setdefault('auto_homework_log', []).append(
            {'trigger': trigger, 'template_id': template_id, 'homework_id': None})
        return True

    async def create(dog, client, template_id, assigned_by='Auto', **kwargs):
        if not await db.homework_templates.find_one({'id': template_id}):
            return None
        hw = {'id': 'hw-new', 'dog_id': dog['id'], 'source_lesson_id': kwargs.get('source_lesson_id'),
              'template_snapshot': {'template_id': template_id}}
        db.homework.rows.append(hw)
        return dict(hw)

    async def finalize(enrollment_id, trigger, homework_id):
        for item in db.dog_programs.rows[0].get('auto_homework_log', []):
            if item.get('trigger') == trigger:
                item['homework_id'] = homework_id

    class API: routes = []
    globals_ = {
        '_lesson_practice_homework': lesson_hw,
        '_effective_lessons': lambda module: module.get('lessons') or [],
        '_active_homework_conflict': conflict,
        '_claim_auto_homework_trigger': claim,
        '_create_homework_from_template_internal': create,
        '_finalize_auto_homework_claim': finalize,
        'now_iso': lambda: 'now',
        'api': API(),
    }
    install_school_practice_integrity(db=db, server_globals=globals_)
    return db, enrollment, lesson, globals_['_claim_school_lesson_homework']


def test_stale_homework_claim_is_cleared_and_recreated():
    db, enrollment, lesson, claim = _fixture(stale_claim=True)
    out = run(claim(enrollment, 'dog-1', 'client-1', lesson, 'Online School', 'se-1'))
    assert out['id'] == 'hw-new'
    rows = db.dog_programs.rows[0]['auto_homework_log']
    assert rows == [{'trigger': 'school_lesson:lesson-1', 'template_id': 'tpl-live', 'homework_id': 'hw-new'}]


def test_stale_enrollment_recipe_id_repairs_from_same_live_lesson():
    db, enrollment, lesson, claim = _fixture(stale_template=True)
    out = run(claim(enrollment, 'dog-1', 'client-1', lesson, 'Online School', 'se-1'))
    assert out['id'] == 'hw-new'
    repaired = db.dog_programs.rows[0]['program_snapshot']['modules'][0]['lessons'][0]
    assert repaired['suggested_homework_template_ids'] == ['tpl-live']


def test_delete_guards_are_part_of_the_integrity_layer():
    src = Path(__file__).with_name('school_practice_integrity.py').read_text(encoding='utf-8')
    assert 'retained_for_course_refs' in src
    assert '/homework-templates/{template_id}' in src
    assert '/homework/{homework_id}' in src
    assert 'auto_homework_log' in src


def test_bundled_recipe_refresh_keeps_existing_template_uuid():
    from school_curriculum_routes import _refresh_bundled_recipes

    class Model:
        def __init__(self, **payload):
            self.payload = payload
        def model_dump(self):
            return dict(self.payload)

    db = DB()
    db.homework_templates = Collection([{
        'id': 'tpl-stable', 'import_source_key': 'recipe-1', 'slug': 'stable-slug',
        'name': 'Old name', 'description': 'old', 'tier': 'foundation',
        'default_duration_days': 7, 'cover_color': '', 'icon': '',
        'global_rules_this_week': [], 'sections': [], 'active': False,
        'practice_coach': {'enabled': False},
        'retained_for_course_refs': True,
    }])
    manifest = {'homework_templates': [{
        'source_key': 'recipe-1', 'name': 'New name', 'description': 'new directions',
        'tier': 'foundation', 'default_duration_days': 7, 'cover_color': '', 'icon': '',
        'global_rules_this_week': [], 'sections': [], 'active': True,
        'practice_coach': {'enabled': False},
    }]}
    run(_refresh_bundled_recipes(manifest=manifest, db=db, model=Model, now_iso=lambda: 'now'))
    row = db.homework_templates.rows[0]
    assert row['id'] == 'tpl-stable'
    assert row['description'] == 'new directions'
    assert row['active'] is True
    assert row['slug'] == 'stable-slug'
