import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetDemoState, getDemoState, updateDemoState } from '../src/lib/demo/demoStore.js';
import { signUp, signIn, signOut, updateOwnProfile, getCurrentSession } from '../src/lib/repositories/authRepository.js';
import {
  enrollInCourse,
  getCourseEnrollments,
  toggleLessonComplete,
  togglePhaseActivityComplete,
  getLessonProgress,
} from '../src/lib/repositories/progressRepository.js';
import {
  getQuizForLearner,
  getUserAllQuizAttempts,
  submitQuiz,
  adminGradeAttempt,
} from '../src/lib/repositories/quizRepository.js';
import {
  submitChallengeEvidence,
  getUserSubmissions,
  adminReviewSubmission,
} from '../src/lib/repositories/submissionRepository.js';
import { getUserSkills } from '../src/lib/repositories/skillsRepository.js';
import { getCourseBySlug } from '../src/lib/repositories/contentRepository.js';
import { computeCourseProgress } from '../src/lib/progressionEngine.js';
import {
  sanitizeEvidenceFilename,
  validateEvidenceFileContent,
} from '../src/lib/validators.js';

/** @typedef {import('../src/types/kord.d.ts').ActivityProgressEntry} ActivityProgressEntry */
/** @typedef {import('../src/types/kord.d.ts').Challenge} Challenge */
/** @typedef {import('../src/types/kord.d.ts').Course} Course */
/** @typedef {import('../src/types/kord.d.ts').LessonProgressEntry} LessonProgressEntry */
/** @typedef {import('../src/types/kord.d.ts').Submission} Submission */

/**
 * @param {string} name
 * @param {string} type
 * @param {string | Uint8Array | ArrayBuffer} bytesOrString
 */
function makeMockFile(name, type, bytesOrString) {
  const uint8 =
    typeof bytesOrString === 'string'
      ? new TextEncoder().encode(bytesOrString)
      : bytesOrString instanceof Uint8Array
        ? bytesOrString
        : new Uint8Array(bytesOrString);
  return {
    name,
    type,
    size: uint8.byteLength,
    slice(start = 0, end = uint8.byteLength) {
      const sub = uint8.slice(start, end);
      return {
        async arrayBuffer() {
          return sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength);
        },
      };
    },
    async arrayBuffer() {
      return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
    },
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
  resetDemoState();
});

test('Scenario 1: Learner cannot change their own role to admin', async () => {
  const session = await signUp({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada.learner@example.com',
    password: 'password123',
  });
  assert.ok(session);
  assert.equal(session.user.role, 'learner');

  await assert.rejects(
    () => updateOwnProfile({ firstName: 'Ada', fullName: 'Ada Lovelace', role: 'admin' }),
    /roles cannot be modified/i
  );

  const updated = await updateOwnProfile({ firstName: 'Ada', fullName: 'Ada Byron' });
  assert.ok(updated);
  assert.equal(updated.role, 'learner');
  assert.equal(updated.fullName, 'Ada Byron');
  const current = await getCurrentSession();
  assert.ok(current);
  assert.equal(current.user.role, 'learner');
});

test('Scenario 2: Learner cannot read or mutate another learner’s private records', async () => {
  const s1 = await signUp({
    firstName: 'Learner',
    lastName: 'One',
    email: 'learner1@example.com',
    password: 'password123',
  });
  assert.ok(s1);
  const learner1Id = s1.user.id;
  const course = await getCourseBySlug('frontend-development-foundations');
  assert.ok(course);
  await enrollInCourse(learner1Id, course.id);
  const firstLesson = course.phases?.[0]?.lessons?.[0];
  assert.ok(firstLesson);
  await toggleLessonComplete(learner1Id, course.id, firstLesson.id, firstLesson.estMinutes ?? 0, true);

  await signOut();
  const s2 = await signUp({
    firstName: 'Learner',
    lastName: 'Two',
    email: 'learner2@example.com',
    password: 'password123',
  });
  assert.ok(s2);
  const learner2Id = s2.user.id;

  // Private record getters strictly isolate by userId
  assert.equal((await getCourseEnrollments(learner2Id)).length, 0);
  assert.equal((await getLessonProgress(learner2Id)).length, 0);
  assert.equal((await getUserAllQuizAttempts(learner2Id)).length, 0);
  assert.equal((await getUserSubmissions(learner2Id)).length, 0);
  assert.equal((await getUserSkills(learner2Id)).length, 0);

  // Cross-actor mutations are rejected while signed in as Learner Two
  await assert.rejects(
    () => enrollInCourse(learner1Id, course.id),
    /cannot enroll another learner/i
  );
  await assert.rejects(
    () => toggleLessonComplete(learner1Id, course.id, firstLesson.id, 25, false),
    /cannot modify another learner/i
  );
});

