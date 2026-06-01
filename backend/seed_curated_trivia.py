"""
Sprint 110bo — Operator-curated trivia seed.

Inserts 21 hand-curated trivia questions (3 difficulty levels × 7 categories)
into the `trivia_questions` collection. Idempotent: each question gets a stable
uuid5 derived from its text, so re-running this script overwrites instead of
duplicating.

Usage:
    cd /app/backend && python3 seed_curated_trivia.py
"""

import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Stable namespace so uuid5(NAMESPACE, question_text) is repeatable forever.
SEED_NAMESPACE = uuid.UUID("5e8e4dac-aaaa-4111-9999-547269766961")  # "trivia"


# ─── 21 curated questions ───────────────────────────────────────────────────
CURATED = [
    # ── Breeds ─────────────────────────────────────────────────────────────
    {
        "tag": "breeds", "difficulty": "easy",
        "question": "Which dog breed is famously known for its distinct black spots on a white coat?",
        "choices": ["Dalmatian", "Great Dane", "Border Collie", "Boxer"],
        "correct_index": 0,
    },
    {
        "tag": "breeds", "difficulty": "medium",
        "question": "Which toy breed was historically revered by Aztec royalty and is named after a Mexican state?",
        "choices": ["Pomeranian", "Chihuahua", "Shih Tzu", "Pug"],
        "correct_index": 1,
    },
    {
        "tag": "breeds", "difficulty": "hard",
        "question": "Which ancient breed is known as the \"barkless dog\" because it produces a unique yodel-like sound called a \"barroo\"?",
        "choices": ["Basenji", "Saluki", "Shiba Inu", "Afghan Hound"],
        "correct_index": 0,
    },

    # ── Behavior ───────────────────────────────────────────────────────────
    {
        "tag": "behavior", "difficulty": "easy",
        "question": "When a dog wags its tail while loosely wiggling its whole body, it usually indicates which emotion?",
        "choices": ["Anger", "Fear", "Happiness / Friendliness", "Aggression"],
        "correct_index": 2,
    },
    {
        "tag": "behavior", "difficulty": "medium",
        "question": "What is a dog likely communicating when it lowers its front legs onto the ground while keeping its rear end up in the air?",
        "choices": [
            "They are feeling defensive",
            "They want to play (a \"play bow\")",
            "Their stomach hurts",
            "They are submitting to a dominant dog",
        ],
        "correct_index": 1,
    },
    {
        "tag": "behavior", "difficulty": "hard",
        "question": "What is the psychological term for a dog's repetitive, compulsive behaviors — like excessive tail-chasing or flank-sucking — often triggered by anxiety or boredom?",
        "choices": [
            "Canine Compulsive Disorder (CCD)",
            "Separation Anxiety Syndrome",
            "Hyper-reactivity Phase",
            "Displacement Socialization",
        ],
        "correct_index": 0,
    },

    # ── Health ─────────────────────────────────────────────────────────────
    {
        "tag": "health", "difficulty": "easy",
        "question": "Which of these common human foods is highly toxic to dogs and can cause severe kidney failure?",
        "choices": ["Carrots", "Blueberries", "Grapes (and raisins)", "Apples"],
        "correct_index": 2,
    },
    {
        "tag": "health", "difficulty": "medium",
        "question": "What deadly, preventable virus attacks a dog's gastrointestinal tract and is highly contagious among unvaccinated puppies?",
        "choices": ["Heartworm", "Parvovirus", "Kennel Cough", "Lyme Disease"],
        "correct_index": 1,
    },
    {
        "tag": "health", "difficulty": "hard",
        "question": "Large, deep-chested breeds are particularly susceptible to a life-threatening emergency called GDV. What does GDV stand for?",
        "choices": [
            "Gastric Dilation-Volvulus (Bloat)",
            "General Dietary Ventriculus",
            "Gastro-Duodenal Virus",
            "Genetic Digestive Vascularization",
        ],
        "correct_index": 0,
    },

    # ── History ────────────────────────────────────────────────────────────
    {
        "tag": "history", "difficulty": "easy",
        "question": "Which specific breed became famous worldwide because of the classic TV show and movie franchise Lassie?",
        "choices": ["German Shepherd", "Rough Collie", "Golden Retriever", "Saint Bernard"],
        "correct_index": 1,
    },
    {
        "tag": "history", "difficulty": "medium",
        "question": "In 1925, a heroic sled-dog team traveled 674 miles to deliver diphtheria antitoxin serum to Nome, Alaska. Who was the lead dog on the final leg of the journey?",
        "choices": ["Togo", "Balto", "Bolt", "Rin Tin Tin"],
        "correct_index": 1,
    },
    {
        "tag": "history", "difficulty": "hard",
        "question": "In ancient times, which type of large, fierce dog was utilized by the Romans and Molossians as armored war dogs in battle?",
        "choices": ["Molossus", "Greyhound", "Poodle", "Terrier"],
        "correct_index": 0,
    },

    # ── Anatomy ────────────────────────────────────────────────────────────
    {
        "tag": "anatomy", "difficulty": "easy",
        "question": "A dog's sense of smell is their superpower. Approximately how many times more powerful is a dog's nose compared to a human's?",
        "choices": ["2 times", "5 times", "10 times", "10,000 to 100,000 times"],
        "correct_index": 3,
    },
    {
        "tag": "anatomy", "difficulty": "medium",
        "question": "What is the technical name for the specialized, moisture-retaining leather-like skin that covers a dog's nose?",
        "choices": ["Tapetum", "Rhinarium", "Vibrissae", "Philtrum"],
        "correct_index": 1,
    },
    {
        "tag": "anatomy", "difficulty": "hard",
        "question": "Dogs have a special structure at the back of their eyes that reflects light, helping them see in the dark. What is it called?",
        "choices": [
            "Nictitating membrane",
            "Tapetum lucidum",
            "Olfactory bulb",
            "Vestibular apparatus",
        ],
        "correct_index": 1,
    },

    # ── Training ───────────────────────────────────────────────────────────
    {
        "tag": "training", "difficulty": "easy",
        "question": "In dog training, using a small plastic device that makes a sharp \"click\" sound to mark a correct behavior is called what?",
        "choices": ["Whistle training", "Clicker training", "Shock training", "Voice modeling"],
        "correct_index": 1,
    },
    {
        "tag": "training", "difficulty": "medium",
        "question": "If you are using \"Positive Reinforcement\" to teach a dog to sit, what are you doing?",
        "choices": [
            "Scolding them when they stand up",
            "Giving a treat or praise the moment their butt hits the floor",
            "Ignoring them until they figure it out on their own",
            "Physically forcing them into position",
        ],
        "correct_index": 1,
    },
    {
        "tag": "training", "difficulty": "hard",
        "question": "What is the training term for when a dog becomes so overly excited or frustrated by a trigger that they cross a mental threshold and start lunging, barking, or snapping?",
        "choices": ["Reactivity", "Operant Conditioning", "Desensitization", "Resource Guarding"],
        "correct_index": 0,
    },

    # ── Fun & Myth ─────────────────────────────────────────────────────────
    {
        "tag": "myth", "difficulty": "easy",
        "question": "True or False: A dog's mouth is cleaner than a human's mouth.",
        "choices": [
            "True",
            "False",
            "True, but only for puppies",
            "True, because their saliva kills all bacteria",
        ],
        "correct_index": 1,
    },
    {
        "tag": "myth", "difficulty": "medium",
        "question": "There's a common myth that dogs only see in black and white. What colors can dogs actually see?",
        "choices": [
            "Reds and greens",
            "Blues and yellows",
            "Purples and oranges",
            "The exact same color spectrum as humans",
        ],
        "correct_index": 1,
    },
    {
        "tag": "fun", "difficulty": "hard",
        "question": "What unique physical feature sets the Chow Chow and the Shar-Pei apart from almost all other dog breeds?",
        "choices": [
            "Webbed toes for swimming",
            "They lack a sense of smell",
            "Blue-black tongues",
            "Three eyelids",
        ],
        "correct_index": 2,
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def seed() -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    upserts = 0
    for item in CURATED:
        qid = str(uuid.uuid5(SEED_NAMESPACE, item["question"]))
        doc = {
            "id": qid,
            "question": item["question"][:200],
            "choices": [str(c)[:80] for c in item["choices"]],
            "correct_index": item["correct_index"],
            "difficulty": item["difficulty"],
            "tag": item["tag"],
            "source": "manual",
            "active": True,
            "created_at": _now_iso(),
            "times_used": 0,
            "curated": True,  # flag so we know these are operator-curated
        }
        # Upsert by stable id; preserve times_used if already exists.
        existing = await db.trivia_questions.find_one({"id": qid}, {"_id": 0})
        if existing:
            doc["times_used"] = existing.get("times_used", 0)
            doc["created_at"] = existing.get("created_at", doc["created_at"])
        await db.trivia_questions.update_one(
            {"id": qid}, {"$set": doc}, upsert=True
        )
        upserts += 1

    total = await db.trivia_questions.count_documents({})
    curated_total = await db.trivia_questions.count_documents({"curated": True})
    print(f"Seeded/updated {upserts} curated questions.")
    print(f"Total trivia_questions in DB: {total} ({curated_total} curated, "
          f"{total - curated_total} AI/manual).")
    client.close()


if __name__ == "__main__":
    asyncio.run(seed())
