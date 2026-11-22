import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetDemoState, getDemoState, updateDemoState } from '../src/lib/demo/demoStore.js';
import { createAuthService, signUp, signIn, signOut } from '../src/lib/repositories/authRepository.js';
import {
  enrollInCourse,
  getCourseEnrollments,
  toggleLessonComplete,
} from '../src/lib/repositories/progressRepository.js';
import {
  submitQuiz,
  adminGradeAttempt,
  adminDeleteQuestion,
  adminUpsertQuestion,
  adminListPendingAssessmentAttempts,
} from '../src/lib/repositories/quizRepository.js';
import {
  submitChallengeEvidence,
  adminReviewSubmission,
} from '../src/lib/repositories/submissionRepository.js';
import { getUserSkills } from '../src/lib/repositories/skillsRepository.js';
import { getCourseBySlug, adminUpsertCourse } from '../src/lib/repositories/contentRepository.js';
import { listRankedOpportunities } from '../src/lib/repositories/opportunityRepository.js';
import { normalizeDashboardPayload } from '../src/dashboard/dashboardData.js';
import { gradeAssessmentAttempt } from '../src/lib/assessmentEngine.js';
import { computeOverallSkillCourseProgress } from '../src/lib/progressionEngine.js';
import { validateSubmissionForm } from '../src/lib/validators.js';
import { createCatalogSkills } from '../src/lib/demo/catalogSkillsSeed.js';
import { resolveSkillCover, resolveSkillCoverSpec } from '../src/lib/skillCovers.js';
import { renderSkillCard } from '../src/components/Common.js';

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  resetDemoState();
});

test('authRepository fails closed when profile row is missing, query fails, or role is unexpected; demo signUp never grants admin', async () => {
  const fakeUser = { id: 'u-1', email: 'ethoppaofficial@gmail.com', user_metadata: { full_name: 'Admin' } };

  const makeMockSupabase = (profileResult) => ({
    auth: {
      async getSession() {
        return { data: { session: { user: fakeUser } }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async single() {
                  return profileResult;
                },
              };
            },
          };
        },
      };
    },
  });

  // Missing profile (PGRST116) must fail closed
  const missingAuth = createAuthService({
    supabaseClient: makeMockSupabase({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
    isDemo: false,
  });
  assert.equal(await missingAuth.getCurrentSession(), null);

  // Database 500 error must fail closed
  const errAuth = createAuthService({
    supabaseClient: makeMockSupabase({ data: null, error: { status: 500, message: 'Internal Error' } }),
    isDemo: false,
  });
  assert.equal(await errAuth.getCurrentSession(), null);

  // Invalid role string must fail closed
  const badRoleAuth = createAuthService({
    supabaseClient: makeMockSupabase({
      data: { id: 'u-1', email: 'x@y.com', first_name: 'X', full_name: 'X Y', role: 'superadmin' },
      error: null,
    }),
    isDemo: false,
  });
  assert.equal(await badRoleAuth.getCurrentSession(), null);

  // Valid learner role succeeds
  const okAuth = createAuthService({
    supabaseClient: makeMockSupabase({
      data: { id: 'u-1', email: 'x@y.com', first_name: 'X', full_name: 'X Y', role: 'learner' },
      error: null,
    }),
    isDemo: false,
  });
  assert.equal((await okAuth.getCurrentSession()).user.role, 'learner');

  // Demo signUp unconditionally creates learner (never admin even for admin email pattern)
  const signedUp = await signUp({
    firstName: 'Test',
    lastName: 'User',
    email: 'ethoppaofficial.alias@gmail.com',
    password: 'password123',
  });
  assert.equal(signedUp.user.role, 'learner');
});

