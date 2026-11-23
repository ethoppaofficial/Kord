import { supabase, isDemoMode } from '../supabase.js';
import { PROGRESSION_RANK } from '../constants.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';

export async function getUserSkills(userId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('user_skills')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      skillId: row.skill_id,
      level: row.level,
      updatedAt: row.updated_at,
    }));
  }

  return getDemoState().userSkills.filter((us) => us.userId === userId);
}

export async function declareUserSkill(userId, skillId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('declare_user_skill', { p_skill_id: skillId });
    if (error) throw error;
    return data;
  }
  const state = getDemoState();
  const actor = (state.users || []).find((u) => u.id === userId);
  if (actor && (actor.accountStatus || 'active') !== 'active') {
    throw new Error('Account is suspended or inactive.');
  }
  return upgradeSkillLevel(userId, skillId, 'declared');
}

/**
 * Evidence-based progression rule:
 * Only upgrades upward (never allows arbitrary jumps by learners;
 * learners reach Practising via lesson/activity/quiz, Demonstrated via practical course completion or approved challenge,
 * Verified when all published courses for a skill are completed with approved practical deliverables).
 */
export async function upgradeSkillLevel(userId, skillId, targetLevel) {
  if (!isDemoMode && supabase) {
    // Upgrades in live mode are executed server-side via security-definer RPCs
    return null;
  }

  const targetRank = PROGRESSION_RANK[targetLevel] || 1;
  return updateDemoState((draft) => {
    const existing = draft.userSkills.find(
      (us) => us.userId === userId && us.skillId === skillId
    );
    const now = new Date().toISOString();
    if (!existing) {
      draft.userSkills.push({
        id: `us-${Date.now()}`,
        userId,
        skillId,
        level: targetLevel,
        updatedAt: now,
      });
    } else if (targetRank > (PROGRESSION_RANK[existing.level] || 0)) {
      existing.level = targetLevel;
      existing.updatedAt = now;
    }
    return draft;
  });
}
