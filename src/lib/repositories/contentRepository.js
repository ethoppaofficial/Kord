import { supabase, isDemoMode } from '../supabase.js';
import { getDemoState, getDemoCurrentUserId, updateDemoState } from '../demo/demoStore.js';
import { appendDemoAuditLog } from '../demo/demoAudit.js';
import { slugify } from '../formatters.js';
import { buildIdempotencyKey, runIdempotent } from '../idempotency.js';
import { normalizeVideoEntry } from '../videoProvider.js';
import { validateRubricWeights, DEFAULT_ALLOWED_MIME_TYPES } from '../validators.js';
import {
  CONTENT_PACKAGE_SCHEMA_VERSION,
  parseContentPackageJson,
  buildDryRunImportPlan,
  buildCourseExportPackage,
  buildCourseCurriculumSnapshot,
  validateLessonInstructionalContent,
} from '../contentPackage.js';

/**
 * @param {import('../../types/kord.d.ts').DemoState} state
 * @returns {import('../../types/kord.d.ts').KordUser}
 */
function requireDemoActiveAdmin(state) {
  const uid = getDemoCurrentUserId();
  const user = uid ? (state.users || []).find((u) => u.id === uid) || null : null;
  if (!user || user.role !== 'admin' || (user.accountStatus || 'active') !== 'active') {
    throw new Error('Administrator access required.');
  }
  return user;
}

/**
 * @param {import('../../types/kord.d.ts').Course | null | undefined} course
 * @param {{ assessments?: import('../../types/kord.d.ts').Quiz[] | null; challenges?: import('../../types/kord.d.ts').Challenge[] | null }} [opts]
 */
export function validateCourseForPublish(course, { assessments = null, challenges = null } = {}) {
  /** @type {string[]} */
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
      for (const l of publishedLessons) {
        const lessonCheck = validateLessonInstructionalContent(l);
        if (!lessonCheck.valid) {
          errors.push(
            `Lesson "${l.title || 'Untitled'}": ${lessonCheck.errors[0]?.message || 'needs structured instructional content.'}`
          );
        }
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

/**
 * @param {{ skillId?: string | null; associatedSkillIds?: string[] | null }} course
 * @returns {string[]}
 */
function getCourseLinkedSkillIds(course) {
  return /** @type {string[]} */ (
    Array.from(new Set([course.skillId, ...(course.associatedSkillIds || [])].filter(Boolean)))
  );
}

/** @returns {Promise<import('../../types/kord.d.ts').Category[]>} */
export async function listCategories() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.from('categories').select('*').order('position');
    if (error) throw error;
    return data || [];
  }
  return (getDemoState().categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
}

/**
 * @param {{ id?: string; name: string; slug?: string; description?: string; position?: number }} payload
 */
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
        const prev = { name: existing.name, slug: existing.slug };
        existing.name = cleanName;
        existing.slug = cleanSlug;
        existing.description = String(description || '').trim();
        if (position) existing.position = Number(position);
        appendDemoAuditLog(draft, {
          action: 'category_updated',
          targetTable: 'categories',
          targetId: existing.id,
          beforeData: prev,
          afterData: { name: existing.name, slug: existing.slug },
        });
      } else {
        const newCatId = `cat-${cleanSlug}`;
        draft.categories.push({
          id: newCatId,
          slug: cleanSlug,
          name: cleanName,
          description: String(description || '').trim(),
          position: Number(position || draft.categories.length + 1),
        });
        appendDemoAuditLog(draft, {
          action: 'category_created',
          targetTable: 'categories',
          targetId: newCatId,
          beforeData: null,
          afterData: { name: cleanName, slug: cleanSlug },
        });
      }
      return draft;
    });
  });
}

/**
 * @param {{ includeDrafts?: boolean }} [opts]
 * @returns {Promise<import('../../types/kord.d.ts').Skill[]>}
 */
