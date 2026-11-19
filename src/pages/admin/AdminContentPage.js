import {
  listCategories,
  listSkills,
  listAllCourses,
  adminUpsertCategory,
  adminUpsertSkill,
  adminUpsertCourse,
  adminUpsertPhase,
  adminUpsertLesson,
  adminDeleteLesson,
} from '../../lib/repositories/contentRepository.js';
import { DIFFICULTY_LEVELS } from '../../lib/constants.js';
import { BLOCK_TYPE_CATALOG, createEmptyBlock, renderLessonBlocks } from '../../lib/lessonBlocks.js';
import { normalizeVideoEntry } from '../../lib/videoProvider.js';
import { escapeHtml } from '../../lib/formatters.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { renderStatusBadge } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let activeTab = 'courses'; // 'catalog' | 'courses' | 'lessons'
let selectedSkillId = null;
let selectedCourseId = null;
let selectedPhaseId = null;
let catalogCategoryFilter = 'All';

// Draft state for visual JSON block lesson builder
let draftBlocks = [
  { id: 'blk-init-1', type: 'heading', text: 'Core Concept Overview' },
  { id: 'blk-init-2', type: 'paragraph', text: 'Explain the foundational principle clearly here.' },
];
let draftVideos = [];

function renderDraftBlockEditor(blk, idx, total) {
  let fieldsHtml = '';
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

  const skillCourses = courses.filter((c) => c.skillId === selectedSkillId);
  if (!selectedCourseId || !courses.some((c) => c.id === selectedCourseId)) {
    selectedCourseId = skillCourses[0]?.id || courses[0]?.id || null;
  }
  const activeCourse = courses.find((c) => c.id === selectedCourseId) || null;
  const phases = activeCourse?.phases || [];
  if (!selectedPhaseId || !phases.some((p) => p.id === selectedPhaseId)) {
    selectedPhaseId = phases[0]?.id || null;
  }
  const activePhase = phases.find((p) => p.id === selectedPhaseId) || null;

  const filteredCatalogSkills =
    catalogCategoryFilter === 'All'
      ? skills
      : skills.filter((s) => s.category === catalogCategoryFilter);

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Course Engine &amp; Curriculum Authoring</h1>
        <p class="page-subtitle">Manage categories, ${skills.length} catalog skills, multi-course pathways, structured JSON lessons, and YouTube embeds.</p>
      </div>

      <div class="segmented" role="tablist">
        <button type="button" class="segmented-btn ${activeTab === 'courses' ? 'is-active' : ''}" data-admin-tab="courses">Courses &amp; Phases</button>
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
            <label class="field-label" for="admin-course-skill">Select Parent Skill</label>
            <select class="select" id="admin-course-skill">
              ${skills
                .map(
                  (s) => `<option value="${escapeHtml(s.id)}" ${s.id === selectedSkillId ? 'selected' : ''}>${escapeHtml(s.title)} (${escapeHtml(s.category)} · ${s.courseCount} courses)</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="admin-active-course">Select Course under Skill</label>
            <select class="select" id="admin-active-course">
              ${
                skillCourses.length > 0
                  ? skillCourses
                      .map(
                        (c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedCourseId ? 'selected' : ''}>${escapeHtml(c.title)} (${escapeHtml(c.difficulty)} · ${c.publicationStatus})</option>`
                      )
                      .join('')
                  : '<option value="">No courses for this skill yet — create one on the right</option>'
              }
            </select>
          </div>
        </div>
      </div>

      <div class="lab-split">
        <section class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
            <div>
              <h2 class="section-heading" style="margin:0;">${activeCourse ? escapeHtml(activeCourse.title) : 'No course selected'}</h2>
              ${
                activeCourse
                  ? `<div class="meta-line" style="margin-top:4px;">
                      <span>${escapeHtml(activeCourse.difficulty)}</span>
                      <span class="meta-sep">·</span>
                      <span class="mono-num">${activeCourse.estimatedDurationWeeks} weeks (${activeCourse.recommendedWeeklyHours}h/wk)</span>
                      <span class="meta-sep">·</span>
                      <span>${phases.length} phases</span>
                    </div>`
                  : ''
              }
            </div>
            ${activeCourse ? renderStatusBadge(activeCourse.publicationStatus) : ''}
          </div>

          ${
            phases.length > 0
              ? `
            <div style="display:flex; flex-direction:column; gap:14px;">
              ${phases
                .map(
                  (ph) => `
                <div style="padding:14px; border:1px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg);">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
                    <strong style="color:var(--color-navy);">Phase ${ph.position}: ${escapeHtml(ph.title)}</strong>
                    <span class="mono-num" style="font-size:12px; color:var(--color-text-muted);">${(ph.lessons || []).length} lessons</span>
                  </div>
                  <p style="font-size:13px; color:var(--color-text-secondary); margin-bottom:8px;">${escapeHtml(ph.summary || '')}</p>
                  <div class="divider-list">
                    ${(ph.lessons || [])
                      .map(
                        (l) => `
                      <div class="divider-row" style="padding:6px 0;">
                        <span style="font-size:13.5px;">${escapeHtml(l.title)} <span style="color:var(--color-text-muted);">(${l.estMinutes}m · ${(l.blocks || []).length} blocks · ${(l.videos || []).length} videos)</span></span>
                        <button type="button" class="btn btn-danger btn-sm" data-del-lesson="${escapeHtml(l.id)}" data-phase-id="${escapeHtml(ph.id)}">Delete</button>
                      </div>
                    `
                      )
                      .join('')}
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          `
              : '<p style="font-size:14px; color:var(--color-text-muted);">Select or create a course, then add variable learning phases and lessons.</p>'
          }
        </section>

        <aside style="display:flex; flex-direction:column; gap:18px;">
          <div class="card-workspace">
            <h2 style="font-size:1.05rem; margin-bottom:10px;">Create New Course Under Skill</h2>
            <form id="admin-course-form" class="form-stack">
              <div class="field">
                <label class="field-label" for="c-title">Course title</label>
                <input class="input" id="c-title" name="title" required placeholder="e.g. Meta Ads Intermediate Retargeting" />
              </div>
              <div class="field">
                <label class="field-label" for="c-desc">Description</label>
                <textarea class="textarea" id="c-desc" name="description" style="min-height:68px;" required placeholder="What learners achieve in this course…"></textarea>
              </div>
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="c-diff">Difficulty</label>
                  <select class="select" id="c-diff" name="difficulty">
                    ${DIFFICULTY_LEVELS.map((d) => `<option value="${d}">${d}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="c-pub">Status</label>
                  <select class="select" id="c-pub" name="publicationStatus">
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="c-weeks">Duration (weeks)</label>
                  <input class="input" id="c-weeks" name="estimatedDurationWeeks" type="number" min="1" max="52" value="4" />
                </div>
                <div class="field">
                  <label class="field-label" for="c-hrs">Weekly hours</label>
                  <input class="input" id="c-hrs" name="recommendedWeeklyHours" type="number" min="1" max="40" value="4" />
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="c-outcomes">Outcomes (one per line)</label>
                <textarea class="textarea" id="c-outcomes" name="outcomes" style="min-height:60px;" placeholder="Build retargeting audiences&#10;Measure weekly ROAS"></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-sm">Create course</button>
            </form>
          </div>

          ${
            activeCourse
              ? `
            <div class="card">
              <h2 style="font-size:1.05rem; margin-bottom:10px;">Add Phase to ${escapeHtml(activeCourse.title)}</h2>
              <form id="admin-phase-form" class="form-stack">
                <div class="field">
                  <label class="field-label" for="ph-title">Phase title</label>
                  <input class="input" id="ph-title" name="title" required placeholder="e.g. Phase 4: Budget Scaling" />
                </div>
                <div class="field">
                  <label class="field-label" for="ph-summary">Phase summary</label>
                  <input class="input" id="ph-summary" name="summary" required placeholder="Key scope of this phase" />
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
                <button type="submit" class="btn btn-secondary btn-sm">Add phase</button>
              </form>
            </div>
          `
              : ''
          }
        </aside>
      </div>
    `
        : activeTab === 'lessons'
          ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="lab-grid-2">
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
            <label class="field-label" for="builder-phase-select">Target Phase</label>
            <select class="select" id="builder-phase-select">
              ${phases
                .map(
                  (p) => `<option value="${escapeHtml(p.id)}" ${p.id === selectedPhaseId ? 'selected' : ''}>Phase ${p.position}: ${escapeHtml(p.title)}</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="lab-split">
        <section class="card">
          <h2 class="section-heading">Visual JSON Block Lesson Builder (No Raw HTML)</h2>
          <form id="admin-lesson-form" class="form-stack">
            <div class="lab-grid-2">
              <div class="field">
                <label class="field-label" for="les-title">Lesson title</label>
                <input class="input" id="les-title" name="title" required placeholder="e.g. Audience Exclusions &amp; Retargeting" />
              </div>
              <div class="field">
                <label class="field-label" for="les-mins">Est. minutes</label>
                <input class="input" id="les-mins" name="estMinutes" type="number" min="5" max="180" value="25" />
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="les-intro">Lesson introduction</label>
              <textarea class="textarea" id="les-intro" name="introduction" style="min-height:60px;" required placeholder="Concise opening framing what the learner will understand…"></textarea>
            </div>

            <div class="field">
              <label class="field-label" for="les-obj">Learning objectives (one per line)</label>
              <textarea class="textarea" id="les-obj" name="objectives" style="min-height:60px;" placeholder="Define custom audiences&#10;Configure 7-day exclusion windows"></textarea>
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

            <div class="field">
              <label class="field-label" for="les-summary">Summary &amp; key takeaways</label>
              <textarea class="textarea" id="les-summary" name="summary" style="min-height:56px;" placeholder="Recap the core lesson takeaway…"></textarea>
            </div>

            <button type="submit" class="btn btn-primary" ${!activePhase ? 'disabled' : ''}>Save Lesson to Phase</button>
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
            <select class="select" id="admin-cat-filter" style="width:auto;">
              <option value="All">All categories (${categories.length})</option>
              ${categories.map((c) => `<option value="${escapeHtml(c.name)}" ${catalogCategoryFilter === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="divider-list">
            ${filteredCatalogSkills
              .map(
                (s) => `
              <div class="divider-row" style="align-items:flex-start;">
                <div>
                  <div style="font-weight:700; color:var(--color-navy);">${escapeHtml(s.title)}</div>
                  <div class="meta-line" style="margin-top:2px;">
                    <span>${escapeHtml(s.category)}</span>
                    <span class="meta-sep">·</span>
                    <span>${escapeHtml(s.level)}</span>
                    <span class="meta-sep">·</span>
                    <span class="mono-num">${s.courseCount} courses</span>
                  </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                  ${renderStatusBadge(s.publicationStatus || 'published')}
                  <button type="button" class="btn btn-secondary btn-sm" data-toggle-skill-pub="${escapeHtml(s.id)}">
                    ${s.publicationStatus === 'draft' ? 'Publish' : 'Set Draft'}
                  </button>
                </div>
              </div>
            `
              )
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
            <h2 style="font-size:1.05rem; margin-bottom:10px;">Add New Skill to Category</h2>
            <form id="admin-skill-form" class="form-stack">
              <div class="field">
                <label class="field-label" for="skill-title">Skill title</label>
                <input class="input" id="skill-title" name="title" required placeholder="e.g. Email Lifecycle Strategy" />
              </div>
              <div class="lab-grid-2">
                <div class="field">
                  <label class="field-label" for="skill-cat">Category</label>
                  <select class="select" id="skill-cat" name="categoryId">
                    ${categories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="skill-level">Level</label>
                  <select class="select" id="skill-level" name="level">
                    ${DIFFICULTY_LEVELS.map((d) => `<option value="${d}">${d}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="skill-summary">Competency summary</label>
                <textarea class="textarea" id="skill-summary" name="summary" style="min-height:70px;" required placeholder="What learners master in this skill…"></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-sm">Create skill</button>
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
        const nextCourses = courses.filter((c) => c.skillId === selectedSkillId);
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

      root.querySelector('#admin-course-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await adminUpsertCourse({
            skillId: selectedSkillId,
            title: String(fd.get('title')),
            description: String(fd.get('description')),
            difficulty: String(fd.get('difficulty')),
            publicationStatus: String(fd.get('publicationStatus')),
            estimatedDurationWeeks: Number(fd.get('estimatedDurationWeeks') || 4),
            recommendedWeeklyHours: Number(fd.get('recommendedWeeklyHours') || 4),
            outcomes: String(fd.get('outcomes') || ''),
          });
          showToast('Course created under selected skill.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err?.message || 'Unable to create course.', 'error');
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
            difficulty: String(fd.get('difficulty')),
            estHours: Number(fd.get('estHours') || 3),
          });
          showToast('Phase added to course.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err?.message || 'Unable to add phase.', 'error');
        }
      });

      root.querySelectorAll('[data-del-lesson]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!activeCourse) return;
          await adminDeleteLesson(activeCourse.id, btn.dataset.phaseId, btn.dataset.delLesson);
          showToast('Lesson deleted.', 'info');
          rerender({ silent: true });
        });
      });

      // Lesson Builder tab handlers
      root.querySelector('#builder-course-select')?.addEventListener('change', (e) => {
        selectedCourseId = e.target.value;
        const nextC = courses.find((c) => c.id === selectedCourseId);
        selectedPhaseId = nextC?.phases?.[0]?.id || null;
        rerender({ silent: true });
      });

      root.querySelector('#builder-phase-select')?.addEventListener('change', (e) => {
        selectedPhaseId = e.target.value;
        rerender({ silent: true });
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

      root.querySelector('#admin-lesson-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!activeCourse || !activePhase) {
          showToast('Select a valid course and phase first.', 'error');
          return;
        }
        const fd = new FormData(e.currentTarget);
        try {
          await adminUpsertLesson({
            courseId: activeCourse.id,
            phaseId: activePhase.id,
            title: String(fd.get('title')),
            introduction: String(fd.get('introduction')),
            objectives: String(fd.get('objectives') || ''),
            estMinutes: Number(fd.get('estMinutes') || 25),
            blocks: structuredClone(draftBlocks),
            videos: structuredClone(draftVideos),
            summary: String(fd.get('summary') || ''),
            takeaways: [],
          });
          draftBlocks = [createEmptyBlock('heading'), createEmptyBlock('paragraph')];
          draftVideos = [];
          showToast('Self-contained lesson saved to phase!', 'success');
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
            title: String(fd.get('title')),
            categoryId: String(fd.get('categoryId')),
            level: String(fd.get('level')),
            summary: String(fd.get('summary')),
            publicationStatus: 'published',
          });
          showToast('Skill created under selected category.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err?.message || 'Unable to create skill.', 'error');
        }
      });

      root.querySelectorAll('[data-toggle-skill-pub]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const skill = skills.find((s) => s.id === btn.dataset.toggleSkillPub);
          if (!skill) return;
          await adminUpsertSkill({
            ...skill,
            publicationStatus: skill.publicationStatus === 'draft' ? 'published' : 'draft',
          });
          showToast(`Updated ${skill.title} status.`, 'success');
          rerender({ silent: true });
        });
      });
    },
  };
}
