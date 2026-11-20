import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { upgradeSkillLevel } from './skillsRepository.js';
import { recomputeCourseAndSkillStatus } from './progressRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';
import { validateEvidenceFile } from '../validators.js';

export async function getUserSubmissions(userId, challengeId = null) {
  if (!isDemoMode && supabase) {
    let query = supabase
      .from('submissions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (challengeId) query = query.eq('challenge_id', challengeId);
    const { data, error } = await query;
    if (error) throw error;
    return data.map(mapSubmission);
  }

  return (getDemoState().submissions || [])
    .filter((s) => s.userId === userId && (!challengeId || s.challengeId === challengeId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function submitChallengeEvidence({
  userId,
  challengeId,
  courseId = null,
  evidenceUrl,
  repoUrl = '',
  file,
  submissionText = '',
  explanation,
  rubricMax,
  challenge = null,
  idempotencyKey,
}) {
  const cleanExplanation = String(explanation || '').trim();
  if (cleanExplanation.length < 20) {
    throw new Error('Explain what you produced and how it meets the brief (at least 20 characters).');
  }
  const hasAnyDeliverable = Boolean(
    (evidenceUrl && evidenceUrl.trim()) ||
      (repoUrl && repoUrl.trim()) ||
      file ||
      (submissionText && submissionText.trim().length >= 20)
  );
  if (!hasAnyDeliverable) {
    throw new Error('Provide at least one permitted deliverable (URL, file upload, or written response).');
  }
  if (file) {
    const fileErr = validateEvidenceFile(file, challenge || {});
    if (fileErr) throw new Error(fileErr);
  }

  const effectiveKey =
    idempotencyKey ||
    buildIdempotencyKey(
      'challenge-submit',
      userId,
      challengeId,
      evidenceUrl || '',
      repoUrl || '',
      file?.name || '',
      submissionText || '',
      cleanExplanation
    );

  return runIdempotent(
    effectiveKey,
    async () => {
      if (!isDemoMode && supabase) {
        let filePath = null;
        let fileName = null;
        if (file) {
          fileName = file.name;
          filePath = `${userId}/${challengeId}/${Date.now()}-${file.name}`;
          const { error: uploadErr } = await supabase.storage.from('evidence').upload(filePath, file);
          if (uploadErr) throw uploadErr;
        }

        const { data, error } = await supabase
          .from('submissions')
          .upsert(
            {
              user_id: userId,
              challenge_id: challengeId,
              course_id: courseId || null,
              evidence_url: evidenceUrl || null,
              repo_url: repoUrl || null,
              file_path: filePath,
              file_name: fileName,
              submission_text: submissionText || '',
              explanation: cleanExplanation,
              rubric_max: rubricMax || 20,
              idempotency_key: effectiveKey,
            },
            { onConflict: 'user_id,idempotency_key' }
          )
          .select()
          .single();
        if (error) throw error;
        return mapSubmission(data);
      }

      const state = getDemoState();
      const actor = (state.users || []).find((u) => u.id === userId);
      if (!actor || actor.role === 'admin') {
        throw new Error('Learner account required to submit practical evidence.');
      }

      const existing = (state.submissions || []).find(
        (s) => s.userId === userId && s.idempotencyKey === effectiveKey
      );
      if (existing) return existing;

      const resolvedChallenge = challenge || (state.challenges || []).find((c) => c.id === challengeId);
      if (!resolvedChallenge) throw new Error('Practical challenge not found.');

      const targetCourseId = courseId || resolvedChallenge.courseId || null;
      if (targetCourseId) {
        const course = (state.courses || []).find((c) => c.id === targetCourseId);
        if (!course || course.publicationStatus !== 'published') {
          throw new Error('Course practical challenge is not currently published.');
        }
        const enrolled = (state.courseEnrollments || []).some(
          (e) => e.userId === userId && e.courseId === targetCourseId && (e.status === 'active' || e.status === 'completed')
        );
        if (!enrolled) {
          throw new Error('Active course enrollment required before submitting practical evidence.');
        }
      }

      if (file) {
        const fileErr = validateEvidenceFile(file, resolvedChallenge);
        if (fileErr) throw new Error(fileErr);
      }

      const filePath = file ? `${userId}/${challengeId}/${file.name}` : null;
      const newSub = {
        id: `sub-${Date.now()}`,
        userId,
        challengeId,
        courseId: courseId || resolvedChallenge?.courseId || null,
        evidenceUrl: evidenceUrl?.trim() || null,
        repoUrl: repoUrl?.trim() || null,
        filePath,
        fileName: file ? file.name : null,
        submissionText: String(submissionText || '').trim(),
        explanation: explanation.trim(),
        status: 'pending',
        rubricScores: {},
        rubricTotal: null,
        rubricMax: rubricMax || 20,
        feedback: '',
        reviewedBy: null,
        reviewedAt: null,
        idempotencyKey: effectiveKey,
        createdAt: new Date().toISOString(),
      };

      updateDemoState((draft) => {
        draft.submissions = draft.submissions || [];
        draft.submissions.unshift(newSub);
        return draft;
      });
      return newSub;
    },
    { cacheResult: true }
  );
}

export async function getSignedEvidenceUrl(filePath) {
  if (!filePath) return null;
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.storage.from('evidence').createSignedUrl(filePath, 120);
    if (error) throw error;
    return data.signedUrl;
  }
  return `#private-evidence:${filePath}`;
}

export async function adminListSubmissions() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('submissions')
      .select('*, profiles!submissions_user_id_fkey(full_name, email), challenges(title, rubric, skill_id, course_id)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => ({
      ...mapSubmission(row),
      learnerName: row.profiles?.full_name || 'Learner',
      learnerEmail: row.profiles?.email || '',
      challenge: row.challenges,
    }));
  }

  const state = getDemoState();
  return (state.submissions || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((sub) => {
      const learner = (state.users || []).find((u) => u.id === sub.userId);
      const challenge = (state.challenges || []).find((c) => c.id === sub.challengeId);
      const skill = challenge ? (state.skills || []).find((s) => s.id === challenge.skillId) : null;
      const course = challenge?.courseId
        ? (state.courses || []).find((c) => c.id === challenge.courseId)
        : null;
      return {
        ...sub,
        learnerName: learner?.fullName || 'Learner',
        learnerEmail: learner?.email || '',
        challenge,
        skillTitle: skill?.title || '',
        courseTitle: course?.title || '',
      };
    });
}