export async function listSkills({ includeDrafts = false } = {}) {
  if (!isDemoMode && supabase) {
    const [{ data: skillsData, error }, { data: coursesData }, { data: linksData }] = await Promise.all([
      supabase.from('skills').select('*').order('title'),
      supabase.from('courses').select('id, skill_id, slug, title, difficulty, estimated_duration_weeks, publication_status, thumbnail_url, author_name, version, position'),
      supabase.from('course_skills').select('course_id, skill_id'),
    ]);
    if (error) throw error;
    /** @type {Map<string, string[]>} */
    const extraLinksByCourse = new Map();
    (linksData || []).forEach((row) => {
      const existingLinks = extraLinksByCourse.get(row.course_id) || [];
      existingLinks.push(row.skill_id);
      extraLinksByCourse.set(row.course_id, existingLinks);
    });
    const courses = (coursesData || []).map((c) =>
      mapCourseSummary({
        ...c,
        course_skills: (extraLinksByCourse.get(c.id) || []).map((/** @type {string} */ sid) => ({ skill_id: sid })),
      })
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

/**
 * @param {string} slug
 * @param {{ includeDrafts?: boolean }} [opts]
 * @returns {Promise<import('../../types/kord.d.ts').Skill | null>}
 */
export async function getSkillBySlug(slug, { includeDrafts = false } = {}) {
  const allSkills = await listSkills({ includeDrafts });
  const skill = allSkills.find((s) => s.slug === slug);
  if (!skill) return null;

  if (!isDemoMode && supabase) {
    const [{ data: extraLinks }, { data: directCourses }, { data: quizzesData }, { data: challengesData }] = await Promise.all([
      supabase.from('course_skills').select('course_id').eq('skill_id', skill.id),
      supabase
        .from('courses')
        .select('*, course_skills!course_skills_course_id_fkey(skill_id), phases(*, lessons(*), activities(*))')
        .eq('skill_id', skill.id)
        .order('position'),
      supabase.from('quizzes').select('id, course_id, phase_id, quiz_type, title').eq('skill_id', skill.id),
      supabase.from('challenges').select('id, course_id, title').eq('skill_id', skill.id),
    ]);

    const extraCourseIds = (extraLinks || []).map((r) => r.course_id);
    /** @type {Record<string, any>[]} */
    let extraCourses = [];
    if (extraCourseIds.length > 0) {
      const { data: ec } = await supabase
        .from('courses')
        .select('*, course_skills!course_skills_course_id_fkey(skill_id), phases(*, lessons(*), activities(*))')
        .in('id', extraCourseIds)
        .order('position');
      extraCourses = ec || [];
    }

    /** @type {Map<string, Record<string, any>>} */
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

/**
 * @param {{ includeDrafts?: boolean }} [opts]
 * @returns {Promise<(import('../../types/kord.d.ts').Course & { associatedSkills?: import('../../types/kord.d.ts').Skill[] })[]>}
 */
export async function listAllCourses({ includeDrafts = true } = {}) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('courses')
      .select(
        '*, skills!courses_skill_id_fkey(id, slug, title, category, category_id, level), course_skills!course_skills_course_id_fkey(skill_id, is_primary, skills!course_skills_skill_id_fkey(id, slug, title, category, category_id, level)), phases(*, lessons(*), activities(*))'
      )
      .order('title');
    if (error) throw error;
    return (data || [])
      .map((c) => {
        const primarySkill = c.skills || null;
        /** @type {Map<string, import('../../types/kord.d.ts').Skill>} */
        const secondaryMap = new Map();
        if (primarySkill?.id) secondaryMap.set(primarySkill.id, primarySkill);
        (c.course_skills || []).forEach((/** @type {any} */ cs) => {
          if (cs?.skills?.id && !secondaryMap.has(cs.skills.id)) {
            secondaryMap.set(cs.skills.id, cs.skills);
          }
        });
        return {
          ...mapFullCourse(c, { includeDrafts }),
          categoryId: primarySkill?.category_id || null,
          categoryName: primarySkill?.category || '',
          skill: primarySkill,
          associatedSkills: Array.from(secondaryMap.values()),
        };
      })
      .filter((c) => includeDrafts || c.publicationStatus === 'published');
  }

  const state = getDemoState();
  const skillById = new Map((state.skills || []).map((s) => [s.id, s]));
  return (state.courses || [])
    .filter((c) => includeDrafts || c.publicationStatus === 'published')
    .map((c) => {
      const normalized = normalizeCourseForRead(c, { includeDrafts });
      const skill = skillById.get(c.skillId) || null;
      const associatedSkills = (normalized.associatedSkillIds || [])
        .map((/** @type {string} */ sid) => skillById.get(sid))
        .filter(
          /**
           * @param {import('../../types/kord.d.ts').Skill | undefined} s
           * @returns {s is import('../../types/kord.d.ts').Skill}
           */
          (s) => Boolean(s)
        );
      return {
        ...normalized,
        categoryId: skill?.categoryId || c.categoryId || null,
        categoryName: skill?.category || '',
        skill,
        associatedSkills,
      };
    });
}

/** @returns {Promise<import('../../types/kord.d.ts').Challenge[]>} */
export async function listAllChallenges() {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.from('challenges').select('*');
    if (error) throw error;
    return (data || []).map(mapChallenge);
  }
  return (getDemoState().challenges || []).slice();
}

/**
 * @param {string} slug
 * @param {{ includeDrafts?: boolean }} [opts]
 * @returns {Promise<(import('../../types/kord.d.ts').Course & { associatedSkills?: import('../../types/kord.d.ts').Skill[]; versions?: import('../../types/kord.d.ts').CourseVersion[] }) | null>}
 */
export async function getCourseBySlug(slug, { includeDrafts = false } = {}) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('courses')
      .select(
        '*, skills!courses_skill_id_fkey(*), course_skills!course_skills_course_id_fkey(skill_id, is_primary, skills!course_skills_skill_id_fkey(id, slug, title, level, category, category_id, publication_status)), course_versions(*), phases(*, lessons(*), activities(*))'
      )
      .eq('slug', slug)
      .single();
    if (error || !data) return null;
    if (!includeDrafts && data.publication_status !== 'published') return null;
    const course = mapFullCourse(data, { includeDrafts });
    const primarySkill = data.skills || null;
    /** @type {Map<string, import('../../types/kord.d.ts').Skill>} */
    const associatedSkillMap = new Map();
    if (primarySkill?.id) associatedSkillMap.set(primarySkill.id, primarySkill);
    (data.course_skills || []).forEach((/** @type {any} */ cs) => {
      const sk = cs?.skills;
      if (sk?.id && (includeDrafts || (sk.publication_status || 'published') === 'published')) {
        if (!associatedSkillMap.has(sk.id)) associatedSkillMap.set(sk.id, sk);
      }
    });
    const [{ data: assessments }, { data: challenges }] = await Promise.all([
      supabase
        .from('quizzes')
        .select('id, course_id, phase_id, lesson_id, quiz_type, title, description, pass_percent, time_limit_minutes, max_attempts, questions(id)')
        .eq('course_id', course.id),
      supabase.from('challenges').select('*').eq('course_id', course.id),
    ]);
    return {
      ...course,
      categoryId: primarySkill?.category_id || null,
      categoryName: primarySkill?.category || '',
      skill: primarySkill,
      associatedSkills: Array.from(associatedSkillMap.values()),
      versions: (data.course_versions || [])
        .slice()
        .sort((/** @type {any} */ a, /** @type {any} */ b) => Number(b.version_number || 0) - Number(a.version_number || 0))
        .map((/** @type {any} */ v) => ({
          id: v.id,
          courseId: v.course_id,
          versionNumber: v.version_number,
          changeNotes: v.change_notes,
          snapshotType: v.snapshot_type || 'manual',
          snapshot: v.snapshot || {},
          snapshotData: v.snapshot_data || null,
          sourceImportId: v.source_import_id || null,
          createdAt: v.created_at,
        })),
      assessments: (assessments || []).map((/** @type {any} */ a) => ({
        id: a.id,
        skillId: a.skill_id || course.skillId,
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
    .map((/** @type {string} */ sid) => (state.skills || []).find((s) => s.id === sid))
    .filter(
      /**
       * @param {import('../../types/kord.d.ts').Skill | undefined} s
       * @returns {s is import('../../types/kord.d.ts').Skill}
       */
      (s) => Boolean(s)
    );
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

/**
 * @param {string} courseId
 * @param {{ includeDrafts?: boolean }} [opts]
 */
export async function getCourseById(courseId, { includeDrafts = false } = {}) {
  if (!isDemoMode && supabase) {
    const { data } = await supabase.from('courses').select('slug').eq('id', courseId).single();
    if (!data) return null;
    return getCourseBySlug(data.slug, { includeDrafts });
  }
  const course = (getDemoState().courses || []).find((c) => c.id === courseId);
  return course ? getCourseBySlug(course.slug, { includeDrafts }) : null;
}

/** @param {string} challengeId */
export async function getChallengeById(challengeId) {
  if (!isDemoMode && supabase) {
    const { data, error } = await supabase
      .from('challenges')
      .select('*, skills!challenges_skill_id_fkey(id, slug, title), courses!challenges_course_id_fkey(id, slug, title)')
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

/**
 * @param {Omit<Partial<import('../../types/kord.d.ts').Skill>, 'outcomes'> & { outcomes?: string[] | string }} payload
 */
export async function adminUpsertSkill(payload) {
  const cleanTitle = String(payload.title || '').trim();
  const cleanSlug = payload.slug ? slugify(payload.slug) : slugify(cleanTitle);
  const key = buildIdempotencyKey('admin-skill', payload.id || cleanSlug, cleanTitle, payload.publicationStatus || '');

  const parsedOutcomes = Array.isArray(payload.outcomes)
    ? payload.outcomes.map((/** @type {unknown} */ x) => String(x || '').trim()).filter(Boolean)
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

    /** @type {import('../../types/kord.d.ts').Skill | null} */
    let savedSkill = null;
    updateDemoState((draft) => {
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
        const prev = { title: existing.title, publicationStatus: existing.publicationStatus };
        Object.assign(existing, enriched);
        appendDemoAuditLog(draft, {
          action: 'skill_updated',
          targetTable: 'skills',
          targetId: existing.id,
          beforeData: prev,
          afterData: { title: existing.title, publicationStatus: existing.publicationStatus },
        });
        savedSkill = existing;
        return draft;
      }

      const newSkillId = `skill-${cleanSlug}-${Date.now().toString(36).slice(-4)}`;
      const createdSkill = {
        id: newSkillId,
        ...enriched,
      };
      draft.skills.push(createdSkill);
      appendDemoAuditLog(draft, {
        action: 'skill_created',
        targetTable: 'skills',
        targetId: newSkillId,
        beforeData: null,
        afterData: { title: enriched.title, publicationStatus: enriched.publicationStatus },
      });
      savedSkill = createdSkill;
      return draft;
    });
    return savedSkill;
  });
}

/**
 * @param {Omit<Partial<import('../../types/kord.d.ts').Course>, 'outcomes' | 'prerequisites'> & { outcomes?: string[] | string; prerequisites?: string[] | string }} payload
 */
export async function adminUpsertCourse(payload) {
  const cleanTitle = String(payload.title || '').trim();
  const cleanSlug = payload.slug ? slugify(payload.slug) : slugify(cleanTitle);
  const primarySkillId = payload.skillId || '';
  const linkedSkills = /** @type {string[]} */ (
    Array.from(new Set([primarySkillId, ...(payload.associatedSkillIds || [])].filter(Boolean)))
  );
  const key = buildIdempotencyKey(
    'admin-course',
    payload.id || cleanSlug,
    primarySkillId,
    cleanTitle,
    linkedSkills.join(','),
    payload.publicationStatus || ''
  );

  return runIdempotent(key, async () => {
    const parsedOutcomes = Array.isArray(payload.outcomes)
      ? payload.outcomes.map((/** @type {unknown} */ x) => String(x || '').trim()).filter(Boolean)
      : String(payload.outcomes || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
    const parsedPrereqs = Array.isArray(payload.prerequisites)
      ? payload.prerequisites.map((/** @type {unknown} */ x) => String(x || '').trim()).filter(Boolean)
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

    /** @type {import('../../types/kord.d.ts').Course | null} */
    let savedCourse = null;
    updateDemoState((draft) => {
      draft.courses = draft.courses || [];
      draft.courseVersions = draft.courseVersions || [];
      const existing = payload.id
        ? draft.courses.find((c) => c.id === payload.id)
        : draft.courses.find((c) => c.slug === cleanSlug);

      const siblingCount = draft.courses.filter((c) => c.skillId === primarySkillId).length;
      const fields = {
        skillId: primarySkillId,
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
        const prev = { title: existing.title, publicationStatus: existing.publicationStatus };
        Object.assign(existing, fields);
        appendDemoAuditLog(draft, {
          action: 'course_updated',
          targetTable: 'courses',
          targetId: existing.id,
          beforeData: prev,
          afterData: { title: existing.title, publicationStatus: existing.publicationStatus },
        });
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
      appendDemoAuditLog(draft, {
        action: 'course_created',
        targetTable: 'courses',
        targetId: newCourseId,
        beforeData: null,
        afterData: { title: newCourse.title, publicationStatus: newCourse.publicationStatus },
      });
      savedCourse = newCourse;
      return draft;
    });
    return savedCourse;
  });
}

/**
 * @param {string} courseId
 * @param {string} status
 */
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
      const prevStatus = course.publicationStatus;
      course.publicationStatus = status;
      course.updatedAt = nowIso;
      appendDemoAuditLog(draft, {
        action: status === 'published' ? 'course_published' : 'course_status_changed',
        targetTable: 'courses',
        targetId: course.id,
        beforeData: { publicationStatus: prevStatus },
        afterData: { publicationStatus: status },
      });
      return draft;
    });
  });
}

/**
 * @param {string} courseId
 * @param {string} [changeNotes]
 */
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
    /** @type {import('../../types/kord.d.ts').CourseVersion | null} */
    let createdVersion = null;
    updateDemoState((draft) => {
      draft.courseVersions = draft.courseVersions || [];
      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course) throw new Error('Course not found');
      const nextVersion = Number(course.version || 1) + 1;
      const snapshotData = buildCourseCurriculumSnapshot(course);
      course.version = nextVersion;
      course.updatedAt = nowIso;

      createdVersion = {
        id: `cv-${courseId}-v${nextVersion}`,
        courseId,
        versionNumber: nextVersion,
        changeNotes: cleanNotes,
        snapshotType: 'manual',
        snapshot: {
          title: course.title,
          difficulty: course.difficulty,
          phaseCount: (course.phases || []).length,
          lessonCount: (course.phases || []).reduce((sum, p) => sum + (p.lessons || []).length, 0),
        },
        snapshotData,
        createdAt: nowIso,
      };
      draft.courseVersions.unshift(createdVersion);
      appendDemoAuditLog(draft, {
        action: 'course_snapshot_created',
        targetTable: 'course_versions',
        targetId: createdVersion.id,
        beforeData: null,
        afterData: {
          courseId,
          versionNumber: nextVersion,
          snapshotType: 'manual',
          changeNotes: cleanNotes,
        },
      });
      return draft;
    });
    return createdVersion;
  });
}

