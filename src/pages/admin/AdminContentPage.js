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
  adminDeletePhase,
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
import {
  listAssessmentsForCourse,
  adminUpsertAssessment,
  adminDeleteAssessment,
  adminGetQuizQuestions,
  adminUpsertQuestion,
  adminDeleteQuestion,
} from '../../lib/repositories/quizRepository.js';
import { DIFFICULTY_LEVELS, QUESTION_TYPES } from '../../lib/constants.js';
import {
  CONTENT_PACKAGE_SCHEMA_VERSION,
  CONTENT_PACKAGE_TYPE,
  buildImportErrorReport,
} from '../../lib/contentPackage.js';
import { lessonToEditorFields, richTextToLessonBlocks } from '../../lib/richTextLesson.js';
import { renderCourseThumbnailHtml } from '../../lib/courseThumbnails.js';
import { normalizeVideoEntry } from '../../lib/videoProvider.js';
import { escapeHtml, formatDate } from '../../lib/formatters.js';
import { registerSessionCleanup } from '../../lib/sessionLifecycle.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { renderStatusBadge } from '../../components/Common.js';
import { renderLessonReaderHtml, bindLessonReader } from '../../components/LessonReader.js';
import { showToast } from '../../components/Toast.js';

/** @type {'hierarchy' | 'lesson_editor' | 'import_export'} */
let activeTab = 'hierarchy';
/** @type {string | null} */
let selectedSkillId = null;
/** @type {string | null} */
let selectedCourseId = null;
/** @type {string | null} */
let selectedPhaseId = null;

// Hierarchy inline editor panels
let skillFormOpen = false;
/** @type {string | null} */
let editingSkillId = null;
let categoryFormOpen = false;
let skillCourseFilter = 'linked'; // 'linked' | 'all'
let skillSearchQuery = '';
let skillAssociationFilter = '';
let catalogCategoryFilter = 'All';

let courseFormMode = 'edit'; // 'edit' | 'create'
let courseFormOpen = false;
/** @type {string | null} */
let editingPhaseId = null;
let phaseFormOpen = false;
/** @type {string | null} */
let confirmDeletePhaseId = null;
/** @type {string | null} */
let confirmDeleteLessonId = null;

// Preview modals
let previewCourseOpen = false;
/** @type {string | null} */
let previewModalLessonId = null;

// 10-Field Lesson Editor state
/** @type {'split' | 'edit' | 'preview'} */
let lessonViewMode = 'split';
/** @type {string | null} */
let editingLessonId = null;
let lessonDraft = {
  title: '',
  introduction: '',
  objectives: '',
  mainContentText:
    '## Core concepts\n\nExplain the foundational principles clearly in connected paragraphs so learners can study independently.\n\n- Core principle one\n- Core principle two',
  practicalTitle: '',
  practicalBody: '',
  practicalOutcome: '',
  summary: '',
  takeaways: '',
  completionCriteria:
    'Read the lecture, work through the practical application, pass the knowledge check, and mark complete.',
  publicationStatus: 'published',
  estMinutes: 25,
  isRequired: true,
  passPercent: 70,
};
/** @type {import('../../types/kord.d.ts').VideoEntry[]} */
let draftVideos = [];
/** @type {import('../../types/kord.d.ts').FurtherReadingItem[]} */
let draftResources = [];

/**
 * @typedef {{
 *   id?: string;
 *   tempId: string;
 *   questionType: string;
 *   marks: number;
 *   difficulty: string;
 *   prompt: string;
 *   contextText?: string;
 *   options: string[];
 *   correctIndex: number;
 *   correctIndices: number[] | null;
 *   acceptedAnswers: string[] | null;
 *   correctOrder: number[] | null;
 *   explanation: string;
 * }} DraftAssessmentQuestion
 */

/** @type {string | null} */
let draftLessonQuizId = null;
/** @type {string[]} */
let originalLessonQuestionIds = [];
/** @type {DraftAssessmentQuestion[]} */
let draftAssessmentQuestions = [];
/** @type {number | null} */
let editingQuestionIndex = null;
let questionComposer = {
  questionType: 'multiple_choice',
  marks: 2,
  difficulty: 'medium',
  prompt: '',
  contextText: '',
  optionsLines: '',
  correctIndex: 0,
  correctIndicesCsv: '',
  acceptedAnswersCsv: '',
  explanation: '',
};

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

function resetQuestionComposer() {
  editingQuestionIndex = null;
  questionComposer = {
    questionType: 'multiple_choice',
    marks: 2,
    difficulty: 'medium',
    prompt: '',
    contextText: '',
    optionsLines: '',
    correctIndex: 0,
    correctIndicesCsv: '',
    acceptedAnswersCsv: '',
    explanation: '',
  };
}

function resetLessonEditor() {
  editingLessonId = null;
  draftLessonQuizId = null;
  originalLessonQuestionIds = [];
  draftAssessmentQuestions = [];
  resetQuestionComposer();
  lessonDraft = {
    title: '',
    introduction: '',
    objectives: '',
    mainContentText:
      '## Core concepts\n\nExplain the foundational principles clearly in connected paragraphs so learners can study independently.\n\n- Core principle one\n- Core principle two',
    practicalTitle: '',
    practicalBody: '',
    practicalOutcome: '',
    summary: '',
    takeaways: '',
    completionCriteria:
      'Read the lecture, work through the practical application, pass the knowledge check, and mark complete.',
    publicationStatus: 'published',
    estMinutes: 25,
    isRequired: true,
    passPercent: 70,
  };
  draftVideos = [];
  draftResources = [];
}

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

registerSessionCleanup(() => {
  activeTab = 'hierarchy';
  selectedSkillId = null;
  selectedCourseId = null;
  selectedPhaseId = null;
  skillFormOpen = false;
  editingSkillId = null;
  categoryFormOpen = false;
  skillCourseFilter = 'linked';
  skillSearchQuery = '';
  skillAssociationFilter = '';
  catalogCategoryFilter = 'All';
  courseFormMode = 'edit';
  courseFormOpen = false;
  editingPhaseId = null;
  phaseFormOpen = false;
  confirmDeletePhaseId = null;
  confirmDeleteLessonId = null;
  previewCourseOpen = false;
  previewModalLessonId = null;
  lessonViewMode = 'split';
  resetLessonEditor();
  resetImportExportState();
});

/**
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

/** @param {unknown} val */
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

/** @param {import('../../types/kord.d.ts').Course} course */
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
              introduction:
                'Introduce the practical scope, tools, and mental model learners will apply in this lesson.',
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
              ],
              summary: 'Recap how structured workflows preserve curriculum quality.',
              takeaways: ['Every imported lesson defaults safely to Draft status.'],
              completionCriteria: 'Read the guide and mark complete.',
            },
          ],
        },
      ],
    },
    null,
    2
  );
}

/**
 * Loads a lesson (plus any linked DB assessment questions or legacy inline checks)
 * into the 10-field Lesson Editor.
 *
 * @param {import('../../types/kord.d.ts').Lesson | null} lesson
 * @param {import('../../types/kord.d.ts').Quiz[]} courseAssessments
 */
async function loadLessonIntoEditor(lesson, courseAssessments = []) {
  if (!lesson) {
    resetLessonEditor();
    return;
  }

  editingLessonId = lesson.id;
  const extracted = lessonToEditorFields(lesson);
  lessonDraft = {
    title: lesson.title || '',
    introduction: lesson.introduction || '',
    objectives: (lesson.objectives || []).join('\n'),
    mainContentText: extracted.mainContentText || '',
    practicalTitle: extracted.practicalTitle || '',
    practicalBody: extracted.practicalBody || '',
    practicalOutcome: extracted.practicalOutcome || '',
    summary: lesson.summary || '',
    takeaways: (lesson.takeaways || []).join('\n'),
    completionCriteria:
      lesson.completionCriteria ||
      'Read the lecture, work through the practical application, pass the knowledge check, and mark complete.',
    publicationStatus: lesson.publicationStatus || 'published',
    estMinutes: Number(lesson.estMinutes || 25),
    isRequired: lesson.isRequired !== false,
    passPercent: 70,
  };
  draftVideos = structuredClone(lesson.videos || []);
  draftResources = structuredClone(lesson.furtherReading || []);
  resetQuestionComposer();

  const linkedQuiz = courseAssessments.find((a) => a.lessonId === lesson.id) || null;
  if (linkedQuiz) {
    draftLessonQuizId = linkedQuiz.id;
    lessonDraft.passPercent = Number(linkedQuiz.passPercent || 70);
    try {
      const qs = await adminGetQuizQuestions(linkedQuiz.id);
      originalLessonQuestionIds = qs.map((q) => q.id);
      draftAssessmentQuestions = qs.map((q, idx) => ({
        id: q.id,
        tempId: q.id || `q-${idx}`,
        questionType: q.questionType || 'multiple_choice',
        marks: Number(q.marks || 1),
        difficulty: q.difficulty || 'medium',
        prompt: q.prompt || '',
        contextText: q.contextText || '',
        options: Array.isArray(q.options) ? q.options.slice() : [],
        correctIndex: Number(q.correctIndex ?? 0),
        correctIndices: Array.isArray(q.correctIndices) ? q.correctIndices.slice() : null,
        acceptedAnswers: Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers.slice() : null,
        correctOrder: Array.isArray(q.correctOrder) ? q.correctOrder.slice() : null,
        explanation: q.explanation || '',
      }));
    } catch {
      originalLessonQuestionIds = [];
      draftAssessmentQuestions = [];
    }
  } else {
    draftLessonQuizId = null;
    originalLessonQuestionIds = [];
    // Pre-populate from legacy inline knowledge_check blocks if present
    draftAssessmentQuestions = (extracted.inlineChecks || []).map((kc, idx) => ({
      tempId: `legacy-kc-${idx}-${Date.now()}`,
      questionType: 'multiple_choice',
      marks: 1,
      difficulty: 'medium',
      prompt: kc.prompt || '',
      contextText: '',
      options: Array.isArray(kc.options) ? kc.options.slice() : [],
      correctIndex: Number(kc.correctIndex || 0),
      correctIndices: null,
      acceptedAnswers: null,
      correctOrder: null,
      explanation: kc.explanation || 'Review the lecture above.',
    }));
  }
}

/**
 * Builds a live preview Lesson & optional preview Quiz directly from current editor state
 * without needing a DB round-trip.
 */
function buildLivePreviewPayload() {
  let parseError = '';
  /** @type {import('../../types/kord.d.ts').LessonBlock[]} */
  let blocks = [];
  try {
    blocks = richTextToLessonBlocks({
      mainContentText: lessonDraft.mainContentText,
      practicalTitle: lessonDraft.practicalTitle,
      practicalBody: lessonDraft.practicalBody,
      practicalOutcome: lessonDraft.practicalOutcome,
    });
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'Invalid rich-text formatting.';
  }

  /** @type {Partial<import('../../types/kord.d.ts').Lesson>} */
  const previewLesson = {
    id: editingLessonId || 'preview-draft',
    title: lessonDraft.title || 'Untitled Lesson',
    introduction: lessonDraft.introduction,
    objectives: lessonDraft.objectives
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    blocks,
    videos: draftVideos,
    summary: lessonDraft.summary,
    takeaways: lessonDraft.takeaways
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    furtherReading: draftResources,
    completionCriteria: lessonDraft.completionCriteria,
    publicationStatus: lessonDraft.publicationStatus,
    estMinutes: Number(lessonDraft.estMinutes || 25),
    isRequired: Boolean(lessonDraft.isRequired),
  };

  /** @type {import('../../types/kord.d.ts').Quiz | null} */
  const previewQuiz =
    draftAssessmentQuestions.length > 0
      ? {
          id: draftLessonQuizId || 'preview-quiz',
          skillId: '',
          quizType: 'knowledge_check',
          title: `${lessonDraft.title || 'Lesson'} — Knowledge Check`,
          passPercent: Number(lessonDraft.passPercent || 70),
          questions: draftAssessmentQuestions.map((q, idx) => ({
            id: q.id || q.tempId,
            position: idx + 1,
            questionType: q.questionType,
            difficulty: q.difficulty,
            marks: q.marks,
            prompt: q.prompt,
            contextText: q.contextText,
            options: q.options,
          })),
        }
      : null;

  return { previewLesson, previewQuiz, parseError };
}

