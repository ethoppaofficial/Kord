import { getQuizForLearner, getQuizAttempts, startQuizSession, submitQuiz } from '../../lib/repositories/quizRepository.js';
import { resolveCourseHierarchy, renderHierarchyGuard } from '../../lib/courseNavigation.js';
import { isManualQuestionType } from '../../lib/assessmentEngine.js';
import { buildIdempotencyKey } from '../../lib/idempotency.js';
import { ASSESSMENT_TYPES } from '../../lib/constants.js';
import { escapeHtml, formatDateTime } from '../../lib/formatters.js';
import { registerSessionCleanup } from '../../lib/sessionLifecycle.js';
import { renderCourseBreadcrumbs, renderCourseOutlineDrawer, bindCourseOutlineDrawer } from '../../components/CourseOutlineDrawer.js';
import { renderProgressRail, renderStatusBadge, renderErrorState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let lastResultByQuiz = {};
let activeOrderByQuizQuestion = {};
let restartRequestedByQuiz = {};

registerSessionCleanup(() => {
  lastResultByQuiz = {};
  activeOrderByQuizQuestion = {};
  restartRequestedByQuiz = {};
});

function renderQuestionInput(q, idx, res, quizId) {
  const type = q.questionType || 'multiple_choice';
  const contextHtml = q.contextText
    ? `<div style="padding:10px 12px; border-radius:var(--radius-sm); background:var(--color-bg); border:1px solid var(--color-border); font-size:13.5px; color:var(--color-text-secondary); white-space:pre-line;">
        <strong style="color:var(--color-navy);">Context:</strong> ${escapeHtml(q.contextText)}
      </div>`
    : '';

  let controlHtml = '';

  if (type === 'multiple_select') {
    const selectedArr = Array.isArray(res?.submittedAnswer) ? res.submittedAnswer.map(Number) : [];
    const expectedArr = Array.isArray(res?.answerConfig?.correctIndices) ? res.answerConfig.correctIndices : [];
    controlHtml = `
      <div style="font-size:12px; color:var(--color-text-muted);">Select all that apply</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${(q.options || [])
          .map((opt, optIdx) => {
            let optClass = '';
            if (res) {
              if (expectedArr.includes(optIdx)) optClass = 'is-correct';
              else if (selectedArr.includes(optIdx) && !expectedArr.includes(optIdx)) optClass = 'is-wrong';
            }
            const checked = selectedArr.includes(optIdx);
            return `
              <label class="quiz-option ${optClass} ${checked ? 'is-selected' : ''}">
                <input type="checkbox" name="q_${escapeHtml(q.id)}" value="${optIdx}" ${checked ? 'checked' : ''} />
                <span style="font-size:14px;">${escapeHtml(opt)}</span>
              </label>
            `;
          })
          .join('')}
      </div>
    `;
  } else if (type === 'fill_blank') {
    const val = typeof res?.submittedAnswer === 'string' ? res.submittedAnswer : '';
    controlHtml = `
      <div class="field">
        <input class="input" type="text" name="q_text_${escapeHtml(q.id)}" data-question-input="${escapeHtml(q.id)}" placeholder="Type your exact answer…" value="${escapeHtml(val)}" />
      </div>
      ${
        res?.answerConfig?.acceptedAnswers?.length
          ? `<div style="font-size:12.5px; color:var(--color-text-muted);">Accepted answers: ${res.answerConfig.acceptedAnswers.map(escapeHtml).join(', ')}</div>`
          : ''
      }
    `;
  } else if (type === 'ordering') {
    const key = `${quizId}:${q.id}`;
    if (!activeOrderByQuizQuestion[key]) {
      activeOrderByQuizQuestion[key] = (q.options || []).map((_, i) => i);
    }
    const order = activeOrderByQuizQuestion[key];
    controlHtml = `
      <div style="font-size:12px; color:var(--color-text-muted);">Arrange these steps in the correct sequence using Move Up / Move Down</div>
      <div style="display:flex; flex-direction:column; gap:6px;" data-order-list="${escapeHtml(q.id)}">
        ${order
          .map(
            (optIdx, pos) => `
          <div class="order-item-row" data-order-idx="${optIdx}">
            <span style="font-size:14px;"><strong class="mono-num">${pos + 1}.</strong> ${escapeHtml(q.options?.[optIdx] || '')}</span>
            <div style="display:flex; gap:4px;">
              <button type="button" class="btn btn-secondary btn-sm" data-move-order="${escapeHtml(q.id)}" data-pos="${pos}" data-dir="-1" ${pos === 0 ? 'disabled' : ''}>Up</button>
              <button type="button" class="btn btn-secondary btn-sm" data-move-order="${escapeHtml(q.id)}" data-pos="${pos}" data-dir="1" ${pos === order.length - 1 ? 'disabled' : ''}>Down</button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  } else if (type === 'short_answer' || type === 'long_form' || type === 'practical_submission') {
    const val = typeof res?.submittedAnswer === 'string' ? res.submittedAnswer : '';
    const minH = type === 'long_form' ? '140px' : '82px';
    const placeholder =
      type === 'practical_submission'
        ? 'Paste your deliverable URL or explain your practical submission…'
        : type === 'long_form'
          ? 'Write a thorough, well-structured response covering all parts of the prompt…'
          : 'Write a concise 1–3 sentence response…';
    controlHtml = `
      <div style="font-size:12px; color:var(--color-amber); font-weight:600;">Manually graded by administrator after submission</div>
      <textarea class="textarea" name="q_text_${escapeHtml(q.id)}" data-question-input="${escapeHtml(q.id)}" style="min-height:${minH};" placeholder="${placeholder}">${escapeHtml(val)}</textarea>
    `;
  } else {
    // multiple_choice, true_false, scenario, case_study
    const options = type === 'true_false' && (!q.options || q.options.length === 0) ? ['True', 'False'] : q.options || [];
    controlHtml = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${options
          .map((opt, optIdx) => {
            let optClass = '';
            if (res && !res.pendingReview && res.correctIndex !== null && res.correctIndex !== undefined) {
              if (optIdx === res.correctIndex) optClass = 'is-correct';
              else if (optIdx === res.selectedIndex && !res.isCorrect) optClass = 'is-wrong';
            }
            return `
              <label class="quiz-option ${optClass} ${res && res.selectedIndex === optIdx ? 'is-selected' : ''}">
                <input type="radio" name="q_${escapeHtml(q.id)}" value="${optIdx}" ${res && res.selectedIndex === optIdx ? 'checked' : ''} />
                <span style="font-size:14px;">${escapeHtml(opt)}</span>
              </label>
            `;
          })
          .join('')}
      </div>
    `;
  }

  return `
    <section class="card" style="display:flex; flex-direction:column; gap:12px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
        <div style="font-weight:600; color:var(--color-navy);">
          <span class="mono-num">${idx + 1}.</span> ${escapeHtml(q.prompt)}
        </div>
        <span class="mono-num" style="font-size:12px; color:var(--color-text-muted);">${q.marks || 1} ${Number(q.marks || 1) === 1 ? 'mark' : 'marks'} · ${escapeHtml(type.replace('_', ' '))}</span>
      </div>
      ${contextHtml}
      ${controlHtml}
      ${
        res
          ? res.pendingReview
            ? `<div class="pop-in" style="padding:10px 12px; border-radius:6px; font-size:13px; background:var(--color-amber-bg); color:var(--color-navy);">
                <strong>Submitted for review:</strong> ${escapeHtml(res.explanation || 'Your written response is queued for administrator grading.')}
              </div>`
            : res.explanation === null || res.explanation === undefined
              ? `<div class="pop-in" style="padding:10px 12px; border-radius:6px; font-size:13px; background:var(--color-bg); border:1px solid var(--color-border); color:var(--color-text-secondary);">
                  <strong>Answer key withheld:</strong> Pass this assessment or complete your remaining attempts to unlock detailed solutions and explanations.
                </div>`
              : `<div class="pop-in" style="padding:10px 12px; border-radius:6px; font-size:13px; background:${res.isCorrect ? 'var(--color-green-bg)' : 'var(--color-amber-bg)'}; color:var(--color-text);">
                  <strong>${res.isCorrect ? 'Correct:' : 'Explanation:'}</strong> ${escapeHtml(res.explanation)}
                </div>`
          : ''
      }
    </section>
  `;
}

export async function renderQuizPage({ params, session, navigate, rerender }) {
  const targetQuizId = params.assessmentId || params.quizId;
  const userId = session.user.id;

  let courseCtx = null;
  if (params.slug) {
    courseCtx = await resolveCourseHierarchy({
      courseSlug: params.slug,
      userId,
      requireEnrollment: true,
    });
    if (courseCtx.status !== 'ok') {
      return renderHierarchyGuard({
        ctx: courseCtx,
        userId,
        targetUrlAfterEnroll: `/courses/${params.slug}/assessments/${targetQuizId}`,
        navigate,
      });
    }
  }

  const quiz = await getQuizForLearner(targetQuizId, { userId });
  if (!quiz || (courseCtx && quiz.courseId !== courseCtx.course.id)) {
    return {
      html: renderErrorState({
        title: 'Assessment not found',
        message: courseCtx
          ? 'This assessment does not belong to the requested course.'
          : 'We could not locate this assessment.',
      }),
      bind() {},
    };
  }

  if (!courseCtx && quiz.course?.slug) {
    courseCtx = await resolveCourseHierarchy({
      courseSlug: quiz.course.slug,
      userId,
      requireEnrollment: true,
    });
    if (courseCtx.status === 'enrollment_required') {
      return renderHierarchyGuard({
        ctx: courseCtx,
        userId,
        targetUrlAfterEnroll: `/courses/${quiz.course.slug}/assessments/${targetQuizId}`,
        navigate,
      });
    }
  }

  const attempts = await getQuizAttempts(userId, quiz.id);
  const latestResult = lastResultByQuiz[quiz.id] || null;

  const displayQuestions = quiz.shuffleQuestions
    ? quiz.questions.slice().sort((a, b) => a.id.localeCompare(b.id))
    : quiz.questions;

  const activeCourse = courseCtx?.status === 'ok' ? courseCtx.course : quiz.course;
  const backToPhasePath =
    activeCourse?.slug && quiz.phaseId ? `/courses/${activeCourse.slug}/phases/${quiz.phaseId}` : null;
  const backPath =
    backToPhasePath ||
    (activeCourse?.slug ? `/courses/${activeCourse.slug}` : quiz.skill?.slug ? `/skills/${quiz.skill.slug}` : '/skills');
  const typeMeta = ASSESSMENT_TYPES.find((t) => t.key === quiz.quizType);
  const attemptsLeft = quiz.maxAttempts ? Math.max(0, quiz.maxAttempts - attempts.length) : null;
  const isLocked = quiz.maxAttempts !== null && quiz.maxAttempts !== undefined && attemptsLeft <= 0;
  const initialAnswered = latestResult ? displayQuestions.length : 0;

  let quizSession = null;
  if (!isLocked && quiz.timeLimitMinutes && Number(quiz.timeLimitMinutes) > 0) {
    const shouldRestart = Boolean(restartRequestedByQuiz[quiz.id]);
    delete restartRequestedByQuiz[quiz.id];
    quizSession = await startQuizSession(userId, quiz.id, { restartExpired: shouldRestart });
  }
  const isSessionExpired = Boolean(quizSession?.expired);
  const remainingSeconds =
    quizSession?.expiresAt && !isSessionExpired
      ? Math.max(
          0,
          Math.floor(
            (new Date(quizSession.expiresAt).getTime() -
              new Date(quizSession.serverNow || Date.now()).getTime()) /
              1000
          )
        )
      : quiz.timeLimitMinutes
        ? Number(quiz.timeLimitMinutes) * 60
        : 0;
  const initialTimerMins = Math.floor(remainingSeconds / 60);
  const initialTimerSecs = String(remainingSeconds % 60).padStart(2, '0');

  const breadcrumbItems = activeCourse
    ? [
        { label: 'Explore', href: '/explore' },
        ...(activeCourse.skill ? [{ label: activeCourse.skill.title, href: `/skills/${activeCourse.skill.slug}` }] : []),
        { label: activeCourse.title, href: `/courses/${activeCourse.slug}` },
        ...(backToPhasePath ? [{ label: 'Phase overview', href: backToPhasePath }] : []),
        { label: quiz.title },
      ]
    : null;

  return {
    html: `
      ${
        breadcrumbItems && courseCtx?.status === 'ok'
          ? `
            ${renderCourseBreadcrumbs({ items: breadcrumbItems, showOutlineToggle: true })}
            ${renderCourseOutlineDrawer({
              course: courseCtx.course,
              orderedPhases: courseCtx.orderedPhases,
              phaseProgressById: courseCtx.phaseProgressById,
              progressByLesson: courseCtx.progressByLesson,
              assessments: courseCtx.assessments,
              challenges: courseCtx.challenges,
              activePhaseId: quiz.phaseId,
              courseProgress: courseCtx.courseProgress,
            })}
          `
          : `
            <div style="margin-bottom:14px;">
              <a href="${escapeHtml(backPath)}" data-link style="font-size:14px; font-weight:500;">← Back to ${backToPhasePath ? 'phase' : activeCourse ? escapeHtml(activeCourse.title) : 'Skill hub'}</a>
            </div>
          `
      }

      <div class="lab-split">
        <div style="display:flex; flex-direction:column; gap:20px;">
          <section class="card">
            <div class="meta-line" style="margin-bottom:6px;">
              <span>${escapeHtml(typeMeta?.label || 'Assessment')}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">Pass: ${quiz.passPercent}%</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">${displayQuestions.length} questions</span>
              ${quiz.timeLimitMinutes ? `<span class="meta-sep" aria-hidden="true">·</span><span class="mono-num" id="quiz-timer-badge" style="${isSessionExpired ? 'color:var(--color-red);' : ''}">${isSessionExpired ? 'Session expired' : `Timer: ${initialTimerMins}:${initialTimerSecs}`}</span>` : ''}
              ${attemptsLeft !== null ? `<span class="meta-sep" aria-hidden="true">·</span><span class="mono-num">${attemptsLeft} attempts remaining</span>` : ''}
            </div>
            <h1 class="page-title">${escapeHtml(quiz.title)}</h1>
            <p class="page-subtitle" style="margin-bottom:16px;">${escapeHtml(quiz.description)}</p>

            ${renderProgressRail({
              id: 'quiz-completion-rail',
              label: 'Questions answered',
              value: initialAnswered,
              max: Math.max(1, displayQuestions.length),
              detail: `${initialAnswered}/${displayQuestions.length}`,
            })}
          </section>

          ${
            isSessionExpired
              ? `
            <section class="card" style="background:var(--color-amber-bg); border-color:var(--color-amber-border); display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
              <div>
                <strong style="color:var(--color-navy); display:block;">Previous timed session expired</strong>
                <span style="font-size:13.5px; color:var(--color-text-secondary);">Start a fresh server-timed session to submit this assessment.</span>
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="restart-quiz-session-btn">Start New Timed Session</button>
            </section>
          `
              : ''
          }

          ${
            latestResult
              ? `
            <section class="card-workspace pop-in" id="quiz-result-banner" aria-live="polite">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
                <div>
                  <div style="font-size:13px; color:var(--color-text-secondary);">Attempt #${latestResult.attemptNumber || 1} result</div>
                  <div class="mono-num" style="font-size:1.5rem; font-weight:700; color:var(--color-navy);">
                    ${latestResult.score}/${latestResult.total} marks (${latestResult.percentage}%)
                  </div>
                </div>
                ${renderStatusBadge(
                  latestResult.reviewStatus === 'pending_review'
                    ? 'pending_review'
                    : latestResult.passed
                      ? 'passed'
                      : 'failed'
                )}
              </div>
              <p style="font-size:14px; color:var(--color-text-secondary);">
                ${
                  latestResult.reviewStatus === 'pending_review'
                    ? 'Auto-graded items are scored above. Your written/practical answers are now queued for administrator review before final pass status is awarded.'
                    : latestResult.passed
                      ? 'Passed! Your course and skill progression have been updated automatically.'
                      : `Score ${quiz.passPercent}% or higher to pass. Review the explanations below and try again.`
                }
              </p>
            </section>
          `
              : ''
          }

          <form id="quiz-form" class="form-stack">
            ${displayQuestions
              .map((q, idx) => {
                const res = latestResult?.results?.find((r) => r.questionId === q.id);
                return renderQuestionInput(q, idx, res, quiz.id);
              })
              .join('')}

            <div class="field-error" id="quiz-error" role="alert"></div>

            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
              <button type="submit" class="btn btn-primary" id="quiz-submit-btn" ${isLocked || isSessionExpired ? 'disabled' : ''}>
                ${
                  isLocked
                    ? `Attempt limit reached (${quiz.maxAttempts})`
                    : isSessionExpired
                      ? 'Timed session expired — start new session above'
                      : latestResult
                        ? 'Retake & submit assessment'
                        : 'Submit assessment'
                }
              </button>
            </div>
          </form>
        </div>

        <aside class="card">
          <h2 style="font-size:1.05rem; margin-bottom:10px;">Attempt history</h2>
          ${
            attempts.length > 0
              ? `
            <div class="divider-list">
              ${attempts
                .map(
                  (a) => `
                <div class="divider-row" style="flex-direction:column; align-items:stretch; gap:4px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="mono-num" style="font-weight:600;">${a.score}/${a.total} (${a.percentage}%)</div>
                    ${renderStatusBadge(
                      a.reviewStatus === 'pending_review'
                        ? 'pending_review'
                        : a.passed
                          ? 'passed'
                          : 'failed'
                    )}
                  </div>
                  <div style="font-size:12px; color:var(--color-text-muted);">${formatDateTime(a.createdAt)}</div>
                  ${a.manualFeedback ? `<div style="font-size:12.5px; color:var(--color-navy); margin-top:2px;">Feedback: ${escapeHtml(a.manualFeedback)}</div>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
          `
              : '<p style="font-size:14px; color:var(--color-text-muted);">No attempts submitted yet. Answer keys and explanations remain hidden until after you submit.</p>'
          }
        </aside>
      </div>
    `,
    bind(root) {
      bindCourseOutlineDrawer(root);
      const form = root.querySelector('#quiz-form');
      const errEl = root.querySelector('#quiz-error');
      const btn = root.querySelector('#quiz-submit-btn');
      const rail = root.querySelector('#quiz-completion-rail');
      const timerEl = root.querySelector('#quiz-timer-badge');

      root.querySelector('#restart-quiz-session-btn')?.addEventListener('click', () => {
        restartRequestedByQuiz[quiz.id] = true;
        rerender({ silent: true });
      });

      // Server/session-synchronized countdown timer for timed assessments
      let timerId = null;
      if (quiz.timeLimitMinutes && timerEl && !isLocked && !isSessionExpired) {
        let secondsLeft = remainingSeconds;
        timerId = window.setInterval(() => {
          if (!document.body.contains(timerEl)) {
            window.clearInterval(timerId);
            return;
          }
          secondsLeft = Math.max(0, secondsLeft - 1);
          const m = Math.floor(secondsLeft / 60);
          const s = String(secondsLeft % 60).padStart(2, '0');
          timerEl.textContent = `Timer: ${m}:${s}`;
          if (secondsLeft <= 60) timerEl.style.color = 'var(--color-red)';
          if (secondsLeft === 0) {
            window.clearInterval(timerId);
            showToast('Assessment time limit reached.', 'info');
          }
        }, 1000);
      }

      // Ordering button interactions (local DOM update so prior answers & timer stay intact)
      const attachOrderControls = (container) => {
        container.querySelectorAll('[data-move-order]').forEach((moveBtn) => {
          moveBtn.addEventListener('click', () => {
            const qId = moveBtn.dataset.moveOrder;
            const pos = Number(moveBtn.dataset.pos);
            const dir = Number(moveBtn.dataset.dir);
            const key = `${quiz.id}:${qId}`;
            const arr = activeOrderByQuizQuestion[key];
            if (!arr) return;
            const target = pos + dir;
            if (target < 0 || target >= arr.length) return;
            [arr[pos], arr[target]] = [arr[target], arr[pos]];
            const q = displayQuestions.find((x) => x.id === qId);
            const listEl = root.querySelector(`[data-order-list="${qId}"]`);
            if (listEl && q) {
              listEl.innerHTML = arr
                .map(
                  (optIdx, i) => `
                <div class="order-item-row" data-order-idx="${optIdx}">
                  <span style="font-size:14px;"><strong class="mono-num">${i + 1}.</strong> ${escapeHtml(q.options?.[optIdx] || '')}</span>
                  <div style="display:flex; gap:4px;">
                    <button type="button" class="btn btn-secondary btn-sm" data-move-order="${escapeHtml(q.id)}" data-pos="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>Up</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-move-order="${escapeHtml(q.id)}" data-pos="${i}" data-dir="1" ${i === arr.length - 1 ? 'disabled' : ''}>Down</button>
                  </div>
                </div>
              `
                )
                .join('');
              attachOrderControls(listEl);
            }
          });
        });
      };
      attachOrderControls(root);

      const collectAnswers = () => {
        const answersMap = {};
        let answered = 0;
        const missingPrompts = [];

        displayQuestions.forEach((q, idx) => {
          const type = q.questionType || 'multiple_choice';
          if (type === 'multiple_select') {
            const checked = [...form.querySelectorAll(`input[name="q_${q.id}"]:checked`)].map((c) => Number(c.value));
            if (checked.length > 0) {
              answersMap[q.id] = checked;
              answered += 1;
            } else {
              missingPrompts.push(idx + 1);
            }
          } else if (type === 'fill_blank' || isManualQuestionType(type)) {
            const inp = form.querySelector(`[data-question-input="${q.id}"]`);
            const val = inp ? inp.value.trim() : '';
            if (val.length > 0) {
              answersMap[q.id] = val;
              answered += 1;
            } else {
              missingPrompts.push(idx + 1);
            }
          } else if (type === 'ordering') {
            const key = `${quiz.id}:${q.id}`;
            answersMap[q.id] = (activeOrderByQuizQuestion[key] || []).slice();
            answered += 1;
          } else {
            const checked = form.querySelector(`input[name="q_${q.id}"]:checked`);
            if (checked) {
              answersMap[q.id] = Number(checked.value);
              answered += 1;
            } else {
              missingPrompts.push(idx + 1);
            }
          }
        });

        return { answersMap, answered, missingPrompts };
      };

      const updateSelectionFeedback = () => {
        displayQuestions.forEach((q) => {
          form.querySelectorAll(`input[name="q_${q.id}"]`).forEach((input) => {
            input.closest('.quiz-option')?.classList.toggle('is-selected', input.checked);
          });
        });

        const { answered } = collectAnswers();
        if (rail) {
          const total = Math.max(1, displayQuestions.length);
          const pct = Math.round((answered / total) * 100);
          rail.querySelector('[data-rail-fill]').style.width = `${pct}%`;
          rail.querySelector('[data-rail-detail]').textContent = `${answered}/${displayQuestions.length}`;
        }
        errEl.textContent = '';
      };

      form?.addEventListener('change', updateSelectionFeedback);
      form?.addEventListener('input', updateSelectionFeedback);

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isLocked || isSessionExpired) return;
        errEl.textContent = '';

        const { answersMap, missingPrompts } = collectAnswers();
        if (missingPrompts.length > 0) {
          errEl.textContent = `Please complete question(s) ${missingPrompts.join(', ')} before submitting.`;
          return;
        }

        if (timerId) window.clearInterval(timerId);
        btn.disabled = true;
        btn.textContent = 'Grading…';
        try {
          // Include unique attempt number in idempotency key so intentional retakes always record cleanly
          const retakeKey = buildIdempotencyKey('quiz-attempt', userId, quiz.id, attempts.length + 1, Date.now());
          const graded = await submitQuiz(userId, quiz.id, answersMap, retakeKey);
          lastResultByQuiz[quiz.id] = graded;
          showToast(
            graded.reviewStatus === 'pending_review'
              ? 'Submitted! Written answers queued for administrator grading.'
              : graded.passed
                ? `Passed with ${graded.percentage}%!`
                : `Scored ${graded.percentage}%. Review feedback and retry.`,
            graded.passed ? 'success' : 'info'
          );
          await rerender({ silent: true });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          errEl.textContent = err.message || 'Unable to submit assessment.';
          btn.disabled = false;
          btn.textContent = 'Submit assessment';
        }
      });
    },
  };
}
