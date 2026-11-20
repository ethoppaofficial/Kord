import { DEFAULT_CATEGORIES } from '../constants.js';
import { slugify } from '../formatters.js';

function makeSkill({ id, title, categoryId, categoryName, level = 'Beginner', summary, outcomes, expectations, prerequisites = [], supportedByCourseSlug = null }) {
  return {
    id: id || `skill-${slugify(title)}`,
    categoryId,
    slug: slugify(title),
    title,
    category: categoryName,
    level,
    summary,
    competencyExpectations:
      expectations || `Demonstrate applied understanding and produce portfolio-grade deliverables for ${title}.`,
    prerequisites,
    supportedByCourseSlug,
    publicationStatus: 'published',
    roadmapStatus: 'full',
    estHours: level === 'Advanced' ? 24 : level === 'Intermediate' ? 14 : 8,
    outcomes: outcomes || [
      `Explain core frameworks and standards in ${title}`,
      `Apply ${title} workflows to realistic briefs and deliverables`,
      `Evaluate output quality against structured review rubrics`,
    ],
  };
}

const CATEGORY_MAP = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c.name]));

const SKILL_GROUPS = [
  {
    categoryId: 'cat-communication',
    items: [
      { id: 'skill-effective-communication', title: 'Effective Communication', level: 'Beginner', summary: 'Structure clear spoken and written messages tailored to colleagues, clients, and decision-makers.' },
      { id: 'skill-public-speaking', title: 'Public Speaking', level: 'Intermediate', summary: 'Design persuasive talks, manage delivery pacing, and engage audiences with confidence.' },
      { id: 'skill-business-communication', title: 'Business Communication', level: 'Beginner', summary: 'Write executive updates, meeting briefs, and stakeholder summaries built around clear decisions.', supportedByCourseSlug: 'communication-and-public-speaking' },
      { title: 'Professional Communication', level: 'Beginner', summary: 'Maintain calm, respectful, and productive communication across workplace channels.', supportedByCourseSlug: 'communication-and-public-speaking' },
      { title: 'Negotiation Skills', level: 'Intermediate', summary: 'Prepare interests, anchors, and trade-offs to reach durable win-win agreements.' },
      { title: 'Persuasion and Influence', level: 'Intermediate', summary: 'Frame evidence, stories, and audience priorities to earn ethical buy-in.' },
      { title: 'Active Listening', level: 'Beginner', summary: 'Ask clarifying questions, reflect back key meaning, and uncover unspoken constraints.' },
      { title: 'Conflict Resolution', level: 'Intermediate', summary: 'De-escalate workplace tension and guide disagreeing stakeholders toward concrete next steps.', supportedByCourseSlug: 'communication-and-public-speaking' },
      { title: 'Emotional Intelligence', level: 'Beginner', summary: 'Recognize emotional cues, regulate responses under pressure, and strengthen team trust.' },
      { title: 'Leadership and Teamwork', level: 'Intermediate', summary: 'Align team goals, delegate clearly, and foster accountable collaboration.' },
      { title: 'Critical Thinking', level: 'Intermediate', summary: 'Test assumptions, evaluate evidence quality, and spot logical blind spots.' },
      { title: 'Problem-Solving', level: 'Beginner', summary: 'Break ambiguous problems into root causes, testable options, and action plans.' },
      { title: 'Presentation Skills', level: 'Beginner', summary: 'Pair clear slide structure with concise visual storytelling for live and remote rooms.' },
      { title: 'Networking and Relationship Building', level: 'Beginner', summary: 'Build authentic professional relationships through thoughtful outreach and consistent follow-through.', supportedByCourseSlug: 'communication-and-public-speaking' },
    ],
  },
  {
    categoryId: 'cat-writing',
    items: [
      { title: 'General Writing', level: 'Beginner', summary: 'Write clear, grammatically sound prose with strong paragraph unity and flow.' },
      { title: 'Professional Writing', level: 'Beginner', summary: 'Draft polished memos, proposals, and client-facing workplace documents.' },
      { id: 'skill-business-writing', title: 'Business Writing', level: 'Beginner', summary: 'Use Bottom Line Up Front (BLUF) structure so busy readers grasp decisions fast.' },
      { id: 'skill-creative-writing', title: 'Creative Writing', level: 'Beginner', summary: 'Craft vivid scenes, memorable characters, compelling dialogue, and cohesive narratives.' },
      { title: 'Storytelling', level: 'Beginner', summary: 'Shape human tension, stakes, and resolution for fiction, brand, and leadership contexts.' },
      { title: 'Copywriting', level: 'Intermediate', summary: 'Write conversion-focused headlines, landing pages, product descriptions, and ad copy.' },
      { title: 'Technical Writing', level: 'Intermediate', summary: 'Document APIs, workflows, and user guides with precision and scannable examples.' },
      { title: 'Academic Writing', level: 'Intermediate', summary: 'Develop evidence-backed arguments, literature syntheses, and structured citations.' },
      { title: 'Report Writing', level: 'Beginner', summary: 'Turn findings and operational data into concise analytical and executive reports.' },
      { title: 'Email Writing', level: 'Beginner', summary: 'Write action-oriented emails that resolve tough client or team situations clearly.' },
      { title: 'Blogging', level: 'Beginner', summary: 'Plan, outline, and publish engaging long-form educational and editorial blog posts.' },
      { title: 'Scriptwriting', level: 'Intermediate', summary: 'Format visual scenes, dialogue beats, and pacing for video and audio scripts.' },
      { title: 'Content Strategy', level: 'Intermediate', summary: 'Align editorial themes, audience pain points, and distribution channels with measurable goals.' },
      { title: 'Editing and Proofreading', level: 'Beginner', summary: 'Cut clutter, tighten rhythm, verify facts, and polish drafts for publication.' },
      { title: 'SEO Writing', level: 'Intermediate', summary: 'Structure search-intent articles that answer reader questions cleanly without keyword stuffing.' },
    ],
  },
  {
    categoryId: 'cat-business',
    items: [
      { id: 'skill-entrepreneurship', title: 'Entrepreneurship', level: 'Beginner', summary: 'Validate real customer pain, design viable business models, and launch lean ventures.' },
      { title: 'Business Development', level: 'Intermediate', summary: 'Identify partnership pipelines, qualify prospects, and structure growth deals.' },
      { title: 'Business Planning', level: 'Intermediate', summary: 'Build realistic operating plans, revenue assumptions, milestones, and risk mitigations.' },
      { title: 'Startup Fundamentals', level: 'Beginner', summary: 'Run customer discovery interviews, craft MVPs, and measure early traction.' },
      { title: 'Business Model Development', level: 'Intermediate', summary: 'Map value propositions, unit economics, revenue streams, and cost structures.' },
      { title: 'Market Research', level: 'Beginner', summary: 'Design customer surveys, analyze competitors, and size addressable market segments.' },
      { title: 'Financial Literacy', level: 'Beginner', summary: 'Read cash-flow statements, margins, break-even points, and basic budgets.' },
      { title: 'Small Business Management', level: 'Intermediate', summary: 'Coordinate daily operations, inventory, vendor workflows, and team accountability.' },
      { title: 'Sales Fundamentals', level: 'Beginner', summary: 'Run consultative discovery calls, handle objections, and close ethical deals.' },
      { title: 'Customer Relationship Management', level: 'Beginner', summary: 'Track customer interactions, retention milestones, and support follow-ups systematically.' },
      { title: 'Branding', level: 'Intermediate', summary: 'Define brand positioning, voice, promise, and recognizable customer experiences.' },
      { title: 'Product Management', level: 'Intermediate', summary: 'Prioritize user problems, write clear specs, and coordinate cross-functional launches.' },
      { id: 'skill-project-management', title: 'Project Management', level: 'Beginner', summary: 'Scope deliverables, manage timelines and risks, and guide projects to completion.' },
      { title: 'Strategic Thinking', level: 'Advanced', summary: 'Evaluate trade-offs, competitive moats, and multi-quarter resource allocation.' },
      { title: 'Business Negotiation', level: 'Intermediate', summary: 'Structure vendor contracts, pricing terms, and partnership agreements.' },
    ],
  },
  {
    categoryId: 'cat-marketing',
    items: [
      { title: 'Digital Marketing Fundamentals', level: 'Beginner', summary: 'Connect acquisition channels, landing experiences, and funnel metrics into cohesive campaigns.' },
      { id: 'skill-social-media-management', title: 'Social Media Management', level: 'Beginner', summary: 'Plan 30-day content calendars, grow engaged communities, and report channel performance.' },
      { title: 'Facebook Page Management', level: 'Beginner', summary: 'Optimize Facebook business pages, publishing cadences, Meta Business Suite, and inbox workflows.', supportedByCourseSlug: 'digital-marketing-foundations' },
      { id: 'skill-facebook-instagram-ads', title: 'Facebook and Instagram Advertising', level: 'Intermediate', summary: 'Plan, launch, retarget, and optimize Meta ad campaigns from beginner foundations to analytics.', supportedByCourseSlug: 'digital-marketing-foundations' },
      { title: 'Meta Ads Campaign Management', level: 'Advanced', summary: 'Scale multi-ad-set Meta campaigns, creative testing matrices, and pixel/CAPI attribution.' },
      { title: 'Google Ads', level: 'Intermediate', summary: 'Structure search intent ad groups, keyword match types, extensions, and ROAS bidding.' },
      { title: 'Search Engine Optimization', level: 'Intermediate', summary: 'Improve technical crawlability, on-page structure, and topical authority.', supportedByCourseSlug: 'digital-marketing-foundations' },
      { title: 'Search Engine Marketing', level: 'Intermediate', summary: 'Coordinate paid search and organic visibility to lower blended acquisition cost.', supportedByCourseSlug: 'digital-marketing-foundations' },
      { title: 'Email Marketing', level: 'Beginner', summary: 'Design segmented lifecycle sequences, subject lines, and deliverability hygiene.', supportedByCourseSlug: 'digital-marketing-foundations' },
      { title: 'Influencer Marketing', level: 'Intermediate', summary: 'Vet creator partners, write clear campaign briefs, and measure referral ROI.' },
      { title: 'Content Marketing', level: 'Beginner', summary: 'Create educational assets that attract, nurture, and convert target buyers.' },
      { title: 'Marketing Analytics', level: 'Intermediate', summary: 'Track UTM attribution, funnel drop-off, CAC, LTV, and channel lift accurately.' },
      { title: 'Community Management', level: 'Beginner', summary: 'Moderate member spaces, spark meaningful discussions, and turn members into advocates.' },
      { title: 'Lead Generation', level: 'Beginner', summary: 'Build lead magnets, capture forms, and qualification workflows that feed sales.', supportedByCourseSlug: 'digital-marketing-foundations' },
      { title: 'Conversion Rate Optimization', level: 'Advanced', summary: 'Run hypothesis-driven A/B tests on landing pages, copy, and checkout flows.' },
      { title: 'Marketing Strategy', level: 'Advanced', summary: 'Allocate budget, channel mix, and positioning across product lifecycle stages.' },
      { title: 'Personal Branding', level: 'Beginner', summary: 'Articulate your niche expertise consistently through portfolio work and public writing.', supportedByCourseSlug: 'communication-and-public-speaking' },
    ],
  },
  {
    categoryId: 'cat-creative',
    items: [
      { id: 'skill-graphic-design', title: 'Graphic Design', level: 'Beginner', summary: 'Apply visual hierarchy, typography, grid alignment, and color contrast to real deliverables.' },
      { title: 'Canva Design', level: 'Beginner', summary: 'Create consistent social carousels, flyers, and brand kits cleanly in Canva.' },
      { id: 'skill-ui-ux-design', title: 'UI/UX Design', level: 'Intermediate', summary: 'Design user flows, wireframes, accessible components, and usability test plans.', supportedByCourseSlug: 'graphic-design-foundations' },
      { title: 'Visual Communication', level: 'Beginner', summary: 'Translate complex concepts into clear diagrams, infographics, and layouts.' },
      { title: 'Photography', level: 'Beginner', summary: 'Master exposure, framing, natural lighting, and clean subject storytelling.' },
      { title: 'Video Editing', level: 'Beginner', summary: 'Cut tight pacing, balance audio levels, add captions, and export crisp sequences.' },
      { title: 'Motion Graphics', level: 'Intermediate', summary: 'Animate typography, UI transitions, and visual callouts with clean timing curves.' },
      { title: 'Brand Identity Design', level: 'Intermediate', summary: 'Develop cohesive logos, color systems, typographic rules, and brand guidelines.' },
      { title: 'Creative Thinking', level: 'Beginner', summary: 'Use structured ideation, constraints, and lateral thinking to generate original concepts.' },
      { title: 'Art Direction', level: 'Advanced', summary: 'Lead visual mood, shoot briefs, and multi-channel creative consistency.' },
    ],
  },
  {
    categoryId: 'cat-tech',
    items: [
      { id: 'skill-web-development', title: 'Web Development', level: 'Beginner', summary: 'Build semantic, accessible HTML/CSS layouts and modular interactive JavaScript web apps.' },
      { title: 'Frontend Development', level: 'Intermediate', summary: 'Architect responsive component interfaces, state flows, and fast browser experiences.' },
      { title: 'Backend Development', level: 'Intermediate', summary: 'Design REST/RPC APIs, authentication, validation, and reliable server workflows.' },
      { title: 'Full-Stack Development', level: 'Advanced', summary: 'Integrate frontend UIs, server APIs, relational databases, and automated deployments.', supportedByCourseSlug: 'frontend-development-foundations' },
      { title: 'Mobile App Development', level: 'Intermediate', summary: 'Build responsive touch-first mobile screens, offline storage, and native device workflows.' },
      { title: 'Database Management', level: 'Intermediate', summary: 'Model relational schemas, write performant SQL queries, indexes, and access policies.' },
      { title: 'Cybersecurity', level: 'Intermediate', summary: 'Identify OWASP vulnerabilities, harden auth boundaries, and protect user data.' },
      { id: 'skill-data-analysis', title: 'Data Analysis', level: 'Beginner', summary: 'Clean messy datasets, write analytical queries, and surface clear decision insights.' },
      { title: 'Artificial Intelligence', level: 'Intermediate', summary: 'Evaluate AI capabilities, prompt reliability, and ethical human-in-the-loop workflows.' },
      { title: 'Machine Learning', level: 'Advanced', summary: 'Prepare features, train supervised models, and validate generalization metrics.' },
      { title: 'Cloud Computing', level: 'Intermediate', summary: 'Configure managed compute, storage buckets, environment secrets, and scaling.' },
      { title: 'Software Testing', level: 'Beginner', summary: 'Write deterministic unit, integration, and end-to-end regression checks.' },
      { title: 'Version Control', level: 'Beginner', summary: 'Use Git branching, pull requests, and clean commit history on collaborative teams.' },
      { title: 'DevOps', level: 'Advanced', summary: 'Automate CI/CD build pipelines, environment monitoring, and zero-downtime releases.' },
      { title: 'Technical Support', level: 'Beginner', summary: 'Triage user incidents, reproduce issues methodically, and write clear resolutions.' },
      { title: 'Digital Productivity Tools', level: 'Beginner', summary: 'Organize shared docs, spreadsheets, task boards, and collaborative team calendars.' },
    ],
  },
  {
    categoryId: 'cat-career',
    items: [
      { id: 'skill-cv-resume-writing', title: 'CV and Resume Writing', level: 'Beginner', summary: 'Frame measurable achievements, clear formatting, and role-tailored summaries.' },
      { id: 'skill-interview-preparation', title: 'Interview Preparation', level: 'Beginner', summary: 'Practice structured STAR stories, portfolio walkthroughs, and thoughtful questions.' },
      { title: 'Career Development', level: 'Beginner', summary: 'Map target roles, skill gaps, and quarterly milestones toward sustained growth.' },
      { title: 'Freelancing', level: 'Beginner', summary: 'Scope client proposals, price fixed vs. milestone projects, and deliver reliably.' },
      { title: 'Remote Work Skills', level: 'Beginner', summary: 'Communicate asynchronously, document decisions, and protect deep focus blocks.' },
      { title: 'Workplace Professionalism', level: 'Beginner', summary: 'Own deadlines, communicate blockers early, and handle constructive feedback well.' },
      { title: 'Time Management', level: 'Beginner', summary: 'Prioritize high-impact work, batch shallow tasks, and plan realistic weekly schedules.' },
      { title: 'Productivity', level: 'Beginner', summary: 'Build repeatable personal systems that turn daily effort into finished outcomes.' },
      { title: 'Personal Finance', level: 'Beginner', summary: 'Track cash flow, build emergency buffers, and budget variable income responsibly.' },
      { title: 'Professional Networking', level: 'Beginner', summary: 'Reach out warmly to mentors and peers with specific, respectful asks.' },
      { title: 'Portfolio Development', level: 'Beginner', summary: 'Curate real case studies showing problem context, your process, and verified outcomes.' },
      { title: 'Client Management', level: 'Intermediate', summary: 'Set clear expectations, manage scope changes calmly, and run crisp status reviews.' },
    ],
  },
];

export function createCatalogSkills() {
  const out = [];
  SKILL_GROUPS.forEach((group) => {
    const categoryName = CATEGORY_MAP.get(group.categoryId) || 'General';
    group.items.forEach((item) => {
      out.push(
        makeSkill({
          ...item,
          categoryId: group.categoryId,
          categoryName,
        })
      );
    });
  });
  return out;
}
