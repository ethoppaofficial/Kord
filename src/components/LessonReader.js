import { escapeHtml, formatDateTime } from '../lib/formatters.js';
import {
  renderEditorialLectureHtml,
  renderEditorialPracticalHtml,
  renderInlineProseHtml,
  splitLessonSections,
} from '../lib/richTextLesson.js';
import { renderVideoPlayerHtml } from '../lib/videoProvider.js';
import { isManualQuestionType } from '../lib/assessmentEngine.js';
import { renderStatusBadge } from './Common.js';

/**
 * Renders a single question inside Section 7 (Knowledge Assessment)
 * of the lesson reader, supporting objective and manual question types
 * without ever exposing answer keys before submission.
 *
 * @param {import('../types/kord.d.ts').QuizQuestion} q
 * @param {number} idx
 * @param {import('../types/kord.d.ts').QuizAttemptResultItem | undefined} res
 * @param {string} quizId
 * @param {Record<string, number[]>} orderState
 * @param {boolean} [previewMode]
 */
function renderInlineAssessmentQuestion(q, idx, res, quizId, orderState, previewMode = false) {
  const type = q.questionType || 'multiple_choice';
  const contextHtml = q.contextText
    ? `<div class="lesson-assessment-context"><strong>Context:</strong> ${escapeHtml(q.contextText)}</div>`
    : '';

  /** @type {string} */
  let controlHtml;
  const disabledAttr = previewMode ? 'disabled' : '';

  if (type === 'multiple_select') {
    const selectedArr = Array.isArray(res?.submittedAnswer) ? res.submittedAnswer.map(Number) : [];
    const expectedArr = Array.isArray(res?.answerConfig?.correctIndices) ? res.answerConfig.correctIndices : [];
    controlHtml = `
      <div class="lesson-assessment-hint">Select all that apply</div>
      <div class="lesson-assessment-options">
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
                <input type="checkbox" name="lq_${escapeHtml(q.id)}" value="${optIdx}" ${checked ? 'checked' : ''} ${disabledAttr} />
                <span>${escapeHtml(opt)}</span>
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
        <input class="input" type="text" name="lq_text_${escapeHtml(q.id)}" data-lq-input="${escapeHtml(q.id)}" placeholder="Type your answer…" value="${escapeHtml(val)}" ${disabledAttr} />
      </div>
      ${
        res?.answerConfig?.acceptedAnswers?.length
          ? `<div class="lesson-assessment-hint">Accepted answers: ${res.answerConfig.acceptedAnswers.map(escapeHtml).join(', ')}</div>`
          : ''
      }
    `;
  } else if (type === 'ordering') {
    const key = `${quizId}:${q.id}`;
    if (!orderState[key]) {
      orderState[key] = (q.options || []).map((_, i) => i);
    }
    const order = orderState[key];
    controlHtml = `
      <div class="lesson-assessment-hint">Arrange steps in the correct sequence</div>
      <div class="lesson-assessment-options" data-lq-order-list="${escapeHtml(q.id)}">
        ${order
          .map(
            (optIdx, pos) => `
          <div class="order-item-row" data-order-idx="${optIdx}">
            <span><strong class="mono-num">${pos + 1}.</strong> ${escapeHtml(q.options?.[optIdx] || '')}</span>
            <div style="display:flex; gap:4px;">
              <button type="button" class="btn btn-secondary btn-sm" data-lq-move="${escapeHtml(q.id)}" data-pos="${pos}" data-dir="-1" ${pos === 0 || previewMode ? 'disabled' : ''}>Up</button>
              <button type="button" class="btn btn-secondary btn-sm" data-lq-move="${escapeHtml(q.id)}" data-pos="${pos}" data-dir="1" ${pos === order.length - 1 || previewMode ? 'disabled' : ''}>Down</button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  } else if (type === 'short_answer' || type === 'long_form' || type === 'practical_submission') {
    const val = typeof res?.submittedAnswer === 'string' ? res.submittedAnswer : '';
    const minH = type === 'long_form' ? '120px' : '78px';
    controlHtml = `
      <div class="lesson-assessment-hint">Reviewed by administrator after submission</div>
      <textarea class="textarea" name="lq_text_${escapeHtml(q.id)}" data-lq-input="${escapeHtml(q.id)}" style="min-height:${minH};" placeholder="Write your response…" ${disabledAttr}>${escapeHtml(val)}</textarea>
    `;
  } else {
    const options =
      type === 'true_false' && (!q.options || q.options.length === 0) ? ['True', 'False'] : q.options || [];
    controlHtml = `
      <div class="lesson-assessment-options">
        ${options
          .map((opt, optIdx) => {
            let optClass = '';
            if (res && !res.pendingReview && res.correctIndex !== null && res.correctIndex !== undefined) {
              if (optIdx === res.correctIndex) optClass = 'is-correct';
              else if (optIdx === res.selectedIndex && !res.isCorrect) optClass = 'is-wrong';
            }
            return `
              <label class="quiz-option ${optClass} ${res && res.selectedIndex === optIdx ? 'is-selected' : ''}">
                <input type="radio" name="lq_${escapeHtml(q.id)}" value="${optIdx}" ${res && res.selectedIndex === optIdx ? 'checked' : ''} ${disabledAttr} />
                <span>${escapeHtml(opt)}</span>
              </label>
            `;
          })
          .join('')}
      </div>
    `;
  }

  return `
    <div class="lesson-assessment-question">
      <div class="lesson-assessment-q-head">
        <div class="lesson-assessment-prompt">
          <span class="mono-num">${idx + 1}.</span> ${escapeHtml(q.prompt)}
        </div>
        <span class="lesson-assessment-marks mono-num">${q.marks || 1} ${Number(q.marks || 1) === 1 ? 'mark' : 'marks'}</span>
      </div>
      ${contextHtml}
      ${controlHtml}
      ${
        res
          ? res.pendingReview
            ? `<div class="lesson-assessment-feedback is-pending">
                <strong>Submitted for review:</strong> ${escapeHtml(res.explanation || 'Queued for administrator grading.')}
              </div>`
            : res.explanation === null || res.explanation === undefined
              ? `<div class="lesson-assessment-feedback">
                  <strong>Answer key withheld:</strong> Pass this assessment or complete remaining attempts to view detailed solutions.
                </div>`
              : `<div class="lesson-assessment-feedback ${res.isCorrect ? 'is-correct' : 'is-review'}">
                  <strong>${res.isCorrect ? 'Correct:' : 'Explanation:'}</strong> ${escapeHtml(res.explanation)}
                </div>`
          : ''
      }
    </div>
  `;
}

