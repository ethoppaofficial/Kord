import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { upgradeSkillLevel } from './skillsRepository.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';
import {
  computeCourseProgress,
  computeOverallSkillCourseProgress,
} from '../progressionEngine.js';

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
      const { data: course } = await supabase
        .from('courses')
        .select('id, skill_id')
        .eq('id', courseId)
        .single();
      const { data, error } = await supabase
        .from('course_enrollments')
        .upsert(
          {
            user_id: userId,
            course_id: courseId,
            status: 'active',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,course_id' }
        )
        .select()
        .single();
      if (error) throw error;
      if (course?.skill_id) {
        await supabase.rpc('declare_user_skill', { p_skill_id: course.skill_id });
      }
      return data;
    }

    let skillId = null;
    updateDemoState((draft) => {
      draft.courseEnrollments = draft.courseEnrollments || [];
      const course = (draft.courses || []).find((c) => c.id === courseId);
      skillId = course?.skillId || null;
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
          enrolledAt: now,
          completedAt: null,
          updatedAt: now,
        });
      }
      return draft;
    });

    if (skillId) {
      await upgradeSkillLevel(userId, skillId, 'declared');
    }
  });
}

export async function setCourseEnrollmentStatus(userId, courseId, status) {
  const key = buildIdempotencyKey('course-enroll-status', userId, courseId, status);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('course_enrollments')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('course_id', courseId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const existing = (draft.courseEnrollments || []).find(
        (e) => e.userId === userId && e.courseId === courseId
      );
      if (existing && existing.status !== status) {
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

export async function saveLessonNotes(userId, lessonId, courseId, notes) {
  const key = buildIdempotencyKey('lesson-notes', userId, lessonId, notes);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.from('lesson_progress').upsert(
        {
          user_id: userId,
          lesson_id: lessonId,
          course_id: courseId,
          notes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,lesson_id' }
      );
      if (error) throw error;
      return;
    }

    updateDemoState((draft) => {
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
      const { error } = await supabase.from('lesson_progress').upsert(
        {
          user_id: userId,
          course_id: courseId,
          lesson_id: lessonId,
          completed,
          minutes_spent: completed ? estMinutes : null,
          completed_at: completed ? now : null,
          updated_at: now,
        },
        { onConflict: 'user_id,lesson_id' }
      );
      if (error) throw error;
      await supabase.rpc('evaluate_course_and_skill_progression', {
        p_user_id: userId,
        p_course_id: courseId,
      });
      return;
    }

    updateDemoState((draft) => {
      draft.lessonProgress = draft.lessonProgress || [];
      const existing = draft.lessonProgress.find(
        (lp) => lp.userId === userId && lp.lessonId === lessonId
      );
      if (existing) {
        existing.completed = completed;
        existing.minutesSpent = completed ? estMinutes : null;
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
          minutesSpent: completed ? estMinutes : null,
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
 * Evaluates course completion and upgrades parent Skill conservatively:
 * - Any completed lesson -> skill >= 'practising'
 * - Single course completed -> skill >= 'demonstrated'
 * - ALL published courses under parent skill completed -> skill upgrades to 'verified'
 */
export async function recomputeCourseAndSkillStatus(userId, courseId) {
  if (!userId || !courseId) return null;

  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('evaluate_course_and_skill_progression', {
      p_user_id: userId,
      p_course_id: courseId,
    });
    if (error) throw error;
    return data;
  }

  const state = getDemoState();
  const targetCourse = (state.courses || []).find((c) => c.id === courseId);
  if (!targetCourse) return null;

  const userLessonProgress = (state.lessonProgress || []).filter((lp) => lp.userId === userId);
  const userAttempts = (state.quizAttempts || []).filter((qa) => qa.userId === userId);
  const userSubs = (state.submissions || []).filter((s) => s.userId === userId);

  const publishedCoursesForSkill = (state.courses || []).filter(
    (c) => c.skillId === targetCourse.skillId && c.publicationStatus === 'published'
  );

  const courseProgressById = {};
  publishedCoursesForSkill.forEach((course) => {
    const enrollment = (state.courseEnrollments || []).find(
      (e) => e.userId === userId && e.courseId === course.id
    );
    courseProgressById[course.id] = computeCourseProgress({
      course,
      lessonProgress: userLessonProgress.filter((lp) => lp.courseId === course.id),
      assessments: state.quizzes || [],
      quizAttempts: userAttempts,
      challenges: state.challenges || [],
      submissions: userSubs,
      enrollment,
    });
  });

  const targetProgress = courseProgressById[courseId];
  const overall = computeOverallSkillCourseProgress({
    publishedCourses: publishedCoursesForSkill,
    courseProgressById,
  });

  const now = new Date().toISOString();
  updateDemoState((draft) => {
    const enr = (draft.courseEnrollments || []).find(
      (e) => e.userId === userId && e.courseId === courseId
    );
    if (enr && targetProgress?.isCompleted) {
      enr.status = 'completed';
      enr.completedAt = enr.completedAt || now;
      enr.updatedAt = now;
    }
    return draft;
  });

  if (overall.allCoursesCompleted && overall.totalPublishedCourses > 0) {
    await upgradeSkillLevel(userId, targetCourse.skillId, 'verified');
  } else if (targetProgress?.isCompleted) {
    await upgradeSkillLevel(userId, targetCourse.skillId, 'demonstrated');
  } else if ((targetProgress?.completedLessonsCount || 0) > 0) {
    await upgradeSkillLevel(userId, targetCourse.skillId, 'practising');
  }

  return { courseProgress: targetProgress, overall };
}

// Aliases so older imports keep working seamlessly
export const getUserEnrollments = getCourseEnrollments;
export const getUserActivityProgress = getLessonProgress;
export const enrollInSkill = enrollInCourse;
export const setEnrollmentStatus = setCourseEnrollmentStatus;
export const saveActivityNotes = (userId, lessonId, notes, courseId = '') =>
  saveLessonNotes(userId, lessonId, courseId, notes);
export const toggleActivityComplete = toggleLessonComplete;
