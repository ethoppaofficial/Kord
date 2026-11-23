import { DEFAULT_ALLOWED_MIME_TYPES } from '../validators.js';

function inferSourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return 'Reference Guide';
  }
}

export function buildCoursePackage(spec, { buildLesson, buildActivity, addAssessment }) {
  const courseId = `course-${spec.slug}`;
  const skillId = spec.skillId;
  const createdAt = spec.createdAt || '2026-10-10T09:00:00.000Z';

  const normalizedResources = (spec.resources || []).map((r) => ({
    title: r.title,
    source: r.source || inferSourceFromUrl(r.url),
    url: r.url,
    resourceType: r.resourceType || 'Documentation',
  }));

  const phases = (spec.modules || []).map((mod, mIdx) => {
    const phaseId = `ph-${spec.code}-${mIdx + 1}`;
    const lessons = (mod.lessons || []).map((les, lIdx) => {
      const lesId = `les-${spec.code}-${mIdx + 1}-${lIdx + 1}`;
      const readingPool = les.furtherReading && les.furtherReading.length > 0
        ? les.furtherReading
        : normalizedResources.slice(lIdx % Math.max(1, normalizedResources.length), (lIdx % Math.max(1, normalizedResources.length)) + 2);

      return buildLesson({
        id: lesId,
        position: lIdx + 1,
        title: les.title,
        introduction: les.introduction,
        objectives: les.objectives,
        estMinutes: les.estMinutes || 28,
        blocks: [
          { type: 'heading', level: 2, text: les.conceptHeading },
          { type: 'paragraph', text: les.conceptExplanation },
          { type: 'definition', term: les.definition.term, text: les.definition.meaning },
          { type: 'example', title: les.example.title, body: les.example.body },
          {
            type: 'steps',
            title: les.stepsTitle || `Step-by-Step Workflow: ${les.title}`,
            items: les.steps,
          },
          {
            type: 'case_study',
            title: les.caseStudy.title,
            text: les.caseStudy.scenario,
            takeaway: les.caseStudy.takeaway,
          },
          {
            type: 'callout',
            variant: les.callout.variant || 'tip',
            title: les.callout.title,
            text: les.callout.text,
          },
          {
            type: 'knowledge_check',
            prompt: les.inlineCheck.prompt,
            options: les.inlineCheck.options,
            correctIndex: les.inlineCheck.correctIndex ?? 0,
            explanation: les.inlineCheck.explanation,
          },
        ],
        summary: les.summary,
        takeaways: les.takeaways,
        furtherReading: readingPool.map((fr) => ({
          title: fr.title,
          source: fr.source || inferSourceFromUrl(fr.url),
          url: fr.url,
          resourceType: fr.resourceType || 'Guide',
        })),
        completionCriteria:
          les.completionCriteria ||
          `Study the core frameworks in "${les.title}", verify the inline knowledge check, and apply the practical checklist.`,
      });
    });

    const activities = [
      buildActivity({
        id: `act-${spec.code}-${mIdx + 1}`,
        phaseId,
        position: 1,
        title: mod.activity.title,
        description: mod.activity.description,
        instructions: mod.activity.instructions,
        expectedOutput: mod.activity.expectedOutput,
        estMinutes: mod.activity.estMinutes || 30,
        isRequired: true,
        lessonId: lessons[lessons.length - 1]?.id || null,
      }),
    ];

    return {
      id: phaseId,
      position: mIdx + 1,
      title: mod.title,
      summary: mod.summary,
      objectives: mod.objectives,
      difficulty: mod.difficulty || spec.difficulty || 'Beginner',
      estHours: mod.estHours || 3,
      publicationStatus: 'published',
      activities,
      lessons,
    };
  });

  if (spec.moduleQuiz && phases.length > 0) {
    const midPhase = phases[Math.min(2, phases.length - 1)];
    addAssessment({
      id: `quiz-${spec.code}-mod`,
      skillId,
      courseId,
      phaseId: midPhase.id,
      quizType: 'phase',
      title: spec.moduleQuiz.title,
      description: spec.moduleQuiz.description,
      passPercent: spec.moduleQuiz.passPercent || 70,
      timeLimitMinutes: spec.moduleQuiz.timeLimitMinutes || 15,
      maxAttempts: spec.moduleQuiz.maxAttempts || 5,
      questions: spec.moduleQuiz.questions,
    });
  }

  if (spec.finalExam) {
    addAssessment({
      id: `quiz-${spec.code}-final`,
      skillId,
      courseId,
      phaseId: null,
      quizType: 'course_exam',
      title: spec.finalExam.title,
      description: spec.finalExam.description,
      passPercent: spec.finalExam.passPercent || 75,
      timeLimitMinutes: spec.finalExam.timeLimitMinutes || 25,
      maxAttempts: spec.finalExam.maxAttempts || 3,
      questions: spec.finalExam.questions,
    });
  }

  const chSpec = spec.challenge;
  const rubric = (chSpec.rubric || []).map((r, idx) => ({
    id: r.id || `r${idx + 1}`,
    label: r.label,
    description: r.description,
    maxPoints: Number(r.maxPoints || (idx === 0 ? 7 : 6)),
    weightPercent: Number(r.weightPercent ?? (idx === 0 ? 28 : 24)),
  }));
  const computedMax = rubric.reduce((s, r) => s + r.maxPoints, 0);

  const challenge = {
    id: `ch-${spec.code}`,
    skillId,
    courseId,
    phaseId: phases[phases.length - 1]?.id || null,
    title: chSpec.title,
    brief: chSpec.brief,
    instructions: chSpec.instructions,
    expectedDeliverables: chSpec.expectedDeliverables,
    allowedEvidenceTypes: chSpec.allowedEvidenceTypes || ['written', 'file', 'project_url', 'screenshot'],
    allowedMimeTypes: chSpec.allowedMimeTypes || DEFAULT_ALLOWED_MIME_TYPES.slice(0, 7),
    maxFileSizeMb: chSpec.maxFileSizeMb || 25,
    isRequired: true,
    submissionFormat: chSpec.submissionFormat || 'PDF/DOCX upload, project link, or structured written submission',
    deliverableHint: chSpec.deliverableHint,
    maxScore: computedMax,
    passingScore: chSpec.passingScore || Math.round(computedMax * 0.72),
    rubric,
  };

  const associatedSkillIds = Array.from(
    new Set([skillId, ...(spec.associatedSkillIds || [])].filter(Boolean))
  );

  const course = {
    id: courseId,
    skillId,
    associatedSkillIds,
    categoryId: spec.categoryId || null,
    slug: spec.slug,
    title: spec.title,
    description: spec.description,
    targetAudience: spec.targetAudience,
    outcomes: spec.outcomes,
    difficulty: spec.difficulty || 'Beginner',
    estimatedDurationWeeks: spec.estimatedDurationWeeks || 4,
    recommendedWeeklyHours: spec.recommendedWeeklyHours || 4,
    recommendedSchedule: spec.recommendedSchedule || '2 lessons + 1 practical activity per week plus capstone project',
    prerequisites: spec.prerequisites || ['No prior specialist certification required; willingness to complete practical exercises'],
    thumbnailUrl: spec.thumbnailUrl || '',
    authorName: spec.authorName || 'Kord Curriculum Faculty',
    completionRules: {
      requireAllRequiredLessons: true,
      requireAllActivities: true,
      requireAllAssessments: true,
      requireChallengeSubmission: true,
      requireChallengeApproval: true,
    },
    publicationStatus: 'published',
    version: 1,
    position: 1,
    createdAt,
    updatedAt: createdAt,
    phases,
  };

  return { course, challenge };
}

