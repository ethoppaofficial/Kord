import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { slugify } from '../formatters.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';
import { normalizeVideoEntry } from '../videoProvider.js';

export async function listCategories() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.from('categories').select('*').order('position');
    if (error) throw error;
    return data || [];
  }
  return (getDemoState().categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
}

export async function adminUpsertCategory({ id, name, slug, description = '', position }) {
  const cleanName = String(name || '').trim();
  const cleanSlug = slug ? slugify(slug) : slugify(cleanName);
  const key = buildIdempotencyKey('admin-category', id || cleanSlug, cleanName);

  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('categories')
        .upsert(
          {
            id: id || undefined,
            slug: cleanSlug,
            name: cleanName,
            description: String(description || '').trim(),
            position: Number(position || 99),
          },
          { onConflict: 'slug' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      draft.categories = draft.categories || [];
      const existing = id
        ? draft.categories.find((c) => c.id === id)
        : draft.categories.find((c) => c.slug === cleanSlug || c.name.toLowerCase() === cleanName.toLowerCase());
      if (existing) {
        existing.name = cleanName;
        existing.slug = cleanSlug;
        existing.description = String(description || '').trim();
        if (position) existing.position = Number(position);
      } else {
        draft.categories.push({
          id: `cat-${cleanSlug}`,
          slug: cleanSlug,
          name: cleanName,
          description: String(description || '').trim(),
          position: Number(position || draft.categories.length + 1),
        });
      }
      return draft;
    });
  });
}

export async function listSkills({ includeDrafts = false } = {}) {
  if (!isDemoMode && supabase) {
    const [{ data: skillsData, error }, { data: coursesData }] = await Promise.all([
      supabase.from('skills').select('*').order('title'),
      supabase.from('courses').select('id, skill_id, slug, title, difficulty, estimated_duration_weeks, publication_status, position'),
    ]);
    if (error) throw error;
    const courses = (coursesData || []).map(mapCourseSummary);
    return (skillsData || [])
      .map((s) => {
        const allSkillCourses = courses
          .filter((c) => c.skillId === s.id)
          .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
        const publishedCourses = allSkillCourses.filter((c) => c.publicationStatus === 'published');
        const draftCourseCount = allSkillCourses.filter((c) => c.publicationStatus === 'draft').length;
        const visibleCourses = includeDrafts ? allSkillCourses : publishedCourses;
        return {
          ...s,
          categoryId: s.category_id,
          competencyExpectations: s.competency_expectations || '',
          prerequisites: s.prerequisites || [],
          publicationStatus: s.publication_status || 'published',
          roadmapStatus: publishedCourses.length > 0 ? 'full' : 'coming_soon',
          estHours: Number(s.est_hours || 4),
          courses: visibleCourses,
          courseCount: publishedCourses.length,
          draftCourseCount,
          totalCourseCount: allSkillCourses.length,
        };
      })
      .filter((s) => includeDrafts || s.publicationStatus === 'published');
  }

  const state = getDemoState();
  const courses = state.courses || [];
  return (state.skills || [])
    .map((s) => {
      const allSkillCourses = courses
        .filter((c) => c.skillId === s.id)
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      const publishedCourses = allSkillCourses.filter((c) => c.publicationStatus === 'published');
      const draftCourseCount = allSkillCourses.filter((c) => c.publicationStatus === 'draft').length;
      const visibleCourses = includeDrafts ? allSkillCourses : publishedCourses;
      return {
        ...s,
        publicationStatus: s.publicationStatus || 'published',
        courses: visibleCourses,
        courseCount: publishedCourses.length,
        draftCourseCount,
        totalCourseCount: allSkillCourses.length,
        roadmapStatus: publishedCourses.length > 0 ? 'full' : 'coming_soon',
      };
    })
    .filter((s) => includeDrafts || s.publicationStatus === 'published');
}

