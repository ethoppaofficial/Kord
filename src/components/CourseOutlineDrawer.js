import { escapeHtml } from '../lib/formatters.js';
import { icon } from '../lib/icons.js';
import { renderProgressRail, renderStatusBadge } from './Common.js';

/**
 * Renders top breadcrumb bar with optional collapsible Course Outline Drawer trigger.
 * @param {{ items?: Array<{ label: string; href?: string | null }>; showOutlineToggle?: boolean }} params
 */
export function renderCourseBreadcrumbs({ items = [], showOutlineToggle = true }) {
  return `
    <div class="course-nav-bar">
      <nav class="breadcrumb-trail" aria-label="Course navigation breadcrumbs">
        ${items
          .map((item, idx) => {
            const isLast = idx === items.length - 1;
            const sep = idx > 0 ? `<span class="breadcrumb-sep" aria-hidden="true">/</span>` : '';
            if (isLast || !item.href) {
              return `${sep}<span class="breadcrumb-current">${escapeHtml(item.label)}</span>`;
            }
            return `${sep}<a href="${escapeHtml(item.href)}" data-link class="breadcrumb-link">${escapeHtml(item.label)}</a>`;
          })
          .join('')}
      </nav>
      ${
        showOutlineToggle
          ? `<button type="button" class="btn btn-secondary btn-sm" id="open-course-outline-btn" aria-expanded="false" aria-controls="course-outline-drawer">
              ${icon('book', 14)} Course outline
            </button>`
          : ''
      }
    </div>
  `;
}

/**
 * Renders the collapsible Course Outline Drawer listing ordered phases and lessons
 * without dumping lesson body content.
 * @param {{
 *   course: import('../types/kord.d.ts').Course;
 *   orderedPhases?: import('../types/kord.d.ts').Phase[];
 *   phaseProgressById?: Record<string, import('../types/kord.d.ts').PhaseProgressSummary>;
 *   progressByLesson?: Map<string | undefined, import('../types/kord.d.ts').LessonProgressEntry>;
 *   assessments?: import('../types/kord.d.ts').Quiz[];
 *   challenges?: import('../types/kord.d.ts').Challenge[];
 *   activePhaseId?: string | null;
 *   activeLessonId?: string | null;
 *   courseProgress?: import('../types/kord.d.ts').CourseProgressSummary | null;
 * }} params
 */