/**
 * Inserts structured rich-text snippets cleanly at the textarea cursor.
 *
 * @param {HTMLTextAreaElement} textarea
 * @param {string} action
 */
function applyRichTextToolbarAction(textarea, action) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const selected = textarea.value.slice(start, end);

  /** @type {string} */
  let snippet;
  let selectOffsetStart = 0;
  let selectOffsetEnd = 0;

  switch (action) {
    case 'h2': {
      const txt = selected || 'Section heading';
      snippet = `\n## ${txt}\n`;
      selectOffsetStart = 4;
      selectOffsetEnd = 4 + txt.length;
      break;
    }
    case 'h3': {
      const txt = selected || 'Subheading';
      snippet = `\n### ${txt}\n`;
      selectOffsetStart = 5;
      selectOffsetEnd = 5 + txt.length;
      break;
    }
    case 'bold': {
      const txt = selected || 'important term';
      snippet = `**${txt}**`;
      selectOffsetStart = 2;
      selectOffsetEnd = 2 + txt.length;
      break;
    }
    case 'italic': {
      const txt = selected || 'emphasis';
      snippet = `*${txt}*`;
      selectOffsetStart = 1;
      selectOffsetEnd = 1 + txt.length;
      break;
    }
    case 'bullets': {
      const txt = selected || 'Key point one\nKey point two';
      snippet =
        '\n' +
        txt
          .split('\n')
          .map((l) => `- ${l.replace(/^[-*]\s+/, '')}`)
          .join('\n') +
        '\n';
      break;
    }
    case 'steps': {
      const txt = selected || 'First step\nSecond step';
      snippet =
        '\n' +
        txt
          .split('\n')
          .map((l, i) => `${i + 1}. ${l.replace(/^\d+[.)]\s+/, '')}`)
          .join('\n') +
        '\n';
      break;
    }
    case 'table':
      snippet = '\n| Concept | Purpose | Example |\n| --- | --- | --- |\n| Item A | Primary use | Sample |\n| Item B | Secondary use | Sample |\n';
      break;
    case 'definition':
      snippet = `\n${selected || 'Key term'} :: Clear, concise explanation of the term.\n`;
      break;
    case 'callout':
      snippet = `\n> Key insight: ${selected || 'Highlight an essential takeaway or common misconception to avoid.'}\n`;
      break;
    case 'code':
      snippet = `\n\`\`\`text\n${selected || '// Example template or code snippet'}\n\`\`\`\n`;
      break;
    case 'image':
      snippet = `\n![Diagram description|Caption under figure](https://images.example.com/diagram.png)\n`;
      break;
    default:
      return;
  }

  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${snippet}${after}`;
  lessonDraft.mainContentText = textarea.value;
  textarea.focus();
  if (selectOffsetEnd > selectOffsetStart) {
    textarea.setSelectionRange(start + selectOffsetStart, start + selectOffsetEnd);
  } else {
    const caret = start + snippet.length;
    textarea.setSelectionRange(caret, caret);
  }
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

  const filteredSkillsList = skills.filter((s) => {
    if (catalogCategoryFilter !== 'All' && s.category !== catalogCategoryFilter) return false;
    if (skillSearchQuery.trim()) {
      const q = skillSearchQuery.trim().toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (!selectedSkillId || !skills.some((s) => s.id === selectedSkillId)) {
    selectedSkillId =
      filteredSkillsList[0]?.id ||
      skills.find((s) => (s.courseCount || 0) > 0)?.id ||
      skills[0]?.id ||
      null;
  }

  const activeSkill = skills.find((s) => s.id === selectedSkillId) || null;
  const skillCourses =
    skillCourseFilter === 'all'
      ? courses
      : courses.filter(
          (c) =>
            c.skillId === selectedSkillId ||
            (selectedSkillId ? (c.associatedSkillIds || []).includes(selectedSkillId) : false)
        );

  if (!selectedCourseId || !courses.some((c) => c.id === selectedCourseId)) {
    selectedCourseId = skillCourses[0]?.id || courses[0]?.id || null;
  } else if (
    skillCourseFilter === 'linked' &&
    skillCourses.length > 0 &&
    !skillCourses.some((c) => c.id === selectedCourseId)
  ) {
    selectedCourseId = skillCourses[0].id;
  }

  const activeCourseSummary = courses.find((c) => c.id === selectedCourseId) || null;
  const activeCourse = activeCourseSummary
    ? (await getCourseById(activeCourseSummary.id, { includeDrafts: true })) || activeCourseSummary
    : null;
  const courseAssessments = activeCourse
    ? await listAssessmentsForCourse(activeCourse.id)
    : [];
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

  const editingSkill = editingSkillId ? skills.find((s) => s.id === editingSkillId) || null : null;
  const editingPhaseObj = editingPhaseId ? phases.find((p) => p.id === editingPhaseId) || null : null;
  const editCourseObj = courseFormMode === 'edit' && activeCourse ? activeCourse : null;
  if (!activeCourse && courseFormMode === 'edit') {
    courseFormMode = 'create';
  }

  const allCourseLessonsFlat = phases.flatMap((p) =>
    (p.lessons || []).map((l) => ({
      ...l,
      phaseId: p.id,
      phaseTitle: p.title,
      phasePosition: p.position,
      totalInPhase: (p.lessons || []).length,
    }))
  );
  const modalPreviewLesson = previewModalLessonId
    ? allCourseLessonsFlat.find((l) => l.id === previewModalLessonId) || null
    : null;

  /** @type {import('../../types/kord.d.ts').Quiz | null} */
  let modalPreviewQuiz = null;
  if (modalPreviewLesson) {
    const linked = courseAssessments.find((a) => a.lessonId === modalPreviewLesson.id);
    if (linked) {
      try {
        const qs = await adminGetQuizQuestions(linked.id);
        modalPreviewQuiz = { ...linked, questions: qs };
      } catch {
        modalPreviewQuiz = null;
      }
    }
  }

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

  // Build filtered skills checklist for Course <-> Skill M2M association
  const linkedSkillSet = new Set(
    editCourseObj?.associatedSkillIds?.length
      ? editCourseObj.associatedSkillIds
      : selectedSkillId
        ? [selectedSkillId]
        : []
  );
  const associationSkillsList = skills.filter((s) => {
    if (linkedSkillSet.has(s.id)) return true;
    if (!skillAssociationFilter.trim()) return true;
    const q = skillAssociationFilter.trim().toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.category || '').toLowerCase().includes(q);
  });

  // Assessment question composer helpers
  const qType = questionComposer.questionType;
  const qIsManual = ['short_answer', 'long_form', 'practical_submission'].includes(qType);
  const qIsFill = qType === 'fill_blank';
  const qIsOrder = qType === 'ordering';
  const qIsMultiSelect = qType === 'multiple_select';
  const qIsTrueFalse = qType === 'true_false';

  const { previewLesson: livePreviewLesson, previewQuiz: livePreviewQuiz, parseError: liveParseError } =
    activeTab === 'lesson_editor'
      ? buildLivePreviewPayload()
      : { previewLesson: null, previewQuiz: null, parseError: '' };

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Curriculum &amp; Content Management</h1>
        <p class="page-subtitle">Structured authoring hierarchy: Skills → Courses → Phases → Lessons, with rich-text editing and live learner preview.</p>
      </div>

      <div class="segmented" role="tablist">
        <button type="button" class="segmented-btn ${activeTab === 'hierarchy' ? 'is-active' : ''}" data-admin-tab="hierarchy">Curriculum Hierarchy</button>
        <button type="button" class="segmented-btn ${activeTab === 'lesson_editor' ? 'is-active' : ''}" data-admin-tab="lesson_editor">Lesson Editor</button>
        <button type="button" class="segmented-btn ${activeTab === 'import_export' ? 'is-active' : ''}" data-admin-tab="import_export">Import / Export</button>
      </div>
    </div>

    ${
      activeTab === 'hierarchy'
        ? `
      <!-- Explicit 4-Level Hierarchy Locator Strip -->
      <div class="card admin-hierarchy-strip">
        <div class="admin-hierarchy-step">
          <span class="admin-step-label">1. Skill</span>
          <strong>${activeSkill ? escapeHtml(activeSkill.title) : 'None selected'}</strong>
        </div>
        <span class="breadcrumb-sep" aria-hidden="true">→</span>
        <div class="admin-hierarchy-step">
          <span class="admin-step-label">2. Course</span>
          <strong>${activeCourse ? escapeHtml(activeCourse.title) : 'None selected'}</strong>
        </div>
        <span class="breadcrumb-sep" aria-hidden="true">→</span>
        <div class="admin-hierarchy-step">
          <span class="admin-step-label">3. Phase</span>
          <strong>${activePhase ? `Phase ${activePhase.position}: ${escapeHtml(activePhase.title)}` : 'None selected'}</strong>
        </div>
        <span class="breadcrumb-sep" aria-hidden="true">→</span>
        <div class="admin-hierarchy-step">
          <span class="admin-step-label">4. Lessons</span>
          <strong>${phaseLessons.length} in active phase</strong>
        </div>
      </div>

      <!-- Level 1 & 2: Skills -> Courses Grid -->
      <div class="admin-hierarchy-grid">
        <!-- 1. SKILLS COLUMN -->
        <section class="card" aria-label="Skills management">
          <div class="admin-panel-head">
            <div>
              <h2 class="section-heading" style="margin:0;">1. Skills (${filteredSkillsList.length})</h2>
              <p class="admin-panel-sub">Create, edit, or select a skill to view its courses.</p>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" id="toggle-category-form-btn">${categoryFormOpen ? 'Close category' : '+ Category'}</button>
              <button type="button" class="btn btn-primary btn-sm" id="new-skill-btn">+ New skill</button>
            </div>
          </div>

          ${
            categoryFormOpen
              ? `<form id="admin-category-form" class="card-workspace form-stack" style="margin-bottom:14px; padding:12px;">
                  <div class="field">
                    <label class="field-label" for="cat-name">Category name</label>
                    <input class="input" id="cat-name" name="name" required placeholder="e.g. Product &amp; Design" />
                  </div>
                  <div class="field">
                    <label class="field-label" for="cat-desc">Description</label>
                    <input class="input" id="cat-desc" name="description" required placeholder="Short category summary" />
                  </div>
                  <button type="submit" class="btn btn-primary btn-sm">Save category</button>
                </form>`
              : ''
          }

          ${
            skillFormOpen || editingSkill
              ? `<form id="admin-skill-form" class="card-workspace form-stack" style="margin-bottom:16px; padding:14px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <strong style="color:var(--color-navy);">${editingSkill ? `Edit Skill: ${escapeHtml(editingSkill.title)}` : 'Create New Skill'}</strong>
                    <button type="button" class="btn btn-ghost btn-sm" id="cancel-skill-form-btn">Cancel</button>
                  </div>
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
                      <option value="published" ${(editingSkill?.publicationStatus || 'published') === 'published' ? 'selected' : ''}>Published</option>
                      <option value="draft" ${editingSkill?.publicationStatus === 'draft' ? 'selected' : ''}>Draft</option>
                    </select>
                  </div>
                  <div class="field">
                    <label class="field-label" for="skill-summary">Summary</label>
                    <textarea class="textarea" id="skill-summary" name="summary" style="min-height:60px;" required>${escapeHtml(editingSkill?.summary || '')}</textarea>
                  </div>
                  <div class="field">
                    <label class="field-label" for="skill-outcomes">Learning outcomes (one per line)</label>
                    <textarea class="textarea" id="skill-outcomes" name="outcomes" style="min-height:56px;">${escapeHtml((editingSkill?.outcomes || []).join('\n'))}</textarea>
                  </div>
                  <button type="submit" class="btn btn-primary btn-sm">${editingSkill ? 'Save skill' : 'Create skill'}</button>
                </form>`
              : ''
          }

          <div class="lab-grid-2" style="margin-bottom:12px;">
            <input class="input" id="admin-skill-search" value="${escapeHtml(skillSearchQuery)}" placeholder="Search skills…" />
            <select class="select" id="admin-cat-filter">
              <option value="All">All categories (${categories.length})</option>
              ${categories.map((c) => `<option value="${escapeHtml(c.name)}" ${catalogCategoryFilter === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>

          <div class="admin-scroll-list">
            ${
              filteredSkillsList.length > 0
                ? filteredSkillsList
                    .map((s) => {
                      const isSelected = s.id === selectedSkillId;
                      return `
                        <div class="admin-list-row ${isSelected ? 'is-selected' : ''}">
                          <button type="button" class="admin-list-select" data-select-skill="${escapeHtml(s.id)}">
                            <span class="admin-list-title">${escapeHtml(s.title)}</span>
                            <span class="meta-line">
                              <span>${escapeHtml(s.category)}</span>
                              <span class="meta-sep">·</span>
                              <span class="mono-num">${Number(s.totalCourseCount ?? s.courseCount ?? 0)} courses</span>
                            </span>
                          </button>
                          <div class="admin-list-actions">
                            ${s.publicationStatus === 'draft' ? renderStatusBadge('draft') : ''}
                            <button type="button" class="btn btn-ghost btn-sm" data-edit-skill="${escapeHtml(s.id)}">Edit</button>
                            <button type="button" class="btn btn-ghost btn-sm" data-toggle-skill-pub="${escapeHtml(s.id)}">${s.publicationStatus === 'draft' ? 'Publish' : 'Draft'}</button>
                          </div>
                        </div>
                      `;
                    })
                    .join('')
                : '<p style="font-size:13.5px; color:var(--color-text-muted); margin:8px 0;">No skills match this filter.</p>'
            }
          </div>
        </section>

        <!-- 2. COURSES COLUMN -->
        <section class="card" aria-label="Courses management">
          <div class="admin-panel-head">
            <div>
              <h2 class="section-heading" style="margin:0;">2. Courses (${skillCourses.length})</h2>
              <p class="admin-panel-sub">${skillCourseFilter === 'all' ? 'Showing all platform courses.' : `Associated with "${escapeHtml(activeSkill?.title || 'selected skill')}".`}</p>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
              <div class="segmented" style="padding:2px;">
                <button type="button" class="segmented-btn ${skillCourseFilter === 'linked' ? 'is-active' : ''}" data-course-scope="linked">For skill</button>
                <button type="button" class="segmented-btn ${skillCourseFilter === 'all' ? 'is-active' : ''}" data-course-scope="all">All (${courses.length})</button>
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="new-course-btn">+ New course</button>
            </div>
          </div>

          <div class="admin-scroll-list" style="margin-bottom:14px;">
            ${
              skillCourses.length > 0
                ? skillCourses
                    .map((c) => {
                      const isSelected = c.id === selectedCourseId;
                      return `
                        <div class="admin-list-row ${isSelected ? 'is-selected' : ''}">
                          <button type="button" class="admin-list-select" data-select-course="${escapeHtml(c.id)}">
                            <span class="admin-list-title">${escapeHtml(c.title)}</span>
                            <span class="meta-line">
                              <span>${escapeHtml(c.difficulty)}</span>
                              <span class="meta-sep">·</span>
                              <span class="mono-num">v${Number(c.version || 1)}</span>
                            </span>
                          </button>
                          <div class="admin-list-actions">
                            ${renderStatusBadge(c.publicationStatus || 'draft')}
                            <button type="button" class="btn btn-ghost btn-sm" data-edit-course="${escapeHtml(c.id)}">Edit</button>
                          </div>
                        </div>
                      `;
                    })
                    .join('')
                : '<p style="font-size:13.5px; color:var(--color-text-muted); margin:8px 0;">No courses linked to this skill yet. Click "+ New course" to create one.</p>'
            }
          </div>

          ${
            activeCourse && !courseFormOpen
              ? `
            <div class="card-workspace" style="padding:14px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                <div>
                  <strong style="color:var(--color-navy); display:block;">${escapeHtml(activeCourse.title)}</strong>
                  <div class="meta-line" style="margin-top:2px;">
                    <span>${phases.length} phases</span>
                    <span class="meta-sep">·</span>
                    <span>${totalCourseLessons} lessons</span>
                    <span class="meta-sep">·</span>
                    <span>By ${escapeHtml(activeCourse.authorName || 'Kord Curriculum Studio')}</span>
                  </div>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button type="button" class="btn btn-secondary btn-sm" id="open-course-preview">Preview course</button>
                  <button type="button" class="btn btn-secondary btn-sm" id="edit-active-course-btn">Edit details &amp; skills</button>
                  ${
                    activeCourse.publicationStatus !== 'published'
                      ? `<button type="button" class="btn btn-primary btn-sm" data-set-course-status="published">Publish</button>`
                      : `<button type="button" class="btn btn-secondary btn-sm" data-set-course-status="draft">Set Draft</button>`
                  }
                </div>
              </div>

              ${
                publishCheck && !publishCheck.valid
                  ? `<div style="padding:10px 12px; border-radius:var(--radius-sm); border:1px solid var(--color-amber-border); background:var(--color-amber-bg); font-size:12.5px; margin-bottom:10px;">
                      <strong style="color:var(--color-navy); display:block; margin-bottom:4px;">Publish readiness items remaining:</strong>
                      <ul style="margin:0; padding-left:18px; color:var(--color-text-secondary);">
                        ${publishCheck.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
                      </ul>
                    </div>`
                  : ''
              }

              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <input class="input" id="version-notes-input" placeholder="Snapshot release notes (v${Number(activeCourse.version || 1) + 1})" style="flex:1; min-width:180px;" />
                <button type="button" class="btn btn-secondary btn-sm" id="create-course-version-btn">Save snapshot</button>
              </div>
            </div>
          `
              : ''
          }

          ${
            courseFormOpen
              ? `
            <form id="admin-course-form" class="card-workspace form-stack" style="padding:14px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <strong style="color:var(--color-navy);">${editCourseObj ? `Edit Course: ${escapeHtml(editCourseObj.title)}` : 'Create New Course'}</strong>
                <button type="button" class="btn btn-ghost btn-sm" id="cancel-course-form-btn">Close</button>
              </div>

              <div class="field">
                <label class="field-label" for="c-title">Course title</label>
                <input class="input" id="c-title" name="title" required value="${escapeHtml(editCourseObj?.title || '')}" placeholder="e.g. Technical Writing Foundations" />
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
                <textarea class="textarea" id="c-desc" name="description" style="min-height:64px;" required>${escapeHtml(editCourseObj?.description || '')}</textarea>
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
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px;">
                  <span class="field-label" style="margin:0;">Associate with skills</span>
                  <input class="input" id="assoc-skill-filter" value="${escapeHtml(skillAssociationFilter)}" placeholder="Filter skills…" style="max-width:190px; min-height:30px; font-size:12.5px; padding:4px 8px;" />
                </div>
                <div class="checkbox-grid">
                  ${associationSkillsList
                    .map((s) => {
                      const checked = linkedSkillSet.has(s.id);
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
                <label class="field-label" for="c-outcomes">Course outcomes (one per line)</label>
                <textarea class="textarea" id="c-outcomes" name="outcomes" style="min-height:56px;">${escapeHtml((editCourseObj?.outcomes || []).join('\n'))}</textarea>
              </div>
              <div class="field">
                <label class="field-label" for="c-prereqs">Prerequisites (one per line)</label>
                <textarea class="textarea" id="c-prereqs" name="prerequisites" style="min-height:48px;">${escapeHtml((editCourseObj?.prerequisites || []).join('\n'))}</textarea>
              </div>
              <input type="hidden" name="targetAudience" value="${escapeHtml(editCourseObj?.targetAudience || '')}" />
              <input type="hidden" name="thumbnailUrl" value="${escapeHtml(editCourseObj?.thumbnailUrl || '')}" />
              <input type="hidden" name="recommendedSchedule" value="${escapeHtml(editCourseObj?.recommendedSchedule || '2 lessons + 1 practical exercise per week')}" />

              <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:12.5px; color:var(--color-navy);">
                <label><input type="checkbox" name="ruleLessons" ${(editCourseObj?.completionRules?.requireAllRequiredLessons ?? true) ? 'checked' : ''} /> Require lessons</label>
                <label><input type="checkbox" name="ruleActivities" ${(editCourseObj?.completionRules?.requireAllActivities ?? true) ? 'checked' : ''} /> Require activities</label>
                <label><input type="checkbox" name="ruleAssessments" ${(editCourseObj?.completionRules?.requireAllAssessments ?? true) ? 'checked' : ''} /> Require assessments</label>
                <label><input type="checkbox" name="ruleChallengeApproval" ${(editCourseObj?.completionRules?.requireChallengeApproval ?? true) ? 'checked' : ''} /> Require capstone approval</label>
              </div>

              <button type="submit" class="btn btn-primary btn-sm">${editCourseObj ? 'Save course changes' : 'Create course'}</button>
            </form>
          `
              : ''
          }
        </section>
      </div>

      <!-- Level 3 & 4: Phases -> Lessons -->
      ${
        activeCourse
          ? `
        <div class="admin-hierarchy-grid" style="margin-top:20px;">
          <!-- 3. PHASES COLUMN -->
          <section class="card" aria-label="Phases management">
            <div class="admin-panel-head">
              <div>
                <h2 class="section-heading" style="margin:0;">3. Phases (${phases.length})</h2>
                <p class="admin-panel-sub">Select, create, edit, reorder, or publish phases in ${escapeHtml(activeCourse.title)}.</p>
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="new-phase-btn">+ New phase</button>
            </div>

            ${
              phaseFormOpen || editingPhaseObj
                ? `<form id="admin-phase-form" class="card-workspace form-stack" style="margin-bottom:14px; padding:14px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                      <strong style="color:var(--color-navy);">${editingPhaseObj ? `Edit Phase ${editingPhaseObj.position}: ${escapeHtml(editingPhaseObj.title)}` : 'Create New Phase'}</strong>
                      <button type="button" class="btn btn-ghost btn-sm" id="cancel-phase-form-btn">Cancel</button>
                    </div>
                    <div class="field">
                      <label class="field-label" for="ph-title">Phase title</label>
                      <input class="input" id="ph-title" name="title" required value="${escapeHtml(editingPhaseObj?.title || '')}" placeholder="e.g. Foundations &amp; Mental Models" />
                    </div>
                    <div class="field">
                      <label class="field-label" for="ph-summary">Phase summary</label>
                      <input class="input" id="ph-summary" name="summary" required value="${escapeHtml(editingPhaseObj?.summary || '')}" placeholder="Scope and goals of this phase" />
                    </div>
                    <div class="field">
                      <label class="field-label" for="ph-objectives">Phase objectives (one per line)</label>
                      <textarea class="textarea" id="ph-objectives" name="objectives" style="min-height:54px;">${escapeHtml((editingPhaseObj?.objectives || []).join('\n'))}</textarea>
                    </div>
                    <div class="lab-grid-3">
                      <div class="field">
                        <label class="field-label" for="ph-diff">Difficulty</label>
                        <select class="select" id="ph-diff" name="difficulty">
                          ${DIFFICULTY_LEVELS.map((d) => `<option value="${d}" ${editingPhaseObj?.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}
                        </select>
                      </div>
                      <div class="field">
                        <label class="field-label" for="ph-hrs">Est. hours</label>
                        <input class="input" id="ph-hrs" name="estHours" type="number" min="1" max="40" value="${Number(editingPhaseObj?.estHours || 3)}" />
                      </div>
                      <div class="field">
                        <label class="field-label" for="ph-pub">Status</label>
                        <select class="select" id="ph-pub" name="publicationStatus">
                          <option value="published" ${(editingPhaseObj?.publicationStatus || 'published') === 'published' ? 'selected' : ''}>Published</option>
                          <option value="draft" ${editingPhaseObj?.publicationStatus === 'draft' ? 'selected' : ''}>Draft</option>
                        </select>
                      </div>
                    </div>
                    <button type="submit" class="btn btn-primary btn-sm">${editingPhaseObj ? 'Save phase changes' : 'Create phase'}</button>
                  </form>`
                : ''
            }

            <div class="admin-scroll-list">
              ${
                phases.length > 0
                  ? phases
                      .map((ph, idx) => {
                        const isSelected = ph.id === selectedPhaseId;
                        const isConfirmDel = confirmDeletePhaseId === ph.id;
                        return `
                          <div class="admin-list-row ${isSelected ? 'is-selected' : ''}" style="flex-direction:column; align-items:stretch; gap:8px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                              <button type="button" class="admin-list-select" data-select-phase="${escapeHtml(ph.id)}">
                                <span class="admin-list-title">Phase ${ph.position}: ${escapeHtml(ph.title)}</span>
                                <span class="meta-line">
                                  <span>${(ph.lessons || []).length} lessons</span>
                                  <span class="meta-sep">·</span>
                                  <span>${Number(ph.estHours || 3)}h</span>
                                  <span class="meta-sep">·</span>
                                  <span>${escapeHtml(ph.publicationStatus || 'published')}</span>
                                </span>
                              </button>
                              <div class="admin-list-actions">
                                ${renderStatusBadge(ph.publicationStatus || 'published')}
                                <button type="button" class="btn btn-ghost btn-sm" data-move-phase="${escapeHtml(ph.id)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>Up</button>
                                <button type="button" class="btn btn-ghost btn-sm" data-move-phase="${escapeHtml(ph.id)}" data-dir="1" ${idx === phases.length - 1 ? 'disabled' : ''}>Down</button>
                                <button type="button" class="btn btn-ghost btn-sm" data-edit-phase="${escapeHtml(ph.id)}">Edit</button>
                                <button type="button" class="btn btn-ghost btn-sm" data-toggle-phase-pub="${escapeHtml(ph.id)}">${(ph.publicationStatus || 'published') === 'published' ? 'Draft' : 'Publish'}</button>
                                ${
                                  isConfirmDel
                                    ? `<button type="button" class="btn btn-danger btn-sm" data-confirm-del-phase="${escapeHtml(ph.id)}">Confirm delete</button>
                                       <button type="button" class="btn btn-ghost btn-sm" id="cancel-del-phase-btn">Cancel</button>`
                                    : `<button type="button" class="btn btn-ghost btn-sm" data-del-phase="${escapeHtml(ph.id)}">Delete</button>`
                                }
                              </div>
                            </div>
                          </div>
                        `;
                      })
                      .join('')
                  : '<p style="font-size:13.5px; color:var(--color-text-muted); margin:8px 0;">No phases yet. Click "+ New phase" to structure this course.</p>'
              }
            </div>
          </section>

          <!-- 4. LESSONS COLUMN -->
          <section class="card" aria-label="Lessons management">
            <div class="admin-panel-head">
              <div>
                <h2 class="section-heading" style="margin:0;">4. Lessons (${phaseLessons.length})</h2>
                <p class="admin-panel-sub">${activePhase ? `Inside Phase ${activePhase.position}: ${escapeHtml(activePhase.title)}` : 'Select a phase to manage its lessons.'}</p>
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="new-lesson-in-phase-btn" ${!activePhase ? 'disabled' : ''}>+ New lesson</button>
            </div>

            ${
              activePhase
                ? `
              <div class="admin-scroll-list">
                ${
                  phaseLessons.length > 0
                    ? phaseLessons
                        .map((l, idx) => {
                          const linkedQuiz = courseAssessments.find((a) => a.lessonId === l.id);
                          const isConfirmDel = confirmDeleteLessonId === l.id;
                          return `
                            <div class="admin-list-row" style="flex-direction:column; align-items:stretch; gap:8px;">
                              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                                <div style="min-width:180px; flex:1;">
                                  <div class="admin-list-title">${idx + 1}. ${escapeHtml(l.title)}</div>
                                  <div class="meta-line">
                                    <span class="mono-num">${Number(l.estMinutes || 25)} min</span>
                                    <span class="meta-sep">·</span>
                                    <span>${l.isRequired === false ? 'Optional' : 'Required'}</span>
                                    ${(l.videos || []).length > 0 ? `<span class="meta-sep">·</span><span>${(l.videos || []).length} video</span>` : ''}
                                    ${linkedQuiz ? `<span class="meta-sep">·</span><span>Has assessment</span>` : ''}
                                  </div>
                                </div>
                                <div class="admin-list-actions">
                                  ${renderStatusBadge(l.publicationStatus || 'published')}
                                  <button type="button" class="btn btn-ghost btn-sm" data-move-lesson="${escapeHtml(l.id)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>Up</button>
                                  <button type="button" class="btn btn-ghost btn-sm" data-move-lesson="${escapeHtml(l.id)}" data-dir="1" ${idx === phaseLessons.length - 1 ? 'disabled' : ''}>Down</button>
                                  <button type="button" class="btn btn-secondary btn-sm" data-preview-lesson="${escapeHtml(l.id)}">Preview</button>
                                  <button type="button" class="btn btn-primary btn-sm" data-edit-lesson-btn="${escapeHtml(l.id)}">Edit</button>
                                  <button type="button" class="btn btn-ghost btn-sm" data-toggle-lesson-pub="${escapeHtml(l.id)}">${(l.publicationStatus || 'published') === 'published' ? 'Draft' : 'Publish'}</button>
                                  ${
                                    isConfirmDel
                                      ? `<button type="button" class="btn btn-danger btn-sm" data-confirm-del-lesson="${escapeHtml(l.id)}">Confirm delete</button>
                                         <button type="button" class="btn btn-ghost btn-sm" id="cancel-del-lesson-btn">Cancel</button>`
                                      : `<button type="button" class="btn btn-ghost btn-sm" data-del-lesson="${escapeHtml(l.id)}">Delete</button>`
                                  }
                                </div>
                              </div>
                            </div>
                          `;
                        })
                        .join('')
                    : '<p style="font-size:13.5px; color:var(--color-text-muted); margin:8px 0;">No lessons in this phase yet. Click "+ New lesson" to write one.</p>'
                }
              </div>

              <details class="lesson-optional-details" style="margin-top:16px;">
                <summary>Phase practical activities (${(activePhase.activities || []).length}) — add or inspect</summary>
                <div style="margin-top:10px; display:flex; flex-direction:column; gap:12px;">
                  ${
                    (activePhase.activities || []).length > 0
                      ? `<div class="divider-list">
                          ${(activePhase.activities || [])
                            .map(
                              (a) => `<div class="divider-row" style="padding:6px 0;">
                                <span style="font-size:13.5px;"><strong>${escapeHtml(a.title)}</strong> · ${escapeHtml(a.description || '')}</span>
                                <span class="mono-num" style="font-size:12px; color:var(--color-text-muted);">${a.estMinutes || 25} min</span>
                              </div>`
                            )
                            .join('')}
                        </div>`
                      : ''
                  }
                  <form id="admin-activity-form" class="form-stack">
                    <input type="hidden" name="phaseId" value="${escapeHtml(activePhase.id)}" />
                    <div class="lab-grid-2">
                      <input class="input" name="title" required placeholder="Activity title" />
                      <input class="input" name="description" required placeholder="Short goal" />
                    </div>
                    <textarea class="textarea" name="instructions" style="min-height:54px;" required placeholder="Practical instructions…"></textarea>
                    <div class="lab-grid-2">
                      <input class="input" name="expectedOutput" required placeholder="Expected deliverable" />
                      <input class="input" name="estMinutes" type="number" min="5" max="180" value="25" />
                    </div>
                    <div>
                      <button type="submit" class="btn btn-secondary btn-sm">Add practical activity</button>
                    </div>
                  </form>
                </div>
              </details>
            `
                : '<p style="font-size:13.5px; color:var(--color-text-muted);">Create or select a phase on the left to manage its lessons.</p>'
            }
          </section>
        </div>
      `
          : ''
      }

      ${
        previewCourseOpen && activeCourse
          ? `
        <div class="modal-backdrop" id="course-preview-backdrop">
          <div class="modal-panel" style="max-width:860px;">
            <div class="modal-header">
              <div>
                <div class="meta-line">
                  <span>Course Preview</span>
                  <span class="meta-sep">·</span>
                  <span>v${Number(activeCourse.version || 1)}</span>
                  <span class="meta-sep">·</span>
                  <span>${escapeHtml(activeCourse.publicationStatus)}</span>
                </div>
                <h2 style="font-size:1.2rem; margin-top:2px;">${escapeHtml(activeCourse.title)}</h2>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" id="close-course-preview">Close</button>
            </div>
            <div style="margin-bottom:14px;">
              ${renderCourseThumbnailHtml(activeCourse, { height: '160px' })}
            </div>
            <p style="font-size:14px; color:var(--color-text-secondary); margin-bottom:14px;">${escapeHtml(activeCourse.description)}</p>
            <div class="divider-list">
              ${phases
                .map(
                  (p) => `<div class="divider-row" style="flex-direction:column; align-items:stretch; gap:4px;">
                    <strong>Phase ${p.position}: ${escapeHtml(p.title)} (${escapeHtml(p.publicationStatus || 'published')})</strong>
                    <div style="font-size:13px; color:var(--color-text-secondary);">${(p.lessons || []).map((l) => escapeHtml(l.title)).join(' · ') || 'No lessons yet'}</div>
                  </div>`
                )
                .join('')}
            </div>
          </div>
        </div>
      `
          : ''
      }

      ${
        modalPreviewLesson
          ? `
        <div class="modal-backdrop" id="lesson-preview-backdrop">
          <div class="modal-panel" style="max-width:880px;">
            <div class="modal-header">
              <div>
                <div class="meta-line">
                  <span>Lesson Preview (exact learner view)</span>
                  <span class="meta-sep">·</span>
                  <span>${escapeHtml(modalPreviewLesson.publicationStatus || 'published')}</span>
                </div>
              </div>
              <div style="display:flex; gap:8px;">
                <button type="button" class="btn btn-primary btn-sm" id="edit-from-modal-preview" data-lesson-id="${escapeHtml(modalPreviewLesson.id)}">Open in Lesson Editor</button>
                <button type="button" class="btn btn-secondary btn-sm" id="close-lesson-preview">Close</button>
              </div>
            </div>
            ${renderLessonReaderHtml({
              lesson: modalPreviewLesson,
              courseTitle: activeCourse?.title || '',
              phasePosition: modalPreviewLesson.phasePosition,
              phaseTitle: modalPreviewLesson.phaseTitle,
              lessonNumber: Math.max(1, phaseLessons.findIndex((x) => x.id === modalPreviewLesson.id) + 1),
              totalLessonsInPhase: modalPreviewLesson.totalInPhase,
              lessonQuiz: modalPreviewQuiz,
              previewMode: true,
            })}
          </div>
        </div>
      `
          : ''
      }
    `
        : activeTab === 'lesson_editor'
          ? `
      <!-- Lesson Context & View Mode Bar -->
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:14px; flex-wrap:wrap;">
          <div class="lab-grid-3" style="flex:1; min-width:300px;">
            <div class="field">
              <label class="field-label" for="builder-course-select">Course</label>
              <select class="select" id="builder-course-select">
                ${courses
                  .map(
                    (c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedCourseId ? 'selected' : ''}>${escapeHtml(c.skill?.title || '')} — ${escapeHtml(c.title)}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="builder-phase-select">Phase</label>
              <select class="select" id="builder-phase-select">
                ${phases
                  .map(
                    (p) => `<option value="${escapeHtml(p.id)}" ${p.id === selectedPhaseId ? 'selected' : ''}>Phase ${p.position}: ${escapeHtml(p.title)}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="builder-lesson-select">Lesson</label>
              <select class="select" id="builder-lesson-select">
                <option value="" ${!editingLessonId ? 'selected' : ''}>+ New lesson</option>
                ${phaseLessons
                  .map(
                    (l, i) => `<option value="${escapeHtml(l.id)}" ${l.id === editingLessonId ? 'selected' : ''}>${i + 1}. ${escapeHtml(l.title)} (${escapeHtml(l.publicationStatus || 'published')})</option>`
                  )
                  .join('')}
              </select>
            </div>
          </div>

          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <div class="segmented" role="group" aria-label="Lesson editor view mode">
              <button type="button" class="segmented-btn ${lessonViewMode === 'edit' ? 'is-active' : ''}" data-lesson-view="edit">Edit</button>
              <button type="button" class="segmented-btn ${lessonViewMode === 'split' ? 'is-active' : ''}" data-lesson-view="split">Split</button>
              <button type="button" class="segmented-btn ${lessonViewMode === 'preview' ? 'is-active' : ''}" data-lesson-view="preview">Preview</button>
            </div>
            ${editingLessonId ? `<button type="button" class="btn btn-ghost btn-sm" id="reset-lesson-builder-btn">+ Blank lesson</button>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" id="back-to-hierarchy-btn">← Hierarchy</button>
          </div>
        </div>
      </div>

      <div class="${lessonViewMode === 'split' ? 'admin-editor-split' : ''}">
        ${
          lessonViewMode !== 'preview'
            ? `
          <section class="card" aria-label="10-field lesson editor">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--color-border);">
              <h2 class="section-heading" style="margin:0;">${editingLessonId ? `Edit Lesson: ${escapeHtml(lessonDraft.title || 'Untitled')}` : 'New Lesson'}</h2>
              ${renderStatusBadge(lessonDraft.publicationStatus || 'draft')}
            </div>

            <form id="admin-lesson-form" class="form-stack">
              <!-- 1. Title + 10. Publication status (+ duration/required) -->
              <div class="lab-grid-3">
                <div class="field" style="grid-column: span 1;">
                  <label class="field-label" for="les-title">1. Title</label>
                  <input class="input" id="les-title" name="title" data-les-field="title" required value="${escapeHtml(lessonDraft.title)}" placeholder="e.g. Audience Exclusions &amp; Retargeting" />
                </div>
                <div class="field">
                  <label class="field-label" for="les-mins">Estimated minutes</label>
                  <input class="input" id="les-mins" name="estMinutes" data-les-field="estMinutes" type="number" min="5" max="180" value="${Number(lessonDraft.estMinutes || 25)}" />
                </div>
                <div class="field">
                  <label class="field-label" for="les-pub">10. Publication status</label>
                  <select class="select" id="les-pub" name="publicationStatus" data-les-field="publicationStatus">
                    <option value="published" ${lessonDraft.publicationStatus === 'published' ? 'selected' : ''}>Published</option>
                    <option value="draft" ${lessonDraft.publicationStatus === 'draft' ? 'selected' : ''}>Draft</option>
                  </select>
                </div>
              </div>

              <!-- 2. Introduction -->
              <div class="field">
                <label class="field-label" for="les-intro">2. Introduction</label>
                <textarea class="textarea" id="les-intro" name="introduction" data-les-field="introduction" style="min-height:68px;" required placeholder="Short framing explanation of what the lesson teaches and why it matters…">${escapeHtml(lessonDraft.introduction)}</textarea>
              </div>

              <!-- 3. Learning objectives -->
              <div class="field">
                <label class="field-label" for="les-obj">3. Learning objectives (one per line)</label>
                <textarea class="textarea" id="les-obj" name="objectives" data-les-field="objectives" style="min-height:70px;" placeholder="Explain foundational principles&#10;Apply the framework in a practical scenario">${escapeHtml(lessonDraft.objectives)}</textarea>
              </div>

              <!-- 4. Main lesson content (Rich-text editor + toolbar) -->
              <div class="field">
                <label class="field-label" for="les-main-content">4. Main lesson content</label>
                <div class="lesson-richtext-toolbar" role="toolbar" aria-label="Rich-text formatting controls">
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="h2">Heading</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="h3">Subheading</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="bold"><strong>B</strong></button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="italic"><em>I</em></button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="bullets">Bullet list</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="steps">Numbered list</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="table">Table</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="definition">Definition</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="callout">Note</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="code">Code</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-rt-action="image">Image</button>
                </div>
                <textarea class="textarea lesson-richtext-area" id="les-main-content" name="mainContentText" data-les-field="mainContentText" required placeholder="Write the instructional lecture using natural paragraphs, occasional headings (## Heading), lists (- item), tables (| A | B |), definitions (Term :: Meaning), code fences, and images…">${escapeHtml(lessonDraft.mainContentText)}</textarea>
                <span class="field-hint">Write naturally in paragraphs. Use the toolbar above for headings, lists, tables, definitions, callouts, code, and images.</span>
              </div>

              <!-- 5. Practical application -->
              <div class="card-workspace" style="padding:14px;">
                <strong style="display:block; color:var(--color-navy); margin-bottom:10px;">5. Practical application / worked example</strong>
                <div class="form-stack">
                  <div class="field">
                    <label class="field-label" for="les-prac-title">Application title</label>
                    <input class="input" id="les-prac-title" name="practicalTitle" data-les-field="practicalTitle" value="${escapeHtml(lessonDraft.practicalTitle)}" placeholder="e.g. Worked Example: Auditing a Funnel Exclusion Matrix" />
                  </div>
                  <div class="field">
                    <label class="field-label" for="les-prac-body">Walkthrough / scenario</label>
                    <textarea class="textarea" id="les-prac-body" name="practicalBody" data-les-field="practicalBody" style="min-height:90px;" placeholder="Show a realistic scenario, step-by-step worked example, or hands-on exercise…">${escapeHtml(lessonDraft.practicalBody)}</textarea>
                  </div>
                  <div class="field">
                    <label class="field-label" for="les-prac-outcome">Expected outcome / takeaway (optional)</label>
                    <input class="input" id="les-prac-outcome" name="practicalOutcome" data-les-field="practicalOutcome" value="${escapeHtml(lessonDraft.practicalOutcome)}" placeholder="What the learner should observe or verify" />
                  </div>
                </div>
              </div>

              <!-- 6. Lesson summary -->
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="les-summary">6. Lesson summary</label>
                  <textarea class="textarea" id="les-summary" name="summary" data-les-field="summary" style="min-height:70px;" placeholder="Concise synthesis of what this lesson covered…">${escapeHtml(lessonDraft.summary)}</textarea>
                </div>
                <div class="field">
                  <label class="field-label" for="les-takeaways">Key takeaways (one per line, optional)</label>
                  <textarea class="textarea" id="les-takeaways" name="takeaways" data-les-field="takeaways" style="min-height:70px;">${escapeHtml(lessonDraft.takeaways)}</textarea>
                </div>
              </div>

              <!-- 7. Assessment questions -->
              <div class="card-workspace" style="padding:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                  <div>
                    <strong style="color:var(--color-navy);">7. Assessment questions (${draftAssessmentQuestions.length})</strong>
                    <p class="admin-panel-sub">Saved as this lesson's knowledge assessment and graded automatically for learners.</p>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <label class="field-label" for="les-pass-pct" style="margin:0;">Pass %</label>
                    <input class="input" id="les-pass-pct" data-les-field="passPercent" type="number" min="50" max="100" value="${Number(lessonDraft.passPercent || 70)}" style="width:76px; min-height:34px; padding:4px 8px;" />
                  </div>
                </div>

                ${
                  draftAssessmentQuestions.length > 0
                    ? `<div class="divider-list" style="margin-bottom:12px;">
                        ${draftAssessmentQuestions
                          .map(
                            (q, idx) => `
                          <div class="divider-row" style="align-items:flex-start; flex-wrap:wrap; padding:8px 0;">
                            <div style="flex:1; min-width:200px;">
                              <div style="font-weight:600; font-size:13.5px; color:var(--color-navy);">
                                <span class="mono-num">${idx + 1}.</span> ${escapeHtml(q.prompt)}
                              </div>
                              <div class="meta-line" style="margin-top:2px;">
                                <span>${escapeHtml(q.questionType.replace('_', ' '))}</span>
                                <span class="meta-sep">·</span>
                                <span class="mono-num">${q.marks} marks</span>
                                ${q.options?.length ? `<span class="meta-sep">·</span><span>${q.options.length} options</span>` : ''}
                              </div>
                            </div>
                            <div style="display:flex; gap:6px;">
                              <button type="button" class="btn btn-secondary btn-sm" data-edit-draft-q="${idx}">Edit</button>
                              <button type="button" class="btn btn-ghost btn-sm" data-del-draft-q="${idx}">Remove</button>
                            </div>
                          </div>
                        `
                          )
                          .join('')}
                      </div>`
                    : ''
                }

                <div style="padding:12px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-sm);">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
                    <strong style="font-size:13px; color:var(--color-navy);">${editingQuestionIndex !== null ? `Edit Question #${editingQuestionIndex + 1}` : 'Add Assessment Question'}</strong>
                    ${editingQuestionIndex !== null ? `<button type="button" class="btn btn-ghost btn-sm" id="cancel-edit-draft-q">Cancel edit</button>` : ''}
                  </div>
                  <div class="form-stack">
                    <div class="lab-grid-2">
                      <div class="field">
                        <label class="field-label" for="qc-type">Question type</label>
                        <select class="select" id="qc-type" data-qc-field="questionType">
                          ${QUESTION_TYPES.map((t) => `<option value="${t.key}" ${t.key === qType ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
                        </select>
                      </div>
                      <div class="field">
                        <label class="field-label" for="qc-marks">Marks</label>
                        <input class="input" id="qc-marks" data-qc-field="marks" type="number" min="1" max="50" value="${Number(questionComposer.marks || 2)}" />
                      </div>
                    </div>
                    <div class="field">
                      <label class="field-label" for="qc-prompt">Question prompt</label>
                      <input class="input" id="qc-prompt" data-qc-field="prompt" value="${escapeHtml(questionComposer.prompt)}" placeholder="Enter question prompt…" />
                    </div>
                    ${
                      qIsManual
                        ? '<div style="font-size:12.5px; color:var(--color-text-secondary);">Written responses are saved for administrator review.</div>'
                        : qIsFill
                          ? `<div class="field">
                              <label class="field-label" for="qc-accepted">Accepted answers (comma-separated)</label>
                              <input class="input" id="qc-accepted" data-qc-field="acceptedAnswersCsv" value="${escapeHtml(questionComposer.acceptedAnswersCsv)}" placeholder="e.g. BLUF, Bottom Line Up Front" />
                            </div>`
                          : qIsTrueFalse
                            ? `<div class="field">
                                <label class="field-label" for="qc-tf-correct">Correct answer</label>
                                <select class="select" id="qc-tf-correct" data-qc-field="correctIndex">
                                  <option value="0" ${Number(questionComposer.correctIndex) === 0 ? 'selected' : ''}>True</option>
                                  <option value="1" ${Number(questionComposer.correctIndex) === 1 ? 'selected' : ''}>False</option>
                                </select>
                              </div>`
                            : `<div class="field">
                                <label class="field-label" for="qc-options">${qIsOrder ? 'Steps in correct order (one per line)' : 'Options (one per line)'}</label>
                                <textarea class="textarea" id="qc-options" data-qc-field="optionsLines" style="min-height:68px;" placeholder="Option A&#10;Option B&#10;Option C">${escapeHtml(questionComposer.optionsLines)}</textarea>
                              </div>
                              ${
                                qIsMultiSelect
                                  ? `<div class="field">
                                      <label class="field-label" for="qc-multi-idx">Correct 0-based indices (comma-separated)</label>
                                      <input class="input" id="qc-multi-idx" data-qc-field="correctIndicesCsv" value="${escapeHtml(questionComposer.correctIndicesCsv)}" placeholder="e.g. 0, 2" />
                                    </div>`
                                  : qIsOrder
                                    ? ''
                                    : `<div class="field">
                                        <label class="field-label" for="qc-correct">Correct option 0-based index</label>
                                        <input class="input" id="qc-correct" data-qc-field="correctIndex" type="number" min="0" max="10" value="${Number(questionComposer.correctIndex || 0)}" />
                                      </div>`
                              }`
                    }
                    <div class="field">
                      <label class="field-label" for="qc-expl">Feedback explanation</label>
                      <input class="input" id="qc-expl" data-qc-field="explanation" value="${escapeHtml(questionComposer.explanation)}" placeholder="Explanation shown after submission" />
                    </div>
                    <div>
                      <button type="button" class="btn btn-secondary btn-sm" id="save-draft-question-btn">
                        ${editingQuestionIndex !== null ? 'Update question in lesson' : '+ Add question to lesson'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 8. Optional video resources -->
              <div class="card-workspace" style="padding:14px;">
                <strong style="display:block; color:var(--color-navy); margin-bottom:8px;">8. Optional video resources (${draftVideos.length})</strong>
                ${
                  draftVideos.length > 0
                    ? `<div class="divider-list" style="margin-bottom:10px;">
                        ${draftVideos
                          .map(
                            (v, i) => `<div class="divider-row" style="padding:6px 0;">
                              <span style="font-size:13px;"><strong>${escapeHtml(v.title || 'Video')}</strong> (${escapeHtml(v.videoId || v.url || '')})</span>
                              <button type="button" class="btn btn-ghost btn-sm" data-del-video="${i}">Remove</button>
                            </div>`
                          )
                          .join('')}
                      </div>`
                    : ''
                }
                <div class="lab-grid-3">
                  <input class="input" id="vid-url" placeholder="YouTube URL (https://youtu.be/...)" />
                  <input class="input" id="vid-title" placeholder="Optional video title" />
                  <div style="display:flex; gap:6px;">
                    <input class="input" id="vid-duration" placeholder="e.g. 08:30" style="flex:1;" />
                    <button type="button" class="btn btn-secondary btn-sm" id="add-video-btn">Attach</button>
                  </div>
                </div>
              </div>

              <!-- 9. Completion criteria -->
              <div class="field">
                <label class="field-label" for="les-criteria">9. Completion criteria</label>
                <input class="input" id="les-criteria" name="completionCriteria" data-les-field="completionCriteria" value="${escapeHtml(lessonDraft.completionCriteria)}" />
              </div>

              <label style="display:flex; align-items:center; gap:8px; font-size:13.5px; color:var(--color-navy);">
                <input type="checkbox" name="isRequired" id="les-required" ${lessonDraft.isRequired ? 'checked' : ''} />
                <span>Required for phase and course completion</span>
              </label>

              <div style="display:flex; gap:10px; flex-wrap:wrap; padding-top:8px;">
                <button type="submit" class="btn btn-primary" ${!activePhase ? 'disabled' : ''}>${editingLessonId ? 'Save lesson changes' : 'Save new lesson'}</button>
                <button type="button" class="btn btn-secondary" id="refresh-live-preview-btn">Refresh preview</button>
              </div>
            </form>
          </section>
        `
            : ''
        }

        ${
          lessonViewMode !== 'edit'
            ? `
          <aside class="card" aria-label="Lesson preview">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid var(--color-border);">
              <div>
                <h2 class="section-heading" style="margin:0;">Learner Lesson Preview</h2>
                <p class="admin-panel-sub">Reflects the exact 8-section learner reading layout before publication.</p>
              </div>
            </div>
            ${
              liveParseError
                ? `<div style="padding:10px 12px; border-radius:var(--radius-sm); background:var(--color-red-bg); color:var(--color-red); font-size:13px; margin-bottom:12px;">${escapeHtml(liveParseError)}</div>`
                : ''
            }
            ${
              livePreviewLesson
                ? renderLessonReaderHtml({
                    lesson: livePreviewLesson,
                    courseTitle: activeCourse?.title || 'Course',
                    phasePosition: activePhase?.position || 1,
                    phaseTitle: activePhase?.title || 'Phase',
                    lessonNumber: Math.max(
                      1,
                      editingLessonId
                        ? phaseLessons.findIndex((l) => l.id === editingLessonId) + 1
                        : phaseLessons.length + 1
                    ),
                    totalLessonsInPhase: Math.max(1, phaseLessons.length),
                    lessonQuiz: livePreviewQuiz,
                    previewMode: true,
                  })
                : ''
            }
          </aside>
        `
            : ''
        }
      </div>
    `
            : activeCourse
              ? `
      <!-- Import / Export & Snapshot Recovery Tab -->
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
          <div class="card-workspace" style="padding:10px 12px;">
            <div class="meta-line" style="margin-bottom:4px;">
              <span>Course ID: <code class="mono-num">${escapeHtml(activeCourse.id)}</code></span>
              <span class="meta-sep">·</span>
              <span>Version <strong class="mono-num">v${Number(activeCourse.version || 1)}</strong></span>
            </div>
            <div style="font-size:12.5px; color:var(--color-text-secondary);">
              ${phases.length} phases · ${totalCourseLessons} lessons · ${recoverableVersions.length} restorable snapshots
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
          <div>
            <h2 class="section-heading" style="margin:0 0 4px;">Export Course Curriculum (Schema v${CONTENT_PACKAGE_SCHEMA_VERSION})</h2>
            <p style="font-size:13px; color:var(--color-text-secondary); margin:0;">
              Downloads all ${phases.length} phases, ${totalCourseLessons} lessons, structured content, and video metadata cleanly without learner PII or quiz answers.
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
              Step 1 validates every block, URL, and phase reference without modifying database records. Step 2 commits atomically after creating a backup snapshot.
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
                ? `<span style="font-size:12.5px; color:var(--color-amber);">JSON edited after preview — re-run Dry Run before committing.</span>`
                : ''
            }
          </div>
        </div>

        ${
          lastCommitResult
            ? `<div style="margin-top:16px; padding:12px 14px; border-radius:var(--radius-sm); border:1px solid var(--color-green-border); background:var(--color-green-bg); font-size:13px;">
                <strong style="color:var(--color-navy); display:block; margin-bottom:4px;">Bulk import committed cleanly${lastCommitResult.idempotentReplay ? ' (idempotent replay)' : ''}.</strong>
                <div style="color:var(--color-text-secondary);">
                  Created <strong class="mono-num">${lastCommitResult.createdCount}</strong> draft lesson(s) · Updated <strong class="mono-num">${lastCommitResult.updatedCount}</strong> lesson(s) · Unchanged <strong class="mono-num">${lastCommitResult.unchangedCount}</strong>.
                </div>
              </div>`
            : ''
        }

        ${
          dryRunParseErrors.length > 0
            ? `<div style="margin-top:16px; padding:14px; border-radius:var(--radius-sm); border:1px solid var(--color-red-border); background:var(--color-red-bg);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                  <strong style="color:var(--color-red);">Package Parsing Rejected (${dryRunParseErrors.length})</strong>
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
            <div style="padding:14px; border-radius:var(--radius-sm); border:1px solid ${!dryRunPlan.valid ? 'var(--color-red-border)' : dryRunPlan.canCommit ? 'var(--color-green-border)' : 'var(--color-amber-border)'}; background:${!dryRunPlan.valid ? 'var(--color-red-bg)' : dryRunPlan.canCommit ? 'var(--color-green-bg)' : 'var(--color-amber-bg)'}; margin-bottom:14px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                <strong style="color:var(--color-navy);">
                  ${!dryRunPlan.valid ? 'Dry-Run Failed' : dryRunPlan.canCommit ? 'Dry-Run Passed' : 'Dry-Run Complete (no changes)'}
                </strong>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <span class="status-tag status-green">New: ${dryRunPlan.counts.new}</span>
                  <span class="status-tag status-blue">Updated: ${dryRunPlan.counts.updated}</span>
                  <span class="status-tag status-neutral">Unchanged: ${dryRunPlan.counts.unchanged}</span>
                  <span class="status-tag status-red">Rejected: ${dryRunPlan.counts.rejected}</span>
                </div>
              </div>
              ${
                !dryRunPlan.valid || dryRunPlan.counts.rejected > 0
                  ? `<div style="margin-top:10px;"><button type="button" class="btn btn-secondary btn-sm" id="download-error-report-btn">Download Error Report (.json)</button></div>`
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
                        Phase: ${escapeHtml(item.phaseTitle)} · Target status: <strong class="mono-num">${escapeHtml(item.effectiveStatus)}</strong>
                      </span>
                    </div>
                    ${renderStatusBadge(item.classification)}
                  </div>
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
                          <div style="margin-top:6px; padding:8px 10px; background:var(--color-bg); border:1px solid var(--color-border); border-radius:var(--radius-sm);">
                            ${item.changes
                              .map(
                                (ch) => `<div style="margin-bottom:4px;"><strong class="mono-num">${escapeHtml(ch.field)}</strong>: ${escapeHtml(formatDiffValue(ch.before))} → ${escapeHtml(formatDiffValue(ch.after))}</div>`
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
                    <div class="form-stack">
                      <div class="field">
                        <label class="field-label" for="import-change-notes">Release / Import Notes</label>
                        <input class="input" id="import-change-notes" value="${escapeHtml(importChangeNotes)}" placeholder="e.g. Phase 2 content refresh" />
                      </div>
                      <label style="display:flex; align-items:flex-start; gap:8px; font-size:13px; color:var(--color-navy); cursor:pointer;">
                        <input type="checkbox" id="confirm-bulk-import-chk" ${confirmBulkImport ? 'checked' : ''} ${!dryRunMatchesCurrentText ? 'disabled' : ''} style="margin-top:3px;" />
                        <span>I confirm committing these validated curriculum updates with an automatic backup snapshot.</span>
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
          ${
            recoverableVersions.length > 0
              ? `<div class="divider-list">
                  ${recoverableVersions
                    .map(
                      (v) => `
                    <div class="divider-row" style="flex-direction:column; align-items:stretch; gap:8px; padding:10px 0;">
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                        <div>
                          <strong style="color:var(--color-navy);">Version v${Number(v.versionNumber || 1)}</strong>
                          <div style="font-size:12.5px; color:var(--color-text-secondary);">${escapeHtml(v.changeNotes || 'Snapshot')} · ${formatDate(v.createdAt)}</div>
                        </div>
                        ${
                          confirmRestoreVersionId === v.id
                            ? ''
                            : `<button type="button" class="btn btn-secondary btn-sm" data-start-restore="${escapeHtml(v.id)}" ${restoreInFlightId ? 'disabled' : ''}>Restore</button>`
                        }
                      </div>
                      ${
                        confirmRestoreVersionId === v.id
                          ? `<div class="card-workspace" style="padding:10px 12px;">
                              <input class="input" id="restore-notes-input" value="${escapeHtml(restoreNotes)}" placeholder="Optional recovery reason…" style="margin-bottom:8px;" />
                              <div style="display:flex; gap:8px;">
                                <button type="button" class="btn btn-primary btn-sm" data-confirm-restore="${escapeHtml(v.id)}" ${restoreInFlightId ? 'disabled' : ''}>Confirm Restore</button>
                                <button type="button" class="btn btn-ghost btn-sm" id="cancel-restore-btn">Cancel</button>
                              </div>
                            </div>`
                          : ''
                      }
                    </div>
                  `
                    )
                    .join('')}
                </div>`
              : '<p style="font-size:13px; color:var(--color-text-muted); margin:0;">No full curriculum snapshots saved yet.</p>'
          }
        </section>

        <section class="card">
          <h2 class="section-heading" style="margin:0 0 6px;">Import &amp; Recovery History (${importHistory.length})</h2>
          ${
            importHistory.length > 0
              ? `<div class="divider-list">
                  ${importHistory
                    .map(
                      (rec) => `
                    <div class="divider-row" style="flex-direction:column; align-items:stretch; gap:4px; padding:10px 0;">
                      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <strong style="font-size:13px; color:var(--color-navy);">${escapeHtml(rec.operationType === 'restore' ? 'Snapshot Recovery' : 'Bulk Import')} · ${formatDate(rec.createdAt)}</strong>
                        ${renderStatusBadge(rec.status === 'failed' ? 'import_failed' : rec.status)}
                      </div>
                      <div style="font-size:12.5px; color:var(--color-text-secondary);">
                        New ${rec.createdCount} · Updated ${rec.updatedCount} · Rejected ${rec.rejectedCount}
                      </div>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
              : '<p style="font-size:13px; color:var(--color-text-muted); margin:0;">No import or recovery events recorded yet.</p>'
          }
        </section>
      </div>
    `
              : '<div class="card"><p style="font-size:14px; color:var(--color-text-muted); margin:0;">Create or select a course first to export, bulk import, or restore snapshots.</p></div>'
    }
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    /** @param {HTMLElement} root */
    bind(root) {
      // Top Tabs
      root.querySelectorAll('[data-admin-tab]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          activeTab = /** @type {'hierarchy' | 'lesson_editor' | 'import_export'} */ (
            btn.dataset.adminTab || 'hierarchy'
          );
          rerender({ silent: true });
        });
      });

      // Hierarchy: Skills
      root.querySelector('#admin-skill-search')?.addEventListener('input', (e) => {
        skillSearchQuery = /** @type {HTMLInputElement} */ (e.target).value;
        rerender({ silent: true });
      });

      root.querySelector('#admin-cat-filter')?.addEventListener('change', (e) => {
        catalogCategoryFilter = /** @type {HTMLSelectElement} */ (e.target).value;
        rerender({ silent: true });
      });

      root.querySelector('#toggle-category-form-btn')?.addEventListener('click', () => {
        categoryFormOpen = !categoryFormOpen;
        rerender({ silent: true });
      });

      root.querySelector('#new-skill-btn')?.addEventListener('click', () => {
        editingSkillId = null;
        skillFormOpen = true;
        rerender({ silent: true });
      });

      root.querySelector('#cancel-skill-form-btn')?.addEventListener('click', () => {
        editingSkillId = null;
        skillFormOpen = false;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-select-skill]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          selectedSkillId = btn.dataset.selectSkill || null;
          const nextCourses = courses.filter(
            (c) =>
              c.skillId === selectedSkillId ||
              (selectedSkillId ? (c.associatedSkillIds || []).includes(selectedSkillId) : false)
          );
          selectedCourseId = nextCourses[0]?.id || selectedCourseId;
          selectedPhaseId = nextCourses[0]?.phases?.[0]?.id || null;
          editingPhaseId = null;
          phaseFormOpen = false;
          confirmDeletePhaseId = null;
          confirmDeleteLessonId = null;
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-edit-skill]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          editingSkillId = btn.dataset.editSkill || null;
          skillFormOpen = true;
          rerender({ silent: true });
        });
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
            showToast(`Updated ${skill.title}.`, 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to update skill status.', 'error');
          }
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
          categoryFormOpen = false;
          showToast('Category created.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to create category.', 'error');
        }
      });

      root.querySelector('#admin-skill-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(/** @type {HTMLFormElement} */ (e.currentTarget));
        try {
          const saved = await adminUpsertSkill({
            id: editingSkillId || undefined,
            slug: editingSkill?.slug || undefined,
            title: String(fd.get('title')),
            categoryId: String(fd.get('categoryId')),
            level: String(fd.get('level')),
            summary: String(fd.get('summary')),
            outcomes: String(fd.get('outcomes') || ''),
            publicationStatus: String(fd.get('publicationStatus') || 'published'),
          });
          if (saved?.id) selectedSkillId = saved.id;
          showToast(editingSkillId ? 'Skill updated.' : 'Skill created.', 'success');
          editingSkillId = null;
          skillFormOpen = false;
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to save skill.', 'error');
        }
      });

      // Hierarchy: Courses
      root.querySelectorAll('[data-course-scope]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          skillCourseFilter = btn.dataset.courseScope === 'all' ? 'all' : 'linked';
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-select-course]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          selectedCourseId = btn.dataset.selectCourse || null;
          const nextC = courses.find((c) => c.id === selectedCourseId);
          selectedPhaseId = nextC?.phases?.[0]?.id || null;
          courseFormOpen = false;
          editingPhaseId = null;
          phaseFormOpen = false;
          confirmDeletePhaseId = null;
          confirmDeleteLessonId = null;
          rerender({ silent: true });
        });
      });

      root.querySelector('#new-course-btn')?.addEventListener('click', () => {
        courseFormMode = 'create';
        courseFormOpen = true;
        rerender({ silent: true });
      });

      root.querySelector('#edit-active-course-btn')?.addEventListener('click', () => {
        courseFormMode = 'edit';
        courseFormOpen = true;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-edit-course]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          selectedCourseId = btn.dataset.editCourse || null;
          courseFormMode = 'edit';
          courseFormOpen = true;
          rerender({ silent: true });
        });
      });

      root.querySelector('#cancel-course-form-btn')?.addEventListener('click', () => {
        courseFormOpen = false;
        rerender({ silent: true });
      });

      root.querySelector('#assoc-skill-filter')?.addEventListener('input', (e) => {
        skillAssociationFilter = /** @type {HTMLInputElement} */ (e.target).value;
        rerender({ silent: true });
      });

      root.querySelector('#admin-course-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(/** @type {HTMLFormElement} */ (e.currentTarget));
        const associatedSkillIds = fd.getAll('associatedSkillIds').map(String).filter(Boolean);
        const primarySkillId = associatedSkillIds[0] || editCourseObj?.skillId || selectedSkillId || '';
        try {
          const saved = await adminUpsertCourse({
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
          if (saved?.id) selectedCourseId = saved.id;
          showToast(editCourseObj ? 'Course updated.' : 'Course created.', 'success');
          courseFormMode = 'edit';
          courseFormOpen = false;
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to save course.', 'error');
        }
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
        const notes =
          /** @type {HTMLInputElement | null} */ (root.querySelector('#version-notes-input'))?.value || '';
        try {
          const ver = await adminCreateCourseVersion(activeCourse.id, notes);
          showToast(`Snapshot v${ver?.versionNumber || Number(activeCourse.version || 1) + 1} saved.`, 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to save snapshot.', 'error');
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

      // Hierarchy: Phases
      root.querySelectorAll('[data-select-phase]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          selectedPhaseId = btn.dataset.selectPhase || null;
          confirmDeleteLessonId = null;
          rerender({ silent: true });
        });
      });

      root.querySelector('#new-phase-btn')?.addEventListener('click', () => {
        editingPhaseId = null;
        phaseFormOpen = true;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-edit-phase]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          editingPhaseId = btn.dataset.editPhase || null;
          phaseFormOpen = true;
          rerender({ silent: true });
        });
      });

      root.querySelector('#cancel-phase-form-btn')?.addEventListener('click', () => {
        editingPhaseId = null;
        phaseFormOpen = false;
        rerender({ silent: true });
      });

      root.querySelector('#admin-phase-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeCourse) return;
        const fd = new FormData(/** @type {HTMLFormElement} */ (e.currentTarget));
        try {
          const saved = await adminUpsertPhase({
            id: editingPhaseObj?.id || undefined,
            courseId: activeCourse.id,
            position: editingPhaseObj?.position,
            title: String(fd.get('title')),
            summary: String(fd.get('summary')),
            objectives: String(fd.get('objectives') || ''),
            difficulty: String(fd.get('difficulty')),
            estHours: Number(fd.get('estHours') || 3),
            publicationStatus: String(fd.get('publicationStatus') || 'published'),
          });
          if (saved?.id) selectedPhaseId = saved.id;
          showToast(editingPhaseObj ? 'Phase updated.' : 'Phase created.', 'success');
          editingPhaseId = null;
          phaseFormOpen = false;
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to save phase.', 'error');
        }
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
            showToast('Phase order updated.', 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to reorder phases.', 'error');
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
            showToast(`Phase set to ${nextPub}.`, 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to update phase status.', 'error');
          }
        });
      });

      root.querySelectorAll('[data-del-phase]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          confirmDeletePhaseId = btn.dataset.delPhase || null;
          rerender({ silent: true });
        });
      });
      root.querySelector('#cancel-del-phase-btn')?.addEventListener('click', () => {
        confirmDeletePhaseId = null;
        rerender({ silent: true });
      });
      root.querySelectorAll('[data-confirm-del-phase]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          const phId = btn.dataset.confirmDelPhase || '';
          try {
            await adminDeletePhase(activeCourse.id, phId);
            confirmDeletePhaseId = null;
            if (selectedPhaseId === phId) selectedPhaseId = null;
            showToast('Phase deleted.', 'info');
            rerender({ silent: true });
          } catch (err) {
            confirmDeletePhaseId = null;
            showToast(err instanceof Error ? err.message : 'Unable to delete phase.', 'error');
            rerender({ silent: true });
          }
        });
      });

      // Hierarchy: Lessons
      root.querySelector('#new-lesson-in-phase-btn')?.addEventListener('click', () => {
        resetLessonEditor();
        activeTab = 'lesson_editor';
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-move-lesson]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse || !activePhase) return;
          const lid = btn.dataset.moveLesson || '';
          const dir = Number(btn.dataset.dir);
          const ids = phaseLessons.map((l) => l.id);
          const idx = ids.indexOf(lid);
          const target = idx + dir;
          if (idx < 0 || target < 0 || target >= ids.length) return;
          [ids[idx], ids[target]] = [ids[target], ids[idx]];
          try {
            await adminReorderLessons(activeCourse.id, activePhase.id, ids);
            showToast('Lesson order updated.', 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to reorder lessons.', 'error');
          }
        });
      });

      root.querySelectorAll('[data-toggle-lesson-pub]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse || !activePhase) return;
          const les = phaseLessons.find((l) => l.id === btn.dataset.toggleLessonPub);
          if (!les) return;
          const nextPub = (les.publicationStatus || 'published') === 'published' ? 'draft' : 'published';
          try {
            await adminUpsertLesson({
              ...les,
              courseId: activeCourse.id,
              phaseId: activePhase.id,
              publicationStatus: nextPub,
            });
            showToast(`Lesson set to ${nextPub}.`, 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to update lesson status.', 'error');
          }
        });
      });

      root.querySelectorAll('[data-edit-lesson-btn]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          const les = phaseLessons.find((l) => l.id === btn.dataset.editLessonBtn);
          if (!les) return;
          await loadLessonIntoEditor(les, courseAssessments);
          activeTab = 'lesson_editor';
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-preview-lesson]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          previewModalLessonId = btn.dataset.previewLesson || null;
          rerender({ silent: true });
        });
      });
      root.querySelector('#close-lesson-preview')?.addEventListener('click', () => {
        previewModalLessonId = null;
        rerender({ silent: true });
      });
      root.querySelector('#lesson-preview-backdrop')?.addEventListener('click', (e) => {
        if (/** @type {HTMLElement | null} */ (e.target)?.id === 'lesson-preview-backdrop') {
          previewModalLessonId = null;
          rerender({ silent: true });
        }
      });
      root.querySelector('#edit-from-modal-preview')?.addEventListener('click', async (e) => {
        const lid = /** @type {HTMLElement} */ (e.currentTarget).dataset.lessonId || '';
        const les = allCourseLessonsFlat.find((l) => l.id === lid) || null;
        previewModalLessonId = null;
        if (les) {
          selectedPhaseId = les.phaseId;
          await loadLessonIntoEditor(les, courseAssessments);
          activeTab = 'lesson_editor';
        }
        rerender({ silent: true });
      });

      if (modalPreviewLesson) {
        bindLessonReader(root, { lessonQuiz: modalPreviewQuiz });
      }

      root.querySelectorAll('[data-del-lesson]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          confirmDeleteLessonId = btn.dataset.delLesson || null;
          rerender({ silent: true });
        });
      });
      root.querySelector('#cancel-del-lesson-btn')?.addEventListener('click', () => {
        confirmDeleteLessonId = null;
        rerender({ silent: true });
      });
      root.querySelectorAll('[data-confirm-del-lesson]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', async () => {
          if (!activeCourse || !activePhase) return;
          const lid = btn.dataset.confirmDelLesson || '';
          try {
            await adminDeleteLesson(activeCourse.id, activePhase.id, lid);
            confirmDeleteLessonId = null;
            showToast('Lesson deleted.', 'info');
            rerender({ silent: true });
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Unable to delete lesson.', 'error');
          }
        });
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
          showToast('Practical activity added.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to add activity.', 'error');
        }
      });

      // 10-Field Lesson Editor handlers
      root.querySelector('#back-to-hierarchy-btn')?.addEventListener('click', () => {
        activeTab = 'hierarchy';
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-lesson-view]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          lessonViewMode = /** @type {'split' | 'edit' | 'preview'} */ (
            btn.dataset.lessonView || 'split'
          );
          rerender({ silent: true });
        });
      });

      root.querySelector('#builder-course-select')?.addEventListener('change', (e) => {
        selectedCourseId = /** @type {HTMLSelectElement} */ (e.target).value;
        const nextC = courses.find((c) => c.id === selectedCourseId);
        selectedPhaseId = nextC?.phases?.[0]?.id || null;
        resetLessonEditor();
        rerender({ silent: true });
      });

      root.querySelector('#builder-phase-select')?.addEventListener('change', (e) => {
        selectedPhaseId = /** @type {HTMLSelectElement} */ (e.target).value;
        resetLessonEditor();
        rerender({ silent: true });
      });

      root.querySelector('#builder-lesson-select')?.addEventListener('change', async (e) => {
        const lid = /** @type {HTMLSelectElement} */ (e.target).value;
        const found = phaseLessons.find((l) => l.id === lid) || null;
        await loadLessonIntoEditor(found, courseAssessments);
        rerender({ silent: true });
      });

      root.querySelector('#reset-lesson-builder-btn')?.addEventListener('click', () => {
        resetLessonEditor();
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-les-field]').forEach((node) => {
        const el = /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (node);
        el.addEventListener('input', () => {
          const f = el.dataset.lesField;
          if (!f) return;
          /** @type {Record<string, string | number | boolean>} */ (lessonDraft)[f] =
            f === 'estMinutes' || f === 'passPercent' ? Number(el.value || 0) : el.value;
        });
      });

      root.querySelector('#les-required')?.addEventListener('change', (e) => {
        lessonDraft.isRequired = /** @type {HTMLInputElement} */ (e.target).checked;
      });

      const mainTextarea = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('#les-main-content'));
      root.querySelectorAll('[data-rt-action]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          if (!mainTextarea) return;
          applyRichTextToolbarAction(mainTextarea, btn.dataset.rtAction || '');
        });
      });

      root.querySelector('#refresh-live-preview-btn')?.addEventListener('click', () => {
        rerender({ silent: true });
      });

      // Assessment question composer inside Lesson Editor
      root.querySelectorAll('[data-qc-field]').forEach((node) => {
        const el = /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (node);
        const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventName, () => {
          const f = el.dataset.qcField;
          if (!f) return;
          /** @type {Record<string, string | number>} */ (questionComposer)[f] =
            f === 'marks' || f === 'correctIndex' ? Number(el.value || 0) : el.value;
          if (f === 'questionType') {
            rerender({ silent: true });
          }
        });
      });

      root.querySelector('#save-draft-question-btn')?.addEventListener('click', () => {
        const prompt = String(questionComposer.prompt || '').trim();
        if (!prompt) {
          showToast('Enter a question prompt first.', 'error');
          return;
        }
        const qt = questionComposer.questionType || 'multiple_choice';
        const isManual = ['short_answer', 'long_form', 'practical_submission'].includes(qt);
        const options =
          qt === 'true_false'
            ? ['True', 'False']
            : String(questionComposer.optionsLines || '')
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);

        const acceptedAnswers = String(questionComposer.acceptedAnswersCsv || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const correctIndices = String(questionComposer.correctIndicesCsv || '')
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n));

        if (!isManual && qt !== 'fill_blank' && options.length < 2) {
          showToast('Provide at least 2 answer options (one per line).', 'error');
          return;
        }
        if (qt === 'fill_blank' && acceptedAnswers.length === 0) {
          showToast('Provide at least one accepted answer.', 'error');
          return;
        }
        if (qt === 'multiple_select' && correctIndices.length === 0) {
          showToast('Provide at least one correct option index (0-based).', 'error');
          return;
        }

        const existingQ =
          editingQuestionIndex !== null ? draftAssessmentQuestions[editingQuestionIndex] : null;
        /** @type {DraftAssessmentQuestion} */
        const entry = {
          id: existingQ?.id,
          tempId: existingQ?.tempId || `dq-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          questionType: qt,
          marks: Math.max(1, Number(questionComposer.marks || 1)),
          difficulty: questionComposer.difficulty || 'medium',
          prompt,
          contextText: String(questionComposer.contextText || '').trim(),
          options,
          correctIndex: Number(questionComposer.correctIndex || 0),
          correctIndices: qt === 'multiple_select' ? correctIndices : null,
          acceptedAnswers: qt === 'fill_blank' ? acceptedAnswers : null,
          correctOrder: qt === 'ordering' ? options.map((_, i) => i) : null,
          explanation: String(questionComposer.explanation || '').trim() || 'Review the lesson section above.',
        };

        if (editingQuestionIndex !== null) {
          draftAssessmentQuestions[editingQuestionIndex] = entry;
          showToast('Question updated.', 'success');
        } else {
          draftAssessmentQuestions.push(entry);
          showToast('Question added to lesson.', 'success');
        }
        resetQuestionComposer();
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-edit-draft-q]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.editDraftQ);
          const q = draftAssessmentQuestions[idx];
          if (!q) return;
          editingQuestionIndex = idx;
          questionComposer = {
            questionType: q.questionType || 'multiple_choice',
            marks: Number(q.marks || 1),
            difficulty: q.difficulty || 'medium',
            prompt: q.prompt || '',
            contextText: q.contextText || '',
            optionsLines: (q.options || []).join('\n'),
            correctIndex: Number(q.correctIndex || 0),
            correctIndicesCsv: (q.correctIndices || []).join(', '),
            acceptedAnswersCsv: (q.acceptedAnswers || []).join(', '),
            explanation: q.explanation || '',
          };
          rerender({ silent: true });
        });
      });

      root.querySelector('#cancel-edit-draft-q')?.addEventListener('click', () => {
        resetQuestionComposer();
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-draft-q]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.delDraftQ);
          draftAssessmentQuestions.splice(idx, 1);
          if (editingQuestionIndex === idx) resetQuestionComposer();
          rerender({ silent: true });
        });
      });

      // Optional Video attachment in Lesson Editor
      root.querySelector('#add-video-btn')?.addEventListener('click', () => {
        const url =
          /** @type {HTMLInputElement | null} */ (root.querySelector('#vid-url'))?.value.trim() || '';
        const title =
          /** @type {HTMLInputElement | null} */ (root.querySelector('#vid-title'))?.value.trim() ||
          'Optional Lesson Video';
        const duration =
          /** @type {HTMLInputElement | null} */ (root.querySelector('#vid-duration'))?.value.trim() || '';
        const res = normalizeVideoEntry({ provider: 'youtube', url, title, duration });
        if (!res.valid || !res.video) {
          showToast(res.error || 'Invalid YouTube URL.', 'error');
          return;
        }
        draftVideos.push(res.video);
        showToast('Optional video attached.', 'success');
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-video]').forEach((node) => {
        const btn = /** @type {HTMLElement} */ (node);
        btn.addEventListener('click', () => {
          draftVideos.splice(Number(btn.dataset.delVideo), 1);
          rerender({ silent: true });
        });
      });

      // Save 10-field Lesson + Assessment Questions
      root.querySelector('#admin-lesson-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeCourse || !activePhase) {
          showToast('Select a valid course and phase first.', 'error');
          return;
        }

        let compiledBlocks;
        try {
          compiledBlocks = richTextToLessonBlocks({
            mainContentText: lessonDraft.mainContentText,
            practicalTitle: lessonDraft.practicalTitle,
            practicalBody: lessonDraft.practicalBody,
            practicalOutcome: lessonDraft.practicalOutcome,
          });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Check lesson rich-text formatting.', 'error');
          return;
        }

        if (compiledBlocks.length === 0) {
          showToast('Enter main instructional content before saving the lesson.', 'error');
          return;
        }

        try {
          const savedLesson = await adminUpsertLesson({
            id: editingLessonId || undefined,
            courseId: activeCourse.id,
            phaseId: activePhase.id,
            title: lessonDraft.title,
            introduction: lessonDraft.introduction,
            objectives: lessonDraft.objectives,
            estMinutes: Number(lessonDraft.estMinutes || 25),
            blocks: compiledBlocks,
            videos: structuredClone(draftVideos),
            furtherReading: structuredClone(draftResources),
            summary: lessonDraft.summary,
            takeaways: lessonDraft.takeaways,
            completionCriteria: lessonDraft.completionCriteria,
            publicationStatus: lessonDraft.publicationStatus,
            isRequired: lessonDraft.isRequired,
          });

          const savedLessonId = savedLesson?.id || editingLessonId || '';

          if (savedLessonId && draftAssessmentQuestions.length > 0) {
            const savedQuiz = await adminUpsertAssessment({
              id: draftLessonQuizId || undefined,
              skillId: activeCourse.skillId,
              courseId: activeCourse.id,
              phaseId: activePhase.id,
              lessonId: savedLessonId,
              quizType: 'knowledge_check',
              title: `${lessonDraft.title} — Knowledge Check`,
              description: 'Lesson knowledge assessment.',
              passPercent: Number(lessonDraft.passPercent || 70),
            });
            const targetQuizId = savedQuiz?.id || draftLessonQuizId || '';
            if (targetQuizId) {
              const currentIds = new Set(
                draftAssessmentQuestions.map((q) => q.id).filter(Boolean)
              );
              for (const oldId of originalLessonQuestionIds) {
                if (!currentIds.has(oldId)) {
                  await adminDeleteQuestion(targetQuizId, oldId);
                }
              }
              for (let idx = 0; idx < draftAssessmentQuestions.length; idx++) {
                const q = draftAssessmentQuestions[idx];
                await adminUpsertQuestion({
                  id: q.id || undefined,
                  quizId: targetQuizId,
                  position: idx + 1,
                  questionType: q.questionType,
                  difficulty: q.difficulty,
                  marks: q.marks,
                  prompt: q.prompt,
                  contextText: q.contextText || '',
                  options: q.options,
                  correctIndex: q.correctIndex,
                  correctIndices: q.correctIndices,
                  acceptedAnswers: q.acceptedAnswers,
                  correctOrder: q.correctOrder,
                  explanation: q.explanation,
                });
              }
            }
          } else if (draftLessonQuizId && draftAssessmentQuestions.length === 0) {
            try {
              await adminDeleteAssessment(draftLessonQuizId);
            } catch (delErr) {
              showToast(
                delErr instanceof Error
                  ? delErr.message
                  : 'Lesson saved, but existing assessment has recorded attempts.',
                'info'
              );
            }
          }

          showToast(editingLessonId ? 'Lesson & assessment saved.' : 'New lesson created.', 'success');
          if (savedLesson) {
            const refreshedAssessments = await listAssessmentsForCourse(activeCourse.id);
            await loadLessonIntoEditor(savedLesson, refreshedAssessments);
          }
          rerender({ silent: true });
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Unable to save lesson.', 'error');
        }
      });

      if (activeTab === 'lesson_editor' && lessonViewMode !== 'edit' && livePreviewLesson) {
        bindLessonReader(root, { lessonQuiz: livePreviewQuiz });
      }

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
        if (commitBtn) commitBtn.disabled = true;
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
              showToast('Dry run rejected one or more items.', 'error');
            } else if (res.plan?.canCommit) {
              showToast('Dry run passed!', 'success');
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
          showToast(`Imported ${result.createdCount} new and ${result.updatedCount} updated lesson(s).`, 'success');
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