/**
 * Renders the unified 8-section editorial Lesson Reader used by both the
 * learner lesson page and the administrator live/modal lesson preview.
 *
 * Structure:
 *  1. Lesson title and course/phase context
 *  2. Short lesson introduction
 *  3. Learning objectives
 *  4. Main instructional lecture (greatest visual emphasis)
 *  5. Practical application or worked example
 *  6. Lesson summary (+ optional supplementary video walkthroughs)
 *  7. Knowledge assessment (DB quiz or interactive inline checks)
 *  8. Completion status (+ optional study notes) and next/prev navigation
 *
 * @param {{
 *   lesson: Partial<import('../types/kord.d.ts').Lesson>;
 *   courseTitle?: string;
 *   phasePosition?: number;
 *   phaseTitle?: string;
 *   lessonNumber?: number;
 *   totalLessonsInPhase?: number;
 *   completed?: boolean;
 *   notes?: string;
 *   lessonQuiz?: import('../types/kord.d.ts').Quiz | null;
 *   quizAttempts?: import('../types/kord.d.ts').QuizAttempt[];
 *   latestQuizResult?: import('../types/kord.d.ts').QuizAttempt | null;
 *   orderState?: Record<string, number[]>;
 *   prevLesson?: { url: string; label: string } | null;
 *   nextLesson?: { url: string; label: string } | null;
 *   phaseUrl?: string;
 *   courseUrl?: string;
 *   previewMode?: boolean;
 * }} opts
 * @returns {string}
 */
