import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, updateDemoState } from '../demo/demoStore.js';
import { slugify } from '../formatters.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';
import { normalizeVideoEntry } from '../videoProvider.js';
import { validateRubricWeights, DEFAULT_ALLOWED_MIME_TYPES } from '../validators.js';

export function validateCourseForPublish(course, { assessments = null, challenges = null } = {}) {
  const errors = [];
  if (!course) {
    return { valid: false, errors: ['Course does not exist.'] };
  }
  if (!course.title || String(course.title).trim().length < 3) {
    errors.push('Course title must be at least 3 characters.');
  }
  if (!course.description || String(course.description).trim().length < 15) {
    errors.push('Course description must be at least 15 characters.');
  }
  if (!course.skillId) {
    errors.push('Associate the course with a primary competency before publishing.');
  }
  if (!Array.isArray(course.outcomes) || course.outcomes.length === 0) {
    errors.push('Add at least 1 learning objective before publishing.');
  }
  const phases = (course.phases || []).filter(
    (p) => (p.publicationStatus || 'published') === 'published'
  );
  if (phases.length === 0) {
    errors.push('Course must contain at least 1 published module/phase before publishing.');
  } else {
    const publishedLessons = phases.flatMap((p) =>
      (p.lessons || []).filter((l) => (l.publicationStatus || 'published') === 'published')
    );
    if (publishedLessons.length === 0) {
      errors.push('Course must contain at least 1 published lesson before publishing.');
    } else {
      const emptyLesson = publishedLessons.find(
        (l) => !l.title || !Array.isArray(l.blocks) || l.blocks.length < 1
      );
      if (emptyLesson) {
        errors.push(`Lesson "${emptyLesson.title || 'Untitled'}" needs structured instructional blocks.`);
      }
    }
  }

  const rules = course.completionRules || {};
  const courseAssessments = assessments ?? course.assessments ?? null;
  const courseChallenges = challenges ?? course.challenges ?? null;

  if (rules.requireAllAssessments && Array.isArray(courseAssessments)) {
    const withQuestions = courseAssessments.filter(
      (q) => !Array.isArray(q.questions) || q.questions.length > 0
    );
    if (withQuestions.length === 0) {
      errors.push('Add at least 1 knowledge assessment before publishing.');
    }
  }

  if ((rules.requireChallengeSubmission || rules.requireChallengeApproval) && Array.isArray(courseChallenges)) {
    if (courseChallenges.length === 0) {
      errors.push('Add a Final Practical Challenge with a rubric before publishing.');
    } else {
      for (const ch of courseChallenges) {
        const rubricCheck = validateRubricWeights(ch.rubric || []);
        if (!rubricCheck.valid) {
          errors.push(`Challenge "${ch.title}": ${rubricCheck.error}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function getCourseLinkedSkillIds(course) {
  return Array.from(
    new Set([course.skillId, ...(course.associatedSkillIds || [])].filter(Boolean))
  );
}

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
    const [{ data: skillsData, error }, { data: coursesData }, { data: linksData }] = await Promise.all([
      supabase.from('skills').select('*').order('title'),
      supabase.from('courses').select('id, skill_id, slug, title, difficulty, estimated_duration_weeks, publication_status, thumbnail_url, author_name, version, position'),
      supabase.from('course_skills').select('course_id, skill_id'),
    ]);
    if (error) throw error;
    const extraLinksByCourse = new Map();
    (linksData || []).forEach((row) => {
      if (!extraLinksByCourse.has(row.course_id)) extraLinksByCourse.set(row.course_id, []);
      extraLinksByCourse.get(row.course_id).push(row.skill_id);
    });
    const courses = (coursesData || []).map((c) =>
      mapCourseSummary({ ...c, course_skills: (extraLinksByCourse.get(c.id) || []).map((sid) => ({ skill_id: sid })) })
    );

    return (skillsData || [])
      .map((s) => {
        const allSkillCourses = courses
          .filter((c) => getCourseLinkedSkillIds(c).includes(s.id))
          .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
        const publishedCourses = allSkillCourses.filter((c) => c.publicationStatus === 'published');
        const draftCourseCount = allSkillCourses.filter((c) => c.publicationStatus === 'draft').length;
        const visibleCourses = includeDrafts ? allSkillCourses : publishedCourses;
        return {
          ...s,
          categoryId: s.category_id,
          competencyExpectations: s.competency_expectations || '',
          prerequisites: s.prerequisites || [],
          supportedByCourseSlug: s.supported_by_course_slug || null,
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
        .filter((c) => getCourseLinkedSkillIds(c).includes(s.id))
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      const publishedCourses = allSkillCourses.filter((c) => c.publicationStatus === 'published');
      const draftCourseCount = allSkillCourses.filter((c) => c.publicationStatus === 'draft').length;
      const visibleCourses = includeDrafts ? allSkillCourses : publishedCourses;
      return {
        ...s,
        supportedByCourseSlug: s.supportedByCourseSlug || null,
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
    const [{ data: extraLinks }, { data: directCourses }, { data: quizzesData }, { data: challengesData }] = await Promise.all([
      supabase.from('course_skills').select('course_id').eq('skill_id', skill.id),
      supabase
        .from('courses')
        .select('*, course_skills(skill_id), phases(*, lessons(*), activities(*))')
        .eq('skill_id', skill.id)
        .order('position'),
      supabase.from('quizzes').select('id, course_id, phase_id, quiz_type, title').eq('skill_id', skill.id),
      supabase.from('challenges').select('id, course_id, title').eq('skill_id', skill.id),
    ]);

    const extraCourseIds = (extraLinks || []).map((r) => r.course_id);
    let extraCourses = [];
    if (extraCourseIds.length > 0) {
      const { data: ec } = await supabase
        .from('courses')
        .select('*, course_skills(skill_id), phases(*, lessons(*), activities(*))')
        .in('id', extraCourseIds)
        .order('position');
      extraCourses = ec || [];
    }

    const mergedMap = new Map();
    [...(directCourses || []), ...extraCourses].forEach((row) => mergedMap.set(row.id, row));

    const courses = [...mergedMap.values()]
      .map((c) => mapFullCourse(c, { includeDrafts }))
      .filter((c) => includeDrafts || c.publicationStatus === 'published')
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));

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
    .filter((c) => getCourseLinkedSkillIds(c).includes(skill.id) && (includeDrafts || c.publicationStatus === 'published'))
    .map((c) => normalizeCourseForRead(c, { includeDrafts }))
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
      .select('*, skills(id, slug, title, category, category_id), course_skills(skill_id), phases(*, lessons(*), activities(*))')
      .order('title');
    if (error) throw error;
    return (data || [])
      .map((c) => ({
        ...mapFullCourse(c, { includeDrafts }),
        categoryId: c.skills?.category_id || null,
        categoryName: c.skills?.category || '',
        skill: c.skills || null,
      }))
      .filter((c) => includeDrafts || c.publicationStatus === 'published');
  }

  const state = getDemoState();
  const skillById = new Map((state.skills || []).map((s) => [s.id, s]));
  return (state.courses || [])
    .filter((c) => includeDrafts || c.publicationStatus === 'published')
    .map((c) => {
      const skill = skillById.get(c.skillId) || null;
      return {
        ...normalizeCourseForRead(c, { includeDrafts }),
        categoryId: skill?.categoryId || c.categoryId || null,
        categoryName: skill?.category || '',
        skill,
      };
    });
}

export async function listAllChallenges() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.from('challenges').select('*');
    if (error) throw error;
    return (data || []).map(mapChallenge);
  }
  return (getDemoState().challenges || []).slice();
}

export async function getCourseBySlug(slug, { includeDrafts = false } = {}) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('courses')
      .select('*, skills(*), course_skills(skill_id), course_versions(*), phases(*, lessons(*), activities(*))')
      .eq('slug', slug)
      .single();
    if (error || !data) return null;
    if (!includeDrafts && data.publication_status !== 'published') return null;
    const course = mapFullCourse(data, { includeDrafts });
    const [{ data: assessments }, { data: challenges }] = await Promise.all([
      supabase
        .from('quizzes')
        .select('id, course_id, phase_id, lesson_id, quiz_type, title, description, pass_percent, time_limit_minutes, max_attempts, questions(id)')
        .eq('course_id', course.id),
      supabase.from('challenges').select('*').eq('course_id', course.id),
    ]);
    return {
      ...course,
      categoryId: data.skills?.category_id || null,
      categoryName: data.skills?.category || '',
      skill: data.skills || null,
      versions: (data.course_versions || [])
        .slice()
        .sort((a, b) => Number(b.version_number || 0) - Number(a.version_number || 0))
        .map((v) => ({
          id: v.id,
          courseId: v.course_id,
          versionNumber: v.version_number,
          changeNotes: v.change_notes,
          snapshot: v.snapshot || {},
          createdAt: v.created_at,
        })),
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
        questions: Array.isArray(a.questions) ? a.questions : [],
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

  const normalized = normalizeCourseForRead(course, { includeDrafts });
  const associatedSkills = (normalized.associatedSkillIds || [])
    .map((sid) => (state.skills || []).find((s) => s.id === sid))
    .filter(Boolean);
  const assessments = (state.quizzes || []).filter((q) => q.courseId === course.id);
  const challenges = (state.challenges || []).filter((c) => c.courseId === course.id);
  const versions = (state.courseVersions || [])
    .filter((v) => v.courseId === course.id)
    .slice()
    .sort((a, b) => Number(b.versionNumber || 0) - Number(a.versionNumber || 0));

  return {
    ...normalized,
    categoryId: skill?.categoryId || normalized.categoryId || null,
    categoryName: skill?.category || '',
    skill,
    associatedSkills,
    versions,
    assessments,
    challenges,
  };
}

export async function getCourseById(courseId, { includeDrafts = false } = {}) {
  if (!isDemoMode && supabase) {
    const { data } = await supabase.from('courses').select('slug').eq('id', courseId).single();
    if (!data) return null;
    return getCourseBySlug(data.slug, { includeDrafts });
  }
  const course = (getDemoState().courses || []).find((c) => c.id === courseId);
  return course ? getCourseBySlug(course.slug, { includeDrafts }) : null;
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
            supported_by_course_slug: payload.supportedByCourseSlug || null,
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
        supportedByCourseSlug:
          payload.supportedByCourseSlug !== undefined
            ? payload.supportedByCourseSlug
            : existing?.supportedByCourseSlug || null,
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
  const linkedSkills = Array.from(
    new Set([payload.skillId, ...(payload.associatedSkillIds || [])].filter(Boolean))
  );
  const key = buildIdempotencyKey(
    'admin-course',
    payload.id || cleanSlug,
    payload.skillId,
    cleanTitle,
    linkedSkills.join(','),
    payload.publicationStatus || ''
  );

  return runIdempotent(key, async () => {
    const parsedOutcomes = Array.isArray(payload.outcomes)
      ? payload.outcomes.map((x) => String(x || '').trim()).filter(Boolean)
      : String(payload.outcomes || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
    const parsedPrereqs = Array.isArray(payload.prerequisites)
      ? payload.prerequisites.map((x) => String(x || '').trim()).filter(Boolean)
      : String(payload.prerequisites || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);

    const requestedStatus = payload.publicationStatus || 'draft';
    if (requestedStatus === 'published' && !payload.id) {
      throw new Error(
        'New courses must be saved as draft first and pass publish validation before publishing.'
      );
    }
    if (requestedStatus === 'published' && payload.id) {
      const existingFull = await getCourseById(payload.id, { includeDrafts: true });
      if (!existingFull) {
        throw new Error('Course not found');
      }
      const candidate = {
        ...existingFull,
        title: cleanTitle,
        description: String(payload.description || '').trim(),
        outcomes: parsedOutcomes,
        completionRules: payload.completionRules || existingFull.completionRules,
      };
      const check = validateCourseForPublish(candidate);
      if (!check.valid) {
        throw new Error(check.errors.join(' '));
      }
    }

    const nowIso = new Date().toISOString();

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
            target_audience: String(payload.targetAudience || '').trim(),
            outcomes: parsedOutcomes,
            difficulty: payload.difficulty || 'Beginner',
            estimated_duration_weeks: Number(payload.estimatedDurationWeeks || 4),
            recommended_weekly_hours: Number(payload.recommendedWeeklyHours || 4),
            recommended_schedule: String(payload.recommendedSchedule || 'Self-paced weekly milestones').trim(),
            prerequisites: parsedPrereqs,
            thumbnail_url: String(payload.thumbnailUrl || '').trim(),
            author_name: String(payload.authorName || 'Kord Curriculum Studio').trim(),
            completion_rules: payload.completionRules || {
              requireAllRequiredLessons: true,
              requireAllActivities: true,
              requireAllAssessments: true,
              requireChallengeSubmission: true,
              requireChallengeApproval: true,
            },
            publication_status: requestedStatus,
            position: Number(payload.position || 1),
            updated_at: nowIso,
          },
          { onConflict: 'slug' }
        )
        .select()
        .single();
      if (error) throw error;

      if (data?.id && linkedSkills.length > 0) {
        await supabase.from('course_skills').delete().eq('course_id', data.id);
        await supabase.from('course_skills').insert(
          linkedSkills.map((sid) => ({
            course_id: data.id,
            skill_id: sid,
            is_primary: sid === payload.skillId,
          }))
        );
      }
      return data;
    }

    let savedCourse = null;
    updateDemoState((draft) => {
      draft.courses = draft.courses || [];
      draft.courseVersions = draft.courseVersions || [];
      const existing = payload.id
        ? draft.courses.find((c) => c.id === payload.id)
        : draft.courses.find((c) => c.slug === cleanSlug);

      const siblingCount = draft.courses.filter((c) => c.skillId === payload.skillId).length;
      const fields = {
        skillId: payload.skillId,
        associatedSkillIds: linkedSkills,
        slug: cleanSlug,
        title: cleanTitle,
        description: String(payload.description || '').trim(),
        targetAudience:
          String(payload.targetAudience || '').trim() ||
          'Learners building practical portfolio-grade fluency in this skill area.',
        outcomes: parsedOutcomes,
        difficulty: payload.difficulty || 'Beginner',
        estimatedDurationWeeks: Number(payload.estimatedDurationWeeks || 4),
        recommendedWeeklyHours: Number(payload.recommendedWeeklyHours || 4),
        recommendedSchedule:
          String(payload.recommendedSchedule || '').trim() || '2 lessons + 1 practical exercise per week',
        prerequisites: parsedPrereqs,
        thumbnailUrl:
          payload.thumbnailUrl !== undefined
            ? String(payload.thumbnailUrl || '').trim()
            : existing?.thumbnailUrl || '',
        authorName:
          String(payload.authorName || '').trim() || existing?.authorName || 'Kord Curriculum Studio',
        completionRules: payload.completionRules || existing?.completionRules || {
          requireAllRequiredLessons: true,
          requireAllActivities: true,
          requireAllAssessments: true,
          requireChallengeSubmission: true,
          requireChallengeApproval: true,
        },
        publicationStatus: requestedStatus,
        version: existing?.version || 1,
        position: Number(payload.position || existing?.position || siblingCount + 1),
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      if (existing) {
        Object.assign(existing, fields);
        savedCourse = existing;
        return draft;
      }

      const newCourseId = `course-${Date.now()}`;
      const newCourse = {
        id: newCourseId,
        ...fields,
        publicationStatus: requestedStatus === 'published' ? 'draft' : requestedStatus,
        phases: [
          {
            id: `ph-${newCourseId}-1`,
            position: 1,
            title: 'Module 1: Introduction & Foundations',
            summary: 'Foundational concepts and guided exercises.',
            objectives: ['Build foundational fluency in this course topic'],
            difficulty: fields.difficulty,
            estHours: 3,
            publicationStatus: 'published',
            activities: [],
            lessons: [],
          },
        ],
      };
      draft.courses.push(newCourse);
      draft.courseVersions.push({
        id: `cv-${newCourseId}-v1`,
        courseId: newCourseId,
        versionNumber: 1,
        changeNotes: 'Initial course draft created.',
        snapshot: { title: fields.title, difficulty: fields.difficulty, phaseCount: 1, lessonCount: 0 },
        createdAt: nowIso,
      });
      savedCourse = newCourse;
      return draft;
    });
    return savedCourse;
  });
}

export async function adminSetCourseStatus(courseId, status) {
  const allowed = ['published', 'draft', 'archived'];
  if (!allowed.includes(status)) {
    throw new Error('Invalid course publication status.');
  }

  const fullCourse = await getCourseById(courseId, { includeDrafts: true });
  if (!fullCourse) throw new Error('Course not found');

  if (status === 'published') {
    const check = validateCourseForPublish(fullCourse);
    if (!check.valid) {
      throw new Error(check.errors.join(' '));
    }
  }

  const key = buildIdempotencyKey('admin-course-status', courseId, status, Date.now());
  return runIdempotent(key, async () => {
    const nowIso = new Date().toISOString();
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('courses')
        .update({ publication_status: status, updated_at: nowIso })
        .eq('id', courseId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course) throw new Error('Course not found');
      course.publicationStatus = status;
      course.updatedAt = nowIso;
      return draft;
    });
  });
}

export async function adminCreateCourseVersion(courseId, changeNotes = '') {
  const cleanNotes = String(changeNotes || '').trim() || 'Curriculum update release';
  const key = buildIdempotencyKey('admin-course-version', courseId, cleanNotes, Date.now());
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase.rpc('admin_create_course_version', {
        p_course_id: courseId,
        p_change_notes: cleanNotes,
      });
      if (error) throw error;
      return data;
    }

    const nowIso = new Date().toISOString();
    let createdVersion = null;
    updateDemoState((draft) => {
      draft.courseVersions = draft.courseVersions || [];
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course) throw new Error('Course not found');
      const nextVersion = Number(course.version || 1) + 1;
      course.version = nextVersion;
      course.updatedAt = nowIso;

      createdVersion = {
        id: `cv-${courseId}-v${nextVersion}`,
        courseId,
        versionNumber: nextVersion,
        changeNotes: cleanNotes,
        snapshot: {
          title: course.title,
          difficulty: course.difficulty,
          phaseCount: (course.phases || []).length,
          lessonCount: (course.phases || []).reduce((sum, p) => sum + (p.lessons || []).length, 0),
        },
        createdAt: nowIso,
      };
      draft.courseVersions.unshift(createdVersion);
      return draft;
    });
    return createdVersion;
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
  publicationStatus = 'published',
  position,
}) {
  const key = buildIdempotencyKey('admin-phase', id || courseId, title, publicationStatus);
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
          publication_status: publicationStatus,
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
        existing.publicationStatus = publicationStatus;
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
          publicationStatus,
          activities: [],
          lessons: [],
        });
      }
      course.updatedAt = new Date().toISOString();
      return draft;
    });
  });
}

export async function adminReorderPhases(courseId, orderedPhaseIds) {
  const key = buildIdempotencyKey('admin-phase-reorder', courseId, orderedPhaseIds.join(','), Date.now());
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('admin_reorder_phases', {
        p_course_id: courseId,
        p_phase_ids: orderedPhaseIds,
      });
      if (error) throw error;
      return;
    }

    updateDemoState((draft) => {
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course) throw new Error('Course not found');
      const posMap = new Map(orderedPhaseIds.map((pid, idx) => [pid, idx + 1]));
      (course.phases || []).forEach((p) => {
        if (posMap.has(p.id)) p.position = posMap.get(p.id);
      });
      course.phases.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      course.updatedAt = new Date().toISOString();
      return draft;
    });
  });
}

export async function adminUpsertActivity({
  id,
  courseId,
  phaseId,
  lessonId = null,
  title,
  description = '',
  instructions = '',
  expectedOutput = '',
  estMinutes = 25,
  isRequired = true,
  position,
}) {
  const key = buildIdempotencyKey('admin-activity', id || phaseId, title);
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('activities')
        .upsert({
          id: id || undefined,
          phase_id: phaseId,
          lesson_id: lessonId || null,
          position: Number(position || 1),
          title: String(title || '').trim(),
          description: String(description || '').trim(),
          instructions: String(instructions || '').trim(),
          expected_output: String(expectedOutput || '').trim(),
          est_minutes: Number(estMinutes || 25),
          is_required: Boolean(isRequired),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return updateDemoState((draft) => {
      const course = (draft.courses || []).find((c) => c.id === courseId);
      const phase = course?.phases?.find((p) => p.id === phaseId);
      if (!phase) throw new Error('Phase not found');
      phase.activities = phase.activities || [];
      const existing = id ? phase.activities.find((a) => a.id === id) : null;
      const fields = {
        phaseId,
        lessonId: lessonId || null,
        title: String(title || '').trim(),
        description: String(description || '').trim(),
        instructions: String(instructions || '').trim(),
        expectedOutput: String(expectedOutput || '').trim(),
        estMinutes: Number(estMinutes || 25),
        isRequired: Boolean(isRequired),
      };
      if (existing) {
        Object.assign(existing, fields);
      } else {
        phase.activities.push({
          id: `act-${Date.now()}`,
          position: Number(position || phase.activities.length + 1),
          ...fields,
          resources: [],
        });
      }
      course.updatedAt = new Date().toISOString();
      return draft;
    });
  });
}

export async function adminUpsertLesson({
  id,
  courseId,
  phaseId,
  position,
  title,
  introduction = '',
  objectives = [],
  estMinutes = 25,
  blocks = [],
  videos = [],
  summary = '',
  takeaways = [],
  furtherReading = [],
  completionCriteria = 'Read the instructional guide, verify any inline checks, and mark complete.',
  publicationStatus = 'published',
  isRequired = true,
}) {
  const key = buildIdempotencyKey('admin-lesson', id || phaseId, title, String(blocks.length), String(videos.length), publicationStatus);
  return runIdempotent(key, async () => {
    const cleanVideos = (videos || []).map((v) => {
      if (v.videoId && v.embedUrl && !v.urlUpdated) return v;
      const normalized = normalizeVideoEntry(v);
      if (!normalized.valid) throw new Error(normalized.error);
      return normalized.video;
    });

    const cleanObjectives = Array.isArray(objectives)
      ? objectives.map((x) => String(x || '').trim()).filter(Boolean)
      : String(objectives || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);

    const cleanTakeaways = Array.isArray(takeaways)
      ? takeaways.map((x) => String(x || '').trim()).filter(Boolean)
      : String(takeaways || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);

    const cleanResources = (furtherReading || []).filter((fr) => fr && fr.url);

    if (!isDemoMode && supabase) {
      let resolvedPosition = position;
      if (!resolvedPosition && id) {
        const { data: ex } = await supabase.from('lessons').select('position').eq('id', id).single();
        resolvedPosition = ex?.position;
      }
      if (!resolvedPosition) {
        const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('phase_id', phaseId);
        resolvedPosition = Number(count || 0) + 1;
      }

      const { data, error } = await supabase
        .from('lessons')
        .upsert({
          id: id || undefined,
          phase_id: phaseId,
          position: Number(resolvedPosition),
          title: String(title || '').trim(),
          introduction: String(introduction || '').trim(),
          objectives: cleanObjectives,
          est_minutes: Number(estMinutes || 25),
          blocks,
          videos: cleanVideos,
          summary: String(summary || '').trim(),
          takeaways: cleanTakeaways,
          further_reading: cleanResources,
          completion_criteria: String(completionCriteria || '').trim(),
          publication_status: publicationStatus,
          is_required: Boolean(isRequired),
        })
        .select()
        .single();
      if (error) throw error;

      if (data?.id) {
        await supabase.from('lesson_resources').delete().eq('lesson_id', data.id);
        if (cleanResources.length > 0) {
          await supabase.from('lesson_resources').insert(
            cleanResources.map((fr, idx) => ({
              lesson_id: data.id,
              title: String(fr.title || fr.url).trim(),
              url: String(fr.url).trim(),
              resource_type: fr.resourceType || 'article',
              position: idx + 1,
            }))
          );
        }
      }
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
        furtherReading: cleanResources,
        completionCriteria: String(completionCriteria || '').trim(),
        publicationStatus,
        isRequired: Boolean(isRequired),
      };

      if (existing) {
        Object.assign(existing, lessonData);
      } else {
        phase.lessons.push({
          id: `les-${Date.now()}`,
          position: Number(position || phase.lessons.length + 1),
          ...lessonData,
        });
      }
      course.updatedAt = new Date().toISOString();
      return draft;
    });
  });
}

export async function adminDeletePhase(courseId, phaseId) {
  const key = buildIdempotencyKey('admin-phase-del', courseId, phaseId, Date.now());
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const [{ data: phaseLessons }, { data: phaseActs }, { count: quizCount }] = await Promise.all([
        supabase.from('lessons').select('id').eq('phase_id', phaseId),
        supabase.from('activities').select('id').eq('phase_id', phaseId),
        supabase.from('quizzes').select('id', { count: 'exact', head: true }).eq('phase_id', phaseId),
      ]);
      if ((quizCount || 0) > 0) {
        throw new Error('Cannot delete a module that has linked assessments. Reassign or remove the assessment first.');
      }
      const lessonIds = (phaseLessons || []).map((l) => l.id);
      if (lessonIds.length > 0) {
        const { count: lpCount } = await supabase
          .from('lesson_progress')
          .select('id', { count: 'exact', head: true })
          .in('lesson_id', lessonIds);
        if ((lpCount || 0) > 0) {
          throw new Error('Cannot delete a module with existing learner lesson progress. Unpublish it instead.');
        }
      }
      const actIds = (phaseActs || []).map((a) => a.id);
      if (actIds.length > 0) {
        const { count: apCount } = await supabase
          .from('activity_progress')
          .select('id', { count: 'exact', head: true })
          .in('activity_id', actIds);
        if ((apCount || 0) > 0) {
          throw new Error('Cannot delete a module with existing learner activity progress. Unpublish it instead.');
        }
      }
      const { error } = await supabase.from('phases').delete().eq('id', phaseId).eq('course_id', courseId);
      if (error) throw error;
      return;
    }

    updateDemoState((draft) => {
      const course = (draft.courses || []).find((c) => c.id === courseId);
      const phase = course?.phases?.find((p) => p.id === phaseId);
      if (!phase) throw new Error('Module not found');

      const linkedQuiz = (draft.quizzes || []).some((q) => q.phaseId === phaseId);
      if (linkedQuiz) {
        throw new Error('Cannot delete a module that has linked assessments. Remove or reassign the assessment first.');
      }
      const lessonIds = new Set((phase.lessons || []).map((l) => l.id));
      const hasLessonProgress = (draft.lessonProgress || []).some((lp) => lessonIds.has(lp.lessonId));
      const actIds = new Set((phase.activities || []).map((a) => a.id));
      const hasActivityProgress = (draft.activityProgress || []).some((ap) => actIds.has(ap.activityId));
      if (hasLessonProgress || hasActivityProgress) {
        throw new Error('Cannot delete a module with recorded learner progress. Unpublish the module instead.');
      }

      course.phases = (course.phases || [])
        .filter((p) => p.id !== phaseId)
        .map((p, idx) => ({ ...p, position: idx + 1 }));
      course.updatedAt = new Date().toISOString();
      return draft;
    });
  });
}

export async function adminReorderLessons(courseId, phaseId, orderedLessonIds) {
  const key = buildIdempotencyKey('admin-lesson-reorder', courseId, phaseId, orderedLessonIds.join(','), Date.now());
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('admin_reorder_lessons', {
        p_phase_id: phaseId,
        p_lesson_ids: orderedLessonIds,
      });
      if (error) throw new Error(error.message);
      return;
    }

    updateDemoState((draft) => {
      const course = (draft.courses || []).find((c) => c.id === courseId);
      const phase = course?.phases?.find((p) => p.id === phaseId);
      if (!phase) throw new Error('Module not found');
      const posMap = new Map(orderedLessonIds.map((lid, idx) => [lid, idx + 1]));
      (phase.lessons || []).forEach((l) => {
        if (posMap.has(l.id)) l.position = posMap.get(l.id);
      });
      phase.lessons.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      course.updatedAt = new Date().toISOString();
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

export async function adminUpsertChallenge(payload) {
  const cleanTitle = String(payload.title || '').trim();
  if (cleanTitle.length < 3) {
    throw new Error('Challenge title must be at least 3 characters.');
  }
  const cleanBrief = String(payload.brief || '').trim();
  if (cleanBrief.length < 15) {
    throw new Error('Challenge brief must be at least 15 characters.');
  }

  const normalizedRubric = (payload.rubric || []).map((r, idx) => ({
    id: r.id || `crit-${idx + 1}`,
    label: String(r.label || '').trim(),
    description: String(r.description || '').trim(),
    maxPoints: Math.max(1, Number(r.maxPoints || 5)),
    weightPercent: Number(r.weightPercent ?? r.weight ?? 0),
  }));

  const rubricValidation = validateRubricWeights(normalizedRubric);
  if (!rubricValidation.valid) {
    throw new Error(rubricValidation.error);
  }

  const maxScore = rubricValidation.totalPoints;
  const passingScore = Math.min(
    maxScore,
    Math.max(1, Number(payload.passingScore || Math.round(maxScore * 0.72)))
  );
  const expectedDeliverables = Array.isArray(payload.expectedDeliverables)
    ? payload.expectedDeliverables.map((x) => String(x || '').trim()).filter(Boolean)
    : String(payload.expectedDeliverables || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);

  const key = buildIdempotencyKey('admin-challenge', payload.id || payload.courseId || payload.skillId, cleanTitle, Date.now());
  return runIdempotent(key, async () => {
    if (!isDemoMode && supabase) {
      const { data, error } = await supabase
        .from('challenges')
        .upsert({
          id: payload.id || undefined,
          skill_id: payload.skillId,
          course_id: payload.courseId || null,
          phase_id: payload.phaseId || null,
          title: cleanTitle,
          brief: cleanBrief,
          instructions: String(payload.instructions || cleanBrief).trim(),
          expected_deliverables: expectedDeliverables,
          submission_format: String(payload.submissionFormat || 'Project URL, file upload, or written brief').trim(),
          deliverable_hint: String(payload.deliverableHint || '').trim(),
          max_score: maxScore,
          passing_score: passingScore,
          allowed_evidence_types: payload.allowedEvidenceTypes || ['written', 'file', 'project_url', 'screenshot'],
          allowed_mime_types: payload.allowedMimeTypes || DEFAULT_ALLOWED_MIME_TYPES.slice(0, 6),
          max_file_size_mb: Number(payload.maxFileSizeMb || 25),
          is_required: payload.isRequired !== false,
          rubric: normalizedRubric,
        })
        .select()
        .single();
      if (error) throw error;
      return mapChallenge(data);
    }

    let savedChallenge = null;
    updateDemoState((draft) => {
      draft.challenges = draft.challenges || [];
      const existing = payload.id
        ? draft.challenges.find((c) => c.id === payload.id)
        : payload.courseId
          ? draft.challenges.find((c) => c.courseId === payload.courseId)
          : null;
      const fields = {
        skillId: payload.skillId,
        courseId: payload.courseId || null,
        phaseId: payload.phaseId || null,
        title: cleanTitle,
        brief: cleanBrief,
        instructions: String(payload.instructions || cleanBrief).trim(),
        expectedDeliverables,
        submissionFormat: String(payload.submissionFormat || 'Project URL, file upload, or written brief').trim(),
        deliverableHint: String(payload.deliverableHint || '').trim(),
        maxScore,
        passingScore,
        allowedEvidenceTypes: payload.allowedEvidenceTypes || ['written', 'file', 'project_url', 'screenshot'],
        allowedMimeTypes: payload.allowedMimeTypes || DEFAULT_ALLOWED_MIME_TYPES.slice(0, 6),
        maxFileSizeMb: Number(payload.maxFileSizeMb || 25),
        isRequired: payload.isRequired !== false,
        rubric: normalizedRubric,
      };
      if (existing) {
        Object.assign(existing, fields);
        savedChallenge = existing;
      } else {
        savedChallenge = {
          id: `ch-${payload.courseId || Date.now()}`,
          ...fields,
        };
        draft.challenges.push(savedChallenge);
      }
      return draft;
    });
    return savedChallenge;
  });
}

function normalizeCourseForRead(c, { includeDrafts = false } = {}) {
  const associatedSkillIds = Array.from(
    new Set([c.skillId, ...(c.associatedSkillIds || [])].filter(Boolean))
  );
  const phases = (c.phases || [])
    .filter((p) => includeDrafts || (p.publicationStatus || 'published') === 'published')
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map((p) => ({
      ...p,
      publicationStatus: p.publicationStatus || 'published',
      activities: (p.activities || [])
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0)),
      lessons: (p.lessons || [])
        .filter((l) => includeDrafts || (l.publicationStatus || 'published') === 'published')
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0)),
    }));
  return {
    ...c,
    associatedSkillIds,
    version: Number(c.version || 1),
    authorName: c.authorName || 'Kord Curriculum Studio',
    phases,
  };
}

function mapCourseSummary(c) {
  const linked = (c.course_skills || []).map((cs) => cs.skill_id).filter(Boolean);
  return {
    id: c.id,
    skillId: c.skill_id,
    associatedSkillIds: Array.from(new Set([c.skill_id, ...linked].filter(Boolean))),
    slug: c.slug,
    title: c.title,
    difficulty: c.difficulty,
    estimatedDurationWeeks: c.estimated_duration_weeks,
    thumbnailUrl: c.thumbnail_url || '',
    authorName: c.author_name || 'Kord Curriculum Studio',
    version: Number(c.version || 1),
    publicationStatus: c.publication_status,
    position: c.position,
  };
}

function mapFullCourse(c, { includeDrafts = false } = {}) {
  const linked = (c.course_skills || []).map((cs) => cs.skill_id).filter(Boolean);
  return {
    id: c.id,
    skillId: c.skill_id,
    associatedSkillIds: Array.from(new Set([c.skill_id, ...linked].filter(Boolean))),
    slug: c.slug,
    title: c.title,
    description: c.description || '',
    targetAudience: c.target_audience || '',
    outcomes: c.outcomes || [],
    difficulty: c.difficulty || 'Beginner',
    estimatedDurationWeeks: Number(c.estimated_duration_weeks || 4),
    recommendedWeeklyHours: Number(c.recommended_weekly_hours || 4),
    recommendedSchedule: c.recommended_schedule || '',
    prerequisites: c.prerequisites || [],
    thumbnailUrl: c.thumbnail_url || '',
    authorName: c.author_name || 'Kord Curriculum Studio',
    version: Number(c.version || 1),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    completionRules: c.completion_rules || {
      requireAllRequiredLessons: true,
      requireAllActivities: true,
      requireAllAssessments: true,
      requireChallengeSubmission: true,
      requireChallengeApproval: true,
    },
    publicationStatus: c.publication_status || 'published',
    position: Number(c.position || 1),
    phases: (c.phases || [])
      .filter((p) => includeDrafts || (p.publication_status || 'published') === 'published')
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
        publicationStatus: p.publication_status || 'published',
        activities: (p.activities || [])
          .slice()
          .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
          .map((a) => ({
            id: a.id,
            phaseId: a.phase_id,
            lessonId: a.lesson_id || null,
            position: a.position,
            title: a.title,
            description: a.description || '',
            instructions: a.instructions || '',
            expectedOutput: a.expected_output || '',
            estMinutes: Number(a.est_minutes || 20),
            isRequired: a.is_required !== false,
            resources: a.resources || [],
          })),
        lessons: (p.lessons || [])
          .filter((l) => includeDrafts || (l.publication_status || 'published') === 'published')
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
            completionCriteria: l.completion_criteria || '',
            publicationStatus: l.publication_status || 'published',
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
    allowedEvidenceTypes: c.allowed_evidence_types || [
      'written',
      'file',
      'project_url',
      'repo_url',
      'screenshot',
      'audio',
      'video',
    ],
    allowedMimeTypes: c.allowed_mime_types || [],
    maxFileSizeMb: Number(c.max_file_size_mb || 25),
    isRequired: c.is_required !== false,
    rubric: c.rubric || [],
  };
}
