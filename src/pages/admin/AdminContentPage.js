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
  adminDeleteLesson,
  validateCourseForPublish,
} from '../../lib/repositories/contentRepository.js';
import { DIFFICULTY_LEVELS } from '../../lib/constants.js';
import { BLOCK_TYPE_CATALOG, createEmptyBlock, renderLessonBlocks } from '../../lib/lessonBlocks.js';
import { renderCourseThumbnailHtml } from '../../lib/courseThumbnails.js';
import { renderVideoPlayerHtml, normalizeVideoEntry } from '../../lib/videoProvider.js';
import { escapeHtml } from '../../lib/formatters.js';
import { registerSessionCleanup } from '../../lib/sessionLifecycle.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { renderStatusBadge } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let activeTab = 'courses'; // 'catalog' | 'courses' | 'lessons'
let selectedSkillId = null;
let selectedCourseId = null;
let selectedPhaseId = null;
let courseFormMode = 'edit'; // 'edit' | 'create'
let previewCourseOpen = false;
let previewLessonId = null;
let catalogCategoryFilter = 'All';
let catalogCourseStatusFilter = 'all';
let editingSkillId = null;

// Stateful Visual Lesson Builder state (persists across block add/reorder rerenders)
let editingLessonId = null;
let lessonDraft = {
  title: '',
  estMinutes: 25,
  introduction: '',
  objectives: '',
  summary: '',
  takeaways: '',
  completionCriteria: 'Read the instructional guide, review the example, verify inline checks, and mark complete.',
  publicationStatus: 'published',
  isRequired: true,
};
let draftBlocks = [
  { id: 'blk-init-1', type: 'heading', text: 'Core Concept Overview' },
  { id: 'blk-init-2', type: 'paragraph', text: 'Explain the foundational principle clearly here.' },
];
let draftVideos = [];
let draftResources = [];

function resetLessonBuilder() {
  editingLessonId = null;
  lessonDraft = {
    title: '',
    estMinutes: 25,
    introduction: '',
    objectives: '',
    summary: '',
    takeaways: '',
    completionCriteria: 'Read the instructional guide, review the example, verify inline checks, and mark complete.',
    publicationStatus: 'published',
    isRequired: true,
  };
  draftBlocks = [
    { id: `blk-${Date.now()}-1`, type: 'heading', text: 'Core Concept Overview' },
    { id: `blk-${Date.now()}-2`, type: 'paragraph', text: 'Explain the foundational principle clearly here.' },
  ];
  draftVideos = [];
  draftResources = [];
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
  resetLessonBuilder();
});

function loadLessonIntoBuilder(lesson) {
  if (!lesson) {
    resetLessonBuilder();
    return;
  }
  editingLessonId = lesson.id;
  lessonDraft = {
    title: lesson.title || '',
    estMinutes: Number(lesson.estMinutes || 25),
    introduction: lesson.introduction || '',
    objectives: (lesson.objectives || []).join('\n'),
    summary: lesson.summary || '',
    takeaways: (lesson.takeaways || []).join('\n'),
    completionCriteria:
      lesson.completionCriteria ||
      'Read the instructional guide, verify inline checks, and mark complete.',
    publicationStatus: lesson.publicationStatus || 'published',
    isRequired: lesson.isRequired !== false,
  };
  draftBlocks = structuredClone(lesson.blocks || []);
  draftVideos = structuredClone(lesson.videos || []);
  draftResources = structuredClone(lesson.furtherReading || []);
}