test('Scenario 3: Learner cannot award themselves invalid or unenrolled skill progression', async () => {
  const session = await signUp({
    firstName: 'Nia',
    lastName: 'Mensah',
    email: 'nia@example.com',
    password: 'password123',
  });
  assert.ok(session);
  const userId = session.user.id;
  const course = await getCourseBySlug('frontend-development-foundations');
  assert.ok(course);
  const firstLesson = course.phases?.[0]?.lessons?.[0];
  assert.ok(firstLesson);

  // Un-enrolled lesson completion is blocked
  await assert.rejects(
    () => toggleLessonComplete(userId, course.id, firstLesson.id, 25, true),
    /Active course enrollment required/i
  );

  // Draft course enrollment is blocked
  updateDemoState((draft) => {
    draft.courses.push(/** @type {Course} */ (/** @type {unknown} */ ({
      id: 'course-draft-secret',
      skillId: course.skillId,
      slug: 'draft-secret-course',
      title: 'Draft Course',
      publicationStatus: 'draft',
      phases: [],
    })));
    return draft;
  });
  await assert.rejects(
    () => enrollInCourse(userId, 'course-draft-secret'),
    /not available for enrollment/i
  );

  assert.equal((await getUserSkills(userId)).length, 0);
});

test('Scenario 4: Learner cannot approve their own or any practical submission', async () => {
  const learnerSession = await signUp({
    firstName: 'Sam',
    lastName: 'Okafor',
    email: 'sam@example.com',
    password: 'password123',
  });
  const course = await getCourseBySlug('frontend-development-foundations');
  assert.ok(learnerSession && course);
  await enrollInCourse(learnerSession.user.id, course.id);
  const state = getDemoState();
  const challenge = state.challenges.find((c) => c.courseId === course.id);
  assert.ok(challenge);

  const sub = await submitChallengeEvidence({
    userId: learnerSession.user.id,
    challengeId: challenge.id,
    courseId: course.id,
    evidenceUrl: 'https://example.com/portfolio',
    explanation: 'Deployed a semantic responsive business website with keyboard navigation.',
    rubricMax: challenge.maxScore,
    challenge,
  });

  const maxRubricScores = Object.fromEntries((challenge.rubric || []).map((r) => [r.id, r.maxPoints]));
  await assert.rejects(
    () =>
      adminReviewSubmission({
        submissionId: sub.id,
        reviewerId: learnerSession.user.id,
        status: 'approved',
        rubricScores: maxRubricScores,
        rubricTotal: challenge.maxScore,
        rubricMax: challenge.maxScore,
        feedback: 'Self-approval attempt',
      }),
    /Administrator authorization required/i
  );
});

