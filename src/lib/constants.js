export const ADMIN_EMAIL = 'ethoppaofficial@gmail.com';

export const DEFAULT_CATEGORIES = [
  {
    id: 'cat-communication',
    slug: 'communication-interpersonal',
    name: 'Communication & Interpersonal',
    description: 'Clear workplace communication, public speaking, negotiation, active listening, leadership, and conflict resolution.',
    position: 1,
  },
  {
    id: 'cat-writing',
    slug: 'writing-content-creation',
    name: 'Writing & Content Creation',
    description: 'Creative storytelling, business writing, copywriting, technical documentation, editing, and SEO content strategy.',
    position: 2,
  },
  {
    id: 'cat-business',
    slug: 'entrepreneurship-business',
    name: 'Entrepreneurship & Business',
    description: 'Startup fundamentals, business planning, market research, financial literacy, CRM, product and project management.',
    position: 3,
  },
  {
    id: 'cat-marketing',
    slug: 'digital-marketing-social',
    name: 'Digital Marketing & Social Media',
    description: 'Social media management, Meta and Google advertising, SEO, email marketing, analytics, and conversion optimization.',
    position: 4,
  },
  {
    id: 'cat-creative',
    slug: 'creative-design',
    name: 'Creative & Design',
    description: 'Graphic design, Canva, UI/UX design, brand identity, photography, video editing, and art direction.',
    position: 5,
  },
  {
    id: 'cat-tech',
    slug: 'technology-digital',
    name: 'Technology & Digital',
    description: 'Web and mobile development, databases, data analysis, cybersecurity, cloud computing, AI, testing, and DevOps.',
    position: 6,
  },
  {
    id: 'cat-career',
    slug: 'career-professional',
    name: 'Career & Professional Development',
    description: 'CV writing, interview readiness, freelancing, remote collaboration, time management, and client management.',
    position: 7,
  },
];

export const SKILL_LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced'];
export const DIFFICULTY_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const PUBLICATION_STATUSES = ['published', 'draft', 'archived'];

export const ASSESSMENT_TYPES = [
  { key: 'knowledge_check', label: 'Knowledge Check', recommendedRange: '5 to 10 questions' },
  { key: 'phase', label: 'Phase Assessment', recommendedRange: '10 to 20 questions' },
  { key: 'skill_check', label: 'Skill Check', recommendedRange: '15 to 25 questions' },
  { key: 'course_exam', label: 'Comprehensive Course Exam', recommendedRange: '25 to 50 questions' },
];

export const QUESTION_TYPES = [
  { key: 'multiple_choice', label: 'Multiple choice (single)', autoGraded: true },
  { key: 'multiple_select', label: 'Multiple select', autoGraded: true },
  { key: 'true_false', label: 'True or false', autoGraded: true },
  { key: 'fill_blank', label: 'Fill in the blank', autoGraded: true },
  { key: 'ordering', label: 'Ordering & sequencing', autoGraded: true },
  { key: 'scenario', label: 'Scenario-based', autoGraded: true },
  { key: 'case_study', label: 'Case-study question', autoGraded: true },
  { key: 'short_answer', label: 'Short written answer', autoGraded: false },
  { key: 'long_form', label: 'Long-form written response', autoGraded: false },
  { key: 'practical_submission', label: 'Practical task link / submission', autoGraded: false },
];

export const PROGRESSION_LADDER = [
  { key: 'declared', label: 'Declared', rank: 1, weight: 0.3, hint: 'Skill identified or enrolled in a relevant course' },
  { key: 'practising', label: 'Practising', rank: 2, weight: 0.6, hint: 'Earned by completing lessons and foundational assessments' },
  { key: 'demonstrated', label: 'Demonstrated', rank: 3, weight: 0.8, hint: 'Earned by passing required assessments or finishing a course' },
  { key: 'verified', label: 'Verified', rank: 4, weight: 1.0, hint: 'Earned when all published courses under this skill are completed with approved practical evidence' },
];

export const PROGRESSION_RANK = {
  declared: 1,
  practising: 2,
  demonstrated: 3,
  verified: 4,
};

export const PROGRESSION_WEIGHT = {
  declared: 0.3,
  practising: 0.6,
  demonstrated: 0.8,
  verified: 1.0,
};

export const PROGRESSION_LABEL = {
  declared: 'Declared',
  practising: 'Practising',
  demonstrated: 'Demonstrated',
  verified: 'Verified',
};

export const OPPORTUNITY_TYPES = ['All', 'Internship', 'Junior Role', 'Apprenticeship', 'Fellowship', 'Project'];
export const WORK_MODES = ['All', 'Remote', 'Hybrid', 'On-site'];
