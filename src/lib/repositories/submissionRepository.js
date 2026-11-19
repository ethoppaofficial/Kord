import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { upgradeSkillLevel } from './skillsRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';

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

  return getDemoState()
    .submissions.filter((s) => s.userId === userId && (!challengeId || s.challengeId === challengeId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function submitChallengeEvidence({ userId, challengeId, evidenceUrl, file, explanation, rubricMax, idempotencyKey }) {
  const effectiveKey =
    idempotencyKey ||
    buildIdempotencyKey(
      'challenge-submit',
      userId,
      challengeId,
      evidenceUrl || '',
      file?.name || '',
      explanation
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
              evidence_url: evidenceUrl || null,
              file_path: filePath,
              file_name: fileName,
              explanation,
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

      const existing = getDemoState().submissions.find(
        (s) => s.userId === userId && s.idempotencyKey === effectiveKey
      );
      if (existing) return existing;

      const filePath = file ? `${userId}/${challengeId}/${file.name}` : null;
      const newSub = {
        id: `sub-${Date.now()}`,
        userId,
        challengeId,
        evidenceUrl: evidenceUrl?.trim() || null,
        filePath,
        fileName: file ? file.name : null,
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
  return `#demo-private-evidence:${filePath}`;
}

export async function adminListSubmissions() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('submissions')
      .select('*, profiles!submissions_user_id_fkey(full_name, email), challenges(title, rubric, skill_id)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map((row) => ({
      ...mapSubmission(row),
      learnerName: row.profiles?.full_name || 'Learner',
      learnerEmail: row.profiles?.email || '',
      challenge: row.challenges,
    }));
  }

  const state = getDemoState();
  return state.submissions
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((sub) => {
      const learner = state.users.find((u) => u.id === sub.userId);
      const challenge = state.challenges.find((c) => c.id === sub.challengeId);
      const skill = challenge ? state.skills.find((s) => s.id === challenge.skillId) : null;
      return {
        ...sub,
        learnerName: learner?.fullName || 'Learner',
        learnerEmail: learner?.email || '',
        challenge,
        skillTitle: skill?.title || '',
      };
    });
}

export async function adminReviewSubmission({ submissionId, reviewerId, status, rubricScores, rubricTotal, rubricMax, feedback }) {
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

    updateDemoState((draft) => {
      const sub = draft.submissions.find((s) => s.id === submissionId);
      if (!sub) throw new Error('Submission not found');
      sub.status = status;
      sub.rubricScores = rubricScores;
      sub.rubricTotal = rubricTotal;
      sub.rubricMax = rubricMax;
      sub.feedback = feedback.trim();
      sub.reviewedBy = reviewerId;
      sub.reviewedAt = new Date().toISOString();

      targetUserId = sub.userId;
      const challenge = draft.challenges.find((c) => c.id === sub.challengeId);
      targetSkillId = challenge?.skillId || null;
      return draft;
    });

    if (status === 'approved' && targetUserId && targetSkillId) {
      await upgradeSkillLevel(targetUserId, targetSkillId, 'verified');
    }
  });
}

function mapSubmission(s) {
  return {
    id: s.id,
    userId: s.user_id,
    challengeId: s.challenge_id,
    evidenceUrl: s.evidence_url,
    filePath: s.file_path,
    fileName: s.file_name,
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
