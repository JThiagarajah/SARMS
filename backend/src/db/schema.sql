-- SARMS database schema (PostgreSQL).
-- Mirrors the project proposal's ER diagram (Section 3.5), extended with the
-- seven-role access model and the versioned marking-scheme settings feature.
--
-- Applied automatically on every backend startup (see src/db/client.ts) — every
-- statement below is idempotent (IF NOT EXISTS), so this is safe to re-run against
-- an existing database and upgrades a running install without losing data.
-- Foreign keys are always enforced by PostgreSQL, so there is no SQLite-style
-- PRAGMA needed here.

CREATE TABLE IF NOT EXISTS departments (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  faculty TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS degree_programmes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  department_id TEXT NOT NULL REFERENCES departments(id),
  honours_flag  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(department_id, name)
);

-- role: STUDENT | LECTURER | HOD | DEAN | CHAIRMAN_EXAM_BRANCH | EXAMINATION_BRANCH | SUPER_ADMIN
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  username              TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL UNIQUE,
  -- Personal/recovery email, separate from the institutional `email` above. Optional — set by the
  -- Super Admin when creating the account (or left blank). Used only by the forgot-password flow:
  -- the user must supply this exact address before an OTP is issued, and the OTP is sent here.
  personal_email        TEXT,
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  active                INTEGER NOT NULL DEFAULT 1,
  department_id         TEXT REFERENCES departments(id),
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);