test('Scenario 5 & 6: Learner cannot access answer keys early or manipulate quiz scores', async () => {
  const learner = await signUp({
    firstName: 'Tunde',
    lastName: 'Bakare',
    email: 'tunde@example.com',
    password: 'password123',
  });
  const course = await getCourseBySlug('frontend-development-foundations');
  assert.ok(learner && course);
  const quizMeta = getDemoState().quizzes.find((q) => q.courseId === course.id);
  assert.ok(quizMeta);

  // Un-enrolled learner cannot inspect course quiz questions
  const unenrolledView = await getQuizForLearner(quizMeta.id, { userId: learner.user.id });
  assert.ok(unenrolledView);
  assert.equal(unenrolledView.enrollmentRequired, true);
  assert.equal(unenrolledView.questions.length, 0);

  // Enrolled learner receives sanitized questions WITHOUT answer keys or explanations
  await enrollInCourse(learner.user.id, course.id);
  const enrolledView = await getQuizForLearner(quizMeta.id, { userId: learner.user.id });
  assert.ok(enrolledView);
  assert.equal(enrolledView.enrollmentRequired, false);
  assert.ok(enrolledView.questions.length > 0);
  for (const q of enrolledView.questions) {
    const qRec = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (q));
    assert.equal(qRec.correctIndex, undefined);
    assert.equal(qRec.answerConfig, undefined);
    assert.equal(qRec.explanation, undefined);
  }

  // Tampering extra client-supplied score fields does NOT override server grading
  /** @type {Record<string, unknown>} */
  const wrongAnswers = {};
  for (const q of enrolledView.questions) {
    const key = getDemoState().privateQuizAnswers[q.id];
    const wrongIdx = key?.correctIndex === 0 ? 1 : 0;
    wrongAnswers[q.id] = wrongIdx;
  }
  wrongAnswers.__overrideScore = 999;
  wrongAnswers.__passed = true;

  // Fail attempt: answers & explanations stay withheld when retries remain
  updateDemoState((draft) => {
    const qz = draft.quizzes.find((x) => x.id === quizMeta.id);
    assert.ok(qz);
    qz.maxAttempts = 3;
    return draft;
  });

  const failedRes = await submitQuiz(learner.user.id, quizMeta.id, wrongAnswers, 'attempt-fail-1');
  assert.equal(failedRes.passed, false);
  assert.equal(failedRes.solutionsReleased, false);
  for (const r of failedRes.results) {
    assert.equal(r.correctIndex, null);
    assert.equal(r.explanation, null);
    assert.deepEqual(r.answerConfig, {});
  }
  await assert.rejects(
    () =>
      adminGradeAttempt({
        attemptId: failedRes.attemptId,
        reviewerId: learner.user.id,
        manualScores: {},
        feedback: 'Unauthorized learner self-grading attempt',
      }),
    /Administrator authorization required/i
  );

  // Pass attempt: unlocks solutions & awards at most 'practising' (never 'demonstrated' or 'verified')
  /** @type {Record<string, unknown>} */
  const rightAnswers = {};
  for (const q of enrolledView.questions) {
    const key = getDemoState().privateQuizAnswers[q.id];
    assert.ok(key);
    if (q.questionType === 'multiple_select') rightAnswers[q.id] = key.correctIndices;
    else if (q.questionType === 'fill_blank') rightAnswers[q.id] = key.acceptedAnswers?.[0];
    else if (q.questionType === 'ordering') rightAnswers[q.id] = key.correctOrder;
    else rightAnswers[q.id] = key.correctIndex;
  }
  const passedRes = await submitQuiz(learner.user.id, quizMeta.id, rightAnswers, 'attempt-pass-2');
  assert.equal(passedRes.passed, true);
  assert.equal(passedRes.solutionsReleased, true);
  assert.ok(passedRes.results.some((/** @type {{ explanation: string | null }} */ r) => r.explanation !== null));

  const skillsAfterQuiz = await getUserSkills(learner.user.id);
  const courseSkillRecord = skillsAfterQuiz.find((us) => us.skillId === course.skillId);
  assert.equal(courseSkillRecord?.level, 'practising');
});