export function renderLessonReaderHtml({
  lesson,
  courseTitle = '',
  phasePosition = 1,
  phaseTitle = '',
  lessonNumber = 1,
  totalLessonsInPhase = 1,
  completed = false,
  notes = '',
  lessonQuiz = null,
  quizAttempts = [],
  latestQuizResult = null,
  orderState = {},
  prevLesson = null,
  nextLesson = null,
  phaseUrl = '#',
  courseUrl = '#',
  previewMode = false,
}) {
  const {
    lectureBlocks,
    practicalBlocks,
    inlineChecks,
    supplementaryVideos,
    supplementaryResources,
  } = splitLessonSections(lesson);

  const wordCount = String(notes || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const quizQuestions = lessonQuiz?.questions || [];
  const hasDbQuiz = Boolean(lessonQuiz && quizQuestions.length > 0);
  const attemptsLeft =
    lessonQuiz?.maxAttempts !== null && lessonQuiz?.maxAttempts !== undefined
      ? Math.max(0, Number(lessonQuiz.maxAttempts) - quizAttempts.length)
      : null;
  const isLocked = attemptsLeft !== null && attemptsLeft <= 0;
  const bestPassedAttempt = quizAttempts.find((a) => a.passed && a.reviewStatus !== 'pending_review');

  return `
    <article class="lesson-reader pop-in">
      <!-- 1. Lesson title and course/phase context -->
      <header class="lesson-reader-header">
        <div class="meta-line lesson-reader-context">
          ${courseTitle ? `<span>${escapeHtml(courseTitle)}</span><span class="meta-sep" aria-hidden="true">·</span>` : ''}
          <span>Phase ${phasePosition}${phaseTitle ? `: ${escapeHtml(phaseTitle)}` : ''}</span>
          ${totalLessonsInPhase > 0 ? `<span class="meta-sep" aria-hidden="true">·</span><span>Lesson ${lessonNumber} of ${totalLessonsInPhase}</span>` : ''}
          <span class="meta-sep" aria-hidden="true">·</span>
          <span class="mono-num">${Number(lesson.estMinutes || 25)} min</span>
          <span class="meta-sep" aria-hidden="true">·</span>
          <span>${lesson.isRequired === false ? 'Optional' : 'Required'}</span>
          ${previewMode && lesson.publicationStatus === 'draft' ? `<span class="meta-sep" aria-hidden="true">·</span>${renderStatusBadge('draft')}` : ''}
        </div>
        <h1 class="lesson-reader-title">${escapeHtml(lesson.title || 'Untitled Lesson')}</h1>
      </header>

      <!-- 2. Short lesson introduction -->
      ${
        lesson.introduction
          ? `<section class="lesson-reader-section lesson-reader-intro" aria-label="Lesson introduction">
              <p class="lesson-lead">${renderInlineProseHtml(lesson.introduction)}</p>
            </section>`
          : ''
      }

      <!-- 3. Learning objectives -->
      ${
        lesson.objectives?.length
          ? `<section class="lesson-reader-section lesson-reader-objectives" aria-label="Learning objectives">
              <h2 class="lesson-section-heading">Learning objectives</h2>
              <ul class="lesson-objectives-list">
                ${lesson.objectives.map((o) => `<li>${renderInlineProseHtml(o)}</li>`).join('')}
              </ul>
            </section>`
          : ''
      }

      <!-- 4. Main instructional lecture (Greatest visual emphasis) -->
      <section class="lesson-reader-section lesson-reader-lecture" aria-label="Main instructional lecture">
        <div class="lesson-prose">
          ${
            lectureBlocks.length > 0
              ? renderEditorialLectureHtml(lectureBlocks)
              : '<p class="lesson-prose-p" style="color:var(--color-text-muted);">No lecture content authored yet.</p>'
          }
        </div>
      </section>

      <!-- 5. Practical application or worked example -->
      ${
        practicalBlocks.length > 0
          ? `<section class="lesson-reader-section lesson-reader-practical" aria-label="Practical application">
              <h2 class="lesson-section-heading">Practical application</h2>
              <div class="lesson-practical-surface">
                ${renderEditorialPracticalHtml(practicalBlocks)}
              </div>
            </section>`
          : ''
      }

      <!-- 6. Lesson summary (+ optional supplementary walkthroughs) -->
      ${
        lesson.summary || lesson.takeaways?.length || supplementaryVideos.length > 0 || supplementaryResources.length > 0
          ? `<section class="lesson-reader-section lesson-reader-summary" aria-label="Lesson summary">
              ${
                lesson.summary || lesson.takeaways?.length
                  ? `<h2 class="lesson-section-heading">Lesson summary</h2>
                     ${lesson.summary ? `<p class="lesson-prose-p">${renderInlineProseHtml(lesson.summary)}</p>` : ''}
                     ${
                       lesson.takeaways?.length
                         ? `<ul class="lesson-prose-bullets" style="margin-top:8px;">
                             ${lesson.takeaways.map((t) => `<li>${renderInlineProseHtml(t)}</li>`).join('')}
                           </ul>`
                         : ''
                     }`
                  : ''
              }

              ${
                supplementaryVideos.length > 0
                  ? `<details class="lesson-optional-details" ${previewMode ? 'open' : ''}>
                      <summary>Optional video walkthrough${supplementaryVideos.length > 1 ? `s (${supplementaryVideos.length})` : ''} — supplementary</summary>
                      <div class="lesson-optional-body">
                        ${supplementaryVideos.map((v, idx) => renderVideoPlayerHtml(v, idx)).join('')}
                      </div>
                    </details>`
                  : ''
              }

              ${
                supplementaryResources.length > 0
                  ? `<details class="lesson-optional-details">
                      <summary>Optional supplementary references (${supplementaryResources.length})</summary>
                      <ul class="lesson-prose-bullets" style="margin-top:10px;">
                        ${supplementaryResources
                          .map(
                            (fr) => `<li>
                              ${
                                fr.url
                                  ? `<a href="${escapeHtml(fr.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fr.title || fr.url)}</a>`
                                  : `<span>${escapeHtml(fr.title || 'Reference')}</span>`
                              }
                              ${fr.source ? ` <span style="color:var(--color-text-muted);">(${escapeHtml(fr.source)})</span>` : ''}
                            </li>`
                          )
                          .join('')}
                      </ul>
                    </details>`
                  : ''
              }
            </section>`
          : ''
      }

      <!-- 7. Knowledge assessment -->
      ${
        hasDbQuiz || inlineChecks.length > 0
          ? `<section class="lesson-reader-section lesson-reader-assessment" aria-label="Knowledge assessment">
              <div class="lesson-assessment-head">
                <div>
                  <h2 class="lesson-section-heading" style="margin-bottom:2px;">Knowledge assessment</h2>
                  ${
                    hasDbQuiz
                      ? `<div class="meta-line">
                          <span>${escapeHtml(lessonQuiz?.title || 'Lesson check')}</span>
                          <span class="meta-sep" aria-hidden="true">·</span>
                          <span class="mono-num">Pass: ${lessonQuiz?.passPercent || 70}%</span>
                          <span class="meta-sep" aria-hidden="true">·</span>
                          <span class="mono-num">${quizQuestions.length} ${quizQuestions.length === 1 ? 'question' : 'questions'}</span>
                          ${attemptsLeft !== null ? `<span class="meta-sep" aria-hidden="true">·</span><span class="mono-num">${attemptsLeft} attempts left</span>` : ''}
                        </div>`
                      : `<div class="meta-line"><span>Check your understanding of the concepts above</span></div>`
                  }
                </div>
                ${
                  bestPassedAttempt
                    ? renderStatusBadge('passed')
                    : latestQuizResult
                      ? renderStatusBadge(
                          latestQuizResult.reviewStatus === 'pending_review'
                            ? 'pending_review'
                            : latestQuizResult.passed
                              ? 'passed'
                              : 'failed'
                        )
                      : ''
                }
              </div>

              ${
                hasDbQuiz && latestQuizResult
                  ? `<div class="lesson-assessment-result" aria-live="polite">
                      <div class="mono-num" style="font-weight:700; color:var(--color-navy);">
                        Score: ${latestQuizResult.score}/${latestQuizResult.total} (${latestQuizResult.percentage}%)
                      </div>
                      <div style="font-size:13.5px; color:var(--color-text-secondary);">
                        ${
                          latestQuizResult.reviewStatus === 'pending_review'
                            ? 'Auto-graded items scored; written responses are pending administrator review.'
                            : latestQuizResult.passed
                              ? 'Passed! Assessment progress recorded.'
                              : `Score ${lessonQuiz?.passPercent || 70}% or higher to pass. Review feedback below and try again.`
                        }
                      </div>
                    </div>`
                  : ''
              }

              ${
                hasDbQuiz
                  ? `<form id="lesson-assessment-form" class="lesson-assessment-form">
                      ${quizQuestions
                        .map((q, idx) => {
                          const res = latestQuizResult?.results?.find((r) => r.questionId === q.id);
                          return renderInlineAssessmentQuestion(
                            q,
                            idx,
                            res,
                            lessonQuiz?.id || 'preview',
                            orderState,
                            previewMode
                          );
                        })
                        .join('')}
                      <div class="field-error" id="lesson-assessment-error" role="alert"></div>
                      ${
                        previewMode
                          ? `<div class="lesson-assessment-hint">Preview mode — submissions are disabled.</div>`
                          : `<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                              <button type="submit" class="btn btn-primary btn-sm" id="lesson-assessment-submit" ${isLocked ? 'disabled' : ''}>
                                ${
                                  isLocked
                                    ? `Attempt limit reached (${lessonQuiz?.maxAttempts})`
                                    : latestQuizResult
                                      ? 'Resubmit assessment'
                                      : 'Submit answers'
                                }
                              </button>
                            </div>`
                      }
                    </form>
                    ${
                      !previewMode && quizAttempts.length > 0
                        ? `<details class="lesson-optional-details" style="margin-top:12px;">
                            <summary>Previous attempts (${quizAttempts.length})</summary>
                            <div class="divider-list" style="margin-top:8px;">
                              ${quizAttempts
                                .slice(0, 5)
                                .map(
                                  (a) => `<div class="divider-row" style="padding:6px 0;">
                                    <span class="mono-num" style="font-size:13px;">${a.score}/${a.total} (${a.percentage}%)</span>
                                    <span style="font-size:12.5px; color:var(--color-text-muted);">${formatDateTime(a.createdAt)}</span>
                                    ${renderStatusBadge(
                                      a.reviewStatus === 'pending_review'
                                        ? 'pending_review'
                                        : a.passed
                                          ? 'passed'
                                          : 'failed'
                                    )}
                                  </div>`
                                )
                                .join('')}
                            </div>
                          </details>`
                        : ''
                    }`
                  : `<div class="lesson-assessment-form">
                      ${inlineChecks
                        .map((blk, idx) => {
                          const kcId = escapeHtml(blk.id || `kc-${idx}`);
                          return `
                            <div class="lesson-assessment-question" data-inline-kc="${kcId}" data-correct="${Number(blk.correctIndex || 0)}" data-explanation="${escapeHtml(blk.explanation || 'Review the lecture above.')}">
                              <div class="lesson-assessment-prompt"><span class="mono-num">${idx + 1}.</span> ${escapeHtml(blk.prompt || '')}</div>
                              <div class="lesson-assessment-options">
                                ${(blk.options || [])
                                  .map(
                                    (opt, oIdx) => `
                                  <label class="quiz-option">
                                    <input type="radio" name="inline_kc_${kcId}" value="${oIdx}" ${previewMode ? 'disabled' : ''} />
                                    <span>${escapeHtml(opt)}</span>
                                  </label>
                                `
                                  )
                                  .join('')}
                              </div>
                              ${
                                previewMode
                                  ? ''
                                  : `<div style="display:flex; align-items:center; gap:10px; margin-top:8px; flex-wrap:wrap;">
                                      <button type="button" class="btn btn-secondary btn-sm" data-check-kc="${kcId}">Check answer</button>
                                      <span data-kc-feedback="${kcId}" style="font-size:13px;"></span>
                                    </div>`
                              }
                            </div>
                          `;
                        })
                        .join('')}
                    </div>`
              }
            </section>`
          : ''
      }

      <!-- 8. Completion status and navigation to the next lesson -->
      <footer class="lesson-reader-section lesson-reader-footer" aria-label="Lesson completion and navigation">
        <div class="lesson-completion-bar">
          <div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <strong style="color:var(--color-navy); font-size:0.95rem;">Completion status</strong>
              ${renderStatusBadge(completed ? 'completed' : 'not_started')}
            </div>
            ${
              lesson.completionCriteria
                ? `<p style="font-size:13.5px; color:var(--color-text-secondary); margin:4px 0 0;">${escapeHtml(lesson.completionCriteria)}</p>`
                : ''
            }
          </div>
          ${
            previewMode
              ? ''
              : `<button type="button" class="btn ${completed ? 'btn-secondary' : 'btn-primary'}" id="toggle-lesson-complete">
                  ${completed ? 'Mark lesson incomplete' : 'Mark lesson complete'}
                </button>`
          }
        </div>

        ${
          previewMode
            ? ''
            : `<details class="lesson-optional-details" style="margin-top:14px;">
                <summary>Study notes (${wordCount} words · saved automatically)</summary>
                <div style="margin-top:10px;">
                  <div style="display:flex; justify-content:flex-end; margin-bottom:6px;">
                    <span id="notes-save-status" style="font-size:12px; color:var(--color-text-muted);">
                      ${wordCount} words · ${notes ? 'Saved' : 'Ready'}
                    </span>
                  </div>
                  <textarea class="textarea" id="lesson-notes" style="min-height:90px;" placeholder="Summarize key concepts or capture your action steps from this lesson…">${escapeHtml(notes || '')}</textarea>
                </div>
              </details>`
        }

        ${
          previewMode
            ? ''
            : `<nav class="lesson-nav-footer" aria-label="Lesson sequence navigation">
                <div>
                  ${
                    prevLesson
                      ? `<a href="${escapeHtml(prevLesson.url)}" data-link class="btn btn-secondary btn-sm">${escapeHtml(prevLesson.label)}</a>`
                      : `<a href="${escapeHtml(phaseUrl)}" data-link class="btn btn-secondary btn-sm">← Phase overview</a>`
                  }
                </div>
                <div>
                  ${
                    nextLesson
                      ? `<a href="${escapeHtml(nextLesson.url)}" data-link class="btn btn-navy btn-sm">${escapeHtml(nextLesson.label)}</a>`
                      : `<a href="${escapeHtml(phaseUrl)}" data-link class="btn btn-navy btn-sm">Finish &amp; return to phase →</a>`
                  }
                </div>
                <div style="width:100%; display:flex; justify-content:center; gap:16px; padding-top:4px; font-size:13px;">
                  <a href="${escapeHtml(phaseUrl)}" data-link>Phase overview</a>
                  <a href="${escapeHtml(courseUrl)}" data-link>Course overview</a>
                </div>
              </nav>`
        }
      </footer>
    </article>
  `;
}

/**
 * Binds interactive controls rendered by `renderLessonReaderHtml`:
 * - Video fallback toggles
 * - Inline legacy knowledge checks
 * - Inline DB quiz ordering, validation, and submission
 * - Autosaved study notes
 * - Lesson completion toggle
 *
 * @param {HTMLElement} root
 * @param {{
 *   lessonQuiz?: import('../types/kord.d.ts').Quiz | null;
 *   orderState?: Record<string, number[]>;
 *   onSubmitQuiz?: (answersMap: Record<string, unknown>) => Promise<void>;
 *   onSaveNotes?: (value: string) => Promise<void>;
 *   onToggleComplete?: () => Promise<void>;
 *   onError?: (msg: string) => void;
 * }} handlers
 */
export function bindLessonReader(
  root,
  { lessonQuiz = null, orderState = {}, onSubmitQuiz, onSaveNotes, onToggleComplete, onError } = {}
) {
  // Video playback help toggle
  root.querySelectorAll('[data-video-fallback-toggle]').forEach((node) => {
    const btn = /** @type {HTMLElement} */ (node);
    btn.addEventListener('click', () => {
      const helpEl = /** @type {HTMLElement | null} */ (
        root.querySelector(`#video-help-${btn.dataset.videoFallbackToggle}`)
      );
      if (helpEl) {
        helpEl.style.display = helpEl.style.display === 'none' ? 'block' : 'none';
      }
    });
  });

  // Legacy inline knowledge_check handler
  root.querySelectorAll('[data-check-kc]').forEach((node) => {
    const btn = /** @type {HTMLElement} */ (node);
    btn.addEventListener('click', () => {
      const kcId = btn.dataset.checkKc;
      const box = /** @type {HTMLElement | null} */ (root.querySelector(`[data-inline-kc="${kcId}"]`));
      const feedback = /** @type {HTMLElement | null} */ (root.querySelector(`[data-kc-feedback="${kcId}"]`));
      if (!box || !feedback) return;
      const selected = /** @type {HTMLInputElement | null} */ (
        box.querySelector(`input[name="inline_kc_${kcId}"]:checked`)
      );
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
        : `Not quite. ${box.dataset.explanation || 'Review the lecture above.'}`;
    });
  });

  // DB-backed Lesson Assessment handler
  const quizQuestions = lessonQuiz?.questions || [];
  const form = /** @type {HTMLFormElement | null} */ (root.querySelector('#lesson-assessment-form'));
  const errEl = /** @type {HTMLElement | null} */ (root.querySelector('#lesson-assessment-error'));
  const submitBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#lesson-assessment-submit'));

  if (form && lessonQuiz && quizQuestions.length > 0 && onSubmitQuiz) {
    /** @param {Element} container */
    const attachOrderControls = (container) => {
      container.querySelectorAll('[data-lq-move]').forEach((node) => {
        const moveBtn = /** @type {HTMLButtonElement} */ (node);
        moveBtn.addEventListener('click', () => {
          const qId = moveBtn.dataset.lqMove || '';
          const pos = Number(moveBtn.dataset.pos);
          const dir = Number(moveBtn.dataset.dir);
          const key = `${lessonQuiz.id}:${qId}`;
          const arr = orderState[key];
          if (!arr) return;
          const target = pos + dir;
          if (target < 0 || target >= arr.length) return;
          [arr[pos], arr[target]] = [arr[target], arr[pos]];
          const q = quizQuestions.find((x) => x.id === qId);
          const listEl = form.querySelector(`[data-lq-order-list="${qId}"]`);
          if (listEl && q) {
            listEl.innerHTML = arr
              .map(
                (optIdx, i) => `
              <div class="order-item-row" data-order-idx="${optIdx}">
                <span><strong class="mono-num">${i + 1}.</strong> ${escapeHtml(q.options?.[optIdx] || '')}</span>
                <div style="display:flex; gap:4px;">
                  <button type="button" class="btn btn-secondary btn-sm" data-lq-move="${escapeHtml(q.id)}" data-pos="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>Up</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-lq-move="${escapeHtml(q.id)}" data-pos="${i}" data-dir="1" ${i === arr.length - 1 ? 'disabled' : ''}>Down</button>
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
    attachOrderControls(form);

    form.addEventListener('change', () => {
      quizQuestions.forEach((q) => {
        form.querySelectorAll(`input[name="lq_${q.id}"]`).forEach((node) => {
          const inp = /** @type {HTMLInputElement} */ (node);
          inp.closest('.quiz-option')?.classList.toggle('is-selected', inp.checked);
        });
      });
      if (errEl) errEl.textContent = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errEl) errEl.textContent = '';
      /** @type {Record<string, unknown>} */
      const answersMap = {};
      /** @type {number[]} */
      const missing = [];

      quizQuestions.forEach((q, idx) => {
        const type = q.questionType || 'multiple_choice';
        if (type === 'multiple_select') {
          const checked = [...form.querySelectorAll(`input[name="lq_${q.id}"]:checked`)].map((c) =>
            Number(/** @type {HTMLInputElement} */ (c).value)
          );
          if (checked.length > 0) answersMap[q.id] = checked;
          else missing.push(idx + 1);
        } else if (type === 'fill_blank' || isManualQuestionType(type)) {
          const inp = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (
            form.querySelector(`[data-lq-input="${q.id}"]`)
          );
          const val = inp ? inp.value.trim() : '';
          if (val) answersMap[q.id] = val;
          else missing.push(idx + 1);
        } else if (type === 'ordering') {
          const key = `${lessonQuiz.id}:${q.id}`;
          answersMap[q.id] = (orderState[key] || []).slice();
        } else {
          const checked = /** @type {HTMLInputElement | null} */ (
            form.querySelector(`input[name="lq_${q.id}"]:checked`)
          );
          if (checked) answersMap[q.id] = Number(checked.value);
          else missing.push(idx + 1);
        }
      });

      if (missing.length > 0) {
        if (errEl) errEl.textContent = `Please answer question(s) ${missing.join(', ')} before submitting.`;
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
      }
      try {
        await onSubmitQuiz(answersMap);
      } catch (err) {
        if (errEl) errEl.textContent = err instanceof Error ? err.message : 'Unable to submit answers.';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit answers';
        }
      }
    });
  }

  // Study notes autosave
  const notesEl = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('#lesson-notes'));
  const statusEl = /** @type {HTMLElement | null} */ (root.querySelector('#notes-save-status'));
  /** @type {number | undefined} */
  let saveTimer;
  if (notesEl && onSaveNotes) {
    notesEl.addEventListener('input', () => {
      const words = notesEl.value.trim().split(/\s+/).filter(Boolean).length;
      if (statusEl) statusEl.textContent = `${words} words · Saving…`;
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async () => {
        try {
          await onSaveNotes(notesEl.value);
          if (statusEl) statusEl.textContent = `${words} words · Saved`;
        } catch (err) {
          if (statusEl) statusEl.textContent = `${words} words · Save failed`;
          onError?.(err instanceof Error ? err.message : 'Unable to save notes.');
        }
      }, 300);
    });
  }

  // Completion toggle
  const completeBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#toggle-lesson-complete'));
  if (completeBtn && onToggleComplete) {
    completeBtn.addEventListener('click', async () => {
      if (completeBtn.disabled) return;
      completeBtn.disabled = true;
      try {
        await onToggleComplete();
      } catch (err) {
        completeBtn.disabled = false;
        onError?.(err instanceof Error ? err.message : 'Unable to update lesson status.');
      }
    });
  }
}
