import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { upgradeSkillLevel } from './skillsRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';
import {
  computeCourseProgress,
  computeOverallSkillCourseProgress,
} from '../progressionEngine.js';

function getCourseLinkedSkillIds(course) {
  return Array.from(
    new Set([course.skillId, ...(course.associatedSkillIds || [])].filter(Boolean))
  );
}

export async function getCourseEnrollments(userId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('course_enrollments')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    return (data || []).map((e) => ({
      id: e.id,
      userId: e.user_id,
      courseId: e.course_id,
      status: e.status,
      completionState: e.completion_state || 'in_progress',
      enrolledAt: e.enrolled_at,
      completedAt: e.completed_at,
      updatedAt: e.updated_at,
    }));
  }
  return (getDemoState().courseEnrollments || []).filter((e) => e.userId === userId);
}

export async function enrollInCourse(userId, courseId) {
  const key = buildIdempotencyKey('course-enroll', userId, courseId);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('enroll_in_course', {
        p_course_id: courseId,
      });
      if (error) throw new Error(error.message);
      return data;
    }

    let skillIds = [];
    updateDemoState((draft) => {
      if (draft.currentUserId && draft.currentUserId !== userId) {
        throw new Error('You cannot enroll another learner.');
      }
      const actor = (draft.users || []).find((u) => u.id === userId);
      if (actor?.role === 'admin') {
        throw new Error('Learner authentication required.');
      }
      draft.courseEnrollments = draft.courseEnrollments || [];
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course || course.publicationStatus !== 'published') {
        throw new Error('This course is not available for enrollment.');
      }
      skillIds = getCourseLinkedSkillIds(course);
      const existing = draft.courseEnrollments.find(
        (e) => e.userId === userId && e.courseId === courseId
      );
      const now = new Date().toISOString();
      if (existing) {
        if (existing.status === 'paused') {
          existing.status = 'active';
          existing.updatedAt = now;
        }
      } else {
        draft.courseEnrollments.push({
          id: `cenr-${userId}-${courseId}`,
          userId,
          courseId,
          status: 'active',
          completionState: 'in_progress',
          enrolledAt: now,
          completedAt: null,
          updatedAt: now,
        });
      }
      return draft;
    });

    for (const sid of skillIds) {
      await upgradeSkillLevel(userId, sid, 'declared');
    }
  });
}

export async function setCourseEnrollmentStatus(userId, courseId, status) {
  const key = buildIdempotencyKey('course-enroll-status', userId, courseId, status);
  return runIdempotent(key, async () => {
    if (!['active', 'paused'].includes(status)) {
      throw new Error('Enrollment status can only be active or paused.');
    }

    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('set_course_enrollment_status', {
        p_course_id: courseId,
        p_status: status,
      });
      if (error) throw new Error(error.message);
      return data;
    }

    return updateDemoState((draft) => {
      if (draft.currentUserId && draft.currentUserId !== userId) {
        throw new Error('You cannot alter another learner’s enrollment.');
      }
      const existing = (draft.courseEnrollments || []).find(
        (e) => e.userId === userId && e.courseId === courseId
      );
      if (!existing) {
        throw new Error('Course enrollment not found.');
      }
      if (existing.status === 'completed') {
        throw new Error('Completed courses cannot be paused or reverted.');
      }
      if (existing.status !== status) {
        existing.status = status;
        existing.updatedAt = new Date().toISOString();
      }
      return draft;
    });
  });
}