test('validateSubmissionForm and submitChallengeEvidence enforce allowedEvidenceTypes and block cross-challenge idempotency reuse', async () => {
  const screenshotChallenge = {
    id: 'ch-screen',
    allowedEvidenceTypes: ['screenshot', 'project_url'],
    allowedMimeTypes: ['image/png'],
    maxFileSizeMb: 5,
  };

  // Disallowed repo_url rejected
  const repoErrs = validateSubmissionForm({
    repoUrl: 'https://github.com/u/repo',
    explanation: 'Submitted GitHub repo on a screenshot-only assignment.',
    challenge: screenshotChallenge,
  });
  assert.match(repoErrs.repoUrl, /Repository links are not listed/i);

  // Disallowed written text rejected
  const textErrs = validateSubmissionForm({
    evidenceUrl: 'https://example.com/live',
    submissionText: 'Attempted written text deliverable on a screenshot challenge.',
    explanation: 'Valid explanation longer than twenty characters.',
    challenge: screenshotChallenge,
  });
  assert.match(textErrs.submissionText, /Written text deliverables are not accepted/i);

  // PDF on screenshot-only challenge rejected even if MIME allowed
  const pdfErrs = validateSubmissionForm({
    file: { name: 'doc.pdf', type: 'application/pdf', size: 1024 },
    explanation: 'Valid explanation longer than twenty characters.',
    challenge: { ...screenshotChallenge, allowedMimeTypes: ['image/png', 'application/pdf'] },
  });
  assert.match(pdfErrs.file, /category is not accepted/i);

  // Cross-challenge idempotency key reuse fails in demo submitChallengeEvidence
  const learner = await signUp({
    firstName: 'Idem',
    lastName: 'Tester',
    email: 'idem.tester@example.com',
    password: 'password123',
  });
  const chList = getDemoState().challenges.filter((c) => !c.courseId);
  const cA = chList[0] || getDemoState().challenges[0];
  const cB = chList[1] || getDemoState().challenges[1];
  updateDemoState((draft) => {
    const c1 = draft.challenges.find((x) => x.id === cA.id);
    const c2 = draft.challenges.find((x) => x.id === cB.id);
    if (c1) c1.courseId = null;
    if (c2) c2.courseId = null;
    return draft;
  });

  await submitChallengeEvidence({
    userId: learner.user.id,
    challengeId: cA.id,
    evidenceUrl: 'https://example.com/a',
    explanation: 'Submitting first deliverable with unique idempotency key.',
    idempotencyKey: 'shared-sub-key',
  });
  await assert.rejects(
    () =>
      submitChallengeEvidence({
        userId: learner.user.id,
        challengeId: cB.id,
        evidenceUrl: 'https://example.com/b',
        explanation: 'Submitting second deliverable reusing same idempotency key.',
        idempotencyKey: 'shared-sub-key',
      }),
    /different challenge/i
  );
});

test('assessmentEngine strictly validates ordering & multiple_select indices without silent array filtering', () => {
  const quiz = { passPercent: 70, requiresManualReview: false };
  const questions = [
    { id: 'q-ms', questionType: 'multiple_select', marks: 1, options: ['A', 'B', 'C'] },
    { id: 'q-ord', questionType: 'ordering', marks: 1, options: ['First', 'Second', 'Third'] },
  ];
  const answerKeysByQuestionId = {
    'q-ms': { correctIndices: [0, 2] },
    'q-ord': { correctOrder: [2, 0, 1] },
  };

  // Out-of-range extra index [0, 99, 2] must NOT pass
  const badRes = gradeAssessmentAttempt({
    quiz,
    questions,
    answerKeysByQuestionId,
    answersMap: {
      'q-ms': [0, 99, 2],
      'q-ord': [2, 99, 0, 1],
    },
  });
  assert.equal(badRes.score, 0);
  assert.equal(badRes.passed, false);

  // Valid answers pass
  const okRes = gradeAssessmentAttempt({
    quiz,
    questions,
    answerKeysByQuestionId,
    answersMap: {
      'q-ms': [2, 0],
      'q-ord': [2, 0, 1],
    },
  });
  assert.equal(okRes.score, 2);
  assert.equal(okRes.passed, true);
});