test('Scenario 7 & 8: Course remains awaiting practical assessment until admin approves capstone, unlocking verified status', async () => {
  const learner = await signUp({
    firstName: 'Kofi',
    lastName: 'Annan',
    email: 'kofi@example.com',
    password: 'password123',
  });
  const course = await getCourseBySlug('frontend-development-foundations');
  assert.ok(learner && course);
  await enrollInCourse(learner.user.id, course.id);

  // Complete all published lessons & activities
  for (const phase of course.phases || []) {
    for (const lesson of phase.lessons || []) {
      await toggleLessonComplete(learner.user.id, course.id, lesson.id, lesson.estMinutes ?? 0, true);
    }
    for (const act of phase.activities || []) {
      await togglePhaseActivityComplete(learner.user.id, course.id, act.id, act.estMinutes ?? 0, true);
    }
  }

  // Pass all course quizzes
  const stateBeforeChallenge = getDemoState();
  const courseQuizzes = stateBeforeChallenge.quizzes.filter((q) => q.courseId === course.id);
  for (const qz of courseQuizzes) {
    /** @type {Record<string, unknown>} */
    const ans = {};
    for (const q of qz.questions || []) {
      const key = stateBeforeChallenge.privateQuizAnswers[q.id];
      assert.ok(key);
      if (q.questionType === 'multiple_select') ans[q.id] = key.correctIndices;
      else if (q.questionType === 'fill_blank') ans[q.id] = key.acceptedAnswers?.[0];
      else if (q.questionType === 'ordering') ans[q.id] = key.correctOrder;
      else ans[q.id] = key.correctIndex;
    }
    await submitQuiz(learner.user.id, qz.id, ans, `pass-${qz.id}`);
  }

  // Instructional work complete, capstone not yet approved -> awaiting_practical_assessment
  let enrollment = (await getCourseEnrollments(learner.user.id)).find((e) => e.courseId === course.id);
  assert.ok(enrollment);
  assert.equal(enrollment.completionState, 'awaiting_practical_assessment');
  assert.equal(enrollment.status, 'active');

  let skillState = (await getUserSkills(learner.user.id)).find((us) => us.skillId === course.skillId);
  assert.ok(skillState);
  assert.equal(skillState.level, 'practising');

  // Submit capstone challenge
  const challenge = stateBeforeChallenge.challenges.find((c) => c.courseId === course.id);
  assert.ok(challenge);
  const sub = await submitChallengeEvidence({
    userId: learner.user.id,
    challengeId: challenge.id,
    courseId: course.id,
    evidenceUrl: 'https://kofi-frontend.example.com',
    repoUrl: 'https://github.com/kofi/frontend-capstone',
    explanation: 'Built accessible responsive portfolio site using semantic HTML5, Flexbox, Grid, and vanilla JS.',
    rubricMax: challenge.maxScore,
    challenge,
  });

  // Switch to admin account and verify passing-score rule + full approval flow
  const adminAccount = getDemoState().users.find((u) => u.role === 'admin');
  assert.ok(adminAccount && adminAccount.password);
  await signIn({ email: adminAccount.email, password: adminAccount.password });

  // Below passing score approval must fail
  const zeroScores = Object.fromEntries((challenge.rubric || []).map((r) => [r.id, 0]));
  await assert.rejects(
    () =>
      adminReviewSubmission({
        submissionId: sub.id,
        reviewerId: adminAccount.id,
        status: 'approved',
        rubricScores: zeroScores,
        rubricTotal: 0,
        rubricMax: challenge.maxScore,
        feedback: 'Needs work',
      }),
    /meet or exceed the passing score/i
  );

  // Full passing approval completes course & upgrades skill
  const fullScores = Object.fromEntries((challenge.rubric || []).map((r) => [r.id, r.maxPoints]));
  const totalPts = Object.values(fullScores).reduce((a, b) => a + b, 0);
  await adminReviewSubmission({
    submissionId: sub.id,
    reviewerId: adminAccount.id,
    status: 'approved',
    rubricScores: fullScores,
    rubricTotal: totalPts,
    rubricMax: totalPts,
    feedback: 'Excellent responsive implementation and accessibility contrast checks.',
  });

  enrollment = (await getCourseEnrollments(learner.user.id)).find((e) => e.courseId === course.id);
  assert.ok(enrollment);
  assert.equal(enrollment.completionState, 'completed_verified');
  assert.equal(enrollment.status, 'completed');

  skillState = (await getUserSkills(learner.user.id)).find((us) => us.skillId === course.skillId);
  assert.ok(skillState);
  assert.equal(skillState.level, 'verified');
});

