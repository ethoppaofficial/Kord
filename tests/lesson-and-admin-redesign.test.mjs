import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetDemoState, getDemoState } from '../src/lib/demo/demoStore.js';
import * as auth from '../src/lib/repositories/authRepository.js';
import { signUp } from '../src/lib/repositories/authRepository.js';
import {
  listSkills,
  getCourseById,
  adminUpsertSkill,
  adminUpsertCourse,
  adminUpsertPhase,
  adminReorderPhases,
  adminDeletePhase,
  adminUpsertLesson,
  adminReorderLessons,
  adminDeleteLesson,
} from '../src/lib/repositories/contentRepository.js';
import {
  listAssessmentsForCourse,
  getQuizForLearner,
  submitQuiz,
  adminUpsertAssessment,
  adminGetQuizQuestions,
  adminUpsertQuestion,
  adminDeleteAssessment,
} from '../src/lib/repositories/quizRepository.js';
import { enrollInCourse } from '../src/lib/repositories/progressRepository.js';
import { validateLessonInstructionalContent } from '../src/lib/contentPackage.js';
import {
  richTextToLessonBlocks,
  lessonToEditorFields,
  splitLessonSections,
  renderInlineProseHtml,
  renderEditorialLectureHtml,
} from '../src/lib/richTextLesson.js';
import { renderLessonReaderHtml } from '../src/components/LessonReader.js';
import { renderCourseLessonPage } from '../src/pages/learner/CourseLessonPage.js';

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  resetDemoState();
});