/**
 * @param {Omit<Partial<import('../../types/kord.d.ts').Phase>, 'objectives'> & { courseId: string; title: string; objectives?: string[] | string }} payload
 */
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

    /** @type {import('../../types/kord.d.ts').Phase | null} */
    let savedPhase = null;
    updateDemoState((draft) => {
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
        appendDemoAuditLog(draft, {
          action: 'phase_updated',
          targetTable: 'phases',
          targetId: existing.id,
          beforeData: null,
          afterData: { courseId, title: existing.title, publicationStatus },
        });
        savedPhase = existing;
      } else {
        const newPhaseId = `ph-${Date.now()}`;
        const createdPhase = {
          id: newPhaseId,
          position: Number(position || course.phases.length + 1),
          title: String(title || '').trim(),
          summary: String(summary || '').trim(),
          objectives: cleanObjectives,
          difficulty,
          estHours: Number(estHours || 3),
          publicationStatus,
          activities: [],
          lessons: [],
        };
        course.phases.push(createdPhase);
        appendDemoAuditLog(draft, {
          action: 'phase_created',
          targetTable: 'phases',
          targetId: newPhaseId,
          beforeData: null,
          afterData: { courseId, title: String(title || '').trim(), publicationStatus },
        });
        savedPhase = createdPhase;
      }
      course.updatedAt = new Date().toISOString();
      return draft;
    });
    return savedPhase;
  });
}

/**
 * @param {string} courseId
 * @param {string[]} orderedPhaseIds
 */
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
        const nextPos = posMap.get(p.id);
        if (nextPos !== undefined) p.position = nextPos;
      });
      course.phases = (course.phases || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      course.updatedAt = new Date().toISOString();
      return draft;
    });
  });
}

