"""Make public program publication opt-in, without guessing what is public.

`/public/training-programs` used to select `publicly_visible != False`, so a
program nobody had ever considered was on the marketing website by default.
The query is now `publicly_visible == True`, which needs exactly one thing to
be safe: somebody must decide which programs are genuinely part of the
marketing offering.

That decision is NOT inferred here. A program is not public because it is
active, or has lessons, or has students, or has a price. Those describe how
the business runs, not what it advertises, and this script never classifies on
them — it only prints them as context for a human.

Two sources of truth, and only two:

  1. `programs_data.SEED_PROGRAMS` — seeded from the real public training page
     (see its docstring). Matched by `slug`, which is stable, not by `name`,
     which is editable. These are proposed for publication.

  2. `--publish-slugs` — slugs the owner has reviewed and decided to publish.
     Anything legitimate that postdates the seed belongs here.

Everything else is listed under REQUIRES OWNER REVIEW and left alone. Showing
too little on a website is a correctable mistake; publishing a retired or
internal program is not, and neither is silently hiding a real one.

    # Report only — safe to run any time, writes nothing. Run it where the
    # application's own environment already is. In the Docker deployment that
    # is inside the backend container, which Compose has already given the
    # real MONGO_URL and DB_NAME:
    #     docker exec sit-happens-backend     #         python migrations/stage2_public_program_optin.py
    # DB_NAME is never defaulted or inferred — a missing one is fatal.

    # after review, publish the seed set plus anything the owner approved
    ... --apply --publish-slugs=new_program_a,new_program_b

    # only once the review list is empty or accepted, mark the rest private
    ... --apply --demote-unreviewed

RELEASE ORDERING. `publicly_visible: true` satisfies BOTH the old query
(`$ne: False`) and the new one (`== True`), so this migration is safe to run
against the OLD application before the new code deploys. Verified against both
queries rather than assumed.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from programs_data import SEED_PROGRAMS  # noqa: E402

CANONICAL_SLUGS = {p["slug"] for p in SEED_PROGRAMS if p.get("slug")}

# Excluded from the public Training page by the endpoint itself, whatever the
# flag says — so these are never candidates.
NON_MARKETING_TYPES = {"self_guided", "online"}


def _visible_under_old_query(p: dict) -> bool:
    """Would the OLD application have shown this on the public Training page?

    Mirrors the pre-Stage-2 query exactly: active, not dog-specific, not an
    online/self-guided structure, and `publicly_visible != False` — which
    means unset and null both counted as public.
    """
    return (
        p.get("active") is True
        and p.get("publicly_visible") is not False
        and not p.get("owner_dog_id")
        and p.get("type") not in NON_MARKETING_TYPES
        and p.get("delivery_mode") not in NON_MARKETING_TYPES
    )


def _row(p: dict, matched: bool, why: str) -> dict:
    return {
        "id": p.get("id"),
        "slug": p.get("slug") or "(none)",
        "name": p.get("name") or "(unnamed)",
        "type": p.get("type") or "(none)",
        "publicly_visible": repr(p.get("publicly_visible", "<unset>")),
        "matched_seed": "yes" if matched else "no",
        "why": why,
        # Context for a human only. Never used to classify.
        "_context": {
            "active": p.get("active"),
            "delivery_mode": p.get("delivery_mode"),
            "created_at": str(p.get("created_at") or "")[:10],
            "modules": len(p.get("modules") or []),
            "has_price_config": bool(p.get("public_price_mode")),
        },
    }


def _print_table(title, rows, show_context=False):
    print(f"\n{title} ({len(rows)})")
    if not rows:
        print("  (none)")
        return
    for r in rows:
        print(f"  {r['name']}")
        print(f"      id={r['id']}  slug={r['slug']}  type={r['type']}")
        print(f"      publicly_visible={r['publicly_visible']}  matched_seed={r['matched_seed']}")
        print(f"      why: {r['why']}")
        if show_context:
            c = r["_context"]
            print(f"      context (NOT used to classify): active={c['active']} "
                  f"delivery_mode={c['delivery_mode']} created={c['created_at']} "
                  f"modules={c['modules']} priced={c['has_price_config']}")


async def run(args) -> int:
    mongo_url = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = os.environ.get("DB_NAME")
    if not db_name:
        print("DB_NAME is required.")
        return 2
    approved = {s.strip() for s in (args.publish_slugs or "").split(",") if s.strip()}
    publish_set = CANONICAL_SLUGS | approved

    db = AsyncIOMotorClient(mongo_url)[db_name]
    programs = await db.programs.find(
        {}, {"_id": 0, "id": 1, "slug": 1, "name": 1, "type": 1, "active": 1,
             "delivery_mode": 1, "owner_dog_id": 1, "publicly_visible": 1,
             "created_at": 1, "modules": 1, "public_price_mode": 1},
    ).to_list(10000)

    will_publish, already_public, needs_review, unaffected = [], [], [], []
    for p in programs:
        slug = p.get("slug") or ""
        if slug in publish_set:
            src = "matches SEED_PROGRAMS (the real public training page)" if slug in CANONICAL_SLUGS \
                  else "owner approved via --publish-slugs"
            if p.get("publicly_visible") is True:
                already_public.append(_row(p, slug in CANONICAL_SLUGS, f"already public; {src}"))
            else:
                will_publish.append(_row(p, slug in CANONICAL_SLUGS, f"publish because it {src}"))
            continue
        if _visible_under_old_query(p):
            needs_review.append(_row(
                p, False,
                "public under the OLD query only because publicly_visible was never set. "
                "Not in SEED_PROGRAMS and not approved, so it is NOT being classified."))
        else:
            unaffected.append(p)

    print(f"database: {db_name}")
    print(f"programs total: {len(programs)}")
    print(f"SEED_PROGRAMS slugs: {len(CANONICAL_SLUGS)}"
          + (f"  |  owner-approved: {len(approved)}" if approved else ""))
    print("classification uses slug membership ONLY — never activity, enrollment, lessons or price.")

    _print_table("WOULD BECOME PUBLIC", will_publish)
    _print_table("ALREADY PUBLIC (no change)", already_public)
    _print_table("REQUIRES OWNER REVIEW — currently public, would become private", needs_review, show_context=True)
    print(f"\nUNAFFECTED (already private / inactive / dog-specific / online-only): {len(unaffected)}")

    if needs_review and args.apply and not args.demote_unreviewed:
        print("\nREFUSING to apply: programs above need review first.")
        print("Publish any that are legitimate with --publish-slugs=a,b,c, then re-run.")
        print("Once the list is right, add --demote-unreviewed to mark the rest private.")
        return 1

    if not args.apply:
        print("\nReport only — nothing was written. Re-run with --apply to write.")
        return 0

    # The whole point of narrowing the query is to show the right programs,
    # not none of them. If no seeded slug is present in this database --
    # renamed slugs, a different dataset, a half-restored copy -- then
    # demoting everything else leaves the public training page blank, and
    # the migration would report "published: 0" and exit 0 while doing it.
    if not will_publish and not already_public and not args.allow_empty_public:
        print("\nREFUSING to apply: this would leave the public training page empty.")
        print("No program matched SEED_PROGRAMS or --publish-slugs, so nothing would")
        print("be public afterwards. Check the slugs above against this database,")
        print("publish the right ones with --publish-slugs=a,b,c, and re-run.")
        print("Pass --allow-empty-public only if a blank training page is intended.")
        return 3

    published = 0
    for r in will_publish:
        await db.programs.update_one({"id": r["id"]}, {"$set": {"publicly_visible": True}})
        published += 1
    demoted = 0
    if args.demote_unreviewed:
        # Explicitly private, so the state is a decision rather than an absence
        # — and so a later `!= False` bug cannot silently republish them.
        res = await db.programs.update_many(
            {"slug": {"$nin": list(publish_set)}, "publicly_visible": {"$ne": False}},
            {"$set": {"publicly_visible": False}})
        demoted = res.modified_count
    print(f"\npublished: {published}")
    print(f"explicitly marked private: {demoted}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: report only)")
    ap.add_argument("--publish-slugs", default="", help="comma-separated slugs the owner approved")
    ap.add_argument("--demote-unreviewed", action="store_true",
                    help="also mark everything outside the publish set explicitly private")
    ap.add_argument("--allow-empty-public", action="store_true",
                    help="permit an apply that leaves no public programs at all")
    sys.exit(asyncio.run(run(ap.parse_args())))
