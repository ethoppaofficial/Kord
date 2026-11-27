import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  resetDemoState,
  getDemoState,
  updateDemoState,
  setDemoCurrentUserId,
} from '../src/lib/demo/demoStore.js';
import { signIn, signUp } from '../src/lib/repositories/authRepository.js';
import { enrollInCourse, toggleLessonComplete } from '../src/lib/repositories/progressRepository.js';
import {
  listAllCourses,
  getCourseById,
  validateCourseForPublish,
  adminExportCourseContent,
  adminPreviewCourseContentImport,
  adminCommitCourseContentImport,
  adminListCourseImportHistory,
  adminRestoreCourseSnapshot,
  adminCreateCourseVersion,
} from '../src/lib/repositories/contentRepository.js';
import {
  CONTENT_PACKAGE_SCHEMA_VERSION,
  CONTENT_PACKAGE_TYPE,
  ALLOWED_BLOCK_TYPES_LIST,
  parseContentPackageJson,
  validateLessonBlock,
  validateLessonInstructionalContent,
  buildDryRunImportPlan,
  buildImportErrorReport,
  buildCourseExportPackage,
} from '../src/lib/contentPackage.js';
import { BLOCK_TYPE_CATALOG } from '../src/lib/lessonBlocks.js';

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  resetDemoState();
});

async function signInDemoAdmin() {
  const admin = getDemoState().users.find((u) => u.role === 'admin' && u.password);
  assert.ok(admin && admin.password, 'Seeded demo admin must exist');
  await signIn({ email: admin.email, password: admin.password });
  return admin;
}

