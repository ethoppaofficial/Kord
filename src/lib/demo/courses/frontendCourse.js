import { COURSE_THUMBNAILS } from '../../courseThumbnails.js';
import { buildFrontendPhasesPart1 } from './frontendLessons1.js';
import { buildFrontendPhasesPart2 } from './frontendLessons2.js';

/** @type {import('../../../types/kord.d.ts').CourseBuilderFn} */
export function buildFrontendCourse({ buildLesson, buildActivity, addAssessment }) {
  const courseId = 'course-frontend-foundations';
  const skillId = 'skill-frontend-development';
  const associatedSkillIds = ['skill-frontend-development', 'skill-web-development'];
  const now = '2026-10-01T09:00:00.000Z';

  const phases = [
    ...buildFrontendPhasesPart1(buildLesson, buildActivity),
    ...buildFrontendPhasesPart2(buildLesson, buildActivity),
  ];

  const course = {
    id: courseId,
    skillId,
    associatedSkillIds,
    slug: 'frontend-development-foundations',
    title: 'Frontend Development Foundations',
    description: 'Master semantic HTML5, modern CSS layout systems, responsive design, modular JavaScript, DOM manipulation, form validation, and live static deployment.',
    targetAudience: 'Aspiring web developers, designers, and makers building responsive websites from scratch.',
    difficulty: 'Beginner',
    estimatedDurationWeeks: 8,
    recommendedWeeklyHours: 5,
    recommendedSchedule: '1 module (2 lessons + 1 practical exercise) per week',
    prerequisites: ['Basic comfort using a web browser and text editor'],
    thumbnailUrl: COURSE_THUMBNAILS['frontend-development-foundations'] || '',
    authorName: 'Kord Engineering Faculty',
    publicationStatus: 'published',
    version: 1,
    createdAt: now,
    updatedAt: now,
    position: 1,
    outcomes: [
      'Write clean, accessible HTML5 documents with proper landmark and heading hierarchy',
      'Build responsive multi-column interfaces using Flexbox, CSS Grid, and design tokens',
      'Implement interactive DOM filtering, toggles, and validated forms in vanilla JavaScript',
      'Audit and deploy a production-ready responsive business website to a live HTTPS URL',
    ],
    completionRules: {
      requireAllRequiredLessons: true,
      requireAllActivities: true,
      requireAllAssessments: true,
      requireChallengeSubmission: true,
      requireChallengeApproval: true,
    },
    phases,
  };

  addAssessment({
    id: 'quiz-fe-1',
    skillId,
    courseId,
    phaseId: 'ph-fe-4',
    quizType: 'phase',
    title: 'HTML, CSS & Responsive Layout Assessment',
    description: 'Verify core understanding of browser rendering, semantic HTML5, specificity, Box Model, Flexbox, and CSS Grid.',
    passPercent: 70,
    timeLimitMinutes: 15,
    maxAttempts: 5,
    questions: [
      {
        id: 'q-fe-1-1',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'Which CSS property ensures padding and borders are included inside an element’s declared width?',
        options: ['display: inline-block', 'box-sizing: border-box', 'overflow: hidden', 'position: relative'],
        correctIndex: 1,
        explanation: 'box-sizing: border-box keeps width/height inclusive of padding and border, preventing unexpected overflow.',
      },
      {
        id: 'q-fe-1-2',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'What is the primary benefit of semantic HTML landmarks like <main> and <nav>?',
        options: ['Automatic dark-mode styling', 'Keyboard and screen-reader navigation structure', 'Faster JavaScript execution'],
        correctIndex: 1,
        explanation: 'Assistive technologies expose semantic landmarks so users can jump straight to navigation or main content.',
      },
      {
        id: 'q-fe-1-3',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'When should you prefer CSS Grid over Flexbox?',
        options: ['Aligning items strictly along a single horizontal row', 'Designing a two-dimensional layout with both columns and rows', 'Animating hover colours'],
        correctIndex: 1,
        explanation: 'CSS Grid excels at 2D column-and-row alignment; Flexbox excels at 1D distribution.',
      },
      {
        id: 'q-fe-1-4',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'Why should an icon that sits next to already-descriptive button text have alt=""?',
        options: ['To skip redundant screen-reader announcements', 'To hide the icon visually', 'To reduce file size'],
        correctIndex: 0,
        explanation: 'Empty alt="" marks an image as decorative so assistive technology does not read redundant noise.',
      },
    ],
  });

  addAssessment({
    id: 'quiz-fe-2',
    skillId,
    courseId,
    phaseId: 'ph-fe-7',
    quizType: 'phase',
    title: 'JavaScript, DOM & Forms Assessment',
    description: 'Assess pure JavaScript transformations, safe DOM manipulation, event delegation, and accessible form validation.',
    passPercent: 70,
    timeLimitMinutes: 15,
    maxAttempts: 5,
    questions: [
      {
        id: 'q-fe-2-1',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'Which method avoids Cross-Site Scripting (XSS) when inserting user-submitted text into a card?',
        options: ['element.innerHTML = userText', 'element.textContent = userText', 'document.write(userText)'],
        correctIndex: 1,
        explanation: 'textContent treats strings strictly as literal text and never parses embedded HTML or <script> tags.',
      },
      {
        id: 'q-fe-2-2',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'How do you handle clicks on dynamically rendered list buttons without binding a listener to each button?',
        options: ['Inline onclick strings', 'Event delegation on the parent container using e.target.closest()', 'setInterval polling'],
        correctIndex: 1,
        explanation: 'Delegated listeners on a stable parent inspect e.target.closest(...) and survive re-renders cleanly.',
      },
      {
        id: 'q-fe-2-3',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'In an accessible HTML form, how should a custom validation error be communicated?',
        options: ['Turn the border red with no text', 'Show clear inline text next to the field and pair every input with a <label>', 'Use a browser alert() dialog on every keystroke'],
        correctIndex: 1,
        explanation: 'Inline error messages paired with labelled fields satisfy WCAG AA non-colour-only error communication.',
      },
    ],
  });

  addAssessment({
    id: 'quiz-fe-final',
    skillId,
    courseId,
    phaseId: 'ph-fe-8',
    quizType: 'course_exam',
    title: 'Frontend Development Foundations Course Exam',
    description: 'Comprehensive exam covering web architecture, HTML semantics, responsive CSS, JS logic, validation, and deployment.',
    passPercent: 75,
    timeLimitMinutes: 25,
    maxAttempts: 4,
    questions: [
      {
        id: 'q-fe-f-1',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'Which meta tag is required for mobile browsers to honour responsive CSS media queries cleanly?',
        options: ['<meta name="robots" content="index">', '<meta name="viewport" content="width=device-width, initial-scale=1.0">', '<meta charset="ASCII">'],
        correctIndex: 1,
        explanation: 'Without width=device-width, mobile browsers zoom out to a simulated ~980px desktop viewport.',
      },
      {
        id: 'q-fe-f-2',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'What happens if a CSS file uses root-absolute /styles/main.css when deployed under https://user.github.io/site-name/?',
        options: ['It resolves relative to the domain root and breaks with a 404', 'It loads twice as fast', 'GitHub automatically rewrites it'],
        correctIndex: 0,
        explanation: 'Relative paths (./styles/main.css) work consistently across root domains and project sub-paths.',
      },
      {
        id: 'q-fe-f-3',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'Which JavaScript expression creates a sorted copy of an array without mutating the original?',
        options: ['items.sort()', 'items.slice().sort((a, b) => a.price - b.price)', 'items.filter(Boolean)'],
        correctIndex: 1,
        explanation: '.slice() creates a shallow copy first because Array.prototype.sort() mutates arrays in place.',
      },
      {
        id: 'q-fe-f-4',
        questionType: 'multiple_choice',
        marks: 2,
        prompt: 'Does passing this exam alone award Verified practical competence?',
        options: ['Yes, 100%', 'No—practical competence requires building and earning approval on the responsive business website project'],
        correctIndex: 1,
        explanation: 'Quizzes measure conceptual understanding; practical competence requires reviewed implementation evidence.',
      },
    ],
  });

  const challenge = {
    id: 'chal-fe-capstone',
    skillId,
    courseId,
    phaseId: 'ph-fe-8',
    title: 'Final Practical Project: Build and Deploy a Responsive Business Website',
    brief: 'Design, code, and deploy a multi-section responsive website for a real or fictional local business using semantic HTML5, responsive CSS (Flexbox & Grid), interactive DOM controls, and a validated contact/inquiry form.',
    instructions: 'Include at least 3 pages or 4 distinct sections (Hero, Services Grid, Interactive FAQ/Filter, Validated Inquiry Form), verify mobile responsiveness at 375px and desktop at 1440px, and publish to a live static host (GitHub Pages, Netlify, Cloudflare Pages, or Vercel).',
    expectedDeliverables: [
      'Live deployed HTTPS website URL',
      'Public Git repository link showing clean HTML/CSS/JS files',
      'Screenshot or brief architecture & accessibility audit notes (focus order, contrast, and responsive breakpoints)',
    ],
    allowedEvidenceTypes: ['project_url', 'repo_url', 'screenshot', 'file', 'written'],
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/zip'],
    maxFileSizeMb: 20,
    isRequired: true,
    submissionFormat: 'Live project URL + Git repository URL + optional screenshot/notes',
    deliverableHint: 'Submit your deployed URL, Git repo URL, and explain how you tested responsiveness and form validation.',
    maxScore: 25,
    passingScore: 18,
    rubric: [
      { id: 'r1', label: 'Semantic HTML5 & Accessibility', description: 'Valid landmarks, single h1, labelled form inputs, keyboard focus visibility.', maxPoints: 7, weightPercent: 28 },
      { id: 'r2', label: 'Responsive CSS Architecture', description: 'Clean Flexbox/Grid layout across mobile (375px) and desktop (1440px) with zero horizontal overflow.', maxPoints: 6, weightPercent: 24 },
      { id: 'r3', label: 'JavaScript Interactivity & Validation', description: 'Working DOM interactions (e.g. filter/FAQ) and friendly inline form validation without console errors.', maxPoints: 6, weightPercent: 24 },
      { id: 'r4', label: 'Live Deployment & Code Organisation', description: 'Working HTTPS URL with relative asset paths and clean file structure.', maxPoints: 6, weightPercent: 24 },
    ],
  };

  return { course, challenge };
}
