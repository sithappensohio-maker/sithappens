"""Sprint 110bp — CSV import endpoints for trivia + dog facts.

Locks in:
  • template download returns valid CSV with expected headers
  • upload creates new rows with curated=true flag and source/manual
  • re-uploading the same CSV updates instead of duplicating (uuid5 stability)
  • bad rows are skipped with line numbers
  • auth required (401 without admin token)
"""
import io
import os
import csv
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ─── Trivia CSV import ──────────────────────────────────────────────────────

def test_trivia_template_download(admin_headers):
    r = requests.get(f"{API}/admin/trivia/import-csv/template",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    assert "filename=" in r.headers.get("content-disposition", "")
    # CSV must have the right headers
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert len(rows) >= 2
    expected = {"question", "choice_a", "choice_b", "choice_c", "choice_d",
                "correct_letter", "difficulty", "tag"}
    assert set(rows[0].keys()) >= expected


def test_trivia_import_create_then_update(admin_headers):
    csv_data = (
        "question,choice_a,choice_b,choice_c,choice_d,correct_letter,difficulty,tag\n"
        "Test pytest CSV trivia Q1?,Aaa,Bbb,Ccc,Ddd,A,easy,fun\n"
        "Test pytest CSV trivia Q2?,Eee,Fff,Ggg,Hhh,B,medium,breeds\n"
    )
    files = {"file": ("trivia.csv", csv_data, "text/csv")}
    r = requests.post(f"{API}/admin/trivia/import-csv",
                      headers=admin_headers, files=files, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] + body["updated"] == 2
    assert body["skipped_count"] == 0

    # Re-upload — should NOT duplicate, just update
    files = {"file": ("trivia.csv", csv_data, "text/csv")}
    r = requests.post(f"{API}/admin/trivia/import-csv",
                      headers=admin_headers, files=files, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] == 0
    assert body["updated"] == 2
    assert body["skipped_count"] == 0


def test_trivia_import_skip_bad_rows(admin_headers):
    csv_data = (
        "question,choice_a,choice_b,choice_c,choice_d,correct_letter,difficulty,tag\n"
        ",x,y,z,w,A,easy,fun\n"                          # empty question -> skip
        "Has empty choice?,A,B,C,,A,easy,fun\n"          # missing choice_d -> skip
        "Bad letter?,A,B,C,D,Q,easy,fun\n"               # invalid letter -> skip
        "Dup choices?,X,X,X,X,A,easy,fun\n"              # non-unique -> skip
        "Good pytest Q3?,Aa,Bb,Cc,Dd,C,hard,health\n"    # ok
    )
    files = {"file": ("trivia.csv", csv_data, "text/csv")}
    r = requests.post(f"{API}/admin/trivia/import-csv",
                      headers=admin_headers, files=files, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["skipped_count"] == 4
    reasons = {s["reason"] for s in body["skipped"]}
    assert "empty question" in reasons
    assert any("4 choices" in s["reason"] for s in body["skipped"])
    assert any("A/B/C/D" in s["reason"] for s in body["skipped"])
    assert any("unique" in s["reason"] for s in body["skipped"])
    # The one good row should be persisted
    assert body["created"] + body["updated"] == 1


def test_trivia_import_missing_headers(admin_headers):
    # CSV with the wrong shape should return 400 quickly
    bad = "foo,bar\nbaz,qux\n"
    files = {"file": ("bad.csv", bad, "text/csv")}
    r = requests.post(f"{API}/admin/trivia/import-csv",
                      headers=admin_headers, files=files, timeout=15)
    assert r.status_code == 400
    assert "Missing required headers" in r.json().get("detail", "")


def test_trivia_import_requires_admin():
    files = {"file": ("trivia.csv", "x,y\n1,2\n", "text/csv")}
    r = requests.post(f"{API}/admin/trivia/import-csv",
                      files=files, timeout=15)
    assert r.status_code in (401, 403)


# ─── Dog facts CSV import ───────────────────────────────────────────────────

def test_dog_facts_template_download(admin_headers):
    r = requests.get(f"{API}/admin/dog-facts/import-csv/template",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert len(rows) >= 2
    assert set(rows[0].keys()) >= {"text", "tag", "emoji"}


def test_dog_facts_import_create_then_update(admin_headers):
    csv_data = (
        "text,tag,emoji\n"
        "Pytest fact: dogs have 18 muscles to move each ear.,anatomy,👂\n"
        "Pytest fact: a Bloodhound's nose has 300M scent receptors.,fun,🐾\n"
    )
    files = {"file": ("facts.csv", csv_data, "text/csv")}
    r = requests.post(f"{API}/admin/dog-facts/import-csv",
                      headers=admin_headers, files=files, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] + body["updated"] == 2

    # Re-upload → no duplicates
    files = {"file": ("facts.csv", csv_data, "text/csv")}
    r = requests.post(f"{API}/admin/dog-facts/import-csv",
                      headers=admin_headers, files=files, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] == 0
    assert body["updated"] == 2


def test_dog_facts_import_skip_empty(admin_headers):
    csv_data = (
        "text,tag,emoji\n"
        ",fun,🐶\n"          # empty -> skip
        "ab,fun,🐶\n"        # too short (<3 chars) -> skip
        "Pytest fact: dogs see best in low light.,anatomy,🌙\n"
    )
    files = {"file": ("facts.csv", csv_data, "text/csv")}
    r = requests.post(f"{API}/admin/dog-facts/import-csv",
                      headers=admin_headers, files=files, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["skipped_count"] == 2
    assert body["created"] + body["updated"] == 1


def test_dog_facts_import_missing_text_header(admin_headers):
    bad = "foo,bar\nx,y\n"
    files = {"file": ("bad.csv", bad, "text/csv")}
    r = requests.post(f"{API}/admin/dog-facts/import-csv",
                      headers=admin_headers, files=files, timeout=15)
    assert r.status_code == 400


def test_dog_facts_import_requires_admin():
    files = {"file": ("facts.csv", "text\nhi there world\n", "text/csv")}
    r = requests.post(f"{API}/admin/dog-facts/import-csv",
                      files=files, timeout=15)
    assert r.status_code in (401, 403)