function renderDraftBlockEditor(blk, idx, total) {
  let fieldsHtml;
  if (blk.type === 'heading' || blk.type === 'paragraph') {
    fieldsHtml = `
      <textarea class="textarea" data-blk-field="text" data-blk-idx="${idx}" style="min-height:${blk.type === 'heading' ? '44px' : '74px'};" placeholder="Enter ${blk.type} text…">${escapeHtml(blk.text || '')}</textarea>
    `;
  } else if (blk.type === 'steps' || blk.type === 'bullets') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Section title" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="itemsLines" data-blk-idx="${idx}" style="min-height:74px;" placeholder="One item per line…">${escapeHtml((blk.items || []).join('\n'))}</textarea>
    `;
  } else if (blk.type === 'definition') {
    fieldsHtml = `
      <input class="input" data-blk-field="term" data-blk-idx="${idx}" value="${escapeHtml(blk.term || '')}" placeholder="Term" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="meaning" data-blk-idx="${idx}" style="min-height:60px;" placeholder="Definition meaning…">${escapeHtml(blk.meaning || '')}</textarea>
    `;
  } else if (blk.type === 'example') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Example title" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="body" data-blk-idx="${idx}" style="min-height:70px;" placeholder="Worked example text…">${escapeHtml(blk.body || '')}</textarea>
    `;
  } else if (blk.type === 'case_study') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Case title" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="scenario" data-blk-idx="${idx}" style="min-height:70px; margin-bottom:6px;" placeholder="Scenario details…">${escapeHtml(blk.scenario || '')}</textarea>
      <input class="input" data-blk-field="takeaway" data-blk-idx="${idx}" value="${escapeHtml(blk.takeaway || '')}" placeholder="Key outcome / takeaway" />
    `;
  } else if (blk.type === 'callout') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Note title" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="text" data-blk-idx="${idx}" style="min-height:60px;" placeholder="Important callout message…">${escapeHtml(blk.text || '')}</textarea>
    `;
  } else if (blk.type === 'demonstration') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Demonstration title" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="instructions" data-blk-idx="${idx}" style="min-height:70px; margin-bottom:6px;" placeholder="Hands-on steps…">${escapeHtml(blk.instructions || '')}</textarea>
      <input class="input" data-blk-field="expectedOutcome" data-blk-idx="${idx}" value="${escapeHtml(blk.expectedOutcome || '')}" placeholder="Expected result" />
    `;
  } else if (blk.type === 'code') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Snippet title" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="code" data-blk-idx="${idx}" style="min-height:80px; font-family:var(--font-mono); font-size:12px;" placeholder="Code or template snippet…">${escapeHtml(blk.code || '')}</textarea>
    `;
  } else if (blk.type === 'image') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Illustration / diagram title" style="margin-bottom:6px;" />
      <input class="input" data-blk-field="url" data-blk-idx="${idx}" value="${escapeHtml(blk.url || '')}" placeholder="Image URL (https://... or /assets/...)" style="margin-bottom:6px;" />
      <div class="lab-grid-2">
        <input class="input" data-blk-field="alt" data-blk-idx="${idx}" value="${escapeHtml(blk.alt || '')}" placeholder="Accessible alt description" />
        <input class="input" data-blk-field="caption" data-blk-idx="${idx}" value="${escapeHtml(blk.caption || '')}" placeholder="Caption under figure" />
      </div>
    `;
  } else if (blk.type === 'table') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Table title" style="margin-bottom:6px;" />
      <input class="input" data-blk-field="headersCsv" data-blk-idx="${idx}" value="${escapeHtml((blk.headers || []).join(', '))}" placeholder="Comma-separated headers (e.g. Option, Pros, Cons)" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="rowsText" data-blk-idx="${idx}" style="min-height:64px;" placeholder="One row per line, pipe-separated: Val A | Val B">${escapeHtml((blk.rows || []).map((r) => r.join(' | ')).join('\n'))}</textarea>
    `;
  } else if (blk.type === 'resource_download') {
    fieldsHtml = `
      <input class="input" data-blk-field="title" data-blk-idx="${idx}" value="${escapeHtml(blk.title || '')}" placeholder="Resource title" style="margin-bottom:6px;" />
      <input class="input" data-blk-field="description" data-blk-idx="${idx}" value="${escapeHtml(blk.description || '')}" placeholder="Short description" style="margin-bottom:6px;" />
      <input class="input" data-blk-field="url" data-blk-idx="${idx}" value="${escapeHtml(blk.url || '')}" placeholder="https://..." />
    `;
  } else if (blk.type === 'knowledge_check') {
    fieldsHtml = `
      <input class="input" data-blk-field="prompt" data-blk-idx="${idx}" value="${escapeHtml(blk.prompt || '')}" placeholder="Inline question prompt" style="margin-bottom:6px;" />
      <textarea class="textarea" data-blk-field="optionsLines" data-blk-idx="${idx}" style="min-height:64px; margin-bottom:6px;" placeholder="Options (one per line)">${escapeHtml((blk.options || []).join('\n'))}</textarea>
      <div class="lab-grid-2">
        <input class="input" type="number" min="0" data-blk-field="correctIndex" data-blk-idx="${idx}" value="${Number(blk.correctIndex || 0)}" placeholder="Correct 0-based index" />
        <input class="input" data-blk-field="explanation" data-blk-idx="${idx}" value="${escapeHtml(blk.explanation || '')}" placeholder="Feedback explanation" />
      </div>
    `;
  } else {
    fieldsHtml = `<input class="input" data-blk-field="text" data-blk-idx="${idx}" value="${escapeHtml(blk.text || '')}" />`;
  }

  const label = BLOCK_TYPE_CATALOG.find((b) => b.type === blk.type)?.label || blk.type;
  return `
    <div class="builder-block-card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
        <strong style="font-size:12.5px; color:var(--color-navy); text-transform:uppercase;">${idx + 1}. ${escapeHtml(label)}</strong>
        <div style="display:flex; gap:4px;">
          <button type="button" class="btn btn-secondary btn-sm" data-move-blk="${idx}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>Up</button>
          <button type="button" class="btn btn-secondary btn-sm" data-move-blk="${idx}" data-dir="1" ${idx === total - 1 ? 'disabled' : ''}>Down</button>
          <button type="button" class="btn btn-danger btn-sm" data-del-blk="${idx}">Remove</button>
        </div>
      </div>
      ${fieldsHtml}
    </div>
  `;
}

