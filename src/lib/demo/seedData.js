import { DEFAULT_CATEGORIES } from '../constants.js';
import { createCatalogSkills } from './catalogSkillsSeed.js';
import { createFlagshipCurriculumSeed } from './flagshipCoursesSeed.js';

export const CURRENT_SEED_VERSION = 8;

/** @returns {import('../../types/kord.d.ts').DemoState} */
export function createInitialSeed() {
  const now = Date.now();
  /**
   * @param {number} d
   * @param {number} [hour]
   */
  const daysAgo = (d, hour = 10) => {
    const dt = new Date(now - d * 86400000);
    dt.setHours(hour, 15, 0, 0);
    return dt.toISOString();
  };

  /** @type {import('../../types/kord.d.ts').KordUser[]} */
  const users = [
    {
      id: 'user-learner-maya',
      email: 'maya.lin@example.com',
      firstName: 'Maya',
      lastName: 'Lin',
      fullName: 'Maya Lin',
      role: 'learner',
      accountStatus: 'active',
      password: 'password123',
      createdAt: daysAgo(30),
    },
    {
      id: 'user-admin-demo',
      // Strictly local development/test Demo Mode fixture; never provisioned or honored in Supabase production
      email: 'demo.admin@kord.local',
      firstName: 'Demo',
      lastName: 'Admin',
      fullName: 'Demo Admin',
      role: 'admin',
      accountStatus: 'active',
      password: 'demo-local-preview',
      createdAt: daysAgo(60),
    },
  ];

  const categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  const skills = createCatalogSkills();
  const { courses, quizzes, privateQuizAnswers, challenges, courseVersions } = createFlagshipCurriculumSeed();

  const opportunities = [
    {
      id: 'opp-1',
      title: 'Paid Social & Meta Ads Coordinator',
      organization: 'Kestrel Consumer Studio',
      opportunityType: 'Junior Role',
      workMode: 'Hybrid',
      location: 'London, UK',
      summary:
        'Plan, build, and optimize Meta acquisition and retargeting campaigns while reporting weekly ROAS and creative fatigue diagnostics.',
      aboutRole:
        'Kestrel Consumer Studio manages growth campaigns for sustainable retail brands. As Paid Social & Meta Ads Coordinator, you will structure Meta ad accounts, draft multi-hook ad creatives, interpret pixel/CAPI signals, and present crisp optimization readouts.',
      responsibilities: [
        'Structure Campaign, Ad Set, and Ad tiers aligned with funnel conversion objectives.',
        'Monitor CTR, CPA, Frequency, and 7-day ROAS trends across active campaigns.',
        'Coordinate monthly social content calendars alongside brand designers.',
        'Draft weekly BLUF campaign performance memos for account leads.',
      ],
      requirements: [
        'Verified or demonstrated fluency in Facebook and Instagram Advertising.',
        'Hands-on planning experience in Social Media Management.',
        'Clear written business communication for client reporting.',
      ],
      requiredSkills: [
        { slug: 'facebook-and-instagram-advertising', neededLevel: 'practising' },
        { slug: 'social-media-management', neededLevel: 'practising' },
        { slug: 'business-writing', neededLevel: 'practising' },
      ],
      requiredSkillSlugs: [
        'facebook-and-instagram-advertising',
        'social-media-management',
        'business-writing',
      ],
      otherInfo: {
        compensation: '£29,000 – £33,000 / year',
        duration: 'Full-time · Permanent',
        schedule: '3 days studio (London), 2 days remote',
        deadline: 'Rolling cohort review',
      },
      orgTips: {
        aboutOrg:
          'Kestrel emphasizes transparent attribution, creative testing discipline, and clear client communication without vanity reporting.',
        howToApply:
          'Include a campaign blueprint or creative test plan alongside your CV and highlight any completed Kord ad analytics projects.',
        tips: [
          'Explain how you separate cold prospecting from warm retargeting audiences.',
          'Show how you diagnose high CPM vs. low landing-page conversion.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/kestrel-meta-ads',
    },
    {
      id: 'opp-2',
      title: 'Editorial & Creative Content Fellow',
      organization: 'Harbourline Storytelling Lab',
      opportunityType: 'Fellowship',
      workMode: 'Remote',
      location: 'Remote (UK / EU)',
      summary:
        'Craft compelling short fiction, brand essays, and narrative scripts while leading peer critique workshops.',
      aboutRole:
        'Harbourline Storytelling Lab publishes community-funded fiction anthologies and narrative audio documentaries. Fellows develop vivid scenes, sharpen dialogue subtext, and edit long-form manuscripts to publication standard.',
      responsibilities: [
        'Write and revise 1,500–2,500 word narrative pieces anchored in sensory scene work.',
        'Develop voice-consistent character dialogue and structural outlines.',
        'Collaborate with editorial leads during line-editing and copy-proofing passes.',
      ],
      requirements: [
        'Practising or higher mastery in Creative Writing.',
        'Strong command of narrative pacing, dialogue clarity, and structural editing.',
      ],
      requiredSkills: [
        { slug: 'creative-writing', neededLevel: 'practising' },
        { slug: 'effective-communication', neededLevel: 'practising' },
      ],
      requiredSkillSlugs: ['creative-writing', 'effective-communication'],
      otherInfo: {
        compensation: '£2,050 / month fellowship stipend',
        duration: '6 months',
        schedule: 'Remote · Async editorial sprints + Tuesday table reads',
        deadline: 'Applications reviewed weekly',
      },
      orgTips: {
        aboutOrg:
          'Harbourline values original voice, disciplined revision habits, and generous peer critique.',
        howToApply:
          'Submit a 600–1,200 word original scene or story draft demonstrating scene grounding and earned dialogue.',
        tips: [
          'Lead immediately with action and specific sensory detail rather than backstory exposition.',
          'Highlight one concrete structural revision you made between draft 1 and draft 2.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/harbourline-editorial',
    },
    {
      id: 'opp-3',
      title: 'Venture Operations & Strategy Intern',
      organization: 'Northbridge Impact Ventures',
      opportunityType: 'Internship',
      workMode: 'Hybrid',
      location: 'Manchester, UK',
      summary:
        'Support early-stage founders with customer discovery synthesis, unit-economics modeling, and investor update memos.',
      aboutRole:
        'Northbridge Impact Ventures backs seed-stage civic and climate startups. As Venture Operations Intern, you will help founders map problem interviews, test MVP hypotheses, and communicate clear milestones.',
      responsibilities: [
        'Synthesize founder customer discovery notes into actionable opportunity memos.',
        'Audit startup unit economics, break-even assumptions, and launch milestones.',
        'Coordinate pitch rehearsal briefings with portfolio teams.',
      ],
      requirements: [
        'Solid grounding in Entrepreneurship and lean validation workflows.',
        'Confident Effective Communication and concise Business Writing.',
      ],
      requiredSkills: [
        { slug: 'entrepreneurship', neededLevel: 'practising' },
        { slug: 'effective-communication', neededLevel: 'practising' },
        { slug: 'business-writing', neededLevel: 'practising' },
      ],
      requiredSkillSlugs: ['entrepreneurship', 'effective-communication', 'business-writing'],
      otherInfo: {
        compensation: '£1,950 / month paid internship',
        duration: '12 weeks (extendable)',
        schedule: '2 days Manchester hub, 3 days remote',
        deadline: 'Closes in 21 days',
      },
      orgTips: {
        aboutOrg:
          'Northbridge prefers evidence of real customer conversations over polished slide templates.',
        howToApply:
          'Attach a 1-page Venture Validation Canvas or startup brief alongside your tailored CV.',
        tips: [
          'Name the riskiest assumption in any business model and how you would test it cheaply.',
          'Quantify customer pain with specific frequency or cost estimates.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/northbridge-venture',
    },
    {
      id: 'opp-4',
      title: 'Junior Web & Visual Systems Developer',
      organization: 'OpenCouncil Digital Studio',
      opportunityType: 'Apprenticeship',
      workMode: 'Remote',
      location: 'Remote',
      summary:
        'Build accessible, responsive web interfaces and visual communication assets for public-benefit web services.',
      aboutRole:
        'OpenCouncil Digital Studio creates accessible web portals and community tools. You will build semantic HTML/CSS layouts, accessible interactive JavaScript modules, and crisp visual graphics.',
      responsibilities: [
        'Implement responsive grid layouts with WCAG AA contrast and keyboard focus order.',
        'Build modular vanilla JavaScript components with clean DOM state handling.',
        'Create campaign flyers, info cards, and UI assets using consistent typographic hierarchy.',
      ],
      requirements: [
        'Practising or higher skill level in Web Development.',
        'Working eye for visual hierarchy and layout in Graphic Design.',
        'Clear documentation and collaborative communication.',
      ],
      requiredSkills: [
        { slug: 'web-development', neededLevel: 'practising' },
        { slug: 'graphic-design', neededLevel: 'practising' },
        { slug: 'effective-communication', neededLevel: 'declared' },
      ],
      requiredSkillSlugs: ['web-development', 'graphic-design', 'effective-communication'],
      otherInfo: {
        compensation: '£25,500 / year + hardware budget',
        duration: '12-month apprenticeship',
        schedule: 'Full-time · Remote',
        deadline: 'Next intake open',
      },
      orgTips: {
        aboutOrg:
          'OpenCouncil prioritizes native browser standards, semantic HTML, and crisp design restraint over bloated frameworks.',
        howToApply:
          'Share a link to a live semantic web page or accessible UI audit plus your tailored resume.',
        tips: [
          'Test every interactive control using only Tab, Shift+Tab, and Enter before submitting.',
          'Explain your font-scale and contrast choices briefly.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/opencouncil-web',
    },
    {
      id: 'opp-5',
      title: 'Social Media & Brand Content Associate',
      organization: 'Civic Bloom Collective',
      opportunityType: 'Project',
      workMode: 'Remote',
      location: 'Remote',
      summary:
        'Design and schedule a 30-day multi-platform social campaign pairing cohesive graphics with measurable audience engagement.',
      aboutRole:
        'Civic Bloom Collective runs educational initiatives for independent creators and local makers. In this 10-week project, you will plan content pillars, produce visual assets, and measure save/share retention.',
      responsibilities: [
        'Produce a 30-day multi-platform content calendar with clear pillar ratios.',
        'Design clean social carousels and promotional flyers with accessible typography.',
        'Track weekly audience retention, saves, and referral click-throughs.',
      ],
      requirements: [
        'Proven capability in Social Media Management and Graphic Design.',
        'Concise written hooks and community reply etiquette.',
      ],
      requiredSkills: [
        { slug: 'social-media-management', neededLevel: 'practising' },
        { slug: 'graphic-design', neededLevel: 'practising' },
        { slug: 'cv-and-resume-writing', neededLevel: 'declared' },
      ],
      requiredSkillSlugs: ['social-media-management', 'graphic-design', 'cv-and-resume-writing'],
      otherInfo: {
        compensation: '£3,400 fixed project contract',
        duration: '10 weeks · Flexible part-time',
        schedule: 'Async remote with weekly editorial syncs',
        deadline: 'Closes in 14 days',
      },
      orgTips: {
        aboutOrg:
          'Civic Bloom focuses on practical, save-worthy educational posts instead of clickbait.',
        howToApply:
          'Include your 30-day social calendar or sample carousel graphic alongside a crisp 1-page CV.',
        tips: [
          'Highlight save-rate or share-rate growth over raw follower counts.',
          'Show 1 clear visual before/after hierarchy example.',
        ],
      },
      isSample: true,
      applyUrl: 'https://example.org/opportunities/civic-bloom-social',
    },
  ];

  return {
    seedVersion: CURRENT_SEED_VERSION,
    users,
    categories,
    skills,
    courses,
    courseVersions,
    quizzes,
    privateQuizAnswers,
    challenges,
    opportunities,
    userSkills: [],
    courseEnrollments: [],
    lessonProgress: [],
    quizAttempts: [],
    quizSessions: [],
    submissions: [],
    courseCompletions: [],
    adminAuditLogs: [],
    contentImports: [],
    // Keep legacy empty arrays so older references degrade safely if touched
    enrollments: [],
    activityProgress: [],
    syntheticHistory: [],
    sampleHistoryInjected: false,
  };
}
