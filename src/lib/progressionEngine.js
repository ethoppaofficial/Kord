/**
 * Pure Phase, Course & Skill Progression Evaluator.
 *
 * Rules:
 * - Viewing a phase or lesson page NEVER marks it complete automatically.
 * - Phase completion evaluates completed required lessons, passed phase assessments, and approved phase challenges.
 * - Course progress tracks required lessons, required assessments, and required challenges across ordered phases.
 * - Calendar time elapsed NEVER marks a course complete; completion requires earned requirements.
 * - Parent Skill becomes 'verified' ONLY when ALL published courses under that skill are completed
 *   (and a skill with 0 published courses is NEVER automatically marked completed or verified).
 */

export function computeProjectedCompletionDate({ enrolledAt, remainingMinutes, recommendedWeeklyHours }) {
  const start = enrolledAt ? new Date(enrolledAt) : new Date();
  const baseTime = Number.isNaN(start.getTime()) ? Date.now() : Date.now();
  const weeklyMins = Math.max(60, Number(recommendedWeeklyHours || 4) * 60);
  const weeksLeft = remainingMinutes > 0 ? remainingMinutes / weeklyMins : 0;
  const projected = new Date(baseTime + Math.ceil(weeksLeft * 7) * 86400000);
  return projected.toISOString();
}