export async function getSkillBySlug(slug, { includeDrafts = false } = {}) {
  const allSkills = await listSkills({ includeDrafts });
  const skill = allSkills.find((s) => s.slug === slug);
  if (!skill) return null;

  if (!isDemoMode && supabase) {
    const [{ data: coursesData }, { data: quizzesData }, { data: challengesData }] = await Promise.all([
      supabase
        .from('courses')
        .select('*, phases(*, lessons(*))')
        .eq('skill_id', skill.id)
        .order('position'),
      supabase.from('quizzes').select('id, course_id, phase_id, quiz_type, title').eq('skill_id', skill.id),
      supabase.from('challenges').select('id, course_id, title').eq('skill_id', skill.id),
    ]);

    const courses = (coursesData || [])
      .map(mapFullCourse)
      .filter((c) => includeDrafts || c.publicationStatus === 'published');
    const skillCheck = (quizzesData || []).find((q) => q.quiz_type === 'skill_check');

    return {
      ...skill,
      courses,
      courseCount: courses.length,
      skillCheckQuizId: skillCheck?.id || null,
      challengeId: challengesData?.[0]?.id || null,
    };
  }

  const state = getDemoState();
  const courses = (state.courses || [])
    .filter((c) => c.skillId === skill.id && (includeDrafts || c.publicationStatus === 'published'))
    .sort((a, b) => (a.position || 1) - (b.position || 1));
  const skillQuizzes = (state.quizzes || []).filter((q) => q.skillId === skill.id);
  const skillChallenges = (state.challenges || []).filter((c) => c.skillId === skill.id);
  const skillCheck = skillQuizzes.find((q) => q.quizType === 'skill_check') || skillQuizzes[0] || null;

  return {
    ...skill,
    courses,
    courseCount: courses.length,
    skillCheckQuizId: skillCheck?.id || null,
    challengeId: skillChallenges[0]?.id || null,
    assessments: skillQuizzes,
    challenges: skillChallenges,
  };
}

export async function listAllCourses({ includeDrafts = true } = {}) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('courses')
      .select('*, skills(id, slug, title, category), phases(*, lessons(*))')
      .order('title');
    if (error) throw error;
    return (data || [])
      .map((c) => ({
        ...mapFullCourse(c),
        skill: c.skills || null,
      }))
      .filter((c) => includeDrafts || c.publicationStatus === 'published');
  }

  const state = getDemoState();
  const skillById = new Map((state.skills || []).map((s) => [s.id, s]));
  return (state.courses || [])
    .filter((c) => includeDrafts || c.publicationStatus === 'published')
    .map((c) => ({
      ...c,
      skill: skillById.get(c.skillId) || null,
    }));
}

export async function getCourseBySlug(slug, { includeDrafts = false } = {}) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('courses')
      .select('*, skills(*), phases(*, lessons(*))')
      .eq('slug', slug)
      .single();
    if (error || !data) return null;
    if (!includeDrafts && data.publication_status !== 'published') return null;
    const course = mapFullCourse(data);
    const [{ data: assessments }, { data: challenges }] = await Promise.all([
      supabase.from('quizzes').select('id, course_id, phase_id, lesson_id, quiz_type, title, description, pass_percent, time_limit_minutes, max_attempts').eq('course_id', course.id),
      supabase.from('challenges').select('*').eq('course_id', course.id),
    ]);
    return {
      ...course,
      skill: data.skills || null,
      assessments: (assessments || []).map((a) => ({
        id: a.id,
        courseId: a.course_id,
        phaseId: a.phase_id,
        lessonId: a.lesson_id,
        quizType: a.quiz_type,
        title: a.title,
        description: a.description,
        passPercent: a.pass_percent,
        timeLimitMinutes: a.time_limit_minutes,
        maxAttempts: a.max_attempts,
      })),
      challenges: (challenges || []).map(mapChallenge),
    };
  }

  const state = getDemoState();
  const course = (state.courses || []).find((c) => c.slug === slug);
  if (!course) return null;
  if (!includeDrafts && course.publicationStatus !== 'published') return null;
  const skill = (state.skills || []).find((s) => s.id === course.skillId) || null;
  if (!includeDrafts && skill && skill.publicationStatus === 'draft') return null;

  const sortedPhases = (course.phases || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map((p) => ({
      ...p,
      lessons: (p.lessons || [])
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0)),
    }));

  const assessments = (state.quizzes || []).filter((q) => q.courseId === course.id);
  const challenges = (state.challenges || []).filter((c) => c.courseId === course.id);
  return {
    ...course,
    phases: sortedPhases,
    skill,
    assessments,
    challenges,
  };
}

export async function getCourseById(courseId) {
  if (!isDemoMode && supabase) {
    const { data } = await supabase.from('courses').select('slug').eq('id', courseId).single();
    if (!data) return null;
    return getCourseBySlug(data.slug);
  }
  const course = (getDemoState().courses || []).find((c) => c.id === courseId);
  return course ? getCourseBySlug(course.slug) : null;
}

