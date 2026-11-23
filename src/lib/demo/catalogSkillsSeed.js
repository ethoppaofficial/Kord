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
      { id: 'skill-effective-communication', title: 'Effective Communication', level: 'Beginner', summary: 'Structure clear spoken and written messages tailored to colleagues, clients, and decision-makers.', supportedByCourseSlug: 'effective-communication-foundations' },
      { id: 'skill-public-speaking', title: 'Public Speaking', level: 'Intermediate', summary: 'Design persuasive talks, manage delivery pacing, and engage audiences with confidence.', supportedByCourseSlug: 'communication-and-public-speaking' },
      { id: 'skill-business-communication', title: 'Business Communication', level: 'Beginner', summary: 'Write executive updates, meeting briefs, and stakeholder summaries built around clear decisions.', supportedByCourseSlug: 'business-communication-essentials' },
      { title: 'Professional Communication', level: 'Beginner', summary: 'Maintain calm, respectful, and productive communication across workplace channels.', supportedByCourseSlug: 'professional-workplace-communication' },
      { title: 'Negotiation Skills', level: 'Intermediate', summary: 'Prepare interests, anchors, and trade-offs to reach durable win-win agreements.', supportedByCourseSlug: 'negotiation-skills-deal-craft' },
      { title: 'Persuasion and Influence', level: 'Intermediate', summary: 'Frame evidence, stories, and audience priorities to earn ethical buy-in.', supportedByCourseSlug: 'ethical-persuasion-stakeholder-influence' },
      { title: 'Active Listening', level: 'Beginner', summary: 'Ask clarifying questions, reflect back key meaning, and uncover unspoken constraints.', supportedByCourseSlug: 'active-listening-diagnostic-inquiry' },
      { title: 'Conflict Resolution', level: 'Intermediate', summary: 'De-escalate workplace tension and guide disagreeing stakeholders toward concrete next steps.', supportedByCourseSlug: 'workplace-conflict-resolution-mediation' },
      { title: 'Emotional Intelligence', level: 'Beginner', summary: 'Recognize emotional cues, regulate responses under pressure, and strengthen team trust.', supportedByCourseSlug: 'emotional-intelligence-in-teams' },
      { title: 'Leadership and Teamwork', level: 'Intermediate', summary: 'Align team goals, delegate clearly, and foster accountable collaboration.', supportedByCourseSlug: 'collaborative-leadership-teamwork' },
      { title: 'Critical Thinking', level: 'Intermediate', summary: 'Test assumptions, evaluate evidence quality, and spot logical blind spots.', supportedByCourseSlug: 'structured-critical-thinking-reasoning' },
      { title: 'Problem-Solving', level: 'Beginner', summary: 'Break ambiguous problems into root causes, testable options, and action plans.', supportedByCourseSlug: 'root-cause-problem-solving' },
      { title: 'Presentation Skills', level: 'Beginner', summary: 'Pair clear slide structure with concise visual storytelling for live and remote rooms.', supportedByCourseSlug: 'slide-visual-presentation-skills' },
      { title: 'Networking and Relationship Building', level: 'Beginner', summary: 'Build authentic professional relationships through thoughtful outreach and consistent follow-through.', supportedByCourseSlug: 'authentic-networking-relationship-building' },
    ],
  },
  {
    categoryId: 'cat-writing',
    items: [
      { title: 'General Writing', level: 'Beginner', summary: 'Write clear, grammatically sound prose with strong paragraph unity and flow.', supportedByCourseSlug: 'general-writing-foundations' },
      { title: 'Professional Writing', level: 'Beginner', summary: 'Draft polished memos, proposals, and client-facing workplace documents.', supportedByCourseSlug: 'professional-writing-essentials' },
      { id: 'skill-business-writing', title: 'Business Writing', level: 'Beginner', summary: 'Use Bottom Line Up Front (BLUF) structure so busy readers grasp decisions fast.', supportedByCourseSlug: 'business-writing-bluf-mastery' },
      { id: 'skill-creative-writing', title: 'Creative Writing', level: 'Beginner', summary: 'Craft vivid scenes, memorable characters, compelling dialogue, and cohesive narratives.', supportedByCourseSlug: 'creative-writing-foundations' },
      { title: 'Storytelling', level: 'Beginner', summary: 'Shape human tension, stakes, and resolution for fiction, brand, and leadership contexts.', supportedByCourseSlug: 'storytelling-narrative-craft' },
      { title: 'Copywriting', level: 'Intermediate', summary: 'Write conversion-focused headlines, landing pages, product descriptions, and ad copy.', supportedByCourseSlug: 'copywriting-conversion-craft' },
      { title: 'Technical Writing', level: 'Intermediate', summary: 'Document APIs, workflows, and user guides with precision and scannable examples.', supportedByCourseSlug: 'technical-writing-documentation' },
      { title: 'Academic Writing', level: 'Intermediate', summary: 'Develop evidence-backed arguments, literature syntheses, and structured citations.', supportedByCourseSlug: 'academic-writing-evidence-synthesis' },
      { title: 'Report Writing', level: 'Beginner', summary: 'Turn findings and operational data into concise analytical and executive reports.', supportedByCourseSlug: 'report-writing-analytical-briefs' },
      { title: 'Email Writing', level: 'Beginner', summary: 'Write action-oriented emails that resolve tough client or team situations clearly.', supportedByCourseSlug: 'email-writing-workplace-outcomes' },
      { title: 'Blogging', level: 'Beginner', summary: 'Plan, outline, and publish engaging long-form educational and editorial blog posts.', supportedByCourseSlug: 'blogging-editorial-publishing' },
      { title: 'Scriptwriting', level: 'Intermediate', summary: 'Format visual scenes, dialogue beats, and pacing for video and audio scripts.', supportedByCourseSlug: 'scriptwriting-audio-video' },
      { title: 'Content Strategy', level: 'Intermediate', summary: 'Align editorial themes, audience pain points, and distribution channels with measurable goals.', supportedByCourseSlug: 'content-strategy-editorial-systems' },
      { title: 'Editing and Proofreading', level: 'Beginner', summary: 'Cut clutter, tighten rhythm, verify facts, and polish drafts for publication.', supportedByCourseSlug: 'editing-proofreading-standards' },
      { title: 'SEO Writing', level: 'Intermediate', summary: 'Structure search-intent articles that answer reader questions cleanly without keyword stuffing.', supportedByCourseSlug: 'seo-writing-search-intent' },
    ],
  },
  {
    categoryId: 'cat-business',
    items: [
      { id: 'skill-entrepreneurship', title: 'Entrepreneurship', level: 'Beginner', summary: 'Validate real customer pain, design viable business models, and launch lean ventures.', supportedByCourseSlug: 'entrepreneurship-foundations' },
      { title: 'Business Development', level: 'Intermediate', summary: 'Identify partnership pipelines, qualify prospects, and structure growth deals.', supportedByCourseSlug: 'business-development-partnerships' },
      { title: 'Business Planning', level: 'Intermediate', summary: 'Build realistic operating plans, revenue assumptions, milestones, and risk mitigations.', supportedByCourseSlug: 'business-planning-operating-models' },
      { title: 'Startup Fundamentals', level: 'Beginner', summary: 'Run customer discovery interviews, craft MVPs, and measure early traction.', supportedByCourseSlug: 'startup-fundamentals-mvp-traction' },
      { title: 'Business Model Development', level: 'Intermediate', summary: 'Map value propositions, unit economics, revenue streams, and cost structures.', supportedByCourseSlug: 'business-model-development-economics' },
      { title: 'Market Research', level: 'Beginner', summary: 'Design customer surveys, analyze competitors, and size addressable market segments.', supportedByCourseSlug: 'market-research-customer-validation' },
      { title: 'Financial Literacy', level: 'Beginner', summary: 'Read cash-flow statements, margins, break-even points, and basic budgets.', supportedByCourseSlug: 'financial-literacy-cashflow-margins' },
      { title: 'Small Business Management', level: 'Intermediate', summary: 'Coordinate daily operations, inventory, vendor workflows, and team accountability.', supportedByCourseSlug: 'small-business-management-operations' },
      { title: 'Sales Fundamentals', level: 'Beginner', summary: 'Run consultative discovery calls, handle objections, and close ethical deals.', supportedByCourseSlug: 'sales-fundamentals-consultative-closing' },
      { title: 'Customer Relationship Management', level: 'Beginner', summary: 'Track customer interactions, retention milestones, and support follow-ups systematically.', supportedByCourseSlug: 'customer-relationship-management-retention' },
      { title: 'Branding', level: 'Intermediate', summary: 'Define brand positioning, voice, promise, and recognizable customer experiences.', supportedByCourseSlug: 'branding-positioning-identity' },
      { title: 'Product Management', level: 'Intermediate', summary: 'Prioritize user problems, write clear specs, and coordinate cross-functional launches.', supportedByCourseSlug: 'product-management-specs-launches' },
      { id: 'skill-project-management', title: 'Project Management', level: 'Beginner', summary: 'Scope deliverables, manage timelines and risks, and guide projects to completion.', supportedByCourseSlug: 'project-management-delivery' },
      { title: 'Strategic Thinking', level: 'Advanced', summary: 'Evaluate trade-offs, competitive moats, and multi-quarter resource allocation.', supportedByCourseSlug: 'strategic-thinking-decision-making' },
      { title: 'Business Negotiation', level: 'Intermediate', summary: 'Structure vendor contracts, pricing terms, and partnership agreements.', supportedByCourseSlug: 'business-negotiation-dealmaking' },
    ],
  },
  {
    categoryId: 'cat-marketing',
    items: [
      { title: 'Digital Marketing Fundamentals', level: 'Beginner', summary: 'Connect acquisition channels, landing experiences, and funnel metrics into cohesive campaigns.', supportedByCourseSlug: 'digital-marketing-foundations' },
      { id: 'skill-social-media-management', title: 'Social Media Management', level: 'Beginner', summary: 'Plan 30-day content calendars, grow engaged communities, and report channel performance.', supportedByCourseSlug: 'social-media-community-growth' },
      { title: 'Facebook Page Management', level: 'Beginner', summary: 'Optimize Facebook business pages, publishing cadences, Meta Business Suite, and inbox workflows.', supportedByCourseSlug: 'social-media-community-growth' },
      { id: 'skill-facebook-instagram-ads', title: 'Facebook and Instagram Advertising', level: 'Intermediate', summary: 'Plan, launch, retarget, and optimize Meta ad campaigns from beginner foundations to analytics.', supportedByCourseSlug: 'paid-social-meta-ads-mastery' },
      { title: 'Meta Ads Campaign Management', level: 'Advanced', summary: 'Scale multi-ad-set Meta campaigns, creative testing matrices, and pixel/CAPI attribution.', supportedByCourseSlug: 'paid-social-meta-ads-mastery' },
      { title: 'Google Ads', level: 'Intermediate', summary: 'Structure search intent ad groups, keyword match types, extensions, and ROAS bidding.', supportedByCourseSlug: 'search-marketing-google-ads-sem' },
      { title: 'Search Engine Optimization', level: 'Intermediate', summary: 'Improve technical crawlability, on-page structure, and topical authority.', supportedByCourseSlug: 'search-marketing-google-ads-sem' },
      { title: 'Search Engine Marketing', level: 'Intermediate', summary: 'Coordinate paid search and organic visibility to lower blended acquisition cost.', supportedByCourseSlug: 'search-marketing-google-ads-sem' },
      { title: 'Email Marketing', level: 'Beginner', summary: 'Design segmented lifecycle sequences, subject lines, and deliverability hygiene.', supportedByCourseSlug: 'email-content-lead-generation' },
      { title: 'Influencer Marketing', level: 'Intermediate', summary: 'Vet creator partners, write clear campaign briefs, and measure referral ROI.', supportedByCourseSlug: 'email-content-lead-generation' },
      { title: 'Content Marketing', level: 'Beginner', summary: 'Create educational assets that attract, nurture, and convert target buyers.', supportedByCourseSlug: 'email-content-lead-generation' },
      { title: 'Marketing Analytics', level: 'Intermediate', summary: 'Track UTM attribution, funnel drop-off, CAC, LTV, and channel lift accurately.', supportedByCourseSlug: 'marketing-analytics-cro-strategy' },
      { title: 'Community Management', level: 'Beginner', summary: 'Moderate member spaces, spark meaningful discussions, and turn members into advocates.', supportedByCourseSlug: 'social-media-community-growth' },
      { title: 'Lead Generation', level: 'Beginner', summary: 'Build lead magnets, capture forms, and qualification workflows that feed sales.', supportedByCourseSlug: 'email-content-lead-generation' },
      { title: 'Conversion Rate Optimization', level: 'Advanced', summary: 'Run hypothesis-driven A/B tests on landing pages, copy, and checkout flows.', supportedByCourseSlug: 'marketing-analytics-cro-strategy' },
      { title: 'Marketing Strategy', level: 'Advanced', summary: 'Allocate budget, channel mix, and positioning across product lifecycle stages.', supportedByCourseSlug: 'marketing-analytics-cro-strategy' },
      { title: 'Personal Branding', level: 'Beginner', summary: 'Articulate your niche expertise consistently through portfolio work and public writing.', supportedByCourseSlug: 'social-media-community-growth' },
    ],
  },
  {
    categoryId: 'cat-creative',
    items: [
      { id: 'skill-graphic-design', title: 'Graphic Design', level: 'Beginner', summary: 'Apply visual hierarchy, typography, grid alignment, and color contrast to real deliverables.', supportedByCourseSlug: 'graphic-design-foundations' },
      { title: 'Canva Design', level: 'Beginner', summary: 'Create consistent social carousels, flyers, and brand kits cleanly in Canva.', supportedByCourseSlug: 'canva-and-brand-identity-design' },
      { id: 'skill-ui-ux-design', title: 'UI/UX Design', level: 'Intermediate', summary: 'Design user flows, wireframes, accessible components, and usability test plans.', supportedByCourseSlug: 'ui-ux-digital-product-design' },
      { title: 'Visual Communication', level: 'Beginner', summary: 'Translate complex concepts into clear diagrams, infographics, and layouts.', supportedByCourseSlug: 'ui-ux-digital-product-design' },
      { title: 'Photography', level: 'Beginner', summary: 'Master exposure, framing, natural lighting, and clean subject storytelling.', supportedByCourseSlug: 'photography-video-motion-production' },
      { title: 'Video Editing', level: 'Beginner', summary: 'Cut tight pacing, balance audio levels, add captions, and export crisp sequences.', supportedByCourseSlug: 'photography-video-motion-production' },
      { title: 'Motion Graphics', level: 'Intermediate', summary: 'Animate typography, UI transitions, and visual callouts with clean timing curves.', supportedByCourseSlug: 'photography-video-motion-production' },
      { title: 'Brand Identity Design', level: 'Intermediate', summary: 'Develop cohesive logos, color systems, typographic rules, and brand guidelines.', supportedByCourseSlug: 'canva-and-brand-identity-design' },
      { title: 'Creative Thinking', level: 'Beginner', summary: 'Use structured ideation, constraints, and lateral thinking to generate original concepts.', supportedByCourseSlug: 'ui-ux-digital-product-design' },
      { title: 'Art Direction', level: 'Advanced', summary: 'Lead visual mood, shoot briefs, and multi-channel creative consistency.', supportedByCourseSlug: 'canva-and-brand-identity-design' },
    ],
  },
  {
    categoryId: 'cat-tech',
    items: [
      { id: 'skill-web-development', title: 'Web Development', level: 'Beginner', summary: 'Build semantic, accessible HTML/CSS layouts and modular interactive JavaScript web apps.', supportedByCourseSlug: 'web-development-and-git' },
      { title: 'Frontend Development', level: 'Intermediate', summary: 'Architect responsive component interfaces, state flows, and fast browser experiences.', supportedByCourseSlug: 'frontend-development-foundations' },
      { title: 'Backend Development', level: 'Intermediate', summary: 'Design REST/RPC APIs, authentication, validation, and reliable server workflows.', supportedByCourseSlug: 'backend-databases-full-stack' },
      { title: 'Full-Stack Development', level: 'Advanced', summary: 'Integrate frontend UIs, server APIs, relational databases, and automated deployments.', supportedByCourseSlug: 'backend-databases-full-stack' },
      { title: 'Mobile App Development', level: 'Intermediate', summary: 'Build responsive touch-first mobile screens, offline storage, and native device workflows.', supportedByCourseSlug: 'mobile-apps-and-software-testing' },
      { title: 'Database Management', level: 'Intermediate', summary: 'Model relational schemas, write performant SQL queries, indexes, and access policies.', supportedByCourseSlug: 'backend-databases-full-stack' },
      { title: 'Cybersecurity', level: 'Intermediate', summary: 'Identify OWASP vulnerabilities, harden auth boundaries, and protect user data.', supportedByCourseSlug: 'cloud-devops-and-cybersecurity' },
      { id: 'skill-data-analysis', title: 'Data Analysis', level: 'Beginner', summary: 'Clean messy datasets, write analytical queries, and surface clear decision insights.', supportedByCourseSlug: 'data-analysis-ai-machine-learning' },
      { title: 'Artificial Intelligence', level: 'Intermediate', summary: 'Evaluate AI capabilities, prompt reliability, and ethical human-in-the-loop workflows.', supportedByCourseSlug: 'data-analysis-ai-machine-learning' },
      { title: 'Machine Learning', level: 'Advanced', summary: 'Prepare features, train supervised models, and validate generalization metrics.', supportedByCourseSlug: 'data-analysis-ai-machine-learning' },
      { title: 'Cloud Computing', level: 'Intermediate', summary: 'Configure managed compute, storage buckets, environment secrets, and scaling.', supportedByCourseSlug: 'cloud-devops-and-cybersecurity' },
      { title: 'Software Testing', level: 'Beginner', summary: 'Write deterministic unit, integration, and end-to-end regression checks.', supportedByCourseSlug: 'mobile-apps-and-software-testing' },
      { title: 'Version Control', level: 'Beginner', summary: 'Use Git branching, pull requests, and clean commit history on collaborative teams.', supportedByCourseSlug: 'web-development-and-git' },
      { title: 'DevOps', level: 'Advanced', summary: 'Automate CI/CD build pipelines, environment monitoring, and zero-downtime releases.', supportedByCourseSlug: 'cloud-devops-and-cybersecurity' },
      { title: 'Technical Support', level: 'Beginner', summary: 'Triage user incidents, reproduce issues methodically, and write clear resolutions.', supportedByCourseSlug: 'cloud-devops-and-cybersecurity' },
      { title: 'Digital Productivity Tools', level: 'Beginner', summary: 'Organize shared docs, spreadsheets, task boards, and collaborative team calendars.', supportedByCourseSlug: 'web-development-and-git' },
    ],
  },
  {
    categoryId: 'cat-career',
    items: [
      { id: 'skill-cv-resume-writing', title: 'CV and Resume Writing', level: 'Beginner', summary: 'Frame measurable achievements, clear formatting, and role-tailored summaries.', supportedByCourseSlug: 'cv-interviews-and-portfolio' },
      { id: 'skill-interview-preparation', title: 'Interview Preparation', level: 'Beginner', summary: 'Practice structured STAR stories, portfolio walkthroughs, and thoughtful questions.', supportedByCourseSlug: 'cv-interviews-and-portfolio' },
      { title: 'Career Development', level: 'Beginner', summary: 'Map target roles, skill gaps, and quarterly milestones toward sustained growth.', supportedByCourseSlug: 'cv-interviews-and-portfolio' },
      { title: 'Freelancing', level: 'Beginner', summary: 'Scope client proposals, price fixed vs. milestone projects, and deliver reliably.', supportedByCourseSlug: 'freelancing-clients-and-personal-finance' },
      { title: 'Remote Work Skills', level: 'Beginner', summary: 'Communicate asynchronously, document decisions, and protect deep focus blocks.', supportedByCourseSlug: 'remote-work-time-and-productivity' },
      { title: 'Workplace Professionalism', level: 'Beginner', summary: 'Own deadlines, communicate blockers early, and handle constructive feedback well.', supportedByCourseSlug: 'remote-work-time-and-productivity' },
      { title: 'Time Management', level: 'Beginner', summary: 'Prioritize high-impact work, batch shallow tasks, and plan realistic weekly schedules.', supportedByCourseSlug: 'remote-work-time-and-productivity' },
      { title: 'Productivity', level: 'Beginner', summary: 'Build repeatable personal systems that turn daily effort into finished outcomes.', supportedByCourseSlug: 'remote-work-time-and-productivity' },
      { title: 'Personal Finance', level: 'Beginner', summary: 'Track cash flow, build emergency buffers, and budget variable income responsibly.', supportedByCourseSlug: 'freelancing-clients-and-personal-finance' },
      { title: 'Professional Networking', level: 'Beginner', summary: 'Reach out warmly to mentors and peers with specific, respectful asks.', supportedByCourseSlug: 'freelancing-clients-and-personal-finance' },
      { title: 'Portfolio Development', level: 'Beginner', summary: 'Curate real case studies showing problem context, your process, and verified outcomes.', supportedByCourseSlug: 'cv-interviews-and-portfolio' },
      { title: 'Client Management', level: 'Intermediate', summary: 'Set clear expectations, manage scope changes calmly, and run crisp status reviews.', supportedByCourseSlug: 'freelancing-clients-and-personal-finance' },
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
