import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { upgradeSkillLevel } from './skillsRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';

export async function getUserEnrollments(userId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('enrollments')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    return data.map((e) => ({
      id: e.id,
      userId: e.user_id,
      skillId: e.skill_id,
      status: e.status,
      enrolledAt: e.enrolled_at,
      updatedAt: e.updated_at,
    }));
  }
  return getDemoState().enrollments.filter((e) => e.userId === userId);
}

export async function enrollInSkill(userId, skillId) {
  const key = buildIdempotencyKey('enroll', userId, skillId);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('enrollments')
        .upsert(
          { user_id: userId, skill_id: skillId, status: 'active', updated_at: new Date().toISOString() },
          { onConflict: 'user_id,skill_id' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const existing = draft.enrollments.find((e) => e.userId === userId && e.skillId === skillId);
      const now = new Date().toISOString();
      if (existing) {
        if (existing.status !== 'active') {
          existing.status = 'active';
          existing.updatedAt = now;
        }
      } else {
        draft.enrollments.push({
          id: `enr-${userId}-${skillId}`,
          userId,
          skillId,
          status: 'active',
          enrolledAt: now,
          updatedAt: now,
        });
      }
      return draft;
    });
  });
}

export async function setEnrollmentStatus(userId, skillId, status) {
  const key = buildIdempotencyKey('enroll-status', userId, skillId, status);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('enrollments')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('skill_id', skillId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const existing = draft.enrollments.find((e) => e.userId === userId && e.skillId === skillId);
      if (existing && existing.status !== status) {
        existing.status = status;
        existing.updatedAt = new Date().toISOString();
      }
      return draft;
    });
  });
}

export async function getUserActivityProgress(userId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('activity_progress')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    return data.map((ap) => ({
      id: ap.id,
      userId: ap.user_id,
      activityId: ap.activity_id,
      notes: ap.notes,
      completed: ap.completed,
      minutesSpent: ap.minutes_spent,
      completedAt: ap.completed_at,
      updatedAt: ap.updated_at,
    }));
  }
  return getDemoState().activityProgress.filter((ap) => ap.userId === userId);
}

export async function saveActivityNotes(userId, activityId, notes) {
  const key = buildIdempotencyKey('notes', userId, activityId, notes);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.from('activity_progress').upsert(
        {
          user_id: userId,
          activity_id: activityId,
          notes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,activity_id' }
      );
      if (error) throw error;
      return;
    }

    updateDemoState((draft) => {
      const now = new Date().toISOString();
      const existing = draft.activityProgress.find(
        (ap) => ap.userId === userId && ap.activityId === activityId
      );
      if (existing) {
        if (existing.notes !== notes) {
          existing.notes = notes;
          existing.updatedAt = now;
        }
      } else {
        draft.activityProgress.push({
          id: `ap-${userId}-${activityId}`,
          userId,
          activityId,
          notes,
          completed: false,
          minutesSpent: null,
          completedAt: null,
          updatedAt: now,
        });
      }
      return draft;
    });
  });
}

export async function toggleActivityComplete(userId, skillId, activityId, estMinutes, completed) {
  const key = buildIdempotencyKey('act-complete', userId, activityId, String(completed));
  return runIdempotent(key, async () => {
    const now = new Date().toISOString();
    if (!isDemoMode && supabase) {
      const { error } = await supabase.from('activity_progress').upsert(
        {
          user_id: userId,
          activity_id: activityId,
          completed,
          minutes_spent: completed ? estMinutes : null,
          completed_at: completed ? now : null,
          updated_at: now,
        },
        { onConflict: 'user_id,activity_id' }
      );
      if (error) throw error;
      return;
    }

    updateDemoState((draft) => {
      const existing = draft.activityProgress.find(
        (ap) => ap.userId === userId && ap.activityId === activityId
      );
      if (existing) {
        if (existing.completed !== completed) {
          existing.completed = completed;
          existing.minutesSpent = completed ? estMinutes : null;
          existing.completedAt = completed ? (existing.completedAt || now) : null;
          existing.updatedAt = now;
        }
      } else {
        draft.activityProgress.push({
          id: `ap-${userId}-${activityId}`,
          userId,
          activityId,
          notes: '',
          completed,
          minutesSpent: completed ? estMinutes : null,
          completedAt: completed ? now : null,
          updatedAt: now,
        });
      }
      return draft;
    });

    if (completed && skillId) {
      await upgradeSkillLevel(userId, skillId, 'practising');
    }
  });
}