export async function getChallengeById(challengeId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('challenges')
      .select('*, skills(id, slug, title), courses(id, slug, title)')
      .eq('id', challengeId)
      .single();
    if (error || !data) return null;
    return {
      ...mapChallenge(data),
      skill: data.skills || null,
      course: data.courses || null,
    };
  }

  const state = getDemoState();
  const challenge = (state.challenges || []).find((c) => c.id === challengeId);
  if (!challenge) return null;
  const skill = (state.skills || []).find((s) => s.id === challenge.skillId) || null;
  const course = challenge.courseId
    ? (state.courses || []).find((c) => c.id === challenge.courseId) || null
    : null;
  return { ...challenge, skill, course };
}

export async function adminUpsertSkill(payload) {
  const cleanTitle = String(payload.title || '').trim();
  const cleanSlug = payload.slug ? slugify(payload.slug) : slugify(cleanTitle);
  const key = buildIdempotencyKey('admin-skill', payload.id || cleanSlug, cleanTitle, payload.publicationStatus || '');

  const parsedOutcomes = Array.isArray(payload.outcomes)
    ? payload.outcomes.map((x) => String(x || '').trim()).filter(Boolean)
    : String(payload.outcomes || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);

  return runIdempotent(key, async () => {
    const categories = await listCategories();
    const matchedCat =
      categories.find((c) => c.id === payload.categoryId) ||
      categories.find((c) => c.name === payload.category);

    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('skills')
        .upsert(
          {
            id: payload.id || undefined,
            category_id: matchedCat?.id || null,
            slug: cleanSlug,
            title: cleanTitle,
            category: matchedCat?.name || payload.category,
            level: payload.level || 'Beginner',
            summary: String(payload.summary || '').trim(),
            competency_expectations: String(payload.competencyExpectations || '').trim(),
            prerequisites: payload.prerequisites || [],
            publication_status: payload.publicationStatus || 'published',
            roadmap_status: payload.roadmapStatus || 'coming_soon',
            est_hours: Number(payload.estHours || 6),
            outcomes: parsedOutcomes,
          },
          { onConflict: 'slug' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const existing = payload.id
        ? draft.skills.find((s) => s.id === payload.id)
        : draft.skills.find((s) => s.slug === cleanSlug);

      const enriched = {
        categoryId: matchedCat?.id || payload.categoryId || null,
        slug: cleanSlug,
        title: cleanTitle,
        category: matchedCat?.name || payload.category || 'General',
        level: payload.level || 'Beginner',
        summary: String(payload.summary || '').trim(),
        competencyExpectations:
          String(payload.competencyExpectations || '').trim() ||
          `Demonstrate applied understanding and produce portfolio-grade deliverables for ${cleanTitle}.`,
        prerequisites: payload.prerequisites || [],
        publicationStatus: payload.publicationStatus || 'published',
        roadmapStatus: payload.roadmapStatus || existing?.roadmapStatus || 'coming_soon',
        estHours: Number(payload.estHours || 6),
        outcomes:
          parsedOutcomes.length > 0
            ? parsedOutcomes
            : existing?.outcomes?.length
              ? existing.outcomes
              : [
                  `Explain core frameworks in ${cleanTitle}`,
                  `Deliver practical projects evaluated against a structured rubric`,
                ],
      };

      if (existing) {
        Object.assign(existing, enriched);
        return draft;
      }

      draft.skills.push({
        id: `skill-${cleanSlug}-${Date.now().toString(36).slice(-4)}`,
        ...enriched,
      });
      return draft;
    });
  });
}

