"""License server: checks a client's Chakra Console licence key and records usage.

Keys are looked up by SHA-256 hash (see migrations/001_hash_tokens.sql). The
plaintext `token` column is only consulted for rows 001 has not converted.

Two verification endpoints:

* ``POST /v2/verify`` — what chakra-ivr-core (0.2+) calls. The reply is signed
  with an Ed25519 key (``LICENSE_SIGNING_KEY``) and echoes the caller's random
  nonce, so the package can tell a genuine "valid" from a fake licence server
  or a replayed answer. Without a signing key it fails closed (503).
* ``POST /verify`` — the original unsigned check, kept for older packages.

``POST /track-usage`` records a finished call: its seconds go into the hourly
``call_usage`` table (what Chakra Console charts for every pipeline), and the
legacy ``licenses.used_minutes`` counter is kept up to date.
"""

import base64
import hashlib
import json
import math
import os
import time
from contextlib import asynccontextmanager

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv()

db_pool: asyncpg.Pool | None = None
_signer = None  # Ed25519PrivateKey, loaded at start-up

# Mock mode answers from a fixed list instead of the database. It used to switch
# on silently whenever DATABASE_URL was missing — so a misconfigured production
# server would have accepted the test key. Now it must be asked for explicitly.
MOCK_MODE = os.getenv("LICENSE_SERVER_MOCK") == "1"
MOCK_VALID_TOKENS = {"chk_live_test123": True, "chk_live_unpaid456": False}

LOOKUP = """
    SELECT id, company_name, package_name, is_active, pipelines, agent_pipelines,
           daily_limit_minutes, limit_warning_seconds, agent_daily_limits FROM licenses
    WHERE token_hash = $1 OR (token_hash IS NULL AND token = $2)
"""

CALL_USAGE_SCHEMA = """
CREATE TABLE IF NOT EXISTS call_usage (
    license_id    INTEGER NOT NULL,
    hour          TIMESTAMPTZ NOT NULL,
    pipeline      TEXT NOT NULL DEFAULT 'unknown',
    calls         INTEGER NOT NULL DEFAULT 0,
    call_seconds  DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (license_id, hour, pipeline)
)
"""

PIPELINES = {"chakra", "gemini_live", "unknown"}

