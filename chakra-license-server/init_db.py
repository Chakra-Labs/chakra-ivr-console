"""Create (or bring up to date) the `licenses` table.

    DATABASE_URL=postgresql://... python init_db.py

The connection string comes from the environment only — never put it in this
file. (It used to be hard-coded here and was committed; that password must be
rotated in Neon.)
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

MIGRATIONS = sorted((Path(__file__).parent / "migrations").glob("*.sql"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS licenses (
    id            SERIAL PRIMARY KEY,
    token         TEXT UNIQUE,              -- legacy plaintext; NULL once migrated
    token_hash    TEXT UNIQUE,              -- sha256(key) hex: what lookups use
    token_prefix  TEXT,                     -- first 16 characters, for display
    company_name  TEXT NOT NULL,
    package_name  TEXT,
    is_active     BOOLEAN DEFAULT true,
    used_minutes  INTEGER DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""


# Added 2026-10-03: which voice pipelines a licence may run. `pipelines` is
# ordered — the first is the default; empty means "not assigned" (the client's
# own configuration decides, as before). `agent_pipelines` pins named agents.
# Additive, safe to re-run.
PIPELINE_COLUMNS = (
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS pipelines TEXT[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS agent_pipelines JSONB NOT NULL DEFAULT '{}'::jsonb",
    # Added 2026-10-05: daily talk time per caller (0 = none), the warning before
    # it runs out, and agents with their own limit ({agent: minutes}).
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS daily_limit_minutes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS limit_warning_seconds INTEGER NOT NULL DEFAULT 60",
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS agent_daily_limits JSONB NOT NULL DEFAULT '{}'::jsonb",
    # Added 2026-10-07: the voice callers hear. Gemini Live lines: a preset name.
    # The preset voice of the licence's Gemini Live lines (NULL = the app's own).
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS gemini_voice TEXT",
    "ALTER TABLE licenses ADD COLUMN IF NOT EXISTS greeting_mode TEXT",
)

# Added 2026-10-07: a licence's recorded greeting opening, uploaded in IVR Console
# (the hub's api/greeting and chakra-gpu-fleet's schema.sql create it too).
LICENSE_GREETINGS = """
CREATE TABLE IF NOT EXISTS license_greetings (
    license_id    INTEGER PRIMARY KEY,
    greeting_id   TEXT NOT NULL,
    audio         BYTEA NOT NULL,
    transcript    TEXT NOT NULL,
    seconds       REAL NOT NULL DEFAULT 0,
    file_name     TEXT,
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""



# Added 2026-10-05: IVR Console sign-ins for companies, one per licence (the hub
# also creates this on first use; see chakra-license-hub/src/lib/console-users.ts).
CONSOLE_USERS = """
CREATE TABLE IF NOT EXISTS console_users (
    id                  SERIAL PRIMARY KEY,
    license_id          INTEGER NOT NULL UNIQUE REFERENCES licenses(id) ON DELETE CASCADE,
    email               TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at       TIMESTAMPTZ
)
"""


# Added 2026-10-07: a licence's own Chakra TTS voice, a reference clip and its
# transcript uploaded in IVR Console and read by the speech gateway (the hub's
# src/lib/voices.ts and chakra-gpu-fleet's schema.sql create it too).
LICENSE_VOICES = """
CREATE TABLE IF NOT EXISTS license_voices (
    license_id    INTEGER PRIMARY KEY,
    voice_id      TEXT NOT NULL,
    audio         BYTEA NOT NULL,
    transcript    TEXT NOT NULL,
    seconds       REAL NOT NULL DEFAULT 0,
    file_name     TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    status_detail TEXT NOT NULL DEFAULT '',
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


async def init_db() -> None:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        sys.exit("DATABASE_URL is not set")
    conn = await asyncpg.connect(url)
    try:
        await conn.execute(SCHEMA)
        for statement in PIPELINE_COLUMNS:
            await conn.execute(statement)
        await conn.execute(CONSOLE_USERS)
        await conn.execute(LICENSE_VOICES)
        await conn.execute(LICENSE_GREETINGS)
        # Only the additive migration runs automatically; 002 (drop plaintext
        # keys) is irreversible and run by hand once hashed lookups are live.
        for path in MIGRATIONS:
            if path.name.startswith("001_"):
                await conn.execute(path.read_text(encoding="utf-8"))
                print(f"applied {path.name}")
        print("licenses table ready")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(init_db())