export async function renderAdminContentPage({ currentPath, rerender }) {
  const [categories, skills, courses] = await Promise.all([
    listCategories(),
    listSkills({ includeDrafts: true }),
    listAllCourses({ includeDrafts: true }),
  ]);

  if (!selectedSkillId || !skills.some((s) => s.id === selectedSkillId)) {
    selectedSkillId = skills.find((s) => s.courseCount > 0)?.id || skills[0]?.id || null;
  }

  const skillCourses = courses.filter(
    (c) => c.skillId === selectedSkillId || (c.associatedSkillIds || []).includes(selectedSkillId)
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

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Course Engine &amp; Curriculum Authoring</h1>
        <p class="page-subtitle">Manage ${courses.length} courses, ${skills.length} competencies, module ordering, practical activities, JSON block lessons, and course versioning.</p>
      </div>

      <div class="segmented" role="tablist">
        <button type="button" class="segmented-btn ${activeTab === 'courses' ? 'is-active' : ''}" data-admin-tab="courses">Courses &amp; Modules</button>
        <button type="button" class="segmented-btn ${activeTab === 'lessons' ? 'is-active' : ''}" data-admin-tab="lessons">Visual Lesson Builder</button>
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
                ${renderStatusBadge(activeCourse.publicationStatus)}
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
                      Latest snapshots: ${activeCourse.versions
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
                  <p style="font-size:13px; color:var(--color-text-secondary); margin-bottom:8px;">${escapeHtml(ph.summary || '')}</p>
                  <div class="divider-list">
                    ${(ph.lessons || [])
                      .map(
                        (l) => `
                      <div class="divider-row" style="padding:6px 0;">
                        <span style="font-size:13.5px;">
                          ${escapeHtml(l.title)}
                          <span style="color:var(--color-text-muted);">(${l.estMinutes}m · ${(l.blocks || []).length} blocks · ${(l.videos || []).length} videos · ${escapeHtml(l.publicationStatus || 'published')})</span>
                        </span>
                        <div style="display:flex; gap:6px;">
                          <button type="button" class="btn btn-secondary btn-sm" data-edit-lesson-btn="${escapeHtml(l.id)}" data-phase-id="${escapeHtml(ph.id)}">Edit in Builder</button>
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
                          <strong>Practical activities:</strong> ${ph.activities.map((a) => escapeHtml(a.title)).join(' · ')}
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
                      const linked = editCourseObj?.associatedSkillIds || [selectedSkillId];
                      return linked.includes(s.id) || s.category === skills.find((x) => x.id === selectedSkillId)?.category || s.courseCount > 0;
                    })
                    .slice(0, 30)
                    .map((s) => {
                      const checked = (editCourseObj?.associatedSkillIds || [selectedSkillId]).includes(s.id);
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
                previewLesson
                  ? `
                <div class="card" style="background:var(--color-bg);">
                  <h3 style="font-size:1.05rem; margin-bottom:6px;">${escapeHtml(previewLesson.title)}</h3>
                  ${previewLesson.introduction ? `<p class="lesson-paragraph">${escapeHtml(previewLesson.introduction)}</p>` : ''}
                  ${renderLessonBlocks(previewLesson.blocks || [])}
                  ${(previewLesson.videos || []).map((v, i) => renderVideoPlayerHtml(v, i)).join('')}
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
              <option value="" ${!editingLessonId ? 'selected' : ''}>+ Create new lesson</option>
              ${phaseLessons
                .map(
                  (l, i) => `<option value="${escapeHtml(l.id)}" ${l.id === editingLessonId ? 'selected' : ''}>Edit ${i + 1}: ${escapeHtml(l.title)}</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="lab-split">
        <section class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
            <h2 class="section-heading" style="margin:0;">${editingLessonId ? `Editing Lesson: ${escapeHtml(lessonDraft.title)}` : 'Visual JSON Block Lesson Builder (No Raw HTML)'}</h2>
            ${editingLessonId ? `<button type="button" class="btn btn-ghost btn-sm" id="reset-lesson-builder-btn">New blank lesson</button>` : ''}
          </div>
          <form id="admin-lesson-form" class="form-stack">
            <div class="lab-grid-3">
              <div class="field">
                <label class="field-label" for="les-title">Lesson title</label>
                <input class="input" id="les-title" name="title" data-les-field="title" required value="${escapeHtml(lessonDraft.title)}" placeholder="e.g. Audience Exclusions &amp; Retargeting" />
              </div>
              <div class="field">
                <label class="field-label" for="les-mins">Est. minutes</label>
                <input class="input" id="les-mins" name="estMinutes" data-les-field="estMinutes" type="number" min="5" max="180" value="${Number(lessonDraft.estMinutes || 25)}" />
              </div>
              <div class="field">
                <label class="field-label" for="les-pub">Publication status</label>
                <select class="select" id="les-pub" name="publicationStatus" data-les-field="publicationStatus">
                  <option value="published" ${lessonDraft.publicationStatus === 'published' ? 'selected' : ''}>Published</option>
                  <option value="draft" ${lessonDraft.publicationStatus === 'draft' ? 'selected' : ''}>Draft</option>
                </select>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="les-intro">Lesson introduction</label>
              <textarea class="textarea" id="les-intro" name="introduction" data-les-field="introduction" style="min-height:60px;" required placeholder="Concise opening framing what the learner will understand…">${escapeHtml(lessonDraft.introduction)}</textarea>
            </div>

            <div class="field">
              <label class="field-label" for="les-obj">Learning objectives (one per line)</label>
              <textarea class="textarea" id="les-obj" name="objectives" data-les-field="objectives" style="min-height:60px;" placeholder="Define custom audiences&#10;Configure 7-day exclusion windows">${escapeHtml(lessonDraft.objectives)}</textarea>
            </div>

            <!-- Structured Content Blocks -->
            <div style="border-top:1px solid var(--color-border); padding-top:14px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                <strong style="color:var(--color-navy);">Lesson Content Blocks (${draftBlocks.length})</strong>
                <div style="display:flex; gap:8px; align-items:center;">
                  <select class="select" id="add-block-type" style="width:auto;">
                    ${BLOCK_TYPE_CATALOG.map((b) => `<option value="${b.type}">${escapeHtml(b.label)}</option>`).join('')}
                  </select>
                  <button type="button" class="btn btn-secondary btn-sm" id="add-block-btn">+ Add block</button>
                </div>
              </div>
              <div style="display:flex; flex-direction:column; gap:10px;">
                ${draftBlocks.map((b, i) => renderDraftBlockEditor(b, i, draftBlocks.length)).join('')}
              </div>
            </div>

            <!-- YouTube Video Embedder -->
            <div style="border-top:1px solid var(--color-border); padding-top:14px;">
              <strong style="color:var(--color-navy); display:block; margin-bottom:8px;">Embedded YouTube Videos (${draftVideos.length})</strong>
              ${
                draftVideos.length > 0
                  ? `
                <div class="divider-list" style="margin-bottom:10px;">
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
                </div>
              `
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
                <textarea class="textarea" id="vid-transcript" style="min-height:54px; margin-bottom:8px;" placeholder="Transcript or key study notes (shown if video is restricted)…"></textarea>
                <button type="button" class="btn btn-secondary btn-sm" id="add-video-btn">Validate &amp; attach YouTube video</button>
              </div>
            </div>

            <!-- Further Reading External Resources -->
            <div style="border-top:1px solid var(--color-border); padding-top:14px;">
              <strong style="color:var(--color-navy); display:block; margin-bottom:8px;">Supplementary Further Reading (${draftResources.length})</strong>
              ${
                draftResources.length > 0
                  ? `
                <div class="divider-list" style="margin-bottom:10px;">
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
                </div>
              `
                  : ''
              }
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <input class="input" id="res-title" placeholder="Resource title" style="flex:1; min-width:160px;" />
                <input class="input" id="res-url" placeholder="https://developer.mozilla.org/..." style="flex:1.4; min-width:200px;" />
                <button type="button" class="btn btn-secondary btn-sm" id="add-res-btn">+ Add resource</button>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="les-summary">Lesson summary</label>
              <textarea class="textarea" id="les-summary" name="summary" data-les-field="summary" style="min-height:56px;" placeholder="Recap the core lesson takeaway…">${escapeHtml(lessonDraft.summary)}</textarea>
            </div>
            <div class="field">
              <label class="field-label" for="les-takeaways">Key takeaways (one per line)</label>
              <textarea class="textarea" id="les-takeaways" name="takeaways" data-les-field="takeaways" style="min-height:54px;">${escapeHtml(lessonDraft.takeaways)}</textarea>
            </div>
            <div class="field">
              <label class="field-label" for="les-criteria">Completion criteria</label>
              <input class="input" id="les-criteria" name="completionCriteria" data-les-field="completionCriteria" value="${escapeHtml(lessonDraft.completionCriteria)}" />
            </div>

            <button type="submit" class="btn btn-primary" ${!activePhase ? 'disabled' : ''}>${editingLessonId ? 'Update Lesson' : 'Save New Lesson to Module'}</button>
          </form>
        </section>

        <aside class="card">
          <h2 style="font-size:1.05rem; margin-bottom:10px;">Live Safe Block Preview</h2>
          <p style="font-size:12.5px; color:var(--color-text-muted); margin-bottom:14px;">All JSON blocks pass through XSS-safe escaping before rendering.</p>
          <div style="border-top:1px solid var(--color-border); padding-top:14px;">
            ${renderLessonBlocks(draftBlocks)}
          </div>
        </aside>
      </div>
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
                const draftCnt = Number(s.draftCourseCount || 0);
                const courseSummary =
                  s.courseCount > 0 && draftCnt > 0
                    ? `${s.courseCount} published · ${draftCnt} draft`
                    : s.courseCount > 0
                      ? `${s.courseCount} published ${s.courseCount === 1 ? 'course' : 'courses'}`
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
    bind(root) {
      root.querySelectorAll('[data-admin-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeTab = btn.dataset.adminTab;
          rerender({ silent: true });
        });
      });

      // Courses tab handlers
      root.querySelector('#admin-course-skill')?.addEventListener('change', (e) => {
        selectedSkillId = e.target.value;
        const nextCourses = courses.filter(
          (c) => c.skillId === selectedSkillId || (c.associatedSkillIds || []).includes(selectedSkillId)
        );
        selectedCourseId = nextCourses[0]?.id || null;
        selectedPhaseId = nextCourses[0]?.phases?.[0]?.id || null;
        rerender({ silent: true });
      });

      root.querySelector('#admin-active-course')?.addEventListener('change', (e) => {
        selectedCourseId = e.target.value;
        const nextC = courses.find((c) => c.id === selectedCourseId);
        selectedPhaseId = nextC?.phases?.[0]?.id || null;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-course-form-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          courseFormMode = btn.dataset.courseFormMode;
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-set-course-status]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          try {
            await adminSetCourseStatus(activeCourse.id, btn.dataset.setCourseStatus);
            showToast(`Course status updated to ${btn.dataset.setCourseStatus}.`, 'success');
            rerender({ silent: true });
          } catch (err) {
            showToast(err?.message || 'Cannot change course status.', 'error');
          }
        });
      });

      root.querySelector('#create-course-version-btn')?.addEventListener('click', async () => {
        if (!activeCourse) return;
        const notes = root.querySelector('#version-notes-input')?.value || '';
        try {
          const ver = await adminCreateCourseVersion(activeCourse.id, notes);
          showToast(`Version v${ver?.versionNumber || Number(activeCourse.version || 1) + 1} snapshot created.`, 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err?.message || 'Unable to create version snapshot.', 'error');
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
        if (e.target.id === 'course-preview-backdrop') {
          previewCourseOpen = false;
          rerender({ silent: true });
        }
      });
      root.querySelector('#preview-lesson-select')?.addEventListener('change', (e) => {
        previewLessonId = e.target.value;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-move-phase]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          const phId = btn.dataset.movePhase;
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
            showToast(err?.message || 'Unable to reorder modules.', 'error');
          }
        });
      });

      root.querySelectorAll('[data-toggle-phase-pub]').forEach((btn) => {
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
            showToast(err?.message || 'Unable to update module status.', 'error');
          }
        });
      });

      root.querySelector('#admin-course-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const associatedSkillIds = fd.getAll('associatedSkillIds').map(String).filter(Boolean);
        const primarySkillId = associatedSkillIds[0] || editCourseObj?.skillId || selectedSkillId;
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
          showToast(err?.message || 'Unable to save course.', 'error');
        }
      });

      root.querySelector('#admin-phase-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeCourse) return;
        const fd = new FormData(e.currentTarget);
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
          showToast(err?.message || 'Unable to add module.', 'error');
        }
      });

      root.querySelector('#admin-activity-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeCourse) return;
        const fd = new FormData(e.currentTarget);
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
          showToast(err?.message || 'Unable to add practical activity.', 'error');
        }
      });

      root.querySelectorAll('[data-edit-lesson-btn]').forEach((btn) => {
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

      root.querySelectorAll('[data-del-lesson]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          try {
            await adminDeleteLesson(activeCourse.id, btn.dataset.phaseId, btn.dataset.delLesson);
            showToast('Lesson deleted.', 'info');
            rerender({ silent: true });
          } catch (err) {
            showToast(err?.message || 'Unable to delete lesson.', 'error');
          }
        });
      });

      // Lesson Builder tab handlers
      root.querySelector('#builder-course-select')?.addEventListener('change', (e) => {
        selectedCourseId = e.target.value;
        const nextC = courses.find((c) => c.id === selectedCourseId);
        selectedPhaseId = nextC?.phases?.[0]?.id || null;
        resetLessonBuilder();
        rerender({ silent: true });
      });

      root.querySelector('#builder-phase-select')?.addEventListener('change', (e) => {
        selectedPhaseId = e.target.value;
        resetLessonBuilder();
        rerender({ silent: true });
      });

      root.querySelector('#builder-lesson-select')?.addEventListener('change', (e) => {
        const lid = e.target.value;
        const found = phaseLessons.find((l) => l.id === lid) || null;
        loadLessonIntoBuilder(found);
        rerender({ silent: true });
      });

      root.querySelector('#reset-lesson-builder-btn')?.addEventListener('click', () => {
        resetLessonBuilder();
        rerender({ silent: true });
      });

      // Sync top-level lesson draft fields live on input
      root.querySelectorAll('[data-les-field]').forEach((el) => {
        el.addEventListener('input', () => {
          const f = el.dataset.lesField;
          lessonDraft[f] = f === 'estMinutes' ? Number(el.value || 25) : el.value;
        });
      });

      // Sync draft block edits live on input
      root.querySelectorAll('[data-blk-field]').forEach((el) => {
        el.addEventListener('input', () => {
          const idx = Number(el.dataset.blkIdx);
          const field = el.dataset.blkField;
          const blk = draftBlocks[idx];
          if (!blk) return;
          if (field === 'itemsLines') {
            blk.items = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
          } else if (field === 'optionsLines') {
            blk.options = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
          } else if (field === 'headersCsv') {
            blk.headers = el.value.split(',').map((s) => s.trim()).filter(Boolean);
          } else if (field === 'rowsText') {
            blk.rows = el.value
              .split('\n')
              .map((line) => line.split('|').map((cell) => cell.trim()))
              .filter((r) => r.some(Boolean));
          } else if (field === 'correctIndex') {
            blk.correctIndex = Number(el.value || 0);
          } else {
            blk[field] = el.value;
          }
        });
      });

      root.querySelector('#add-block-btn')?.addEventListener('click', () => {
        const type = root.querySelector('#add-block-type')?.value || 'paragraph';
        draftBlocks.push(createEmptyBlock(type));
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-blk]').forEach((btn) => {
        btn.addEventListener('click', () => {
          draftBlocks.splice(Number(btn.dataset.delBlk), 1);
          rerender({ silent: true });
        });
      });

      root.querySelectorAll('[data-move-blk]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.moveBlk);
          const target = idx + Number(btn.dataset.dir);
          if (target < 0 || target >= draftBlocks.length) return;
          [draftBlocks[idx], draftBlocks[target]] = [draftBlocks[target], draftBlocks[idx]];
          rerender({ silent: true });
        });
      });

      root.querySelector('#add-video-btn')?.addEventListener('click', () => {
        const url = root.querySelector('#vid-url')?.value.trim();
        const title = root.querySelector('#vid-title')?.value.trim() || 'Lesson Video';
        const duration = root.querySelector('#vid-duration')?.value.trim() || '';
        const viewingInstructions = root.querySelector('#vid-guide')?.value.trim() || '';
        const transcript = root.querySelector('#vid-transcript')?.value.trim() || '';

        const res = normalizeVideoEntry({
          provider: 'youtube',
          url,
          title,
          duration,
          viewingInstructions,
          transcript,
        });
        if (!res.valid) {
          showToast(res.error, 'error');
          return;
        }
        draftVideos.push(res.video);
        showToast('YouTube video validated and attached.', 'success');
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-video]').forEach((btn) => {
        btn.addEventListener('click', () => {
          draftVideos.splice(Number(btn.dataset.delVideo), 1);
          rerender({ silent: true });
        });
      });

      root.querySelector('#add-res-btn')?.addEventListener('click', () => {
        const title = root.querySelector('#res-title')?.value.trim();
        const url = root.querySelector('#res-url')?.value.trim();
        if (!title || !url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
          showToast('Enter both a resource title and a valid https:// URL.', 'error');
          return;
        }
        draftResources.push({ title, url, resourceType: 'article' });
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-res]').forEach((btn) => {
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
        const fd = new FormData(e.currentTarget);
        try {
          await adminUpsertLesson({
            id: editingLessonId || undefined,
            courseId: activeCourse.id,
            phaseId: activePhase.id,
            title: String(fd.get('title')),
            introduction: String(fd.get('introduction')),
            objectives: String(fd.get('objectives') || ''),
            estMinutes: Number(fd.get('estMinutes') || 25),
            blocks: structuredClone(draftBlocks),
            videos: structuredClone(draftVideos),
            furtherReading: structuredClone(draftResources),
            summary: String(fd.get('summary') || ''),
            takeaways: String(fd.get('takeaways') || ''),
            completionCriteria: String(fd.get('completionCriteria') || ''),
            publicationStatus: String(fd.get('publicationStatus') || 'published'),
          });
          showToast(editingLessonId ? 'Lesson updated!' : 'New lesson saved to module!', 'success');
          resetLessonBuilder();
          rerender({ silent: true });
        } catch (err) {
          showToast(err?.message || 'Unable to save lesson.', 'error');
        }
      });

      // Catalog tab handlers
      root.querySelector('#admin-cat-filter')?.addEventListener('change', (e) => {
        catalogCategoryFilter = e.target.value;
        rerender({ silent: true });
      });

      root.querySelector('#admin-course-status-filter')?.addEventListener('change', (e) => {
        catalogCourseStatusFilter = e.target.value;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-edit-skill]').forEach((btn) => {
        btn.addEventListener('click', () => {
          editingSkillId = btn.dataset.editSkill;
          rerender({ silent: true });
        });
      });

      root.querySelector('#cancel-edit-skill')?.addEventListener('click', () => {
        editingSkillId = null;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-add-course-skill]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedSkillId = btn.dataset.addCourseSkill;
          const nextCourses = courses.filter(
            (c) => c.skillId === selectedSkillId || (c.associatedSkillIds || []).includes(selectedSkillId)
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
        const fd = new FormData(e.currentTarget);
        try {
          await adminUpsertCategory({
            name: String(fd.get('name')),
            description: String(fd.get('description')),
          });
          showToast('Category created dynamically!', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err?.message || 'Unable to create category.', 'error');
        }
      });

      root.querySelector('#admin-skill-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
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
          showToast(err?.message || 'Unable to save skill.', 'error');
        }
      });

      root.querySelectorAll('[data-toggle-skill-pub]').forEach((btn) => {
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
            showToast(err?.message || 'Unable to update skill status.', 'error');
          }
        });
      });
    },
  };
}