/**
 * @param {Partial<import('../../types/kord.d.ts').PhaseActivity> & { courseId: string; phaseId: string; title: string }} payload
 */
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
      if (course) {
        course.updatedAt = new Date().toISOString();
      }
      return draft;
    });
  });
}

/**
 * @param {Omit<Partial<import('../../types/kord.d.ts').Lesson>, 'objectives' | 'takeaways' | 'videos'> & {
 *   courseId: string;
 *   phaseId: string;
 *   title: string;
 *   objectives?: string[] | string;
 *   takeaways?: string[] | string;
 *   videos?: Array<import('../../types/kord.d.ts').VideoEntry & { urlUpdated?: boolean }>;
 * }} payload
 */
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
      if (!normalized.valid || !normalized.video) throw new Error(normalized.error || 'Invalid video URL');
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

    /** @type {import('../../types/kord.d.ts').Lesson | null} */
    let savedLesson = null;
    updateDemoState((draft) => {
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
        appendDemoAuditLog(draft, {
          action: 'lesson_updated',
          targetTable: 'lessons',
          targetId: existing.id,
          beforeData: null,
          afterData: { courseId, phaseId, title: lessonData.title, publicationStatus },
        });
        savedLesson = existing;
      } else {
        const newLessonId = `les-${Date.now()}`;
        const createdLesson = {
          id: newLessonId,
          position: Number(position || phase.lessons.length + 1),
          ...lessonData,
        };
        phase.lessons.push(createdLesson);
        appendDemoAuditLog(draft, {
          action: 'lesson_created',
          targetTable: 'lessons',
          targetId: newLessonId,
          beforeData: null,
          afterData: { courseId, phaseId, title: lessonData.title, publicationStatus },
        });
        savedLesson = createdLesson;
      }
      course.updatedAt = new Date().toISOString();
      return draft;
    });
    return savedLesson;
  });
}

/**
 * @param {string} courseId
 * @param {string} phaseId
 */
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
      const hasLessonProgress = (draft.lessonProgress || []).some((lp) =>
        lp.lessonId ? lessonIds.has(lp.lessonId) : false
      );
      const actIds = new Set((phase.activities || []).map((a) => a.id));
      const hasActivityProgress = (draft.activityProgress || []).some((ap) => actIds.has(ap.activityId));
      if (hasLessonProgress || hasActivityProgress) {
        throw new Error('Cannot delete a module with recorded learner progress. Unpublish the module instead.');
      }

      if (course) {
        course.phases = (course.phases || [])
          .filter((p) => p.id !== phaseId)
          .map((p, idx) => ({ ...p, position: idx + 1 }));
        course.updatedAt = new Date().toISOString();
      }
      return draft;
    });
  });
}

/**
 * @param {string} courseId
 * @param {string} phaseId
 * @param {string[]} orderedLessonIds
 */
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
        const nextPos = posMap.get(l.id);
        if (nextPos !== undefined) l.position = nextPos;
      });
      phase.lessons = (phase.lessons || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      if (course) {
        course.updatedAt = new Date().toISOString();
      }
      return draft;
    });
  });
}

/**
 * @param {string} courseId
 * @param {string} phaseId
 * @param {string} lessonId
 */
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
        const targetLesson = (phase.lessons || []).find((l) => l.id === lessonId);
        phase.lessons = (phase.lessons || []).filter((l) => l.id !== lessonId);
        if (targetLesson) {
          appendDemoAuditLog(draft, {
            action: 'lesson_deleted',
            targetTable: 'lessons',
            targetId: lessonId,
            beforeData: { courseId, phaseId, title: targetLesson.title },
            afterData: null,
          });
        }
      }
      return draft;
    });
  });
}

/**
 * @param {Omit<Partial<import('../../types/kord.d.ts').Challenge>, 'expectedDeliverables'> & { skillId: string; expectedDeliverables?: string[] | string }} payload
 */
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
    ? payload.expectedDeliverables.map((/** @type {unknown} */ x) => String(x || '').trim()).filter(Boolean)
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

    /** @type {import('../../types/kord.d.ts').Challenge | null} */
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
        appendDemoAuditLog(draft, {
          action: 'challenge_updated',
          targetTable: 'challenges',
          targetId: existing.id,
          beforeData: null,
          afterData: { title: fields.title, courseId: fields.courseId },
        });
      } else {
        /** @type {import('../../types/kord.d.ts').Challenge} */
        const created = {
          id: `ch-${payload.courseId || Date.now()}`,
          ...fields,
        };
        savedChallenge = created;
        draft.challenges.push(created);
        appendDemoAuditLog(draft, {
          action: 'challenge_created',
          targetTable: 'challenges',
          targetId: created.id,
          beforeData: null,
          afterData: { title: fields.title, courseId: fields.courseId },
        });
      }
      return draft;
    });
    return savedChallenge;
  });
}

/**
 * Maps a Supabase `content_imports` row into a typed ContentImportRecord.
 *
 * @param {Record<string, any>} row
 * @returns {import('../../types/kord.d.ts').ContentImportRecord}
 */
function mapContentImportRecord(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    actorId: row.actor_id || null,
    actorEmail: row.actor_email || null,
    operationType: row.operation_type || 'import',
    packageVersion: row.package_version || CONTENT_PACKAGE_SCHEMA_VERSION,
    status: row.status,
    processedCount: Number(row.processed_count || 0),
    createdCount: Number(row.created_count || 0),
    updatedCount: Number(row.updated_count || 0),
    unchangedCount: Number(row.unchanged_count || 0),
    rejectedCount: Number(row.rejected_count || 0),
    snapshotVersionId: row.snapshot_version_id || null,
    idempotencyKey: row.idempotency_key || null,
    changeNotes: row.change_notes || '',
    errorSummary: row.error_summary || null,
    details: row.details || {},
    createdAt: row.created_at,
  };
}

/**
 * Exports the full curriculum (modules, lessons, resources) for a course as a
 * versioned JSON package without learner PII or assessment keys.
 *
 * @param {string} courseId
 * @returns {Promise<{ packageData: import('../../types/kord.d.ts').ContentPackage; jsonString: string; filename: string }>}
 */
export async function adminExportCourseContent(courseId) {
  if (isDemoMode || !supabase) {
    requireDemoActiveAdmin(getDemoState());
  }
  const course = await getCourseById(courseId, { includeDrafts: true });
  if (!course) {
    throw new Error('Course not found.');
  }
  const packageData = buildCourseExportPackage(course);
  const jsonString = JSON.stringify(packageData, null, 2);
  const safeSlug = slugify(course.slug || course.title || course.id);
  const filename = `course-${safeSlug}-v${Number(course.version || 1)}.json`;
  return { packageData, jsonString, filename };
}

/**
 * Records a rejected or failed bulk import attempt cleanly for audit history.
 *
 * @param {{
 *   courseId: string;
 *   status: 'rejected' | 'failed';
 *   packageVersion?: string;
 *   processedCount?: number;
 *   rejectedCount?: number;
 *   errorSummary: string;
 *   details?: Record<string, unknown>;
 * }} params
 */