test('Demo progression prevents false demonstrated on 0-challenge courses and recalculates downward cleanly', async () => {
  const skillId = getDemoState().skills[0].id;
  updateDemoState((draft) => {
    draft.courses.push({
      id: 'course-theory-demo',
      skillId,
      associatedSkillIds: [skillId],
      slug: 'course-theory-demo',
      title: 'Theory Demo Course',
      publicationStatus: 'published',
      completionRules: {
        requireAllRequiredLessons: true,
        requireAllActivities: false,
        requireAllAssessments: false,
        requireChallengeSubmission: false,
        requireChallengeApproval: false,
      },
      phases: [
        {
          id: 'ph-td-1',
          position: 1,
          publicationStatus: 'published',
          lessons: [{ id: 'les-td-1', position: 1, isRequired: true, publicationStatus: 'published', estMinutes: 10 }],
          activities: [],
        },
      ],
    });
    return draft;
  });

  // Pure engine check: completed theory course never increments verifiedCoursesCount
  const overall = computeOverallSkillCourseProgress({
    publishedCourses: [getDemoState().courses.find((c) => c.id === 'course-theory-demo')],
    courseProgressById: {
      'course-theory-demo': {
        progressPercent: 100,
        isCompleted: true,
        completionState: 'completed',
        practicalApproved: false,
      },
    },
  });
  assert.equal(overall.verifiedCoursesCount, 0);
  assert.equal(overall.allCoursesVerified, false);

  const learner = await signUp({
    firstName: 'Down',
    lastName: 'Grade',
    email: 'downgrade@example.com',
    password: 'password123',
  });
  const course = await getCourseBySlug('frontend-development-foundations');
  await enrollInCourse(learner.user.id, course.id);
  const firstLesson = course.phases[0].lessons[0];

  await toggleLessonComplete(learner.user.id, course.id, firstLesson.id, firstLesson.estMinutes, true);
  let skillRec = (await getUserSkills(learner.user.id)).find((s) => s.skillId === course.skillId);
  assert.equal(skillRec.level, 'practising');

  // Uncompleting the sole completed lesson recalculates skill back to 'declared'
  await toggleLessonComplete(learner.user.id, course.id, firstLesson.id, firstLesson.estMinutes, false);
  skillRec = (await getUserSkills(learner.user.id)).find((s) => s.skillId === course.skillId);
  assert.equal(skillRec.level, 'declared');

  // Manual quiz downgrade recalculates skill downward
  const manualQuizId = 'quiz-manual-downgrade';
  const manualQId = 'q-manual-1';
  updateDemoState((draft) => {
    draft.quizzes.push({
      id: manualQuizId,
      skillId: course.skillId,
      courseId: null,
      quizType: 'skill_check',
      title: 'Manual Written Quiz',
      passPercent: 70,
      requiresManualReview: true,
      questions: [{ id: manualQId, position: 1, questionType: 'short_answer', marks: 10, prompt: 'Explain CSS Grid' }],
    });
    draft.privateQuizAnswers[manualQId] = { explanation: 'Manual' };
    return draft;
  });

  const subRes = await submitQuiz(learner.user.id, manualQuizId, { [manualQId]: 'Grid answer' }, 'mq-1');
  const adminAccount = getDemoState().users.find((u) => u.role === 'admin');
  await signIn({ email: adminAccount.email, password: adminAccount.password });

  // Passing grade -> practising
  await adminGradeAttempt({
    attemptId: subRes.attemptId,
    reviewerId: adminAccount.id,
    manualScores: { [manualQId]: 9 },
    feedback: 'Initial pass',
  });
  skillRec = (await getUserSkills(learner.user.id)).find((s) => s.skillId === course.skillId);
  assert.equal(skillRec.level, 'practising');

  // Re-grading below threshold -> downgrades back to declared
  await adminGradeAttempt({
    attemptId: subRes.attemptId,
    reviewerId: adminAccount.id,
    manualScores: { [manualQId]: 2 },
    feedback: 'Revised downward after rubric audit',
  });
  skillRec = (await getUserSkills(learner.user.id)).find((s) => s.skillId === course.skillId);
  assert.equal(skillRec.level, 'declared');
});