export async function getLessonProgress(userId, courseId = null) {
  if (!isDemoMode && supabase) {
    let query = supabase.from('lesson_progress').select('*').eq('user_id', userId);
    if (courseId) query = query.eq('course_id', courseId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((lp) => ({
      id: lp.id,
      userId: lp.user_id,
      courseId: lp.course_id,
      lessonId: lp.lesson_id,
      notes: lp.notes || '',
      completed: Boolean(lp.completed),
      minutesSpent: lp.minutes_spent,
      completedAt: lp.completed_at,
      updatedAt: lp.updated_at,
    }));
  }

  return (getDemoState().lessonProgress || []).filter(
    (lp) => lp.userId === userId && (!courseId || lp.courseId === courseId)
  );
}

export async function getActivityProgress(userId, courseId = null) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('activity_progress')
      .select('*, activities(phase_id, phases(course_id))')
      .eq('user_id', userId);
    if (error) throw error;
    return (data || [])
      .map((ap) => ({
        id: ap.id,
        userId: ap.user_id,
        activityId: ap.activity_id,
        courseId: ap.activities?.phases?.course_id || null,
        notes: ap.notes || '',
        completed: Boolean(ap.completed),
        minutesSpent: ap.minutes_spent,
        completedAt: ap.completed_at,
        updatedAt: ap.updated_at,
      }))
      .filter((ap) => !courseId || ap.courseId === courseId);
  }

  return (getDemoState().activityProgress || []).filter(
    (ap) => ap.userId === userId && (!courseId || ap.courseId === courseId)
  );
}

export async function saveLessonNotes(userId, lessonId, courseId, notes) {
  const key = buildIdempotencyKey('lesson-notes', userId, lessonId, notes);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('save_lesson_notes', {
        p_lesson_id: lessonId,
        p_notes: String(notes || ''),
      });
      if (error) throw new Error(error.message);
      return data;
    }

    updateDemoState((draft) => {
      if (draft.currentUserId && draft.currentUserId !== userId) {
        throw new Error('You cannot edit another learner’s notes.');
      }
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course || course.publicationStatus !== 'published') {
        throw new Error('Published course not found.');
      }
      const enrolled = (draft.courseEnrollments || []).some(
        (e) => e.userId === userId && e.courseId === courseId && ['active', 'completed'].includes(e.status)
      );
      if (!enrolled) {
        throw new Error('Active course enrollment required to save lesson notes.');
      }
      draft.lessonProgress = draft.lessonProgress || [];
      const now = new Date().toISOString();
      const existing = draft.lessonProgress.find(
        (lp) => lp.userId === userId && lp.lessonId === lessonId
      );
      if (existing) {
        if (existing.notes !== notes) {
          existing.notes = notes;
          existing.updatedAt = now;
        }
      } else {
        draft.lessonProgress.push({
          id: `lp-${userId}-${lessonId}`,
          userId,
          courseId,
          lessonId,
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

export async function toggleLessonComplete(userId, courseId, lessonId, estMinutes, completed) {
  const key = buildIdempotencyKey('lesson-complete', userId, lessonId, String(completed));
  return runIdempotent(key, async () => {
    const now = new Date().toISOString();
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('set_lesson_completion', {
        p_lesson_id: lessonId,
        p_completed: Boolean(completed),
      });
      if (error) throw new Error(error.message);
      return data;
    }

    updateDemoState((draft) => {
      if (draft.currentUserId && draft.currentUserId !== userId) {
        throw new Error('You cannot modify another learner’s progress.');
      }
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course || course.publicationStatus !== 'published') {
        throw new Error('Published course not found.');
      }
      const lesson = (course.phases || [])
        .filter((p) => p.publicationStatus !== 'draft' && p.publicationStatus !== 'archived')
        .flatMap((p) => p.lessons || [])
        .find((l) => l.id === lessonId && l.publicationStatus !== 'draft' && l.publicationStatus !== 'archived');
      if (!lesson) {
        throw new Error('Published lesson not found.');
      }
      const enrolled = (draft.courseEnrollments || []).some(
        (e) => e.userId === userId && e.courseId === courseId && ['active', 'completed'].includes(e.status)
      );
      if (!enrolled) {
        throw new Error('Active course enrollment required to complete lessons.');
      }
      const derivedMinutes = Math.max(1, Number(lesson.estMinutes || estMinutes || 25));

      draft.lessonProgress = draft.lessonProgress || [];
      const existing = draft.lessonProgress.find(
        (lp) => lp.userId === userId && lp.lessonId === lessonId
      );
      if (existing) {
        existing.completed = completed;
        existing.minutesSpent = completed ? derivedMinutes : null;
        existing.completedAt = completed ? (existing.completedAt || now) : null;
        existing.updatedAt = now;
      } else {
        draft.lessonProgress.push({
          id: `lp-${userId}-${lessonId}`,
          userId,
          courseId,
          lessonId,
          notes: '',
          completed,
          minutesSpent: completed ? derivedMinutes : null,
          completedAt: completed ? now : null,
          updatedAt: now,
        });
      }
      return draft;
    });

    await recomputeCourseAndSkillStatus(userId, courseId);
  });
}

export async function togglePhaseActivityComplete(
  userId,
  courseId,
  activityId,
  estMinutes,
  completed,
  notes = undefined
) {
  const key = buildIdempotencyKey(
    'activity-complete',
    userId,
    activityId,
    String(completed),
    notes || ''
  );
  return runIdempotent(key, async () => {
    const now = new Date().toISOString();
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('set_activity_completion', {
        p_activity_id: activityId,
        p_completed: Boolean(completed),
        p_notes: notes === undefined ? null : String(notes),
      });
      if (error) throw new Error(error.message);
      return data;
    }

    updateDemoState((draft) => {
      if (draft.currentUserId && draft.currentUserId !== userId) {
        throw new Error('You cannot modify another learner’s activity progress.');
      }
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course || course.publicationStatus !== 'published') {
        throw new Error('Published course not found.');
      }
      const activity = (course.phases || [])
        .filter((p) => p.publicationStatus !== 'draft' && p.publicationStatus !== 'archived')
        .flatMap((p) => p.activities || [])
        .find((a) => a.id === activityId);
      if (!activity) {
        throw new Error('Published phase activity not found.');
      }
      const enrolled = (draft.courseEnrollments || []).some(
        (e) => e.userId === userId && e.courseId === courseId && ['active', 'completed'].includes(e.status)
      );
      if (!enrolled) {
        throw new Error('Active course enrollment required to track activities.');
      }
      const derivedMinutes = Math.max(1, Number(activity.estMinutes || estMinutes || 20));

      draft.activityProgress = draft.activityProgress || [];
      const existing = draft.activityProgress.find(
        (ap) => ap.userId === userId && ap.activityId === activityId
      );
      if (existing) {
        existing.completed = completed;
        if (notes !== undefined) existing.notes = notes;
        existing.minutesSpent = completed ? derivedMinutes : null;
        existing.completedAt = completed ? (existing.completedAt || now) : null;
        existing.updatedAt = now;
      } else {
        draft.activityProgress.push({
          id: `ap-${userId}-${activityId}`,
          userId,
          courseId,
          activityId,
          notes: notes || '',
          completed,
          minutesSpent: completed ? derivedMinutes : null,
          completedAt: completed ? now : null,
          updatedAt: now,
        });
      }
      return draft;
    });

    await recomputeCourseAndSkillStatus(userId, courseId);
  });
}