PIPELINE_COLUMNS = (
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS pipelines TEXT[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS agent_pipelines JSONB NOT NULL DEFAULT '{}'::jsonb",
    # Daily talk time per caller (0 = none), the warning before it runs out, and
    # agents with their own limit ({agent: minutes}).
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS daily_limit_minutes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS limit_warning_seconds INTEGER NOT NULL DEFAULT 60",
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS agent_daily_limits JSONB NOT NULL DEFAULT '{}'::jsonb",
)


def _pipelines(row) -> tuple[list[str], dict[str, str]]:
    """The licence's pipelines (first = default) and per-agent pins, cleaned."""
    allowed = [p for p in (row.get("pipelines") or []) if p in PIPELINES - {"unknown"}]
    raw = row.get("agent_pipelines") or {}
    if isinstance(raw, str):
        raw = json.loads(raw or "{}")
    agents = {str(k): v for k, v in raw.items() if v in PIPELINES - {"unknown"}} if isinstance(raw, dict) else {}
    return allowed, agents


def _daily_limits(row) -> tuple[int, int, dict[str, int]]:
    """(daily talk time per caller, warning before the end, per-agent limits),
    all in seconds, cleaned. 0 = no limit."""

    def minutes(value) -> int | None:
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        return number * 60 if number >= 0 else None

    limit = minutes(row.get("daily_limit_minutes")) or 0
    try:
        warning = max(0, int(row.get("limit_warning_seconds") or 0))
    except (TypeError, ValueError):
        warning = 0
    raw = row.get("agent_daily_limits") or {}
    if isinstance(raw, str):
        raw = json.loads(raw or "{}")
    agents = {}
    if isinstance(raw, dict):
        for agent, value in raw.items():
            seconds = minutes(value)
            if str(agent).strip() and seconds is not None:
                agents[str(agent).strip()] = seconds
    return limit, warning, agents


def key_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _load_signer():
    raw = os.getenv("LICENSE_SIGNING_KEY", "").strip()
    if not raw:
        return None
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, _signer
    _signer = _load_signer()
    if _signer is None:
        print("WARNING: LICENSE_SIGNING_KEY is not set — /v2/verify will refuse every check.")
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        db_pool = await asyncpg.create_pool(database_url, min_size=1, max_size=10)
        await db_pool.execute(CALL_USAGE_SCHEMA)
        # The lookup reads these; never serve before they exist (init_db.py adds
        # them too).
        for statement in PIPELINE_COLUMNS:
            await db_pool.execute(statement)
    elif not MOCK_MODE:
        raise RuntimeError("DATABASE_URL is not set (set LICENSE_SERVER_MOCK=1 for local testing only)")
    else:
        print("WARNING: LICENSE_SERVER_MOCK=1 — answering from test keys, not the database.")
    yield
    if db_pool:
        await db_pool.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class TokenRequest(BaseModel):
    token: str = Field(min_length=8, max_length=200)


class VerifyRequest(TokenRequest):
    # Random, from the caller, echoed in the signed reply (replay protection).
    nonce: str = Field(min_length=16, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    product: str = Field(default="chakra-ivr-core", max_length=64)
    version: str = Field(default="", max_length=32)
    pipeline: str = Field(default="", max_length=32)
    app: str = Field(default="", max_length=120)


class UsageRequest(TokenRequest):
    # One report is one finished call. `seconds` is preferred; `minutes_used`
    # is what packages before 0.2 send.
    minutes_used: int | None = Field(default=None, ge=0, le=24 * 60)
    seconds: float | None = Field(default=None, ge=0, le=24 * 3600)
    pipeline: str = Field(default="unknown", max_length=32)


async def _lookup(token: str):
    if db_pool is None:
        return None
    return await db_pool.fetchrow(LOOKUP, key_hash(token), token)


def _refuse() -> HTTPException:
    # Same answer for unknown and disabled keys: don't confirm which keys exist.
    return HTTPException(status_code=401, detail="Unauthorized, invalid, or unpaid token")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "mode": "mock" if db_pool is None else "database",
        "signing": _signer is not None,
    }


@app.post("/verify")
async def verify_token(req: TokenRequest):
    """Is this CHAKRA_AUTH_TOKEN active and paid? (unsigned; packages before 0.2)"""
    if db_pool is None:
        if MOCK_VALID_TOKENS.get(req.token) is True:
            return {"status": "valid", "company": "Test Company"}
        raise _refuse()
    row = await _lookup(req.token)
    if row and row["is_active"]:
        return {"status": "valid", "company": row["company_name"]}
    raise _refuse()


@app.post("/v2/verify")
async def verify_signed(req: VerifyRequest):
    """Signed licence check for chakra-ivr-core 0.2+.

    Reply: ``{"payload": <base64 JSON>, "signature": <base64 Ed25519>}``. The
    package verifies the signature with the public key it carries, then that
    the payload's nonce is the one it sent and its key_hash is its own key's.
    """
    if _signer is None:
        raise HTTPException(status_code=503, detail="licence signing is not configured")
    if db_pool is None:
        if MOCK_VALID_TOKENS.get(req.token) is not True:
            raise _refuse()
        row = {"id": 0, "company_name": "Test Company", "package_name": "Essential", "is_active": True}
    else:
        row = await _lookup(req.token)
        if not row or not row["is_active"]:
            raise _refuse()
        row = dict(row)
    pipelines, agent_pipelines = _pipelines(row)
    daily_limit, limit_warning, agent_daily_limits = _daily_limits(row)
    payload = {
        "status": "valid",
        "license_id": row["id"],
        "company": row["company_name"],
        "package": row["package_name"],
        # Which pipelines this licence may run (first = default) and any agents
        # pinned to one. Empty: not assigned, the client's configuration decides.
        "pipelines": pipelines,
        "agent_pipelines": agent_pipelines,
        # Daily talk time per caller, in seconds (0 = none); chakra-ivr-core
        # 0.5+ enforces it. Older packages ignore these fields.
        "daily_limit_seconds": daily_limit,
        "limit_warning_seconds": limit_warning,
        "agent_daily_limits": agent_daily_limits,
        "key_hash": key_hash(req.token),
        "nonce": req.nonce,
        "issued_at": int(time.time()),
    }
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return {
        "payload": base64.b64encode(body).decode(),
        "signature": base64.b64encode(_signer.sign(body)).decode(),
    }


@app.post("/track-usage")
async def track_usage(req: UsageRequest):
    """Record a finished call against the key."""
    if req.seconds is None and req.minutes_used is None:
        raise HTTPException(status_code=422, detail="seconds or minutes_used is required")
    seconds = float(req.seconds if req.seconds is not None else (req.minutes_used or 0) * 60)
    minutes = math.ceil(seconds / 60) if seconds > 0 else 0
    pipeline = req.pipeline if req.pipeline in PIPELINES else "unknown"
    if db_pool is None:
        return {"status": "mock_updated", "added_seconds": seconds}

    row = await _lookup(req.token)
    if row is None or not row["is_active"]:
        raise _refuse()
    async with db_pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
            INSERT INTO call_usage (license_id, hour, pipeline, calls, call_seconds)
            VALUES ($1, date_trunc('hour', now()), $2, 1, $3)
            ON CONFLICT (license_id, hour, pipeline) DO UPDATE SET
                calls = call_usage.calls + 1,
                call_seconds = call_usage.call_seconds + EXCLUDED.call_seconds
            """,
            row["id"],
            pipeline,
            seconds,
        )
        new_total = await conn.fetchval(
            "UPDATE licenses SET used_minutes = used_minutes + $1 WHERE id = $2 RETURNING used_minutes",
            minutes,
            row["id"],
        )
    return {"status": "updated", "total_minutes": new_total}