export async function adminReviewSubmission({
  submissionId,
  reviewerId,
  status,
  rubricScores,
  rubricTotal,
  rubricMax,
  feedback,
}) {
  const key = buildIdempotencyKey('admin-review', submissionId, status, rubricTotal, feedback);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('review_submission', {
        p_submission_id: submissionId,
        p_status: status,
        p_rubric_scores: rubricScores,
        p_rubric_total: rubricTotal,
        p_rubric_max: rubricMax,
        p_feedback: feedback,
      });
      if (error) throw error;
      return mapSubmission(data);
    }

    let targetUserId = null;
    let targetSkillId = null;
    let targetCourseId = null;

    updateDemoState((draft) => {
      if (!['approved', 'needs_revision'].includes(status)) {
        throw new Error('Invalid review status. Must be approved or needs_revision.');
      }
      const reviewer = (draft.users || []).find((u) => u.id === reviewerId);
      if (!reviewer || reviewer.role !== 'admin') {
        throw new Error('Administrator authorization required to review practical submissions.');
      }

      const sub = (draft.submissions || []).find((s) => s.id === submissionId);
      if (!sub) throw new Error('Submission not found');
      if (sub.userId === reviewerId) {
        throw new Error('Reviewers cannot approve or evaluate their own submissions.');
      }

      const challenge = (draft.challenges || []).find((c) => c.id === sub.challengeId);
      let validatedTotal = 0;
      let validatedMax = 0;
      const cleanScores = {};

      if (challenge && Array.isArray(challenge.rubric) && challenge.rubric.length > 0) {
        for (const criterion of challenge.rubric) {
          const maxPts = Math.max(1, Number(criterion.maxPoints || 5));
          const rawScore = Number(rubricScores?.[criterion.id] ?? 0);
          if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > maxPts) {
            throw new Error(
              `Rubric score for "${criterion.label || criterion.id}" must be between 0 and ${maxPts}.`
            );
          }
          cleanScores[criterion.id] = rawScore;
          validatedTotal += rawScore;
          validatedMax += maxPts;
        }
      } else {
        validatedTotal = Math.max(0, Number(rubricTotal || 0));
        validatedMax = Math.max(1, Number(rubricMax || challenge?.maxScore || 20));
        if (validatedTotal > validatedMax) {
          throw new Error('Rubric total score cannot exceed maximum score.');
        }
        Object.assign(cleanScores, rubricScores || {});
      }

      sub.status = status;
      sub.rubricScores = cleanScores;
      sub.rubricTotal = validatedTotal;
      sub.rubricMax = validatedMax;
      sub.feedback = String(feedback || '').trim();
      sub.reviewedBy = reviewerId;
      sub.reviewedAt = new Date().toISOString();

      targetUserId = sub.userId;
      targetSkillId = challenge?.skillId || null;
      targetCourseId = sub.courseId || challenge?.courseId || null;
      return draft;
    });

    if (status === 'approved' && targetUserId) {
      if (targetCourseId) {
        await recomputeCourseAndSkillStatus(targetUserId, targetCourseId);
      } else if (targetSkillId) {
        await upgradeSkillLevel(targetUserId, targetSkillId, 'demonstrated');
      }
    }
  });
}

function mapSubmission(s) {
  return {
    id: s.id,
    userId: s.user_id,
    challengeId: s.challenge_id,
    courseId: s.course_id || null,
    evidenceUrl: s.evidence_url,
    repoUrl: s.repo_url || null,
    filePath: s.file_path,
    fileName: s.file_name,
    submissionText: s.submission_text || '',
    explanation: s.explanation,
    status: s.status,
    rubricScores: s.rubric_scores || {},
    rubricTotal: s.rubric_total,
    rubricMax: s.rubric_max,
    feedback: s.feedback || '',
    reviewedBy: s.reviewed_by,
    reviewedAt: s.reviewed_at,
    createdAt: s.created_at,
  };
}