async function recordImportFailureEvent({
  courseId,
  status,
  packageVersion = CONTENT_PACKAGE_SCHEMA_VERSION,
  processedCount = 0,
  rejectedCount = 0,
  errorSummary,
  details = {},
}) {
  const cleanSummary = String(errorSummary || 'Import validation failed').slice(0, 1000);
  if (!isDemoMode && supabase) {
    try {
      await supabase.rpc('admin_log_content_import_event', {
        p_course_id: courseId,
        p_status: status,
        p_package_version: packageVersion,
        p_processed_count: processedCount,
        p_rejected_count: rejectedCount,
        p_error_summary: cleanSummary,
        p_details: details,
      });
    } catch {
      // Never mask the primary import error if event logging also fails
    }
    return;
  }

  try {
    updateDemoState((draft) => {
      const admin = requireDemoActiveAdmin(draft);
      draft.contentImports = draft.contentImports || [];
      const importId = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      draft.contentImports.unshift({
        id: importId,
        courseId,
        actorId: admin.id,
        actorEmail: admin.email || null,
        operationType: 'import',
        packageVersion,
        status,
        processedCount: Math.max(0, Number(processedCount || 0)),
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        rejectedCount: Math.max(0, Number(rejectedCount || 0)),
        snapshotVersionId: null,
        idempotencyKey: null,
        changeNotes: '',
        errorSummary: cleanSummary,
        details,
        createdAt: new Date().toISOString(),
      });
      appendDemoAuditLog(draft, {
        actorId: admin.id,
        action: status === 'rejected' ? 'bulk_content_import_rejected' : 'bulk_content_import_failed',
        targetTable: 'courses',
        targetId: courseId,
        beforeData: null,
        afterData: { importId, status, rejectedCount, errorSummary: cleanSummary },
      });
      return draft;
    });
  } catch {
    // Keep failure path non-blocking
  }
}

/**
 * Performs a read-only dry-run validation & diff preview of a JSON content package
 * against the target course. Writes nothing to curriculum tables.
 *
 * @param {{ courseId: string; rawJsonText: string; logRejection?: boolean }} params
 * @returns {Promise<{ parsed: boolean; parseErrors: import('../../types/kord.d.ts').DryRunValidationIssue[]; plan: import('../../types/kord.d.ts').DryRunImportPlan | null }>}
 */
export async function adminPreviewCourseContentImport({ courseId, rawJsonText, logRejection = false }) {
  if (isDemoMode || !supabase) {
    requireDemoActiveAdmin(getDemoState());
  }
  const course = await getCourseById(courseId, { includeDrafts: true });
  if (!course) {
    throw new Error('Target course not found.');
  }

  const parsedResult = parseContentPackageJson(rawJsonText);
  if (!parsedResult.valid) {
    if (logRejection) {
      await recordImportFailureEvent({
        courseId: course.id,
        status: 'rejected',
        processedCount: 0,
        rejectedCount: parsedResult.errors.length,
        errorSummary: parsedResult.errors.map((e) => e.message).join(' | '),
        details: { parseErrors: parsedResult.errors },
      });
    }
    return {
      parsed: false,
      parseErrors: parsedResult.errors,
      plan: null,
    };
  }

  const plan = buildDryRunImportPlan({
    packageData: parsedResult.packageData,
    targetCourse: course,
  });

  if (logRejection && !plan.valid) {
    await recordImportFailureEvent({
      courseId: course.id,
      status: 'rejected',
      packageVersion: plan.schemaVersion,
      processedCount: plan.totalProcessed,
      rejectedCount: plan.counts.rejected + plan.packageErrors.length,
      errorSummary:
        plan.packageErrors[0]?.message ||
        plan.lessons.find((l) => l.errors.length > 0)?.errors[0]?.message ||
        'Package rejected during dry-run validation.',
      details: {
        counts: plan.counts,
        packageErrors: plan.packageErrors,
      },
    });
  }

  return {
    parsed: true,
    parseErrors: [],
    plan,
  };
}

/**
 * Atomically commits validated New & Updated lessons from a bulk JSON import package.
 * Automatically captures a pre_import curriculum snapshot before applying changes,
 * preserves existing lesson IDs, never auto-publishes new/draft lessons, and never
 * touches learner progress, enrollments, completions, or quiz attempts.
 *
 * @param {{ courseId: string; rawJsonText: string; changeNotes?: string; idempotencyKey?: string }} params
 * @returns {Promise<import('../../types/kord.d.ts').BulkImportCommitResult>}
 */
