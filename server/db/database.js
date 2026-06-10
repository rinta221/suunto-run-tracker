const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'tracker.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                      TEXT PRIMARY KEY,
    activity_type           TEXT NOT NULL DEFAULT 'running',
    source                  TEXT NOT NULL DEFAULT 'manual',
    session_type            TEXT,
    suunto_workout_id       TEXT,
    phase_id                TEXT,
    date                    TEXT NOT NULL,
    planned_menu            TEXT,
    menu                    TEXT,
    memo                    TEXT,
    locate                  TEXT,
    shoes                   TEXT,
    distance_km             REAL,
    duration_s              INTEGER,
    pace_per_km_s           INTEGER,
    avg_hr_pct              REAL,
    elevation_m             REAL,
    cadence_score           REAL,
    energy_kcal             INTEGER,
    title                   TEXT,
    trimp                   REAL,
    vo2max                  REAL,
    ground_contact_ms       REAL,
    gcb_left_pct            REAL,
    vertical_oscillation_cm REAL,
    cadence_max_spm         REAL,
    cadence_avg_spm         REAL,
    stride_length_cm        REAL,
    gc_balance              TEXT,
    impression              TEXT,
    claude_eval             TEXT,
    claude_eval_at          TEXT,
    gpt_eval                TEXT,
    gpt_eval_at             TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS phases (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT,
    color       TEXT DEFAULT '#3B82F6',
    notes       TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shoes (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    purchase_date TEXT,
    total_km      REAL DEFAULT 0,
    is_active     INTEGER DEFAULT 1,
    notes         TEXT
  );

  CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content_md  TEXT NOT NULL,
    report_type TEXT,
    start_date  TEXT,
    end_date    TEXT,
    is_active   INTEGER DEFAULT 1,
    priority    INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- v5: slot/result分離モデル（docs/suunto_design_v5.md 3.2）
  CREATE TABLE IF NOT EXISTS slots (
    id           TEXT PRIMARY KEY,
    date         TEXT NOT NULL,
    section      TEXT,
    slot_type    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'planned',
    plan_menu    TEXT,
    plan_notes   TEXT,
    plan_locate  TEXT,
    plan_shoes   TEXT,
    actual_menu  TEXT,
    memo         TEXT,
    impression   TEXT,
    phase_id     TEXT,
    source       TEXT DEFAULT 'manual',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS results (
    id                  TEXT PRIMARY KEY,
    slot_id             TEXT,
    suunto_workout_id   TEXT UNIQUE,
    raw_json_path       TEXT,
    start_time          TEXT,
    distance_km         REAL,
    duration_s          INTEGER,
    pace_per_km_s       INTEGER,
    avg_hr_bpm          INTEGER,
    elevation_m         REAL,
    energy_kcal         INTEGER,
    title               TEXT,
    trimp               REAL,
    vo2max              REAL,
    ground_contact_ms   REAL,
    gcb_left_pct        REAL,
    vertical_oscillation_cm REAL,
    cadence_avg_spm     INTEGER,
    cadence_max_spm     INTEGER,
    stride_length_cm    REAL,
    source              TEXT,
    imported_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id          TEXT PRIMARY KEY,
    slot_id     TEXT NOT NULL,
    ai          TEXT NOT NULL,
    text        TEXT,
    locked      INTEGER DEFAULT 0,
    created_at  TEXT,
    updated_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_slots_date ON slots(date);
  CREATE INDEX IF NOT EXISTS idx_results_slot ON results(slot_id);
  CREATE INDEX IF NOT EXISTS idx_evals_slot ON evaluations(slot_id);
`);

// Migration: add lock columns (idempotent)
try { db.exec('ALTER TABLE sessions ADD COLUMN claude_eval_locked INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE sessions ADD COLUMN gpt_eval_locked INTEGER DEFAULT 0'); } catch(e) {}
// Backfill: existing rows with gpt_eval should be locked (initial protection)
db.exec("UPDATE sessions SET gpt_eval_locked=1 WHERE gpt_eval IS NOT NULL AND gpt_eval != '' AND gpt_eval_locked=0");

module.exports = db;
