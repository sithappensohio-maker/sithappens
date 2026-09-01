"""Online School storefront — backend contract tests.

The storefront's hard rule is NO fabricated content, so these tests pin the
data paths that make that possible:

  * course cards: helps_with/welcome_outcomes (admin-authored) and derived
    module/lesson counts ride the catalog item; the PUBLIC allowlist passes
    them through — plus purchase_fulfillment and free_claim_available, whose
    absence made the public Online School tab permanently empty
  * aggregates: /public/school/storefront serves real counts and averages
  * testimonials: published ONLY when the client granted permission AND an
    admin explicitly featured the row — and revoking either side unpublishes

Same in-process harness as the other ad hoc suites.
"""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

# Aliased so pytest doesn't try to collect the "Test…" class name.
from school_experience_feedback import TestimonialFeatureIn as FeatureBody


def _route(path):
    return next(r for r in server.app.routes if getattr(r, "path", "") == path).endpoint


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": "storefront admin"}


def test_program_in_cleans_helps_with_like_welcome_outcomes():
    body = server.ProgramIn(
        name="Storefront bullets", type="private_lessons",
        helps_with=["  Leash pulling ", "", "Jumping"],
    )
    assert body.helps_with == ["Leash pulling", "Jumping"]


def test_catalog_and_public_item_carry_storefront_card_fields():
    admin = _admin_user()
    prog = run(server.create_program(server.ProgramIn(
        name=f"Storefront Prog {uuid.uuid4().hex[:6]}", type="private_lessons",
        delivery_mode="self_guided", purchase_fulfillment="online_school",
        available_online=True, publicly_visible=True, price=149,
        estimated_weeks=6,
        helps_with=["Leash pulling", "Door chaos"],
        welcome_outcomes=["Name response", "Settle on a mat"],
        modules=[server.ModuleIn(
            name="M1", order=0,
            goals=[server.GoalIn(name="G1")],
            lessons=[server.LessonIn(name="L1", order=0, active=True)],
        )],
    ), admin))
    try:
        catalog = run(server._build_shop_catalog(None))
        raw = next(i for i in catalog["items"] if i["kind"] == "training_program" and i["id"] == prog["id"])
        assert raw["helps_with"] == ["Leash pulling", "Door chaos"]
        assert raw["welcome_outcomes"] == ["Name response", "Settle on a mat"]
        assert raw["module_count"] == 1 and raw["lesson_count"] == 1

        public = server._build_public_shop_item(raw, global_show_public_prices=True)
        assert public is not None
        # Card content passes the public allowlist…
        for f in ("helps_with", "welcome_outcomes", "module_count", "lesson_count"):
            assert public[f] == raw[f], f
        # …and the two discriminators whose absence emptied the public tab.
        assert public["purchase_fulfillment"] == "online_school"
        assert public["free_claim_available"] is False  # $0 opt-in never granted
        # The curriculum itself (names/ids) never goes public.
        assert "modules" not in public
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def test_public_storefront_serves_real_aggregates_and_gated_testimonials():
    tag = uuid.uuid4().hex[:8]
    pid = f"prog-{tag}"
    rows = []
    for i, (rating, permission) in enumerate([(5, True), (5, False), (4, True)]):
        rid = f"school-experience:client-{tag}-{i}:dog-{tag}:{pid}"
        rows.append(rid)
        run(server.db.school_experience_feedback.insert_one({
            "_id": rid, "id": rid, "program_id": pid,
            "client_name": f"Sarah{i} Tester", "client_email": "hidden@example.com",
            "dog_name": "Bella", "program_name": "Puppy Foundations",
            "overall_rating": rating, "liked_most": f"The trainer feedback was great {i}",
            "improve": "private text that must never publish",
            "testimonial_permission": permission,
        }))
    enroll_ids = []
    for i in range(2):
        eid = f"se-{tag}-{i}"
        enroll_ids.append(eid)
        run(server.db.school_enrollments.insert_one({"id": eid, "enrollment_id": f"dp-{tag}-{i}", "dog_id": f"dog-{tag}-{i}"}))

    storefront = _route("/api/public/school/storefront")
    feature = _route("/api/admin/school/experience-feedback/{feedback_id}/feature")
    admin = _admin_user()
    try:
        out = run(storefront())
        assert out["stats"]["dogs_trained"] >= 2
        assert out["stats"]["rating_count"] >= 3
        pr = out["program_ratings"][pid]
        assert pr == {"count": 3, "average": 4.7}
        # Nothing featured yet → nothing published, permission or not.
        assert all(t["id"] not in rows for t in out["testimonials"])

        # Featuring a row WITHOUT client permission is refused outright.
        with pytest.raises(server.HTTPException) as exc:
            run(feature(rows[1], FeatureBody(featured=True), admin))
        assert exc.value.status_code == 422

        run(feature(rows[0], FeatureBody(featured=True), admin))
        out = run(storefront())
        mine = next(t for t in out["testimonials"] if t["id"] == rows[0])
        # First name only — never the full name, never the email, never the
        # private "improve" text.
        assert mine["client_first_name"] == "Sarah0"
        assert mine["quote"] == "The trainer feedback was great 0"
        assert "Tester" not in str(mine) and "hidden@example.com" not in str(mine)
        assert "improve" not in mine

        # The client revoking permission unpublishes IMMEDIATELY, even while
        # the admin's featured flag is still set.
        run(server.db.school_experience_feedback.update_one({"_id": rows[0]}, {"$set": {"testimonial_permission": False}}))
        out = run(storefront())
        assert all(t["id"] != rows[0] for t in out["testimonials"])

        # And un-featuring works regardless of permission state.
        run(feature(rows[0], FeatureBody(featured=False), admin))
        row = run(server.db.school_experience_feedback.find_one({"_id": rows[0]}, {"_id": 0}))
        assert row["storefront_featured"] is False
    finally:
        run(server.db.school_experience_feedback.delete_many({"_id": {"$in": rows}}))
        run(server.db.school_enrollments.delete_many({"id": {"$in": enroll_ids}}))