-- One-time-password password-reset requests ("forgot password" flow). A row is created whenever
-- someone requests a reset for a username whose personal_email matches what they typed; the OTP
-- itself is never stored in plaintext, only its hash. Superseded-but-unused rows are simply
-- ignored (see the reset-password route), so no cleanup job is required.
CREATE TABLE IF NOT EXISTS password_resets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash     TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS students (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  registration_no TEXT NOT NULL UNIQUE,
  programme_id    TEXT NOT NULL REFERENCES degree_programmes(id),
  level           INTEGER NOT NULL,
  admission_year  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_programme ON students(programme_id);

CREATE TABLE IF NOT EXISTS lecturers (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES departments(id),
  designation   TEXT
);
CREATE INDEX IF NOT EXISTS idx_lecturers_department ON lecturers(department_id);
-- staff_code/qualification: captured by the lecturer teaching-profile bulk import (an external
-- staff reference code and free-text qualification) — nullable, informational, nothing else in
-- SARMS reads them yet.
ALTER TABLE lecturers ADD COLUMN IF NOT EXISTS staff_code TEXT;
ALTER TABLE lecturers ADD COLUMN IF NOT EXISTS qualification TEXT;

-- category: CORE | ELECTIVE | ACU
-- component_type: THEORY_ONLY | PRACTICAL_ONLY | BOTH
CREATE TABLE IF NOT EXISTS course_units (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  theory_credit    REAL NOT NULL DEFAULT 0,
  practical_credit REAL NOT NULL DEFAULT 0,
  category         TEXT NOT NULL DEFAULT 'CORE',
  component_type   TEXT NOT NULL DEFAULT 'THEORY_ONLY',
  programme_id     TEXT NOT NULL REFERENCES degree_programmes(id),
  level            INTEGER NOT NULL,
  semester         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courseunits_programme ON course_units(programme_id);
-- weekly_hours/theory_hours/practical_hours: contact-hour counts captured by the course bulk
-- import — separate from theory_credit/practical_credit (academic weight, drives grading) above.
-- Nullable and purely informational: nothing in the grading engine reads these.
ALTER TABLE course_units ADD COLUMN IF NOT EXISTS weekly_hours INTEGER;
ALTER TABLE course_units ADD COLUMN IF NOT EXISTS theory_hours INTEGER;
ALTER TABLE course_units ADD COLUMN IF NOT EXISTS practical_hours INTEGER;

CREATE TABLE IF NOT EXISTS course_offerings (
  id             TEXT PRIMARY KEY,
  course_id      TEXT NOT NULL REFERENCES course_units(id),
  lecturer_id    TEXT NOT NULL REFERENCES lecturers(user_id),
  academic_year  TEXT NOT NULL,
  semester       INTEGER NOT NULL,
  assigned_by_id TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  UNIQUE(course_id, academic_year, semester)
);
CREATE INDEX IF NOT EXISTS idx_offerings_lecturer ON course_offerings(lecturer_id);
-- Loosened so deleting the Super Admin who assigned an offering doesn't have to also delete the
-- offering itself (see lib/cascadeDelete.ts) — the offering isn't that admin's data, it's the
-- course's and the lecturer's, and it should survive with this "who assigned it" attribution
-- simply cleared.
ALTER TABLE course_offerings ALTER COLUMN assigned_by_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS enrollments (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES students(user_id),
  offering_id    TEXT NOT NULL REFERENCES course_offerings(id),
  enrolled_by_id TEXT NOT NULL REFERENCES users(id),
  enrolled_at    TEXT NOT NULL,
  UNIQUE(student_id, offering_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_offering ON enrollments(offering_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
-- Loosened for the same reason as course_offerings.assigned_by_id above — see lib/cascadeDelete.ts.
ALTER TABLE enrollments ALTER COLUMN enrolled_by_id DROP NOT NULL;

-- Versioned curriculum & marking-scheme settings, owned by Dean or HOD. A result computed
-- under a prior scheme keeps showing the formula in effect at the time — editing this row
-- never rewrites history because Result stores its own computed m1/m2/final_mark.
CREATE TABLE IF NOT EXISTS marking_schemes (
  id                          TEXT PRIMARY KEY,
  department_id               TEXT NOT NULL REFERENCES departments(id),
  academic_year                TEXT NOT NULL,
  theory_ese_weight            REAL NOT NULL DEFAULT 0.70,
  theory_ica_weight            REAL NOT NULL DEFAULT 0.30,
  practical_ese_weight         REAL NOT NULL DEFAULT 0.60,
  practical_ica_weight         REAL NOT NULL DEFAULT 0.40,
  ica_best_of_count            INTEGER NOT NULL DEFAULT 2,
  ica_total_count              INTEGER NOT NULL DEFAULT 3,
  acu_min_pass_grade           TEXT NOT NULL DEFAULT 'D+',
  core_min_pass_grade          TEXT NOT NULL DEFAULT 'C-',
  language_acu_min_pass_grade  TEXT NOT NULL DEFAULT 'C',
  active                       INTEGER NOT NULL DEFAULT 1,
  created_by_id                TEXT NOT NULL REFERENCES users(id),
  created_at                   TEXT NOT NULL,
  UNIQUE(department_id, academic_year)
);
-- Loosened for the same reason as course_offerings.assigned_by_id above — see lib/cascadeDelete.ts.
ALTER TABLE marking_schemes ALTER COLUMN created_by_id DROP NOT NULL;

-- component: THEORY | PRACTICAL
CREATE TABLE IF NOT EXISTS ica_instruments (
  id           TEXT PRIMARY KEY,
  offering_id  TEXT NOT NULL REFERENCES course_offerings(id),
  name         TEXT NOT NULL,
  component    TEXT NOT NULL,
  max_marks    REAL NOT NULL,
  sequence_no  INTEGER NOT NULL,
  released     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ica_instruments_offering ON ica_instruments(offering_id);

CREATE TABLE IF NOT EXISTS ica_marks (
  id            TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES ica_instruments(id),
  student_id    TEXT NOT NULL REFERENCES students(user_id),
  mark          REAL NOT NULL,
  entered_at    TEXT NOT NULL,
  UNIQUE(instrument_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_ica_marks_student ON ica_marks(student_id);

-- status: ICA_OPEN | SUBMITTED | HOD_APPROVED | RELEASED
CREATE TABLE IF NOT EXISTS results (
  id                 TEXT PRIMARY KEY,
  enrollment_id      TEXT NOT NULL UNIQUE REFERENCES enrollments(id),
  ese_theory         REAL,
  ese_practical      REAL,
  m1                 REAL,
  m2                 REAL,
  final_mark         REAL,
  grade              TEXT,
  grade_point        REAL,
  status             TEXT NOT NULL DEFAULT 'ICA_OPEN',
  submitted_at       TEXT,
  submitted_by_id    TEXT REFERENCES users(id),
  hod_approved_at    TEXT,
  hod_approved_by_id TEXT REFERENCES users(id),
  released_at        TEXT,
  released_by_id     TEXT REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_status ON results(status);

CREATE TABLE IF NOT EXISTS result_versions (
  id            TEXT PRIMARY KEY,
  result_id     TEXT NOT NULL REFERENCES results(id),
  field_changed TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  changed_by_id TEXT NOT NULL REFERENCES users(id),
  changed_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_result_versions_result ON result_versions(result_id);
-- Loosened for the same reason as course_offerings.assigned_by_id above — see lib/cascadeDelete.ts.
ALTER TABLE result_versions ALTER COLUMN changed_by_id DROP NOT NULL;

-- status: PENDING | APPROVED | REJECTED
CREATE TABLE IF NOT EXISTS correction_requests (
  id             TEXT PRIMARY KEY,
  result_id      TEXT NOT NULL REFERENCES results(id),
  requested_by_id TEXT NOT NULL REFERENCES users(id),
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING',
  decided_by_id  TEXT REFERENCES users(id),
  decided_at     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_correction_requests_result ON correction_requests(result_id);
-- Loosened for the same reason as course_offerings.assigned_by_id above — see lib/cascadeDelete.ts.
ALTER TABLE correction_requests ALTER COLUMN requested_by_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS resit_attempts (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(user_id),
  course_id  TEXT NOT NULL REFERENCES course_units(id),
  attempt_no INTEGER NOT NULL,
  grade      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resit_attempts_student ON resit_attempts(student_id);

CREATE TABLE IF NOT EXISTS gpa_records (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students(user_id),
  level       INTEGER NOT NULL,
  gpa_value   REAL NOT NULL,
  computed_at TEXT NOT NULL,
  UNIQUE(student_id, level)
);

CREATE TABLE IF NOT EXISTS ogpa_records (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL UNIQUE REFERENCES students(user_id),
  ogpa_value     REAL NOT NULL,
  class_of_award TEXT,
  computed_at    TEXT NOT NULL
);

-- A lecturer-to-course assignment proposed via bulk Excel upload ("what a lecturer is capable of
-- teaching"), awaiting a one-click Accept/Reject from the Super Admin. Accepting creates a real
-- course_offerings row (the same thing the manual "Create an offering" form produces) and links
-- it back here via offering_id; rejecting just marks the row REJECTED and nothing else happens.
-- status: PENDING | APPROVED | REJECTED
CREATE TABLE IF NOT EXISTS lecturer_assignment_requests (
  id             TEXT PRIMARY KEY,
  lecturer_id    TEXT NOT NULL REFERENCES users(id),
  course_id      TEXT NOT NULL REFERENCES course_units(id),
  academic_year  TEXT NOT NULL,
  semester       INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING',
  offering_id    TEXT REFERENCES course_offerings(id),
  uploaded_by_id TEXT NOT NULL REFERENCES users(id),
  uploaded_at    TEXT NOT NULL,
  decided_by_id  TEXT REFERENCES users(id),
  decided_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_lecturer_assignment_requests_status ON lecturer_assignment_requests(status);
-- Loosened for the same reason as course_offerings.assigned_by_id above — see lib/cascadeDelete.ts.
-- (lecturer_id is untouched: a request naming a since-deleted lecturer is deleted outright, since
-- it exists to propose work for that exact lecturer — see cascadeDeleteUser.)
ALTER TABLE lecturer_assignment_requests ALTER COLUMN uploaded_by_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  meta        TEXT,
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type);

-- The Places feature (a standalone room/lecture-hall catalog) was removed — dropped rather than
-- left behind, so a database that already had it applied gets cleaned up too. Safe to leave this
-- statement here permanently: it's a no-op once the table is gone.
DROP TABLE IF EXISTS places;
