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
11. `20261123000011_remediation_hardening.sql` — Security, governance, and integrity remediation:
    - Removes hardcoded email auto-admin promotion from `handle_new_user()` so all public signups unconditionally create `role = 'learner'`, `account_status = 'active'`.
    - Adds `account_status` (`active` | `suspended`), `is_active_learner()`, and caller-aware `is_trusted_service_context()` protection.
    - Adds server-side timed assessment enforcement (`quiz_sessions`, `start_quiz_session()`, and expiry checks in `submit_quiz()`).
    - Adds `trg_validate_course_publish_readiness` enforcing complete modules, lessons, assessments, and challenge rubrics prior to course publishing.
    - Adds immutable `admin_audit_logs` + triggers and `admin_list_users()` / `admin_set_account_status()` governance RPCs.
    - Adds complete foreign-key indexes across all schema tables.
12. `20261123000012_complete_99_skill_pathways.sql` — Complete 99-skill pathway expansion:
    - Upserts all 7 categories, 99 skills (`roadmap_status = 'full'`), 63 published domain & flagship courses, `course_skills` associations (every skill covered by >= 1 published course), 386 phases, 772 lessons, lesson resources, 386 activities, 127 assessments + 576 questions, and 63 capstone challenges.

## Synchronized Standalone SQL Files

If bootstrapping outside Supabase CLI migrations, execute in this exact order:

1. `01_schema.sql` (synchronized with `000001`–`000002` + `000011`)
2. `02_security.sql` (synchronized with `000003`–`000004` + `000010`–`000011`)
3. `03_functions.sql` (synchronized with `000005`–`000006` + `000010`–`000011`)
4. `04_storage.sql` (synchronized with `000007` + `000010`)
5. `05_seed.sql` (synchronized with `000009` + `000012`)
6. `06_dashboard.sql` (synchronized with `000008` + `000010`–`000011`)

## Secure First-Administrator Provisioning

Kord **never** auto-promotes administrators by email address in database triggers, and **never** ships default administrative credentials in frontend code or SQL seeds.

To provision your first production administrator safely:

1. Create the user account normally through Supabase Auth (sign up in the app UI or **Authentication → Users → Add user** in the Supabase Dashboard) using a unique, high-entropy password and verified email. New accounts are always created with `role = 'learner'`.
2. Copy the new user's UUID from `auth.users` / **Authentication → Users**.
3. Promote that exact UUID from a **trusted `service_role` or `postgres` SQL Editor session** (never from the browser or client `anon` key):

```sql
select public.admin_assign_profile_role('<user-uuid>'::uuid, 'admin');
```

4. Confirm in `public.profiles` and `public.admin_audit_logs` that `role` updated to `'admin'` and the change was recorded.

## Local & Remote Workflows

```bash
# Start local Supabase stack (requires Docker + Supabase CLI)
npx supabase start

# Reset local database and apply all migrations 000001-000012 cleanly
npx supabase db reset

# Link and push migrations to a target remote project (never commit credentials)
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

## Security & Progression Review Checklist

- Keep only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in production builds; never expose `service_role` keys or enable `VITE_ALLOW_DEMO_MODE` in production.
- All `SECURITY DEFINER` RPCs pin `set search_path = public` and revoke `public`/`anon` execute grants.
- PostgREST queries joining `courses` and `skills` qualify exact FK constraint names (`!courses_skill_id_fkey`, `!course_skills_course_id_fkey`, `!course_skills_skill_id_fkey`).
- Quizzes and theory-only courses max out skill levels at `practising`; `demonstrated` and `verified` strictly require approved practical deliverables.
- All client progress, timed quiz sessions, submission reviews, and dashboard queries rely on database-enforced `auth.uid()`, active `account_status`, and RPC validation.

## Password Recovery, Google Sign-In & Auth URL Configuration

To run password reset and Google Sign-In against a real Supabase project (**Authentication → URL Configuration**, **Authentication → Sign In / Providers**, and **Authentication → Email Templates**), configure these settings without committing or exposing secret keys:

- **Site URL**
  - Local development (`supabase/config.toml`): `http://localhost:3000`
  - AI Studio Dev / Shared preview: `https://ais-dev-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app` or `https://ais-pre-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app`
  - Production: `https://<your-production-domain>` (and optionally set `VITE_SITE_URL=https://<your-production-domain>` in your build environment)
- **Redirect URL Allowlist (`additional_redirect_urls`)**
  - Local development:
    - `http://localhost:3000/reset-password`
    - `http://localhost:3000/auth/callback`
  - AI Studio Dev / Shared preview:
    - `https://ais-dev-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app/reset-password`
    - `https://ais-dev-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app/auth/callback`
    - `https://ais-pre-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app/reset-password`
    - `https://ais-pre-4bmcxts2gpl7n5lowmiyw3-371147082506.europe-west2.run.app/auth/callback`
  - Production deployment:
    - `https://<your-production-domain>/reset-password`
    - `https://<your-production-domain>/auth/callback`
- **Google OAuth Provider Setup**
  - In Google Cloud Console (**APIs & Services → Credentials → OAuth 2.0 Client IDs**), add your Supabase project's OAuth callback URI as an **Authorized redirect URI**:
    - `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
  - In **Supabase Dashboard → Authentication → Sign In / Providers → Google**, enable Google and paste your Google Client ID and Client Secret (never commit client secrets to the repository).
  - First-time Google sign-ins create a `public.profiles` row via `handle_new_user()` unconditionally as `role = 'learner'` and `account_status = 'active'`. Existing administrator roles promoted via `admin_assign_profile_role` are preserved on sign-in.
- **Reset Password Email Template Requirements**
  - The Supabase client in `src/lib/supabase.js` uses `flowType: 'pkce'` and tab-scoped `window.sessionStorage` (`storageKey: 'kord-auth'`), and `recoverPassword()` sends an allowlisted `redirectTo` ending in `/reset-password`.
  - Default PKCE link (`{{ .ConfirmationURL }}`) redirects to `/reset-password?code=...` and requires completing recovery in the same browser tab where the reset email was requested (because the PKCE code verifier lives in `sessionStorage`).
  - **Recommended cross-tab / cross-browser email template**: Use `token_hash` verification so users clicking the email link in a new tab or separate mail app verify cleanly via `supabase.auth.verifyOtp({ token_hash, type: 'recovery' })`:

```html
<h2>Reset your Kord password</h2>
<p>Follow the link below to set a new password:</p>
<p><a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">Reset Password</a></p>
```

- **Local Email Testing**: When running `npx supabase start`, Supabase CLI captures outgoing recovery emails in local Inbucket/Mailpit (`http://localhost:54324`). Production email delivery, live Google OAuth consent, and real token exchange must be verified manually against your target Supabase project.

