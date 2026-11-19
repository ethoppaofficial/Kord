/**
 * Pure Course & Skill Progression Evaluator.
 *
 * Rules:
 * - Course progress tracks required lessons, required assessments, and required challenges.
 * - Calendar time elapsed NEVER marks a course complete; completion requires earned requirements.
 * - Projected completion date is estimated from enrollment date + remaining effort at recommended weekly pace.
 * - Parent Skill becomes 'verified' ONLY when ALL published courses under that skill are completed
 *   (with required assessment & challenge reviews approved).
 */

export function computeProjectedCompletionDate({ enrolledAt, remainingMinutes, recommendedWeeklyHours }) {
  const start = enrolledAt ? new Date(enrolledAt) : new Date();
  const baseTime = Number.isNaN(start.getTime()) ? Date.now() : Date.now();
  const weeklyMins = Math.max(60, Number(recommendedWeeklyHours || 4) * 60);
  const weeksLeft = remainingMinutes > 0 ? remainingMinutes / weeklyMins : 0;
  const projected = new Date(baseTime + Math.ceil(weeksLeft * 7) * 86400000);
  return projected.toISOString();
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
  const phases = course?.phases || [];
  const allLessons = phases.flatMap((p) => p.lessons || p.activities || []);
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