export async function adminCommitCourseContentImport({
  courseId,
  rawJsonText,
  changeNotes = '',
  idempotencyKey,
}) {
  if (isDemoMode || !supabase) {
    requireDemoActiveAdmin(getDemoState());
  }

  const cleanNotes = String(changeNotes || '').trim();
  if (cleanNotes.length > 2000) {
    throw new Error('Change notes cannot exceed 2,000 characters.');
  }

  const preview = await adminPreviewCourseContentImport({
    courseId,
    rawJsonText,
    logRejection: true,
  });

  if (!preview.parsed || !preview.plan) {
    const firstErr = preview.parseErrors[0]?.message || 'Malformed JSON content package.';
    throw new Error(firstErr);
  }

  const plan = preview.plan;
  if (!plan.valid) {
    const firstErr =
      plan.packageErrors[0]?.message ||
      plan.lessons.find((l) => l.errors.length > 0)?.errors[0]?.message ||
      'Import package failed validation and was rejected.';
    throw new Error(firstErr);
  }

  const actionableResults = plan.lessons.filter(
    (l) => (l.classification === 'new' || l.classification === 'updated') && l.normalizedLesson !== null
  );
  if (actionableResults.length === 0) {
    throw new Error('No new or modified lessons detected in this package.');
  }

  const resolvedIdempotencyKey =
    String(idempotencyKey || '').trim() ||
    buildIdempotencyKey('bulk-import', courseId, Date.now(), Math.random().toString(36).slice(2, 8));

  const payloadLessons = actionableResults.map((item) => {
    const les = /** @type {import('../../types/kord.d.ts').Lesson} */ (item.normalizedLesson);
    return {
      ...(item.classification === 'updated' && item.lessonId ? { id: item.lessonId } : { isNew: true }),
      phaseId: item.phaseId,
      position: les.position,
      title: les.title,
      introduction: les.introduction || '',
      objectives: les.objectives || [],
      estMinutes: Number(les.estMinutes || 25),
      blocks: les.blocks || [],
      videos: les.videos || [],
      summary: les.summary || '',
      takeaways: les.takeaways || [],
      furtherReading: les.furtherReading || [],
      completionCriteria: les.completionCriteria || '',
      isRequired: les.isRequired !== false,
    };
  });

  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('admin_bulk_import_course_content', {
      p_course_id: courseId,
      p_package_version: plan.schemaVersion,
      p_lessons: payloadLessons,
      p_change_notes: cleanNotes,
      p_idempotency_key: resolvedIdempotencyKey,
      p_unchanged_count: plan.counts.unchanged,
      p_rejected_count: plan.counts.rejected,
    });
    if (error) {
      await recordImportFailureEvent({
        courseId,
        status: 'failed',
        packageVersion: plan.schemaVersion,
        processedCount: plan.totalProcessed,
        rejectedCount: plan.counts.rejected,
        errorSummary: error.message || 'Database rejected bulk import commit.',
        details: { code: error.code || null },
      });
      throw new Error(error.message || 'Bulk import failed in database.');
    }
    return /** @type {import('../../types/kord.d.ts').BulkImportCommitResult} */ (data);
  }

  try {
    /** @type {import('../../types/kord.d.ts').BulkImportCommitResult | null} */
    let commitResult = null;
    const nowIso = new Date().toISOString();

    updateDemoState((draft) => {
      const admin = requireDemoActiveAdmin(draft);
      draft.courseVersions = draft.courseVersions || [];
      draft.contentImports = draft.contentImports || [];

      const existingReplay = draft.contentImports.find(
        (imp) =>
          imp.courseId === courseId &&
          imp.idempotencyKey === resolvedIdempotencyKey &&
          imp.status === 'committed'
      );
      if (existingReplay) {
        const ver = draft.courseVersions.find((v) => v.id === existingReplay.snapshotVersionId);
        commitResult = {
          importId: existingReplay.id,
          snapshotVersionId: existingReplay.snapshotVersionId,
          snapshotVersionNumber: ver?.versionNumber || null,
          processedCount: existingReplay.processedCount,
          createdCount: existingReplay.createdCount,
          updatedCount: existingReplay.updatedCount,
          unchangedCount: existingReplay.unchangedCount,
          rejectedCount: existingReplay.rejectedCount,
          idempotentReplay: true,
        };
        return draft;
      }

      const course = (draft.courses || []).find((c) => c.id === courseId);
      if (!course) {
        throw new Error('Target course not found.');
      }

      // Atomic Step 1: Capture pre_import full curriculum snapshot before mutating lessons
      const preSnapshotData = buildCourseCurriculumSnapshot(course);
      const nextVersionNum = Number(course.version || 1) + 1;
      const snapshotVersionId = `cv-${courseId}-v${nextVersionNum}-${Math.random().toString(36).slice(2, 6)}`;
      const importId = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      course.version = nextVersionNum;
      course.updatedAt = nowIso;

      draft.courseVersions.unshift({
        id: snapshotVersionId,
        courseId,
        versionNumber: nextVersionNum,
        changeNotes: cleanNotes
          ? `Pre-import snapshot: ${cleanNotes}`
          : 'Pre-import automatic backup',
        snapshotType: 'pre_import',
        snapshot: {
          title: course.title,
          publicationStatus: course.publicationStatus,
          difficulty: course.difficulty,
          phaseCount: (course.phases || []).length,
          lessonCount: (course.phases || []).reduce((sum, p) => sum + (p.lessons || []).length, 0),
        },
        snapshotData: preSnapshotData,
        sourceImportId: importId,
        createdAt: nowIso,
      });

      appendDemoAuditLog(draft, {
        actorId: admin.id,
        action: 'course_snapshot_created',
        targetTable: 'course_versions',
        targetId: snapshotVersionId,
        beforeData: null,
        afterData: {
          courseId,
          versionNumber: nextVersionNum,
          snapshotType: 'pre_import',
        },
      });

      // Atomic Step 2: Apply updates in-place (preserving IDs & published status) and create new lessons as draft
      let createdCount = 0;
      let updatedCount = 0;

      for (const item of actionableResults) {
        const les = /** @type {import('../../types/kord.d.ts').Lesson} */ (item.normalizedLesson);
        const phase = (course.phases || []).find((p) => p.id === item.phaseId);
        if (!phase) {
          throw new Error(`Module "${item.phaseId}" not found in course "${course.title}".`);
        }
        phase.lessons = phase.lessons || [];

        if (item.classification === 'updated' && item.lessonId) {
          const existing = phase.lessons.find((l) => l.id === item.lessonId);
          if (!existing) {
            throw new Error(`Lesson "${item.lessonId}" not found in module "${phase.title}".`);
          }
          const preservedStatus =
            (existing.publicationStatus || 'published') === 'published' ? 'published' : 'draft';
          Object.assign(existing, {
            position: Number(les.position || existing.position || 1),
            title: les.title,
            introduction: les.introduction || '',
            objectives: structuredClone(les.objectives || []),
            estMinutes: Number(les.estMinutes || 25),
            blocks: structuredClone(les.blocks || []),
            videos: structuredClone(les.videos || []),
            summary: les.summary || '',
            takeaways: structuredClone(les.takeaways || []),
            furtherReading: structuredClone(les.furtherReading || []),
            completionCriteria: les.completionCriteria || '',
            publicationStatus: preservedStatus,
            isRequired: les.isRequired !== false,
          });
          updatedCount += 1;
        } else {
          const newId = `les-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          phase.lessons.push({
            id: newId,
            phaseId: phase.id,
            position: Number(les.position || phase.lessons.length + 1),
            title: les.title,
            introduction: les.introduction || '',
            objectives: structuredClone(les.objectives || []),
            estMinutes: Number(les.estMinutes || 25),
            blocks: structuredClone(les.blocks || []),
            videos: structuredClone(les.videos || []),
            summary: les.summary || '',
            takeaways: structuredClone(les.takeaways || []),
            furtherReading: structuredClone(les.furtherReading || []),
            completionCriteria: les.completionCriteria || '',
            publicationStatus: 'draft',
            isRequired: les.isRequired !== false,
          });
          createdCount += 1;
        }

        phase.lessons.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      }

      const processedCount = createdCount + updatedCount + plan.counts.unchanged + plan.counts.rejected;
      draft.contentImports.unshift({
        id: importId,
        courseId,
        actorId: admin.id,
        actorEmail: admin.email || null,
        operationType: 'import',
        packageVersion: plan.schemaVersion,
        status: 'committed',
        processedCount,
        createdCount,
        updatedCount,
        unchangedCount: plan.counts.unchanged,
        rejectedCount: plan.counts.rejected,
        snapshotVersionId,
        idempotencyKey: resolvedIdempotencyKey,
        changeNotes: cleanNotes,
        errorSummary: null,
        details: { touchedLessons: actionableResults.length },
        createdAt: nowIso,
      });

      appendDemoAuditLog(draft, {
        actorId: admin.id,
        action: 'bulk_content_import_committed',
        targetTable: 'courses',
        targetId: courseId,
        beforeData: null,
        afterData: {
          importId,
          snapshotVersionId,
          createdCount,
          updatedCount,
          unchangedCount: plan.counts.unchanged,
          changeNotes: cleanNotes,
        },
      });

      commitResult = {
        importId,
        snapshotVersionId,
        snapshotVersionNumber: nextVersionNum,
        processedCount,
        createdCount,
        updatedCount,
        unchangedCount: plan.counts.unchanged,
        rejectedCount: plan.counts.rejected,
        idempotentReplay: false,
      };
      return draft;
    });

    if (!commitResult) {
      throw new Error('Bulk import failed unexpectedly.');
    }
    return commitResult;
  } catch (err) {
    await recordImportFailureEvent({
      courseId,
      status: 'failed',
      packageVersion: plan.schemaVersion,
      processedCount: plan.totalProcessed,
      rejectedCount: plan.counts.rejected,
      errorSummary: err instanceof Error ? err.message : 'Bulk import transaction aborted.',
    });
    throw err;
  }
}

/**
 * Lists recent content import and snapshot recovery audit records.
 *
 * @param {{ courseId?: string | null; limit?: number }} [opts]
 * @returns {Promise<import('../../types/kord.d.ts').ContentImportRecord[]>}
 */
export async function adminListCourseImportHistory({ courseId = null, limit = 30 } = {}) {
  if (!isDemoMode && supabase) {
    let query = supabase
      .from('content_imports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (courseId) {
      query = query.eq('course_id', courseId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapContentImportRecord);
  }

  const state = getDemoState();
  requireDemoActiveAdmin(state);
  return (state.contentImports || [])
    .filter((rec) => !courseId || rec.courseId === courseId)
    .slice(0, limit);
}

/**
 * Restores a course's phases and lessons from a saved curriculum snapshot,
 * automatically saving a pre_restore safety backup first while preserving all
 * learner progress, enrollments, completions, and quiz attempts.
 *
 * @param {{ courseId: string; versionId: string; restoreNotes?: string }} params
 * @returns {Promise<import('../../types/kord.d.ts').RestoreSnapshotResult>}
 */
export async function adminRestoreCourseSnapshot({ courseId, versionId, restoreNotes = '' }) {
  const cleanNotes = String(restoreNotes || '').trim();
  if (cleanNotes.length > 2000) {
    throw new Error('Restore notes cannot exceed 2,000 characters.');
  }

  if (!isDemoMode && supabase) {
    const { data, error } = await supabase.rpc('admin_restore_course_snapshot', {
      p_course_id: courseId,
      p_version_id: versionId,
      p_restore_notes: cleanNotes,
    });
    if (error) throw new Error(error.message || 'Unable to restore course snapshot.');
    return /** @type {import('../../types/kord.d.ts').RestoreSnapshotResult} */ (data);
  }

  /** @type {import('../../types/kord.d.ts').RestoreSnapshotResult | null} */
  let result = null;
  const nowIso = new Date().toISOString();

  updateDemoState((draft) => {
    const admin = requireDemoActiveAdmin(draft);
    draft.courseVersions = draft.courseVersions || [];
    draft.contentImports = draft.contentImports || [];

    const course = (draft.courses || []).find((c) => c.id === courseId);
    if (!course) throw new Error('Course not found.');

    const targetVersion = draft.courseVersions.find(
      (v) => v.id === versionId && v.courseId === courseId
    );
    if (!targetVersion) throw new Error('Course version snapshot not found.');

    const snap = targetVersion.snapshotData;
    if (!snap || typeof snap !== 'object' || !Array.isArray(snap.phases)) {
      throw new Error('Selected course version does not contain a restorable full curriculum snapshot.');
    }

    // Step 1: Capture pre_restore safety snapshot BEFORE reverting
    const safetySnapshot = buildCourseCurriculumSnapshot(course);
    const safetyVersionNumber = Number(course.version || 1) + 1;
    const safetyVersionId = `cv-${courseId}-v${safetyVersionNumber}-${Math.random().toString(36).slice(2, 6)}`;
    const restoreImportId = `imp-restore-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    course.version = safetyVersionNumber;
    course.updatedAt = nowIso;

    draft.courseVersions.unshift({
      id: safetyVersionId,
      courseId,
      versionNumber: safetyVersionNumber,
      changeNotes: `Pre-restore automatic backup before reverting to v${targetVersion.versionNumber}`,
      snapshotType: 'pre_restore',
      snapshot: {
        title: course.title,
        publicationStatus: course.publicationStatus,
        difficulty: course.difficulty,
        phaseCount: (course.phases || []).length,
        lessonCount: (course.phases || []).reduce((sum, p) => sum + (p.lessons || []).length, 0),
      },
      snapshotData: safetySnapshot,
      sourceImportId: restoreImportId,
      createdAt: nowIso,
    });

    appendDemoAuditLog(draft, {
      actorId: admin.id,
      action: 'course_snapshot_created',
      targetTable: 'course_versions',
      targetId: safetyVersionId,
      beforeData: null,
      afterData: {
        courseId,
        versionNumber: safetyVersionNumber,
        snapshotType: 'pre_restore',
      },
    });

    // Step 2: Restore phases and lessons from snapshot while retaining existing phase activities
    const currentPhases = course.phases || [];
    const existingActivitiesByPhaseId = new Map(
      currentPhases.map((p) => [p.id, structuredClone(p.activities || [])])
    );
    /** @type {Set<string>} */
    const restoredLessonIds = new Set();
    let restoredLessonsCount = 0;

    /** @type {import('../../types/kord.d.ts').Phase[]} */
    const restoredPhases = snap.phases.map((sp) => {
      /** @type {import('../../types/kord.d.ts').Lesson[]} */
      const lessons = (sp.lessons || []).map((sl, lIdx) => {
        const lid = String(sl.id || `les-restored-${lIdx + 1}`);
        restoredLessonIds.add(lid);
        restoredLessonsCount += 1;
        return {
          id: lid,
          phaseId: sp.id,
          position: Number(sl.position || lIdx + 1),
          title: sl.title,
          introduction: sl.introduction || '',
          objectives: structuredClone(sl.objectives || []),
          estMinutes: Number(sl.estMinutes || 25),
          blocks: structuredClone(sl.blocks || []),
          videos: structuredClone(sl.videos || []),
          summary: sl.summary || '',
          takeaways: structuredClone(sl.takeaways || []),
          furtherReading: structuredClone(sl.furtherReading || []),
          completionCriteria: sl.completionCriteria || '',
          publicationStatus: sl.publicationStatus || 'draft',
          isRequired: sl.isRequired !== false,
        };
      });

      lessons.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
      return {
        id: sp.id,
        position: Number(sp.position || 1),
        title: sp.title,
        summary: sp.summary || '',
        objectives: structuredClone(sp.objectives || []),
        difficulty: sp.difficulty || 'Beginner',
        estHours: Number(sp.estHours || 2),
        publicationStatus: sp.publicationStatus || 'published',
        activities: existingActivitiesByPhaseId.get(sp.id) || [],
        lessons,
      };
    });

    // Step 3: Preserve any post-snapshot lessons referenced by learner progress/quizzes/activities as archived
    let archivedExtraLessonsCount = 0;
    let deletedExtraLessonsCount = 0;

    for (const origPhase of currentPhases) {
      const targetPhase = restoredPhases.find((rp) => rp.id === origPhase.id) || null;
      for (const extra of origPhase.lessons || []) {
        if (restoredLessonIds.has(extra.id)) continue;
        const hasProgress = (draft.lessonProgress || []).some((lp) => lp.lessonId === extra.id);
        const hasQuiz = (draft.quizzes || []).some((q) => q.lessonId === extra.id);
        const hasActivity = (origPhase.activities || []).some((a) => a.lessonId === extra.id);

        if (hasProgress || hasQuiz || hasActivity) {
          const archivedCopy = {
            ...structuredClone(extra),
            publicationStatus: 'archived',
          };
          if (targetPhase) {
            const targetLessons = targetPhase.lessons || (targetPhase.lessons = []);
            const maxPos = targetLessons.reduce((m, l) => Math.max(m, Number(l.position || 0)), 0);
            archivedCopy.position = maxPos + 1;
            targetLessons.push(archivedCopy);
          } else {
            restoredPhases.push({
              ...structuredClone(origPhase),
              publicationStatus: 'archived',
              lessons: [{ ...archivedCopy, position: 1 }],
            });
          }
          archivedExtraLessonsCount += 1;
        } else {
          deletedExtraLessonsCount += 1;
        }
      }
    }

    course.phases = restoredPhases.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));

    // Step 4: Restore course metadata safely
    if (snap.course) {
      if (snap.course.title) course.title = snap.course.title;
      if (snap.course.description !== undefined) course.description = snap.course.description;
      if (snap.course.targetAudience !== undefined) course.targetAudience = snap.course.targetAudience;
      if (Array.isArray(snap.course.outcomes)) course.outcomes = structuredClone(snap.course.outcomes);
      if (snap.course.difficulty) course.difficulty = snap.course.difficulty;
      if (snap.course.estimatedDurationWeeks !== undefined) {
        course.estimatedDurationWeeks = Number(snap.course.estimatedDurationWeeks);
      }
      if (snap.course.recommendedWeeklyHours !== undefined) {
        course.recommendedWeeklyHours = Number(snap.course.recommendedWeeklyHours);
      }
      if (snap.course.recommendedSchedule !== undefined) {
        course.recommendedSchedule = snap.course.recommendedSchedule;
      }
      if (Array.isArray(snap.course.prerequisites)) {
        course.prerequisites = structuredClone(snap.course.prerequisites);
      }
      if (snap.course.thumbnailUrl !== undefined) course.thumbnailUrl = snap.course.thumbnailUrl;
      if (snap.course.authorName !== undefined) course.authorName = snap.course.authorName;
      if (snap.course.completionRules) {
        course.completionRules = structuredClone(snap.course.completionRules);
      }
      if (snap.course.publicationStatus) course.publicationStatus = snap.course.publicationStatus;
    }

    draft.contentImports.unshift({
      id: restoreImportId,
      courseId,
      actorId: admin.id,
      actorEmail: admin.email || null,
      operationType: 'restore',
      packageVersion: CONTENT_PACKAGE_SCHEMA_VERSION,
      status: 'restored',
      processedCount: restoredLessonsCount,
      createdCount: 0,
      updatedCount: restoredLessonsCount,
      unchangedCount: 0,
      rejectedCount: 0,
      snapshotVersionId: safetyVersionId,
      idempotencyKey: null,
      changeNotes: cleanNotes || `Restored snapshot v${targetVersion.versionNumber}`,
      errorSummary: null,
      details: {
        restoredFromVersionId: versionId,
        restoredFromVersionNumber: targetVersion.versionNumber,
        archivedExtraLessonsCount,
        deletedExtraLessonsCount,
      },
      createdAt: nowIso,
    });

    appendDemoAuditLog(draft, {
      actorId: admin.id,
      action: 'course_snapshot_restored',
      targetTable: 'courses',
      targetId: courseId,
      beforeData: null,
      afterData: {
        restoreImportId,
        restoredFromVersionId: versionId,
        restoredFromVersionNumber: targetVersion.versionNumber,
        safetySnapshotVersionId: safetyVersionId,
        restoredLessonsCount,
        archivedExtraLessonsCount,
        deletedExtraLessonsCount,
      },
    });

    result = {
      restoreImportId,
      restoredFromVersionId: versionId,
      restoredVersionNumber: targetVersion.versionNumber,
      safetySnapshotVersionId: safetyVersionId,
      safetySnapshotVersionNumber: safetyVersionNumber,
      restoredLessonsCount,
      archivedExtraLessonsCount,
      deletedExtraLessonsCount,
    };
    return draft;
  });

  if (!result) {
    throw new Error('Unable to restore course snapshot.');
  }
  return result;
}

