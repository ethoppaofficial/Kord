import { getCourseBySlug } from '../../lib/repositories/contentRepository.js';
import {
  getCourseEnrollments,
  enrollInCourse,
  setCourseEnrollmentStatus,
  getLessonProgress,
  saveLessonNotes,
  toggleLessonComplete,
} from '../../lib/repositories/progressRepository.js';
import { getQuizAttempts } from '../../lib/repositories/quizRepository.js';
import { getUserSubmissions } from '../../lib/repositories/submissionRepository.js';
import { computeCourseProgress } from '../../lib/progressionEngine.js';
import { renderLessonBlocks } from '../../lib/lessonBlocks.js';
import { renderVideoPlayerHtml } from '../../lib/videoProvider.js';
import { escapeHtml, formatDate, formatMinutes } from '../../lib/formatters.js';
import { icon } from '../../lib/icons.js';
import { renderProgressRail, renderStatusBadge, renderErrorState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let selectedLessonByCourseSlug = {};

export async function renderCourseWorkspacePage({ params, session, rerender }) {
  const course = await getCourseBySlug(params.slug);
  if (!course) {
    return {
      html: renderErrorState({
        title: 'Course not found',
        message: 'We could not find a course matching that slug.',
      }) + `<div style="text-align:center; margin-top:16px;"><a href="/explore" data-link class="btn btn-primary btn-sm">Explore skills &amp; courses</a></div>`,
      bind() {},
    };
  }

  const userId = session.user.id;
  const [enrollments, lessonProgress, submissions] = await Promise.all([
    getCourseEnrollments(userId),
    getLessonProgress(userId, course.id),
    getUserSubmissions(userId),
  ]);

  let enrollment = enrollments.find((e) => e.courseId === course.id);
  if (!enrollment) {
    await enrollInCourse(userId, course.id);
    enrollment = { status: 'active', enrolledAt: new Date().toISOString() };
  }

  const assessments = course.assessments || [];
  const challenges = course.challenges || [];
  const attemptsNested = await Promise.all(assessments.map((q) => getQuizAttempts(userId, q.id)));
  const quizAttempts = attemptsNested.flat();

  const prog = computeCourseProgress({
    course,
    lessonProgress,
    assessments,
    quizAttempts,
    challenges,
    submissions,
    enrollment,
  });

  const progressByLesson = new Map(lessonProgress.map((lp) => [lp.lessonId, lp]));
  const allLessons = (course.phases || []).flatMap((p) =>
    (p.lessons || []).map((l) => ({ ...l, phaseTitle: p.title, phasePosition: p.position }))
  );

  const activeLessonId =
    selectedLessonByCourseSlug[course.slug] &&
    allLessons.some((l) => l.id === selectedLessonByCourseSlug[course.slug])
      ? selectedLessonByCourseSlug[course.slug]
      : allLessons[0]?.id || null;

  const activeIdx = allLessons.findIndex((l) => l.id === activeLessonId);
  const activeLesson = activeIdx >= 0 ? allLessons[activeIdx] : null;
  const nextLesson = activeIdx >= 0 && activeIdx + 1 < allLessons.length ? allLessons[activeIdx + 1] : null;
  const activeLp = activeLesson ? progressByLesson.get(activeLesson.id) : null;
  const wordCount = (activeLp?.notes || '').trim().split(/\s+/).filter(Boolean).length;

  const backHref = course.skill?.slug ? `/skills/${course.skill.slug}` : '/explore';

  return {
    html: `
      <div style="margin-bottom:14px;">
        <a href="${escapeHtml(backHref)}" data-link style="font-size:14px; font-weight:500;">← Back to ${escapeHtml(course.skill?.title || 'Skill hub')}</a>
      </div>

      <div class="page-header">
        <div>
          <div class="meta-line" style="margin-bottom:4px;">
            <span>${escapeHtml(course.skill?.title || 'Skill Course')}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span>${escapeHtml(course.difficulty)}</span>
            <span class="meta-sep" aria-hidden="true">·</span>
            <span class="mono-num">${course.estimatedDurationWeeks} weeks (${course.recommendedWeeklyHours}h/wk)</span>
          </div>
          <h1 class="page-title">${escapeHtml(course.title)}</h1>
          <p class="page-subtitle">${escapeHtml(course.description)}</p>
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          ${prog.isCompleted ? renderStatusBadge('completed') : renderStatusBadge(enrollment.status)}
          ${
            !prog.isCompleted
              ? `<button type="button" class="btn btn-secondary btn-sm" id="course-pause-btn">
                  ${enrollment.status === 'paused' ? 'Resume course' : 'Pause course'}
                </button>`
              : ''
          }
          ${
            challenges[0]
              ? `<a href="/challenge/${escapeHtml(challenges[0].id)}" data-link class="btn btn-primary btn-sm">Practical challenge</a>`
              : ''
          }
        </div>
      </div>

      <!-- Course Progress & Time Summary -->
      <section class="card" style="margin-bottom:24px; display:flex; flex-direction:column; gap:14px;">
        ${renderProgressRail({
          id: 'course-progress-rail',
          label: 'Earned course completion (calendar time does not auto-complete)',
          value: prog.progressPercent,
          max: 100,
          detail: `${prog.progressPercent}%`,
        })}
        <div class="kpi-strip">
          <div class="kpi-box" style="padding:12px 14px;">
            <div class="kpi-label">Lessons completed</div>
            <div class="kpi-value mono-num" style="font-size:1.25rem;">${prog.completedLessonsCount}/${prog.requiredLessonsCount}</div>
          </div>
          <div class="kpi-box" style="padding:12px 14px;">
            <div class="kpi-label">Assessments passed</div>
            <div class="kpi-value mono-num" style="font-size:1.25rem;">${prog.passedAssessmentsCount}/${prog.assessmentsCount}</div>
          </div>
          <div class="kpi-box" style="padding:12px 14px;">
            <div class="kpi-label">Practical challenges</div>
            <div class="kpi-value mono-num" style="font-size:1.25rem;">${prog.approvedChallengesCount}/${prog.challengesCount}</div>
          </div>
          <div class="kpi-box" style="padding:12px 14px;">
            <div class="kpi-label">Pace &amp; projection</div>
            <div class="kpi-value" style="font-size:1rem; margin-top:8px;">
              ${prog.isCompleted ? 'Completed' : `Est. ${formatDate(prog.projectedCompletionAt)}`}
            </div>
            <div class="kpi-meta">${formatMinutes(prog.actualMinutesSpent)} logged</div>
          </div>
        </div>
      </section>

      <div class="lab-split">
        <!-- LEFT / MAIN: Self-Contained Lesson Reader + Embedded Videos -->
        <div style="display:flex; flex-direction:column; gap:18px;">
          ${
            activeLesson
              ? `
            <article class="card pop-in">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; padding-bottom:14px; border-bottom:1px solid var(--color-border); margin-bottom:16px;">
                <div>
                  <div class="meta-line" style="margin-bottom:4px;">
                    <span>Phase ${activeLesson.phasePosition}: ${escapeHtml(activeLesson.phaseTitle)}</span>
                    <span class="meta-sep" aria-hidden="true">·</span>
                    <span class="mono-num">${activeLesson.estMinutes} min</span>
                    <span class="meta-sep" aria-hidden="true">·</span>
                    <span>${activeLesson.isRequired === false ? 'Optional' : 'Required'}</span>
                  </div>
                  <h2 style="font-size:1.35rem;">${escapeHtml(activeLesson.title)}</h2>
                </div>
                ${activeLp?.completed ? renderStatusBadge('completed') : ''}
              </div>

              ${
                activeLesson.introduction
                  ? `<p class="lesson-paragraph" style="font-size:15px; color:var(--color-navy); font-weight:500;">${escapeHtml(activeLesson.introduction)}</p>`
                  : ''
              }

              ${
                activeLesson.objectives?.length
                  ? `
                <div class="card-workspace" style="padding:14px 16px; margin-bottom:18px;">
                  <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--color-blue); margin-bottom:6px;">Learning objectives</div>
                  <ul style="margin:0; padding-left:18px; font-size:14px; color:var(--color-navy); display:flex; flex-direction:column; gap:4px;">
                    ${activeLesson.objectives.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}
                  </ul>
                </div>
              `
                  : ''
              }

              <!-- Structured JSON Lesson Blocks -->
              <div class="lesson-body">
                ${renderLessonBlocks(activeLesson.blocks || [])}
              </div>

              <!-- Embedded Provider Videos -->
              ${
                (activeLesson.videos || []).length > 0
                  ? `
                <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--color-border);">
                  <h3 style="font-size:1.05rem; margin-bottom:12px;">Video walkthrough</h3>
                  ${activeLesson.videos.map((v, idx) => renderVideoPlayerHtml(v, idx)).join('')}
                </div>
              `
                  : ''
              }

              <!-- Summary & Takeaways -->
              ${
                activeLesson.summary || activeLesson.takeaways?.length
                  ? `
                <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--color-border);">
                  ${activeLesson.summary ? `<h3 style="font-size:1rem; margin-bottom:6px;">Lesson summary</h3><p class="lesson-paragraph">${escapeHtml(activeLesson.summary)}</p>` : ''}
                  ${
                    activeLesson.takeaways?.length
                      ? `
                    <div style="font-size:13.5px; font-weight:700; color:var(--color-navy); margin-bottom:6px;">Key takeaways</div>
                    <ul class="lesson-bullets">
                      ${activeLesson.takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
                    </ul>
                  `
                      : ''
                  }
                </div>
              `
                  : ''
              }

              ${
                activeLesson.furtherReading?.length
                  ? `
                <div style="margin-top:16px; padding-top:14px; border-top:1px solid var(--color-border);">
                  <div style="font-size:13px; font-weight:700; color:var(--color-navy); margin-bottom:8px;">Further reading</div>
                  <div style="display:flex; flex-direction:column; gap:6px;">
                    ${activeLesson.furtherReading
                      .map(
                        (fr) => `<a href="${escapeHtml(fr.url)}" target="_blank" rel="noopener noreferrer" style="font-size:13.5px;">${escapeHtml(fr.title)} ${icon('externalLink', 12)}</a>`
                      )
                      .join('')}
                  </div>
                </div>
              `
                  : ''
              }

              <!-- Learner Notes & Completion Bar -->
              <div style="margin-top:20px; padding-top:18px; border-top:1px solid var(--color-border);">
                <div class="field" style="margin-bottom:14px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <label class="field-label" for="lesson-notes">Your study notes (autosaved)</label>
                    <span id="notes-save-status" style="font-size:12px; color:var(--color-text-muted);">
                      ${wordCount} words · ${activeLp?.notes ? 'Saved' : 'Ready'}
                    </span>
                  </div>
                  <textarea class="textarea" id="lesson-notes" style="min-height:90px;" placeholder="Summarize key concepts or draft your action plan from this lesson…">${escapeHtml(activeLp?.notes || '')}</textarea>
                </div>

                <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
                  <button type="button" class="btn ${activeLp?.completed ? 'btn-secondary' : 'btn-primary'}" id="toggle-lesson-complete">
                    ${activeLp?.completed ? 'Mark lesson incomplete' : 'Mark lesson complete'}
                  </button>
                  ${
                    nextLesson
                      ? `<button type="button" class="btn btn-navy btn-sm" id="next-lesson-btn">
                          Next: ${escapeHtml(nextLesson.title)} →
                        </button>`
                      : ''
                  }
                </div>
              </div>
            </article>
          `
              : `<div class="card"><p style="color:var(--color-text-muted);">No lessons authored for this course yet.</p></div>`
          }
        </div>

        <!-- RIGHT SIDEBAR: Phases, Lessons, Assessments & Challenges Navigation -->
        <aside style="display:flex; flex-direction:column; gap:16px;">
          ${(course.phases || [])
            .map((phase) => {
              const lessons = phase.lessons || [];
              const phaseDone = lessons.filter((l) => progressByLesson.get(l.id)?.completed).length;
              const phaseAssessments = assessments.filter((a) => a.phaseId === phase.id);
              const phaseChallenges = challenges.filter((c) => c.phaseId === phase.id);

              return `
                <section class="card" style="padding:16px;">
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">
                    <h3 style="font-size:1rem;">Phase ${phase.position}: ${escapeHtml(phase.title)}</h3>
                    <span class="mono-num" style="font-size:12px; color:var(--color-text-muted);">${phaseDone}/${lessons.length}</span>
                  </div>
                  ${phase.summary ? `<p style="font-size:12.5px; color:var(--color-text-secondary); margin-bottom:10px;">${escapeHtml(phase.summary)}</p>` : ''}

                  <div class="divider-list">
                    ${lessons
                      .map((les) => {
                        const lp = progressByLesson.get(les.id);
                        const isSelected = les.id === activeLesson?.id;
                        return `
                          <div class="divider-row activity-row-item ${isSelected ? 'is-selected' : ''}" data-select-lesson="${escapeHtml(les.id)}" style="padding:9px 10px;">
                            <div style="min-width:0;">
                              <div style="font-size:13.5px; font-weight:600; color:var(--color-navy);">${escapeHtml(les.title)}</div>
                              <div style="font-size:11.5px; color:var(--color-text-muted);">${les.estMinutes}m ${(les.videos || []).length ? '· Video' : ''}</div>
                            </div>
                            <span style="flex-shrink:0; font-size:12px; font-weight:600; color:${lp?.completed ? 'var(--color-green)' : 'var(--color-blue)'};">
                              ${lp?.completed ? 'Done' : isSelected ? 'Open' : 'Study'}
                            </span>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>

                  ${
                    phaseAssessments.length > 0 || phaseChallenges.length > 0
                      ? `
                    <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--color-border); display:flex; flex-direction:column; gap:6px;">
                      ${phaseAssessments
                        .map(
                          (q) => `<a href="/quiz/${escapeHtml(q.id)}" data-link class="btn btn-secondary btn-sm" style="justify-content:space-between;">
                            <span>${escapeHtml(q.title)}</span>
                            <span>Quiz →</span>
                          </a>`
                        )
                        .join('')}
                      ${phaseChallenges
                        .map(
                          (c) => `<a href="/challenge/${escapeHtml(c.id)}" data-link class="btn btn-secondary btn-sm" style="justify-content:space-between;">
                            <span>${escapeHtml(c.title)}</span>
                            <span>Challenge →</span>
                          </a>`
                        )
                        .join('')}
                    </div>
                  `
                      : ''
                  }
                </section>
              `;
            })
            .join('')}

          <!-- Course-Level Final Assessments & Capstone Challenges -->
          ${
            assessments.some((a) => !a.phaseId) || challenges.some((c) => !c.phaseId)
              ? `
            <section class="card-workspace" style="padding:16px; display:flex; flex-direction:column; gap:10px;">
              <h3 style="font-size:1rem;">Course Assessments &amp; Capstone</h3>
              ${assessments
                .filter((a) => !a.phaseId)
                .map((q) => {
                  const passed = quizAttempts.some((att) => att.quizId === q.id && att.passed && att.reviewStatus !== 'pending_review');
                  return `
                    <a href="/quiz/${escapeHtml(q.id)}" data-link class="btn ${passed ? 'btn-secondary' : 'btn-primary'} btn-sm" style="justify-content:space-between;">
                      <span>${escapeHtml(q.title)}</span>
                      <span>${passed ? 'Passed' : 'Start'}</span>
                    </a>
                  `;
                })
                .join('')}
              ${challenges
                .filter((c) => !c.phaseId)
                .map((c) => {
                  const approved = submissions.some((s) => s.challengeId === c.id && s.status === 'approved');
                  return `
                    <a href="/challenge/${escapeHtml(c.id)}" data-link class="btn ${approved ? 'btn-secondary' : 'btn-navy'} btn-sm" style="justify-content:space-between;">
                      <span>${escapeHtml(c.title)}</span>
                      <span>${approved ? 'Approved' : 'Submit'}</span>
                    </a>
                  `;
                })
                .join('')}
            </section>
          `
              : ''
          }
        </aside>
      </div>
    `,
    bind(root) {
      root.querySelectorAll('[data-select-lesson]').forEach((el) => {
        el.addEventListener('click', () => {
          selectedLessonByCourseSlug[course.slug] = el.dataset.selectLesson;
          rerender({ silent: true });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });

      root.querySelector('#next-lesson-btn')?.addEventListener('click', () => {
        if (nextLesson) {
          selectedLessonByCourseSlug[course.slug] = nextLesson.id;
          rerender({ silent: true });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });

      root.querySelector('#course-pause-btn')?.addEventListener('click', async () => {
        const nextStatus = enrollment.status === 'paused' ? 'active' : 'paused';
        await setCourseEnrollmentStatus(userId, course.id, nextStatus);
        showToast(nextStatus === 'paused' ? 'Course paused.' : 'Course resumed.', 'success');
        rerender({ silent: true });
      });

      // Inline Knowledge Check handler
      root.querySelectorAll('[data-check-kc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const kcId = btn.dataset.checkKc;
          const box = root.querySelector(`[data-inline-kc="${kcId}"]`);
          const feedback = root.querySelector(`[data-kc-feedback="${kcId}"]`);
          if (!box || !feedback) return;
          const selected = box.querySelector(`input[name="inline_kc_${kcId}"]:checked`);
          if (!selected) {
            feedback.style.color = 'var(--color-amber)';
            feedback.textContent = 'Select an option first.';
            return;
          }
          const correct = Number(box.dataset.correct);
          const isOk = Number(selected.value) === correct;
          feedback.style.color = isOk ? 'var(--color-green)' : 'var(--color-red)';
          feedback.style.fontWeight = '600';
          feedback.textContent = isOk
            ? `Correct! ${box.dataset.explanation || ''}`
            : `Not quite. ${box.dataset.explanation || 'Review the lesson text above.'}`;
        });
      });

      // Video fallback toggle
      root.querySelectorAll('[data-video-fallback-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const helpEl = root.querySelector(`#video-help-${btn.dataset.videoFallbackToggle}`);
          if (helpEl) {
            helpEl.style.display = helpEl.style.display === 'none' ? 'block' : 'none';
          }
        });
      });

      const notesEl = root.querySelector('#lesson-notes');
      const statusEl = root.querySelector('#notes-save-status');
      let saveTimer = null;
      notesEl?.addEventListener('input', () => {
        if (!activeLesson) return;
        const words = notesEl.value.trim().split(/\s+/).filter(Boolean).length;
        statusEl.textContent = `${words} words · Saving…`;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(async () => {
          await saveLessonNotes(userId, activeLesson.id, course.id, notesEl.value);
          statusEl.textContent = `${words} words · Saved`;
        }, 300);
      });

      root.querySelector('#toggle-lesson-complete')?.addEventListener('click', async (e) => {
        if (!activeLesson) return;
        const btn = e.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        const nextDone = !activeLp?.completed;
        try {
          await toggleLessonComplete(
            userId,
            course.id,
            activeLesson.id,
            activeLesson.estMinutes,
            nextDone
          );
          showToast(nextDone ? 'Lesson marked complete!' : 'Lesson marked incomplete.', 'success');
          rerender({ silent: true });
        } catch (err) {
          btn.disabled = false;
          showToast(err?.message || 'Unable to update lesson status.', 'error');
        }
      });
    },
  };
}