export function buildDomainCourse(cfg, helpers) {
  const modules = cfg.modules.map((m, idx) => ({
    title: m.t,
    summary: m.s,
    objectives: m.o,
    difficulty: idx >= 4 && cfg.difficulty === 'Beginner' ? 'Intermediate' : (cfg.difficulty || 'Beginner'),
    estHours: m.h || 3,
    lessons: m.l.map((l) => ({
      title: l.t,
      introduction: l.intro,
      objectives: l.o,
      estMinutes: l.min || 28,
      conceptHeading: l.h,
      conceptExplanation: l.exp,
      definition: { term: l.def[0], meaning: l.def[1] },
      example: { title: l.ex[0], body: l.ex[1] },
      stepsTitle: `Applying ${l.t}`,
      steps: l.steps,
      caseStudy: { title: l.cs[0], scenario: l.cs[1], takeaway: l.cs[2] },
      callout: { variant: 'tip', title: l.tip[0], text: l.tip[1] },
      inlineCheck: { prompt: l.chk[0], options: l.chk[1], correctIndex: l.chk[2], explanation: l.chk[3] },
      summary: l.sum,
      takeaways: l.tk,
    })),
    activity: {
      title: m.act[0],
      description: m.act[1],
      instructions: m.act[2],
      expectedOutput: m.act[3],
      estMinutes: 30,
    },
  }));

  const mapQ = (q, i) => ({
    prompt: q[0],
    options: q[1],
    correctIndex: q[2],
    explanation: q[3],
    questionType: q[4] || (i % 2 === 1 ? 'scenario' : 'multiple_choice'),
    difficulty: i >= 3 ? 'hard' : 'medium',
    marks: 1,
  });

  return buildCoursePackage(
    {
      code: cfg.code,
      skillId: cfg.skillId,
      associatedSkillIds: cfg.associatedSkillIds || [],
      categoryId: cfg.categoryId || null,
      slug: cfg.slug,
      title: cfg.title,
      description: cfg.description,
      targetAudience: cfg.targetAudience,
      outcomes: cfg.outcomes,
      difficulty: cfg.difficulty || 'Beginner',
      estimatedDurationWeeks: cfg.weeks || 4,
      recommendedWeeklyHours: cfg.weeklyHours || 4,
      recommendedSchedule: cfg.schedule || 'Complete 1–2 modules per week including guided activities and checkpoints.',
      prerequisites: cfg.prerequisites,
      authorName: cfg.author || 'Kord Curriculum Faculty',
      resources: cfg.resources,
      modules,
      moduleQuiz: {
        title: `${cfg.title}: Mid-Course Check`,
        description: `Verify core frameworks from Modules 1–3 before advancing into applied capstone work.`,
        passPercent: 70,
        timeLimitMinutes: 15,
        maxAttempts: 5,
        questions: cfg.mq.map(mapQ),
      },
      finalExam: {
        title: `${cfg.title}: Final Mastery Exam`,
        description: `Comprehensive scenario and conceptual evaluation across all six modules.`,
        passPercent: 75,
        timeLimitMinutes: 25,
        maxAttempts: 3,
        questions: cfg.fq.map(mapQ),
      },
      challenge: {
        title: cfg.ch.title,
        brief: cfg.ch.brief,
        instructions: cfg.ch.instructions,
        expectedDeliverables: cfg.ch.deliverables,
        allowedEvidenceTypes: cfg.ch.evidenceTypes || ['written', 'file', 'project_url', 'screenshot'],
        allowedMimeTypes: cfg.ch.mimeTypes,
        submissionFormat: cfg.ch.format,
        deliverableHint: cfg.ch.hint,
        rubric: cfg.ch.rubric.map((r, i) => ({
          id: `r${i + 1}`,
          label: r[0],
          description: r[1],
          maxPoints: r[2],
          weightPercent: r[3],
        })),
      },
    },
    helpers
  );
}

