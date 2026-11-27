import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSupabasePglite,
  applyAllMigrations,
  applyStandaloneSql,
  asActor,
  createAuthUser,
} from './helpers/pgliteDb.mjs';

/** @typedef {import('./helpers/pgliteDb.mjs').PGliteInstance} PGliteInstance */

const SEEDED_FRONTEND_COURSE_SLUG = 'frontend-development-foundations';
const SEEDED_GRAPHICS_COURSE_SLUG = 'graphic-design-foundations';

async function setupMigratedDb() {
  const db = await createSupabasePglite();
  await applyAllMigrations(db);
  return db;
}

/** @param {PGliteInstance} db */
async function seedAdminAndLearners(db) {
  const admin = await createAuthUser(db, {
    email: 'ethoppaofficial@gmail.com',
    confirmed: true,
    firstName: 'Admin',
    fullName: 'Kord Admin',
  });
  const learnerA = await createAuthUser(db, {
    email: 'learner.a@example.com',
    confirmed: true,
    firstName: 'Learner',
    fullName: 'Learner Alpha',
  });
  const learnerB = await createAuthUser(db, {
    email: 'learner.b@example.com',
    confirmed: true,
    firstName: 'Learner',
    fullName: 'Learner Beta',
  });
  return { admin, learnerA, learnerB };
}

test('PostgreSQL Migrations 000001-000010 apply cleanly, stay idempotent on re-run, and match standalone bootstrap', async () => {
  const db = await setupMigratedDb();
  const initialCounts = await db.query(`
    select
      (select count(*)::int from public.categories) as cats,
      (select count(*)::int from public.skills) as skills,
      (select count(*)::int from public.courses) as courses,
      (select count(*)::int from public.quizzes) as quizzes,
      (select count(*)::int from public.challenges) as challenges,
      (select count(*)::int from public.opportunities) as opps
  `);
  assert.ok(initialCounts.rows[0].courses >= 4);
  assert.ok(initialCounts.rows[0].skills >= 4);

  // Re-applying all migrations must be idempotent and produce zero duplicates
  await applyAllMigrations(db);
  const secondCounts = await db.query(`
    select
      (select count(*)::int from public.categories) as cats,
      (select count(*)::int from public.skills) as skills,
      (select count(*)::int from public.courses) as courses,
      (select count(*)::int from public.quizzes) as quizzes,
      (select count(*)::int from public.challenges) as challenges,
      (select count(*)::int from public.opportunities) as opps
  `);
  assert.deepEqual(secondCounts.rows[0], initialCounts.rows[0]);

  // Standalone 01-06 bootstrap path produces equivalent schema, seed counts, and hardened functions
  const standaloneDb = await createSupabasePglite();
  await applyStandaloneSql(standaloneDb);
  await applyStandaloneSql(standaloneDb);
  const standaloneCounts = await standaloneDb.query(`
    select
      (select count(*)::int from public.categories) as cats,
      (select count(*)::int from public.skills) as skills,
      (select count(*)::int from public.courses) as courses,
      (select count(*)::int from public.quizzes) as quizzes,
      (select count(*)::int from public.challenges) as challenges,
      (select count(*)::int from public.opportunities) as opps
  `);
  assert.deepEqual(standaloneCounts.rows[0], initialCounts.rows[0]);
});