/**
 * @param {import('../../types/kord.d.ts').Course} c
 * @param {{ includeDrafts?: boolean }} [opts]
 * @returns {import('../../types/kord.d.ts').Course}
 */
function normalizeCourseForRead(c, { includeDrafts = false } = {}) {
  const associatedSkillIds = /** @type {string[]} */ (
    Array.from(new Set([c.skillId, ...(c.associatedSkillIds || [])].filter(Boolean)))
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

/**
 * @param {Record<string, any>} c
 * @returns {import('../../types/kord.d.ts').Course}
 */
function mapCourseSummary(c) {
  const linked = (c.course_skills || []).map((/** @type {any} */ cs) => cs.skill_id).filter(Boolean);
  return {
    id: c.id,
    skillId: c.skill_id,
    associatedSkillIds: Array.from(new Set([c.skill_id, ...linked].filter(Boolean))),
    slug: c.slug,
    title: c.title,
    description: c.description || '',
    difficulty: c.difficulty,
    estimatedDurationWeeks: c.estimated_duration_weeks,
    thumbnailUrl: c.thumbnail_url || '',
    authorName: c.author_name || 'Kord Curriculum Studio',
    version: Number(c.version || 1),
    publicationStatus: c.publication_status,
    position: c.position,
  };
}

/**
 * @param {Record<string, any>} c
 * @param {{ includeDrafts?: boolean }} [opts]
 * @returns {import('../../types/kord.d.ts').Course}
 */
function mapFullCourse(c, { includeDrafts = false } = {}) {
  const linked = (c.course_skills || []).map((/** @type {any} */ cs) => cs.skill_id).filter(Boolean);
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
      .filter((/** @type {any} */ p) => includeDrafts || (p.publication_status || 'published') === 'published')
      .slice()
      .sort((/** @type {any} */ a, /** @type {any} */ b) => a.position - b.position)
      .map((/** @type {any} */ p) => ({
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
          .sort((/** @type {any} */ a, /** @type {any} */ b) => Number(a.position || 0) - Number(b.position || 0))
          .map((/** @type {any} */ a) => ({
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
          .filter((/** @type {any} */ l) => includeDrafts || (l.publication_status || 'published') === 'published')
          .slice()
          .sort((/** @type {any} */ a, /** @type {any} */ b) => a.position - b.position)
          .map((/** @type {any} */ l) => ({
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

/**
 * @param {Record<string, any>} c
 * @returns {import('../../types/kord.d.ts').Challenge}
 */
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
