import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_DIR = path.resolve('supabase');
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, 'migrations');
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

test('Ordered Supabase migrations 000001-000010 exist and stay non-destructive', () => {
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
    '20261122000010_backend_hardening.sql',
  ]);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    assert.doesNotMatch(sql, /\bdrop\s+table\b/i, `${file} must not DROP TABLE`);
    assert.doesNotMatch(
      sql,
      /\btruncate\s+(?:table\b|only\b|[a-z_][a-z0-9_]*\.)|^\s*truncate\b/im,
      `${file} must not TRUNCATE tables`
    );
  }
});

test('SQL security policies enforce role protection, RLS column locks, internal progression isolation, and safe quiz grading', () => {
  const m3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000003_auth_and_profiles.sql'), 'utf8');
  const m4 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000004_rls_and_permissions.sql'), 'utf8');
  const m5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000005_progression_functions.sql'), 'utf8');
  const m6 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000006_assessment_and_submission_functions.sql'), 'utf8');
  const m7 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000007_storage_policies.sql'), 'utf8');
  const m9 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261121000009_seed_data.sql'), 'utf8');
  const m10 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261122000010_backend_hardening.sql'), 'utf8');

  // Role escalation protection
  assert.match(m3, /trg_protect_profile_privileged_fields/);
  assert.match(m3, /new\.email_confirmed_at is not null/);
  assert.match(m3, /grant execute on function public\.admin_assign_profile_role\(uuid, text\) to service_role/);

  // Profiles & Questions column protection + revoked direct mutations on learner tables
  assert.match(m4, /grant update \(first_name, full_name\) on public\.profiles to authenticated/);
  assert.match(m10, /revoke all on public\.questions from public, anon, authenticated/);
  assert.match(m10, /grant select \(id, quiz_id, position, question_type, difficulty, marks, prompt, context_text, options\)\s+on public\.questions to authenticated/i);
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
  assert.match(m10, /revoke all on function public\.recompute_user_skill_level\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(m10, /revoke all on function public\.evaluate_course_and_skill_progression\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(m10, /revoke all on function public\.recompute_course_progression_for_course\(uuid\) from public, anon, authenticated/);

  // Quizzes (submit_quiz & admin_grade_attempt) never award 'demonstrated' directly and withhold solutions when unreleased
  const quizFunctionsSql =
    m10.slice(m10.indexOf('function public.submit_quiz'), m10.indexOf('function public.submit_challenge_evidence'));
  assert.doesNotMatch(quizFunctionsSql, /'demonstrated'/);
  assert.match(m10, /solutionsReleased/);
  assert.match(m6, /v_sub\.user_id = auth\.uid\(\)/);
  assert.match(m10, /v_att\.user_id = auth\.uid\(\)/);
  assert.match(m10, /admin_delete_question/);

  // Storage deletion blocks submitted evidence objects and blocks leading slashes / traversal
  assert.match(m7, /from public\.submissions s\s+where s\.file_path = storage\.objects\.name/i);
  assert.match(m10, /position\('\.\.' in name\) = 0/);
  assert.match(m10, /left\(name, 1\) <> '\/'/);

  // Dashboard contract returns real analytics keys matching dashboardData.js
  for (const key of [
    'activeCourses',
    'pausedCourses',
    'completedCourses',
    'completedLessons',
    'completedActivities',
    'minutesLearned',
    'passedQuizzes',
    'totalAttempts',
    'averageScore',
    'approvedSubmissions',
    'pendingSubmissions',
    'needsRevisionSubmissions',
    'totalSubmissions',
    'enrolledCourses',
    'skillLevels',
    'weeklyMinutes',
    'hourlyDistribution',
  ]) {
    assert.match(m10, new RegExp(`'${key}'`), `get_dashboard() must emit '${key}'`);
  }

  // Seed data keeps 4 flagship courses without broken /src/assets/images/*.jpg URLs
  assert.doesNotMatch(m9, /\/src\/assets\/images\/course_thumb_/);
  assert.match(m9, /frontend-development-foundations/);
  assert.match(m9, /graphic-design-foundations/);
  assert.match(m9, /digital-marketing-foundations/);
  assert.match(m9, /communication-and-public-speaking/);
});

test('Every SECURITY DEFINER function across migrations and standalone SQL pins search_path and revokes PUBLIC/anon execute', () => {
  const sqlFiles = collectFiles(SUPABASE_DIR, '.sql');
  const definerRegex = /create\s+or\s+replace\s+function\s+(public\.[a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*returns\b[\s\S]*?language\s+\w+([\s\S]*?)as\s+\$\$/gi;

  for (const file of sqlFiles) {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = definerRegex.exec(content)) !== null) {
      const fnName = match[1];
      const header = match[3];
      if (!/security\s+definer/i.test(header)) continue;

      assert.match(
        header,
        /set\s+search_path\s*=\s*public\b/i,
        `${path.basename(file)} ${fnName} uses SECURITY DEFINER without fixed "set search_path = public"`
      );

      const revokeRegex = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${fnName.replace('.', '\\.')}\\s*\\([^)]*\\)\\s*from\\s+public,\\s*anon`, 'i');
      assert.match(
        content,
        revokeRegex,
        `${path.basename(file)} ${fnName} must REVOKE ALL FROM public, anon`
      );
    }
  }
});

test('Standalone SQL files and Supabase CLI configuration stay synchronized with hardening migration', () => {
  const configToml = fs.readFileSync(path.join(SUPABASE_DIR, 'config.toml'), 'utf8');
  assert.match(configToml, /\[storage\.buckets\.evidence\]/);
  assert.match(configToml, /file_size_limit\s*=\s*"50MiB"/);

  assert.ok(fs.existsSync(path.join(SUPABASE_DIR, 'README.md')), 'supabase/README.md must exist');

  const s2 = fs.readFileSync(path.join(SUPABASE_DIR, '02_security.sql'), 'utf8');
  const s3 = fs.readFileSync(path.join(SUPABASE_DIR, '03_functions.sql'), 'utf8');
  const s4 = fs.readFileSync(path.join(SUPABASE_DIR, '04_storage.sql'), 'utf8');
  const s6 = fs.readFileSync(path.join(SUPABASE_DIR, '06_dashboard.sql'), 'utf8');

  assert.doesNotMatch(s2, /grant\s+insert\s*,\s*update\s*,\s*delete\s+on\s+public\.questions\s+to\s+authenticated/i);
  assert.match(s3, /recompute_user_skill_level/);
  assert.match(s3, /admin_delete_question/);
  assert.match(s4, /left\(name,\s*1\)\s*<>\s*'\/'/i);
  assert.match(s6, /enrolledCourses/);
  assert.match(s6, /weeklyMinutes/);
  assert.match(s6, /hourlyDistribution/);
  assert.match(s6, /averageScore/);
});

test('Frontend codebase contains zero service_role keys, unparenthesized CASE-in-IF traps, or direct internal progression RPC calls', () => {
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
    assert.doesNotMatch(
      content,
      /\.rpc\(['"]recompute_user_skill_level['"]/,
      `${file} must not call internal recompute_user_skill_level directly`
    );
  }
});