test('richTextLesson parses structured rich text into validated LessonBlocks and escapes raw HTML safely', () => {
  const mainContentText = `## Understanding System Boundaries

Good engineering relies on **clear interfaces** and *explicit invariants* using \`schemaVersion\`.

- Separate content from presentation
- Validate inputs before saving

1. Define the contract
2. Verify edge cases

Idempotency :: Ensuring repeated operations produce the same safe outcome without duplication.

> Key rule: Never render raw user HTML directly into the DOM.

| Layer | Responsibility | Validation |
| --- | --- | --- |
| Authoring | Rich-text parsing | Safe URL & script checks |
| Reader | Escaped rendering | Zero raw HTML |

\`\`\`js
export function check(x) { return Boolean(x); }
\`\`\`

![Architecture overview|System flow diagram](/assets/diagram.png)`;

  const blocks = richTextToLessonBlocks({
    mainContentText,
    practicalTitle: 'Worked Example: Safe Parsing',
    practicalBody: 'Run the parser on sample input and inspect each resulting block.',
    practicalOutcome: 'Every block passes schema validation cleanly.',
  });

  assert.ok(blocks.length >= 8);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(blocks[2].type, 'bullets');
  assert.equal(blocks[3].type, 'steps');
  assert.equal(blocks[4].type, 'definition');
  assert.equal(blocks[5].type, 'callout');
  assert.equal(blocks[6].type, 'table');
  assert.equal(blocks[7].type, 'code');
  assert.equal(blocks[8].type, 'image');
  assert.equal(blocks[9].type, 'demonstration');

  // Compatible with existing v1.0 publish validation
  const validation = validateLessonInstructionalContent({
    title: 'Understanding System Boundaries',
    introduction: 'Why safe boundaries keep editorial platforms reliable and predictable.',
    objectives: ['Separate presentation from structured content'],
    blocks,
    summary: 'Safe boundaries keep content clean and portable.',
  });
  assert.equal(validation.valid, true, validation.errors.map((e) => e.message).join('; '));

  // Round-trip back into editor fields cleanly
  const roundTrip = lessonToEditorFields({ blocks });
  assert.match(roundTrip.mainContentText, /## Understanding System Boundaries/);
  assert.match(roundTrip.mainContentText, /Idempotency :: Ensuring repeated operations/);
  assert.equal(roundTrip.practicalTitle, 'Worked Example: Safe Parsing');
  assert.match(roundTrip.practicalBody, /Run the parser on sample input/);
  assert.match(roundTrip.practicalOutcome, /Every block passes schema validation/);

  // XSS neutralization checks
  assert.throws(
    () =>
      richTextToLessonBlocks({
        mainContentText: 'Intro <script>alert(1)</script> text',
      }),
    /Disallowed raw HTML|Unsafe/i
  );
  assert.throws(
    () =>
      richTextToLessonBlocks({
        mainContentText: '![bad](javascript:alert(1))',
      }),
    /Disallowed raw HTML|Invalid image URL/i
  );

  const escapedInline = renderInlineProseHtml('**Bold** <img src=x onerror=alert(1)> `<code>`');
  assert.ok(!escapedInline.includes('<img'));
  assert.ok(escapedInline.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(escapedInline.includes('<strong>Bold</strong>'));

  const lectureHtml = renderEditorialLectureHtml(blocks.slice(0, 8));
  assert.ok(lectureHtml.includes('lesson-lecture-h2'));
  assert.ok(lectureHtml.includes('lesson-table'));
});

test('LessonReader and CourseLessonPage render all 8 sections and withhold quiz keys pre-submission', async () => {
  const skills = await listSkills({ includeDrafts: false });
  const targetSkill = skills.find((s) => (s.courseCount || 0) > 0) || skills[0];
  assert.ok(targetSkill);

  // Create a fresh course -> phase -> lesson + lesson-linked assessment
  const course = await adminUpsertCourse({
    skillId: targetSkill.id,
    associatedSkillIds: [targetSkill.id],
    title: 'Editorial Reading & Assessment Course',
    description: 'Testing the 8-section learner reading flow and inline knowledge assessment.',
    outcomes: ['Deliver high-clarity editorial lessons'],
    difficulty: 'Beginner',
    completionRules: {
      requireAllRequiredLessons: true,
      requireAllActivities: false,
      requireAllAssessments: true,
      requireChallengeSubmission: false,
      requireChallengeApproval: false,
    },
    publicationStatus: 'draft',
  });
  assert.ok(course?.id);

  const phase = await adminUpsertPhase({
    courseId: course.id,
    title: 'Core Principles',
    summary: 'Foundational concepts and worked practice.',
    publicationStatus: 'published',
  });
  assert.ok(phase?.id);

  const blocks = richTextToLessonBlocks({
    mainContentText:
      '## Primary Lecture\n\nThis paragraph teaches the core idea in clear, connected prose.\n\n- Principle A\n- Principle B',
    practicalTitle: 'Worked Example: Diagnostic Check',
    practicalBody: 'Inspect the sample setup step by step to verify accuracy.',
    practicalOutcome: 'Identified the two primary misconfigurations.',
  });

  const lesson = await adminUpsertLesson({
    courseId: course.id,
    phaseId: phase.id,
    title: 'Lesson One: Clarity in Design',
    introduction: 'Why clear instructional flow improves comprehension and retention.',
    objectives: ['Explain core design flow', 'Validate understanding inline'],
    blocks,
    summary: 'Structured prose plus applied practice builds durable understanding.',
    takeaways: ['Focus on readable lecture copy'],
    completionCriteria: 'Study the lecture and pass the knowledge assessment.',
    publicationStatus: 'published',
  });
  assert.ok(lesson?.id);

  const quiz = await adminUpsertAssessment({
    skillId: targetSkill.id,
    courseId: course.id,
    phaseId: phase.id,
    lessonId: lesson.id,
    quizType: 'knowledge_check',
    title: 'Lesson One — Knowledge Check',
    passPercent: 70,
  });
  assert.ok(quiz?.id);

  await adminUpsertQuestion({
    quizId: quiz.id,
    questionType: 'multiple_choice',
    marks: 2,
    prompt: 'What deserves the greatest visual emphasis on a lesson page?',
    options: ['The main instructional lecture', 'Decorative sidebar badges'],
    correctIndex: 0,
    explanation: 'The instructional lecture is the core learning experience.',
  });

  // Publish course
  await adminUpsertCourse({
    id: course.id,
    skillId: targetSkill.id,
    associatedSkillIds: [targetSkill.id],
    title: course.title,
    description: course.description,
    outcomes: ['Deliver high-clarity editorial lessons'],
    difficulty: 'Beginner',
    completionRules: {
      requireAllRequiredLessons: true,
      requireAllActivities: false,
      requireAllAssessments: true,
      requireChallengeSubmission: false,
      requireChallengeApproval: false,
    },
    publicationStatus: 'published',
  });

  // Learner enrolls and views CourseLessonPage
  const learnerSession = await signUp({
    firstName: 'Ada',
    lastName: 'Reader',
    email: 'ada.reader@example.com',
    password: 'password123',
  });
  assert.ok(learnerSession);
  await enrollInCourse(learnerSession.user.id, course.id);

  const safeQuiz = await getQuizForLearner(quiz.id, { userId: learnerSession.user.id });
  assert.ok(safeQuiz);
  assert.equal(safeQuiz.questions?.[0]?.prompt, 'What deserves the greatest visual emphasis on a lesson page?');
  // Never expose answer key before submit
  const firstSafeQuestion = /** @type {Record<string, unknown> | undefined} */ (safeQuiz.questions?.[0]);
  assert.ok(firstSafeQuestion);
  assert.equal(firstSafeQuestion.correctIndex, undefined);
  assert.equal(firstSafeQuestion.explanation, undefined);

  const pageView = await renderCourseLessonPage({
    currentPath: `/courses/${course.slug}/phases/${phase.id}/lessons/${lesson.id}`,
    params: { slug: course.slug, phaseId: phase.id, lessonId: lesson.id },
    session: learnerSession,
    auth: /** @type {import('../src/types/kord.d.ts').AuthService} */ (/** @type {unknown} */ (auth)),
    recoveryState: null,
    oauthCallbackState: null,
    signOut: async () => {},
    navigate: async () => {},
    rerender: async () => {},
  });

  // Verify 8-section structure & absence of answer key leakage in HTML
  assert.match(pageView.html, /Lesson One: Clarity in Design/);
  assert.match(pageView.html, /Why clear instructional flow improves comprehension/);
  assert.match(pageView.html, /Learning objectives/);
  assert.match(pageView.html, /Primary Lecture/);
  assert.match(pageView.html, /Practical application/);
  assert.match(pageView.html, /Worked Example: Diagnostic Check/);
  assert.match(pageView.html, /Lesson summary/);
  assert.match(pageView.html, /Knowledge assessment/);
  assert.match(pageView.html, /Completion status/);
  assert.ok(!pageView.html.includes('The instructional lecture is the core learning experience.'));

  // Submit answer and confirm grading works
  const graded = await submitQuiz(
    learnerSession.user.id,
    quiz.id,
    { [safeQuiz.questions[0].id]: 0 },
    `test-submit-${Date.now()}`
  );
  assert.equal(graded.passed, true);
  assert.equal(graded.percentage, 100);

  // Verify legacy inline knowledge_check blocks split out of lecture into Section 7
  const split = splitLessonSections({
    blocks: [
      { type: 'paragraph', text: 'Core reading paragraph.' },
      { type: 'example', title: 'Ex', body: 'Example body.' },
      { type: 'knowledge_check', prompt: 'Legacy check?', options: ['Yes', 'No'], correctIndex: 0 },
    ],
  });
  assert.equal(split.lectureBlocks.length, 1);
  assert.equal(split.practicalBlocks.length, 1);
  assert.equal(split.inlineChecks.length, 1);

  const previewHtml = renderLessonReaderHtml({
    lesson: {
      title: 'Draft Preview',
      introduction: 'Intro copy',
      objectives: ['Obj 1'],
      blocks,
      summary: 'Summary copy',
      publicationStatus: 'draft',
    },
    previewMode: true,
  });
  assert.match(previewHtml, /Draft Preview/);
  assert.match(previewHtml, /Draft/);
});

test('Admin hierarchy supports Skill -> Course -> Phase -> Lesson edit, reorder, delete, and quiz cleanup', async () => {
  const categories = getDemoState().categories;
  const skill = await adminUpsertSkill({
    title: 'Technical Documentation Testing',
    categoryId: categories[0].id,
    level: 'Intermediate',
    summary: 'Writing clear documentation.',
    publicationStatus: 'draft',
  });
  assert.ok(skill?.id);

  // Edit skill
  const updatedSkill = await adminUpsertSkill({
    id: skill.id,
    slug: skill.slug,
    title: 'Technical Documentation & Guides',
    categoryId: categories[0].id,
    level: 'Intermediate',
    summary: 'Updated skill summary.',
    publicationStatus: 'published',
  });
  assert.equal(updatedSkill?.title, 'Technical Documentation & Guides');

  // Create course & associate skills
  const course = await adminUpsertCourse({
    skillId: skill.id,
    associatedSkillIds: [skill.id],
    title: 'Curriculum Authoring Flow',
    description: 'Testing hierarchy actions across phases and lessons.',
    difficulty: 'Intermediate',
    publicationStatus: 'draft',
  });
  assert.ok(course?.id);

  const ph1 = await adminUpsertPhase({
    courseId: course.id,
    title: 'Phase Alpha',
    summary: 'First phase',
  });
  const ph2 = await adminUpsertPhase({
    courseId: course.id,
    title: 'Phase Beta',
    summary: 'Second phase',
  });
  assert.ok(ph1?.id && ph2?.id);

  // Edit phase 2
  const ph2Edited = await adminUpsertPhase({
    id: ph2.id,
    courseId: course.id,
    title: 'Phase Beta Updated',
    summary: 'Edited summary',
    publicationStatus: 'draft',
  });
  assert.equal(ph2Edited?.title, 'Phase Beta Updated');
  assert.equal(ph2Edited?.publicationStatus, 'draft');

  const initialPhaseId = course.phases?.[0]?.id;
  assert.ok(initialPhaseId);

  // Reorder phases (ph2 before ph1 before initial phase)
  await adminReorderPhases(course.id, [ph2.id, ph1.id, initialPhaseId]);
  let fullCourse = await getCourseById(course.id, { includeDrafts: true });
  assert.deepEqual(
    (fullCourse?.phases || []).map((p) => p.id),
    [ph2.id, ph1.id, initialPhaseId]
  );

  // Add and reorder lessons inside ph1
  const l1 = await adminUpsertLesson({
    courseId: course.id,
    phaseId: ph1.id,
    title: 'Lesson A',
    introduction: 'Intro A',
    blocks: richTextToLessonBlocks({ mainContentText: 'Enough content in paragraph A to pass validation cleanly.' }),
  });
  const l2 = await adminUpsertLesson({
    courseId: course.id,
    phaseId: ph1.id,
    title: 'Lesson B',
    introduction: 'Intro B',
    blocks: richTextToLessonBlocks({ mainContentText: 'Enough content in paragraph B to pass validation cleanly.' }),
  });
  assert.ok(l1?.id && l2?.id);

  await adminReorderLessons(course.id, ph1.id, [l2.id, l1.id]);
  fullCourse = await getCourseById(course.id, { includeDrafts: true });
  const reloadedPh1 = (fullCourse?.phases || []).find((p) => p.id === ph1.id);
  assert.deepEqual(
    (reloadedPh1?.lessons || []).map((l) => l.id),
    [l2.id, l1.id]
  );

  // Lesson quiz upsert & delete when questions removed
  const lq = await adminUpsertAssessment({
    skillId: skill.id,
    courseId: course.id,
    phaseId: ph1.id,
    lessonId: l1.id,
    quizType: 'knowledge_check',
    title: 'Lesson A Check',
    passPercent: 70,
  });
  assert.ok(lq?.id);
  await adminUpsertQuestion({
    quizId: lq.id,
    questionType: 'true_false',
    prompt: 'Drafts are hidden from learners.',
    options: ['True', 'False'],
    correctIndex: 0,
    explanation: 'Only published lessons are visible.',
  });
  const qs = await adminGetQuizQuestions(lq.id);
  assert.equal(qs.length, 1);

  await adminDeleteAssessment(lq.id);
  const afterDelQuizzes = await listAssessmentsForCourse(course.id);
  assert.equal(afterDelQuizzes.some((a) => a.id === lq.id), false);

  // Delete lesson & delete empty phase
  await adminDeleteLesson(course.id, ph1.id, l1.id);
  await adminDeletePhase(course.id, ph2.id);
  fullCourse = await getCourseById(course.id, { includeDrafts: true });
  assert.equal((fullCourse?.phases || []).some((p) => p.id === ph2.id), false);
});