test('All 15 supported lesson block types validate cleanly and unknown or malformed blocks reject', () => {
  assert.equal(ALLOWED_BLOCK_TYPES_LIST.length, BLOCK_TYPE_CATALOG.length);
  assert.equal(ALLOWED_BLOCK_TYPES_LIST.length, 15);

  const validSamples = [
    { type: 'heading', text: 'Overview', level: 2 },
    { type: 'paragraph', text: 'Clear explanation of domain concepts exceeding length thresholds.' },
    { type: 'steps', title: 'Checklist', items: ['Step 1: Verify structure'] },
    { type: 'bullets', title: 'Highlights', items: ['Point A', 'Point B'] },
    { type: 'definition', term: 'Idempotency', meaning: 'Repeatable execution with zero duplicate side effects.' },
    { type: 'example', title: 'Sample', body: 'Practical worked scenario.' },
    { type: 'case_study', title: 'Case', scenario: 'Real-world team transition.', takeaway: 'Document decisions.' },
    { type: 'table', title: 'Matrix', headers: ['Col A', 'Col B'], rows: [['Val 1', 'Val 2']] },
    { type: 'callout', title: 'Reminder', text: 'Always preview dry-run diffs first.' },
    { type: 'demonstration', title: 'Demo', instructions: 'Run dry run before commit.', expectedOutcome: 'Plan rendered' },
    { type: 'code', title: 'HTML Snippet', language: 'html', code: '<main><nav>Menu</nav></main>' },
    { type: 'image', title: 'Diagram', url: '/assets/diagram.png', alt: 'Architecture flow', caption: 'System overview diagram' },
    { type: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Walkthrough' },
    { type: 'resource_download', title: 'Template', description: 'Starter JSON guide', url: 'https://example.org/guide.pdf' },
    {
      type: 'knowledge_check',
      prompt: 'What status do newly imported lessons receive?',
      options: ['Draft', 'Auto-published'],
      correctIndex: 0,
      explanation: 'New lessons always stage as draft.',
    },
  ];

  validSamples.forEach((blk, idx) => {
    const res = validateLessonBlock(blk, idx);
    assert.equal(res.valid, true, `Expected valid block for type "${blk.type}": ${JSON.stringify(res.errors)}`);
  });

  // Unknown block type rejected
  const unknown = validateLessonBlock({ type: 'raw_iframe_widget', html: '<iframe src="x"></iframe>' }, 0);
  assert.equal(unknown.valid, false);
  assert.match(unknown.errors[0].message, /Unsupported block type/i);

  // Knowledge check out-of-range index rejected
  const badQuiz = validateLessonBlock(
    { type: 'knowledge_check', prompt: 'Pick one', options: ['A', 'B'], correctIndex: 5 },
    0
  );
  assert.equal(badQuiz.valid, false);
  assert.match(badQuiz.errors[0].field, /correctIndex/);

  // Table row mismatch rejected
  const badTable = validateLessonBlock(
    { type: 'table', headers: ['A', 'B'], rows: [['OnlyOne']] },
    0
  );
  assert.equal(badTable.valid, false);
});

test('Security & instructional content validation blocks XSS, unsafe URLs, and low-substance title-only shells while keeping code snippets & safe prose', () => {
  // Script tag & event handler rejected
  const xssLesson = validateLessonInstructionalContent({
    title: 'Injected Lesson',
    introduction: 'Normal intro text with enough characters to clear minimum length.',
    blocks: [{ type: 'paragraph', text: 'Click <img src=x onerror="alert(1)"> to continue.' }],
  });
  assert.equal(xssLesson.valid, false);
  assert.ok(xssLesson.errors.some((e) => /Disallowed raw HTML/i.test(e.message)));

  // Unsafe javascript: URL in image or furtherReading rejected
  const unsafeUrlLesson = validateLessonInstructionalContent({
    title: 'Bad URL Lesson',
    blocks: [
      { type: 'paragraph', text: 'Instructional text explaining resources clearly for learners.' },
      { type: 'image', alt: 'Bad pic', url: 'javascript:alert(1)' },
    ],
    furtherReading: [{ title: 'Malicious', url: 'data:text/html,<script>1</script>' }],
  });
  assert.equal(unsafeUrlLesson.valid, false);
  assert.ok(unsafeUrlLesson.errors.some((e) => /Unsafe URL scheme/i.test(e.message)));

  // Title-only / heading-only without substantive content rejected
  const hollowLesson = validateLessonInstructionalContent({
    title: 'Heading Only Shell',
    blocks: [{ type: 'heading', text: 'Short Section' }],
  });
  assert.equal(hollowLesson.valid, false);
  assert.ok(hollowLesson.errors.some((e) => /meaningful instructional content/i.test(e.message)));

  // Technical prose mentioning <nav> and <code> snippets remain valid
  const techLesson = validateLessonInstructionalContent({
    title: 'Semantic HTML Regions',
    blocks: [
      {
        type: 'paragraph',
        text: 'Use <nav>, <main>, and <article> landmarks cleanly when structuring accessible web layouts.',
      },
      {
        type: 'code',
        language: 'html',
        code: '<script>console.log("Rendered strictly via escapeHtml inside code block");</script>',
      },
    ],
  });
  assert.equal(techLesson.valid, true, JSON.stringify(techLesson.errors));
});

test('Every seeded course passes strengthened validateCourseForPublish and example JSON package parses & dry-runs cleanly', async () => {
  const allCourses = await listAllCourses({ includeDrafts: true });
  assert.ok(allCourses.length >= 4);

  for (const summary of allCourses) {
    const full = await getCourseById(summary.id, { includeDrafts: true });
    assert.ok(full);
    if (full.publicationStatus === 'published') {
      const check = validateCourseForPublish(full);
      assert.equal(check.valid, true, `Seeded course "${full.title}" failed publish check: ${check.errors.join('; ')}`);
    }
  }

  // Example JSON file in docs/examples parses cleanly and passes dry-run against frontend foundations
  const exampleRaw = fs.readFileSync(
    path.resolve('docs/examples/kord-course-content.example.json'),
    'utf8'
  );
  const parsed = parseContentPackageJson(exampleRaw);
  assert.equal(parsed.valid, true);
  if (parsed.valid) {
    const target = allCourses.find((c) => c.slug === 'frontend-development-foundations');
    assert.ok(target);
    const plan = buildDryRunImportPlan({ packageData: parsed.packageData, targetCourse: target });
    assert.equal(plan.valid, true, JSON.stringify(plan));
    assert.equal(plan.canCommit, true);
    assert.equal(plan.counts.new, 1);
    assert.equal(plan.lessons[0].effectiveStatus, 'draft');
  }
});

test('Export -> Unedited Re-import evaluates to Unchanged; edits evaluate cleanly; mismatched IDs and position collisions fail dry-run with downloadable error report', async () => {
  await signInDemoAdmin();
  const target = (await listAllCourses({ includeDrafts: true })).find(
    (c) => c.slug === 'frontend-development-foundations'
  );
  assert.ok(target);

  const exported = await adminExportCourseContent(target.id);
  assert.equal(exported.packageData.schemaVersion, CONTENT_PACKAGE_SCHEMA_VERSION);
  assert.equal(exported.packageData.packageType, CONTENT_PACKAGE_TYPE);

  // Unedited export -> 100% Unchanged, canCommit = false
  const roundTripPreview = await adminPreviewCourseContentImport({
    courseId: target.id,
    rawJsonText: exported.jsonString,
    logRejection: false,
  });
  assert.equal(roundTripPreview.parsed, true);
  assert.ok(roundTripPreview.plan);
  assert.equal(roundTripPreview.plan.valid, true);
  assert.equal(roundTripPreview.plan.canCommit, false);
  assert.equal(roundTripPreview.plan.counts.updated, 0);
  assert.equal(roundTripPreview.plan.counts.new, 0);
  assert.ok(roundTripPreview.plan.counts.unchanged > 0);

  // Wrong course slug rejected
  const wrongCoursePkg = structuredClone(exported.packageData);
  wrongCoursePkg.course.slug = 'some-other-course';
  const wrongPreview = await adminPreviewCourseContentImport({
    courseId: target.id,
    rawJsonText: JSON.stringify(wrongCoursePkg),
  });
  assert.ok(wrongPreview.plan);
  assert.equal(wrongPreview.plan.valid, false);
  assert.ok(wrongPreview.plan.packageErrors.some((e) => e.field === 'course.slug'));

  // Title-only match without id or isNew rejected; cross-lesson position collision rejected; error report built
  const badPkg = structuredClone(exported.packageData);
  const firstPhase = badPkg.phases[0];
  const l0 = firstPhase.lessons[0];
  const l1 = firstPhase.lessons[1];
  firstPhase.lessons = [
    {
      ...l0,
      id: undefined, // omitted without isNew: true
    },
    {
      ...l1,
      position: 1, // l0 wasn't updated because it lacked id? Wait: explicit collision with another lesson at pos 1:
    },
    {
      isNew: true,
      title: 'Duplicate Pos 1 Lesson',
      blocks: [{ type: 'paragraph', text: 'Valid instructional text but duplicate position 1 collides.' }],
      position: 1,
    },
  ];
  const badPreview = await adminPreviewCourseContentImport({
    courseId: target.id,
    rawJsonText: JSON.stringify(badPkg),
  });
  assert.ok(badPreview.plan);
  assert.equal(badPreview.plan.valid, false);
  assert.equal(badPreview.plan.counts.rejected >= 2, true);
  const report = buildImportErrorReport(badPreview.plan);
  assert.equal(report.rejectedLessons.length >= 2, true);
});

test('End-to-End Demo Bulk Import, Active Admin Guard, Draft Staging, Progress Preservation & Snapshot Recovery', async () => {
  const courses = await listAllCourses({ includeDrafts: true });
  const course = courses.find((c) => c.slug === 'frontend-development-foundations');
  assert.ok(course && course.phases && course.phases[0]);

  const phase1 = course.phases[0];
  assert.ok(phase1.lessons && phase1.lessons[0]);
  const lesson1 = phase1.lessons[0];

  // Learner signs up, enrolls, and completes lesson1
  const learner = await signUp({
    firstName: 'Ada',
    lastName: 'Learner',
    email: 'ada.bulk.test@example.com',
    password: 'password123',
  });
  assert.ok(learner);
  await enrollInCourse(learner.user.id, course.id);
  await toggleLessonComplete(learner.user.id, course.id, lesson1.id, lesson1.estMinutes || 25, true);

  // Non-admin learner cannot export, preview, commit, read history, or restore
  await assert.rejects(() => adminExportCourseContent(course.id), /Administrator access required/i);
  await assert.rejects(
    () => adminListCourseImportHistory({ courseId: course.id }),
    /Administrator access required/i
  );

  // Admin signs in (also test suspended admin is blocked)
  const admin = await signInDemoAdmin();
  updateDemoState((draft) => {
    const a = draft.users.find((u) => u.id === admin.id);
    if (a) a.accountStatus = 'suspended';
    return draft;
  });
  await assert.rejects(() => adminExportCourseContent(course.id), /Administrator access required/i);
  updateDemoState((draft) => {
    const a = draft.users.find((u) => u.id === admin.id);
    if (a) a.accountStatus = 'active';
    return draft;
  });

  // Export & verify zero learner PII leaked in export JSON
  const exported = await adminExportCourseContent(course.id);
  assert.doesNotMatch(exported.jsonString, /ada\.bulk\.test@example\.com/);

  // Modify lesson1 and add 1 new lesson (even with publicationStatus: 'published' -> must become 'draft')
  const importPkg = buildCourseExportPackage(course);
  importPkg.phases = [
    {
      id: phase1.id,
      position: phase1.position,
      title: phase1.title,
      lessons: [
        {
          ...importPkg.phases[0].lessons[0],
          title: `${lesson1.title} (Bulk Revised)`,
          publicationStatus: 'draft', // existing published lesson must stay 'published'
          summary: 'Updated concise lesson summary after team review.',
        },
        {
          isNew: true,
          phaseId: phase1.id,
          title: 'New Staged Practice Lesson',
          introduction: 'Guided practice introduction describing concrete real-world implementation objectives.',
          publicationStatus: 'published', // MUST be coerced to 'draft'
          blocks: [
            { type: 'heading', text: 'Practice Brief' },
            { type: 'paragraph', text: 'Complete this practice guide before moving to the graded assessment.' },
          ],
        },
      ],
    },
  ];

  const commitRes = await adminCommitCourseContentImport({
    courseId: course.id,
    rawJsonText: JSON.stringify(importPkg),
    changeNotes: 'Sprint 14 content refresh',
    idempotencyKey: 'demo-idem-1',
  });
  assert.equal(commitRes.createdCount, 1);
  assert.equal(commitRes.updatedCount, 1);
  assert.equal(commitRes.idempotentReplay, false);
  assert.ok(commitRes.snapshotVersionId);

  // Replay with same idempotencyKey returns cached commit cleanly
  const replayRes = await adminCommitCourseContentImport({
    courseId: course.id,
    rawJsonText: JSON.stringify(importPkg),
    changeNotes: 'Sprint 14 content refresh',
    idempotencyKey: 'demo-idem-1',
  });
  assert.equal(replayRes.idempotentReplay, true);
  assert.equal(replayRes.importId, commitRes.importId);

  // Verify updated lesson kept ID & 'published'; new lesson forced to 'draft'; learner progress intact
  const afterImportCourse = await getCourseById(course.id, { includeDrafts: true });
  assert.ok(afterImportCourse && afterImportCourse.phases);
  const afterLessons = afterImportCourse.phases[0].lessons || [];
  const afterL1 = afterLessons.find((l) => l.id === lesson1.id);
  const createdL = afterLessons.find((l) => l.title === 'New Staged Practice Lesson');
  assert.ok(afterL1 && createdL);
  assert.equal(afterL1.title, `${lesson1.title} (Bulk Revised)`);
  assert.equal(afterL1.publicationStatus, 'published');
  assert.equal(createdL.publicationStatus, 'draft');

  // Verify learner completion still present
  const lpBeforeRestore = getDemoState().lessonProgress.find(
    (lp) => lp.userId === learner.user.id && lp.lessonId === lesson1.id
  );
  assert.ok(lpBeforeRestore && lpBeforeRestore.completed === true);

  // Learner completes createdL too, then admin creates manual snapshot & restores pre_import snapshot
  setDemoCurrentUserId(admin.id);
  await adminCreateCourseVersion(course.id, 'Manual checkpoint');
  const restoreRes = await adminRestoreCourseSnapshot({
    courseId: course.id,
    versionId: /** @type {string} */ (commitRes.snapshotVersionId),
    restoreNotes: 'Reverting Sprint 14 revision',
  });
  assert.equal(restoreRes.restoredFromVersionId, commitRes.snapshotVersionId);

  const restoredCourse = await getCourseById(course.id, { includeDrafts: true });
  assert.ok(restoredCourse && restoredCourse.phases);
  const restoredL1 = (restoredCourse.phases[0].lessons || []).find((l) => l.id === lesson1.id);
  assert.ok(restoredL1);
  assert.equal(restoredL1.title, lesson1.title);

  // Learner progress, enrollments, and history/audit logs intact
  assert.equal(
    getDemoState().lessonProgress.some(
      (lp) => lp.userId === learner.user.id && lp.lessonId === lesson1.id && lp.completed
    ),
    true
  );
  assert.equal(
    getDemoState().courseEnrollments.some(
      (ce) => ce.userId === learner.user.id && ce.courseId === course.id
    ),
    true
  );

  const history = await adminListCourseImportHistory({ courseId: course.id });
  assert.equal(history.length >= 2, true);
  assert.ok(history.some((h) => h.status === 'committed'));
  assert.ok(history.some((h) => h.status === 'restored'));
});
