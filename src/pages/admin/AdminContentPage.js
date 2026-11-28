import {
  listCategories,
  listSkills,
  listAllCourses,
  getCourseById,
  adminUpsertCategory,
  adminUpsertSkill,
  adminUpsertCourse,
  adminSetCourseStatus,
  adminCreateCourseVersion,
  adminUpsertPhase,
  adminReorderPhases,
  adminUpsertActivity,
  adminUpsertLesson,
  adminReorderLessons,
  adminDeleteLesson,
  validateCourseForPublish,
  adminExportCourseContent,
  adminPreviewCourseContentImport,
  adminCommitCourseContentImport,
  adminListCourseImportHistory,
  adminRestoreCourseSnapshot,
} from '../../lib/repositories/contentRepository.js';
import { DIFFICULTY_LEVELS } from '../../lib/constants.js';
import {
  CONTENT_PACKAGE_SCHEMA_VERSION,
  CONTENT_PACKAGE_TYPE,
  buildImportErrorReport,
  isSafeContentUrl,
} from '../../lib/contentPackage.js';
import {
  extractLessonArticle,
  assembleLessonFromEditor,
  richTextHtmlToMainBlocks,
  countMainLessonWords,
  sanitizeRichTextHtml,
  renderSimplifiedLessonView,
  bindSimplifiedLessonAssessment,
  validateLessonPublishReadiness,
} from '../../lib/lessonArticle.js';
import { renderCourseThumbnailHtml } from '../../lib/courseThumbnails.js';
import { normalizeVideoEntry } from '../../lib/videoProvider.js';
import { escapeHtml, formatDate } from '../../lib/formatters.js';
import { registerSessionCleanup } from '../../lib/sessionLifecycle.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { renderStatusBadge } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let activeTab = 'courses'; // 'catalog' | 'courses' | 'lessons' | 'import_export'
/** @type {string | null} */
let selectedSkillId = null;
/** @type {string | null} */
let selectedCourseId = null;
/** @type {string | null} */
let selectedPhaseId = null;
let courseFormMode = 'edit'; // 'edit' | 'create'
let previewCourseOpen = false;
/** @type {string | null} */
let previewLessonId = null;
let catalogCategoryFilter = 'All';
let catalogCourseStatusFilter = 'all';
/** @type {string | null} */
let editingSkillId = null;

// Stateful Simplified Lesson Editor state
/** @type {string | null} */
let editingLessonId = null;
let lessonPreviewOpen = true;
let linkPopoverOpen = false;
let lessonDraft = {
  title: '',
  estMinutes: 25,
  introduction: '',
  objectives: '',
  mainHtml: '<p><br></p>',
  practicalTitle: 'Practical Application',
  practicalInstructions: '',
  practicalExpectedOutcome: '',
  summary: '',
  takeaways: '',
  completionCriteria: 'Read the lesson carefully, complete the practical application, submit the assessment check, and mark this lesson complete.',
  publicationStatus: 'draft',
  isRequired: true,
};
/** @type {import('../../types/kord.d.ts').LessonBlock[]} */
let preservedImageBlocks = [];
/** @type {Array<{ id: string; prompt: string; options: string[]; correctIndex: number; explanation: string }>} */
let draftQuestions = [
  {
    id: 'kc-new-1',
    prompt: '',
    options: ['', '', ''],
    correctIndex: 0,
    explanation: '',
  },
];
/** @type {import('../../types/kord.d.ts').VideoEntry[]} */
let draftVideos = [];
/** @type {import('../../types/kord.d.ts').FurtherReadingItem[]} */
let draftResources = [];

// Stateful Bulk Content Import / Export / Recovery state
let importJsonText = '';
let lastPreviewedJsonText = '';
let importFileName = '';
let importChangeNotes = '';
/** @type {import('../../types/kord.d.ts').DryRunImportPlan | null} */
let dryRunPlan = null;
/** @type {import('../../types/kord.d.ts').DryRunValidationIssue[]} */
let dryRunParseErrors = [];
let confirmBulkImport = false;
let importInFlight = false;
/** @type {string | null} */
let restoreInFlightId = null;
/** @type {string | null} */
let confirmRestoreVersionId = null;
let restoreNotes = '';
let exportPreviewOpen = false;
let exportPreviewJson = '';
/** @type {import('../../types/kord.d.ts').BulkImportCommitResult | null} */
let lastCommitResult = null;

function resetImportExportState() {
  importJsonText = '';
  lastPreviewedJsonText = '';
  importFileName = '';
  importChangeNotes = '';
  dryRunPlan = null;
  dryRunParseErrors = [];
  confirmBulkImport = false;
  importInFlight = false;
  restoreInFlightId = null;
  confirmRestoreVersionId = null;
  restoreNotes = '';
  exportPreviewOpen = false;
  exportPreviewJson = '';
  lastCommitResult = null;
}

function resetLessonBuilder() {
  editingLessonId = null;
  linkPopoverOpen = false;
  lessonDraft = {
    title: '',
    estMinutes: 25,
    introduction: '',
    objectives: '',
    mainHtml: '<p><br></p>',
    practicalTitle: 'Practical Application',
    practicalInstructions: '',
    practicalExpectedOutcome: '',
    summary: '',
    takeaways: '',
    completionCriteria: 'Read the lesson carefully, complete the practical application, submit the assessment check, and mark this lesson complete.',
    publicationStatus: 'draft',
    isRequired: true,
  };
  preservedImageBlocks = [];
  draftQuestions = [
    {
      id: `kc-${Date.now().toString(36)}-1`,
      prompt: '',
      options: ['', '', ''],
      correctIndex: 0,
      explanation: '',
    },
  ];
  draftVideos = [];
  draftResources = [];
}

/** @returns {ReturnType<typeof assembleLessonFromEditor>} */
function buildAssembledDraftLesson() {
  return assembleLessonFromEditor({
    title: lessonDraft.title,
    estMinutes: lessonDraft.estMinutes,
    introduction: lessonDraft.introduction,
    objectives: lessonDraft.objectives,
    mainHtml: lessonDraft.mainHtml,
    preservedImageBlocks,
    practicalApplication: {
      title: lessonDraft.practicalTitle,
      instructions: lessonDraft.practicalInstructions,
      expectedOutcome: lessonDraft.practicalExpectedOutcome,
    },
    summary: lessonDraft.summary,
    takeaways: lessonDraft.takeaways,
    assessmentQuestions: draftQuestions,
    videos: draftVideos,
    furtherReading: draftResources,
    completionCriteria: lessonDraft.completionCriteria,
    publicationStatus: lessonDraft.publicationStatus,
    isRequired: lessonDraft.isRequired,
  });
}

registerSessionCleanup(() => {
  activeTab = 'courses';
  selectedSkillId = null;
  selectedCourseId = null;
  selectedPhaseId = null;
  courseFormMode = 'edit';
  previewCourseOpen = false;
  previewLessonId = null;
  catalogCategoryFilter = 'All';
  catalogCourseStatusFilter = 'all';
  editingSkillId = null;
  lessonPreviewOpen = true;
  resetLessonBuilder();
  resetImportExportState();
});

/**
 * Triggers an in-browser JSON file download without window.open or popups.
 *
 * @param {string} filename
 * @param {string} jsonString
 */
function downloadJsonFile(filename, jsonString) {
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Formats a diff field value into a readable, bounded summary string.
 *
 * @param {unknown} val
 * @returns {string}
 */
function formatDiffValue(val) {
  if (val === null || val === undefined || val === '') return '(empty)';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    const str = String(val);
    return str.length > 220 ? `${str.slice(0, 220)}…` : str;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const json = JSON.stringify(val);
    return json.length > 260 ? `${val.length} items — ${json.slice(0, 220)}…` : json;
  }
  const json = JSON.stringify(val);
  return json.length > 260 ? `${json.slice(0, 240)}…` : json;
}

/**
 * Builds a minimal valid v1.0 JSON import starter template for the active course.
 *
 * @param {import('../../types/kord.d.ts').Course} course
 * @returns {string}
 */
function buildStarterPackageTemplate(course) {
  const firstPhase = (course.phases || [])[0];
  return JSON.stringify(
    {
      schemaVersion: CONTENT_PACKAGE_SCHEMA_VERSION,
      packageType: CONTENT_PACKAGE_TYPE,
      course: {
        id: course.id,
        slug: course.slug,
        title: course.title,
      },
      phases: [
        {
          id: firstPhase?.id || 'replace-with-existing-phase-id',
          lessons: [
            {
              isNew: true,
              title: 'New Structured Practical Lesson',
              introduction: 'Introduce the practical scope, tools, and mental model learners will apply in this lesson.',
              objectives: ['Apply core concept accurately', 'Complete self-check verification'],
              estMinutes: 25,
              isRequired: true,
              blocks: [
                { type: 'heading', text: 'Core Framework' },
                {
                  type: 'paragraph',
                  text: 'Provide clear, step-by-step instructional explanations free of raw HTML tags.',
                },
                {
                  type: 'steps',
                  title: 'Execution Checklist',
                  items: ['Audit existing assumptions', 'Document measurable outcome'],
                },
                {
                  type: 'knowledge_check',
                  prompt: 'Which practice keeps imported course content reliable?',
                  options: [
                    'Validate structured JSON blocks and preview diffs before commit',
                    'Bypass validation checks and auto-publish untested drafts',
                  ],
                  correctIndex: 0,
                  explanation: 'Dry-run validation and draft staging protect learner progress.',
                },
              ],
              summary: 'Recap how structured workflows preserve curriculum quality.',
              takeaways: ['Every imported lesson defaults safely to Draft status.'],
              furtherReading: [
                {
                  title: 'MDN Web Docs Reference',
                  source: 'MDN',
                  url: 'https://developer.mozilla.org/en-US/',
                  resourceType: 'Documentation',
                },
              ],
              completionCriteria: 'Review every block, verify the inline check, and mark complete.',
            },
          ],
        },
      ],
    },
    null,
    2
  );
}

/** @param {import('../../types/kord.d.ts').Lesson | null} lesson */
function loadLessonIntoBuilder(lesson) {
  if (!lesson) {
    resetLessonBuilder();
    return;
  }
  const article = extractLessonArticle(lesson);
  editingLessonId = lesson.id;
  linkPopoverOpen = false;
  lessonDraft = {
    title: article.title,
    estMinutes: article.estMinutes,
    introduction: article.introduction,
    objectives: article.objectives.join('\n'),
    mainHtml: article.mainHtml || '<p><br></p>',
    practicalTitle: article.practicalApplication.title || 'Practical Application',
    practicalInstructions: article.practicalApplication.instructions,
    practicalExpectedOutcome: article.practicalApplication.expectedOutcome,
    summary: article.summary,
    takeaways: article.takeaways.join('\n'),
    completionCriteria:
      article.completionCriteria ||
      'Read the lesson carefully, complete the practical application, submit the assessment check, and mark this lesson complete.',
    publicationStatus: article.publicationStatus || 'published',
    isRequired: article.isRequired !== false,
  };
  preservedImageBlocks = structuredClone(article.preservedImageBlocks || []);
  draftQuestions =
    article.assessmentQuestions.length > 0
      ? structuredClone(article.assessmentQuestions)
      : [
          {
            id: `kc-${Date.now().toString(36)}-1`,
            prompt: '',
            options: ['', '', ''],
            correctIndex: 0,
            explanation: '',
          },
        ];
  draftVideos = structuredClone(article.videos || []);
  draftResources = structuredClone(article.furtherReading || []);
}

/**
 * Renders one question card in the dedicated assessment editor.
 *
 * @param {{ id: string; prompt: string; options: string[]; correctIndex: number; explanation: string }} q
 * @param {number} qIdx
 * @param {number} total
 */
