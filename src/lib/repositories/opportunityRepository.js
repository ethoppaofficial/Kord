import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { PROGRESSION_RANK, PROGRESSION_WEIGHT, PROGRESSION_LABEL } from '../constants.js';
import { getUserSkills } from './skillsRepository.js';
import { listSkills } from './contentRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';

export function getMatchTier(pct) {
  if (pct >= 80) return 'Strong match';
  if (pct >= 60) return 'Good match';
  if (pct >= 35) return 'Developing match';
  return 'Early match';
}

export async function listOpportunities() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('opportunities')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map((o) => ({
      id: o.id,
      title: o.title,
      organization: o.organization,
      opportunityType: o.opportunity_type,
      workMode: o.work_mode,
      location: o.location,
      summary: o.summary,
      aboutRole: o.about_role || o.summary,
      responsibilities: o.responsibilities || [],
      requirements: o.requirements || [],
      requiredSkills: o.required_skills || [],
      requiredSkillSlugs: o.required_skill_slugs || [],
      otherInfo: o.other_info || {},
      orgTips: o.org_tips || {},
      isSample: o.is_sample,
      applyUrl: o.apply_url,
    }));
  }
  return getDemoState().opportunities;
}

function getSkillEvidenceForUser(userId, skillId, state) {
  const quizzes = state.quizzes.filter((q) => q.skillId === skillId);
  const quizIds = new Set(quizzes.map((q) => q.id));
  const attempts = state.quizAttempts.filter(
    (qa) => qa.userId === userId && quizIds.has(qa.quizId)
  );
  const bestQuizPct =
    attempts.length > 0 ? Math.max(...attempts.map((a) => Number(a.percentage || 0))) : 0;

  const challenges = state.challenges.filter((c) => c.skillId === skillId);
  const chalIds = new Set(challenges.map((c) => c.id));
  const reviewedSubs = state.submissions.filter(
    (s) =>
      s.userId === userId &&
      chalIds.has(s.challengeId) &&
      s.status === 'approved' &&
      s.rubricTotal !== null &&
      s.rubricMax
  );
  const bestReviewedPct =
    reviewedSubs.length > 0
      ? Math.max(...reviewedSubs.map((s) => Math.round((s.rubricTotal / s.rubricMax) * 100)))
      : 0;

  return { bestQuizPct, bestReviewedPct };
}

function computeSkillRowScore({ skill, neededLevel, userLevel, bestQuizPct, bestReviewedPct }) {
  const neededRank = PROGRESSION_RANK[neededLevel] || 2;
  const userRank = userLevel ? PROGRESSION_RANK[userLevel] || 0 : 0;

  if (!userLevel || userRank < neededRank) {
    return {
      slug: skill.slug,
      skillId: skill.id,
      title: skill.title,
      skillCheckQuizId: skill.skillCheckQuizId || null,
      challengeId: skill.challengeId || null,
      neededLevel,
      neededLabel: PROGRESSION_LABEL[neededLevel] || 'Practising',
      userLevel: userLevel || null,
      userLabel: userLevel ? PROGRESSION_LABEL[userLevel] : 'Not started',
      levelPart: 0,
      evidencePart: 0,
      skillScore: 0,
      bestQuizPct,
      bestReviewedPct,
      isMissing: true,
    };
  }

  const weight = PROGRESSION_WEIGHT[userLevel] || 0.3;
  const levelPart = weight * 0.7;
  const evidenceAvg = (bestQuizPct + bestReviewedPct) / 2 / 100;
  const evidencePart = evidenceAvg * 0.3;
  const skillScore = Math.round((levelPart + evidencePart) * 100);

  return {
    slug: skill.slug,
    skillId: skill.id,
    title: skill.title,
    skillCheckQuizId: skill.skillCheckQuizId || null,
    challengeId: skill.challengeId || null,
    neededLevel,
    neededLabel: PROGRESSION_LABEL[neededLevel] || 'Practising',
    userLevel,
    userLabel: PROGRESSION_LABEL[userLevel] || 'Declared',
    levelPart: Number(levelPart.toFixed(2)),
    evidencePart: Number(evidencePart.toFixed(2)),
    skillScore,
    bestQuizPct,
    bestReviewedPct,
    isMissing: false,
  };
}

