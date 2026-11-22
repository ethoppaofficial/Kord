/**
 * Pure Phase, Course & Skill Progression Evaluator.
 *
 * Rules:
 * - Viewing a phase or lesson page NEVER marks it complete automatically.
 * - Phase completion evaluates completed required lessons, required practical activities,
 *   passed phase assessments, and approved phase challenges.
 * - Course completion evaluates configured completionRules and distinguishes cleanly between:
 *   'in_progress', 'awaiting_practical_assessment', 'completed', and 'completed_verified'.
 * - Quizzes NEVER independently award practical competence or verified status.
 * - Parent Skill becomes 'verified' ONLY when ALL published courses associated with that skill
 *   are completed with practical approval (0-course skills never auto-complete or auto-verify).
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
  activityProgress = [],
  assessments = [],
  quizAttempts = [],
  challenges = [],
  submissions = [],
}) {
  const orderedLessons = (phase?.lessons || [])
    .filter((l) => l.publicationStatus !== 'draft' && l.publicationStatus !== 'archived')
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

  const orderedActivities = (phase?.activities || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const requiredActivities = orderedActivities.filter((a) => a.isRequired !== false);
  const completedActivitySet = new Set(
    activityProgress.filter((ap) => ap.completed).map((ap) => ap.activityId)
  );
  const completedActivitiesCount = requiredActivities.filter((a) => completedActivitySet.has(a.id)).length;

  const visibleLessonIds = new Set(orderedLessons.map((l) => l.id));
  const phaseAssessments = assessments.filter(
    (q) => q.phaseId === phase?.id && (!q.lessonId || visibleLessonIds.has(q.lessonId))
  );
  const passedAssessmentsCount = phaseAssessments.filter((q) =>
    quizAttempts.some((a) => a.quizId === q.id && a.passed && a.reviewStatus !== 'pending_review')
  ).length;

  const phaseChallenges = challenges.filter((c) => c.phaseId === phase?.id && c.isRequired !== false);
  const approvedChallengesCount = phaseChallenges.filter((c) =>
    submissions.some((s) => s.challengeId === c.id && s.status === 'approved')
  ).length;

  const totalUnits =
    requiredLessons.length +
    requiredActivities.length +
    phaseAssessments.length +
    phaseChallenges.length;
  const doneUnits =
    completedLessonsCount +
    completedActivitiesCount +
    passedAssessmentsCount +
    approvedChallengesCount;
  const progressPercent = totalUnits > 0 ? Math.min(100, Math.round((doneUnits / totalUnits) * 100)) : 0;

  const isCompleted =
    totalUnits > 0 &&
    completedLessonsCount >= requiredLessons.length &&
    completedActivitiesCount >= requiredActivities.length &&
    passedAssessmentsCount >= phaseAssessments.length &&
    approvedChallengesCount >= phaseChallenges.length;

  return {
    phaseId: phase?.id || null,
    totalLessons: orderedLessons.length,
    requiredLessonsCount: requiredLessons.length,
    completedLessonsCount,
    totalActivities: orderedActivities.length,
    requiredActivitiesCount: requiredActivities.length,
    completedActivitiesCount,
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
  activityProgress = [],
  assessments = [],
  quizAttempts = [],
  challenges = [],
  submissions = [],
  enrollment = null,
}) {
  const phases = (course?.phases || [])
    .filter((p) => p.publicationStatus !== 'draft' && p.publicationStatus !== 'archived')
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));

  const publishedPhaseIds = new Set(phases.map((p) => p.id));
  const allLessons = phases.flatMap((p) =>
    (p.lessons || [])
      .filter((l) => l.publicationStatus !== 'draft' && l.publicationStatus !== 'archived')
      .slice()
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
  );
  const publishedLessonIds = new Set(allLessons.map((l) => l.id));

  const courseAssessments = assessments.filter(
    (q) =>
      q.courseId === course.id &&
      (!q.phaseId || publishedPhaseIds.has(q.phaseId)) &&
      (!q.lessonId || publishedLessonIds.has(q.lessonId))
  );
  const requiredCourseChallenges = challenges.filter(
    (c) =>
      c.courseId === course.id &&
      c.isRequired !== false &&
      (!c.phaseId || publishedPhaseIds.has(c.phaseId))
  );

  const phaseProgressById = {};
  let completedPhasesCount = 0;
  phases.forEach((p) => {
    const pp = computePhaseProgress({
      phase: p,
      lessonProgress,
      activityProgress,
      assessments: courseAssessments,
      quizAttempts,
      challenges: requiredCourseChallenges,
      submissions,
    });
    phaseProgressById[p.id] = pp;
    if (pp.isCompleted) completedPhasesCount += 1;
  });

  const requiredLessons = allLessons.filter((l) => l.isRequired !== false);
  const completedSet = new Set(
    lessonProgress.filter((lp) => lp.completed).map((lp) => lp.lessonId || lp.activityId)
  );
  const doneLessonsCount = requiredLessons.filter((l) => completedSet.has(l.id)).length;

  const allActivities = phases.flatMap((p) =>
    (p.activities || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
  );
  const requiredActivities = allActivities.filter((a) => a.isRequired !== false);
  const completedActSet = new Set(
    activityProgress.filter((ap) => ap.completed).map((ap) => ap.activityId)
  );
  const doneActivitiesCount = requiredActivities.filter((a) => completedActSet.has(a.id)).length;

  const totalLessonMinutes = allLessons.reduce((sum, l) => sum + Number(l.estMinutes || 20), 0);
  const completedLessonMinutes = allLessons
    .filter((l) => completedSet.has(l.id))
    .reduce((sum, l) => {
      const lp = lessonProgress.find((x) => (x.lessonId || x.activityId) === l.id);
      return sum + Number(lp?.minutesSpent || l.estMinutes || 20);
    }, 0);
  const remainingMinutes = Math.max(0, totalLessonMinutes - completedLessonMinutes);

  const passedAssessmentsCount = courseAssessments.filter((q) =>
    quizAttempts.some((a) => a.quizId === q.id && a.passed && a.reviewStatus !== 'pending_review')
  ).length;

  const submittedChallengesCount = requiredCourseChallenges.filter((c) =>
    submissions.some((s) => s.challengeId === c.id)
  ).length;
  const approvedChallengesCount = requiredCourseChallenges.filter((c) =>
    submissions.some((s) => s.challengeId === c.id && s.status === 'approved')
  ).length;

  const rules = course?.completionRules || {
    requireAllRequiredLessons: true,
    requireAllActivities: true,
    requireAllAssessments: true,
    requireChallengeSubmission: true,
    requireChallengeApproval: true,
  };

  const lessonsOk = !rules.requireAllRequiredLessons || doneLessonsCount >= requiredLessons.length;
  const activitiesOk = rules.requireAllActivities === false || doneActivitiesCount >= requiredActivities.length;
  const assessmentsOk = !rules.requireAllAssessments || passedAssessmentsCount >= courseAssessments.length;
  const challengesSubmittedOk =
    rules.requireChallengeSubmission === false || submittedChallengesCount >= requiredCourseChallenges.length;
  const challengesApprovedOk =
    !rules.requireChallengeApproval || approvedChallengesCount >= requiredCourseChallenges.length;

  const hasContent =
    requiredLessons.length > 0 ||
    requiredActivities.length > 0 ||
    courseAssessments.length > 0 ||
    requiredCourseChallenges.length > 0;

  const totalUnits =
    requiredLessons.length +
    requiredActivities.length +
    courseAssessments.length +
    requiredCourseChallenges.length;
  const doneUnits =
    doneLessonsCount +
    doneActivitiesCount +
    passedAssessmentsCount +
    approvedChallengesCount;
  const progressPercent = totalUnits > 0 ? Math.min(100, Math.round((doneUnits / totalUnits) * 100)) : 0;

  const instructionalDone = hasContent && lessonsOk && activitiesOk && assessmentsOk;
  const practicalApproved =
    requiredCourseChallenges.length > 0 && approvedChallengesCount >= requiredCourseChallenges.length;

  let completionState = 'in_progress';
  if (instructionalDone) {
    if (rules.requireChallengeApproval && requiredCourseChallenges.length > 0) {
      completionState = practicalApproved ? 'completed_verified' : 'awaiting_practical_assessment';
    } else if (challengesSubmittedOk) {
      completionState = practicalApproved ? 'completed_verified' : 'completed';
    }
  }

  const isCompleted =
    completionState === 'completed' || completionState === 'completed_verified';

  const projectedCompletionAt = computeProjectedCompletionDate({
    enrolledAt: enrollment?.enrolledAt,
    remainingMinutes,
    recommendedWeeklyHours: course?.recommendedWeeklyHours || 4,
  });

  return {
    totalLessons: allLessons.length,
    requiredLessonsCount: requiredLessons.length,
    completedLessonsCount: doneLessonsCount,
    totalActivities: allActivities.length,
    requiredActivitiesCount: requiredActivities.length,
    completedActivitiesCount: doneActivitiesCount,
    totalPhasesCount: phases.length,
    completedPhasesCount,
    phaseProgressById,
    assessmentsCount: courseAssessments.length,
    passedAssessmentsCount,
    challengesCount: requiredCourseChallenges.length,
    submittedChallengesCount,
    approvedChallengesCount,
    progressPercent,
    actualMinutesSpent: completedLessonMinutes,
    estimatedTotalMinutes: totalLessonMinutes,
    remainingMinutes,
    projectedCompletionAt,
    lessonsOk,
    activitiesOk,
    assessmentsOk,
    challengesOk: challengesApprovedOk,
    practicalApproved,
    completionState,
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
      verifiedCoursesCount: 0,
      averagePercent: 0,
      allCoursesCompleted: false,
      allCoursesVerified: false,
    };
  }

  let sumPct = 0;
  let completedCoursesCount = 0;
  let verifiedCoursesCount = 0;
  publishedCourses.forEach((c) => {
    const p = courseProgressById[c.id];
    sumPct += p?.progressPercent || 0;
    if (p?.isCompleted) completedCoursesCount += 1;
    if (p?.completionState === 'completed_verified' && p?.practicalApproved) {
      verifiedCoursesCount += 1;
    }
  });

  return {
    totalPublishedCourses: publishedCourses.length,
    completedCoursesCount,
    verifiedCoursesCount,
    averagePercent: Math.round(sumPct / publishedCourses.length),
    allCoursesCompleted: completedCoursesCount === publishedCourses.length,
    allCoursesVerified: verifiedCoursesCount === publishedCourses.length,
  };
}