function renderAssessmentQuestionEditor(q, qIdx, total) {
  const options = Array.isArray(q.options) && q.options.length >= 2 ? q.options : ['', ''];
  return `
    <div class="admin-question-card" data-question-card="${qIdx}">
      <div class="admin-question-card-head">
        <strong style="font-size:13px; color:var(--color-navy);">Question ${qIdx + 1}</strong>
        <div style="display:flex; gap:4px; align-items:center;">
          <button type="button" class="btn btn-secondary btn-sm" data-move-q="${qIdx}" data-dir="-1" ${qIdx === 0 ? 'disabled' : ''}>Up</button>
          <button type="button" class="btn btn-secondary btn-sm" data-move-q="${qIdx}" data-dir="1" ${qIdx === total - 1 ? 'disabled' : ''}>Down</button>
          <button type="button" class="btn btn-danger btn-sm" data-del-q="${qIdx}">Remove</button>
        </div>
      </div>

      <div class="field" style="margin-bottom:8px;">
        <label class="field-label" for="q-prompt-${qIdx}">Question prompt</label>
        <input class="input" id="q-prompt-${qIdx}" data-q-field="prompt" data-q-idx="${qIdx}" value="${escapeHtml(q.prompt || '')}" placeholder="Write a meaningful conceptual or applied question…" />
      </div>

      <div class="field" style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px;">
          <span class="field-label" style="margin:0;">Answer options (select the correct answer)</span>
          ${options.length < 5 ? `<button type="button" class="btn btn-ghost btn-sm" data-add-q-opt="${qIdx}">+ Add option</button>` : ''}
        </div>
        <div class="admin-question-options">
          ${options
            .map(
              (opt, oIdx) => `
            <div class="admin-question-opt-row">
              <label class="admin-question-radio" title="Mark option ${oIdx + 1} as correct">
                <input type="radio" name="q_correct_${qIdx}" value="${oIdx}" data-q-correct="${qIdx}" ${Number(q.correctIndex) === oIdx ? 'checked' : ''} />
                <span>Correct</span>
              </label>
              <input class="input" data-q-opt="${qIdx}" data-opt-idx="${oIdx}" value="${escapeHtml(opt || '')}" placeholder="Option ${oIdx + 1}" />
              ${
                options.length > 2
                  ? `<button type="button" class="btn btn-ghost btn-sm" data-del-q-opt="${qIdx}" data-opt-idx="${oIdx}" title="Remove option">×</button>`
                  : ''
              }
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="q-exp-${qIdx}">Post-submission explanation</label>
        <textarea class="textarea" id="q-exp-${qIdx}" data-q-field="explanation" data-q-idx="${qIdx}" style="min-height:54px;" placeholder="Explain why the correct answer holds and address common misconceptions (revealed only after submission)…">${escapeHtml(q.explanation || '')}</textarea>
      </div>
    </div>
  `;
}

/**
 * @param {import('../../types/kord.d.ts').RouteContext} ctx
 * @returns {Promise<import('../../types/kord.d.ts').PageView>}
 */
export async function renderAdminContentPage({ currentPath, rerender }) {
  const [categories, skills, courses] = await Promise.all([
    listCategories(),
    listSkills({ includeDrafts: true }),
    listAllCourses({ includeDrafts: true }),
  ]);

  if (!selectedSkillId || !skills.some((s) => s.id === selectedSkillId)) {
    selectedSkillId = skills.find((s) => (s.courseCount || 0) > 0)?.id || skills[0]?.id || null;
  }

  const skillCourses = courses.filter(
    (c) => c.skillId === selectedSkillId || (selectedSkillId ? (c.associatedSkillIds || []).includes(selectedSkillId) : false)
  );
  if (!selectedCourseId || !courses.some((c) => c.id === selectedCourseId)) {
    selectedCourseId = skillCourses[0]?.id || courses[0]?.id || null;
  }
  const activeCourseSummary = courses.find((c) => c.id === selectedCourseId) || null;
  const activeCourse = activeCourseSummary
    ? (await getCourseById(activeCourseSummary.id, { includeDrafts: true })) || activeCourseSummary
    : null;
  const publishCheck = activeCourse ? validateCourseForPublish(activeCourse) : null;
  const phases = activeCourse?.phases || [];
  if (!selectedPhaseId || !phases.some((p) => p.id === selectedPhaseId)) {
    selectedPhaseId = phases[0]?.id || null;
  }
  const activePhase = phases.find((p) => p.id === selectedPhaseId) || null;
  const phaseLessons = activePhase?.lessons || [];

  if (editingLessonId && !phaseLessons.some((l) => l.id === editingLessonId)) {
    editingLessonId = null;
  }

  const editCourseObj = courseFormMode === 'edit' && activeCourse ? activeCourse : null;
  if (!activeCourse && courseFormMode === 'edit') {
    courseFormMode = 'create';
  }

  const previewLessonsFlat = phases.flatMap((p) =>
    (p.lessons || []).map((l) => ({ ...l, phaseTitle: p.title, phasePosition: p.position }))
  );
  const previewLesson =
    previewLessonsFlat.find((l) => l.id === previewLessonId) || previewLessonsFlat[0] || null;

  const filteredCatalogSkills = skills.filter((s) => {
    if (catalogCategoryFilter !== 'All' && s.category !== catalogCategoryFilter) return false;
    if (catalogCourseStatusFilter === 'published_courses' && s.courseCount === 0) return false;
    if (catalogCourseStatusFilter === 'draft_courses' && (s.draftCourseCount || 0) === 0) return false;
    if (catalogCourseStatusFilter === 'no_courses' && (s.totalCourseCount || 0) > 0) return false;
    return true;
  });
  const editingSkill = editingSkillId ? skills.find((s) => s.id === editingSkillId) || null : null;

  /** @type {import('../../types/kord.d.ts').ContentImportRecord[]} */
  let importHistory = [];
  if (activeTab === 'import_export' && activeCourse) {
    try {
      importHistory = await adminListCourseImportHistory({ courseId: activeCourse.id, limit: 25 });
    } catch {
      importHistory = [];
    }
  }
  const recoverableVersions = (activeCourse?.versions || []).filter(
    (v) => v.snapshotData && Array.isArray(v.snapshotData.phases)
  );
  const dryRunMatchesCurrentText = Boolean(dryRunPlan) && importJsonText === lastPreviewedJsonText;
  const totalCourseLessons = phases.reduce((sum, p) => sum + (p.lessons || []).length, 0);

  const editorDraftLesson = buildAssembledDraftLesson();
  const editorReadiness = validateLessonPublishReadiness(editorDraftLesson);
  const editorWordCount = countMainLessonWords(
    richTextHtmlToMainBlocks(lessonDraft.mainHtml || '', { preservedImageBlocks })
  );
  const editorPreviewRender =
    activeTab === 'lessons' && lessonPreviewOpen
      ? renderSimplifiedLessonView(
          {
            id: editingLessonId || 'preview-draft',
            position: 1,
            ...editorDraftLesson,
          },
          {
            phaseLabel: activePhase ? `Module ${activePhase.position}: ${activePhase.title}` : 'Lesson Preview',
            statusBadgeHtml: renderStatusBadge(lessonDraft.publicationStatus || 'draft'),
            showStatusBadge: true,
            assessmentScopeId: 'admin_editor_preview',
          }
        )
      : null;
  const coursePreviewRender =
    previewCourseOpen && previewLesson
      ? renderSimplifiedLessonView(previewLesson, {
          phaseLabel: `Module ${previewLesson.phasePosition}: ${previewLesson.phaseTitle}`,
          statusBadgeHtml: renderStatusBadge(previewLesson.publicationStatus || 'published'),
          showStatusBadge: true,
          assessmentScopeId: 'admin_course_preview',
        })
      : null;

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Course Engine &amp; Curriculum Authoring</h1>
        <p class="page-subtitle">Manage ${courses.length} courses, ${skills.length} competencies, modules, article-style lessons, assessments, bulk JSON import/export, and snapshot recovery.</p>
      </div>

      <div class="segmented" role="tablist">
        <button type="button" class="segmented-btn ${activeTab === 'courses' ? 'is-active' : ''}" data-admin-tab="courses">Courses &amp; Modules</button>
        <button type="button" class="segmented-btn ${activeTab === 'lessons' ? 'is-active' : ''}" data-admin-tab="lessons">Lesson Editor</button>
        <button type="button" class="segmented-btn ${activeTab === 'import_export' ? 'is-active' : ''}" data-admin-tab="import_export">Import / Export</button>
        <button type="button" class="segmented-btn ${activeTab === 'catalog' ? 'is-active' : ''}" data-admin-tab="catalog">Categories &amp; Skills (${skills.length})</button>
      </div>
    </div>

    ${
      activeTab === 'courses'
        ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="lab-grid-2">
          <div class="field">
            <label class="field-label" for="admin-course-skill">Filter by Parent / Associated Skill</label>
            <select class="select" id="admin-course-skill">
              ${skills
                .map(
                  (s) => `<option value="${escapeHtml(s.id)}" ${s.id === selectedSkillId ? 'selected' : ''}>${escapeHtml(s.title)} (${escapeHtml(s.category)} · ${s.courseCount} courses)</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="admin-active-course">Select Course (${skillCourses.length} under skill · ${courses.length} total)</label>
            <select class="select" id="admin-active-course">
              ${
                skillCourses.length > 0
                  ? skillCourses
                      .map(
                        (c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedCourseId ? 'selected' : ''}>${escapeHtml(c.title)} (${escapeHtml(c.difficulty)} · v${c.version || 1} · ${c.publicationStatus})</option>`
                      )
                      .join('')
                  : '<option value="">No courses linked to this skill yet — create one on the right</option>'
              }
            </select>
          </div>
        </div>
      </div>

      <div class="lab-split">
        <section class="card" style="display:flex; flex-direction:column; gap:16px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; padding-bottom:14px; border-bottom:1px solid var(--color-border);">
            <div>
              <h2 class="section-heading" style="margin:0;">${activeCourse ? escapeHtml(activeCourse.title) : 'No course selected'}</h2>
              ${
                activeCourse
                  ? `<div class="meta-line" style="margin-top:4px;">
                      <span>${escapeHtml(activeCourse.difficulty)}</span>
                      <span class="meta-sep">·</span>
                      <span class="mono-num">${activeCourse.estimatedDurationWeeks} weeks (${activeCourse.recommendedWeeklyHours}h/wk)</span>
                      <span class="meta-sep">·</span>
                      <span class="mono-num">v${Number(activeCourse.version || 1)}</span>
                      <span class="meta-sep">·</span>
                      <span>By ${escapeHtml(activeCourse.authorName || 'Kord Curriculum Studio')}</span>
                      <span class="meta-sep">·</span>
                      <span>${phases.length} modules</span>
                    </div>`
                  : ''
              }
            </div>
            ${
              activeCourse
                ? `
              <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                ${renderStatusBadge(activeCourse.publicationStatus || 'draft')}
                <button type="button" class="btn btn-secondary btn-sm" id="open-course-preview">Preview course</button>
                ${
                  activeCourse.publicationStatus !== 'published'
                    ? `<button type="button" class="btn btn-primary btn-sm" data-set-course-status="published">Publish</button>`
                    : `<button type="button" class="btn btn-secondary btn-sm" data-set-course-status="draft">Unpublish (Draft)</button>`
                }
                ${
                  activeCourse.publicationStatus !== 'archived'
                    ? `<button type="button" class="btn btn-ghost btn-sm" data-set-course-status="archived">Archive</button>`
                    : ''
                }
              </div>
            `
                : ''
            }
          </div>

          ${
            activeCourse
              ? `
            <!-- Version Snapshot Bar -->
            <div style="padding:12px 14px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:var(--radius-sm); display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <input class="input" id="version-notes-input" placeholder="Release notes for v${Number(activeCourse.version || 1) + 1} (e.g. Updated capstone checklist)" style="flex:1; min-width:200px;" />
                <button type="button" class="btn btn-secondary btn-sm" id="create-course-version-btn">Create Version Snapshot (v${Number(activeCourse.version || 1) + 1})</button>
              </div>
              ${
                (activeCourse.versions || []).length > 0
                  ? `<div style="font-size:12px; color:var(--color-text-muted);">
                      Latest snapshots: ${(activeCourse.versions || [])
                        .slice(0, 3)
                        .map((v) => `v${v.versionNumber} (${escapeHtml(v.changeNotes || 'Release')})`)
                        .join(' · ')}
                    </div>`
                  : ''
              }
            </div>

            ${
              publishCheck
                ? `<div style="padding:12px 14px; border-radius:var(--radius-sm); border:1px solid ${publishCheck.valid ? 'var(--color-green-border, #bbf7d0)' : 'var(--color-amber-border)'}; background:${publishCheck.valid ? 'var(--color-green-bg)' : 'var(--color-amber-bg)'}; font-size:13px;">
                    <strong style="color:var(--color-navy); display:block; margin-bottom:${publishCheck.valid ? '0' : '4px'};">
                      ${publishCheck.valid ? 'Publish readiness check passed — course meets curriculum requirements.' : 'Publish readiness requirements remaining:'}
                    </strong>
                    ${
                      publishCheck.valid
                        ? ''
                        : `<ul style="margin:0; padding-left:18px; color:var(--color-text-secondary);">
                            ${publishCheck.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
                          </ul>`
                    }
                  </div>`
                : ''
            }
          `
              : ''
          }

          ${
            phases.length > 0
              ? `
            <div style="display:flex; flex-direction:column; gap:14px;">
              ${phases
                .map(
                  (ph, idx) => `
                <div style="padding:14px; border:1px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg);">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                      <strong style="color:var(--color-navy);">Module ${ph.position}: ${escapeHtml(ph.title)}</strong>
                      ${renderStatusBadge(ph.publicationStatus || 'published')}
                      <span class="mono-num" style="font-size:12px; color:var(--color-text-muted);">${(ph.lessons || []).length} lessons · ${(ph.activities || []).length} activities</span>
                    </div>
                    <div style="display:flex; gap:4px; align-items:center;">
                      <button type="button" class="btn btn-secondary btn-sm" data-move-phase="${escapeHtml(ph.id)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>Up</button>
                      <button type="button" class="btn btn-secondary btn-sm" data-move-phase="${escapeHtml(ph.id)}" data-dir="1" ${idx === phases.length - 1 ? 'disabled' : ''}>Down</button>
                      <button type="button" class="btn btn-ghost btn-sm" data-toggle-phase-pub="${escapeHtml(ph.id)}">
                        ${(ph.publicationStatus || 'published') === 'published' ? 'Set Draft' : 'Publish'}
                      </button>
                    </div>
                  </div>
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                    <p style="font-size:13px; color:var(--color-text-secondary); margin:0;">${escapeHtml(ph.summary || '')}</p>
                    <button type="button" class="btn btn-secondary btn-sm" data-new-lesson-phase="${escapeHtml(ph.id)}">+ New Lesson</button>
                  </div>
                  <div class="divider-list">
                    ${(ph.lessons || [])
                      .map(
                        (l, lIdx) => `
                      <div class="divider-row" style="padding:6px 0;">
                        <span style="font-size:13.5px;">
                          <span class="mono-num" style="color:var(--color-text-muted);">${lIdx + 1}.</span>
                          ${escapeHtml(l.title)}
                          <span style="color:var(--color-text-muted);">(${l.estMinutes}m · ${escapeHtml(l.publicationStatus || 'published')})</span>
                        </span>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                          <button type="button" class="btn btn-secondary btn-sm" data-move-lesson="${escapeHtml(l.id)}" data-phase-id="${escapeHtml(ph.id)}" data-dir="-1" ${lIdx === 0 ? 'disabled' : ''}>Up</button>
                          <button type="button" class="btn btn-secondary btn-sm" data-move-lesson="${escapeHtml(l.id)}" data-phase-id="${escapeHtml(ph.id)}" data-dir="1" ${lIdx === (ph.lessons || []).length - 1 ? 'disabled' : ''}>Down</button>
                          <button type="button" class="btn btn-secondary btn-sm" data-edit-lesson-btn="${escapeHtml(l.id)}" data-phase-id="${escapeHtml(ph.id)}">Edit Lesson</button>
                          <button type="button" class="btn btn-danger btn-sm" data-del-lesson="${escapeHtml(l.id)}" data-phase-id="${escapeHtml(ph.id)}">Delete</button>
                        </div>
                      </div>
                    `
                      )
                      .join('')}
                  </div>
                  ${
                    (ph.activities || []).length > 0
                      ? `<div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--color-border); font-size:12.5px; color:var(--color-text-secondary);">
                          <strong>Practical activities:</strong> ${(ph.activities || []).map((a) => escapeHtml(a.title)).join(' · ')}
                        </div>`
                      : ''
                  }
                </div>
              `
                )
                .join('')}
            </div>
          `
              : '<p style="font-size:14px; color:var(--color-text-muted);">Select or create a course, then add modules, lessons, and practical activities.</p>'
          }
        </section>

        <aside style="display:flex; flex-direction:column; gap:18px;">
          <div class="card-workspace">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
              <h2 style="font-size:1.05rem;">${editCourseObj ? 'Edit Selected Course' : 'Create New Course'}</h2>
              <div class="segmented" style="padding:2px;">
                ${activeCourse ? `<button type="button" class="segmented-btn ${courseFormMode === 'edit' ? 'is-active' : ''}" data-course-form-mode="edit">Edit current</button>` : ''}
                <button type="button" class="segmented-btn ${courseFormMode === 'create' ? 'is-active' : ''}" data-course-form-mode="create">+ New</button>
              </div>
            </div>

            <form id="admin-course-form" class="form-stack">
              <div class="field">
                <label class="field-label" for="c-title">Course title</label>
                <input class="input" id="c-title" name="title" required value="${escapeHtml(editCourseObj?.title || '')}" placeholder="e.g. Meta Ads Intermediate Retargeting" />
              </div>
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="c-slug">Slug</label>
                  <input class="input" id="c-slug" name="slug" value="${escapeHtml(editCourseObj?.slug || '')}" placeholder="auto-generated-from-title" />
                </div>
                <div class="field">
                  <label class="field-label" for="c-author">Instructor / Author</label>
                  <input class="input" id="c-author" name="authorName" value="${escapeHtml(editCourseObj?.authorName || 'Kord Curriculum Studio')}" />
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="c-desc">Description</label>
                <textarea class="textarea" id="c-desc" name="description" style="min-height:68px;" required placeholder="What learners achieve in this course…">${escapeHtml(editCourseObj?.description || '')}</textarea>
              </div>
              <div class="field">
                <label class="field-label" for="c-audience">Target audience</label>
                <input class="input" id="c-audience" name="targetAudience" value="${escapeHtml(editCourseObj?.targetAudience || '')}" placeholder="Career-starters and practitioners…" />
              </div>
              <div class="field">
                <label class="field-label" for="c-thumb">Thumbnail URL (optional)</label>
                <input class="input" id="c-thumb" name="thumbnailUrl" value="${escapeHtml(editCourseObj?.thumbnailUrl || '')}" placeholder="https://... or /assets/..." />
              </div>
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="c-diff">Difficulty</label>
                  <select class="select" id="c-diff" name="difficulty">
                    ${DIFFICULTY_LEVELS.map((d) => `<option value="${d}" ${editCourseObj?.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="c-pub">Status</label>
                  <select class="select" id="c-pub" name="publicationStatus">
                    <option value="draft" ${(editCourseObj?.publicationStatus || 'draft') === 'draft' ? 'selected' : ''}>Draft</option>
                    <option value="published" ${editCourseObj?.publicationStatus === 'published' ? 'selected' : ''}>Published</option>
                    <option value="archived" ${editCourseObj?.publicationStatus === 'archived' ? 'selected' : ''}>Archived</option>
                  </select>
                </div>
              </div>
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="c-weeks">Duration (weeks)</label>
                  <input class="input" id="c-weeks" name="estimatedDurationWeeks" type="number" min="1" max="52" value="${Number(editCourseObj?.estimatedDurationWeeks || 4)}" />
                </div>
                <div class="field">
                  <label class="field-label" for="c-hrs">Weekly hours</label>
                  <input class="input" id="c-hrs" name="recommendedWeeklyHours" type="number" min="1" max="40" value="${Number(editCourseObj?.recommendedWeeklyHours || 4)}" />
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="c-schedule">Recommended schedule</label>
                <input class="input" id="c-schedule" name="recommendedSchedule" value="${escapeHtml(editCourseObj?.recommendedSchedule || '2 lessons + 1 practical activity per week')}" />
              </div>
              <div class="field">
                <span class="field-label">Associated competencies (M2M)</span>
                <div class="checkbox-grid">
                  ${skills
                    .filter((s) => {
                      const linked = editCourseObj?.associatedSkillIds || (selectedSkillId ? [selectedSkillId] : []);
                      return linked.includes(s.id) || s.category === skills.find((x) => x.id === selectedSkillId)?.category || (s.courseCount || 0) > 0;
                    })
                    .slice(0, 30)
                    .map((s) => {
                      const checked = (editCourseObj?.associatedSkillIds || (selectedSkillId ? [selectedSkillId] : [])).includes(s.id);
                      return `
                        <label class="checkbox-item">
                          <input type="checkbox" name="associatedSkillIds" value="${escapeHtml(s.id)}" ${checked ? 'checked' : ''} />
                          <span>${escapeHtml(s.title)}</span>
                        </label>
                      `;
                    })
                    .join('')}
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="c-prereqs">Prerequisites (one per line)</label>
                <textarea class="textarea" id="c-prereqs" name="prerequisites" style="min-height:54px;">${escapeHtml((editCourseObj?.prerequisites || []).join('\n'))}</textarea>
              </div>
              <div class="field">
                <label class="field-label" for="c-outcomes">Learning objectives (one per line)</label>
                <textarea class="textarea" id="c-outcomes" name="outcomes" style="min-height:60px;" placeholder="Build retargeting audiences&#10;Measure weekly ROAS">${escapeHtml((editCourseObj?.outcomes || []).join('\n'))}</textarea>
              </div>
              <div style="display:flex; flex-direction:column; gap:6px; font-size:12.5px; color:var(--color-navy); padding:10px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-sm);">
                <strong>Completion rules</strong>
                <label><input type="checkbox" name="ruleLessons" ${(editCourseObj?.completionRules?.requireAllRequiredLessons ?? true) ? 'checked' : ''} /> Require all lessons</label>
                <label><input type="checkbox" name="ruleActivities" ${(editCourseObj?.completionRules?.requireAllActivities ?? true) ? 'checked' : ''} /> Require practical activities</label>
                <label><input type="checkbox" name="ruleAssessments" ${(editCourseObj?.completionRules?.requireAllAssessments ?? true) ? 'checked' : ''} /> Require graded assessments</label>
                <label><input type="checkbox" name="ruleChallengeApproval" ${(editCourseObj?.completionRules?.requireChallengeApproval ?? true) ? 'checked' : ''} /> Require admin capstone approval for Verified</label>
              </div>
              <button type="submit" class="btn btn-primary btn-sm">${editCourseObj ? 'Save course changes' : 'Create course'}</button>
            </form>
          </div>

          ${
            activeCourse
              ? `
            <div class="card">
              <h2 style="font-size:1.05rem; margin-bottom:10px;">Add Module to ${escapeHtml(activeCourse.title)}</h2>
              <form id="admin-phase-form" class="form-stack">
                <div class="field">
                  <label class="field-label" for="ph-title">Module title</label>
                  <input class="input" id="ph-title" name="title" required placeholder="e.g. Module 9: Performance Optimization" />
                </div>
                <div class="field">
                  <label class="field-label" for="ph-summary">Module summary</label>
                  <input class="input" id="ph-summary" name="summary" required placeholder="Key scope of this module" />
                </div>
                <div class="field">
                  <label class="field-label" for="ph-objectives">Module objectives (one per line)</label>
                  <textarea class="textarea" id="ph-objectives" name="objectives" style="min-height:54px;"></textarea>
                </div>
                <div class="lab-grid-2">
                  <div class="field">
                    <label class="field-label" for="ph-diff">Difficulty</label>
                    <select class="select" id="ph-diff" name="difficulty">
                      ${DIFFICULTY_LEVELS.map((d) => `<option value="${d}">${d}</option>`).join('')}
                    </select>
                  </div>
                  <div class="field">
                    <label class="field-label" for="ph-hrs">Est. hours</label>
                    <input class="input" id="ph-hrs" name="estHours" type="number" min="1" max="40" value="3" />
                  </div>
                </div>
                <button type="submit" class="btn btn-secondary btn-sm">Add module</button>
              </form>
            </div>

            ${
              phases.length > 0
                ? `
              <div class="card">
                <h2 style="font-size:1.05rem; margin-bottom:10px;">Add Practical Activity to Module</h2>
                <form id="admin-activity-form" class="form-stack">
                  <div class="field">
                    <label class="field-label" for="act-phase">Target module</label>
                    <select class="select" id="act-phase" name="phaseId">
                      ${phases.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === selectedPhaseId ? 'selected' : ''}>Module ${p.position}: ${escapeHtml(p.title)}</option>`).join('')}
                    </select>
                  </div>
                  <div class="field">
                    <label class="field-label" for="act-title">Activity title</label>
                    <input class="input" id="act-title" name="title" required placeholder="e.g. Build a semantic landing skeleton" />
                  </div>
                  <div class="field">
                    <label class="field-label" for="act-desc">Description</label>
                    <input class="input" id="act-desc" name="description" required placeholder="Brief practice goal" />
                  </div>
                  <div class="field">
                    <label class="field-label" for="act-instr">Step-by-step instructions</label>
                    <textarea class="textarea" id="act-instr" name="instructions" style="min-height:60px;" required></textarea>
                  </div>
                  <div class="lab-grid-2">
                    <div class="field">
                      <label class="field-label" for="act-output">Expected output</label>
                      <input class="input" id="act-output" name="expectedOutput" required placeholder="Verified deliverable" />
                    </div>
                    <div class="field">
                      <label class="field-label" for="act-mins">Est. minutes</label>
                      <input class="input" id="act-mins" name="estMinutes" type="number" min="5" max="180" value="25" />
                    </div>
                  </div>
                  <button type="submit" class="btn btn-secondary btn-sm">Add practical activity</button>
                </form>
              </div>
            `
                : ''
            }
          `
              : ''
          }
        </aside>
      </div>

      ${
        previewCourseOpen && activeCourse
          ? `
        <div class="modal-backdrop" id="course-preview-backdrop">
          <div class="modal-panel" style="max-width:860px;">
            <div class="modal-header">
              <div>
                <div class="meta-line">
                  <span>In-Admin Preview</span>
                  <span class="meta-sep">·</span>
                  <span>v${Number(activeCourse.version || 1)}</span>
                  <span class="meta-sep">·</span>
                  <span>${escapeHtml(activeCourse.publicationStatus)}</span>
                </div>
                <h2 style="font-size:1.2rem; margin-top:2px;">${escapeHtml(activeCourse.title)}</h2>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" id="close-course-preview">Close preview</button>
            </div>

            <div style="margin-bottom:14px;">
              ${renderCourseThumbnailHtml(activeCourse, { height: '160px' })}
            </div>

            <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:14px;">${escapeHtml(activeCourse.description)}</p>

            ${
              previewLessonsFlat.length > 0
                ? `
              <div class="field" style="margin-bottom:14px;">
                <label class="field-label" for="preview-lesson-select">Inspect lesson content (${previewLessonsFlat.length} lessons)</label>
                <select class="select" id="preview-lesson-select">
                  ${previewLessonsFlat
                    .map(
                      (l) => `<option value="${escapeHtml(l.id)}" ${l.id === previewLesson?.id ? 'selected' : ''}>Module ${l.phasePosition}: ${escapeHtml(l.title)}</option>`
                    )
                    .join('')}
                </select>
              </div>
              ${
                previewLesson && coursePreviewRender
                  ? `
                <div class="card lesson-reader-shell" style="background:var(--color-bg);" id="admin-course-preview-reader">
                  ${coursePreviewRender.html}
                </div>
              `
                  : ''
              }
            `
                : '<p style="font-size:13.5px; color:var(--color-text-muted);">No lessons authored in this course yet.</p>'
            }
          </div>
        </div>
      `
          : ''
      }
    `
        : activeTab === 'lessons'
          ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="lab-grid-3">
          <div class="field">
            <label class="field-label" for="builder-course-select">Target Course</label>
            <select class="select" id="builder-course-select">
              ${courses
                .map(
                  (c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedCourseId ? 'selected' : ''}>${escapeHtml(c.skill?.title || '')} — ${escapeHtml(c.title)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="builder-phase-select">Target Module / Phase</label>
            <select class="select" id="builder-phase-select">
              ${phases
                .map(
                  (p) => `<option value="${escapeHtml(p.id)}" ${p.id === selectedPhaseId ? 'selected' : ''}>Module ${p.position}: ${escapeHtml(p.title)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="builder-lesson-select">Load Existing Lesson or Create New</label>
            <select class="select" id="builder-lesson-select">
              <option value="" ${!editingLessonId ? 'selected' : ''}>+ Create new lesson (Draft)</option>
              ${phaseLessons
                .map(
                  (l, i) => `<option value="${escapeHtml(l.id)}" ${l.id === editingLessonId ? 'selected' : ''}>${i + 1}. ${escapeHtml(l.title)} (${escapeHtml(l.publicationStatus || 'published')})</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="${lessonPreviewOpen ? 'lab-split' : ''}">
        <section class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
            <div>
              <h2 class="section-heading" style="margin:0;">${editingLessonId ? `Editing Lesson: ${escapeHtml(lessonDraft.title || 'Untitled')}` : 'Create New Lesson (Draft)'}</h2>
              <p style="font-size:12.5px; color:var(--color-text-muted); margin:2px 0 0;">Write cohesive, textbook-grade instructional material using the unified 5-section structure.</p>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" id="toggle-lesson-preview-btn">${lessonPreviewOpen ? 'Hide Learner Preview' : 'Show Learner Preview'}</button>
              ${editingLessonId ? `<button type="button" class="btn btn-ghost btn-sm" id="reset-lesson-builder-btn">+ New Draft Lesson</button>` : ''}
            </div>
          </div>

          <form id="admin-lesson-form" class="form-stack">
            <!-- 1 & 8: Title, Metadata & Publication Status -->
            <div class="lab-grid-3">
              <div class="field">
                <label class="field-label" for="les-title">1. Lesson title</label>
                <input class="input" id="les-title" name="title" data-les-field="title" required value="${escapeHtml(lessonDraft.title)}" placeholder="e.g. Audience Exclusions &amp; Retargeting" />
              </div>
              <div class="field">
                <label class="field-label" for="les-mins">Est. minutes</label>
                <input class="input" id="les-mins" name="estMinutes" data-les-field="estMinutes" type="number" min="5" max="180" value="${Number(lessonDraft.estMinutes || 25)}" />
              </div>
              <div class="field">
                <label class="field-label" for="les-pub">8. Publication status</label>
                <select class="select" id="les-pub" name="publicationStatus" data-les-field="publicationStatus">
                  <option value="draft" ${lessonDraft.publicationStatus === 'draft' ? 'selected' : ''}>Draft (Admin only)</option>
                  <option value="published" ${lessonDraft.publicationStatus === 'published' ? 'selected' : ''}>Published (Visible to learners)</option>
                </select>
              </div>
            </div>

            <label style="display:inline-flex; align-items:center; gap:8px; font-size:13px; color:var(--color-navy); cursor:pointer;">
              <input type="checkbox" id="les-required" name="isRequired" ${lessonDraft.isRequired ? 'checked' : ''} />
              <span>Required lesson for module completion</span>
            </label>

            <!-- 2: Short Introduction -->
            <div class="field">
              <label class="field-label" for="les-intro">2. Short introduction</label>
              <textarea class="textarea" id="les-intro" name="introduction" data-les-field="introduction" style="min-height:72px;" required placeholder="Briefly introduce the topic, explain why it matters in practice, and preview how the lesson connects ideas…">${escapeHtml(lessonDraft.introduction)}</textarea>
            </div>

            <!-- 3: Learning Objectives -->
            <div class="field">
              <label class="field-label" for="les-obj">3. Learning objectives (one per line, 3–4 recommended)</label>
              <textarea class="textarea" id="les-obj" name="objectives" data-les-field="objectives" style="min-height:86px;" placeholder="Explain the core principle in context&#10;Compare design or implementation trade-offs&#10;Apply the workflow independently without common errors">${escapeHtml(lessonDraft.objectives)}</textarea>
            </div>

            <!-- 4: Main Lesson Content (Rich-Text Editor) -->
            <div class="field">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px;">
                <label class="field-label" for="les-richtext-editor" style="margin:0;">4. Main lesson content</label>
                <span class="mono-num" id="rte-word-count" style="font-size:12px; color:var(--color-text-muted);">${editorWordCount} words (target ~800–1,200 words)</span>
              </div>

              <div class="rte-shell">
                <div class="rte-toolbar" role="toolbar" aria-label="Main lesson formatting">
                  <button type="button" class="rte-btn" data-rte-cmd="formatBlock" data-rte-val="P" title="Normal paragraph">P</button>
                  <button type="button" class="rte-btn" data-rte-cmd="formatBlock" data-rte-val="H2" title="Section heading">H2</button>
                  <button type="button" class="rte-btn" data-rte-cmd="formatBlock" data-rte-val="H3" title="Subheading">H3</button>
                  <span class="rte-sep" aria-hidden="true"></span>
                  <button type="button" class="rte-btn" data-rte-cmd="bold" title="Bold"><strong>B</strong></button>
                  <button type="button" class="rte-btn" data-rte-cmd="italic" title="Italic"><em>I</em></button>
                  <span class="rte-sep" aria-hidden="true"></span>
                  <button type="button" class="rte-btn" data-rte-cmd="insertUnorderedList" title="Bulleted list">• List</button>
                  <button type="button" class="rte-btn" data-rte-cmd="insertOrderedList" title="Numbered list">1. List</button>
                  <span class="rte-sep" aria-hidden="true"></span>
                  <button type="button" class="rte-btn" id="rte-toggle-link-btn" title="Insert link">Link</button>
                  <button type="button" class="rte-btn" id="rte-insert-table-btn" title="Insert comparison table">Table</button>
                  <button type="button" class="rte-btn" id="rte-table-add-row-btn" title="Add row to active table">+ Row</button>
                  <button type="button" class="rte-btn" id="rte-table-add-col-btn" title="Add column to active table">+ Col</button>
                  <button type="button" class="rte-btn" id="rte-insert-code-btn" title="Insert code block">Code</button>
                </div>

                ${
                  linkPopoverOpen
                    ? `<div class="rte-link-popover" id="rte-link-popover">
                        <input class="input" id="rte-link-text" placeholder="Link label (optional if text is selected)" />
                        <input class="input" id="rte-link-url" placeholder="https://developer.mozilla.org/..." />
                        <button type="button" class="btn btn-primary btn-sm" id="rte-apply-link-btn">Insert</button>
                        <button type="button" class="btn btn-ghost btn-sm" id="rte-cancel-link-btn">Cancel</button>
                      </div>`
                    : ''
                }

                <div
                  class="rte-surface lesson-article-prose"
                  id="les-richtext-editor"
                  contenteditable="true"
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Main lesson rich-text content"
                >${lessonDraft.mainHtml || '<p><br></p>'}</div>
              </div>
              ${
                preservedImageBlocks.length > 0
                  ? `<p style="font-size:12px; color:var(--color-text-muted); margin:6px 0 0;">${preservedImageBlocks.length} existing lesson diagram(s) preserved automatically on save.</p>`
                  : ''
              }
            </div>

            <!-- 5: Practical Application -->
            <div style="border-top:1px solid var(--color-border); padding-top:14px;">
              <strong style="color:var(--color-navy); display:block; margin-bottom:8px;">5. Practical application</strong>
              <div class="field" style="margin-bottom:8px;">
                <label class="field-label" for="les-prac-title">Activity heading (optional)</label>
                <input class="input" id="les-prac-title" data-les-field="practicalTitle" value="${escapeHtml(lessonDraft.practicalTitle)}" placeholder="Practical Application" />
              </div>
              <div class="field" style="margin-bottom:8px;">
                <label class="field-label" for="les-prac-instr">What the learner needs to do</label>
                <textarea class="textarea" id="les-prac-instr" data-les-field="practicalInstructions" style="min-height:90px;" placeholder="Describe the concrete practical task, scenario, or worked exercise the learner should complete independently…">${escapeHtml(lessonDraft.practicalInstructions)}</textarea>
              </div>
              <div class="field">
                <label class="field-label" for="les-prac-outcome">What a satisfactory result demonstrates</label>
                <textarea class="textarea" id="les-prac-outcome" data-les-field="practicalExpectedOutcome" style="min-height:60px;" placeholder="Explain the criteria, evidence, or reasoning that characterizes a strong result…">${escapeHtml(lessonDraft.practicalExpectedOutcome)}</textarea>
              </div>
            </div>

            <!-- 6: Summary & Key Takeaways -->
            <div style="border-top:1px solid var(--color-border); padding-top:14px;">
              <strong style="color:var(--color-navy); display:block; margin-bottom:8px;">6. Summary</strong>
              <div class="field" style="margin-bottom:8px;">
                <label class="field-label" for="les-summary">Concise summary</label>
                <textarea class="textarea" id="les-summary" name="summary" data-les-field="summary" style="min-height:70px;" placeholder="Synthesize the core ideas of the lesson concisely…">${escapeHtml(lessonDraft.summary)}</textarea>
              </div>
              <div class="field">
                <label class="field-label" for="les-takeaways">Key takeaways (optional, one per line)</label>
                <textarea class="textarea" id="les-takeaways" name="takeaways" data-les-field="takeaways" style="min-height:58px;" placeholder="Key point 1&#10;Key point 2">${escapeHtml(lessonDraft.takeaways)}</textarea>
              </div>
            </div>

            <!-- 7: Dedicated Assessment Questions Editor -->
            <div style="border-top:1px solid var(--color-border); padding-top:14px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                <div>
                  <strong style="color:var(--color-navy);">7. Assessment questions (${draftQuestions.length})</strong>
                  <div style="font-size:12px; color:var(--color-text-muted);">Recommended: 3–5 meaningful questions. Explanations display only after learner submission.</div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" id="add-question-btn">+ Add question</button>
              </div>
              <div style="display:flex; flex-direction:column; gap:12px;">
                ${draftQuestions.map((q, qIdx) => renderAssessmentQuestionEditor(q, qIdx, draftQuestions.length)).join('')}
              </div>
            </div>

            <!-- Supplementary Resources (Collapsible, non-cluttering) -->
            <details style="border-top:1px solid var(--color-border); padding-top:12px;">
              <summary style="cursor:pointer; font-weight:600; color:var(--color-navy); font-size:13.5px;">
                Optional supplementary videos &amp; further reading (${draftVideos.length + draftResources.length})
              </summary>
              <div style="display:flex; flex-direction:column; gap:14px; margin-top:12px;">
                <div>
                  <strong style="color:var(--color-navy); display:block; font-size:13px; margin-bottom:6px;">Optional YouTube Videos (${draftVideos.length})</strong>
                  ${
                    draftVideos.length > 0
                      ? `<div class="divider-list" style="margin-bottom:8px;">
                          ${draftVideos
                            .map(
                              (v, i) => `
                            <div class="divider-row">
                              <span style="font-size:13px;"><strong>${escapeHtml(v.title)}</strong> (${escapeHtml(v.videoId)} · ${escapeHtml(v.duration || 'Video')})</span>
                              <button type="button" class="btn btn-danger btn-sm" data-del-video="${i}">Remove</button>
                            </div>
                          `
                            )
                            .join('')}
                        </div>`
                      : ''
                  }
                  <div class="card-workspace" style="padding:12px;">
                    <div class="lab-grid-2" style="margin-bottom:8px;">
                      <input class="input" id="vid-url" placeholder="YouTube URL (youtube.com/watch?v=... or youtu.be/...)" />
                      <input class="input" id="vid-title" placeholder="Video title" />
                    </div>
                    <div class="lab-grid-2" style="margin-bottom:8px;">
                      <input class="input" id="vid-duration" placeholder="Duration (e.g. 09:40)" />
                      <input class="input" id="vid-guide" placeholder="Viewing instructions for learners" />
                    </div>
                    <textarea class="textarea" id="vid-transcript" style="min-height:50px; margin-bottom:8px;" placeholder="Transcript or key study notes…"></textarea>
                    <button type="button" class="btn btn-secondary btn-sm" id="add-video-btn">Validate &amp; attach YouTube video</button>
                  </div>
                </div>

                <div>
                  <strong style="color:var(--color-navy); display:block; font-size:13px; margin-bottom:6px;">Optional Further Reading (${draftResources.length})</strong>
                  ${
                    draftResources.length > 0
                      ? `<div class="divider-list" style="margin-bottom:8px;">
                          ${draftResources
                            .map(
                              (r, i) => `
                            <div class="divider-row">
                              <span style="font-size:13px;"><strong>${escapeHtml(r.title)}</strong> (${escapeHtml(r.url)})</span>
                              <button type="button" class="btn btn-danger btn-sm" data-del-res="${i}">Remove</button>
                            </div>
                          `
                            )
                            .join('')}
                        </div>`
                      : ''
                  }
                  <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <input class="input" id="res-title" placeholder="Resource title" style="flex:1; min-width:160px;" />
                    <input class="input" id="res-url" placeholder="https://developer.mozilla.org/..." style="flex:1.4; min-width:200px;" />
                    <button type="button" class="btn btn-secondary btn-sm" id="add-res-btn">+ Add resource</button>
                  </div>
                </div>
              </div>
            </details>

            <!-- Publish Readiness Checklist -->
            <div class="readiness-box">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                <strong style="font-size:13px; color:var(--color-navy);">Publish readiness</strong>
                <span class="status-tag ${editorReadiness.valid ? 'status-green' : 'status-amber'}">
                  ${editorReadiness.valid ? 'Ready to publish' : 'Draft in progress'}
                </span>
              </div>
              <div class="readiness-grid">
                ${editorReadiness.checks
                  .map(
                    (chk) => `
                  <div class="readiness-item ${chk.ok ? 'is-ok' : 'is-missing'}">
                    <span>${chk.ok ? '✓' : '○'}</span>
                    <span>${escapeHtml(chk.label)}</span>
                  </div>
                `
                  )
                  .join('')}
              </div>
              ${
                editorReadiness.warnings.length > 0
                  ? `<p style="font-size:12px; color:var(--color-text-muted); margin:8px 0 0;">${escapeHtml(editorReadiness.warnings[0])}</p>`
                  : ''
              }
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
              <button type="submit" class="btn btn-primary" ${!activePhase ? 'disabled' : ''}>${editingLessonId ? 'Save Lesson Changes' : 'Save New Lesson'}</button>
              <button type="button" class="btn btn-secondary" id="refresh-lesson-preview-btn">Refresh Preview</button>
            </div>
          </form>
        </section>

        ${
          lessonPreviewOpen && editorPreviewRender
            ? `<aside class="card lesson-reader-shell" id="admin-editor-preview-pane">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding-bottom:10px; margin-bottom:14px; border-bottom:1px solid var(--color-border);">
                  <strong style="font-size:13px; color:var(--color-navy);">Learner Reading Preview</strong>
                  <span class="mono-num" style="font-size:12px; color:var(--color-text-muted);">${editorWordCount} main words</span>
                </div>
                ${editorPreviewRender.html}
              </aside>`
            : ''
        }
      </div>
    `
          : activeTab === 'import_export'
            ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="lab-grid-2" style="align-items:end;">
          <div class="field">
            <label class="field-label" for="import-course-select">Target Course for Export, Bulk Import &amp; Recovery</label>
            <select class="select" id="import-course-select">
              ${courses
                .map(
                  (c) =>
                    `<option value="${escapeHtml(c.id)}" ${c.id === selectedCourseId ? 'selected' : ''}>${escapeHtml(c.title)} (${escapeHtml(c.slug)} · v${Number(c.version || 1)} · ${escapeHtml(c.publicationStatus || 'draft')})</option>`
                )
                .join('')}
            </select>
          </div>
          ${
            activeCourse
              ? `<div class="card-workspace" style="padding:10px 12px;">
                  <div class="meta-line" style="margin-bottom:4px;">
                    <span>Course ID: <code class="mono-num">${escapeHtml(activeCourse.id)}</code></span>
                    <span class="meta-sep">·</span>
                    <span>Version <strong class="mono-num">v${Number(activeCourse.version || 1)}</strong></span>
                  </div>
                  <div style="font-size:12.5px; color:var(--color-text-secondary);">
                    ${phases.length} modules · ${totalCourseLessons} lessons · ${recoverableVersions.length} restorable snapshots
                  </div>
                </div>`
              : ''
          }
        </div>
      </div>

      ${
        activeCourse
          ? `
        <div class="card" style="margin-bottom:20px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
            <div>
              <h2 class="section-heading" style="margin:0 0 4px;">Export Course Curriculum (Schema v${CONTENT_PACKAGE_SCHEMA_VERSION})</h2>
              <p style="font-size:13px; color:var(--color-text-secondary); margin:0;">
                Downloads all ${phases.length} modules, ${totalCourseLessons} lessons, structured blocks, video metadata, and further-reading resources cleanly without learner PII or quiz answers.
              </p>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" id="export-course-json-btn">Export JSON Package</button>
              <button type="button" class="btn btn-secondary btn-sm" id="load-export-into-import-btn">Load Export into Inspector</button>
              <button type="button" class="btn btn-ghost btn-sm" id="toggle-export-preview-btn">${exportPreviewOpen ? 'Hide JSON Preview' : 'Preview Export JSON'}</button>
            </div>
          </div>
          ${
            exportPreviewOpen && exportPreviewJson
              ? `<pre style="margin-top:14px; padding:12px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:var(--radius-sm); font-family:var(--font-mono); font-size:12px; max-height:280px; overflow:auto; white-space:pre-wrap; word-break:break-word;">${escapeHtml(exportPreviewJson)}</pre>`
              : ''
          }
        </div>

        <div class="card" style="margin-bottom:20px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
            <div>
              <h2 class="section-heading" style="margin:0 0 4px;">Bulk JSON Lesson Import &amp; Dry-Run Validation</h2>
              <p style="font-size:13px; color:var(--color-text-secondary); margin:0;">
                Step 1 validates every block, URL, and module reference without modifying database records. Step 2 commits atomically after creating an automatic <code class="mono-num">pre_import</code> backup snapshot. New lessons always stage as <strong>Draft</strong>.
              </p>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" id="load-import-template-btn">Load Starter Template</button>
              <button type="button" class="btn btn-ghost btn-sm" id="clear-import-btn" ${!importJsonText && !dryRunPlan && dryRunParseErrors.length === 0 ? 'disabled' : ''}>Clear</button>
            </div>
          </div>

          <div class="form-stack">
            <div class="lab-grid-2" style="align-items:end;">
              <div class="field">
                <label class="field-label" for="import-json-file">Upload JSON Content Package (.json, max 5 MB)</label>
                <input class="input" type="file" id="import-json-file" accept=".json,application/json" />
              </div>
              <div style="font-size:12.5px; color:var(--color-text-muted); padding-bottom:6px;">
                ${importFileName ? `Loaded file: <strong style="color:var(--color-navy);">${escapeHtml(importFileName)}</strong>` : 'Or paste JSON directly into the inspector below.'}
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="import-json-textarea">Package JSON Payload</label>
              <textarea class="textarea" id="import-json-textarea" style="min-height:210px; font-family:var(--font-mono); font-size:12px;" placeholder='Paste a "${CONTENT_PACKAGE_TYPE}" schema v${CONTENT_PACKAGE_SCHEMA_VERSION} JSON package here…'>${escapeHtml(importJsonText)}</textarea>
            </div>

            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary" id="run-dry-run-btn" ${importInFlight ? 'disabled' : ''}>
                1. Validate &amp; Preview Import (Dry Run)
              </button>
              ${
                dryRunPlan && !dryRunMatchesCurrentText
                  ? `<span style="font-size:12.5px; color:var(--color-amber, #b45309);">JSON edited after preview — re-run Dry Run before committing.</span>`
                  : ''
              }
            </div>
          </div>

          ${
            lastCommitResult
              ? `<div style="margin-top:16px; padding:12px 14px; border-radius:var(--radius-sm); border:1px solid var(--color-green-border, #bbf7d0); background:var(--color-green-bg); font-size:13px;">
                  <strong style="color:var(--color-navy); display:block; margin-bottom:4px;">
                    Bulk import committed cleanly${lastCommitResult.idempotentReplay ? ' (idempotent replay)' : ''}.
                  </strong>
                  <div style="color:var(--color-text-secondary);">
                    Import ID <code class="mono-num">${escapeHtml(lastCommitResult.importId)}</code> · Created <strong class="mono-num">${lastCommitResult.createdCount}</strong> draft lesson(s) · Updated <strong class="mono-num">${lastCommitResult.updatedCount}</strong> lesson(s) · Unchanged <strong class="mono-num">${lastCommitResult.unchangedCount}</strong>${lastCommitResult.snapshotVersionNumber ? ` · Backup snapshot <strong class="mono-num">v${lastCommitResult.snapshotVersionNumber}</strong> saved` : ''}.
                  </div>
                </div>`
              : ''
          }

          ${
            dryRunParseErrors.length > 0
              ? `<div style="margin-top:16px; padding:14px; border-radius:var(--radius-sm); border:1px solid var(--color-red-border); background:var(--color-red-bg);">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                    <strong style="color:var(--color-red);">Package Parsing Rejected (${dryRunParseErrors.length} error${dryRunParseErrors.length === 1 ? '' : 's'})</strong>
                    <button type="button" class="btn btn-secondary btn-sm" id="download-error-report-btn">Download Error Report (.json)</button>
                  </div>
                  <ul style="margin:0; padding-left:18px; font-size:13px; color:var(--color-navy);">
                    ${dryRunParseErrors.map((e) => `<li><code class="mono-num">${escapeHtml(e.field)}</code>: ${escapeHtml(e.message)}</li>`).join('')}
                  </ul>
                </div>`
              : ''
          }

          ${
            dryRunPlan
              ? `
            <div style="margin-top:18px; padding-top:16px; border-top:1px solid var(--color-border);">
              <div style="padding:14px; border-radius:var(--radius-sm); border:1px solid ${
                !dryRunPlan.valid
                  ? 'var(--color-red-border)'
                  : dryRunPlan.canCommit
                    ? 'var(--color-green-border, #bbf7d0)'
                    : 'var(--color-amber-border)'
              }; background:${
                !dryRunPlan.valid
                  ? 'var(--color-red-bg)'
                  : dryRunPlan.canCommit
                    ? 'var(--color-green-bg)'
                    : 'var(--color-amber-bg)'
              }; margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
                  <strong style="color:var(--color-navy);">
                    ${
                      !dryRunPlan.valid
                        ? 'Dry-Run Failed: Resolve all rejected items before commit.'
                        : dryRunPlan.canCommit
                          ? 'Dry-Run Passed: Ready for administrator review and commit.'
                          : 'Dry-Run Complete: No new or modified lessons detected.'
                    }
                  </strong>
                  <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <span class="status-tag status-green">New: ${dryRunPlan.counts.new}</span>
                    <span class="status-tag status-blue">Updated: ${dryRunPlan.counts.updated}</span>
                    <span class="status-tag status-neutral">Unchanged: ${dryRunPlan.counts.unchanged}</span>
                    <span class="status-tag status-red">Rejected: ${dryRunPlan.counts.rejected}</span>
                  </div>
                </div>
                ${
                  dryRunPlan.packageErrors.length > 0
                    ? `<ul style="margin:6px 0 0; padding-left:18px; font-size:13px; color:var(--color-red);">
                        ${dryRunPlan.packageErrors.map((e) => `<li><code class="mono-num">${escapeHtml(e.field)}</code>: ${escapeHtml(e.message)}</li>`).join('')}
                      </ul>`
                    : ''
                }
                ${
                  dryRunPlan.warnings.length > 0
                    ? `<ul style="margin:6px 0 0; padding-left:18px; font-size:12.5px; color:var(--color-text-secondary);">
                        ${dryRunPlan.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}
                      </ul>`
                    : ''
                }
                ${
                  !dryRunPlan.valid || dryRunPlan.counts.rejected > 0
                    ? `<div style="margin-top:10px;">
                        <button type="button" class="btn btn-secondary btn-sm" id="download-error-report-btn">Download Validation Error Report (.json)</button>
                      </div>`
                    : ''
                }
              </div>

              <div class="divider-list" style="margin-bottom:16px;">
                ${dryRunPlan.lessons
                  .map(
                    (item) => `
                  <div class="divider-row" style="flex-direction:column; align-items:stretch; gap:6px; padding:10px 0;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                      <div>
                        <strong style="color:var(--color-navy);">${item.index + 1}. ${escapeHtml(item.title)}</strong>
                        <span style="font-size:12.5px; color:var(--color-text-muted); margin-left:8px;">
                          Module: ${escapeHtml(item.phaseTitle)} · Pos <span class="mono-num">${item.position ?? 'auto'}</span> · Target status: <strong class="mono-num">${escapeHtml(item.effectiveStatus)}</strong>
                        </span>
                      </div>
                      ${renderStatusBadge(item.classification)}
                    </div>
                    ${
                      item.warnings.length > 0
                        ? `<div style="font-size:12.5px; color:var(--color-text-secondary);">
                            ${item.warnings.map((w) => escapeHtml(w)).join(' · ')}
                          </div>`
                        : ''
                    }
                    ${
                      item.errors.length > 0
                        ? `<ul style="margin:0; padding-left:18px; font-size:12.5px; color:var(--color-red);">
                            ${item.errors.map((e) => `<li><code class="mono-num">${escapeHtml(e.field)}</code>: ${escapeHtml(e.message)}</li>`).join('')}
                          </ul>`
                        : ''
                    }
                    ${
                      item.changes.length > 0
                        ? `<details style="font-size:12.5px;">
                            <summary style="cursor:pointer; color:var(--color-blue); font-weight:600;">View ${item.changes.length} field change${item.changes.length === 1 ? '' : 's'}</summary>
                            <div style="margin-top:6px; padding:8px 10px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:var(--radius-sm); display:flex; flex-direction:column; gap:6px;">
                              ${item.changes
                                .map(
                                  (ch) => `
                                <div>
                                  <strong class="mono-num" style="color:var(--color-navy);">${escapeHtml(ch.field)}</strong>:
                                  <div style="color:var(--color-text-muted);">Before: ${escapeHtml(formatDiffValue(ch.before))}</div>
                                  <div style="color:var(--color-navy);">After: ${escapeHtml(formatDiffValue(ch.after))}</div>
                                </div>
                              `
                                )
                                .join('')}
                            </div>
                          </details>`
                        : ''
                    }
                  </div>
                `
                  )
                  .join('')}
              </div>

              ${
                dryRunPlan.canCommit
                  ? `<div class="card-workspace" style="padding:14px;">
                      <h3 style="font-size:0.98rem; margin:0 0 10px;">2. Confirm &amp; Commit Atomic Bulk Import</h3>
                      <div class="form-stack">
                        <div class="field">
                          <label class="field-label" for="import-change-notes">Release / Import Notes (stored on backup snapshot &amp; audit log)</label>
                          <input class="input" id="import-change-notes" value="${escapeHtml(importChangeNotes)}" placeholder="e.g. Q4 Module 2 content refresh + 2 new draft lessons" />
                        </div>
                        <label style="display:flex; align-items:flex-start; gap:8px; font-size:13px; color:var(--color-navy); cursor:pointer;">
                          <input type="checkbox" id="confirm-bulk-import-chk" ${confirmBulkImport ? 'checked' : ''} ${!dryRunMatchesCurrentText ? 'disabled' : ''} style="margin-top:3px;" />
                          <span>
                            I have reviewed the dry-run summary (${dryRunPlan.counts.new} new, ${dryRunPlan.counts.updated} updated, ${dryRunPlan.counts.unchanged} unchanged). Existing learner progress stays untouched, new lessons stage as Draft, and an automatic backup snapshot will be saved first.
                          </span>
                        </label>
                        <div>
                          <button type="button" class="btn btn-primary" id="commit-bulk-import-btn" ${!confirmBulkImport || importInFlight || !dryRunMatchesCurrentText ? 'disabled' : ''}>
                            ${importInFlight ? 'Committing Import…' : `Commit Validated Lessons (${dryRunPlan.counts.new + dryRunPlan.counts.updated})`}
                          </button>
                        </div>
                      </div>
                    </div>`
                  : ''
              }
            </div>
          `
              : ''
          }
        </div>

        <div class="lab-grid-2" style="align-items:start;">
          <section class="card">
            <h2 class="section-heading" style="margin:0 0 6px;">Curriculum Snapshot Recovery (${recoverableVersions.length})</h2>
            <p style="font-size:12.5px; color:var(--color-text-muted); margin:0 0 12px;">
              Restoring any snapshot first saves an automatic <code class="mono-num">pre_restore</code> backup and leaves all learner enrollments, lesson progress, and quiz attempts intact.
            </p>
            ${
              recoverableVersions.length > 0
                ? `<div class="divider-list">
                    ${recoverableVersions
                      .map(
                        (v) => `
                      <div class="divider-row" style="flex-direction:column; align-items:stretch; gap:8px; padding:10px 0;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                          <div>
                            <div style="font-weight:700; color:var(--color-navy);">
                              Version v${Number(v.versionNumber || 1)}
                              <span class="status-tag status-neutral" style="margin-left:6px;">${escapeHtml(v.snapshotType || 'manual')}</span>
                            </div>
                            <div style="font-size:12.5px; color:var(--color-text-secondary); margin-top:2px;">
                              ${escapeHtml(v.changeNotes || 'Curriculum snapshot')} · ${v.snapshotData?.phases?.length || 0} modules · ${formatDate(v.createdAt)}
                            </div>
                          </div>
                          ${
                            confirmRestoreVersionId === v.id
                              ? ''
                              : `<button type="button" class="btn btn-secondary btn-sm" data-start-restore="${escapeHtml(v.id)}" ${restoreInFlightId ? 'disabled' : ''}>Restore Version</button>`
                          }
                        </div>
                        ${
                          confirmRestoreVersionId === v.id
                            ? `<div class="card-workspace" style="padding:10px 12px;">
                                <p style="font-size:12.5px; color:var(--color-navy); margin:0 0 8px;">
                                  Confirm restoring <strong>v${Number(v.versionNumber || 1)}</strong>? Current state will be backed up as a <code class="mono-num">pre_restore</code> snapshot before reverting modules and lessons. Learner records will not be altered.
                                </p>
                                <input class="input" id="restore-notes-input" value="${escapeHtml(restoreNotes)}" placeholder="Optional recovery reason…" style="margin-bottom:8px;" />
                                <div style="display:flex; gap:8px;">
                                  <button type="button" class="btn btn-primary btn-sm" data-confirm-restore="${escapeHtml(v.id)}" ${restoreInFlightId ? 'disabled' : ''}>
                                    ${restoreInFlightId === v.id ? 'Restoring…' : 'Confirm Restore'}
                                  </button>
                                  <button type="button" class="btn btn-ghost btn-sm" id="cancel-restore-btn" ${restoreInFlightId ? 'disabled' : ''}>Cancel</button>
                                </div>
                              </div>`
                            : ''
                        }
                      </div>
                    `
                      )
                      .join('')}
                  </div>`
                : `<p style="font-size:13px; color:var(--color-text-muted); margin:0;">No full curriculum snapshots saved for this course yet. Create a manual snapshot or run a bulk import to generate one automatically.</p>`
            }
          </section>

          <section class="card">
            <h2 class="section-heading" style="margin:0 0 6px;">Import &amp; Recovery Audit History (${importHistory.length})</h2>
            <p style="font-size:12.5px; color:var(--color-text-muted); margin:0 0 12px;">
              Immutable administrator record of committed, rejected, failed, and restored curriculum operations.
            </p>
            ${
              importHistory.length > 0
                ? `<div class="divider-list">
                    ${importHistory
                      .map(
                        (rec) => `
                      <div class="divider-row" style="flex-direction:column; align-items:stretch; gap:4px; padding:10px 0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                          <div style="font-size:13px; font-weight:700; color:var(--color-navy);">
                            ${escapeHtml(rec.operationType === 'restore' ? 'Snapshot Recovery' : 'Bulk JSON Import')}
                            <span style="font-weight:400; color:var(--color-text-muted); margin-left:6px;">${formatDate(rec.createdAt)}</span>
                          </div>
                          ${renderStatusBadge(rec.status === 'failed' ? 'import_failed' : rec.status)}
                        </div>
                        <div style="font-size:12.5px; color:var(--color-text-secondary);">
                          Actor: ${escapeHtml(rec.actorEmail || rec.actorId || 'Administrator')} ·
                          New <span class="mono-num">${rec.createdCount}</span> ·
                          Updated <span class="mono-num">${rec.updatedCount}</span> ·
                          Unchanged <span class="mono-num">${rec.unchangedCount}</span> ·
                          Rejected <span class="mono-num">${rec.rejectedCount}</span>
                        </div>
                        ${
                          rec.changeNotes
                            ? `<div style="font-size:12.5px; color:var(--color-navy);">Notes: ${escapeHtml(rec.changeNotes)}</div>`
                            : ''
                        }
                        ${
                          rec.errorSummary
                            ? `<div style="font-size:12.5px; color:var(--color-red);">Error: ${escapeHtml(rec.errorSummary)}</div>`
                            : ''
                        }
                      </div>
                    `
                      )
                      .join('')}
                  </div>`
                : `<p style="font-size:13px; color:var(--color-text-muted); margin:0;">No bulk import or snapshot recovery events recorded for this course yet.</p>`
            }
          </section>
        </div>
      `
          : `<div class="card"><p style="font-size:14px; color:var(--color-text-muted); margin:0;">Create or select a course first to export, bulk import, or restore snapshots.</p></div>`
      }
    `
            : `
      <div class="lab-split">
        <section class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
            <h2 class="section-heading" style="margin:0;">Skills Directory (${filteredCatalogSkills.length})</h2>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <select class="select" id="admin-cat-filter" style="width:auto;">
                <option value="All">All categories (${categories.length})</option>
                ${categories.map((c) => `<option value="${escapeHtml(c.name)}" ${catalogCategoryFilter === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
              </select>
              <select class="select" id="admin-course-status-filter" style="width:auto;">
                <option value="all" ${catalogCourseStatusFilter === 'all' ? 'selected' : ''}>All course states</option>
                <option value="published_courses" ${catalogCourseStatusFilter === 'published_courses' ? 'selected' : ''}>Has published courses</option>
                <option value="draft_courses" ${catalogCourseStatusFilter === 'draft_courses' ? 'selected' : ''}>Courses in development</option>
                <option value="no_courses" ${catalogCourseStatusFilter === 'no_courses' ? 'selected' : ''}>No courses yet</option>
              </select>
            </div>
          </div>
          <div class="divider-list">
            ${filteredCatalogSkills
              .map((s) => {
                const pubCnt = Number(s.courseCount || 0);
                const draftCnt = Number(s.draftCourseCount || 0);
                const courseSummary =
                  pubCnt > 0 && draftCnt > 0
                    ? `${pubCnt} published · ${draftCnt} draft`
                    : pubCnt > 0
                      ? `${pubCnt} published ${pubCnt === 1 ? 'course' : 'courses'}`
                      : draftCnt > 0
                        ? `${draftCnt} in development (draft)`
                        : 'No courses yet';
                return `
                  <div class="divider-row" style="align-items:flex-start; flex-wrap:wrap;">
                    <div style="min-width:200px; flex:1;">
                      <div style="font-weight:700; color:var(--color-navy);">${escapeHtml(s.title)}</div>
                      <div class="meta-line" style="margin-top:2px;">
                        <span>${escapeHtml(s.category)}</span>
                        <span class="meta-sep">·</span>
                        <span>${escapeHtml(s.level)}</span>
                        <span class="meta-sep">·</span>
                        <span class="mono-num">${escapeHtml(courseSummary)}</span>
                      </div>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                      ${renderStatusBadge(s.publicationStatus || 'published')}
                      <button type="button" class="btn btn-secondary btn-sm" data-edit-skill="${escapeHtml(s.id)}">Edit</button>
                      <button type="button" class="btn btn-secondary btn-sm" data-add-course-skill="${escapeHtml(s.id)}">+ Course</button>
                      <button type="button" class="btn btn-ghost btn-sm" data-toggle-skill-pub="${escapeHtml(s.id)}">
                        ${s.publicationStatus === 'draft' ? 'Publish' : 'Set Draft'}
                      </button>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </section>

        <aside style="display:flex; flex-direction:column; gap:18px;">
          <div class="card-workspace">
            <h2 style="font-size:1.05rem; margin-bottom:10px;">Add Dynamic Category</h2>
            <form id="admin-category-form" class="form-stack">
              <div class="field">
                <label class="field-label" for="cat-name">Category name</label>
                <input class="input" id="cat-name" name="name" required placeholder="e.g. Sustainability &amp; Operations" />
              </div>
              <div class="field">
                <label class="field-label" for="cat-desc">Description</label>
                <input class="input" id="cat-desc" name="description" required placeholder="Skills covered in this category" />
              </div>
              <button type="submit" class="btn btn-secondary btn-sm">Add category</button>
            </form>
          </div>

          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">
              <h2 style="font-size:1.05rem;">${editingSkill ? `Edit Skill: ${escapeHtml(editingSkill.title)}` : 'Create Independent Skill'}</h2>
              ${editingSkill ? `<button type="button" class="btn btn-ghost btn-sm" id="cancel-edit-skill">Cancel</button>` : ''}
            </div>
            <p style="font-size:12.5px; color:var(--color-text-muted); margin-bottom:12px;">
              Skills exist independently and can be created or published with zero courses. Courses can be attached anytime.
            </p>
            <form id="admin-skill-form" class="form-stack">
              <div class="field">
                <label class="field-label" for="skill-title">Skill title</label>
                <input class="input" id="skill-title" name="title" required value="${escapeHtml(editingSkill?.title || '')}" placeholder="e.g. Email Lifecycle Strategy" />
              </div>
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="skill-cat">Category</label>
                  <select class="select" id="skill-cat" name="categoryId">
                    ${categories
                      .map(
                        (c) => `<option value="${escapeHtml(c.id)}" ${editingSkill?.categoryId === c.id || editingSkill?.category === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="skill-level">Level</label>
                  <select class="select" id="skill-level" name="level">
                    ${DIFFICULTY_LEVELS.map((d) => `<option value="${d}" ${editingSkill?.level === d ? 'selected' : ''}>${d}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="skill-pub">Publication status</label>
                <select class="select" id="skill-pub" name="publicationStatus">
                  <option value="published" ${(editingSkill?.publicationStatus || 'published') === 'published' ? 'selected' : ''}>Published (visible to learners)</option>
                  <option value="draft" ${editingSkill?.publicationStatus === 'draft' ? 'selected' : ''}>Draft (admin only)</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="skill-summary">Competency description</label>
                <textarea class="textarea" id="skill-summary" name="summary" style="min-height:70px;" required placeholder="What learners master in this skill…">${escapeHtml(editingSkill?.summary || '')}</textarea>
              </div>
              <div class="field">
                <label class="field-label" for="skill-expectations">Competency expectations</label>
                <input class="input" id="skill-expectations" name="competencyExpectations" value="${escapeHtml(editingSkill?.competencyExpectations || '')}" placeholder="Applied portfolio expectations…" />
              </div>
              <div class="field">
                <label class="field-label" for="skill-outcomes">Learning outcomes (one per line)</label>
                <textarea class="textarea" id="skill-outcomes" name="outcomes" style="min-height:76px;" placeholder="Explain core frameworks&#10;Deliver practical projects">${escapeHtml((editingSkill?.outcomes || []).join('\n'))}</textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-sm">${editingSkill ? 'Save skill changes' : 'Create skill'}</button>
            </form>
          </div>
        </aside>
      </div>
    `
    }
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    /** @param {HTMLElement} root */
    bind(root) {
      root.querySelectorAll('[data-admin-tab]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          activeTab = btn.dataset.adminTab || 'courses';
          rerender({ silent: true });
        });
      });

      // Courses tab handlers
      root.querySelector('#admin-course-skill')?.addEventListener('change', (e) => {
        selectedSkillId = /** @type {HTMLSelectElement} */ (e.target).value;
        const nextCourses = courses.filter(
          (c) => c.skillId === selectedSkillId || (selectedSkillId ? (c.associatedSkillIds || []).includes(selectedSkillId) : false)
        );
        selectedCourseId = nextCourses[0]?.id || null;
        selectedPhaseId = nextCourses[0]?.phases?.[0]?.id || null;
        resetImportExportState();
        rerender({ silent: true });
      });

      root.querySelector('#admin-active-course')?.addEventListener('change', (e) => {
        selectedCourseId = /** @type {HTMLSelectElement} */ (e.target).value;
        const nextC = courses.find((c) => c.id === selectedCourseId);
        selectedPhaseId = nextC?.phases?.[0]?.id || null;
        resetImportExportState();
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-course-form-mode]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          courseFormMode = btn.dataset.courseFormMode || 'edit';
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-set-course-status]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          const nextStatus = btn.dataset.setCourseStatus || 'draft';
          try {
            await adminSetCourseStatus(activeCourse.id, nextStatus);
            showToast(`Course status updated to ${nextStatus}.`, 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Cannot change course status.', 'error');
          }
        });
      });

      root.querySelector('#create-course-version-btn')?.addEventListener('click', async () => {
        if (!activeCourse) return;
        const notes = /** @type {HTMLInputElement | null} */ (root.querySelector('#version-notes-input'))?.value || '';
        try {
          const ver = await adminCreateCourseVersion(activeCourse.id, notes);
          showToast(`Version v${ver?.versionNumber || Number(activeCourse.version || 1) + 1} snapshot created.`, 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to create version snapshot.', 'error');
        }
      });

      root.querySelector('#open-course-preview')?.addEventListener('click', () => {
        previewCourseOpen = true;
        rerender({ silent: true });
      });
      root.querySelector('#close-course-preview')?.addEventListener('click', () => {
        previewCourseOpen = false;
        rerender({ silent: true });
      });
      root.querySelector('#course-preview-backdrop')?.addEventListener('click', (e) => {
        if (/** @type {HTMLElement | null} */ (e.target)?.id === 'course-preview-backdrop') {
          previewCourseOpen = false;
          rerender({ silent: true });
        }
      });
      root.querySelector('#preview-lesson-select')?.addEventListener('change', (e) => {
        previewLessonId = /** @type {HTMLSelectElement} */ (e.target).value;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-move-phase]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          const phId = btn.dataset.movePhase || '';
          const dir = Number(btn.dataset.dir);
          const ids = phases.map((p) => p.id);
          const idx = ids.indexOf(phId);
          const target = idx + dir;
          if (idx < 0 || target < 0 || target >= ids.length) return;
          [ids[idx], ids[target]] = [ids[target], ids[idx]];
          try {
            await adminReorderPhases(activeCourse.id, ids);
            showToast('Module order updated.', 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to reorder modules.', 'error');
          }
        });
      });

      root.querySelectorAll('[data-toggle-phase-pub]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          const ph = phases.find((p) => p.id === btn.dataset.togglePhasePub);
          if (!ph) return;
          const nextPub = (ph.publicationStatus || 'published') === 'published' ? 'draft' : 'published';
          try {
            await adminUpsertPhase({
              ...ph,
              courseId: activeCourse.id,
              publicationStatus: nextPub,
            });
            showToast(`Module "${ph.title}" set to ${nextPub}.`, 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to update module status.', 'error');
          }
        });
      });

      root.querySelector('#admin-course-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = /** @type {HTMLFormElement} */ (e.currentTarget);
        const fd = new FormData(form);
        const associatedSkillIds = fd.getAll('associatedSkillIds').map(String).filter(Boolean);
        const primarySkillId = associatedSkillIds[0] || editCourseObj?.skillId || selectedSkillId || '';
        try {
          await adminUpsertCourse({
            id: editCourseObj?.id || undefined,
            skillId: primarySkillId,
            associatedSkillIds,
            slug: String(fd.get('slug') || ''),
            title: String(fd.get('title')),
            description: String(fd.get('description')),
            targetAudience: String(fd.get('targetAudience') || ''),
            authorName: String(fd.get('authorName') || ''),
            thumbnailUrl: String(fd.get('thumbnailUrl') || ''),
            difficulty: String(fd.get('difficulty')),
            publicationStatus: String(fd.get('publicationStatus')),
            estimatedDurationWeeks: Number(fd.get('estimatedDurationWeeks') || 4),
            recommendedWeeklyHours: Number(fd.get('recommendedWeeklyHours') || 4),
            recommendedSchedule: String(fd.get('recommendedSchedule') || ''),
            prerequisites: String(fd.get('prerequisites') || ''),
            outcomes: String(fd.get('outcomes') || ''),
            completionRules: {
              requireAllRequiredLessons: Boolean(fd.get('ruleLessons')),
              requireAllActivities: Boolean(fd.get('ruleActivities')),
              requireAllAssessments: Boolean(fd.get('ruleAssessments')),
              requireChallengeSubmission: true,
              requireChallengeApproval: Boolean(fd.get('ruleChallengeApproval')),
            },
          });
          showToast(editCourseObj ? 'Course updated.' : 'Course created under selected skill.', 'success');
          courseFormMode = 'edit';
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to save course.', 'error');
        }
      });

      root.querySelector('#admin-phase-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeCourse) return;
        const fd = new FormData(/** @type {HTMLFormElement} */ (e.currentTarget));
        try {
          await adminUpsertPhase({
            courseId: activeCourse.id,
            title: String(fd.get('title')),
            summary: String(fd.get('summary')),
            objectives: String(fd.get('objectives') || ''),
            difficulty: String(fd.get('difficulty')),
            estHours: Number(fd.get('estHours') || 3),
          });
          showToast('Module added to course.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to add module.', 'error');
        }
      });

      root.querySelector('#admin-activity-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeCourse) return;
        const fd = new FormData(/** @type {HTMLFormElement} */ (e.currentTarget));
        try {
          await adminUpsertActivity({
            courseId: activeCourse.id,
            phaseId: String(fd.get('phaseId')),
            title: String(fd.get('title')),
            description: String(fd.get('description')),
            instructions: String(fd.get('instructions')),
            expectedOutput: String(fd.get('expectedOutput')),
            estMinutes: Number(fd.get('estMinutes') || 25),
          });
          showToast('Practical activity added to module.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to add practical activity.', 'error');
        }
      });

      if (coursePreviewRender) {
        const previewHost = /** @type {HTMLElement | null} */ (root.querySelector('#admin-course-preview-reader'));
        if (previewHost) {
          bindSimplifiedLessonAssessment(previewHost, coursePreviewRender.assessmentQuestions, 'admin_course_preview');
        }
      }

      if (editorPreviewRender) {
        const editorPreviewHost = /** @type {HTMLElement | null} */ (root.querySelector('#admin-editor-preview-pane'));
        if (editorPreviewHost) {
          bindSimplifiedLessonAssessment(editorPreviewHost, editorPreviewRender.assessmentQuestions, 'admin_editor_preview');
        }
      }

      root.querySelectorAll('[data-move-lesson]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          const phId = btn.dataset.phaseId || '';
          const lesId = btn.dataset.moveLesson || '';
          const dir = Number(btn.dataset.dir);
          const ph = phases.find((p) => p.id === phId);
          if (!ph) return;
          const ids = (ph.lessons || []).map((l) => l.id);
          const idx = ids.indexOf(lesId);
          const target = idx + dir;
          if (idx < 0 || target < 0 || target >= ids.length) return;
          [ids[idx], ids[target]] = [ids[target], ids[idx]];
          try {
            await adminReorderLessons(activeCourse.id, ph.id, ids);
            showToast('Lesson order updated.', 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to reorder lessons.', 'error');
          }
        });
      });

      root.querySelectorAll('[data-new-lesson-phase]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          const phId = btn.dataset.newLessonPhase || '';
          if (phId) selectedPhaseId = phId;
          resetLessonBuilder();
          activeTab = 'lessons';
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-edit-lesson-btn]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          const ph = phases.find((p) => p.id === btn.dataset.phaseId);
          const les = (ph?.lessons || []).find((l) => l.id === btn.dataset.editLessonBtn);
          if (ph && les) {
            selectedPhaseId = ph.id;
            loadLessonIntoBuilder(les);
            activeTab = 'lessons';
            rerender({ silent: true });
          }
        });
      });

      root.querySelectorAll('[data-del-lesson]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          try {
            await adminDeleteLesson(activeCourse.id, btn.dataset.phaseId || '', btn.dataset.delLesson || '');
            showToast('Lesson deleted.', 'info');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to delete lesson.', 'error');
          }
        });
      });

      // Lesson Editor tab handlers
      root.querySelector('#builder-course-select')?.addEventListener('change', (e) => {
        selectedCourseId = /** @type {HTMLSelectElement} */ (e.target).value;
        const nextC = courses.find((c) => c.id === selectedCourseId);
        selectedPhaseId = nextC?.phases?.[0]?.id || null;
        resetLessonBuilder();
        rerender({ silent: true });
      });

      root.querySelector('#builder-phase-select')?.addEventListener('change', (e) => {
        selectedPhaseId = /** @type {HTMLSelectElement} */ (e.target).value;
        resetLessonBuilder();
        rerender({ silent: true });
      });

      root.querySelector('#builder-lesson-select')?.addEventListener('change', (e) => {
        const lid = /** @type {HTMLSelectElement} */ (e.target).value;
        const found = phaseLessons.find((l) => l.id === lid) || null;
        loadLessonIntoBuilder(found);
        rerender({ silent: true });
      });

      root.querySelector('#reset-lesson-builder-btn')?.addEventListener('click', () => {
        resetLessonBuilder();
        rerender({ silent: true });
      });

      root.querySelector('#toggle-lesson-preview-btn')?.addEventListener('click', () => {
        lessonPreviewOpen = !lessonPreviewOpen;
        rerender({ silent: true });
      });

      root.querySelector('#refresh-lesson-preview-btn')?.addEventListener('click', () => {
        lessonPreviewOpen = true;
        rerender({ silent: true });
      });

      root.querySelector('#les-required')?.addEventListener('change', (e) => {
        lessonDraft.isRequired = /** @type {HTMLInputElement} */ (e.target).checked;
      });

      // Sync top-level lesson draft fields live on input
      root.querySelectorAll('[data-les-field]').forEach((node) => {
        const el = /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (node);
        el.addEventListener('input', () => {
          const f = el.dataset.lesField;
          if (!f) return;
          /** @type {Record<string, string | number | boolean>} */ (lessonDraft)[f] =
            f === 'estMinutes' ? Number(el.value || 25) : el.value;
        });
      });

      // Rich-Text Editor wiring & paste sanitization
      const rteSurface = /** @type {HTMLElement | null} */ (root.querySelector('#les-richtext-editor'));
      const wordCountEl = /** @type {HTMLElement | null} */ (root.querySelector('#rte-word-count'));

      const syncRichTextFromDom = () => {
        if (!rteSurface) return;
        const cleanHtml = sanitizeRichTextHtml(rteSurface.innerHTML);
        lessonDraft.mainHtml = cleanHtml;
        if (wordCountEl) {
          const words = countMainLessonWords(
            richTextHtmlToMainBlocks(cleanHtml, { preservedImageBlocks })
          );
          wordCountEl.textContent = `${words} words (target ~800–1,200 words)`;
        }
      };

      /** @type {Range | null} */
      let savedRange = null;
      const captureSelection = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && rteSurface?.contains(sel.anchorNode)) {
          savedRange = sel.getRangeAt(0).cloneRange();
        }
      };
      const restoreSelection = () => {
        rteSurface?.focus();
        if (savedRange) {
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(savedRange);
        }
      };

      rteSurface?.addEventListener('mouseup', captureSelection);
      rteSurface?.addEventListener('keyup', captureSelection);
      rteSurface?.addEventListener('input', syncRichTextFromDom);
      rteSurface?.addEventListener('paste', (e) => {
        e.preventDefault();
        const dt = e.clipboardData;
        const rawHtml = dt?.getData('text/html');
        const rawText = dt?.getData('text/plain') || '';
        const sanitized = rawHtml
          ? sanitizeRichTextHtml(rawHtml)
          : rawText
              .split(/\n{2,}/)
              .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
              .join('');
        if (typeof document.execCommand === 'function') {
          document.execCommand('insertHTML', false, sanitized);
        } else if (rteSurface) {
          rteSurface.innerHTML += sanitized;
        }
        syncRichTextFromDom();
      });

      root.querySelectorAll('[data-rte-cmd]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
          if (!rteSurface) return;
          rteSurface.focus();
          const cmd = btn.dataset.rteCmd || '';
          const val = btn.dataset.rteVal || undefined;
          if (typeof document.execCommand === 'function') {
            document.execCommand(cmd, false, val);
          }
          syncRichTextFromDom();
        });
      });

      root.querySelector('#rte-toggle-link-btn')?.addEventListener('mousedown', (e) => {
        e.preventDefault();
        captureSelection();
      });
      root.querySelector('#rte-toggle-link-btn')?.addEventListener('click', () => {
        linkPopoverOpen = !linkPopoverOpen;
        rerender({ silent: true });
      });
      root.querySelector('#rte-cancel-link-btn')?.addEventListener('click', () => {
        linkPopoverOpen = false;
        rerender({ silent: true });
      });
      root.querySelector('#rte-apply-link-btn')?.addEventListener('click', () => {
        const urlInput = /** @type {HTMLInputElement | null} */ (root.querySelector('#rte-link-url'));
        const textInput = /** @type {HTMLInputElement | null} */ (root.querySelector('#rte-link-text'));
        const urlCheck = isSafeContentUrl(urlInput?.value || '', { allowRelative: false });
        if (!urlCheck.valid || !urlCheck.url) {
          showToast(urlCheck.error || 'Enter a valid https:// or http:// link.', 'error');
          return;
        }
        const label = (textInput?.value || '').trim();
        linkPopoverOpen = false;
        restoreSelection();
        if (rteSurface && typeof document.execCommand === 'function') {
          const selText = window.getSelection()?.toString() || '';
          if (selText && !label) {
            document.execCommand('createLink', false, urlCheck.url);
          } else {
            const safeAnchor = `<a href="${escapeHtml(urlCheck.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || selText || urlCheck.url)}</a>`;
            document.execCommand('insertHTML', false, safeAnchor);
          }
          syncRichTextFromDom();
        }
        rerender({ silent: true });
      });

      root.querySelector('#rte-insert-table-btn')?.addEventListener('mousedown', (e) => e.preventDefault());
      root.querySelector('#rte-insert-table-btn')?.addEventListener('click', () => {
        if (!rteSurface) return;
        rteSurface.focus();
        const tableSnippet = `<table><thead><tr><th>Concept</th><th>When to use</th><th>Common pitfall</th></tr></thead><tbody><tr><td>Example A</td><td>Primary workflow</td><td>Skipping verification</td></tr><tr><td>Example B</td><td>Alternative approach</td><td>Overcomplicating scope</td></tr></tbody></table><p><br></p>`;
        if (typeof document.execCommand === 'function') {
          document.execCommand('insertHTML', false, tableSnippet);
        } else {
          rteSurface.innerHTML += tableSnippet;
        }
        syncRichTextFromDom();
      });

      const findActiveTable = () => {
        const sel = window.getSelection();
        let node = sel?.anchorNode || null;
        while (node && node !== rteSurface) {
          if (node instanceof HTMLElement && node.tagName === 'TABLE') {
            return node;
          }
          node = node.parentNode;
        }
        return /** @type {HTMLTableElement | null} */ (rteSurface?.querySelector('table:last-of-type') || null);
      };

      root.querySelector('#rte-table-add-row-btn')?.addEventListener('mousedown', (e) => e.preventDefault());
      root.querySelector('#rte-table-add-row-btn')?.addEventListener('click', () => {
        const tbl = /** @type {HTMLTableElement | null} */ (findActiveTable());
        if (!tbl) {
          showToast('Insert or click inside a table first.', 'info');
          return;
        }
        const tbody = tbl.tBodies[0] || tbl;
        const colCount = Math.max(1, tbl.rows[0]?.cells.length || 3);
        const tr = document.createElement('tr');
        for (let i = 0; i < colCount; i += 1) {
          const td = document.createElement('td');
          td.textContent = 'Cell';
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        syncRichTextFromDom();
      });

      root.querySelector('#rte-table-add-col-btn')?.addEventListener('mousedown', (e) => e.preventDefault());
      root.querySelector('#rte-table-add-col-btn')?.addEventListener('click', () => {
        const tbl = /** @type {HTMLTableElement | null} */ (findActiveTable());
        if (!tbl) {
          showToast('Insert or click inside a table first.', 'info');
          return;
        }
        Array.from(tbl.rows).forEach((row, rIdx) => {
          const cell = document.createElement(rIdx === 0 && row.parentElement?.tagName === 'THEAD' ? 'th' : 'td');
          cell.textContent = rIdx === 0 ? 'Column' : 'Value';
          row.appendChild(cell);
        });
        syncRichTextFromDom();
      });

      root.querySelector('#rte-insert-code-btn')?.addEventListener('mousedown', (e) => e.preventDefault());
      root.querySelector('#rte-insert-code-btn')?.addEventListener('click', () => {
        if (!rteSurface) return;
        rteSurface.focus();
        const snippet = `<pre><code>// Example snippet\n</code></pre><p><br></p>`;
        if (typeof document.execCommand === 'function') {
          document.execCommand('insertHTML', false, snippet);
        } else {
          rteSurface.innerHTML += snippet;
        }
        syncRichTextFromDom();
      });

      // Dedicated Assessment Questions editor wiring
      root.querySelector('#add-question-btn')?.addEventListener('click', () => {
        draftQuestions.push({
          id: `kc-${Date.now().toString(36)}-${draftQuestions.length + 1}`,
          prompt: '',
          options: ['', '', ''],
          correctIndex: 0,
          explanation: '',
        });
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-q]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          draftQuestions.splice(Number(btn.dataset.delQ), 1);
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-move-q]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.moveQ);
          const target = idx + Number(btn.dataset.dir);
          if (target < 0 || target >= draftQuestions.length) return;
          [draftQuestions[idx], draftQuestions[target]] = [draftQuestions[target], draftQuestions[idx]];
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-q-field]').forEach((node) => {
        const el = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (node);
        el.addEventListener('input', () => {
          const idx = Number(el.dataset.qIdx);
          const f = el.dataset.qField;
          const q = draftQuestions[idx];
          if (!q || !f) return;
          if (f === 'prompt') q.prompt = el.value;
          if (f === 'explanation') q.explanation = el.value;
        });
      });

      root.querySelectorAll('[data-q-opt]').forEach((node) => {
        const el = /** @type {HTMLInputElement} */ (node);
        el.addEventListener('input', () => {
          const qIdx = Number(el.dataset.qOpt);
          const optIdx = Number(el.dataset.optIdx);
          const q = draftQuestions[qIdx];
          if (q && Array.isArray(q.options)) {
            q.options[optIdx] = el.value;
          }
        });
      });

      root.querySelectorAll('[data-q-correct]').forEach((node) => {
        const el = /** @type {HTMLInputElement} */ (node);
        el.addEventListener('change', () => {
          const qIdx = Number(el.dataset.qCorrect);
          const q = draftQuestions[qIdx];
          if (q) {
            q.correctIndex = Number(el.value || 0);
          }
        });
      });

      root.querySelectorAll('[data-add-q-opt]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          const q = draftQuestions[Number(btn.dataset.addQOpt)];
          if (q && q.options.length < 5) {
            q.options.push('');
            rerender({ silent: true });
          }
        });
      });

      root.querySelectorAll('[data-del-q-opt]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          const q = draftQuestions[Number(btn.dataset.delQOpt)];
          const oIdx = Number(btn.dataset.optIdx);
          if (q && q.options.length > 2) {
            q.options.splice(oIdx, 1);
            if (q.correctIndex >= q.options.length) {
              q.correctIndex = Math.max(0, q.options.length - 1);
            }
            rerender({ silent: true });
          }
        });
      });

      root.querySelector('#add-video-btn')?.addEventListener('click', () => {
        const url = /** @type {HTMLInputElement | null} */ (root.querySelector('#vid-url'))?.value.trim() || '';
        const title =
          /** @type {HTMLInputElement | null} */ (root.querySelector('#vid-title'))?.value.trim() || 'Lesson Video';
        const duration =
          /** @type {HTMLInputElement | null} */ (root.querySelector('#vid-duration'))?.value.trim() || '';
        const viewingInstructions =
          /** @type {HTMLInputElement | null} */ (root.querySelector('#vid-guide'))?.value.trim() || '';
        const transcript =
          /** @type {HTMLTextAreaElement | null} */ (root.querySelector('#vid-transcript'))?.value.trim() || '';

        const res = normalizeVideoEntry({
          provider: 'youtube',
          url,
          title,
          duration,
          viewingInstructions,
          transcript,
        });
        if (!res.valid || !res.video) {
          showToast(res.error || 'Invalid YouTube URL.', 'error');
          return;
        }
        draftVideos.push(res.video);
        showToast('YouTube video validated and attached.', 'success');
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-video]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          draftVideos.splice(Number(btn.dataset.delVideo), 1);
          rerender({ silent: true });
        });
      });

      root.querySelector('#add-res-btn')?.addEventListener('click', () => {
        const title = /** @type {HTMLInputElement | null} */ (root.querySelector('#res-title'))?.value.trim();
        const url = /** @type {HTMLInputElement | null} */ (root.querySelector('#res-url'))?.value.trim();
        const urlCheck = isSafeContentUrl(url || '', { allowRelative: false });
        if (!title || !urlCheck.valid || !urlCheck.url) {
          showToast('Enter both a resource title and a valid https:// URL.', 'error');
          return;
        }
        draftResources.push({ title, url: urlCheck.url, resourceType: 'article' });
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-res]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          draftResources.splice(Number(btn.dataset.delRes), 1);
          rerender({ silent: true });
        });
      });

      root.querySelector('#admin-lesson-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeCourse || !activePhase) {
          showToast('Select a valid course and module first.', 'error');
          return;
        }
        syncRichTextFromDom();
        const assembled = buildAssembledDraftLesson();
        if (assembled.publicationStatus === 'published') {
          const check = validateLessonPublishReadiness(assembled);
          if (!check.valid) {
            showToast(check.errors[0] || 'Complete all required lesson sections before publishing.', 'error');
            rerender({ silent: true });
            return;
          }
        }
        try {
          await adminUpsertLesson({
            id: editingLessonId || undefined,
            courseId: activeCourse.id,
            phaseId: activePhase.id,
            ...assembled,
          });
          showToast(
            editingLessonId ? 'Lesson changes saved.' : 'New lesson saved as draft in module.',
            'success'
          );
          resetLessonBuilder();
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to save lesson.', 'error');
        }
      });

      // Catalog tab handlers
      root.querySelector('#admin-cat-filter')?.addEventListener('change', (e) => {
        catalogCategoryFilter = /** @type {HTMLSelectElement} */ (e.target).value;
        rerender({ silent: true });
      });

      root.querySelector('#admin-course-status-filter')?.addEventListener('change', (e) => {
        catalogCourseStatusFilter = /** @type {HTMLSelectElement} */ (e.target).value;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-edit-skill]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          editingSkillId = btn.dataset.editSkill || null;
          rerender({ silent: true });
        });
      });

      root.querySelector('#cancel-edit-skill')?.addEventListener('click', () => {
        editingSkillId = null;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-add-course-skill]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          selectedSkillId = btn.dataset.addCourseSkill || null;
          const nextCourses = courses.filter(
            (c) => c.skillId === selectedSkillId || (selectedSkillId ? (c.associatedSkillIds || []).includes(selectedSkillId) : false)
          );
          selectedCourseId = nextCourses[0]?.id || null;
          selectedPhaseId = nextCourses[0]?.phases?.[0]?.id || null;
          courseFormMode = 'create';
          activeTab = 'courses';
          rerender({ silent: true });
        });
      });

      root.querySelector('#admin-category-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(/** @type {HTMLFormElement} */ (e.currentTarget));
        try {
          await adminUpsertCategory({
            name: String(fd.get('name')),
            description: String(fd.get('description')),
          });
          showToast('Category created dynamically!', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to create category.', 'error');
        }
      });

      root.querySelector('#admin-skill-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(/** @type {HTMLFormElement} */ (e.currentTarget));
        try {
          await adminUpsertSkill({
            id: editingSkillId || undefined,
            slug: editingSkill?.slug || undefined,
            title: String(fd.get('title')),
            categoryId: String(fd.get('categoryId')),
            level: String(fd.get('level')),
            summary: String(fd.get('summary')),
            competencyExpectations: String(fd.get('competencyExpectations') || ''),
            outcomes: String(fd.get('outcomes') || ''),
            publicationStatus: String(fd.get('publicationStatus') || 'published'),
          });
          showToast(editingSkillId ? 'Skill details updated.' : 'Independent skill created.', 'success');
          editingSkillId = null;
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to save skill.', 'error');
        }
      });

      root.querySelectorAll('[data-toggle-skill-pub]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          const skill = skills.find((s) => s.id === btn.dataset.toggleSkillPub);
          if (!skill) return;
          try {
            await adminUpsertSkill({
              ...skill,
              publicationStatus: skill.publicationStatus === 'draft' ? 'published' : 'draft',
            });
            showToast(`Updated ${skill.title} status.`, 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to update skill status.', 'error');
          }
        });
      });

      // Import / Export & Recovery tab handlers
      root.querySelector('#import-course-select')?.addEventListener('change', (e) => {
        selectedCourseId = /** @type {HTMLSelectElement} */ (e.target).value;
        const nextC = courses.find((c) => c.id === selectedCourseId);
        selectedPhaseId = nextC?.phases?.[0]?.id || null;
        resetImportExportState();
        rerender({ silent: true });
      });

      root.querySelector('#export-course-json-btn')?.addEventListener('click', async () => {
        if (!activeCourse) return;
        try {
          const exported = await adminExportCourseContent(activeCourse.id);
          downloadJsonFile(exported.filename, exported.jsonString);
          showToast(`Exported ${exported.filename}.`, 'success');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to export course JSON.', 'error');
        }
      });

      root.querySelector('#load-export-into-import-btn')?.addEventListener('click', async () => {
        if (!activeCourse) return;
        try {
          const exported = await adminExportCourseContent(activeCourse.id);
          importJsonText = exported.jsonString;
          importFileName = exported.filename;
          dryRunPlan = null;
          dryRunParseErrors = [];
          confirmBulkImport = false;
          lastCommitResult = null;
          showToast('Loaded exported curriculum into JSON inspector.', 'info');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to load course export.', 'error');
        }
      });

      root.querySelector('#toggle-export-preview-btn')?.addEventListener('click', async () => {
        if (!activeCourse) return;
        if (exportPreviewOpen) {
          exportPreviewOpen = false;
          rerender({ silent: true });
          return;
        }
        try {
          const exported = await adminExportCourseContent(activeCourse.id);
          exportPreviewJson = exported.jsonString;
          exportPreviewOpen = true;
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to generate JSON preview.', 'error');
        }
      });

      root.querySelector('#load-import-template-btn')?.addEventListener('click', () => {
        if (!activeCourse) return;
        importJsonText = buildStarterPackageTemplate(activeCourse);
        importFileName = 'starter-template.json';
        dryRunPlan = null;
        dryRunParseErrors = [];
        confirmBulkImport = false;
        lastCommitResult = null;
        rerender({ silent: true });
      });

      root.querySelector('#clear-import-btn')?.addEventListener('click', () => {
        resetImportExportState();
        rerender({ silent: true });
      });

      root.querySelector('#import-json-file')?.addEventListener('change', async (e) => {
        const input = /** @type {HTMLInputElement} */ (e.target);
        const file = input.files?.[0];
        if (!file) return;
        try {
          importJsonText = await file.text();
          importFileName = file.name;
          dryRunPlan = null;
          dryRunParseErrors = [];
          confirmBulkImport = false;
          lastCommitResult = null;
          rerender({ silent: true });
        } catch {
          showToast('Unable to read uploaded JSON file.', 'error');
        }
      });

      root.querySelector('#import-json-textarea')?.addEventListener('input', (e) => {
        importJsonText = /** @type {HTMLTextAreaElement} */ (e.target).value;
        confirmBulkImport = false;
        const commitBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#commit-bulk-import-btn'));
        const confirmChk = /** @type {HTMLInputElement | null} */ (root.querySelector('#confirm-bulk-import-chk'));
        if (confirmChk) {
          confirmChk.checked = false;
          confirmChk.disabled = importJsonText !== lastPreviewedJsonText;
        }
        if (commitBtn) {
          commitBtn.disabled = true;
        }
      });

      root.querySelector('#import-change-notes')?.addEventListener('input', (e) => {
        importChangeNotes = /** @type {HTMLInputElement} */ (e.target).value;
      });

      root.querySelector('#confirm-bulk-import-chk')?.addEventListener('change', (e) => {
        confirmBulkImport = /** @type {HTMLInputElement} */ (e.target).checked;
        const commitBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#commit-bulk-import-btn'));
        if (commitBtn) {
          commitBtn.disabled = !confirmBulkImport || importInFlight || importJsonText !== lastPreviewedJsonText;
        }
      });

      root.querySelector('#run-dry-run-btn')?.addEventListener('click', async () => {
        if (!activeCourse || importInFlight) return;
        try {
          const res = await adminPreviewCourseContentImport({
            courseId: activeCourse.id,
            rawJsonText: importJsonText,
            logRejection: true,
          });
          lastPreviewedJsonText = importJsonText;
          confirmBulkImport = false;
          lastCommitResult = null;
          if (!res.parsed) {
            dryRunPlan = null;
            dryRunParseErrors = res.parseErrors;
            showToast('Package parsing failed validation.', 'error');
          } else {
            dryRunParseErrors = [];
            dryRunPlan = res.plan;
            if (res.plan && !res.plan.valid) {
              showToast('Dry run rejected one or more items. Review error details.', 'error');
            } else if (res.plan?.canCommit) {
              showToast('Dry run passed! Review changes and confirm to commit.', 'success');
            } else {
              showToast('Dry run complete: no changes to import.', 'info');
            }
          }
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to validate import package.', 'error');
        }
      });

      root.querySelector('#download-error-report-btn')?.addEventListener('click', () => {
        if (!activeCourse) return;
        const report = dryRunPlan
          ? buildImportErrorReport(dryRunPlan)
          : {
              generatedAt: new Date().toISOString(),
              schemaVersion: CONTENT_PACKAGE_SCHEMA_VERSION,
              courseId: activeCourse.id,
              courseTitle: activeCourse.title,
              packageErrors: dryRunParseErrors,
              rejectedLessons: [],
            };
        downloadJsonFile(
          `import-error-report-${activeCourse.slug || activeCourse.id}.json`,
          JSON.stringify(report, null, 2)
        );
      });

      root.querySelector('#commit-bulk-import-btn')?.addEventListener('click', async () => {
        if (!activeCourse || importInFlight || !dryRunPlan?.canCommit || !confirmBulkImport) return;
        if (importJsonText !== lastPreviewedJsonText) {
          showToast('JSON was edited after dry-run preview. Re-run Dry Run first.', 'error');
          return;
        }
        importInFlight = true;
        rerender({ silent: true });
        try {
          const result = await adminCommitCourseContentImport({
            courseId: activeCourse.id,
            rawJsonText: importJsonText,
            changeNotes: importChangeNotes,
          });
          lastCommitResult = result;
          dryRunPlan = null;
          dryRunParseErrors = [];
          confirmBulkImport = false;
          importChangeNotes = '';
          lastPreviewedJsonText = '';
          showToast(
            `Imported ${result.createdCount} new and ${result.updatedCount} updated lesson(s).`,
            'success'
          );
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Bulk import failed.', 'error');
        } finally {
          importInFlight = false;
          rerender({ silent: true });
        }
      });

      root.querySelectorAll('[data-start-restore]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          confirmRestoreVersionId = btn.dataset.startRestore || null;
          restoreNotes = '';
          rerender({ silent: true });
        });
      });

      root.querySelector('#restore-notes-input')?.addEventListener('input', (e) => {
        restoreNotes = /** @type {HTMLInputElement} */ (e.target).value;
      });

      root.querySelector('#cancel-restore-btn')?.addEventListener('click', () => {
        confirmRestoreVersionId = null;
        restoreNotes = '';
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-confirm-restore]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse || restoreInFlightId) return;
          const versionId = btn.dataset.confirmRestore || '';
          if (!versionId) return;
          restoreInFlightId = versionId;
          rerender({ silent: true });
          try {
            const res = await adminRestoreCourseSnapshot({
              courseId: activeCourse.id,
              versionId,
              restoreNotes,
            });
            confirmRestoreVersionId = null;
            restoreNotes = '';
            dryRunPlan = null;
            dryRunParseErrors = [];
            confirmBulkImport = false;
            showToast(
              `Restored snapshot v${res.restoredVersionNumber}. Backup v${res.safetySnapshotVersionNumber} created.`,
              'success'
            );
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Snapshot recovery failed.', 'error');
          } finally {
            restoreInFlightId = null;
            rerender({ silent: true });
          }
        });
      });
    },
  };
}