/**
 * Evaluates course completion and upgrades linked Skill(s) conservatively:
 * - Any completed lesson or practical activity -> skill >= 'practising'
 * - Quizzes & lessons alone NEVER grant 'demonstrated' or 'verified' (stays 'awaiting_practical_assessment' until capstone approved)
 * - Course completed (with practical approval) -> skill >= 'demonstrated'
 * - ALL published courses linked to a skill completed with practical approval -> skill upgrades to 'verified'
 * Note: In live Supabase mode progression is recalculated automatically inside server-side SECURITY DEFINER RPCs.
 */
export async function recomputeCourseAndSkillStatus(userId, courseId) {
  if (!userId || !courseId) return null;

  if (!isDemoMode && supabase) {
    return null;
  }

  const state = getDemoState();
  const targetCourse = (state.courses || []).find((c) => c.id === courseId);
  if (!targetCourse || targetCourse.publicationStatus !== 'published') return null;

  const targetEnrollment = (state.courseEnrollments || []).find(
    (e) => e.userId === userId && e.courseId === courseId
  );
  if (!targetEnrollment) return null;

  const userLessonProgress = (state.lessonProgress || []).filter((lp) => lp.userId === userId);
  const userActivityProgress = (state.activityProgress || []).filter((ap) => ap.userId === userId);
  const userAttempts = (state.quizAttempts || []).filter((qa) => qa.userId === userId);
  const userSubs = (state.submissions || []).filter((s) => s.userId === userId);

  const computeForCourse = (course) => {
    const enrollment = (state.courseEnrollments || []).find(
      (e) => e.userId === userId && e.courseId === course.id
    );
    return computeCourseProgress({
      course,
      lessonProgress: userLessonProgress.filter((lp) => lp.courseId === course.id),
      activityProgress: userActivityProgress.filter((ap) => ap.courseId === course.id),
      assessments: state.quizzes || [],
      quizAttempts: userAttempts,
      challenges: state.challenges || [],
      submissions: userSubs,
      enrollment,
    });
  };

  const targetProgress = computeForCourse(targetCourse);
  const now = new Date().toISOString();

  updateDemoState((draft) => {
    draft.courseCompletions = draft.courseCompletions || [];
    const enr = (draft.courseEnrollments || []).find(
      (e) => e.userId === userId && e.courseId === courseId
    );
    if (enr && targetProgress) {
      enr.completionState = targetProgress.completionState;
      if (targetProgress.isCompleted) {
        enr.status = 'completed';
        enr.completedAt = enr.completedAt || now;
      } else if (enr.status === 'completed') {
        enr.status = 'active';
        enr.completedAt = null;
      }
      enr.updatedAt = now;
    }

    const existingComp = draft.courseCompletions.find(
      (cc) => cc.userId === userId && cc.courseId === courseId
    );
    if (existingComp) {
      existingComp.completionState = targetProgress.completionState;
      existingComp.practicalApproved = targetProgress.practicalApproved;
      existingComp.completedAt = targetProgress.isCompleted ? existingComp.completedAt || now : null;
      existingComp.updatedAt = now;
    } else {
      draft.courseCompletions.push({
        id: `cc-${userId}-${courseId}`,
        userId,
        courseId,
        completionState: targetProgress.completionState,
        practicalApproved: targetProgress.practicalApproved,
        completedAt: targetProgress.isCompleted ? now : null,
        updatedAt: now,
      });
    }
    return draft;
  });

  const linkedSkillIds = getCourseLinkedSkillIds(targetCourse);
  let lastOverall = null;

  for (const sid of linkedSkillIds) {
    const publishedCoursesForSkill = (state.courses || []).filter(
      (c) => c.publicationStatus === 'published' && getCourseLinkedSkillIds(c).includes(sid)
    );
    const courseProgressById = {};
    publishedCoursesForSkill.forEach((c) => {
      courseProgressById[c.id] = c.id === courseId ? targetProgress : computeForCourse(c);
    });

    const overall = computeOverallSkillCourseProgress({
      publishedCourses: publishedCoursesForSkill,
      courseProgressById,
    });
    lastOverall = overall;

    if (overall.allCoursesVerified && overall.totalPublishedCourses > 0) {
      await upgradeSkillLevel(userId, sid, 'verified');
    } else if (targetProgress?.isCompleted) {
      await upgradeSkillLevel(userId, sid, 'demonstrated');
    } else if (
      (targetProgress?.completedLessonsCount || 0) > 0 ||
      (targetProgress?.completedActivitiesCount || 0) > 0
    ) {
      await upgradeSkillLevel(userId, sid, 'practising');
    }
  }

  return { courseProgress: targetProgress, overall: lastOverall };
}

// Aliases so older imports keep working seamlessly
export const getUserEnrollments = getCourseEnrollments;
export const getUserActivityProgress = getLessonProgress;
export const enrollInSkill = enrollInCourse;
export const setEnrollmentStatus = setCourseEnrollmentStatus;
export const saveActivityNotes = (userId, lessonId, notes, courseId = '') =>
  saveLessonNotes(userId, lessonId, courseId, notes);
export const toggleActivityComplete = toggleLessonComplete;
