import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const SRC_DIR = path.resolve('src');

function collectFiles(dir, extFilter) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, extFilter));
    else if (!extFilter || entry.name.endsWith(extFilter)) out.push(full);
  }
  return out;
}

test('Ordered Supabase migrations 000001-000009 exist and stay non-destructive', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files, [
    '20261121000001_extensions_and_schema.sql',
    '20261121000002_constraints_and_indexes.sql',
    '20261121000003_auth_and_profiles.sql',
    '20261121000004_rls_and_permissions.sql',
    '20261121000005_progression_functions.sql',
    '20261121000006_assessment_and_submission_functions.sql',
    '20261121000007_storage_policies.sql',
    '20261121000008_dashboard_functions.sql',
    '20261121000009_seed_data.sql',
  ]);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    assert.doesNotMatch(sql, /\bdrop\s+table\b/i, `${file} must not DROP TABLE`);
    assert.doesNotMatch(sql, /\btruncate\b/i, `${file} must not TRUNCATE`);
  }
});

test('SQL security policies enforce role protection, RLS column locks, internal progression isolation, and safe quiz grading', () => {
  const m3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000003_auth_and_profiles.sql'), 'utf8');
  const m4 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000004_rls_and_permissions.sql'), 'utf8');
  const m5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000005_progression_functions.sql'), 'utf8');
  const m6 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000006_assessment_and_submission_functions.sql'), 'utf8');
  const m7 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000007_storage_policies.sql'), 'utf8');
  const m9 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000009_seed_data.sql'), 'utf8');

  // Role escalation protection
  assert.match(m3, /trg_protect_profile_privileged_fields/);
  assert.match(m3, /new\.email_confirmed_at is not null/);
  assert.match(m3, /grant execute on function public\.admin_assign_profile_role\(uuid, text\) to service_role/);

  // Profiles & Questions column protection + revoked direct mutations on learner tables
  assert.match(m4, /grant update \(first_name, full_name\) on public\.profiles to authenticated/);
  assert.match(m4, /revoke all on public\.questions from public, anon, authenticated/);
  assert.match(m4, /grant select \(id, quiz_id, position, question_type, difficulty, marks, prompt, context_text, options\) on public\.questions to authenticated/);
  for (const tbl of [
    'course_enrollments',
    'course_completions',
    'lesson_progress',
    'enrollments',
    'activity_progress',
    'quiz_attempts',
    'user_skills',
    'submissions',
  ]) {
    assert.match(m4, new RegExp(`revoke all on public\\.${tbl} from public, anon, authenticated`));
  }

  // Internal progression RPCs never callable from client sessions
  assert.match(m5, /revoke all on function public\.upgrade_user_skill_level\(uuid, uuid, text\) from public, anon, authenticated/);
  assert.match(m5, /revoke all on function public\.evaluate_course_and_skill_progression\(uuid, uuid\) from public, anon, authenticated/);

  // Quizzes (submit_quiz & admin_grade_attempt) never award 'demonstrated' directly and withhold solutions when unreleased
  const quizFunctionsSql =
    m6.slice(m6.indexOf('function public.submit_quiz'), m6.indexOf('function public.submit_challenge_evidence')) +
    m6.slice(m6.indexOf('function public.admin_grade_attempt'), m6.indexOf('function public.admin_get_quiz_questions'));
  assert.doesNotMatch(quizFunctionsSql, /'demonstrated'/);
  assert.match(m6, /solutionsReleased/);
  assert.match(m6, /v_sub\.user_id = auth\.uid\(\)/);
  assert.match(m6, /v_att\.user_id = auth\.uid\(\)/);
  assert.match(m6, /admin_grade_attempt/);

  // Storage deletion blocks submitted evidence objects
  assert.match(m7, /from public\.submissions s\s+where s\.file_path = storage\.objects\.name/i);
  assert.match(m7, /position\('\.\.' in name\) = 0/);

  // Seed data keeps 4 flagship courses without broken /src/assets/images/*.jpg URLs
  assert.doesNotMatch(m9, /\/src\/assets\/images\/course_thumb_/);
  assert.match(m9, /frontend-development-foundations/);
  assert.match(m9, /graphic-design-foundations/);
  assert.match(m9, /digital-marketing-foundations/);
  assert.match(m9, /communication-and-public-speaking/);
});

test('Frontend codebase contains zero service_role keys or direct internal progression RPC calls', () => {
  const jsFiles = collectFiles(SRC_DIR, '.js');
  for (const file of jsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /service_role/i, `${file} must never reference service_role`);
    assert.doesNotMatch(
      content,
      /\.rpc\(['"]evaluate_course_and_skill_progression['"]/,
      `${file} must not call internal evaluate_course_and_skill_progression directly`
    );
    assert.doesNotMatch(
      content,
      /\.rpc\(['"]upgrade_user_skill_level['"]/,
      `${file} must not call internal upgrade_user_skill_level directly`
    );
  }
});