export async function adminUpsertCourse(payload) {
  const cleanTitle = String(payload.title || '').trim();
  const cleanSlug = payload.slug ? slugify(payload.slug) : slugify(cleanTitle);
  const key = buildIdempotencyKey('admin-course', payload.id || cleanSlug, payload.skillId);

  return runIdempotent(key, async () => {
    const parsedOutcomes = Array.isArray(payload.outcomes)
      ? payload.outcomes
      : String(payload.outcomes || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
    const parsedPrereqs = Array.isArray(payload.prerequisites)
      ? payload.prerequisites
      : String(payload.prerequisites || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);

    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('courses')
        .upsert(
          {
            id: payload.id || undefined,
            skill_id: payload.skillId,
            slug: cleanSlug,
            title: cleanTitle,
            description: String(payload.description || '').trim(),
            outcomes: parsedOutcomes,
            difficulty: payload.difficulty || 'Beginner',
            estimated_duration_weeks: Number(payload.estimatedDurationWeeks || 4),
            recommended_weekly_hours: Number(payload.recommendedWeeklyHours || 4),
            recommended_schedule: String(payload.recommendedSchedule || 'Self-paced weekly milestones').trim(),
            prerequisites: parsedPrereqs,
            completion_rules: payload.completionRules || {
              requireAllRequiredLessons: true,
              requireAllAssessments: true,
              requireChallengeApproval: true,
            },
            publication_status: payload.publicationStatus || 'published',
            position: Number(payload.position || 1),
          },
          { onConflict: 'slug' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      draft.courses = draft.courses || [];
      const existing = payload.id
        ? draft.courses.find((c) => c.id === payload.id)
        : draft.courses.find((c) => c.slug === cleanSlug);

      const siblingCount = draft.courses.filter((c) => c.skillId === payload.skillId).length;
      const fields = {
        skillId: payload.skillId,
        slug: cleanSlug,
        title: cleanTitle,
        description: String(payload.description || '').trim(),
        outcomes: parsedOutcomes,
        difficulty: payload.difficulty || 'Beginner',
        estimatedDurationWeeks: Number(payload.estimatedDurationWeeks || 4),
        recommendedWeeklyHours: Number(payload.recommendedWeeklyHours || 4),
        recommendedSchedule:
          String(payload.recommendedSchedule || '').trim() || '2 lessons + 1 practical exercise per week',
        prerequisites: parsedPrereqs,
        completionRules: payload.completionRules || {
          requireAllRequiredLessons: true,
          requireAllAssessments: true,
          requireChallengeApproval: true,
        },
        publicationStatus: payload.publicationStatus || 'published',
        position: Number(payload.position || existing?.position || siblingCount + 1),
      };

      if (existing) {
        Object.assign(existing, fields);
        return draft;
      }

      const newCourseId = `course-${Date.now()}`;
      draft.courses.push({
        id: newCourseId,
        ...fields,
        phases: [
          {
            id: `ph-${newCourseId}-1`,
            position: 1,
            title: 'Phase 1: Core Foundations',
            summary: 'Foundational concepts and guided exercises.',
            objectives: ['Build foundational fluency in this course topic'],
            difficulty: fields.difficulty,
            estHours: 4,
            lessons: [],
          },
        ],
      });
      return draft;
    });
  });
}

export async function adminUpsertPhase({
  id,
  courseId,
  title,
  summary = '',
  objectives = [],
  difficulty = 'Beginner',
  estHours = 3,
  position,
}) {
  const key = buildIdempotencyKey('admin-phase', id || courseId, title);
  return runIdempotent(key, async () => {
    const cleanObjectives = Array.isArray(objectives)
      ? objectives
      : String(objectives || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);

    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('phases')
        .upsert({
          id: id || undefined,
          course_id: courseId,
          position: Number(position || 1),
          title: String(title || '').trim(),
          summary: String(summary || '').trim(),
          objectives: cleanObjectives,
          difficulty,
          est_hours: Number(estHours || 3),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course) throw new Error('Course not found');
      course.phases = course.phases || [];
      const existing = id
        ? course.phases.find((p) => p.id === id)
        : course.phases.find((p) => p.title.trim().toLowerCase() === String(title).trim().toLowerCase());

      if (existing) {
        existing.title = String(title || '').trim();
        existing.summary = String(summary || '').trim();
        existing.objectives = cleanObjectives;
        existing.difficulty = difficulty;
        existing.estHours = Number(estHours || 3);
        if (position) existing.position = Number(position);
      } else {
        course.phases.push({
          id: `ph-${Date.now()}`,
          position: Number(position || course.phases.length + 1),
          title: String(title || '').trim(),
          summary: String(summary || '').trim(),
          objectives: cleanObjectives,
          difficulty,
          estHours: Number(estHours || 3),
          lessons: [],
        });
      }
      return draft;
    });
  });
}

