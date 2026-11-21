import {
  adminListAllQuizzes,
  adminUpsertAssessment,
  adminGetQuizQuestions,
  adminUpsertQuestion,
  adminDeleteQuestion,
} from '../../lib/repositories/quizRepository.js';
import { listSkills, listAllCourses } from '../../lib/repositories/contentRepository.js';
import { ASSESSMENT_TYPES, QUESTION_TYPES } from '../../lib/constants.js';
import { escapeHtml } from '../../lib/formatters.js';
import { registerSessionCleanup } from '../../lib/sessionLifecycle.js';
import { renderAdminLayout } from '../../components/AdminLayout.js';
import { showToast } from '../../components/Toast.js';

let selectedQuizId = null;
let selectedQuestionType = 'multiple_choice';

registerSessionCleanup(() => {
  selectedQuizId = null;
  selectedQuestionType = 'multiple_choice';
});

export async function renderAdminQuizzesPage({ currentPath, rerender }) {
  const [quizzes, skills, courses] = await Promise.all([
    adminListAllQuizzes(),
    listSkills({ includeDrafts: true }),
    listAllCourses({ includeDrafts: true }),
  ]);

  if (!selectedQuizId || !quizzes.some((q) => q.id === selectedQuizId)) {
    selectedQuizId = quizzes[0]?.id || null;
  }

  const questions = selectedQuizId ? await adminGetQuizQuestions(selectedQuizId) : [];
  const activeQuiz = quizzes.find((q) => q.id === selectedQuizId) || null;

  const isManual = ['short_answer', 'long_form', 'practical_submission'].includes(selectedQuestionType);
  const isFill = selectedQuestionType === 'fill_blank';
  const isOrder = selectedQuestionType === 'ordering';
  const isMultiSelect = selectedQuestionType === 'multiple_select';
  const isTrueFalse = selectedQuestionType === 'true_false';

  const innerHtml = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Assessments &amp; 10-Format Question Bank</h1>
        <p class="page-subtitle">Create assessments linked to skills or courses and author questions across 10 objective and manual formats.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="lab-grid-2">
        <div class="field">
          <label class="field-label" for="admin-quiz-select">Select Assessment</label>
          <select class="select" id="admin-quiz-select">
            ${quizzes
              .map(
                (q) => `<option value="${escapeHtml(q.id)}" ${q.id === selectedQuizId ? 'selected' : ''}>${escapeHtml(q.skillTitle || '')}${q.courseTitle ? ` · ${escapeHtml(q.courseTitle)}` : ''} — ${escapeHtml(q.title)}</option>`
              )
              .join('')}
          </select>
        </div>
        <div style="display:flex; flex-direction:column; justify-content:flex-end;">
          ${
            activeQuiz
              ? `<div class="meta-line">
                  <span>Type: ${escapeHtml(activeQuiz.quizType)}</span>
                  <span class="meta-sep">·</span>
                  <span class="mono-num">Pass: ${activeQuiz.passPercent}%</span>
                  ${activeQuiz.timeLimitMinutes ? `<span class="meta-sep">·</span><span>${activeQuiz.timeLimitMinutes}m timer</span>` : ''}
                  ${activeQuiz.maxAttempts ? `<span class="meta-sep">·</span><span>Max ${activeQuiz.maxAttempts} attempts</span>` : ''}
                </div>`
              : ''
          }
        </div>
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
                <div>
                  <div class="meta-line" style="margin-bottom:2px;">
                    <span>${escapeHtml((q.questionType || 'multiple_choice').replace('_', ' '))}</span>
                    <span class="meta-sep">·</span>
                    <span class="mono-num">${q.marks || 1} marks</span>
                    <span class="meta-sep">·</span>
                    <span>${escapeHtml(q.difficulty || 'medium')}</span>
                  </div>
                  <strong style="color:var(--color-navy);"><span class="mono-num">${i + 1}.</span> ${escapeHtml(q.prompt)}</strong>
                </div>
                <button type="button" class="btn btn-danger btn-sm" data-del-q="${escapeHtml(q.id)}">Remove</button>
              </div>
              ${q.contextText ? `<div style="font-size:12.5px; color:var(--color-text-secondary); padding:6px 10px; background:var(--color-bg); border-radius:4px;">${escapeHtml(q.contextText)}</div>` : ''}
              ${
                (q.options || []).length > 0
                  ? `<ol start="0" style="margin:0; padding-left:20px; font-size:13px; color:var(--color-text-secondary);">
                      ${q.options
                        .map((opt, idx) => {
                          const isHit =
                            q.questionType === 'multiple_select'
                              ? (q.correctIndices || []).includes(idx)
                              : q.questionType === 'ordering'
                                ? false
                                : idx === q.correctIndex;
                          return `<li style="${isHit ? 'color:var(--color-green); font-weight:600;' : ''}">${escapeHtml(opt)} ${isHit ? '(Correct)' : ''}</li>`;
                        })
                        .join('')}
                    </ol>`
                  : ''
              }
              ${
                q.acceptedAnswers?.length
                  ? `<div style="font-size:12.5px; color:var(--color-green);">Accepted: ${q.acceptedAnswers.map(escapeHtml).join(', ')}</div>`
                  : ''
              }
              <div style="font-size:12px; color:var(--color-text-muted);">
                <strong>Explanation / Rubric:</strong> ${escapeHtml(q.explanation)}
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </section>

      <aside style="display:flex; flex-direction:column; gap:18px;">
        <div class="card-workspace">
          <h2 style="font-size:1.05rem; margin-bottom:12px;">Add Question</h2>
          <form id="admin-question-form" class="form-stack">
            <div class="field">
              <label class="field-label" for="q-type">Question Format</label>
              <select class="select" id="q-type" name="questionType">
                ${QUESTION_TYPES.map(
                  (t) => `<option value="${t.key}" ${t.key === selectedQuestionType ? 'selected' : ''}>${escapeHtml(t.label)}${t.autoGraded ? '' : ' (Admin review)'}</option>`
                ).join('')}
              </select>
            </div>

            <div class="lab-grid-2">
              <div class="field">
                <label class="field-label" for="q-marks">Marks</label>
                <input class="input" id="q-marks" name="marks" type="number" min="1" max="50" value="2" />
              </div>
              <div class="field">
                <label class="field-label" for="q-diff">Difficulty</label>
                <select class="select" id="q-diff" name="difficulty">
                  <option value="easy">Easy</option>
                  <option value="medium" selected>Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="q-prompt">Question prompt</label>
              <textarea class="textarea" id="q-prompt" name="prompt" style="min-height:74px;" required placeholder="Enter the assessment prompt…"></textarea>
            </div>

            ${
              selectedQuestionType === 'scenario' || selectedQuestionType === 'case_study'
                ? `<div class="field">
                    <label class="field-label" for="q-context">Scenario / Case Study Context</label>
                    <textarea class="textarea" id="q-context" name="contextText" style="min-height:70px;" placeholder="Background scenario data for the learner to analyze…"></textarea>
                  </div>`
                : ''
            }

            ${
              isManual
                ? `<div style="padding:10px 12px; background:var(--color-amber-bg); border:1px solid var(--color-amber-border); border-radius:6px; font-size:12.5px;">
                    Written / practical responses are routed to Admin Submission Review after the learner submits.
                  </div>`
                : isFill
                  ? `<div class="field">
                      <label class="field-label" for="q-accepted">Accepted answers (comma-separated)</label>
                      <input class="input" id="q-accepted" name="acceptedAnswersCsv" required placeholder="e.g. BLUF, Bottom Line Up Front" />
                    </div>`
                  : isTrueFalse
                    ? `<div class="field">
                        <label class="field-label" for="q-correct">Correct answer</label>
                        <select class="select" id="q-correct" name="correctIndex">
                          <option value="0">True</option>
                          <option value="1">False</option>
                        </select>
                      </div>`
                    : `
                      <div class="field">
                        <label class="field-label" for="q-options-lines">${isOrder ? 'Steps in CORRECT sequence (one per line)' : 'Options (one per line)'}</label>
                        <textarea class="textarea" id="q-options-lines" name="optionsLines" style="min-height:84px;" required placeholder="Option A&#10;Option B&#10;Option C&#10;Option D"></textarea>
                      </div>
                      ${
                        isMultiSelect
                          ? `<div class="field">
                              <label class="field-label" for="q-multi-idx">Correct 0-based indices (comma-separated)</label>
                              <input class="input" id="q-multi-idx" name="correctIndicesCsv" required placeholder="e.g. 0, 2" />
                            </div>`
                          : isOrder
                            ? `<div style="font-size:12px; color:var(--color-text-muted);">Order listed above is stored as the target sequence.</div>`
                            : `<div class="field">
                                <label class="field-label" for="q-correct">Correct option 0-based index</label>
                                <input class="input" id="q-correct" name="correctIndex" type="number" min="0" max="10" value="0" />
                              </div>`
                      }
                    `
            }

            <div class="field">
              <label class="field-label" for="q-explanation">Post-submission explanation / grading note</label>
              <textarea class="textarea" id="q-explanation" name="explanation" style="min-height:64px;" required placeholder="Shown to learners only after they submit…"></textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Save question</button>
          </form>
        </div>

        <div class="card">
          <h2 style="font-size:1.05rem; margin-bottom:10px;">Create New Assessment</h2>
          <form id="admin-create-quiz-form" class="form-stack">
            <div class="field">
              <label class="field-label" for="nq-skill">Parent Skill</label>
              <select class="select" id="nq-skill" name="skillId">
                ${skills.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="nq-course">Linked Course (optional)</label>
              <select class="select" id="nq-course" name="courseId">
                <option value="">Skill-wide assessment</option>
                ${courses.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join('')}
              </select>
            </div>
            <div class="lab-grid-2">
              <div class="field">
                <label class="field-label" for="nq-type">Type</label>
                <select class="select" id="nq-type" name="quizType">
                  ${ASSESSMENT_TYPES.map((t) => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="nq-pass">Pass %</label>
                <input class="input" id="nq-pass" name="passPercent" type="number" min="50" max="100" value="70" />
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="nq-title">Assessment title</label>
              <input class="input" id="nq-title" name="title" required placeholder="e.g. Course Final Mastery Exam" />
            </div>
            <div class="lab-grid-2">
              <div class="field">
                <label class="field-label" for="nq-timer">Time limit (mins, optional)</label>
                <input class="input" id="nq-timer" name="timeLimitMinutes" type="number" min="5" max="180" placeholder="e.g. 25" />
              </div>
              <div class="field">
                <label class="field-label" for="nq-attempts">Max attempts (optional)</label>
                <input class="input" id="nq-attempts" name="maxAttempts" type="number" min="1" max="20" placeholder="Unlimited" />
              </div>
            </div>
            <button type="submit" class="btn btn-secondary btn-sm">Create assessment</button>
          </form>
        </div>
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

      root.querySelector('#q-type')?.addEventListener('change', (e) => {
        selectedQuestionType = e.target.value;
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
        if (!selectedQuizId) return;
        const fd = new FormData(e.currentTarget);
        const qType = String(fd.get('questionType'));
        const options =
          qType === 'true_false'
            ? ['True', 'False']
            : String(fd.get('optionsLines') || '')
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);

        const acceptedAnswers = String(fd.get('acceptedAnswersCsv') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        const correctIndices = String(fd.get('correctIndicesCsv') || '')
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => !Number.isNaN(n));

        const correctOrder = qType === 'ordering' ? options.map((_, i) => i) : null;

        try {
          await adminUpsertQuestion({
            quizId: selectedQuizId,
            questionType: qType,
            marks: Number(fd.get('marks') || 1),
            difficulty: String(fd.get('difficulty') || 'medium'),
            prompt: String(fd.get('prompt')),
            contextText: String(fd.get('contextText') || ''),
            options,
            correctIndex: Number(fd.get('correctIndex') || 0),
            correctIndices: correctIndices.length ? correctIndices : null,
            acceptedAnswers: acceptedAnswers.length ? acceptedAnswers : null,
            correctOrder,
            explanation: String(fd.get('explanation')),
          });
          showToast('Question saved securely.', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err?.message || 'Unable to save question.', 'error');
        }
      });

      root.querySelector('#admin-create-quiz-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await adminUpsertAssessment({
            skillId: String(fd.get('skillId')),
            courseId: String(fd.get('courseId') || '') || null,
            quizType: String(fd.get('quizType')),
            title: String(fd.get('title')),
            description: 'Administrator-authored course assessment.',
            passPercent: Number(fd.get('passPercent') || 70),
            timeLimitMinutes: fd.get('timeLimitMinutes') ? Number(fd.get('timeLimitMinutes')) : null,
            maxAttempts: fd.get('maxAttempts') ? Number(fd.get('maxAttempts')) : null,
          });
          showToast('Assessment created!', 'success');
          rerender({ silent: true });
        } catch (err) {
          showToast(err?.message || 'Unable to create assessment.', 'error');
        }
      });
    },
  };
}
