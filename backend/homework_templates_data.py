"""
Sit Happens — Homework Templates Library.

System-seeded templates covering Tier 1 (Foundation), Tier 2 (Intermediate),
Tier 3 (Advanced), Specialty, plus the Customizable Master Template.

Each template has SECTIONS; each section has structured FIELDS the client
fills in per day (reps, duration, success-rate, distance, struggles, wins, etc).

Field kinds:
    - reps         : integer count (per session)
    - sets         : integer count (sets/day)
    - duration_sec : seconds
    - duration_min : minutes
    - distance_ft  : feet
    - success_rate : 0-100 %
    - rating_5     : 1-5 self-rating
    - checkbox     : boolean
    - text         : free-form short text
    - longtext     : free-form multi-line text
"""

def _f(fid, label, kind, **extra):
    return {"id": fid, "label": label, "kind": kind, **extra}


SEED_TEMPLATES = [
    # ───────────────────────── MASTER TEMPLATE ─────────────────────────
    {
        "slug": "master_customizable",
        "name": "Customizable Master Template",
        "tier": "master",
        "description": "Blank-slate weekly homework — fill in commands, reps, and house rules on the fly. Use this for one-off sessions or when none of the pre-mades fit.",
        "default_duration_days": 7,
        "cover_color": "#64748b",  # slate
        "icon": "fa-clipboard-list",
        "global_rules_this_week": [
            "Three short sessions beat one long session — keep it under 10 minutes each.",
            "End every session on a win, even if you have to make it easy.",
            "Pay your dog. Markers (Yes / Good) bridge the moment; food or play pays the bridge.",
        ],
        "sections": [
            {
                "id": "focus_command",
                "title": "Focus Command / Behavior",
                "instructions": "Pick ONE command or behavior to drill this week. Log each session you do. If you skip a day, that's fine — write down WHY.",
                "fields": [
                    _f("command", "What are we working on?", "text", placeholder="e.g., Place command, loose-leash, name recognition"),
                    _f("sets", "Sets today", "sets", target=3),
                    _f("reps", "Reps per set", "reps", target=10),
                    _f("duration", "Total session length (min)", "duration_min", target=10),
                    _f("success", "How reliable was it today? (1-5)", "rating_5", target=4),
                ],
            },
            {
                "id": "house_rules",
                "title": "House Rules This Week",
                "instructions": "Your trainer sets these. Stick to them — every household member must enforce them the same way or your dog learns the rule is optional.",
                "fields": [
                    _f("rules_followed", "Did the whole household follow the rules today?", "checkbox"),
                    _f("slip_ups", "Any slip-ups? (who, what, when)", "longtext"),
                ],
            },
            {
                "id": "wins_struggles",
                "title": "Wins & Struggles",
                "instructions": "Be honest. The stuff that's hard is the stuff we work on next session.",
                "fields": [
                    _f("wins", "Biggest win this week", "longtext", placeholder="What did your dog finally nail?"),
                    _f("struggles", "Where are you stuck?", "longtext", placeholder="Specific behavior, trigger, or context"),
                    _f("questions", "Questions for your trainer", "longtext"),
                ],
            },
        ],
    },

    # ───────────────────── TIER 1 — FOUNDATION ─────────────────────
    {
        "slug": "first_48_hours",
        "name": "The First 48 Hours",
        "tier": "foundation",
        "description": "New dog in the house. Strict management, crate schedule, and hand-feeding to build engagement and earn calm.",
        "default_duration_days": 2,
        "cover_color": "#8cc63f",
        "icon": "fa-house-chimney",
        "global_rules_this_week": [
            "No free roaming. Your dog is on a leash attached to YOU, in the crate, or behind a gate. There is no fourth option.",
            "No furniture. No couch, no bed, no laps unless explicitly invited (and not this week).",
            "Petting is earned, not free. Ask for a sit before any affection.",
            "Nobody outside the household greets the dog for 48 hours. No exceptions for grandma.",
        ],
        "sections": [
            {
                "id": "crate_schedule",
                "title": "Crate Schedule",
                "instructions": "Crate = safe space, not punishment. Toss food in, close the door for 10 seconds, open. Repeat until the dog walks in willingly. Do NOT let them out when they whine — wait for silence (even 3 seconds), then release calmly.",
                "fields": [
                    _f("sessions", "Crate-introduction sessions today", "sets", target=6),
                    _f("longest_quiet", "Longest stretch of quiet in the crate (min)", "duration_min", target=30),
                    _f("whining", "Did you ever release them while whining?", "checkbox"),
                ],
            },
            {
                "id": "hand_feeding",
                "title": "Hand-Feeding Every Meal",
                "instructions": "For 48 hours, NO bowl. Every kibble comes from your hand or as a reward for a behavior (sit, eye contact, calm in the crate). This is the single fastest way to build engagement with a new dog.",
                "fields": [
                    _f("meals_hand_fed", "Meals fed by hand", "reps", target=4),
                    _f("eye_contact_reps", "Voluntary eye-contact reps captured", "reps", target=20),
                    _f("bowl_used", "Did you cave and use a bowl?", "checkbox"),
                ],
            },
            {
                "id": "decompression",
                "title": "Decompression & Quiet Time",
                "instructions": "Your dog needs to SLEEP. New environments are exhausting. Aim for 16-18 hrs of crate or settle time. Active interaction is the smaller bucket, not the bigger one.",
                "fields": [
                    _f("sleep_hours", "Hours of crate / settle time", "duration_min", unit="hours", target=16),
                    _f("walks", "Short structured walks (≤15 min)", "sets", target=2),
                    _f("notes", "Any signs of stress? (panting, pacing, refusing food)", "longtext"),
                ],
            },
        ],
    },

    {
        "slug": "basic_obedience_part_1",
        "name": "Basic Obedience — Part 1",
        "tier": "foundation",
        "description": "Marker words, the Place command, and leash-pressure introduction. The bedrock of everything that comes next.",
        "default_duration_days": 7,
        "cover_color": "#8cc63f",
        "icon": "fa-paw",
        "global_rules_this_week": [
            "Markers are sacred — 'Yes' / 'Good' / 'No' mean exactly one thing each. Don't use them in casual conversation.",
            "Place is a privilege the dog earns. Always pay the first time they go on Place this week.",
            "No leash pops yet. We're teaching the dog that pressure means 'follow.' Pulling is information, not misbehavior.",
        ],
        "sections": [
            {
                "id": "markers",
                "title": "Loading the Marker Words",
                "instructions": "Say 'YES' → immediately deliver a treat. 'GOOD' → keep doing what you're doing, treat is coming soon. 'NO' → reset, no reward, try again. Do 20-30 reps per session, twice a day, anywhere in the house.",
                "fields": [
                    _f("yes_reps", "'Yes' reps loaded today", "reps", target=30),
                    _f("good_reps", "'Good' reps loaded today (sustained behavior)", "reps", target=15),
                    _f("no_reps", "'No' reps loaded today (clean reset, no harsh tone)", "reps", target=10),
                    _f("clean", "Was your timing clean? (mark BEFORE the treat)", "rating_5", target=4),
                ],
            },
            {
                "id": "place_intro",
                "title": "The Place Command",
                "instructions": "Lure the dog onto a raised bed or mat. Mark 'YES' the instant all 4 paws are on. Pay on the bed. Release with a clear word ('Free' or 'Break'). Start with 5-second holds; add seconds each rep.",
                "fields": [
                    _f("sessions", "Sessions today", "sets", target=3),
                    _f("reps_per_session", "Reps per session", "reps", target=8),
                    _f("longest_duration", "Longest hold this session (sec)", "duration_sec", target=60),
                    _f("broke_place", "Did the dog break Place without being released?", "rating_5", target=2, reverse=True),
                ],
            },
            {
                "id": "leash_pressure",
                "title": "Leash Pressure Introduction",
                "instructions": "Apply gentle, steady leash pressure to the side. The INSTANT the dog steps toward you (even one step), release pressure and mark 'Yes.' Pressure = a question, not a punishment. Practice in a calm hallway, not outside.",
                "fields": [
                    _f("sessions", "Indoor sessions today", "sets", target=2),
                    _f("yields", "Successful yields to pressure", "reps", target=20),
                    _f("location", "Where did you practice?", "text", placeholder="Hallway, kitchen, etc."),
                ],
            },
            {
                "id": "wins_struggles",
                "title": "Wins & Struggles",
                "instructions": "",
                "fields": [
                    _f("wins", "Biggest win this week", "longtext"),
                    _f("struggles", "Where did your dog (or you) get stuck?", "longtext"),
                ],
            },
        ],
    },

    {
        "slug": "door_manners_impulse_control",
        "name": "Door Manners & Impulse Control",
        "tier": "foundation",
        "description": "Waiting for food, threshold boundaries, ignoring distractions. Teach your dog that calm = access.",
        "default_duration_days": 7,
        "cover_color": "#8cc63f",
        "icon": "fa-door-open",
        "global_rules_this_week": [
            "Nothing in life is free. Food, doors, leashes — your dog says 'please' (sits or makes eye contact) first, every time.",
            "If they bolt or break a wait, the door / bowl / leash IMMEDIATELY closes or goes away. Try again in 10 seconds.",
        ],
        "sections": [
            {
                "id": "food_wait",
                "title": "Wait for the Food Bowl",
                "instructions": "Bowl goes down — but only when your dog is sitting and NOT staring at the bowl (or briefly looking, then back at you). If they lunge, the bowl goes back on the counter. Reset. Wait 10 seconds. Try again.",
                "fields": [
                    _f("meals_practiced", "Meals practiced with wait", "reps", target=14),
                    _f("longest_wait", "Longest calm wait before release (sec)", "duration_sec", target=15),
                    _f("bolts", "Times the dog broke and bolted at the bowl", "reps", target=0, reverse=True),
                ],
            },
            {
                "id": "thresholds",
                "title": "Threshold Boundaries (No Bolting)",
                "instructions": "At every doorway — front door, back door, car door — your dog SITS and waits for a release word before crossing. Open the door slowly. If they move, close it. Try again. Pay generously for the first 50 reps; then fade rewards.",
                "fields": [
                    _f("doors_practiced", "Doorways practiced today", "sets", target=3),
                    _f("clean_reps", "Clean sit-and-wait reps", "reps", target=20),
                    _f("bolts", "Bolts (door had to close)", "reps", target=0, reverse=True),
                    _f("release_word", "Release word you're using", "text", placeholder="Free, Break, OK"),
                ],
            },
            {
                "id": "distractions",
                "title": "Ignoring Distractions",
                "instructions": "Drop a piece of low-value food on the ground. Cover it with your foot. Wait for the dog to look at YOU instead of the food. Mark and pay (from your hand, NOT from the floor). Add harder distractions as they win.",
                "fields": [
                    _f("dropped_food_reps", "'Leave-it' reps with dropped food", "reps", target=15),
                    _f("toy_reps", "'Leave-it' reps with a toy", "reps", target=10),
                    _f("hardest_distraction", "Hardest distraction they won against today", "text"),
                ],
            },
        ],
    },

    # ───────────────────── TIER 2 — INTERMEDIATE ─────────────────────
    {
        "slug": "structured_walk_mastery",
        "name": "Structured Walk Mastery",
        "tier": "intermediate",
        "description": "Heel positioning, leash tension, and protocols for passing triggers (other dogs / people / squirrels).",
        "default_duration_days": 7,
        "cover_color": "#00a9e0",
        "icon": "fa-person-walking",
        "global_rules_this_week": [
            "Your dog does not get to sniff, pee, or greet on a structured walk. Those are paid for separately, with a release word.",
            "If you start pulling, you stop walking. Period. Pulling can never produce forward motion.",
            "Loose leash = motion. Tight leash = stop. The leash teaches the dog, not you.",
        ],
        "sections": [
            {
                "id": "heel_position",
                "title": "Heel Position",
                "instructions": "Dog's shoulder lines up with your knee. Choose a side and stick to it. Practice 'auto-sit when you stop' at every halt. Reward heavily for eye contact and self-correcting back into position.",
                "fields": [
                    _f("walks", "Structured walks today", "sets", target=2),
                    _f("duration", "Time in heel (min, total)", "duration_min", target=20),
                    _f("auto_sits", "Auto-sits when you stopped", "reps", target=15),
                    _f("heel_quality", "Heel reliability today", "rating_5", target=4),
                ],
            },
            {
                "id": "leash_tension",
                "title": "Leash Tension Management",
                "instructions": "When the leash goes tight, STOP walking. Wait. The instant your dog looks back at you or releases the tension, mark and resume. No pops, no jerks — the dog learns that tension = stop.",
                "fields": [
                    _f("stops", "Times you stopped for tension today", "reps"),
                    _f("self_corrections", "Times the dog self-corrected back to you", "reps", target=10),
                    _f("avg_loose_leash_duration", "Avg unbroken loose-leash stretch (sec)", "duration_sec", target=60),
                ],
            },
            {
                "id": "passing_triggers",
                "title": "Passing Triggers",
                "instructions": "Other dogs, joggers, kids, scooters. Pre-emptively move OFF the path, body-block your dog, get their eye contact BEFORE the trigger is close. Pay heavily for the look. Distance is your friend — cross the street if you have to.",
                "fields": [
                    _f("triggers_passed", "Triggers you passed today", "reps"),
                    _f("clean_passes", "Clean passes (no reactivity)", "reps"),
                    _f("reactions", "Reactions (barked, lunged, fixated)", "reps", target=0, reverse=True),
                    _f("worst_trigger", "Hardest trigger today", "text", placeholder="Loose dog, jogger with stroller, etc."),
                ],
            },
            {
                "id": "wins_struggles",
                "title": "Wins & Struggles",
                "instructions": "",
                "fields": [
                    _f("wins", "Biggest walk win this week", "longtext"),
                    _f("struggles", "Where did you struggle?", "longtext"),
                ],
            },
        ],
    },

    {
        "slug": "duration_and_distance",
        "name": "Duration & Distance",
        "tier": "intermediate",
        "description": "Extend Place and Down-Stay while you move around the house and into higher-distraction environments.",
        "default_duration_days": 7,
        "cover_color": "#00a9e0",
        "icon": "fa-ruler-horizontal",
        "global_rules_this_week": [
            "Add ONE variable at a time — duration OR distance OR distraction. Never two at once.",
            "If your dog fails twice in a row, you went too fast. Step back to the last successful rep.",
            "A broken Place isn't a crime, it's data. Just reset and continue.",
        ],
        "sections": [
            {
                "id": "duration_place",
                "title": "Place — Duration",
                "instructions": "Goal: 30-minute hold while you cook, read, watch TV. Start at your current reliable max and add 1 minute per session. Pay periodically (every 30-60 sec early on). Don't free them out — release with your word.",
                "fields": [
                    _f("sessions", "Sessions today", "sets", target=3),
                    _f("longest_hold", "Longest hold (min)", "duration_min", target=30),
                    _f("breaks", "Times the dog broke Place uninvited", "reps", target=0, reverse=True),
                    _f("payments", "Mid-hold payments delivered", "reps", target=8),
                ],
            },
            {
                "id": "distance_place",
                "title": "Place — Distance",
                "instructions": "Send the dog to Place from progressively further away. 5 ft → 10 ft → 20 ft → another room. If they fail at a distance, go back 50% and rebuild.",
                "fields": [
                    _f("max_distance", "Max send distance today (ft)", "distance_ft", target=20),
                    _f("send_reps", "Total send reps", "reps", target=15),
                    _f("success_rate", "Success rate today", "success_rate", target=80),
                ],
            },
            {
                "id": "down_stay_distractions",
                "title": "Down-Stay Under Distraction",
                "instructions": "Down. You walk around the dog. You step over the dog. You sit on the floor next to the dog. You bounce a ball. You eat a sandwich. The dog doesn't move. Build it gradually.",
                "fields": [
                    _f("longest_down", "Longest Down-Stay (min)", "duration_min", target=10),
                    _f("hardest_distraction", "Hardest distraction the dog held through", "text"),
                    _f("location", "Where did you practice?", "text", placeholder="Kitchen, front porch, park"),
                ],
            },
        ],
    },

    {
        "slug": "correcting_nuisance_behaviors",
        "name": "Correcting Nuisance Behaviors",
        "tier": "intermediate",
        "description": "Jumping, counter-surfing, excessive barking. Balanced corrections paired with a clear 'do this instead' replacement behavior.",
        "default_duration_days": 14,
        "cover_color": "#00a9e0",
        "icon": "fa-triangle-exclamation",
        "global_rules_this_week": [
            "EVERY correction must come with a path back to 'yes' — the dog needs to know what to do INSTEAD of the unwanted behavior.",
            "If a behavior is rewarded ONCE this week (e.g., guest pets a jumping dog), you're back to square one. Brief everyone in the household.",
            "Management first, correction second. If your dog can't help themselves yet, set the environment up so the behavior can't happen.",
        ],
        "sections": [
            {
                "id": "jumping",
                "title": "Jumping on People",
                "instructions": "Replacement behavior: Sit. The MOMENT 4 paws come off the floor, the person turns their back / disengages. The MOMENT the dog sits, the person greets calmly. Practice with willing helpers — every guest must agree in advance.",
                "fields": [
                    _f("jump_attempts", "Jump attempts today", "reps"),
                    _f("self_sits", "Times the dog defaulted to a sit instead", "reps", target=10),
                    _f("guest_compliance", "Did all greeters follow the rule?", "rating_5", target=5),
                ],
            },
            {
                "id": "counter_surfing",
                "title": "Counter Surfing",
                "instructions": "MANAGEMENT FIRST: counters stay clear, dog stays out of the kitchen unless invited. Correction: a clear 'No' or 'Off' the moment paws come up, then redirect to Place. Reward Place heavily so the kitchen ↔ Place pattern is built.",
                "fields": [
                    _f("counter_attempts", "Counter approaches today", "reps"),
                    _f("interruptions", "Interruptions delivered (No / Off)", "reps"),
                    _f("place_redirects", "Successful redirects to Place", "reps", target=8),
                ],
            },
            {
                "id": "barking",
                "title": "Excessive Vocalization",
                "instructions": "Identify the trigger (doorbell, window, noises). Block visual access. Teach 'Quiet' on a calm dog FIRST, then add a trigger at low intensity. Mark and pay for 1 second of silence. Build duration before intensity.",
                "fields": [
                    _f("bark_episodes", "Bark episodes today", "reps"),
                    _f("avg_episode_length", "Avg episode length (sec)", "duration_sec", target=5, reverse=True),
                    _f("quiet_reps", "'Quiet' reps practiced calmly", "reps", target=15),
                    _f("primary_trigger", "Primary trigger this week", "text"),
                ],
            },
        ],
    },

    # ───────────────────── TIER 3 — ADVANCED ─────────────────────
    {
        "slug": "bulletproof_recall",
        "name": "Bulletproof Recall",
        "tier": "advanced",
        "description": "Long-line drills, distraction-proofing, and layering pressure for a recall that works EVERY time.",
        "default_duration_days": 14,
        "cover_color": "#a855f7",
        "icon": "fa-bullseye",
        "global_rules_this_week": [
            "The recall word is sacred. NEVER call your dog for anything they hate (nail trims, baths, going inside). Use 'come here' or walk to them instead.",
            "If you can't enforce it, don't say it. Until off-leash is truly reliable, your dog is always on a long line or in a fenced area when you call.",
            "Big rewards for hard recalls. The harder the distraction, the better the pay.",
        ],
        "sections": [
            {
                "id": "long_line_basics",
                "title": "Long-Line Foundation",
                "instructions": "30-ft line. Dog gets to sniff and explore. You say the recall word ONCE in a happy tone, immediately back up, and reel them in if they don't come. Pay JACKPOT (5-10 treats in a row) on arrival. Do this 20+ times before adding distraction.",
                "fields": [
                    _f("sessions", "Long-line sessions today", "sets", target=2),
                    _f("recalls", "Recall reps", "reps", target=25),
                    _f("instant_returns", "Recalls that returned WITHOUT a line tug", "reps", target=20),
                    _f("avg_response_time", "Avg response time (sec)", "duration_sec", target=3, reverse=True),
                ],
            },
            {
                "id": "distractions",
                "title": "Recall Under Distraction",
                "instructions": "Add ONE distraction at a time. Other people walking by → another dog at distance → squirrels → off-leash dogs. If they fail, retreat to the last reliable distraction level and rebuild.",
                "fields": [
                    _f("distraction_recalls", "Distraction recalls attempted", "reps", target=15),
                    _f("success_rate", "Success rate (%)", "success_rate", target=80),
                    _f("hardest_distraction_beaten", "Hardest distraction beaten", "text"),
                    _f("failures", "Failed recalls (had to reel in)", "reps", target=2, reverse=True),
                ],
            },
            {
                "id": "pressure_layer",
                "title": "Pressure / E-Collar Layering (If Conditioned)",
                "instructions": "ONLY if your dog has been properly e-collar conditioned by your trainer. Low-level continuous pressure paired with the recall word — release pressure the instant they turn toward you. Pressure is the leash you can't see; it never increases, it only stays steady until they yield.",
                "fields": [
                    _f("layered_recalls", "Pressure-layered recalls", "reps"),
                    _f("working_level", "Working level used today", "text", placeholder="e.g., 8 on Mini Educator"),
                    _f("clean_releases", "Clean pressure-off the moment they turned", "rating_5", target=5),
                ],
            },
            {
                "id": "wins_struggles",
                "title": "Wins & Struggles",
                "instructions": "",
                "fields": [
                    _f("wins", "Biggest recall win this week", "longtext"),
                    _f("struggles", "Where did the recall fall apart?", "longtext"),
                ],
            },
        ],
    },

    {
        "slug": "off_leash_fundamentals",
        "name": "Off-Leash Fundamentals",
        "tier": "advanced",
        "description": "Transitioning from the long line to true off-leash freedom, with engagement and emergency stops baked in.",
        "default_duration_days": 21,
        "cover_color": "#a855f7",
        "icon": "fa-feather-pointed",
        "global_rules_this_week": [
            "Off-leash is a privilege earned every single day. If recall is shaky today, the line goes back on. No exceptions.",
            "Carry pay (high-value treats / favorite toy) every single time you go off-leash. ALWAYS reward the dog for checking in voluntarily.",
            "Practice on YOUR terms. Pick locations and times of day with predictable, low traffic — not the busy park at 5pm.",
        ],
        "sections": [
            {
                "id": "long_line_drag",
                "title": "Long-Line Drag Phase",
                "instructions": "Same locations you'll eventually go off-leash, but the long line is dragging on the ground (still attached). This is your safety net. Practice 3-4 sessions before fully removing it.",
                "fields": [
                    _f("sessions", "Drag-line sessions today", "sets", target=2),
                    _f("voluntary_checkins", "Voluntary check-ins (dog looked back at you)", "reps", target=20),
                    _f("recalls_clean", "Clean recalls without touching the line", "reps", target=10),
                ],
            },
            {
                "id": "off_leash_micro_sessions",
                "title": "Off-Leash Micro-Sessions",
                "instructions": "Truly off-leash, in a safe area (fenced field, low-traffic trail). Start at 5 minutes. Reward EVERY voluntary check-in for the first week. Add 2 minutes per session if reliability holds.",
                "fields": [
                    _f("session_length", "Longest off-leash session today (min)", "duration_min", target=15),
                    _f("location", "Where?", "text", placeholder="Fenced field, hiking trail, beach"),
                    _f("checkins", "Voluntary check-ins", "reps", target=10),
                    _f("had_to_leash", "Had to re-leash for a problem?", "checkbox"),
                ],
            },
            {
                "id": "emergency_stop",
                "title": "Emergency Stop ('Down' at Distance)",
                "instructions": "Your insurance policy. Dog is running. You say 'Down.' Dog drops INSTANTLY, wherever they are. Practice on a long line first, in low distraction. Reward jackpot every time. This command may save their life one day.",
                "fields": [
                    _f("emergency_reps", "Emergency-stop reps today", "reps", target=10),
                    _f("max_distance", "Max distance for instant Down (ft)", "distance_ft", target=50),
                    _f("avg_response_sec", "Avg response time (sec)", "duration_sec", target=2, reverse=True),
                ],
            },
        ],
    },

    # ───────────────────── SPECIALTY — PUBLIC ACCESS ─────────────────────
    {
        "slug": "public_access_prep",
        "name": "Public Access Prep",
        "tier": "specialty",
        "description": "Service-dog candidates and high-drive working breeds learning neutrality in public spaces and settling under tables.",
        "default_duration_days": 30,
        "cover_color": "#ec4899",
        "icon": "fa-store",
        "global_rules_this_week": [
            "Public access work is BORING work. If your dog is exciting in public, they aren't ready. Calm is the goal.",
            "Strangers do NOT pet a service dog candidate in public. Politely refuse, every time, even from kids.",
            "Set up your environment to win. Quiet hours at pet-friendly stores beat trying to debut at Costco on a Saturday.",
        ],
        "sections": [
            {
                "id": "neutrality",
                "title": "Stranger & Environmental Neutrality",
                "instructions": "Dog ignores strangers, dropped food, other dogs, carts, automatic doors, beeping registers. Reward heavily for relaxed body language (soft tail, slow blinks, voluntary check-in). If they fixate, get them moving and create distance.",
                "fields": [
                    _f("outings", "Public outings today", "sets", target=1),
                    _f("duration", "Duration of longest outing (min)", "duration_min", target=30),
                    _f("strangers_ignored", "Strangers cleanly ignored", "reps", target=20),
                    _f("dropped_food", "Dropped food ignored", "reps", target=5),
                    _f("reactions", "Reactions (look fixated, pulled, vocalized)", "reps", target=0, reverse=True),
                ],
            },
            {
                "id": "settle_under_table",
                "title": "Settle Under a Table / Chair",
                "instructions": "Tether or down-stay under your chair at a cafe / restaurant. Dog should melt into the floor for the duration of a meal. Pay sparingly for sustained calm; don't over-engage. Bring a chew if needed at first.",
                "fields": [
                    _f("longest_settle", "Longest settle under-table (min)", "duration_min", target=45),
                    _f("location", "Location", "text", placeholder="Cafe, brewery patio, food court"),
                    _f("breaks", "Times the dog popped up uninvited", "reps", target=0, reverse=True),
                ],
            },
            {
                "id": "task_practice",
                "title": "Task / Job Practice",
                "instructions": "If this dog is being trained for a specific service task (alert, retrieve, deep pressure, mobility), drill it briefly in public after the dog has settled. NEVER lead with the task — calm comes first, task second.",
                "fields": [
                    _f("task_name", "Task you're working on", "text", placeholder="e.g., DPT, retrieve dropped item, alert"),
                    _f("task_reps", "Task reps in public today", "reps", target=5),
                    _f("clean_executions", "Clean executions on first cue", "reps", target=4),
                    _f("notes", "Notes / observations", "longtext"),
                ],
            },
        ],
    },
]
