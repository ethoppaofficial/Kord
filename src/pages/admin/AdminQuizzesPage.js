import {
  adminListAllQuizzes,
  adminGetQuizQuestions,
  adminUpsertQuestion,
  adminDeleteQuestion,
} from '../../lib/repositories/quizRepository.js';
import { escapeHtml } from '../../lib/formatters.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { showToast } from '../../components/Toast.js';

let selectedQuizId = null;

export async function renderAdminQuizzesPage({ currentPath, rerender }) {
  const quizzes = await adminListAllQuizzes();
  if (!selectedQuizId || !quizzes.some((q) => q.id === selectedQuizId)) {
    selectedQuizId = quizzes[0]?.id || null;
  }

  const questions = selectedQuizId ? await adminGetQuizQuestions(selectedQuizId) : [];

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Manage Quiz Questions</h1>
        <p class="page-subtitle">Protected admin view. Answer keys and explanations are never exposed to learner queries.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="field" style="max-width:460px;">
        <label class="field-label" for="admin-quiz-select">Select quiz</label>
        <select class="select" id="admin-quiz-select">
          ${quizzes
            .map(
              (q) => `<option value="${escapeHtml(q.id)}" ${q.id === selectedQuizId ? 'selected' : ''}>${escapeHtml(q.skillTitle || '')} — ${escapeHtml(q.title)}</option>`
            )
            .join('')}
        </select>
      </div>
    </div>

    <div class="lab-split">
      <section class="card">
        <h2 class="section-heading">Questions (${questions.length})</h2>
        <div class="divider-list">
          ${questions
            .map(
              (q, i) => `
            <div class="divider-row" style="flex-direction:column; align-items:stretch; gap:8px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                <strong style="color:var(--color-navy);"><span class="mono-num">${i + 1}.</span> ${escapeHtml(q.prompt)}</strong>
                <button type="button" class="btn btn-danger btn-sm" data-del-q="${escapeHtml(q.id)}">Remove</button>
              </div>
              <ol start="0" style="margin:0; padding-left:20px; font-size:13px; color:var(--color-text-secondary);">
                ${(q.options || [])
                  .map(
                    (opt, idx) => `
                  <li style="${idx === q.correctIndex ? 'color:var(--color-green); font-weight:600;' : ''}">
                    ${escapeHtml(opt)} ${idx === q.correctIndex ? '(Correct)' : ''}
                  </li>
                `
                  )
                  .join('')}
              </ol>
              <div style="font-size:12px; color:var(--color-text-muted);">
                <strong>Explanation:</strong> ${escapeHtml(q.explanation)}
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </section>

      <aside class="card-workspace">
        <h2 style="font-size:1.05rem; margin-bottom:12px;">Add question</h2>
        <form id="admin-question-form" class="form-stack">
          <div class="field">
            <label class="field-label" for="q-prompt">Question prompt</label>
            <textarea class="textarea" id="q-prompt" name="prompt" style="min-height:80px;" required placeholder="Enter the question…"></textarea>
          </div>
          <div class="field">
            <label class="field-label" for="q-opt-0">Option 0</label>
            <input class="input" id="q-opt-0" name="opt0" required />
          </div>
          <div class="field">
            <label class="field-label" for="q-opt-1">Option 1</label>
            <input class="input" id="q-opt-1" name="opt1" required />
          </div>
          <div class="field">
            <label class="field-label" for="q-opt-2">Option 2</label>
            <input class="input" id="q-opt-2" name="opt2" required />
          </div>
          <div class="field">
            <label class="field-label" for="q-opt-3">Option 3</label>
            <input class="input" id="q-opt-3" name="opt3" required />
          </div>
          <div class="field">
            <label class="field-label" for="q-correct">Correct option index</label>
            <select class="select" id="q-correct" name="correctIndex">
              <option value="0">Option 0</option>
              <option value="1">Option 1</option>
              <option value="2">Option 2</option>
              <option value="3">Option 3</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="q-explanation">Post-submission explanation</label>
            <textarea class="textarea" id="q-explanation" name="explanation" style="min-height:70px;" required placeholder="Shown to learners only after they submit…"></textarea>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Save question</button>
        </form>
      </aside>
    </div>
  `;

  return {
    html: renderAdminLayout({ currentPath, innerHtml }),
    bind(root) {
      root.querySelector('#admin-quiz-select')?.addEventListener('change', (e) => {
        selectedQuizId = e.target.value;
        rerender({ silent: true });
      });

      root.querySelectorAll('[data-del-q]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (btn.disabled) return;
          btn.disabled = true;
          try {
            await adminDeleteQuestion(selectedQuizId, btn.dataset.delQ);
            showToast('Question removed.', 'success');
            rerender({ silent: true });
          } catch (err) {
            btn.disabled = false;
            showToast(err?.message || 'Unable to remove question.', 'error');
          }
        });
      });

      root.querySelector('#admin-question-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;
        if (submitBtn) submitBtn.disabled = true;
        try {
          const fd = new FormData(form);
          await adminUpsertQuestion({
            quizId: selectedQuizId,
            prompt: String(fd.get('prompt')),
            options: [fd.get('opt0'), fd.get('opt1'), fd.get('opt2'), fd.get('opt3')].map(String),
            correctIndex: Number(fd.get('correctIndex')),
            explanation: String(fd.get('explanation')),
          });
          showToast('Question saved via protected admin RPC.', 'success');
          rerender({ silent: true });
        } catch (err) {
          if (submitBtn) submitBtn.disabled = false;
          showToast(err?.message || 'Unable to save question.', 'error');
        }
      });
    },
  };
}