test('Scenario 9: Required vs optional lessons, activities, and challenges handling', () => {
  const mockCourse = /** @type {Course} */ (/** @type {unknown} */ ({
    id: 'c-opt-test',
    phases: [
      {
        id: 'p1',
        position: 1,
        publicationStatus: 'published',
        lessons: [
          { id: 'l-req', position: 1, isRequired: true, publicationStatus: 'published', estMinutes: 20 },
          { id: 'l-opt', position: 2, isRequired: false, publicationStatus: 'published', estMinutes: 15 },
          { id: 'l-draft', position: 3, isRequired: true, publicationStatus: 'draft', estMinutes: 30 },
        ],
        activities: [
          { id: 'a-req', position: 1, isRequired: true, estMinutes: 20 },
          { id: 'a-opt', position: 2, isRequired: false, estMinutes: 10 },
        ],
      },
    ],
    completionRules: {
      requireAllRequiredLessons: true,
      requireAllActivities: true,
      requireAllAssessments: true,
      requireChallengeSubmission: true,
      requireChallengeApproval: true,
    },
  }));

  const mockChallenges = /** @type {Challenge[]} */ (/** @type {unknown} */ ([
    { id: 'ch-req', courseId: 'c-opt-test', phaseId: 'p1', isRequired: true },
    { id: 'ch-opt', courseId: 'c-opt-test', phaseId: 'p1', isRequired: false },
  ]));

  // Finishing required items only (ignoring optional l-opt, a-opt, ch-opt, and draft l-draft) achieves completed_verified
  const completeRequiredOnly = computeCourseProgress({
    course: mockCourse,
    lessonProgress: [/** @type {LessonProgressEntry} */ ({ lessonId: 'l-req', completed: true, minutesSpent: 20 })],
    activityProgress: [/** @type {ActivityProgressEntry} */ ({ activityId: 'a-req', completed: true })],
    assessments: [],
    quizAttempts: [],
    challenges: mockChallenges,
    submissions: [/** @type {Submission} */ ({ challengeId: 'ch-req', status: 'approved' })],
  });
  assert.equal(completeRequiredOnly.completionState, 'completed_verified');
  assert.equal(completeRequiredOnly.isCompleted, true);
  assert.equal(completeRequiredOnly.requiredLessonsCount, 1);

  // Completing only optional items while missing required lesson does NOT complete the course
  const incompleteRequired = computeCourseProgress({
    course: mockCourse,
    lessonProgress: [/** @type {LessonProgressEntry} */ ({ lessonId: 'l-opt', completed: true, minutesSpent: 15 })],
    activityProgress: [/** @type {ActivityProgressEntry} */ ({ activityId: 'a-opt', completed: true })],
    assessments: [],
    quizAttempts: [],
    challenges: mockChallenges,
    submissions: [/** @type {Submission} */ ({ challengeId: 'ch-opt', status: 'approved' })],
  });
  assert.equal(incompleteRequired.completionState, 'in_progress');
  assert.equal(incompleteRequired.isCompleted, false);
});

test('Scenario 10: Storage filename sanitization and magic-byte content inspection', async () => {
  assert.equal(sanitizeEvidenceFilename('../../evil/My Report (v2).PDF'), 'my-report-v2.pdf');

  // Valid PDF header passes
  const validPdf = makeMockFile('project.pdf', 'application/pdf', '%PDF-1.7\n%...');
  assert.equal(await validateEvidenceFileContent(validPdf), null);

  // Spoofed .pdf with HTML/EXE content is rejected
  const spoofedPdf = makeMockFile('payload.pdf', 'application/pdf', 'MZ\x90\x00<html><script>alert(1)</script>');
  const pdfErr = await validateEvidenceFileContent(spoofedPdf);
  assert.ok(pdfErr);
  assert.match(pdfErr, /PDF/i);

  // Disallowed extension .svg rejected
  const svgFile = makeMockFile('badge.svg', 'image/svg+xml', '<svg onload="alert(1)"></svg>');
  const svgErr = await validateEvidenceFileContent(svgFile);
  assert.ok(svgErr);
  assert.match(svgErr, /not allowed/i);

  // Plain-text file containing <script> tag is blocked
  const scriptTxt = makeMockFile('notes.txt', 'text/plain', 'Hello <script>fetch("http://evil")</script>');
  const txtErr = await validateEvidenceFileContent(scriptTxt);
  assert.ok(txtErr);
  assert.match(txtErr, /script/i);

  // Oversized file is blocked
  const bigChallenge = { maxFileSizeMb: 1 };
  const twoMbMock = {
    name: 'archive.zip',
    type: 'application/zip',
    size: 2 * 1024 * 1024,
    slice() {
      return { async arrayBuffer() { return new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; } };
    },
  };
  const bigErr = await validateEvidenceFileContent(twoMbMock, bigChallenge);
  assert.ok(bigErr);
  assert.match(bigErr, /exceeds the 1 MB/i);
});
