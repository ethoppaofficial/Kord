import { getQuizForLearner, getQuizAttempts, submitQuiz } from '../../lib/repositories/quizRepository.js';
import { escapeHtml, formatDateTime } from '../../lib/formatters.js';
import { renderProgressRail, renderStatusBadge, renderErrorState } from '../../components/Common.js';
import { showToast } from '../../components/Toast.js';

let lastResultByQuiz = {};

export async function renderQuizPage({ params, session, rerender }) {
  const quiz = await getQuizForLearner(params.quizId);
  if (!quiz) {
    return {
      html: renderErrorState({ title: 'Quiz not found', message: 'We could not locate this quiz.' }),
      bind() {},
    };
  }

  const userId = session.user.id;
  const attempts = await getQuizAttempts(userId, quiz.id);
  const latestResult = lastResultByQuiz[quiz.id] || null;
  const backPath = quiz.skill?.slug ? `/roadmap/${quiz.skill.slug}` : '/skills';
  const initialAnswered = latestResult ? quiz.questions.length : 0;

  return {
    html: `
      <div style="margin-bottom:14px;">
        <a href="${escapeHtml(backPath)}" data-link style="font-size:14px; font-weight:500;">← Back to roadmap</a>
      </div>

      <div class="lab-split">
        <div style="display:flex; flex-direction:column; gap:20px;">
          <section class="card">
            <div class="meta-line" style="margin-bottom:6px;">
              <span>${quiz.quizType === 'skill_check' ? 'Skill Check' : 'Phase Quiz'}</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">Pass threshold: ${quiz.passPercent}%</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="mono-num">${quiz.questions.length} questions</span>
            </div>
            <h1 class="page-title">${escapeHtml(quiz.title)}</h1>
            <p class="page-subtitle" style="margin-bottom:16px;">${escapeHtml(quiz.description)}</p>

            ${renderProgressRail({
              id: 'quiz-completion-rail',
              label: 'Questions answered',
              value: initialAnswered,
              max: Math.max(1, quiz.questions.length),
              detail: `${initialAnswered}/${quiz.questions.length}`,
            })}
          </section>

          ${
            latestResult
              ? `
            <section class="card-workspace pop-in" id="quiz-result-banner" aria-live="polite">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
                <div>
                  <div style="font-size:13px; color:var(--color-text-secondary);">Submitted result</div>
                  <div class="mono-num" style="font-size:1.5rem; font-weight:700; color:var(--color-navy);">
                    ${latestResult.score}/${latestResult.total} (${latestResult.percentage}%)
                  </div>
                </div>
                ${renderStatusBadge(latestResult.passed ? 'passed' : 'failed')}
              </div>
              <p style="font-size:14px; color:var(--color-text-secondary);">
                ${
                  latestResult.passed
                    ? quiz.quizType === 'skill_check'
                      ? 'Passed! Your skill level has upgraded to Demonstrated (unless already Verified).'
                      : 'Passed! Your skill progress has been recorded.'
                    : `Score ${quiz.passPercent}% or higher to pass. Review the explanations below and try again.`
                }
              </p>
            </section>
          `
              : ''
          }

          <form id="quiz-form" class="form-stack">
            ${quiz.questions
              .map((q, idx) => {
                const res = latestResult?.results?.find((r) => r.questionId === q.id);
                return `
                  <section class="card" style="display:flex; flex-direction:column; gap:12px;">
                    <div style="font-weight:600; color:var(--color-navy);">
                      <span class="mono-num">${idx + 1}.</span> ${escapeHtml(q.prompt)}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                      ${q.options
                        .map((opt, optIdx) => {
                          let optClass = '';
                          if (res) {
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
                    ${
                      res
                        ? `
                      <div class="pop-in" style="padding:10px 12px; border-radius:6px; font-size:13px; background:${res.isCorrect ? 'var(--color-green-bg)' : 'var(--color-amber-bg)'}; color:var(--color-text);">
                        <strong>${res.isCorrect ? 'Correct:' : 'Explanation:'}</strong> ${escapeHtml(res.explanation)}
                      </div>
                    `
                        : ''
                    }
                  </section>
                `;
              })
              .join('')}

            <div class="field-error" id="quiz-error" role="alert"></div>

            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              <button type="submit" class="btn btn-primary" id="quiz-submit-btn">
                ${latestResult ? 'Retake & submit quiz' : 'Submit quiz answers'}
              </button>
            </div>
          </form>
        </div>

        <aside class="card">
          <h2 style="font-size:1.05rem; margin-bottom:10px;">Previous attempts</h2>
          ${
            attempts.length > 0
              ? `
            <div class="divider-list">
              ${attempts
                .map(
                  (a) => `
                <div class="divider-row">
                  <div>
                    <div class="mono-num" style="font-weight:600;">${a.score}/${a.total} (${a.percentage}%)</div>
                    <div style="font-size:12px; color:var(--color-text-muted);">${formatDateTime(a.createdAt)}</div>
                  </div>
                  ${renderStatusBadge(a.passed ? 'passed' : 'failed')}
                </div>
              `
                )
                .join('')}
            </div>
          `
              : '<p style="font-size:14px; color:var(--color-text-muted);">No attempts submitted yet. Correct answers and explanations appear only after submission.</p>'
          }
        </aside>
      </div>
    `,
    bind(root) {
      const form = root.querySelector('#quiz-form');
      const errEl = root.querySelector('#quiz-error');
      const btn = root.querySelector('#quiz-submit-btn');
      const rail = root.querySelector('#quiz-completion-rail');

      const updateSelectionFeedback = () => {
        let answered = 0;
        quiz.questions.forEach((q) => {
          const radios = form.querySelectorAll(`input[name="q_${q.id}"]`);
          let qAnswered = false;
          radios.forEach((r) => {
            const label = r.closest('.quiz-option');
            if (r.checked) {
              qAnswered = true;
              label?.classList.add('is-selected');
            } else {
              label?.classList.remove('is-selected');
            }
          });
          if (qAnswered) answered += 1;
        });

        if (rail) {
          const total = Math.max(1, quiz.questions.length);
          const pct = Math.round((answered / total) * 100);
          rail.querySelector('[data-rail-fill]').style.width = `${pct}%`;
          rail.querySelector('[data-rail-detail]').textContent = `${answered}/${quiz.questions.length}`;
        }
        errEl.textContent = '';
      };

      form?.addEventListener('change', updateSelectionFeedback);

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl.textContent = '';

        const answersMap = {};
        let missing = false;
        quiz.questions.forEach((q) => {
          const checked = form.querySelector(`input[name="q_${q.id}"]:checked`);
          if (!checked) missing = true;
          else answersMap[q.id] = Number(checked.value);
        });

        if (missing) {
          errEl.textContent = 'Please select an answer for every question before submitting.';
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Grading…';
        try {
          const graded = await submitQuiz(userId, quiz.id, answersMap);
          lastResultByQuiz[quiz.id] = graded;
          showToast(
            graded.passed ? `Passed with ${graded.percentage}%!` : `Scored ${graded.percentage}%. Review feedback and retry.`,
            graded.passed ? 'success' : 'info'
          );
          await rerender({ silent: true });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          errEl.textContent = err.message || 'Unable to submit quiz.';
          btn.disabled = false;
          btn.textContent = 'Submit quiz answers';
        }
      });
    },
  };
}