test('PostgreSQL Auth & Profiles: role escalation blocked, unconfirmed admin denied, service_role required for role assignment', async () => {
  const db = await setupMigratedDb();

  // Client metadata claiming role='admin' is ignored by handle_new_user
  const spoofedRes = await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values (gen_random_uuid(), 'spoofed@example.com', now(), '{"role":"admin","first_name":"Spoof"}'::jsonb)
     returning id`
  );
  const spoofedProfile = await db.query(
    `select role from public.profiles where id = $1::uuid`,
    [spoofedRes.rows[0].id]
  );
  assert.equal(spoofedProfile.rows[0].role, 'learner');

  // Unconfirmed designated admin email remains 'learner'
  const unconfirmedAdmin = await createAuthUser(db, {
    email: 'ethoppaofficial@gmail.com',
    confirmed: false,
    firstName: 'Pending',
  });
  assert.equal(unconfirmedAdmin.role, 'learner');

  // Confirmed designated admin email receives 'admin' (via on conflict update when confirmed)
  await db.query(`delete from auth.users where id = $1::uuid`, [unconfirmedAdmin.id]);
  const confirmedAdmin = await createAuthUser(db, {
    email: 'ethoppaofficial@gmail.com',
    confirmed: true,
    firstName: 'Confirmed',
  });
  assert.equal(confirmedAdmin.role, 'admin');

  const learner = await createAuthUser(db, {
    email: 'normal.learner@example.com',
    confirmed: true,
    firstName: 'Normal',
  });

  // Learner can update first_name/full_name
  await asActor(db, { role: 'authenticated', userId: learner.id }, async (tx) => {
    const upd = await tx.query(
      `update public.profiles set first_name = 'Updated', full_name = 'Normal Updated' where id = $1::uuid returning first_name, role`,
      [learner.id]
    );
    assert.equal(upd.rows[0].first_name, 'Updated');
    assert.equal(upd.rows[0].role, 'learner');
  });

  // Learner cannot escalate role via direct UPDATE (column grant + RLS + trigger)
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learner.id }, async (tx) => {
        await tx.query(`update public.profiles set role = 'admin' where id = $1::uuid`, [learner.id]);
      }),
    /permission denied|Privileged profile fields|row-level security/i
  );

  // Learner cannot invoke admin_assign_profile_role
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learner.id }, async (tx) => {
        await tx.query(`select public.admin_assign_profile_role($1::uuid, 'admin')`, [learner.id]);
      }),
    /permission denied/i
  );

  // service_role CAN invoke admin_assign_profile_role
  await asActor(db, { role: 'service_role' }, async (tx) => {
    const promoted = await tx.query(
      `select role from public.admin_assign_profile_role($1::uuid, 'admin')`,
      [learner.id]
    );
    assert.equal(promoted.rows[0].role, 'admin');
  });
});

test('PostgreSQL RLS & Grants: strict anon blocks, column locks on questions, cross-learner isolation, and internal RPC locks', async () => {
  const db = await setupMigratedDb();
  const { admin, learnerA, learnerB } = await seedAdminAndLearners(db);

  const courseRow = (
    await db.query(`select id, skill_id from public.courses where slug = $1`, [SEEDED_FRONTEND_COURSE_SLUG])
  ).rows[0];
  const quizRow = (
    await db.query(`select id from public.quizzes where course_id = $1::uuid limit 1`, [courseRow.id])
  ).rows[0];
  const lessonRow = (
    await db.query(
      `select l.id from public.lessons l join public.phases p on p.id = l.phase_id where p.course_id = $1::uuid limit 1`,
      [courseRow.id]
    )
  ).rows[0];

  // Learner A enrolls and completes 1 lesson
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    await tx.query(`select public.enroll_in_course($1::uuid)`, [courseRow.id]);
    await tx.query(`select public.set_lesson_completion($1::uuid, true)`, [lessonRow.id]);
  });

  // Anon can read published catalog tables without invoking is_admin(), but is denied private tables and all mutations
  await asActor(db, { role: 'anon' }, async (tx) => {
    for (const pubTable of ['categories', 'skills', 'courses', 'course_skills', 'phases', 'lessons', 'lesson_resources', 'activities', 'opportunities']) {
      const res = await tx.query(`select count(*)::int as n from public.${pubTable}`);
      assert.ok(res.rows[0].n >= 0, `anon should read ${pubTable}`);
    }
    const pubCourses = await tx.query(`select count(*)::int as n from public.courses`);
    assert.ok(pubCourses.rows[0].n >= 4);
  });

  // Learner cannot mutate catalog tables (blocked by catalog_admin_* RLS)
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(`insert into public.opportunities (title, organization) values ('Fake', 'Hack')`)
      ),
    /row-level security/i
  );

  for (const table of ['profiles', 'quizzes', 'questions', 'challenges', 'submissions', 'quiz_attempts', 'user_skills']) {
    await assert.rejects(
      () =>
        asActor(db, { role: 'anon' }, async (tx) => {
          await tx.query(`select * from public.${table} limit 1`);
        }),
      /permission denied/i,
      `anon must not select from ${table}`
    );
  }

  // Learner cannot select secret answer columns from public.questions
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
        await tx.query(`select id, correct_index from public.questions where quiz_id = $1::uuid`, [quizRow.id]);
      }),
    /permission denied/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
        await tx.query(`select id, answer_config, explanation from public.questions where quiz_id = $1::uuid`, [quizRow.id]);
      }),
    /permission denied/i
  );

  // Learner CAN read safe question columns once enrolled
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const qs = await tx.query(
      `select id, quiz_id, position, question_type, difficulty, marks, prompt, context_text, options from public.questions where quiz_id = $1::uuid`,
      [quizRow.id]
    );
    assert.ok(qs.rows.length > 0);
  });

  // Learner cannot mutate user_skills, course_enrollments, quiz_attempts, submissions, or questions directly
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
        await tx.query(
          `insert into public.user_skills (user_id, skill_id, level) values ($1::uuid, $2::uuid, 'verified')`,
          [learnerA.id, courseRow.skill_id]
        );
      }),
    /permission denied/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
        await tx.query(
          `update public.course_enrollments set status = 'completed', completion_state = 'completed_verified' where user_id = $1::uuid`,
          [learnerA.id]
        );
      }),
    /permission denied/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
        await tx.query(`delete from public.questions where quiz_id = $1::uuid`, [quizRow.id]);
      }),
    /permission denied/i
  );

  // Learner B sees ZERO of Learner A's private records
  await asActor(db, { role: 'authenticated', userId: learnerB.id }, async (tx) => {
    for (const tbl of ['course_enrollments', 'course_completions', 'lesson_progress', 'user_skills']) {
      const r = await tx.query(`select count(*)::int as n from public.${tbl}`);
      assert.equal(r.rows[0].n, 0, `Learner B must see 0 rows in ${tbl}`);
    }
  });

  // Internal progression RPCs cannot be invoked by learners
  for (const fnCall of [
    `select public.evaluate_course_and_skill_progression('${learnerA.id}'::uuid, '${courseRow.id}'::uuid)`,
    `select public.upgrade_user_skill_level('${learnerA.id}'::uuid, '${courseRow.skill_id}'::uuid, 'verified')`,
    `select public.recompute_user_skill_level('${learnerA.id}'::uuid, '${courseRow.skill_id}'::uuid)`,
    `select public.recompute_course_progression_for_course('${courseRow.id}'::uuid)`,
  ]) {
    await assert.rejects(
      () => asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) => tx.query(fnCall)),
      /permission denied/i
    );
  }
  // Admin can insert and read draft courses; anon and learner see zero draft courses
  await asActor(db, { role: 'authenticated', userId: admin.id }, async (tx) => {
    const draft = await tx.query(
      `insert into public.courses (skill_id, slug, title, description, publication_status)
       values ($1::uuid, 'draft-only-course', 'Draft Course', 'Draft course invisible to learners', 'draft')
       returning id`,
      [courseRow.skill_id]
    );
    const adminSeen = await tx.query(`select count(*)::int as n from public.courses where id = $1::uuid`, [draft.rows[0].id]);
    assert.equal(adminSeen.rows[0].n, 1);
  });
  await asActor(db, { role: 'anon' }, async (tx) => {
    const anonDrafts = await tx.query(`select count(*)::int as n from public.courses where slug = 'draft-only-course'`);
    assert.equal(anonDrafts.rows[0].n, 0);
  });
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const learnerDrafts = await tx.query(`select count(*)::int as n from public.courses where slug = 'draft-only-course'`);
    assert.equal(learnerDrafts.rows[0].n, 0);
  });
});

test('PostgreSQL Progression: quizzes never grant demonstrated, 0-challenge courses stay practising, curriculum & revision trigger downward recomputation', async () => {
  const db = await setupMigratedDb();
  const { admin, learnerA } = await seedAdminAndLearners(db);

  // 1. Complete ALL lessons, activities, and quizzes on seeded Frontend course (has capstone challenge)
  const course = (
    await db.query(`select id, skill_id from public.courses where slug = $1`, [SEEDED_FRONTEND_COURSE_SLUG])
  ).rows[0];

  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    await tx.query(`select public.enroll_in_course($1::uuid)`, [course.id]);
  });

  const lessons = (
    await db.query(
      `select l.id from public.lessons l join public.phases p on p.id = l.phase_id where p.course_id = $1::uuid and l.publication_status = 'published' and l.is_required = true`,
      [course.id]
    )
  ).rows;
  const activities = (
    await db.query(
      `select a.id from public.activities a join public.phases p on p.id = a.phase_id where p.course_id = $1::uuid and a.is_required = true`,
      [course.id]
    )
  ).rows;

  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    for (const l of lessons) {
      await tx.query(`select public.set_lesson_completion($1::uuid, true)`, [l.id]);
    }
    for (const a of activities) {
      await tx.query(`select public.set_activity_completion($1::uuid, true, 'Done')`, [a.id]);
    }
  });

  // Pass every course quiz using trusted answer keys queried as postgres
  const quizzes = (await db.query(`select id from public.quizzes where course_id = $1::uuid`, [course.id])).rows;
  for (const qz of quizzes) {
    const questions = (
      await db.query(`select id, question_type, correct_index, answer_config from public.questions where quiz_id = $1::uuid`, [qz.id])
    ).rows;
    /** @type {Record<string, unknown>} */
    const answers = {};
    for (const q of questions) {
      if (q.question_type === 'multiple_select') answers[q.id] = q.answer_config.correctIndices;
      else if (q.question_type === 'fill_blank') answers[q.id] = q.answer_config.acceptedAnswers[0];
      else if (q.question_type === 'ordering') answers[q.id] = q.answer_config.correctOrder;
      else answers[q.id] = q.correct_index;
    }
    await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
      const res = await tx.query(
        `select public.submit_quiz($1::uuid, $2::jsonb, $3) as payload`,
        [qz.id, JSON.stringify(answers), `pass-${qz.id}`]
      );
      assert.equal(res.rows[0].payload.passed, true);
    });
  }

  // After quizzes & instructional items: awaiting_practical_assessment & skill = 'practising'
  let enr = (
    await db.query(`select status, completion_state from public.course_enrollments where user_id = $1::uuid and course_id = $2::uuid`, [learnerA.id, course.id])
  ).rows[0];
  let us = (
    await db.query(`select level from public.user_skills where user_id = $1::uuid and skill_id = $2::uuid`, [learnerA.id, course.skill_id])
  ).rows[0];
  assert.equal(enr.completion_state, 'awaiting_practical_assessment');
  assert.equal(enr.status, 'active');
  assert.equal(us.level, 'practising');

  // Submit capstone and approve as admin -> completed_verified & skill = 'verified'
  const ch = (await db.query(`select id, rubric from public.challenges where course_id = $1::uuid`, [course.id])).rows[0];
  /** @type {string} */
  let subId = '';
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const s = await tx.query(
      `select id from public.submit_challenge_evidence($1::uuid, 'https://example.com/app', null, null, null, '', 'Built accessible semantic UI with responsive layout checks.', 'cap-1')`,
      [ch.id]
    );
    subId = s.rows[0].id;
  });

  const maxRubric = Object.fromEntries(
    ch.rubric.map((/** @type {{ id: string; maxPoints: number }} */ r) => [r.id, r.maxPoints])
  );
  await asActor(db, { role: 'authenticated', userId: admin.id }, async (tx) => {
    await tx.query(
      `select public.review_submission($1::uuid, 'approved', $2::jsonb, 20, 20, 'Verified responsive UI deliverable')`,
      [subId, JSON.stringify(maxRubric)]
    );
  });

  enr = (
    await db.query(`select status, completion_state from public.course_enrollments where user_id = $1::uuid and course_id = $2::uuid`, [learnerA.id, course.id])
  ).rows[0];
  us = (
    await db.query(`select level from public.user_skills where user_id = $1::uuid and skill_id = $2::uuid`, [learnerA.id, course.skill_id])
  ).rows[0];
  assert.equal(enr.completion_state, 'completed_verified');
  assert.equal(enr.status, 'completed');
  assert.equal(us.level, 'verified');

  // Re-opening submission as needs_revision triggers DOWNWARD recalculation!
  const zeroRubric = Object.fromEntries(
    ch.rubric.map((/** @type {{ id: string }} */ r) => [r.id, 1])
  );
  await asActor(db, { role: 'authenticated', userId: admin.id }, async (tx) => {
    await tx.query(
      `select public.review_submission($1::uuid, 'needs_revision', $2::jsonb, 4, 20, 'Needs keyboard focus trap fix')`,
      [subId, JSON.stringify(zeroRubric)]
    );
  });
  enr = (
    await db.query(`select status, completion_state from public.course_enrollments where user_id = $1::uuid and course_id = $2::uuid`, [learnerA.id, course.id])
  ).rows[0];
  us = (
    await db.query(`select level from public.user_skills where user_id = $1::uuid and skill_id = $2::uuid`, [learnerA.id, course.skill_id])
  ).rows[0];
  assert.equal(enr.completion_state, 'awaiting_practical_assessment');
  assert.equal(enr.status, 'active');
  assert.equal(us.level, 'practising');

  // Re-approve and then test curriculum change trigger (adding a new required published lesson)
  await asActor(db, { role: 'authenticated', userId: admin.id }, async (tx) => {
    await tx.query(
      `select public.review_submission($1::uuid, 'approved', $2::jsonb, 20, 20, 'Focus trap fixed')`,
      [subId, JSON.stringify(maxRubric)]
    );
  });
  const firstPhaseId = (
    await db.query(`select id from public.phases where course_id = $1::uuid order by position asc limit 1`, [course.id])
  ).rows[0].id;
  await db.query(
    `insert into public.lessons (phase_id, position, title, publication_status, is_required, est_minutes)
     values ($1::uuid, 99, 'New Required Lesson', 'published', true, 15)`,
    [firstPhaseId]
  );
  enr = (
    await db.query(`select status, completion_state from public.course_enrollments where user_id = $1::uuid and course_id = $2::uuid`, [learnerA.id, course.id])
  ).rows[0];
  us = (
    await db.query(`select level from public.user_skills where user_id = $1::uuid and skill_id = $2::uuid`, [learnerA.id, course.skill_id])
  ).rows[0];
  assert.equal(enr.completion_state, 'in_progress');
  assert.equal(enr.status, 'active');
  assert.equal(us.level, 'demonstrated');

  // 2. Theory-only course (0 challenges) completes as 'completed' with practical_approved = false, skill capped at 'practising'
  const theorySkillId = (
    await db.query(
      `insert into public.skills (slug, title, category, level, summary, publication_status)
       values ('theory-only-skill', 'Theory Skill', 'Design', 'Beginner', 'Theory summary for test.', 'published')
       returning id`
    )
  ).rows[0].id;
  const theoryCourseId = (
    await db.query(
      `insert into public.courses (skill_id, slug, title, description, publication_status, completion_rules)
       values ($1::uuid, 'theory-only-course', 'Theory Only Course', 'Theory course without challenges', 'published',
         '{"requireAllRequiredLessons":true,"requireAllActivities":false,"requireAllAssessments":false,"requireChallengeSubmission":false,"requireChallengeApproval":false}'::jsonb)
       returning id`,
      [theorySkillId]
    )
  ).rows[0].id;
  const theoryPhaseId = (
    await db.query(
      `insert into public.phases (course_id, position, title, publication_status) values ($1::uuid, 1, 'Phase 1', 'published') returning id`,
      [theoryCourseId]
    )
  ).rows[0].id;
  const theoryLessonId = (
    await db.query(
      `insert into public.lessons (phase_id, position, title, publication_status, is_required, est_minutes) values ($1::uuid, 1, 'Theory Lesson', 'published', true, 10) returning id`,
      [theoryPhaseId]
    )
  ).rows[0].id;

  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    await tx.query(`select public.enroll_in_course($1::uuid)`, [theoryCourseId]);
    await tx.query(`select public.set_lesson_completion($1::uuid, true)`, [theoryLessonId]);
  });

  const theoryCc = (
    await db.query(`select completion_state, practical_approved from public.course_completions where user_id = $1::uuid and course_id = $2::uuid`, [learnerA.id, theoryCourseId])
  ).rows[0];
  const theoryUs = (
    await db.query(`select level from public.user_skills where user_id = $1::uuid and skill_id = $2::uuid`, [learnerA.id, theorySkillId])
  ).rows[0];
  assert.equal(theoryCc.completion_state, 'completed');
  assert.equal(theoryCc.practical_approved, false);
  assert.equal(theoryUs.level, 'practising');
});

test('PostgreSQL Quizzes: all 10 question formats, validation, answer hiding, max_attempts, cross-quiz idempotency, and manual grading', async () => {
  const db = await setupMigratedDb();
  const { admin, learnerA } = await seedAdminAndLearners(db);

  const skillRow = (
    await db.query(`select id from public.skills limit 1`)
  ).rows[0];

  const quizA = (
    await db.query(
      `insert into public.quizzes (skill_id, quiz_type, title, pass_percent, max_attempts)
       values ($1::uuid, 'skill_check', 'Comprehensive 10-Format Check', 70, 2)
       returning id`,
      [skillRow.id]
    )
  ).rows[0];
  const quizB = (
    await db.query(
      `insert into public.quizzes (skill_id, quiz_type, title, pass_percent, max_attempts)
       values ($1::uuid, 'skill_check', 'Secondary Quiz', 70, 2)
       returning id`,
      [skillRow.id]
    )
  ).rows[0];

  // Learner cannot call admin_upsert_question
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(
          `select public.admin_upsert_question(null, $1::uuid, 1, 'Learner hack', '["A","B"]'::jsonb, 0, '')`,
          [quizA.id]
        )
      ),
    /Administrator access required/i
  );

  // Admin upsert rejects invalid multiple_select, ordering, fill_blank, true_false configs
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: admin.id }, (tx) =>
        tx.query(
          `select public.admin_upsert_question(null, $1::uuid, 1, 'Bad MS', '["A","B"]'::jsonb, 0, '', 'multiple_select', 'easy', 1, '', '{"correctIndices":[5]}'::jsonb)`,
          [quizA.id]
        )
      ),
    /out-of-range/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: admin.id }, (tx) =>
        tx.query(
          `select public.admin_upsert_question(null, $1::uuid, 1, 'Bad Ord', '["A","B","C"]'::jsonb, 0, '', 'ordering', 'easy', 1, '', '{"correctOrder":[0,0,1]}'::jsonb)`,
          [quizA.id]
        )
      ),
    /distinct indices/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: admin.id }, (tx) =>
        tx.query(
          `select public.admin_upsert_question(null, $1::uuid, 1, 'Bad FB', '[]'::jsonb, 0, '', 'fill_blank', 'easy', 1, '', '{"acceptedAnswers":[""]}'::jsonb)`,
          [quizA.id]
        )
      ),
    /non-empty acceptedAnswers/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: admin.id }, (tx) =>
        tx.query(
          `select public.admin_upsert_question(null, $1::uuid, 1, 'Bad TF', '["True","False"]'::jsonb, 2, '', 'true_false', 'easy', 1, '', '{}'::jsonb)`,
          [quizA.id]
        )
      ),
    /out of bounds/i
  );

  // Insert all 7 auto-graded question formats onto quizA + verify delete works
  /** @type {Record<string, string>} */
  const createdIds = {};
  await asActor(db, { role: 'authenticated', userId: admin.id }, async (tx) => {
    const specs = [
      ['mc', 'multiple_choice', '["Red","Blue"]', 1, '{}'],
      ['ms', 'multiple_select', '["A","B","C"]', 0, '{"correctIndices":[0,2]}'],
      ['tf', 'true_false', '[]', 0, '{}'],
      ['fb', 'fill_blank', '[]', 0, '{"acceptedAnswers":["Semantic HTML"]}'],
      ['ord', 'ordering', '["Step 1","Step 2","Step 3"]', 0, '{"correctOrder":[2,0,1]}'],
      ['scen', 'scenario', '["Opt 0","Opt 1"]', 1, '{}'],
      ['case', 'case_study', '["Opt 0","Opt 1"]', 0, '{}'],
      ['del', 'multiple_choice', '["X","Y"]', 0, '{}'],
    ];
    for (const [k, qtype, opts, cidx, cfg] of specs) {
      const r = await tx.query(
        `select id from public.admin_upsert_question(null, $1::uuid, null, $2, $3::jsonb, $4, 'Explained rationale', $5, 'medium', 1, '', $6::jsonb)`,
        [quizA.id, `Question ${k}`, opts, cidx, qtype, cfg]
      );
      createdIds[k] = r.rows[0].id;
    }
    const delRes = await tx.query(`select public.admin_delete_question($1::uuid, $2::uuid) as deleted`, [quizA.id, createdIds.del]);
    assert.equal(delRes.rows[0].deleted, true);
  });

  // Attempt 1 (wrong ordering/multiple_select with invalid bounds must score 0 and withhold solutions)
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const failRes = await tx.query(
      `select public.submit_quiz($1::uuid, $2::jsonb, 'shared-key-1') as res`,
      [
        quizA.id,
        JSON.stringify({
          [createdIds.mc]: 0,
          [createdIds.ms]: [0, 99, 2],
          [createdIds.tf]: 1,
          [createdIds.fb]: 'wrong',
          [createdIds.ord]: [2, 99, 0, 1],
          __overrideScore: 999,
        }),
      ]
    );
    const payload = failRes.rows[0].res;
    assert.equal(payload.attemptNumber, 1);
    assert.equal(payload.score, 0);
    assert.equal(payload.passed, false);
    assert.equal(payload.solutionsReleased, false);
    for (const item of payload.results) {
      assert.equal(item.correctIndex, null);
      assert.equal(item.explanation, null);
      assert.deepEqual(item.answerConfig, {});
    }
  });

  // Reusing same idempotency key on quizB MUST fail
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(`select public.submit_quiz($1::uuid, '{}'::jsonb, 'shared-key-1')`, [quizB.id])
      ),
    /different assessment/i
  );

  // Replaying same idempotency key on quizA returns identical attempt & full sanitized results
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const replayRes = await tx.query(
      `select public.submit_quiz($1::uuid, '{}'::jsonb, 'shared-key-1') as res`,
      [quizA.id]
    );
    assert.equal(replayRes.rows[0].res.attemptNumber, 1);
    assert.equal(replayRes.rows[0].res.results.length, 7);
    assert.equal(replayRes.rows[0].res.solutionsReleased, false);
  });

  // Attempt 2 (all 7 right -> passed = true, solutionsReleased = true)
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const passRes = await tx.query(
      `select public.submit_quiz($1::uuid, $2::jsonb, 'key-pass-2') as res`,
      [
        quizA.id,
        JSON.stringify({
          [createdIds.mc]: 1,
          [createdIds.ms]: [2, 0],
          [createdIds.tf]: 0,
          [createdIds.fb]: '  semantic   html ',
          [createdIds.ord]: [2, 0, 1],
          [createdIds.scen]: 1,
          [createdIds.case]: 0,
        }),
      ]
    );
    const payload = passRes.rows[0].res;
    assert.equal(payload.score, 7);
    assert.equal(payload.total, 7);
    assert.equal(payload.percentage, 100);
    assert.equal(payload.passed, true);
    assert.equal(payload.solutionsReleased, true);
    assert.ok(payload.results.every((/** @type {{ explanation: string | null }} */ r) => r.explanation === 'Explained rationale'));
  });

  // Attempt 3 exceeds max_attempts = 2
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(`select public.submit_quiz($1::uuid, '{}'::jsonb, 'key-3')`, [quizA.id])
      ),
    /Maximum number of attempts/i
  );

  // Manual formats (short_answer, long_form, practical_submission) + admin_grade_attempt validation
  /** @type {Record<string, string>} */
  const manualIds = {};
  await asActor(db, { role: 'authenticated', userId: admin.id }, async (tx) => {
    for (const qtype of ['short_answer', 'long_form', 'practical_submission']) {
      const r = await tx.query(
        `select id from public.admin_upsert_question(null, $1::uuid, null, $2, '[]'::jsonb, 0, 'Manual check', $3, 'hard', 5, '', '{}'::jsonb)`,
        [quizB.id, `Written ${qtype}`, qtype]
      );
      manualIds[qtype] = r.rows[0].id;
    }
  });

  /** @type {string} */
  let manualAttemptId = '';
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const r = await tx.query(
      `select public.submit_quiz($1::uuid, $2::jsonb, 'manual-1') as res`,
      [
        quizB.id,
        JSON.stringify({
          [manualIds.short_answer]: 'Short response',
          [manualIds.long_form]: 'Detailed explanation',
          [manualIds.practical_submission]: 'Link to deliverable',
        }),
      ]
    );
    manualAttemptId = r.rows[0].res.attemptId;
    assert.equal(r.rows[0].res.reviewStatus, 'pending_review');
    assert.equal(r.rows[0].res.passed, false);
  });

  // Admin grade validation: rejects missing manual score, out-of-range score, empty feedback, and learner caller
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(
          `select public.admin_grade_attempt($1::uuid, $2::jsonb, 'Attempted self-grade')`,
          [manualAttemptId, JSON.stringify({ [manualIds.short_answer]: 5, [manualIds.long_form]: 5, [manualIds.practical_submission]: 5 })]
        )
      ),
    /Administrator access required/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: admin.id }, (tx) =>
        tx.query(
          `select public.admin_grade_attempt($1::uuid, $2::jsonb, 'Missing one')`,
          [manualAttemptId, JSON.stringify({ [manualIds.short_answer]: 5 })]
        )
      ),
    /Manual score missing/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: admin.id }, (tx) =>
        tx.query(
          `select public.admin_grade_attempt($1::uuid, $2::jsonb, 'Too high')`,
          [manualAttemptId, JSON.stringify({ [manualIds.short_answer]: 9, [manualIds.long_form]: 5, [manualIds.practical_submission]: 5 })]
        )
      ),
    /must be between 0 and 5/i
  );

  // Valid admin grading passes attempt cleanly
  await asActor(db, { role: 'authenticated', userId: admin.id }, async (tx) => {
    const graded = await tx.query(
      `select score, total, percentage, passed, review_status from public.admin_grade_attempt($1::uuid, $2::jsonb, 'Solid written work')`,
      [
        manualAttemptId,
        JSON.stringify({
          [manualIds.short_answer]: 4,
          [manualIds.long_form]: 5,
          [manualIds.practical_submission]: 4,
        }),
      ]
    );
    assert.equal(graded.rows[0].score, 13);
    assert.equal(graded.rows[0].total, 15);
    assert.equal(graded.rows[0].percentage, 87);
    assert.equal(graded.rows[0].passed, true);
    assert.equal(graded.rows[0].review_status, 'reviewed');
  });
});

test('PostgreSQL Submissions & Storage: folder/extension/MIME/size/ownership checks, rubric enforcement, and orphan-only delete', async () => {
  const db = await setupMigratedDb();
  const { admin, learnerA, learnerB } = await seedAdminAndLearners(db);

  const skillId = (await db.query(`select id from public.skills limit 1`)).rows[0].id;
  const restrictedChallenge = (
    await db.query(
      `insert into public.challenges (
         skill_id, title, brief, instructions, max_score, passing_score,
         allowed_evidence_types, allowed_mime_types, max_file_size_mb, rubric
       )
       values (
         $1::uuid, 'Strict Image Challenge', 'Upload a verified screenshot PNG only under 2 MB.',
         'Screenshot PNG only', 10, 7,
         '["screenshot","project_url"]'::jsonb, '["image/png"]'::jsonb, 2,
         '[{"id":"c1","label":"Visual","maxPoints":5,"weightPercent":50},{"id":"c2","label":"Accuracy","maxPoints":5,"weightPercent":50}]'::jsonb
       )
       returning id`,
      [skillId]
    )
  ).rows[0];

  // Storage RLS: block traversal, leading slash, foreign folder, blocked extension
  for (const badPath of [
    `${learnerA.id}/../evil.png`,
    `/${learnerA.id}/shot.png`,
    `${learnerB.id}/shot.png`,
    `${learnerA.id}/sub/payload.svg`,
  ]) {
    await assert.rejects(
      () =>
        asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
          tx.query(
            `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('evidence', $1, $2::uuid, $3, '{"size":1024,"mimetype":"image/png"}'::jsonb)`,
            [badPath, learnerA.id, learnerA.id]
          )
        ),
      /row-level security/i,
      `Storage upload should reject ${badPath}`
    );
  }

  // Upload valid, wrong-MIME, oversized, and cross-user objects for server-side validation checks
  const validPath = `${learnerA.id}/${restrictedChallenge.id}/valid-shot.png`;
  const wrongMimePath = `${learnerA.id}/${restrictedChallenge.id}/wrong-mime.pdf`;
  const oversizedPath = `${learnerA.id}/${restrictedChallenge.id}/too-big.png`;
  const learnerBPath = `${learnerB.id}/${restrictedChallenge.id}/b-shot.png`;

  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    await tx.query(
      `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
       ('evidence', $1, $4::uuid, $5, '{"size":204800,"mimetype":"image/png"}'::jsonb),
       ('evidence', $2, $4::uuid, $5, '{"size":10240,"mimetype":"application/pdf"}'::jsonb),
       ('evidence', $3, $4::uuid, $5, '{"size":5242880,"mimetype":"image/png"}'::jsonb)`,
      [validPath, wrongMimePath, oversizedPath, learnerA.id, learnerA.id]
    );
  });
  await asActor(db, { role: 'authenticated', userId: learnerB.id }, async (tx) => {
    await tx.query(
      `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
       ('evidence', $1, $2::uuid, $3, '{"size":204800,"mimetype":"image/png"}'::jsonb)`,
      [learnerBPath, learnerB.id, learnerB.id]
    );
  });

  // Cross-learner read on storage.objects is denied
  await asActor(db, { role: 'authenticated', userId: learnerB.id }, async (tx) => {
    const visible = await tx.query(`select name from storage.objects where name = $1`, [validPath]);
    assert.equal(visible.rows.length, 0);
  });

  // submit_challenge_evidence rejects disallowed repo_url, written, wrong MIME, oversized file, and foreign file
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(
          `select public.submit_challenge_evidence($1::uuid, null, 'https://github.com/u/r', null, null, '', 'Submitted repository URL when disallowed.', 'bad-repo')`,
          [restrictedChallenge.id]
        )
      ),
    /Repository URL submissions are not permitted/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(
          `select public.submit_challenge_evidence($1::uuid, null, null, null, null, 'Long written text exceeding twenty characters', 'Submitted written text when disallowed.', 'bad-text')`,
          [restrictedChallenge.id]
        )
      ),
    /Written text deliverables are not permitted/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(
          `select public.submit_challenge_evidence($1::uuid, null, null, $2, 'wrong-mime.pdf', '', 'Wrong MIME PDF uploaded against PNG challenge.', 'bad-mime')`,
          [restrictedChallenge.id, wrongMimePath]
        )
      ),
    /MIME type "application\/pdf" is not permitted/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(
          `select public.submit_challenge_evidence($1::uuid, null, null, $2, 'too-big.png', '', 'Oversized PNG file exceeding 2MB limit.', 'bad-size')`,
          [restrictedChallenge.id, oversizedPath]
        )
      ),
    /exceeds the 2 MB limit/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(
          `select public.submit_challenge_evidence($1::uuid, null, null, $2, 'b-shot.png', '', 'Attempting to attach learner B file.', 'bad-owner')`,
          [restrictedChallenge.id, learnerBPath]
        )
      ),
    /Invalid evidence file ownership path/i
  );

  // Valid submission succeeds & blocks deletion of referenced file while allowing orphan deletion
  /** @type {string} */
  let subId = '';
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const s = await tx.query(
      `select id, rubric_max from public.submit_challenge_evidence($1::uuid, 'https://example.com/live', null, $2, 'valid-shot.png', '', 'Uploaded valid PNG screenshot under 2MB.', 'valid-sub-1')`,
      [restrictedChallenge.id, validPath]
    );
    subId = s.rows[0].id;
    assert.equal(s.rows[0].rubric_max, 10);

    // Deleting referenced evidence file is denied by RLS
    const delSubmitted = await tx.query(`delete from storage.objects where name = $1 returning name`, [validPath]);
    assert.equal(delSubmitted.rows.length, 0);

    // Deleting unreferenced orphan upload succeeds
    const delOrphan = await tx.query(`delete from storage.objects where name = $1 returning name`, [wrongMimePath]);
    assert.equal(delOrphan.rows.length, 1);
  });

  // Learner cannot call review_submission
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: learnerA.id }, (tx) =>
        tx.query(
          `select public.review_submission($1::uuid, 'approved', '{"c1":5,"c2":5}'::jsonb, 10, 10, 'Self approve')`,
          [subId]
        )
      ),
    /Administrator access required/i
  );

  // Admin review enforces rubric criterion keys, bounds, and passing score
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: admin.id }, (tx) =>
        tx.query(
          `select public.review_submission($1::uuid, 'approved', '{"c1":5}'::jsonb, 5, 10, 'Missing c2')`,
          [subId]
        )
      ),
    /Rubric score missing for criterion c2/i
  );
  await assert.rejects(
    () =>
      asActor(db, { role: 'authenticated', userId: admin.id }, (tx) =>
        tx.query(
          `select public.review_submission($1::uuid, 'approved', '{"c1":2,"c2":2}'::jsonb, 4, 10, 'Below pass')`,
          [subId]
        )
      ),
    /passing score/i
  );

  await asActor(db, { role: 'authenticated', userId: admin.id }, async (tx) => {
    const rev = await tx.query(
      `select status, rubric_total, rubric_max from public.review_submission($1::uuid, 'approved', '{"c1":4,"c2":5}'::jsonb, 9, 10, 'Clean screenshot evidence')`,
      [subId]
    );
    assert.equal(rev.rows[0].status, 'approved');
    assert.equal(rev.rows[0].rubric_total, 9);
    assert.equal(rev.rows[0].rubric_max, 10);
  });
});

test('PostgreSQL get_dashboard() SQL Contract: all 7 test cases + cross-user & anon isolation', async () => {
  const db = await setupMigratedDb();
  const { admin, learnerA, learnerB } = await seedAdminAndLearners(db);

  // Case 1 & 6: Brand-new learner with zero activity & zero attempts
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    const r = await tx.query(`select public.get_dashboard() as d`);
    const d = r.rows[0].d;
    assert.equal(d.learning.activeCourses, 0);
    assert.equal(d.learning.pausedCourses, 0);
    assert.equal(d.learning.completedCourses, 0);
    assert.equal(d.learning.completedLessons, 0);
    assert.equal(d.learning.minutesLearned, 0);
    assert.equal(d.understanding.passedQuizzes, 0);
    assert.equal(d.understanding.totalAttempts, 0);
    assert.equal(d.understanding.averageScore, 0);
    assert.deepEqual(d.enrolledCourses, []);
    assert.deepEqual(d.skillLevels, []);
    assert.equal(d.weeklyMinutes.length, 9);
    assert.equal(d.hourlyDistribution.length, 6);
    assert.ok(d.weeklyMinutes.every((/** @type {{ minutes: number }} */ w) => w.minutes === 0));
    assert.ok(d.hourlyDistribution.every((/** @type {{ minutes: number }} */ h) => h.minutes === 0));
  });

  // Case 2: Learner with 1 enrolled course
  const c1 = (await db.query(`select id from public.courses where slug = $1`, [SEEDED_FRONTEND_COURSE_SLUG])).rows[0];
  const c2 = (await db.query(`select id from public.courses where slug = $1`, [SEEDED_GRAPHICS_COURSE_SLUG])).rows[0];
  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    await tx.query(`select public.enroll_in_course($1::uuid)`, [c1.id]);
    const d = (await tx.query(`select public.get_dashboard() as d`)).rows[0].d;
    assert.equal(d.learning.activeCourses, 1);
    assert.equal(d.enrolledCourses.length, 1);
    assert.equal(d.enrolledCourses[0].slug, SEEDED_FRONTEND_COURSE_SLUG);
    assert.equal(d.enrolledCourses[0].progress.isCompleted, false);
  });

  // Case 3: Learner with multiple courses (1 active + 1 completed theory course)
  const theorySkillId = (
    await db.query(
      `insert into public.skills (slug, title, category, level, summary, publication_status)
       values ('dash-theory-skill', 'Dash Theory', 'Design', 'Beginner', 'Summary.', 'published') returning id`
    )
  ).rows[0].id;
  const theoryCourseId = (
    await db.query(
      `insert into public.courses (skill_id, slug, title, description, publication_status, completion_rules)
       values ($1::uuid, 'dash-theory-course', 'Dash Theory Course', 'Dash theory course', 'published',
         '{"requireAllRequiredLessons":true,"requireAllActivities":false,"requireAllAssessments":false,"requireChallengeSubmission":false,"requireChallengeApproval":false}'::jsonb) returning id`,
      [theorySkillId]
    )
  ).rows[0].id;
  const tPhaseId = (
    await db.query(`insert into public.phases (course_id, position, title, publication_status) values ($1::uuid, 1, 'P1', 'published') returning id`, [theoryCourseId])
  ).rows[0].id;
  const tLessonId = (
    await db.query(`insert into public.lessons (phase_id, position, title, publication_status, is_required, est_minutes) values ($1::uuid, 1, 'L1', 'published', true, 30) returning id`, [tPhaseId])
  ).rows[0].id;

  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    await tx.query(`select public.enroll_in_course($1::uuid)`, [c2.id]);
    await tx.query(`select public.set_course_enrollment_status($1::uuid, 'paused')`, [c2.id]);
    await tx.query(`select public.enroll_in_course($1::uuid)`, [theoryCourseId]);
    await tx.query(`select public.set_lesson_completion($1::uuid, true)`, [tLessonId]);
  });

  // Case 4: Set deterministic UTC completed_at timestamp (10:30 UTC today) -> verifies weeklyMinutes & 09-12 hourlyDistribution
  const nowUtc = new Date();
  nowUtc.setUTCHours(10, 30, 0, 0);
  await db.query(
    `update public.lesson_progress set completed_at = $1::timestamptz where user_id = $2::uuid and lesson_id = $3::uuid`,
    [nowUtc.toISOString(), learnerA.id, tLessonId]
  );

  // Case 5: Quiz attempts (1 fail at 0% + 1 pass at 100% -> averageScore = 50, passedQuizzes = 1, totalAttempts = 2)
  const q1 = (await db.query(`select id from public.quizzes where course_id = $1::uuid limit 1`, [c1.id])).rows[0];
  const q1Questions = (
    await db.query(`select id, question_type, correct_index, answer_config from public.questions where quiz_id = $1::uuid`, [q1.id])
  ).rows;
  /** @type {Record<string, unknown>} */
  const wrongAns = {};
  /** @type {Record<string, unknown>} */
  const rightAns = {};
  for (const q of q1Questions) {
    wrongAns[q.id] = q.correct_index === 0 ? 1 : 0;
    if (q.question_type === 'multiple_select') rightAns[q.id] = q.answer_config.correctIndices;
    else if (q.question_type === 'fill_blank') rightAns[q.id] = q.answer_config.acceptedAnswers[0];
    else if (q.question_type === 'ordering') rightAns[q.id] = q.answer_config.correctOrder;
    else rightAns[q.id] = q.correct_index;
  }

  await asActor(db, { role: 'authenticated', userId: learnerA.id }, async (tx) => {
    await tx.query(`select public.submit_quiz($1::uuid, $2::jsonb, 'dash-fail')`, [q1.id, JSON.stringify(wrongAns)]);
    await tx.query(`select public.submit_quiz($1::uuid, $2::jsonb, 'dash-pass')`, [q1.id, JSON.stringify(rightAns)]);

    const d = (await tx.query(`select public.get_dashboard() as d`)).rows[0].d;
    assert.equal(d.learning.activeCourses, 1);
    assert.equal(d.learning.pausedCourses, 1);
    assert.equal(d.learning.completedCourses, 1);
    assert.equal(d.learning.completedLessons, 1);
    assert.equal(d.learning.minutesLearned, 30);
    assert.equal(d.enrolledCourses.length, 3);
    assert.equal(d.weeklyMinutes[8].minutes, 30);
    const bucket0912 = d.hourlyDistribution.find((/** @type {{ start: number }} */ b) => b.start === 9);
    assert.equal(bucket0912.minutes, 30);
    assert.equal(d.understanding.totalAttempts, 2);
    assert.equal(d.understanding.passedQuizzes, 1);
    assert.equal(d.understanding.averageScore, 50);
  });

  // Case 7: Learner B cannot see any of Learner A's dashboard data, and anon is denied
  await asActor(db, { role: 'authenticated', userId: learnerB.id }, async (tx) => {
    const dB = (await tx.query(`select public.get_dashboard() as d`)).rows[0].d;
    assert.equal(dB.learning.activeCourses, 0);
    assert.equal(dB.learning.completedLessons, 0);
    assert.equal(dB.understanding.totalAttempts, 0);
    assert.deepEqual(dB.enrolledCourses, []);
  });
  await assert.rejects(
    () => asActor(db, { role: 'anon' }, (tx) => tx.query(`select public.get_dashboard()`)),
    /permission denied/i
  );

  // Sanity check that admin also exists cleanly and doesn't leak into learner B
  assert.equal(admin.role, 'admin');
});