export async function adminUpsertLesson({
  id,
  courseId,
  phaseId,
  title,
  introduction = '',
  objectives = [],
  estMinutes = 25,
  blocks = [],
  videos = [],
  summary = '',
  takeaways = [],
  furtherReading = [],
  isRequired = true,
}) {
  const key = buildIdempotencyKey('admin-lesson', id || phaseId, title, String(blocks.length), String(videos.length));
  return runIdempotent(key, async () => {
    const cleanVideos = (videos || []).map((v) => {
      if (v.videoId && v.embedUrl && !v.urlUpdated) return v;
      const normalized = normalizeVideoEntry(v);
      if (!normalized.valid) throw new Error(normalized.error);
      return normalized.video;
    });

    const cleanObjectives = Array.isArray(objectives)
      ? objectives
      : String(objectives || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);

    const cleanTakeaways = Array.isArray(takeaways)
      ? takeaways
      : String(takeaways || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);

    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('lessons')
        .upsert({
          id: id || undefined,
          phase_id: phaseId,
          position: Date.now() % 10000,
          title: String(title || '').trim(),
          introduction: String(introduction || '').trim(),
          objectives: cleanObjectives,
          est_minutes: Number(estMinutes || 25),
          blocks,
          videos: cleanVideos,
          summary: String(summary || '').trim(),
          takeaways: cleanTakeaways,
          further_reading: furtherReading || [],
          is_required: Boolean(isRequired),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course) throw new Error('Course not found');
      const phase = (course.phases || []).find((p) => p.id === phaseId);
      if (!phase) throw new Error('Phase not found');
      phase.lessons = phase.lessons || [];

      const existing = id ? phase.lessons.find((l) => l.id === id) : null;
      const lessonData = {
        title: String(title || '').trim(),
        introduction: String(introduction || '').trim(),
        objectives: cleanObjectives,
        estMinutes: Number(estMinutes || 25),
        blocks: Array.isArray(blocks) ? blocks : [],
        videos: cleanVideos,
        summary: String(summary || '').trim(),
        takeaways: cleanTakeaways,
        furtherReading: furtherReading || [],
        isRequired: Boolean(isRequired),
      };

      if (existing) {
        Object.assign(existing, lessonData);
      } else {
        phase.lessons.push({
          id: `les-${Date.now()}`,
          position: phase.lessons.length + 1,
          ...lessonData,
        });
      }
      return draft;
    });
  });
}

export async function adminDeleteLesson(courseId, phaseId, lessonId) {
  const key = buildIdempotencyKey('admin-lesson-del', courseId, phaseId, lessonId);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.from('lessons').delete().eq('id', lessonId);
      if (error) throw error;
      return;
    }
    updateDemoState((draft) => {
      const course = (draft.courses || []).find((c) => c.id === courseId);
      const phase = course?.phases?.find((p) => p.id === phaseId);
      if (phase) {
        phase.lessons = (phase.lessons || []).filter((l) => l.id !== lessonId);
      }
      return draft;
    });
  });
}

function mapCourseSummary(c) {
  return {
    id: c.id,
    skillId: c.skill_id,
    slug: c.slug,
    title: c.title,
    difficulty: c.difficulty,
    estimatedDurationWeeks: c.estimated_duration_weeks,
    publicationStatus: c.publication_status,
    position: c.position,
  };
}

function mapFullCourse(c) {
  return {
    id: c.id,
    skillId: c.skill_id,
    slug: c.slug,
    title: c.title,
    description: c.description || '',
    outcomes: c.outcomes || [],
    difficulty: c.difficulty || 'Beginner',
    estimatedDurationWeeks: Number(c.estimated_duration_weeks || 4),
    recommendedWeeklyHours: Number(c.recommended_weekly_hours || 4),
    recommendedSchedule: c.recommended_schedule || '',
    prerequisites: c.prerequisites || [],
    completionRules: c.completion_rules || {
      requireAllRequiredLessons: true,
      requireAllAssessments: true,
      requireChallengeApproval: true,
    },
    publicationStatus: c.publication_status || 'published',
    position: Number(c.position || 1),
    phases: (c.phases || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((p) => ({
        id: p.id,
        position: p.position,
        title: p.title,
        summary: p.summary || '',
        objectives: p.objectives || [],
        difficulty: p.difficulty || 'Beginner',
        estHours: Number(p.est_hours || 2),
        lessons: (p.lessons || [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((l) => ({
            id: l.id,
            position: l.position,
            title: l.title,
            introduction: l.introduction || '',
            objectives: l.objectives || [],
            estMinutes: Number(l.est_minutes || 25),
            blocks: l.blocks || [],
            videos: l.videos || [],
            summary: l.summary || '',
            takeaways: l.takeaways || [],
            furtherReading: l.further_reading || [],
            isRequired: l.is_required !== false,
          })),
      })),
  };
}

function mapChallenge(c) {
  return {
    id: c.id,
    skillId: c.skill_id,
    courseId: c.course_id || null,
    phaseId: c.phase_id || null,
    title: c.title,
    brief: c.brief,
    instructions: c.instructions || c.brief,
    expectedDeliverables: c.expected_deliverables || [],
    submissionFormat: c.submission_format || 'URL, file upload, or structured written response',
    deliverableHint: c.deliverable_hint || '',
    maxScore: Number(c.max_score || 20),
    passingScore: Number(c.passing_score || 14),
    rubric: c.rubric || [],
  };
}