export function renderCourseOutlineDrawer({
  course,
  orderedPhases = [],
  phaseProgressById = {},
  progressByLesson = new Map(),
  assessments = [],
  challenges = [],
  activePhaseId = null,
  activeLessonId = null,
  courseProgress = null,
}) {
  return `
    <div class="drawer-backdrop" id="course-outline-backdrop" hidden>
      <aside class="drawer-panel" id="course-outline-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-course-title">
        <div class="drawer-header">
          <div>
            <div style="font-size:11.5px; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.04em;">Course Outline</div>
            <h2 id="drawer-course-title" style="font-size:1.05rem; color:var(--color-navy); margin-top:2px;">${escapeHtml(course.title)}</h2>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="close-course-outline-btn" aria-label="Close course outline">✕</button>
        </div>

        <div style="padding:12px 18px; border-bottom:1px solid var(--color-border); background:var(--color-bg);">
          ${renderProgressRail({
            label: `${courseProgress?.completedPhasesCount || 0}/${orderedPhases.length} phases · ${courseProgress?.completedLessonsCount || 0}/${courseProgress?.requiredLessonsCount || 0} lessons`,
            value: courseProgress?.progressPercent || 0,
            max: 100,
            detail: `${courseProgress?.progressPercent || 0}%`,
          })}
          <div style="margin-top:10px;">
            <a href="/courses/${escapeHtml(course.slug)}" data-link class="btn btn-secondary btn-sm" style="width:100%;">Course Details Overview</a>
          </div>
        </div>

        <div class="drawer-body">
          ${orderedPhases
            .map((phase) => {
              const pp = phaseProgressById[phase.id];
              const isPhaseActive = phase.id === activePhaseId;
              const phaseUrl = `/courses/${course.slug}/phases/${phase.id}`;
              return `
                <div class="drawer-phase-group ${isPhaseActive ? 'is-active-phase' : ''}">
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
                    <a href="${escapeHtml(phaseUrl)}" data-link style="font-size:13.5px; font-weight:700; color:${isPhaseActive ? 'var(--color-blue)' : 'var(--color-navy)'}; text-decoration:none;">
                      Phase ${phase.position}: ${escapeHtml(phase.title)}
                    </a>
                    ${pp?.isCompleted ? renderStatusBadge('completed') : `<span class="mono-num" style="font-size:11.5px; color:var(--color-text-muted);">${pp?.completedLessonsCount || 0}/${pp?.requiredLessonsCount || 0}</span>`}
                  </div>

                  <div style="display:flex; flex-direction:column; gap:4px;">
                    ${(phase.lessons || [])
                      .map((les, lIdx) => {
                        const lp = progressByLesson.get(les.id);
                        const isLesActive = les.id === activeLessonId;
                        const lesUrl = `/courses/${course.slug}/phases/${phase.id}/lessons/${les.id}`;
                        return `
                          <a href="${escapeHtml(lesUrl)}" data-link class="drawer-lesson-link ${isLesActive ? 'is-current' : ''}">
                            <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                              <span class="mono-num" style="color:var(--color-text-muted);">${phase.position}.${lIdx + 1}</span>
                              ${escapeHtml(les.title)}
                            </span>
                            <span style="flex-shrink:0; font-size:11.5px; font-weight:600; color:${lp?.completed ? 'var(--color-green)' : isLesActive ? 'var(--color-blue)' : 'var(--color-text-muted)'};">
                              ${lp?.completed ? 'Done' : isLesActive ? 'Reading' : `${les.estMinutes}m`}
                            </span>
                          </a>
                        `;
                      })
                      .join('')}
                  </div>
                </div>
              `;
            })
            .join('')}

          ${
            assessments.length > 0 || challenges.length > 0
              ? `
            <div class="drawer-phase-group">
              <div style="font-size:12.5px; font-weight:700; color:var(--color-navy); margin-bottom:8px;">Assessments &amp; Capstone</div>
              <div style="display:flex; flex-direction:column; gap:4px;">
                ${assessments
                  .map(
                    (q) => `
                  <a href="/courses/${escapeHtml(course.slug)}/assessments/${escapeHtml(q.id)}" data-link class="drawer-lesson-link">
                    <span>${escapeHtml(q.title)}</span>
                    <span style="font-size:11px; color:var(--color-blue);">Assessment</span>
                  </a>
                `
                  )
                  .join('')}
                ${challenges
                  .map(
                    (c) => `
                  <a href="/courses/${escapeHtml(course.slug)}/challenges/${escapeHtml(c.id)}" data-link class="drawer-lesson-link">
                    <span>${escapeHtml(c.title)}</span>
                    <span style="font-size:11px; color:var(--color-navy);">Challenge</span>
                  </a>
                `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>
      </aside>
    </div>
  `;
}

/** @param {HTMLElement} root */
export function bindCourseOutlineDrawer(root) {
  const openBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#open-course-outline-btn'));
  const backdrop = /** @type {HTMLElement | null} */ (root.querySelector('#course-outline-backdrop'));
  const closeBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#close-course-outline-btn'));

  if (!openBtn || !backdrop) return;

  /** @param {boolean} isOpen */
  const setOpen = (isOpen) => {
    backdrop.hidden = !isOpen;
    openBtn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      closeBtn?.focus();
    }
  };

  openBtn.addEventListener('click', () => setOpen(true));
  closeBtn?.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) setOpen(false);
  });

  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (!document.body.contains(backdrop)) {
      document.removeEventListener('keydown', onKeyDown);
      return;
    }
    if (e.key === 'Escape' && !backdrop.hidden) {
      setOpen(false);
      openBtn.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // Clean up when elements detach on route change
  backdrop.querySelectorAll('a[data-link]').forEach((a) => {
    a.addEventListener('click', () => setOpen(false));
  });
}
