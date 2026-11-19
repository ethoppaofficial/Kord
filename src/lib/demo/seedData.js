import { ADMIN_EMAIL } from '../constants.js';

export function createInitialSeed() {
  const now = Date.now();
  const daysAgo = (d, hour = 10) => {
    const dt = new Date(now - d * 86400000);
    dt.setHours(hour, 15, 0, 0);
    return dt.toISOString();
  };

  const users = [
    {
      id: 'user-learner-maya',
      email: 'maya.lin@example.com',
      firstName: 'Maya',
      lastName: 'Lin',
      fullName: 'Maya Lin',
      role: 'learner',
      password: 'password123',
      createdAt: daysAgo(30),
    },
    {
      id: 'user-admin-ethoppa',
      email: ADMIN_EMAIL,
      firstName: 'Ethoppa',
      lastName: 'Admin',
      fullName: 'Ethoppa Admin',
      role: 'admin',
      password: 'admin@2026',
      createdAt: daysAgo(60),
    },
  ];

  const skills = [
    {
      id: 'skill-writing',
      slug: 'structured-business-writing',
      title: 'Structured Business Writing',
      category: 'Communication',
      level: 'Beginner',
      roadmapStatus: 'full',
      estHours: 3.5,
      summary:
        'Write concise memos, executive summaries, and action-oriented updates that decision-makers can scan in 30 seconds.',
      outcomes: [
        'Structure briefs using BLUF (Bottom Line Up Front)',
        'Replace vague prose with verifiable metrics and clear owners',
        'Deliver an executive brief assessed against a 4-point rubric',
      ],
      phases: [
        {
          id: 'phase-writing-1',
          position: 1,
          title: 'Clarity & Bottom-Line Structure',
          summary: 'Lead with the decision or takeaway before supporting evidence.',
          activities: [
            {
              id: 'act-writing-1',
              position: 1,
              title: 'Plain Language & Concise Sentences',
              description: 'Review practical techniques for trimming filler words and writing direct active-voice sentences.',
              estMinutes: 25,
              resources: [
                {
                  title: 'Purdue OWL — Conciseness & Eliminating Wordiness',
                  url: 'https://owl.purdue.edu/owl/general_writing/academic_writing/conciseness/index.html',
                  source: 'Purdue OWL',
                  verified: true,
                },
              ],
            },
            {
              id: 'act-writing-2',
              position: 2,
              title: 'Structuring Executive Memos (BLUF)',
              description: 'Learn how to open memos with the core recommendation, risk summary, and decision deadline.',
              estMinutes: 30,
              resources: [
                {
                  title: 'MindTools — Writing Effective Business Reports',
                  url: 'https://www.mindtools.com/a4w26p3/writing-effective-reports',
                  source: 'MindTools',
                  verified: true,
                },
              ],
            },
          ],
          quizId: 'quiz-writing-p1',
        },
        {
          id: 'phase-writing-2',
          position: 2,
          title: 'Evidence, Requests & Action Owners',
          summary: 'Back up claims with concrete numbers and close with unambiguous next steps.',
          activities: [
            {
              id: 'act-writing-3',
              position: 1,
              title: 'Audience-First Stakeholder Updates',
              description: 'Adapt tone, formatting, and evidence depth for operations leads versus executive sponsors.',
              estMinutes: 25,
              resources: [
                {
                  title: 'Purdue OWL — Workplace Writers & Memos',
                  url: 'https://owl.purdue.edu/owl/subject_specific_writing/professional_technical_writing/memos/index.html',
                  source: 'Purdue OWL',
                  verified: true,
                },
              ],
            },
            {
              id: 'act-writing-4',
              position: 2,
              title: 'Action Lists & Decision Logs',
              description: 'Turn open-ended status paragraphs into scannable action tables with owner and date.',
              estMinutes: 20,
              resources: [
                {
                  title: 'MindTools — Better Written Communication',
                  url: 'https://www.mindtools.com/page6.html',
                  source: 'MindTools',
                  verified: true,
                },
              ],
            },
          ],
          quizId: 'quiz-writing-p2',
        },
      ],
      skillCheckQuizId: 'quiz-writing-check',
      challengeId: 'chal-writing',
    },
    {
      id: 'skill-speaking',
      slug: 'public-speaking-presentations',
      title: 'Public Speaking & Presentations',
      category: 'Communication',
      level: 'Intermediate',
      roadmapStatus: 'full',
      estHours: 3.0,
      summary:
        'Plan, pace, and deliver persuasive 5-minute briefings for technical and non-technical stakeholders.',
      outcomes: [
        'Open with a clear problem-impact hook in the first 30 seconds',
        'Design slide narratives with one claim per slide',
        'Handle Q&A concisely using structured bridging',
      ],
      phases: [
        {
          id: 'phase-speaking-1',
          position: 1,
          title: 'Narrative Arc & Pacing',
          summary: 'Shape spoken briefings so audiences remember the core claim and next step.',
          activities: [
            {
              id: 'act-speaking-1',
              position: 1,
              title: 'Structuring a 5-Minute Briefing',
              description: 'Use Problem -> Evidence -> Recommendation framing to avoid rambling openings.',
              estMinutes: 25,
              resources: [
                {
                  title: 'Toastmasters — Public Speaking Tips & Speech Organization',
                  url: 'https://www.toastmasters.org/resources/public-speaking-tips',
                  source: 'Toastmasters',
                  verified: true,
                },
              ],
            },
            {
              id: 'act-speaking-2',
              position: 2,
              title: 'Vocal Variety, Pauses & Q&A Control',
              description: 'Use deliberate pauses after key numbers and concise bridging during hard questions.',
              estMinutes: 30,
              resources: [
                {
                  title: 'MindTools — Delivering Great Presentations',
                  url: 'https://www.mindtools.com/CommSkll/PresentationPlanning.htm',
                  source: 'MindTools',
                  verified: true,
                },
              ],
            },
          ],
          quizId: 'quiz-speaking-p1',
        },
      ],
      skillCheckQuizId: 'quiz-speaking-check',
      challengeId: 'chal-speaking',
    },
    {
      id: 'skill-analytics',
      slug: 'digital-analytics-measurement',
      title: 'Digital Analytics & Measurement',
      category: 'Data & Digital',
      level: 'Beginner',
      roadmapStatus: 'full',
      estHours: 4.0,
      summary:
        'Define meaningful product metrics, separate vanity counts from outcomes, and build clean measurement plans.',
      outcomes: [
        'Map user journeys to measurable conversion events',
        'Spot misleading averages and survivorship bias',
        'Author a one-page measurement specification',
      ],
      phases: [
        {
          id: 'phase-analytics-1',
          position: 1,
          title: 'Metrics That Reflect Outcomes',
          summary: 'Choose leading indicators tied to real user value rather than raw pageviews.',
          activities: [
            {
              id: 'act-analytics-1',
              position: 1,
              title: 'Building a Measurement Plan',
              description: 'Translate organizational objectives into KPIs, segments, and target thresholds.',
              estMinutes: 35,
              resources: [
                {
                  title: 'Google Digital Garage — Fundamentals of Digital Analytics',
                  url: 'https://skillshop.exceedlms.com/student/catalog',
                  source: 'Google Digital Garage',
                  verified: true,
                },
              ],
            },
            {
              id: 'act-analytics-2',
              position: 2,
              title: 'Core Web & Product Telemetry Basics',
              description: 'Understand field vs lab data, percentiles (p75), and funnel drop-off diagnostics.',
              estMinutes: 30,
              resources: [
                {
                  title: 'web.dev — User-Centric Performance & Measurement',
                  url: 'https://web.dev/articles/user-centric-performance-metrics',
                  source: 'web.dev',
                  verified: true,
                },
              ],
            },
          ],
          quizId: 'quiz-analytics-p1',
        },
      ],
      skillCheckQuizId: 'quiz-analytics-check',
      challengeId: 'chal-analytics',
    },
    {
      id: 'skill-a11y',
      slug: 'web-accessibility-fundamentals',
      title: 'Web Accessibility Fundamentals',
      category: 'Product & Web',
      level: 'Intermediate',
      roadmapStatus: 'full',
      estHours: 3.5,
      summary:
        'Audit semantic HTML, keyboard focus order, and WCAG AA contrast so public digital services work for everyone.',
      outcomes: [
        'Audit keyboard navigation and visible focus rings',
        'Verify semantic landmarks, headings, and accessible form labels',
        'Produce an actionable WCAG 2.2 AA remediation log',
      ],
      phases: [
        {
          id: 'phase-a11y-1',
          position: 1,
          title: 'Semantic Structure & Keyboard Access',
          summary: 'Ensure every interactive workflow works cleanly without a mouse.',
          activities: [
            {
              id: 'act-a11y-1',
              position: 1,
              title: 'HTML Landmarks & Accessible Names',
              description: 'Use native buttons, form labels, and heading hierarchy before reaching for ARIA.',
              estMinutes: 30,
              resources: [
                {
                  title: 'MDN Web Docs — Accessibility Overview',
                  url: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility',
                  source: 'MDN Web Docs',
                  verified: true,
                },
              ],
            },
            {
              id: 'act-a11y-2',
              position: 2,
              title: 'Easy Checks for WCAG Compliance',
              description: 'Run a structured 15-minute keyboard, zoom, and contrast check on any web page.',
              estMinutes: 25,
              resources: [
                {
                  title: 'W3C WAI — Easy Checks: A First Review of Web Accessibility',
                  url: 'https://www.w3.org/WAI/test-evaluate/preliminary/',
                  source: 'W3C WAI',
                  verified: true,
                },
              ],
            },
          ],
          quizId: 'quiz-a11y-p1',
        },
      ],
      skillCheckQuizId: 'quiz-a11y-check',
      challengeId: 'chal-a11y',
    },
    {
      id: 'skill-discovery',
      slug: 'stakeholder-discovery-interviews',
      title: 'Stakeholder Discovery Interviews',
      category: 'Product & Web',
      level: 'Intermediate',
      roadmapStatus: 'coming_soon',
      estHours: 2.5,
      summary:
        'Conduct non-leading discovery interviews and synthesize findings into prioritized opportunity trees.',
      outcomes: [
        'Write neutral interview guides without leading questions',
        'Synthesize qualitative notes into verifiable evidence themes',
      ],
      phases: [],
      skillCheckQuizId: null,
      challengeId: null,
    },
    {
      id: 'skill-data-story',
      slug: 'civic-data-storytelling',
      title: 'Civic Data Storytelling',
      category: 'Data & Digital',
      level: 'Advanced',
      roadmapStatus: 'coming_soon',
      estHours: 4.5,
      summary:
        'Turn public datasets into transparent, reproducible visual narratives for policy and community teams.',
      outcomes: [
        'Normalize public CSV datasets cleanly',
        'Communicate uncertainty, denominators, and baselines accurately',
      ],
      phases: [],
      skillCheckQuizId: null,
      challengeId: null,
    },
  ];

  // Note: Quiz questions do NOT store answers inside learner-exposed objects;
  // answers live in PRIVATE_QUIZ_KEY inside quizRepository/seedData vault.
  const quizzes = [
    {
      id: 'quiz-writing-p1',
      skillId: 'skill-writing',
      phaseId: 'phase-writing-1',
      quizType: 'phase',
      title: 'Phase 1 Check — Clarity & BLUF Structure',
      description: 'Verify your grasp of concise prose and Bottom Line Up Front memo framing.',
      passPercent: 70,
      questions: [
        {
          id: 'q-w1-1',
          position: 1,
          prompt: 'Where should the primary recommendation appear in a BLUF (Bottom Line Up Front) memo?',
          options: [
            'In the opening paragraph before detailed background',
            'In the appendix after supporting tables',
            'Only in the closing summary sentence',
            'In a footnote attached to the budget section',
          ],
        },
        {
          id: 'q-w1-2',
          position: 2,
          prompt: 'Which revision best removes wordiness without losing meaning?',
          options: [
            '"Due to the fact that there were delays, we are writing to inform you..."',
            '"Because delivery slipped by 4 days, we moved the launch to 14 May."',
            '"In light of recent timeline circumstances, a schedule adjustment has occurred."',
            '"It is important to note that the schedule has experienced movement."',
          ],
        },
        {
          id: 'q-w1-3',
          position: 3,
          prompt: 'What makes a subject line most useful for a busy decision-maker?',
          options: [
            'Naming the topic and the exact action or decision needed with date',
            'Using "Quick question" so it feels informal',
            'Writing "Update" followed by the project code only',
            'Keeping it vague so the reader opens the whole thread',
          ],
        },
      ],
    },
    {
      id: 'quiz-writing-p2',
      skillId: 'skill-writing',
      phaseId: 'phase-writing-2',
      quizType: 'phase',
      title: 'Phase 2 Check — Evidence & Action Owners',
      description: 'Confirm how to pair claims with metrics and clear owners.',
      passPercent: 70,
      questions: [
        {
          id: 'q-w2-1',
          position: 1,
          prompt: 'Which action item is written cleanly enough to execute without follow-up meetings?',
          options: [
            'Someone should look into onboarding emails soon.',
            'Priya — Publish revised onboarding checklist in Notion by Thu 16:00.',
            'Onboarding checklist improvements are in progress.',
            'Discuss checklist ideas next week.',
          ],
        },
        {
          id: 'q-w2-2',
          position: 2,
          prompt: 'Why should status updates pair percentages with baseline counts?',
          options: [
            'To make the email longer',
            'Because a 50% rise from 2 to 3 behaves very differently from 200 to 300',
            'Percentages are never allowed in executive updates',
            'Baselines replace the need for dates',
          ],
        },
      ],
    },
    {
      id: 'quiz-writing-check',
      skillId: 'skill-writing',
      phaseId: null,
      quizType: 'skill_check',
      title: 'Skill Check — Structured Business Writing',
      description: 'Pass at 70% or above to upgrade Structured Business Writing to Demonstrated.',
      passPercent: 70,
      questions: [
        {
          id: 'q-wc-1',
          position: 1,
          prompt: 'A stakeholder needs to approve a vendor switch today. Which opening sentence follows BLUF?',
          options: [
            'Over the past six months we surveyed four vendors across regional offices.',
            'Approve switching our print vendor to CivicPress by 17:00 today to save £1,400/month.',
            'Attached please find several spreadsheets regarding vendor pricing.',
            'Vendor management has always been an important pillar of operations.',
          ],
        },
        {
          id: 'q-wc-2',
          position: 2,
          prompt: 'When summarizing risk in an operational brief, what belongs next to each risk?',
          options: [
            'A decorative status badge with no owner',
            'Likelihood/impact and the concrete mitigation owner',
            'Only technical acronyms used by engineering',
            'A disclaimer stating risks cannot be predicted',
          ],
        },
        {
          id: 'q-wc-3',
          position: 3,
          prompt: 'Which phrasing is active, verifiable, and unambiguous?',
          options: [
            'Significant improvements were made to response times recently.',
            'Support cut median first-response time from 18 hours to 4 hours in October.',
            'Response times have been positively impacted across the board.',
            'The team worked very hard to respond faster.',
          ],
        },
      ],
    },
    {
      id: 'quiz-speaking-p1',
      skillId: 'skill-speaking',
      phaseId: 'phase-speaking-1',
      quizType: 'phase',
      title: 'Phase 1 Check — Briefing Narrative & Delivery',
      description: 'Assess your understanding of structured spoken briefings.',
      passPercent: 70,
      questions: [
        {
          id: 'q-sp-1',
          position: 1,
          prompt: 'What is the strongest way to open a 5-minute stakeholder briefing?',
          options: [
            'Read the agenda slide word for word for 60 seconds',
            'State the core problem, who it affects, and the decision you are asking for',
            'Apologize for not having enough time to prepare',
            'Walk through every row of a raw spreadsheet first',
          ],
        },
        {
          id: 'q-sp-2',
          position: 2,
          prompt: 'During Q&A, what should you do when you do not know an exact figure?',
          options: [
            'Estimate a confident number on the spot',
            'Acknowledge what you know, commit to verifying the figure, and give a follow-up time',
            'Change the subject to another slide',
            'Repeat the question loudly until the next person speaks',
          ],
        },
      ],
    },
    {
      id: 'quiz-speaking-check',
      skillId: 'skill-speaking',
      phaseId: null,
      quizType: 'skill_check',
      title: 'Skill Check — Public Speaking & Presentations',
      description: 'Pass at 70% or above to reach Demonstrated level.',
      passPercent: 70,
      questions: [
        {
          id: 'q-sc-1',
          position: 1,
          prompt: 'How much core information should each slide carry in an executive presentation?',
          options: [
            'As many paragraphs as fit at 10pt font',
            'One clear claim supported by one visual or concise evidence points',
            'Only decorative stock photos without titles',
            'Three unrelated charts per slide',
          ],
        },
        {
          id: 'q-sc-2',
          position: 2,
          prompt: 'Why is a 1–2 second silent pause effective right after delivering a key metric?',
          options: [
            'It fills time so you finish closer to the limit',
            'It gives listeners time to process the figure and signals composure',
            'It replaces the need for visual aids',
            'It prevents anyone from asking questions',
          ],
        },
      ],
    },
    {
      id: 'quiz-analytics-p1',
      skillId: 'skill-analytics',
      phaseId: 'phase-analytics-1',
      quizType: 'phase',
      title: 'Phase 1 Check — Outcome Metrics & Telemetry',
      description: 'Check your ability to distinguish vanity counts from decision metrics.',
      passPercent: 70,
      questions: [
        {
          id: 'q-an-1',
          position: 1,
          prompt: 'Which metric best measures whether a self-service help portal actually solves user problems?',
          options: [
            'Total homepage impressions',
            'Task completion rate without follow-up support ticket within 48h',
            'Total number of words published',
            'Average mouse cursor distance',
          ],
        },
        {
          id: 'q-an-2',
          position: 2,
          prompt: 'Why is the 75th percentile (p75) often preferred over the mean for page-load latency?',
          options: [
            'Mean values can hide slow tail experiences experienced by a quarter of users',
            'Percentiles ignore all fast users',
            'Mean values cannot be calculated on integers',
            'p75 always produces a smaller number than p50',
          ],
        },
      ],
    },
    {
      id: 'quiz-analytics-check',
      skillId: 'skill-analytics',
      phaseId: null,
      quizType: 'skill_check',
      title: 'Skill Check — Digital Analytics & Measurement',
      description: 'Pass at 70% or above to reach Demonstrated level.',
      passPercent: 70,
      questions: [
        {
          id: 'q-ac-1',
          position: 1,
          prompt: 'In a measurement plan, what connects an organizational goal to raw tracking events?',
          options: [
            'A specific KPI, segment definition, and decision threshold',
            'A list of CSS class names',
            'The server IP address',
            'An unlabelled pie chart',
          ],
        },
        {
          id: 'q-ac-2',
          position: 2,
          prompt: 'If signups doubled after a campaign while 7-day activation stayed flat, what happened?',
          options: [
            'Acquisition volume increased, but newly acquired users are not reaching core value',
            'Product retention doubled automatically',
            'Tracking must be broken in all browsers',
            'Activation is not related to onboarding',
          ],
        },
      ],
    },
    {
      id: 'quiz-a11y-p1',
      skillId: 'skill-a11y',
      phaseId: 'phase-a11y-1',
      quizType: 'phase',
      title: 'Phase 1 Check — Semantics & Keyboard Access',
      description: 'Verify core HTML accessibility and WCAG AA principles.',
      passPercent: 70,
      questions: [
        {
          id: 'q-a1-1',
          position: 1,
          prompt: 'Which element should you use for an in-page action like "Submit Evidence"?',
          options: [
            'A clickable <div> with an onclick handler',
            'A native <button type="submit"> element',
            'A <span> styled to look like a button',
            'An <img> tag with title text',
          ],
        },
        {
          id: 'q-a1-2',
          position: 2,
          prompt: 'What is the minimum WCAG 2.2 AA contrast ratio for normal body text?',
          options: ['2.0:1', '3.0:1', '4.5:1', '7.0:1'],
        },
      ],
    },
    {
      id: 'quiz-a11y-check',
      skillId: 'skill-a11y',
      phaseId: null,
      quizType: 'skill_check',
      title: 'Skill Check — Web Accessibility Fundamentals',
      description: 'Pass at 70% or above to reach Demonstrated level.',
      passPercent: 70,
      questions: [
        {
          id: 'q-ac1-1',
          position: 1,
          prompt: 'Why should error states never rely on red border color alone?',
          options: [
            'Color-blind or screen-reader users need explicit error text and programmatic association',
            'CSS borders cannot use hex colors',
            'Red borders slow down browser layout',
            'Users prefer guessing which field failed',
          ],
        },
        {
          id: 'q-ac1-2',
          position: 2,
          prompt: 'What happens when CSS removes outline: none on :focus-visible without a replacement?',
          options: [
            'Keyboard-only users lose track of which control currently has focus',
            'Screen readers skip all headings',
            'Touch targets automatically enlarge',
            'Contrast increases to 7:1',
          ],
        },
      ],
    },
  ];

  // Server-equivalent private answer key (never returned in getQuizForLearner)
  const privateQuizAnswers = {
    'q-w1-1': { correctIndex: 0, explanation: 'BLUF places the recommendation or decision upfront so busy readers grasp the point in seconds.' },
    'q-w1-2': { correctIndex: 1, explanation: 'Concrete numbers ("4 days", "14 May") and active verbs replace empty filler.' },
    'q-w1-3': { correctIndex: 0, explanation: 'Naming the topic, required decision, and deadline enables rapid triage.' },
    'q-w2-1': { correctIndex: 1, explanation: 'Effective action items state a single owner, concrete deliverable, and deadline.' },
    'q-w2-2': { correctIndex: 1, explanation: 'Baselines prevent small-sample percentages from distorting operational decisions.' },
    'q-wc-1': { correctIndex: 1, explanation: 'Leading with the decision, deadline, and quantified impact is textbook BLUF.' },
    'q-wc-2': { correctIndex: 1, explanation: 'Decision-makers need risk severity paired with who owns the mitigation.' },
    'q-wc-3': { correctIndex: 1, explanation: 'Metrics with before/after baselines and timeframes are immediately verifiable.' },
    'q-sp-1': { correctIndex: 1, explanation: 'Opening with the problem, impact, and ask hooks attention immediately.' },
    'q-sp-2': { correctIndex: 1, explanation: 'Honesty plus a concrete follow-up commitment builds credibility.' },
    'q-sc-1': { correctIndex: 1, explanation: 'One claim per slide keeps spoken narration and visual reading aligned.' },
    'q-sc-2': { correctIndex: 1, explanation: 'Strategic pauses give listeners room to absorb key numbers.' },
    'q-an-1': { correctIndex: 1, explanation: 'Task completion without repeat tickets measures genuine problem resolution.' },
    'q-an-2': { correctIndex: 0, explanation: 'p75 captures tail latency experienced by slower devices and networks.' },
    'q-ac-1': { correctIndex: 0, explanation: 'KPIs, segments, and thresholds translate goals into actionable measurement.' },
    'q-ac-2': { correctIndex: 0, explanation: 'Rising top-of-funnel signups with flat activation points to an onboarding gap.' },
    'q-a1-1': { correctIndex: 1, explanation: 'Native <button> elements provide built-in keyboard, focus, and semantics.' },
    'q-a1-2': { correctIndex: 2, explanation: 'WCAG AA requires at least 4.5:1 contrast for normal body text.' },
    'q-ac1-1': { correctIndex: 0, explanation: 'Pairing color with explicit text and icons makes errors perceivable to everyone.' },
    'q-ac1-2': { correctIndex: 0, explanation: 'Visible focus indicators are essential for keyboard navigation.' },
  };

  const challenges = [
    {
      id: 'chal-writing',
      skillId: 'skill-writing',
      title: 'Executive Operations Brief (1-Page BLUF Memo)',
      brief:
        'Draft a 300–450 word memo recommending a process change for a real or realistic team workflow (e.g. onboarding checklist, customer response triage, or weekly reporting). Open with a BLUF recommendation, include at least two quantified baseline metrics, list one key risk with mitigation, and close with an owner/deadline action table.',
      deliverableHint: 'Share a link to a Google Doc, Notion page, GitHub Gist, or upload a PDF/Markdown file.',
      rubric: [
        { id: 'r-w-1', label: 'BLUF Opening & Clarity', description: 'Recommendation and decision deadline are clear in the first 3 lines.', maxPoints: 5 },
        { id: 'r-w-2', label: 'Quantified Evidence', description: 'Includes specific baseline metrics and realistic expected impact.', maxPoints: 5 },
        { id: 'r-w-3', label: 'Risk & Mitigation', description: 'Identifies a credible trade-off or risk with a concrete mitigation.', maxPoints: 5 },
        { id: 'r-w-4', label: 'Actionable Next Steps', description: 'Ends with named owners, deliverables, and dates.', maxPoints: 5 },
      ],
    },
    {
      id: 'chal-speaking',
      skillId: 'skill-speaking',
      title: '5-Minute Recorded Stakeholder Briefing',
      brief:
        'Record a 3–5 minute video or audio briefing (or slide deck with speaker script) proposing a practical improvement to a service or project. Include a 30-second problem-impact hook, 3 core evidence slides/points, and a clear final ask.',
      deliverableHint: 'Provide an unlisted video/audio URL, slide link, or upload your speaker deck/script.',
      rubric: [
        { id: 'r-s-1', label: 'Opening Hook', description: 'Frames problem, audience impact, and purpose within 30 seconds.', maxPoints: 5 },
        { id: 'r-s-2', label: 'Narrative Structure', description: 'One clear claim per section with logical transitions.', maxPoints: 5 },
        { id: 'r-s-3', label: 'Pacing & Clarity', description: 'Steady pace, deliberate pauses, minimal filler.', maxPoints: 5 },
        { id: 'r-s-4', label: 'Closing Ask', description: 'Ends with a concrete decision or next step.', maxPoints: 5 },
      ],
    },
    {
      id: 'chal-analytics',
      skillId: 'skill-analytics',
      title: '1-Page Product Measurement Plan',
      brief:
        'Design a measurement specification for a web service or community program. Define 1 primary outcome KPI, 3 supporting funnel events, user segments, and 1 decision rule explaining what action you will take if the metric drops.',
      deliverableHint: 'Link a spreadsheet/doc or upload a CSV/PDF measurement table.',
      rubric: [
        { id: 'r-an-1', label: 'Outcome vs Vanity KPI', description: 'Primary KPI measures user value rather than raw clicks.', maxPoints: 5 },
        { id: 'r-an-2', label: 'Event Taxonomy', description: 'Events have clear triggers, properties, and denominators.', maxPoints: 5 },
        { id: 'r-an-3', label: 'Segmentation', description: 'Breaks down cohorts meaningfully to avoid average bias.', maxPoints: 5 },
        { id: 'r-an-4', label: 'Decision Thresholds', description: 'Defines clear action triggers when metrics move.', maxPoints: 5 },
      ],
    },
    {
      id: 'chal-a11y',
      skillId: 'skill-a11y',
      title: 'WCAG 2.2 AA Site Audit & Remediation Log',
      brief:
        'Audit any public website or web app using keyboard-only navigation, heading inspection, and contrast checks. Document at least 4 concrete findings with WCAG criteria references and specific HTML/CSS fixes.',
      deliverableHint: 'Link your audit report/GitHub issue or upload your remediation log.',
      rubric: [
        { id: 'r-a1-1', label: 'Keyboard & Focus Audit', description: 'Tests tab order, focus visibility, and trap avoidance.', maxPoints: 5 },
        { id: 'r-a1-2', label: 'Semantics & Forms', description: 'Checks landmarks, headings, button semantics, and labels.', maxPoints: 5 },
        { id: 'r-a1-3', label: 'Contrast & Error Clarity', description: 'Verifies 4.5:1 contrast and non-hue-only error messages.', maxPoints: 5 },
        { id: 'r-a1-4', label: 'Actionable Fixes', description: 'Provides accurate HTML/CSS remediation snippets.', maxPoints: 5 },
      ],
    },
  ];

  const opportunities = [
    {
      id: 'opp-1',
      title: 'Junior Operations & Communications Associate',
      organization: 'Northbridge Civic Works',
      opportunityType: 'Junior Role',
      workMode: 'Hybrid',
      location: 'London, UK',
      summary:
        'Draft weekly stakeholder briefings, maintain public project trackers, and coordinate service delivery updates across three municipal teams.',
      aboutRole:
        'Northbridge Civic Works partners with local authorities to modernize public service operations. As a Junior Operations & Communications Associate, you will turn complex operational metrics into clear, scannable weekly memos and help programme leads track service milestones.',
      responsibilities: [
        'Write concise weekly BLUF briefing memos summarizing service throughput, blockers, and next owners.',
        'Maintain core product and service KPI trackers alongside programme analysts.',
        'Coordinate 5-minute verbal status readouts with cross-functional delivery teams.',
        'Document standard operating procedures in plain language for new team members.',
      ],
      requirements: [
        'Demonstrated structured business writing with real memo or executive brief samples.',
        'Practising fluency in digital analytics and outcome-focused KPI measurement.',
        'Comfort presenting structured updates and answering stakeholder questions concisely.',
        'Strong attention to deadlines, action ownership, and baseline accuracy.',
      ],
      requiredSkills: [
        { slug: 'structured-business-writing', neededLevel: 'practising' },
        { slug: 'digital-analytics-measurement', neededLevel: 'practising' },
        { slug: 'public-speaking-presentations', neededLevel: 'practising' },
      ],
      requiredSkillSlugs: ['structured-business-writing', 'digital-analytics-measurement', 'public-speaking-presentations'],
      otherInfo: {
        compensation: '£28,500 – £31,000 / year (Sample band)',
        duration: 'Full-time · Permanent',
        schedule: '3 days on-site (London), 2 days remote',
        deadline: 'Rolling cohort review · Closes in 21 days',
      },
      orgTips: {
        aboutOrg:
          'Northbridge Civic Works values plain-language clarity over buzzwords. Their operations team runs asynchronous Friday readouts using strict 1-page BLUF memos.',
        howToApply:
          'Include a link to one 1-page structured brief or memo alongside your CV. Explain the baseline metric and concrete outcome in your cover note.',
        tips: [
          'Open your cover note with a 3-sentence BLUF summary of why you fit the role.',
          'Quantify at least one workflow improvement you have documented or measured.',
          'Mention how you handle follow-up questions when exact data is still pending.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/northbridge-ops',
    },
    {
      id: 'opp-2',
      title: 'Digital Service Accessibility Intern',
      organization: 'Harbourline Public Lab',
      opportunityType: 'Internship',
      workMode: 'Remote',
      location: 'Remote (UK / EU)',
      summary:
        'Partner with product designers to run keyboard and screen-reader audits across citizen portals and document clear remediation fixes.',
      aboutRole:
        'Harbourline Public Lab builds accessible digital forms and public-benefit tools. During this 12-week internship, you will pair directly with frontend engineers and content designers to audit live pages against WCAG 2.2 AA standards.',
      responsibilities: [
        'Run structured keyboard navigation, focus visibility, and semantic landmark audits.',
        'Log reproducible accessibility defects with clear HTML/CSS remediation snippets.',
        'Review form error messaging to ensure failures never rely on color alone.',
        'Summarize weekly audit findings in concise stakeholder briefs.',
      ],
      requirements: [
        'Practising or higher skill level in Web Accessibility Fundamentals.',
        'Clear technical writing ability to document issues for engineering teams.',
        'Familiarity with semantic HTML elements, heading order, and contrast ratios.',
      ],
      requiredSkills: [
        { slug: 'web-accessibility-fundamentals', neededLevel: 'practising' },
        { slug: 'structured-business-writing', neededLevel: 'practising' },
      ],
      requiredSkillSlugs: ['web-accessibility-fundamentals', 'structured-business-writing'],
      otherInfo: {
        compensation: '£1,850 / month paid internship',
        duration: '12 weeks (extendable)',
        schedule: 'Remote · Core hours 10:00–15:00 GMT',
        deadline: 'Applications reviewed weekly',
      },
      orgTips: {
        aboutOrg:
          'Harbourline publishes open accessibility statements for every product release and prioritizes native HTML semantics over heavy custom widgets.',
        howToApply:
          'Submit your WCAG 2.2 AA audit log or a short breakdown of 3 accessibility fixes you spotted on a public site.',
        tips: [
          'Demonstrate that you tested with keyboard-only Tab/Shift+Tab navigation.',
          'Reference exact WCAG success criteria (e.g. 1.4.3 Contrast, 2.4.7 Focus Visible).',
          'Keep your defect tickets actionable with before/after HTML examples.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/harbourline-a11y',
    },
    {
      id: 'opp-3',
      title: 'Product Analytics Apprentice',
      organization: 'Brightwell Learning Trust',
      opportunityType: 'Apprenticeship',
      workMode: 'Remote',
      location: 'Remote',
      summary:
        'Build weekly learning engagement reports, clean event taxonomies, and present insight summaries to programme leads.',
      aboutRole:
        'Brightwell Learning Trust supports adult upskilling cohorts across community colleges. As Product Analytics Apprentice, you will help curriculum leads understand where learners thrive or stall and communicate insights clearly.',
      responsibilities: [
        'Define clean conversion and activation events aligned with learner outcomes.',
        'Monitor percentile latency and funnel drop-off across mobile and desktop cohorts.',
        'Deliver a 5-minute spoken insight readout during Monday programme reviews.',
        'Maintain a 1-page measurement specification for new learning modules.',
      ],
      requirements: [
        'Practising foundation in Digital Analytics & Measurement.',
        'Ability to separate vanity pageviews from meaningful outcome KPIs.',
        'Clear written and spoken communication for non-technical educators.',
      ],
      requiredSkills: [
        { slug: 'digital-analytics-measurement', neededLevel: 'practising' },
        { slug: 'public-speaking-presentations', neededLevel: 'practising' },
        { slug: 'structured-business-writing', neededLevel: 'practising' },
      ],
      requiredSkillSlugs: ['digital-analytics-measurement', 'public-speaking-presentations', 'structured-business-writing'],
      otherInfo: {
        compensation: '£24,000 / year + mentorship budget',
        duration: '12-month structured apprenticeship',
        schedule: 'Full-time · Remote with quarterly team offsites',
        deadline: 'Next intake opens next month',
      },
      orgTips: {
        aboutOrg:
          'Brightwell pairs apprentices with a senior analyst and an educator mentor, emphasizing ethical measurement and clear denominator reporting.',
        howToApply:
          'Attach your 1-page measurement plan showing a primary KPI, funnel events, and a concrete decision threshold.',
        tips: [
          'Always show baseline counts alongside percentages in your examples.',
          'Highlight one case where segmentation revealed a pattern hidden by overall averages.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/brightwell-analytics',
    },
    {
      id: 'opp-4',
      title: 'Community Outreach & Briefing Fellow',
      organization: 'Civic Grid Initiative',
      opportunityType: 'Fellowship',
      workMode: 'On-site',
      location: 'Manchester, UK',
      summary:
        'Lead monthly town-hall briefings, synthesize community feedback into structured memos, and coordinate local partner workshops.',
      aboutRole:
        'Civic Grid Initiative connects neighbourhood associations with city infrastructure planners. Fellows facilitate public listening sessions and translate resident priorities into crisp briefing papers.',
      responsibilities: [
        'Deliver engaging 5-minute project briefings at monthly neighbourhood forums.',
        'Facilitate structured Q&A sessions with residents and municipal partners.',
        'Synthesize workshop notes into 1-page BLUF decision memos.',
      ],
      requirements: [
        'Confident public speaking and structured slide/briefing delivery.',
        'Strong structured writing skills for summarizing multi-stakeholder feedback.',
      ],
      requiredSkills: [
        { slug: 'public-speaking-presentations', neededLevel: 'practising' },
        { slug: 'structured-business-writing', neededLevel: 'practising' },
      ],
      requiredSkillSlugs: ['public-speaking-presentations', 'structured-business-writing'],
      otherInfo: {
        compensation: '£2,100 / month fellowship stipend',
        duration: '6 months',
        schedule: 'On-site in Manchester · Occasional evening forums',
        deadline: 'Open until filled',
      },
      orgTips: {
        aboutOrg:
          'Civic Grid values calm, empathetic facilitators who can bridge community concerns and technical constraints.',
        howToApply:
          'Include a link to a 3–5 minute recorded briefing or speaker deck alongside a brief written summary.',
        tips: [
          'Demonstrate a 30-second problem-impact opening hook.',
          'Show how you close briefings with concrete owners and timelines.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/civic-grid-fellow',
    },
    {
      id: 'opp-5',
      title: 'Content & Web Standards Coordinator',
      organization: 'OpenCouncil Digital',
      opportunityType: 'Project',
      workMode: 'Remote',
      location: 'Remote',
      summary:
        'Review public guidance pages for plain-language clarity and WCAG 2.2 AA compliance ahead of a regional portal launch.',
      aboutRole:
        'OpenCouncil Digital helps regional councils publish plain-language citizen guides. In this fixed-scope project role, you will audit 40 guidance pages for readability, accessibility, and analytics instrumentation.',
      responsibilities: [
        'Rewrite dense policy paragraphs into plain-language, scannable action steps.',
        'Verify heading hierarchy, link clarity, and WCAG AA color contrast.',
        'Define task-completion events to track whether guidance resolves user queries.',
      ],
      requirements: [
        'Proven structured writing and plain-language editing skills.',
        'Working knowledge of web accessibility checks and basic analytics tracking.',
      ],
      requiredSkills: [
        { slug: 'structured-business-writing', neededLevel: 'practising' },
        { slug: 'web-accessibility-fundamentals', neededLevel: 'practising' },
        { slug: 'digital-analytics-measurement', neededLevel: 'practising' },
      ],
      requiredSkillSlugs: ['structured-business-writing', 'web-accessibility-fundamentals', 'digital-analytics-measurement'],
      otherInfo: {
        compensation: '£3,200 fixed project contract',
        duration: '8 weeks · Part-time flexible',
        schedule: 'Async remote with Tuesday check-ins',
        deadline: 'Closes in 14 days',
      },
      orgTips: {
        aboutOrg:
          'OpenCouncil is a small distributed team of civic writers and web engineers who measure success by reduced citizen support calls.',
        howToApply:
          'Share a before/after writing sample or a short accessibility review of any public council page.',
        tips: [
          'Keep your application under 300 words using headings and bullet points.',
          'Link your verified Kord challenge work if available.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/opencouncil-standards',
    },
    {
      id: 'opp-6',
      title: 'Service Design & User Research Intern',
      organization: 'Southbank Digital Studio',
      opportunityType: 'Internship',
      workMode: 'Hybrid',
      location: 'Bristol, UK',
      summary:
        'Assist user researchers with interview note synthesis, accessibility spot checks, and stakeholder readout decks.',
      aboutRole:
        'Southbank Digital Studio designs healthcare and civic booking experiences. You will support senior researchers during usability sessions, run quick accessibility checks, and present clear findings.',
      responsibilities: [
        'Observe usability sessions and tag findings by severity and user impact.',
        'Conduct preliminary WCAG keyboard and label checks on prototypes.',
        'Help prepare concise 5-minute research readout decks.',
      ],
      requirements: [
        'Web accessibility fundamentals and clear presentation skills.',
        'Interest in structured stakeholder discovery interviews.',
      ],
      requiredSkills: [
        { slug: 'web-accessibility-fundamentals', neededLevel: 'practising' },
        { slug: 'public-speaking-presentations', neededLevel: 'practising' },
        { slug: 'stakeholder-discovery-interviews', neededLevel: 'declared' },
      ],
      requiredSkillSlugs: ['web-accessibility-fundamentals', 'public-speaking-presentations', 'stakeholder-discovery-interviews'],
      otherInfo: {
        compensation: '£1,900 / month paid internship',
        duration: '10 weeks',
        schedule: '2 days in Bristol studio, 3 days remote',
        deadline: 'Autumn cohort open',
      },
      orgTips: {
        aboutOrg:
          'Southbank emphasizes inclusive research with assistive-technology users and crisp visual synthesis.',
        howToApply:
          'Share your best presentation or accessibility audit artifact and mention one service flow you would simplify.',
        tips: [
          'Highlight collaborative note-taking and neutral observation skills.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/southbank-research',
    },
  ];

  // Initial demo progress for Maya Lin
  const enrollments = [
    {
      id: 'enr-1',
      userId: 'user-learner-maya',
      skillId: 'skill-writing',
      status: 'active',
      enrolledAt: daysAgo(14),
      updatedAt: daysAgo(2),
    },
    {
      id: 'enr-2',
      userId: 'user-learner-maya',
      skillId: 'skill-analytics',
      status: 'active',
      enrolledAt: daysAgo(7),
      updatedAt: daysAgo(1),
    },
  ];

  const activityProgress = [
    {
      id: 'ap-1',
      userId: 'user-learner-maya',
      activityId: 'act-writing-1',
      notes: 'Cut passive constructions in our weekly volunteer update; word count dropped 28%.',
      completed: true,
      minutesSpent: 25,
      completedAt: daysAgo(11, 9),
      updatedAt: daysAgo(11, 9),
    },
    {
      id: 'ap-2',
      userId: 'user-learner-maya',
      activityId: 'act-writing-2',
      notes: 'Drafted BLUF opening template for Friday ops sync.',
      completed: true,
      minutesSpent: 30,
      completedAt: daysAgo(8, 14),
      updatedAt: daysAgo(8, 14),
    },
    {
      id: 'ap-3',
      userId: 'user-learner-maya',
      activityId: 'act-analytics-1',
      notes: 'Mapped signup -> first completed activity -> quiz pass funnel.',
      completed: true,
      minutesSpent: 35,
      completedAt: daysAgo(3, 18),
      updatedAt: daysAgo(3, 18),
    },
  ];

  const quizAttempts = [
    {
      id: 'qa-1',
      userId: 'user-learner-maya',
      quizId: 'quiz-writing-p1',
      answers: { 'q-w1-1': 0, 'q-w1-2': 1, 'q-w1-3': 0 },
      score: 3,
      total: 3,
      percentage: 100,
      passed: true,
      idempotencyKey: 'seed-qa-1',
      createdAt: daysAgo(6, 11),
    },
    {
      id: 'qa-2',
      userId: 'user-learner-maya',
      quizId: 'quiz-analytics-p1',
      answers: { 'q-an-1': 1, 'q-an-2': 0 },
      score: 2,
      total: 2,
      percentage: 100,
      passed: true,
      idempotencyKey: 'seed-qa-2',
      createdAt: daysAgo(2, 10),
    },
  ];

  const submissions = [
    {
      id: 'sub-approved-1',
      userId: 'user-learner-maya',
      challengeId: 'chal-writing',
      evidenceUrl: 'https://docs.example.org/maya-bluf-onboarding-memo',
      filePath: null,
      fileName: null,
      explanation:
        'Approved 400-word BLUF memo streamlining volunteer intake with baseline metrics and owner table.',
      status: 'approved',
      rubricScores: { 'r-w-1': 5, 'r-w-2': 4, 'r-w-3': 4, 'r-w-4': 5 },
      rubricTotal: 18,
      rubricMax: 20,
      feedback: 'Clear BLUF framing, accurate baseline figures, and strong owner table.',
      reviewedBy: 'user-admin-ethoppa',
      reviewedAt: daysAgo(4, 15),
      idempotencyKey: 'seed-sub-approved-1',
      createdAt: daysAgo(5, 16),
    },
    {
      id: 'sub-pending-1',
      userId: 'user-learner-maya',
      challengeId: 'chal-writing',
      evidenceUrl: 'https://docs.example.org/maya-bluf-volunteer-brief',
      filePath: 'user-learner-maya/chal-writing/volunteer-triage-memo.pdf',
      fileName: 'volunteer-triage-memo.pdf',
      explanation:
        'I wrote a 380-word BLUF memo proposing a two-step triage inbox for our local community clinic. It includes baseline response-time metrics (18h down to 4h), one staffing risk with rota mitigation, and a 3-row action owner table.',
      status: 'pending',
      rubricScores: {},
      rubricTotal: null,
      rubricMax: 20,
      feedback: '',
      reviewedBy: null,
      reviewedAt: null,
      idempotencyKey: 'seed-sub-pending-1',
      createdAt: daysAgo(1, 16),
    },
    {
      id: 'sub-pending-2',
      userId: 'user-learner-maya',
      challengeId: 'chal-analytics',
      evidenceUrl: 'https://sheets.example.org/maya-portal-measurement-plan',
      filePath: null,
      fileName: null,
      explanation:
        'Measurement plan for a municipal housing guidance portal. Tracks resolved-without-call rate as the primary KPI alongside 3 funnel steps and segmented mobile vs desktop thresholds.',
      status: 'pending',
      rubricScores: {},
      rubricTotal: null,
      rubricMax: 20,
      feedback: '',
      reviewedBy: null,
      reviewedAt: null,
      idempotencyKey: 'seed-sub-pending-2',
      createdAt: daysAgo(2, 13),
    },
  ];

  const userSkills = [
    {
      id: 'us-1',
      userId: 'user-learner-maya',
      skillId: 'skill-writing',
      level: 'verified',
      updatedAt: daysAgo(4),
    },
    {
      id: 'us-2',
      userId: 'user-learner-maya',
      skillId: 'skill-analytics',
      level: 'practising',
      updatedAt: daysAgo(2),
    },
  ];

  return {
    users,
    currentUserId: null,
    skills,
    quizzes,
    privateQuizAnswers,
    challenges,
    opportunities,
    enrollments,
    activityProgress,
    quizAttempts,
    submissions,
    userSkills,
    sampleHistoryInjected: false,
  };
}