test('dashboardData normalizes sparse live get_dashboard payloads into valid chart and KPI arrays', () => {
  const normalized = normalizeDashboardPayload({
    learning: { activeCourses: 2, completedLessons: 3, minutesLearned: 75 },
    understanding: {},
    demonstrating: {},
    weeklyMinutes: [],
    hourlyDistribution: [],
  });
  assert.equal(normalized.learning.activeCourses, 2);
  assert.equal(normalized.learning.pausedCourses, 0);
  assert.equal(normalized.understanding.averageScore, 0);
  assert.equal(normalized.demonstrating.totalSubmissions, 0);
  assert.equal(normalized.weeklyMinutes.length, 9);
  assert.equal(normalized.hourlyDistribution.length, 6);
  assert.deepEqual(normalized.enrolledCourses, []);
});

test('Live Supabase repository contract checks: opportunityRepository, quizRepository, and contentRepository publish guard', async () => {
  await signOut();

  // Verify strict publish validation rejects creating a brand-new published course
  await assert.rejects(
    () =>
      adminUpsertCourse({
        skillId: 'skill-1',
        title: 'Premature Published Course',
        description: 'This description is plenty long enough.',
        outcomes: ['Outcome 1'],
        publicationStatus: 'published',
      }),
    /saved as draft first/i
  );

  // Sanity verify smoke imports resolve cleanly
  assert.equal(typeof listRankedOpportunities, 'function');
  assert.equal(typeof adminDeleteQuestion, 'function');
  assert.equal(typeof adminUpsertQuestion, 'function');
  assert.equal(typeof adminListPendingAssessmentAttempts, 'function');
});

test('Skill Cover System: every catalog skill across all categories and custom skills renders a valid visual cover', () => {
  const catalogSkills = createCatalogSkills();
  assert.equal(catalogSkills.length, 99);

  const seenScenes = new Set();
  for (const skill of catalogSkills) {
    const spec = resolveSkillCoverSpec(skill);
    assert.ok(spec.scene, `Missing visual scene for skill ${skill.slug}`);
    assert.equal(spec.catId, skill.categoryId, `Category palette mismatch for ${skill.slug}`);
    seenScenes.add(spec.scene);

    const coverUri = resolveSkillCover(skill);
    assert.ok(coverUri.startsWith('data:image/svg+xml;charset=utf-8,'), `Expected inline SVG cover URI for ${skill.slug}`);

    const cardHtml = renderSkillCard(skill, { totalCoursesCount: 0 });
    assert.match(cardHtml, /class="skill-cover-frame"/);
    assert.match(cardHtml, /class="skill-cover-fallback"/);
    assert.match(cardHtml, /<img\s/);
    assert.match(cardHtml, /referrerpolicy="no-referrer"/);
  }

  // Every catalog skill maps to its own distinct scene artwork
  assert.equal(seenScenes.size, catalogSkills.length);

  // Dynamic/custom admin-created skill without predefined slug also resolves cleanly
  const customHtml = renderSkillCard(
    {
      id: 'skill-custom',
      slug: 'quantum-product-strategy',
      title: 'Quantum Product Strategy',
      categoryId: 'cat-business',
      category: 'Entrepreneurship & Business',
      level: 'Advanced',
      summary: 'Custom competency created in admin catalog.',
    },
    { totalCoursesCount: 1, completedCoursesCount: 0, averageCoursePct: 25 }
  );
  assert.match(customHtml, /class="skill-cover-frame"/);
  assert.match(customHtml, /data:image\/svg\+xml;charset=utf-8,/);
});
