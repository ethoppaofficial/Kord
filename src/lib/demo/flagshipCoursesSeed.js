/**
 * Flagship Courses Curriculum Seed
 *
 * Implements four complete, published, end-to-end flagship courses connected
 * to Kord's competency catalogue across Technology, Creative & Design,
 * Digital Marketing, and Communication:
 *   1. Frontend Development Foundations (8 modules, 16 lessons, 8 activities, 3 assessments, 1 capstone)
 *   2. Graphic Design Foundations (8 modules, 16 lessons, 8 activities, 2 assessments, 1 capstone)
 *   3. Digital Marketing Foundations (8 modules, 16 lessons, 8 activities, 2 assessments, 1 capstone)
 *   4. Communication and Public Speaking (8 modules, 16 lessons, 8 activities, 2 assessments, 1 capstone)
 */

import { buildFrontendCourse } from './courses/frontendCourse.js';
import { buildGraphicDesignCourse } from './courses/graphicDesignCourse.js';
import { buildDigitalMarketingCourse } from './courses/digitalMarketingCourse.js';
import { buildCommunicationCourse } from './courses/communicationCourse.js';
import { COMMUNICATION_COURSE_BUILDERS } from './catalog/communicationCourses.js';
import { WRITING_COURSE_BUILDERS } from './catalog/writingCourses.js';
import { BUSINESS_COURSE_BUILDERS } from './catalog/businessCourses.js';
import { MARKETING_COURSE_BUILDERS } from './catalog/marketingCourses.js';
import { CREATIVE_COURSE_BUILDERS } from './catalog/creativeCourses.js';
import { TECH_COURSE_BUILDERS } from './catalog/techCourses.js';
import { CAREER_COURSE_BUILDERS } from './catalog/careerCourses.js';

function buildLesson({
  id,
  position,
  title,
  introduction,
  objectives = [],
  estMinutes = 25,
  blocks = [],
  videos = [],
  summary = '',
  takeaways = [],
  furtherReading = [],
  isRequired = true,
  completionCriteria = 'Read the instructional guide, verify any inline knowledge checks, and mark this lesson complete.',
  publicationStatus = 'published',
}) {
  return {
    id,
    position,
    title,
    introduction,
    objectives,
    estMinutes,
    blocks,
    videos,
    summary,
    takeaways,
    furtherReading,
    isRequired,
    completionCriteria,
    publicationStatus,
  };
}

function buildActivity({
  id,
  phaseId,
  position = 1,
  title,
  description = '',
  estMinutes = 25,
  instructions = '',
  expectedOutput = '',
  isRequired = true,
  lessonId = null,
}) {
  return {
    id,
    phaseId,
    lessonId,
    position,
    title,
    description,
    estMinutes,
    instructions,
    expectedOutput,
    isRequired,
    resources: [],
  };
}

export function createFlagshipCurriculumSeed() {
  const courses = [];
  const quizzes = [];
  const privateQuizAnswers = {};
  const challenges = [];

  function addAssessment({
    id,
    skillId,
    courseId,
    phaseId = null,
    lessonId = null,
    quizType = 'phase',
    title,
    description,
    passPercent = 70,
    timeLimitMinutes = null,
    maxAttempts = null,
    shuffleQuestions = false,
    requiresManualReview = false,
    questions = [],
  }) {
    const cleanQuestions = questions.map((q, idx) => {
      const qId = q.id || `${id}-q-${idx + 1}`;
      privateQuizAnswers[qId] = {
        correctIndex: q.correctIndex ?? 0,
        correctIndices: q.correctIndices || null,
        acceptedAnswers: q.acceptedAnswers || null,
        correctOrder: q.correctOrder || null,
        explanation: q.explanation || '',
      };
      return {
        id: qId,
        position: idx + 1,
        questionType: q.questionType || 'multiple_choice',
        difficulty: q.difficulty || 'medium',
        marks: q.marks || 1,
        prompt: q.prompt,
        contextText: q.contextText || '',
        options: q.options || [],
      };
    });

    quizzes.push({
      id,
      skillId,
      courseId,
      phaseId,
      lessonId,
      quizType,
      title,
      description,
      passPercent,
      timeLimitMinutes,
      maxAttempts,
      shuffleQuestions,
      requiresManualReview,
      questions: cleanQuestions,
    });
  }

  const builders = [
    buildFrontendCourse,
    buildGraphicDesignCourse,
    buildDigitalMarketingCourse,
    buildCommunicationCourse,
    ...COMMUNICATION_COURSE_BUILDERS,
    ...WRITING_COURSE_BUILDERS,
    ...BUSINESS_COURSE_BUILDERS,
    ...MARKETING_COURSE_BUILDERS,
    ...CREATIVE_COURSE_BUILDERS,
    ...TECH_COURSE_BUILDERS,
    ...CAREER_COURSE_BUILDERS,
  ];

  builders.forEach((buildFn) => {
    const { course, challenge } = buildFn({ buildLesson, buildActivity, addAssessment });
    if (course) courses.push(course);
    if (challenge) challenges.push(challenge);
  });

  const courseVersions = courses.map((c) => ({
    id: `cv-${c.id}-v${c.version || 1}`,
    courseId: c.id,
    versionNumber: c.version || 1,
    changeNotes: `Initial published release of structured ${(c.phases || []).length}-module course pathway.`,
    snapshot: {
      title: c.title,
      difficulty: c.difficulty,
      phaseCount: (c.phases || []).length,
      lessonCount: (c.phases || []).reduce((acc, p) => acc + (p.lessons || []).length, 0),
    },
    createdAt: c.createdAt || new Date().toISOString(),
  }));

  return { courses, quizzes, privateQuizAnswers, challenges, courseVersions };
}
