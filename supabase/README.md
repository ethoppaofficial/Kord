# Kord Supabase Schema, Migrations, and Verification Guide

This directory contains the authoritative PostgreSQL schema, Row Level Security (RLS) policies, storage policies, progression/assessment RPCs, dashboard RPCs, and seed data for Kord.

## Ordered Versioned Migrations

Run migrations strictly in timestamp order inside `supabase/migrations/`:

1. `20261121000001_extensions_and_schema.sql` — Extensions (`pgcrypto`) and core tables.
2. `20261121000002_constraints_and_indexes.sql` — Foreign-key/check/uniqueness constraints and query indexes.
3. `20261121000003_auth_and_profiles.sql` — `is_admin()`, `handle_new_user()`, profile privilege protection trigger, and `admin_assign_profile_role()` (`service_role` only).
4. `20261121000004_rls_and_permissions.sql` — Table-level RLS enablement, column-restricted `profiles`/`questions` grants, and learner isolation policies.
5. `20261121000005_progression_functions.sql` — Internal progression functions and authenticated learner RPCs (`declare_user_skill`, `enroll_in_course`, `set_course_enrollment_status`, `save_lesson_notes`, `set_lesson_completion`, `set_activity_completion`).
6. `20261121000006_assessment_and_submission_functions.sql` — Quiz grading (`submit_quiz`, `admin_grade_attempt`), practical submissions (`submit_challenge_evidence`, `review_submission`), and admin curriculum RPCs (`admin_get_quiz_questions`, `admin_upsert_question`, `admin_reorder_phases`, `admin_reorder_lessons`, `admin_create_course_version`).
7. `20261121000007_storage_policies.sql` — Private `evidence` bucket (50 MiB limit, allowlisted MIME types) and folder/orphan-only storage policies.
8. `20261121000008_dashboard_functions.sql` — Initial `get_dashboard()` RPC.
9. `20261121000009_seed_data.sql` — Idempotent seed categories, skills, 4 flagship courses, assessments, challenges, and sample opportunities.
10. `20261122000010_backend_hardening.sql` — Forward-only hardening pass:
    - Tightens `anon`/`public` revocations and revokes direct `questions` DML from `authenticated`.
    - Adds `recompute_user_skill_level()` (enforces quizzes and zero-challenge courses never award `demonstrated` or `verified`, and supports downward recalculation on uncompletion, revision requests, grade reductions, or curriculum changes).
    - Adds `trg_recompute_on_curriculum_change()` triggers across `courses`, `phases`, `lessons`, `activities`, `quizzes`, and `challenges`.
    - Hardens `submit_quiz()`, `admin_grade_attempt()`, `admin_upsert_question()`, and adds `admin_delete_question()`.
    - Hardens `submit_challenge_evidence()` and `review_submission()` (evidence type, MIME type, size limit, storage ownership, non-reuse, and strict rubric validation).
    - Updates `get_dashboard()` to return full `learning`, `understanding`, `demonstrating`, `enrolledCourses`, `skillLevels`, 9-week `weeklyMinutes`, and 6-bucket `hourlyDistribution` metrics from real database rows.

## Synchronized Standalone SQL Files

If bootstrapping outside Supabase CLI migrations, execute in this exact order:

1. `01_schema.sql` (synchronized with `000001`–`000002`)
2. `02_security.sql` (synchronized with `000003`–`000004` + `000010`)
3. `03_functions.sql` (synchronized with `000005`–`000006` + `000010`)
4. `04_storage.sql` (synchronized with `000007` + `000010`)
5. `05_seed.sql` (synchronized with `000009`)
6. `06_dashboard.sql` (synchronized with `000008` + `000010`)

## Local & Remote Workflows

```bash
# Start local Supabase stack (requires Docker + Supabase CLI)
npx supabase start

# Reset local database and apply all migrations 000001-000010 cleanly
npx supabase db reset

# Link and push migrations to a target remote project (never commit credentials)
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

## Security & Progression Review Checklist

- Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in client env only; never expose `service_role` in `src/` or browser bundles.
- All `SECURITY DEFINER` RPCs pin `set search_path = public` and revoke `public`/`anon` execute grants.
- Quizzes and theory-only courses max out skill levels at `practising`; `demonstrated` and `verified` strictly require approved practical deliverables.
- All client progress, assessment, submission, and dashboard queries rely on database-enforced `auth.uid()` ownership and RPC validation.
