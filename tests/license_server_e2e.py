"""The licence server against a real Postgres ($DATABASE_URL, empty): init_db,
three licences, and the preset voice in the signed /v2/verify answer.

Run from chakra-license-server/ (CI does: deploy.yml). Leaves licences 1-3 and the
usage tables behind for tests/hub_e2e.sh.
"""
import asyncio
import base64
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request

import asyncpg
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

URL = os.environ["DATABASE_URL"]
key = Ed25519PrivateKey.generate()
os.environ["LICENSE_SIGNING_KEY"] = base64.b64encode(
    key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
).decode()

subprocess.run([sys.executable, "init_db.py"], check=True)
subprocess.run([sys.executable, "init_db.py"], check=True)  # safe to re-run
tokens = ["chk_live_" + secrets.token_hex(32) for _ in range(3)]

SPEECH = """
CREATE TABLE IF NOT EXISTS speech_usage (
    license_id INTEGER NOT NULL, hour TIMESTAMPTZ NOT NULL,
    stt_requests INTEGER NOT NULL DEFAULT 0, stt_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    tts_requests INTEGER NOT NULL DEFAULT 0, tts_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    stt_errors INTEGER NOT NULL DEFAULT 0, tts_errors INTEGER NOT NULL DEFAULT 0,
    rejected INTEGER NOT NULL DEFAULT 0, peak_inflight INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (license_id, hour))"""


async def setup():
    c = await asyncpg.connect(URL)
    cols = {r[0] for r in await c.fetch("select column_name from information_schema.columns where table_name='licenses'")}
    tables = {r[0] for r in await c.fetch("select table_name from information_schema.tables where table_schema='public'")}
    print("gemini_voice column:", "gemini_voice" in cols, "| license_voices table:", "license_voices" in tables)
    rows = [
        ("Acme", "Growth", ["chakra"], {"acme-ta": "gemini_live"}, None),
        ("Beta", "Starter", ["gemini_live"], {}, "Leda"),
        ("Gamma", "Starter", ["gemini_live"], {}, "NotAVoice"),
    ]
    for token, (name, pkg, pipelines, pins, voice) in zip(tokens, rows):
        await c.execute(
            "INSERT INTO licenses (company_name, token_hash, token_prefix, is_active, package_name, pipelines,"
            " agent_pipelines, gemini_voice) VALUES ($1, $2, $3, true, $4, $5, $6::jsonb, $7)",
            name, hashlib.sha256(token.encode()).hexdigest(), token[:16], pkg, pipelines, json.dumps(pins), voice,
        )
    await c.execute(SPEECH)
    await c.close()


def verify(token):
    body = json.dumps({"token": token, "nonce": secrets.token_urlsafe(24)}).encode()
    req = urllib.request.Request("http://127.0.0.1:8099/v2/verify", body, {"Content-Type": "application/json"})
    reply = json.load(urllib.request.urlopen(req, timeout=10))
    key.public_key().verify(base64.b64decode(reply["signature"]), base64.b64decode(reply["payload"]))
    return json.loads(base64.b64decode(reply["payload"]))


asyncio.run(setup())
server = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--port", "8099"], stderr=subprocess.DEVNULL)
try:
    for _ in range(40):
        try:
            urllib.request.urlopen("http://127.0.0.1:8099/health", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    first = verify(tokens[0])
    assert (first["greeting_mode"], first["greeting_id"], first["greeting_text"]) == ("", "", ""), first
    voices = [verify(t)["gemini_voice"] for t in tokens]
    print("signed gemini_voice per licence:", voices)
    assert voices == ["", "Leda", ""], voices
    # A finished call, so the hub has calls to count for licence 1.
    for _ in range(3):
        body = json.dumps({"token": tokens[0], "seconds": 120, "pipeline": "chakra"}).encode()
        urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8099/track-usage", body, {"Content-Type": "application/json"}), timeout=10)
    print("LS_E2E_OK")
finally:
    server.terminate()