export async function listRankedOpportunities(userId) {
  const [opportunities, skills, userSkills] = await Promise.all([
    listOpportunities(),
    listSkills(),
    userId ? getUserSkills(userId) : Promise.resolve([]),
  ]);

  let evidenceState = null;
  if (!isDemoMode && supabase) {
    const [
      { data: quizzesData, error: quizzesErr },
      { data: challengesData, error: challengesErr },
      attemptsRes,
      submissionsRes,
    ] = await Promise.all([
      userId
        ? supabase.from('quizzes').select('id, skill_id, quiz_type')
        : Promise.resolve({ data: [], error: null }),
      userId
        ? supabase.from('challenges').select('id, skill_id')
        : Promise.resolve({ data: [], error: null }),
      userId
        ? supabase.from('quiz_attempts').select('quiz_id, percentage').eq('user_id', userId)
        : Promise.resolve({ data: [], error: null }),
      userId
        ? supabase
            .from('submissions')
            .select('challenge_id, status, rubric_total, rubric_max')
            .eq('user_id', userId)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (quizzesErr) throw quizzesErr;
    if (challengesErr) throw challengesErr;
    if (attemptsRes.error) throw attemptsRes.error;
    if (submissionsRes.error) throw submissionsRes.error;

    evidenceState = {
      quizzes: (quizzesData || []).map((q) => ({
        id: q.id,
        skillId: q.skill_id,
        quizType: q.quiz_type,
      })),
      challenges: (challengesData || []).map((c) => ({
        id: c.id,
        skillId: c.skill_id,
      })),
      quizAttempts: (attemptsRes.data || []).map((a) => ({
        userId,
        quizId: a.quiz_id,
        percentage: a.percentage,
      })),
      submissions: (submissionsRes.data || []).map((s) => ({
        userId,
        challengeId: s.challenge_id,
        status: s.status,
        rubricTotal: s.rubric_total,
        rubricMax: s.rubric_max,
      })),
    };
  } else {
    evidenceState = getDemoState();
  }

  const skillBySlug = new Map(skills.map((s) => [s.slug, s]));
  const userSkillBySkillId = new Map(userSkills.map((us) => [us.skillId, us]));

  return opportunities
    .map((opp) => {
      const reqDefs =
        Array.isArray(opp.requiredSkills) && opp.requiredSkills.length > 0
          ? opp.requiredSkills
          : (opp.requiredSkillSlugs || []).map((slug) => ({ slug, neededLevel: 'practising' }));

      const breakdown = [];
      const matchedSkills = [];
      const missingSkills = [];

      reqDefs.forEach((def) => {
        const rawSkill = skillBySlug.get(def.slug) || {
          id: def.slug,
          slug: def.slug,
          title: def.slug,
        };
        const skillQuiz =
          evidenceState &&
          ((evidenceState.quizzes || []).find((q) => q.skillId === rawSkill.id && q.quizType === 'skill_check') ||
            (evidenceState.quizzes || []).find((q) => q.skillId === rawSkill.id));
        const skillChallenge =
          evidenceState && (evidenceState.challenges || []).find((c) => c.skillId === rawSkill.id);
        const skill = {
          ...rawSkill,
          skillCheckQuizId: rawSkill.skillCheckQuizId || skillQuiz?.id || null,
          challengeId: rawSkill.challengeId || skillChallenge?.id || null,
        };

        const userSkill = userSkillBySkillId.get(skill.id);
        const evidence =
          userId && evidenceState
            ? getSkillEvidenceForUser(userId, skill.id, evidenceState)
            : { bestQuizPct: 0, bestReviewedPct: 0 };

        const row = computeSkillRowScore({
          skill,
          neededLevel: def.neededLevel || 'practising',
          userLevel: userSkill?.level || null,
          bestQuizPct: evidence.bestQuizPct,
          bestReviewedPct: evidence.bestReviewedPct,
        });

        breakdown.push(row);
        if (row.isMissing) {
          missingSkills.push({ slug: skill.slug, title: skill.title, neededLabel: row.neededLabel });
        } else {
          matchedSkills.push({ slug: skill.slug, title: skill.title, level: row.userLevel, label: row.userLabel });
        }
      });

      const matchPercent =
        breakdown.length > 0
          ? Math.round(breakdown.reduce((acc, r) => acc + r.skillScore, 0) / breakdown.length)
          : 0;

      // Compute projected match lift if the lowest-scoring skill reaches Demonstrated (or Verified)
      const sortedLowest = breakdown.slice().sort((a, b) => a.skillScore - b.skillScore);
      const focusRow = sortedLowest[0] || null;
      let projectedMatchPercent = matchPercent;
      let projectedTargetLabel = 'Demonstrated';

      if (focusRow && breakdown.length > 0) {
        const currentRank = focusRow.userLevel ? PROGRESSION_RANK[focusRow.userLevel] || 0 : 0;
        const targetLevel = currentRank >= 3 ? 'verified' : 'demonstrated';
        projectedTargetLabel = PROGRESSION_LABEL[targetLevel];
        const simulatedRow = computeSkillRowScore({
          skill: {
            id: focusRow.skillId,
            slug: focusRow.slug,
            title: focusRow.title,
            skillCheckQuizId: focusRow.skillCheckQuizId,
            challengeId: focusRow.challengeId,
          },
          neededLevel: focusRow.neededLevel,
          userLevel: targetLevel,
          bestQuizPct: Math.max(focusRow.bestQuizPct, 75),
          bestReviewedPct: targetLevel === 'verified' ? Math.max(focusRow.bestReviewedPct, 80) : focusRow.bestReviewedPct,
        });
        const totalWithoutFocus = breakdown
          .filter((r) => r.slug !== focusRow.slug)
          .reduce((sum, r) => sum + r.skillScore, 0);
        projectedMatchPercent = Math.round((totalWithoutFocus + simulatedRow.skillScore) / breakdown.length);
      }

      return {
        ...opp,
        matchPercent,
        matchTier: getMatchTier(matchPercent),
        breakdown,
        matchedSkills,
        missingSkills,
        focusSkill: focusRow,
        projectedMatchPercent,
        projectedTargetLabel,
      };
    })
    .sort((a, b) => b.matchPercent - a.matchPercent);
}

export async function getOpportunityByIdForUser(oppId, userId) {
  const ranked = await listRankedOpportunities(userId);
  return ranked.find((o) => o.id === oppId) || null;
}

export async function adminUpsertOpportunity(payload) {
  const key = buildIdempotencyKey('admin-opp', payload.id || payload.title, payload.organization);
  return runIdempotent(key, async () => {
    const reqSlugs = payload.requiredSkillSlugs || [];
    const reqSkills = reqSlugs.map((slug) => ({ slug, neededLevel: 'practising' }));

    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('opportunities')
        .upsert({
          id: payload.id || undefined,
          title: payload.title,
          organization: payload.organization,
          opportunity_type: payload.opportunityType,
          work_mode: payload.workMode,
          location: payload.location,
          summary: payload.summary,
          about_role: payload.aboutRole || payload.summary,
          responsibilities: payload.responsibilities || [],
          requirements: payload.requirements || [],
          required_skills: reqSkills,
          required_skill_slugs: reqSlugs,
          other_info: payload.otherInfo || {},
          org_tips: payload.orgTips || {},
          is_sample: payload.isSample !== false,
          apply_url: payload.applyUrl || '',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const existing = payload.id
        ? draft.opportunities.find((o) => o.id === payload.id)
        : draft.opportunities.find(
            (o) =>
              o.title.toLowerCase() === payload.title.trim().toLowerCase() &&
              o.organization.toLowerCase() === payload.organization.trim().toLowerCase()
          );

      const enriched = {
        title: payload.title.trim(),
        organization: payload.organization.trim(),
        opportunityType: payload.opportunityType,
        workMode: payload.workMode,
        location: payload.location.trim(),
        summary: payload.summary.trim(),
        aboutRole: payload.aboutRole?.trim() || payload.summary.trim(),
        responsibilities: payload.responsibilities?.length
          ? payload.responsibilities
          : ['Deliver structured updates and collaborate across core project milestones.'],
        requirements: payload.requirements?.length
          ? payload.requirements
          : ['Demonstrated readiness across the mapped Kord skill roadmaps.'],
        requiredSkills: reqSkills,
        requiredSkillSlugs: reqSlugs,
        otherInfo: payload.otherInfo || {
          compensation: 'Competitive / To be confirmed',
          duration: 'Fixed term or ongoing',
          schedule: payload.workMode,
          deadline: 'Open for applications',
        },
        orgTips: payload.orgTips || {
          aboutOrg: `${payload.organization.trim()} values practical skill evidence alongside your CV.`,
          howToApply: 'Review the required skills above and submit your portfolio or evidence links on the original listing.',
          tips: ['Highlight your highest-scoring Kord skills in your application summary.'],
        },
        isSample: payload.isSample !== false,
        applyUrl: payload.applyUrl || 'https://example.org/apply',
      };

      if (existing) {
        Object.assign(existing, enriched);
        return draft;
      }

      draft.opportunities.unshift({
        id: `opp-${Date.now()}`,
        ...enriched,
      });
      return draft;
    });
  });
}

export async function adminDeleteOpportunity(id) {
  const key = buildIdempotencyKey('admin-opp-del', id);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.from('opportunities').delete().eq('id', id);
      if (error) throw error;
      return;
    }
    updateDemoState((draft) => {
      draft.opportunities = draft.opportunities.filter((o) => o.id !== id);
      return draft;
    });
  });
}
