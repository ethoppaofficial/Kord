import { supabase, isDemoMode } from '../lib/supabase.js';
import { getDemoState } from '../lib/demo/demoStore.js';
import { listRankedOpportunities } from '../lib/repositories/opportunityRepository.js';

function startOfIsoWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildTimeSeries(completedEntries) {
  const now = new Date();
  const currentWeekStart = startOfIsoWeek(now);
  const weeks = [];
  for (let i = 8; i >= 0; i--) {
    const ws = new Date(currentWeekStart);
    ws.setDate(ws.getDate() - i * 7);
    const key = ws.toISOString().slice(0, 10);
    const label = ws.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    weeks.push({ key, label, minutes: 0 });
  }

  const hourlyBuckets = [
    { label: '06–09', start: 6, end: 9, minutes: 0 },
    { label: '09–12', start: 9, end: 12, minutes: 0 },
    { label: '12–15', start: 12, end: 15, minutes: 0 },
    { label: '15–18', start: 15, end: 18, minutes: 0 },
    { label: '18–21', start: 18, end: 21, minutes: 0 },
    { label: '21–24', start: 21, end: 24, minutes: 0 },
  ];

  for (const entry of completedEntries) {
    if (!entry.completedAt) continue;
    const dt = new Date(entry.completedAt);
    if (Number.isNaN(dt.getTime())) continue;
    const wkKey = startOfIsoWeek(dt).toISOString().slice(0, 10);
    const targetWeek = weeks.find((w) => w.key === wkKey);
    if (targetWeek) {
      targetWeek.minutes += entry.minutes;
    }

    const hr = dt.getHours();
    const bucket = hourlyBuckets.find((b) => hr >= b.start && hr < b.end);
    if (bucket) {
      bucket.minutes += entry.minutes;
    }
  }

  return { weeklyMinutes: weeks, hourlyDistribution: hourlyBuckets };
}

export async function getDashboardData(userId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('get_dashboard');
    if (error) throw error;
    const recommendations = await listRankedOpportunities(userId);
    return {
      ...data,
      recommendations: recommendations.slice(0, 3),
    };
  }

  const state = getDemoState();
  const activeRoadmaps = state.enrollments.filter(
    (e) => e.userId === userId && e.status === 'active'
  ).length;
  const pausedRoadmaps = state.enrollments.filter(
    (e) => e.userId === userId && e.status === 'paused'
  ).length;

  const activityById = new Map();
  state.skills.forEach((s) =>
    (s.phases || []).forEach((p) =>
      (p.activities || []).forEach((a) => activityById.set(a.id, a))
    )
  );

  const completedProgress = state.activityProgress.filter(
    (ap) => ap.userId === userId && ap.completed
  );

  const completedEntries = completedProgress.map((ap) => {
    const act = activityById.get(ap.activityId);
    return {
      completedAt: ap.completedAt || ap.updatedAt,
      minutes: Number(ap.minutesSpent || act?.estMinutes || 20),
    };
  });

  if (Array.isArray(state.syntheticHistory)) {
    state.syntheticHistory
      .filter((item) => item.userId === userId)
      .forEach((item) => completedEntries.push({ completedAt: item.completedAt, minutes: item.minutes }));
  }

  const minutesLearned = completedEntries.reduce((sum, item) => sum + item.minutes, 0);
  const { weeklyMinutes, hourlyDistribution } = buildTimeSeries(completedEntries);

  const attempts = state.quizAttempts.filter((qa) => qa.userId === userId);
  const passedQuizzes = new Set(attempts.filter((a) => a.passed).map((a) => a.quizId)).size;
  const averageQuizScore =
    attempts.length > 0
      ? Math.round(attempts.reduce((sum, a) => sum + a.percentage, 0) / attempts.length)
      : 0;

  const subs = state.submissions.filter((s) => s.userId === userId);
  const approvedSubmissions = subs.filter((s) => s.status === 'approved').length;
  const pendingSubmissions = subs.filter((s) => s.status === 'pending').length;
  const needsRevisionSubmissions = subs.filter((s) => s.status === 'needs_revision').length;

  const skillLevels = state.userSkills
    .filter((us) => us.userId === userId)
    .map((us) => {
      const skill = state.skills.find((s) => s.id === us.skillId);
      return {
        skillId: us.skillId,
        slug: skill?.slug || '',
        title: skill?.title || 'Skill',
        category: skill?.category || '',
        level: us.level,
        updatedAt: us.updatedAt,
      };
    });

  const recommendations = (await listRankedOpportunities(userId)).slice(0, 3);

  return {
    learning: {
      activeRoadmaps,
      pausedRoadmaps,
      completedActivities: completedProgress.length,
      minutesLearned,
    },
    understanding: {
      passedQuizzes,
      totalAttempts: attempts.length,
      averageScore: averageQuizScore,
    },
    demonstrating: {
      approvedSubmissions,
      pendingSubmissions,
      needsRevisionSubmissions,
      totalSubmissions: subs.length,
    },
    skillLevels,
    weeklyMinutes,
    hourlyDistribution,
    recommendations,
    sampleHistoryInjected: Boolean(state.sampleHistoryInjected),
  };
}