export function computePhaseProgress({
  phase,
  lessonProgress = [],
  assessments = [],
  quizAttempts = [],
  challenges = [],
  submissions = [],
}) {
  const orderedLessons = (phase?.lessons || phase?.activities || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const requiredLessons = orderedLessons.filter((l) => l.isRequired !== false);
  const completedSet = new Set(
    lessonProgress.filter((lp) => lp.completed).map((lp) => lp.lessonId || lp.activityId)
  );

  const completedLessonsCount = requiredLessons.filter((l) => completedSet.has(l.id)).length;
  const totalLessonsMinutes = orderedLessons.reduce((sum, l) => sum + Number(l.estMinutes || 25), 0);
  const completedLessonsMinutes = orderedLessons
    .filter((l) => completedSet.has(l.id))
    .reduce((sum, l) => {
      const lp = lessonProgress.find((x) => (x.lessonId || x.activityId) === l.id);
      return sum + Number(lp?.minutesSpent || l.estMinutes || 25);
    }, 0);

  const phaseAssessments = assessments.filter((q) => q.phaseId === phase?.id);
  const passedAssessmentsCount = phaseAssessments.filter((q) =>
    quizAttempts.some((a) => a.quizId === q.id && a.passed && a.reviewStatus !== 'pending_review')
  ).length;

  const phaseChallenges = challenges.filter((c) => c.phaseId === phase?.id);
  const approvedChallengesCount = phaseChallenges.filter((c) =>
    submissions.some((s) => s.challengeId === c.id && s.status === 'approved')
  ).length;

  const totalUnits = requiredLessons.length + phaseAssessments.length + phaseChallenges.length;
  const doneUnits = completedLessonsCount + passedAssessmentsCount + approvedChallengesCount;
  const progressPercent = totalUnits > 0 ? Math.min(100, Math.round((doneUnits / totalUnits) * 100)) : 0;

  const isCompleted =
    totalUnits > 0 &&
    completedLessonsCount >= requiredLessons.length &&
    passedAssessmentsCount >= phaseAssessments.length &&
    approvedChallengesCount >= phaseChallenges.length;

  return {
    phaseId: phase?.id || null,
    totalLessons: orderedLessons.length,
    requiredLessonsCount: requiredLessons.length,
    completedLessonsCount,
    assessmentsCount: phaseAssessments.length,
    passedAssessmentsCount,
    challengesCount: phaseChallenges.length,
    approvedChallengesCount,
    totalLessonsMinutes,
    completedLessonsMinutes,
    progressPercent,
    isCompleted,
    status: isCompleted ? 'completed' : doneUnits > 0 ? 'in_progress' : 'not_started',
  };
}

export function computeCourseProgress({
  course,
  lessonProgress = [],
  assessments = [],
  quizAttempts = [],
  challenges = [],
  submissions = [],
  enrollment = null,
}) {
  const phases = (course?.phases || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));

  const phaseProgressById = {};
  let completedPhasesCount = 0;
  phases.forEach((p) => {
    const pp = computePhaseProgress({
      phase: p,
      lessonProgress,
      assessments: assessments.filter((q) => q.courseId === course.id),
      quizAttempts,
      challenges: challenges.filter((c) => c.courseId === course.id),
      submissions,
    });
    phaseProgressById[p.id] = pp;
    if (pp.isCompleted) completedPhasesCount += 1;
  });

  const allLessons = phases.flatMap((p) =>
    (p.lessons || p.activities || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
  );
  const requiredLessons = allLessons.filter((l) => l.isRequired !== false);
  const completedSet = new Set(lessonProgress.filter((lp) => lp.completed).map((lp) => lp.lessonId || lp.activityId));

  const doneLessonsCount = requiredLessons.filter((l) => completedSet.has(l.id)).length;
  const totalLessonMinutes = allLessons.reduce((sum, l) => sum + Number(l.estMinutes || 20), 0);
  const completedLessonMinutes = allLessons
    .filter((l) => completedSet.has(l.id))
    .reduce((sum, l) => {
      const lp = lessonProgress.find((x) => (x.lessonId || x.activityId) === l.id);
      return sum + Number(lp?.minutesSpent || l.estMinutes || 20);
    }, 0);
  const remainingMinutes = Math.max(0, totalLessonMinutes - completedLessonMinutes);

  const courseAssessments = assessments.filter((q) => q.courseId === course.id);
  const passedAssessmentsCount = courseAssessments.filter((q) =>
    quizAttempts.some((a) => a.quizId === q.id && a.passed && a.reviewStatus !== 'pending_review')
  ).length;

  const courseChallenges = challenges.filter((c) => c.courseId === course.id);
  const approvedChallengesCount = courseChallenges.filter((c) =>
    submissions.some((s) => s.challengeId === c.id && s.status === 'approved')
  ).length;

  const rules = course?.completionRules || {
    requireAllRequiredLessons: true,
    requireAllAssessments: true,
    requireChallengeApproval: true,
  };

  const lessonsOk = !rules.requireAllRequiredLessons || doneLessonsCount >= requiredLessons.length;
  const assessmentsOk = !rules.requireAllAssessments || passedAssessmentsCount >= courseAssessments.length;
  const challengesOk = !rules.requireChallengeApproval || approvedChallengesCount >= courseChallenges.length;

  const totalUnits = requiredLessons.length + courseAssessments.length + courseChallenges.length;
  const doneUnits = doneLessonsCount + passedAssessmentsCount + approvedChallengesCount;
  const progressPercent = totalUnits > 0 ? Math.min(100, Math.round((doneUnits / totalUnits) * 100)) : 0;

  const isCompleted =
    (requiredLessons.length > 0 || courseAssessments.length > 0 || courseChallenges.length > 0) &&
    lessonsOk &&
    assessmentsOk &&
    challengesOk;

  const projectedCompletionAt = computeProjectedCompletionDate({
    enrolledAt: enrollment?.enrolledAt,
    remainingMinutes,
    recommendedWeeklyHours: course?.recommendedWeeklyHours || 4,
  });

  return {
    totalLessons: allLessons.length,
    requiredLessonsCount: requiredLessons.length,
    completedLessonsCount: doneLessonsCount,
    totalPhasesCount: phases.length,
    completedPhasesCount,
    phaseProgressById,
    assessmentsCount: courseAssessments.length,
    passedAssessmentsCount,
    challengesCount: courseChallenges.length,
    approvedChallengesCount,
    progressPercent,
    actualMinutesSpent: completedLessonMinutes,
    estimatedTotalMinutes: totalLessonMinutes,
    remainingMinutes,
    projectedCompletionAt,
    lessonsOk,
    assessmentsOk,
    challengesOk,
    isCompleted,
  };
}

export function computeOverallSkillCourseProgress({
  publishedCourses = [],
  courseProgressById = {},
}) {
  if (publishedCourses.length === 0) {
    return {
      totalPublishedCourses: 0,
      completedCoursesCount: 0,
      averagePercent: 0,
      allCoursesCompleted: false,
    };
  }

  let sumPct = 0;
  let completedCoursesCount = 0;
  publishedCourses.forEach((c) => {
    const p = courseProgressById[c.id];
    sumPct += p?.progressPercent || 0;
    if (p?.isCompleted) completedCoursesCount += 1;
  });

  return {
    totalPublishedCourses: publishedCourses.length,
    completedCoursesCount,
    averagePercent: Math.round(sumPct / publishedCourses.length),
    allCoursesCompleted: completedCoursesCount === publishedCourses.length,
  };
}
