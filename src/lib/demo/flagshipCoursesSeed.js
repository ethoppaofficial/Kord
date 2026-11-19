/**
 * Deep Multi-Course Pathways Seed across all 7 categories.
 * Demonstrates 1-to-many Skill -> Courses relationships, variable phase counts (3 to 6 phases),
 * self-contained JSON lesson blocks, validated YouTube video embeds, 10-format assessments,
 * and practical challenges with configurable rubrics.
 */

function yt(id, title, videoId, duration, description, viewingInstructions, transcript) {
  return {
    id,
    provider: 'youtube',
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
    title,
    duration,
    description,
    viewingInstructions,
    transcript,
    embedRestricted: false,
  };
}

function buildLesson({
  id,
  position,
  title,
  introduction,
  objectives,
  estMinutes = 25,
  blocks = [],
  videos = [],
  summary = '',
  takeaways = [],
  furtherReading = [],
  isRequired = true,
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

  // =========================================================================
  // 1. DIGITAL MARKETING: Facebook & Instagram Advertising (5 Progressive Courses)
  // =========================================================================
  const fbCourses = [
    {
      id: 'course-fb-1',
      skillId: 'skill-facebook-instagram-ads',
      slug: 'facebook-ads-fundamentals-beginner',
      title: 'Facebook Ads Fundamentals: Beginner',
      description: 'Understand Meta ad auction mechanics, Business Portfolio structure, campaign objectives, and compliant creative fundamentals.',
      difficulty: 'Beginner',
      estimatedDurationWeeks: 4,
      recommendedWeeklyHours: 4,
      recommendedSchedule: '2 lessons + 1 practical exercise per week',
      prerequisites: ['Basic familiarity with Facebook or Instagram business pages'],
      outcomes: [
        'Explain the 3-tier Meta Ads Manager hierarchy (Campaign, Ad Set, Ad)',
        'Choose the right campaign objective aligned with a real business goal',
        'Audit ad copy and creative against Meta advertising standards',
      ],
      phases: [
        {
          id: 'ph-fb1-1',
          position: 1,
          title: 'Phase 1: Foundations of Meta Advertising',
          summary: 'Learn how the Meta ad auction balances bid, estimated action rates, and ad quality.',
          difficulty: 'Beginner',
          estHours: 3.5,
          objectives: ['Distinguish organic posts from structured Ads Manager campaigns', 'Map Campaign, Ad Set, and Ad controls'],
          completionRequirements: ['Complete both foundation lessons', 'Pass the Phase 1 knowledge check'],
          lessons: [
            buildLesson({
              id: 'les-fb1-1',
              position: 1,
              title: 'How the Meta Ad Auction & Hierarchy Work',
              introduction: 'Boosting a post looks convenient, but real performance control happens inside Meta Ads Manager where Campaigns, Ad Sets, and Ads separate strategy from creative.',
              objectives: ['Identify what is controlled at Campaign, Ad Set, and Ad levels', 'Explain how Total Value determines auction winners'],
              estMinutes: 30,
              blocks: [
                { id: 'b1', type: 'heading', text: 'The Three-Level Campaign Architecture' },
                { id: 'b2', type: 'paragraph', text: 'Every structured Meta campaign consists of three nested layers. Separating objective selection from audience targeting and creative testing lets you isolate why a campaign succeeds or underperforms.' },
                {
                  id: 'b3',
                  type: 'table',
                  title: 'Campaign vs. Ad Set vs. Ad Responsibilities',
                  headers: ['Level', 'Primary Controls', 'Key Decision'],
                  rows: [
                    ['Campaign', 'Buying type & ODAX Objective', 'What business outcome do we want?'],
                    ['Ad Set', 'Audience, placements, budget, schedule', 'Who sees the ad and where?'],
                    ['Ad', 'Format, primary text, headline, media, CTA', 'What message earns the click?'],
                  ],
                },
                {
                  id: 'b4',
                  type: 'definition',
                  term: 'Outcome-Driven Ad Experiences (ODAX)',
                  meaning: 'Meta’s six core campaign objectives: Awareness, Traffic, Engagement, Leads, App Promotion, and Sales.',
                },
                {
                  id: 'b5',
                  type: 'callout',
                  title: 'Important note on Boosted Posts',
                  text: 'Never rely solely on the "Boost Post" button for conversion or lead campaigns. Boosted posts restrict placement optimization, pixel event choices, and multi-creative split testing.',
                },
                {
                  id: 'b6',
                  type: 'knowledge_check',
                  prompt: 'At which level do you configure audience geography and daily budget?',
                  options: ['Campaign level', 'Ad Set level', 'Ad level'],
                  correctIndex: 1,
                  explanation: 'Audience targeting, placements, schedule, and ad-set budget live at the Ad Set level (unless Advantage+ Campaign Budget is enabled for budget).',
                },
              ],
              videos: [
                yt(
                  'vid-fb1-1',
                  'Meta Ads Manager Structure Explained',
                  'M7lc1UVf-VE',
                  '10:15',
                  'Visual walkthrough of navigating Business Portfolio, Campaigns, Ad Sets, and Ads.',
                  'Watch the structure diagram first, then sketch a 1-campaign, 2-ad-set tree in your notes.',
                  'Key note: Keep campaign objectives aligned with the final action you want—Sales for purchases, Leads for form or message inquiries.'
                ),
              ],
              summary: 'Understanding Campaign vs. Ad Set vs. Ad prevents messy accounts and makes performance optimization clear.',
              takeaways: ['Campaigns set the objective', 'Ad Sets control targeting and delivery', 'Ads test creative and copy angles'],
              furtherReading: ['Meta Business Help Center: About the Ad Auction'],
            }),
            buildLesson({
              id: 'les-fb1-2',
              position: 2,
              title: 'Selecting Objectives & Policy-Safe Ad Copy',
              introduction: 'Choosing "Traffic" when you actually want purchases trains the algorithm to find cheap clickers rather than buyers.',
              objectives: ['Match business goals to ODAX objectives', 'Rewrite non-compliant personal-attribute copy'],
              estMinutes: 25,
              blocks: [
                { id: 'b21', type: 'heading', text: 'Matching Objectives to Real Outcomes' },
                {
                  id: 'b22',
                  type: 'steps',
                  title: 'Objective Selection Checklist',
                  items: [
                    'Define the exact measurable goal (e.g., 30 qualified workshop signups).',
                    'Verify whether tracking occurs on-site (Meta Pixel) or inside Meta (Instant Forms / WhatsApp).',
                    'Choose Sales or Leads when conversions matter; reserve Awareness for reach.',
                  ],
                },
                {
                  id: 'b23',
                  type: 'example',
                  title: 'Fixing Personal-Attribute Policy Violations',
                  body: 'Rejected: "Struggling with acne or broke at month end? Click here!"\nApproved: "Build a consistent 3-step evening skincare routine trusted by 4,000+ customers."',
                },
              ],
              summary: 'Align objectives with true conversion events and frame copy around product value rather than asserting personal traits.',
              takeaways: ['Avoid "you are / are you" personal attribute claims', 'Match optimization event to true KPI'],
            }),
          ],
        },
        {
          id: 'ph-fb1-2',
          position: 2,
          title: 'Phase 2: Beginner Application & Creative Basics',
          summary: 'Write thumb-stopping hooks, primary text, and clear calls to action for cold audiences.',
          difficulty: 'Beginner',
          estHours: 4,
          objectives: ['Write 3-part ad copy (Hook, Body, CTA)', 'Structure mobile-first 4:5 and 9:16 creative briefs'],
          completionRequirements: ['Complete creative basics lesson', 'Pass Phase 2 check'],
          lessons: [
            buildLesson({
              id: 'les-fb1-3',
              position: 1,
              title: 'The Hook–Value–CTA Ad Copy Framework',
              introduction: 'On mobile feeds, only the first 125 characters appear before "See more". Your opening line earns attention.',
              objectives: ['Draft concise mobile-first ad hooks', 'Pair visual assets with matching landing page promises'],
              estMinutes: 30,
              blocks: [
                { id: 'b31', type: 'paragraph', text: 'Strong Meta ads maintain message match: the promise in your hook must appear immediately on the destination landing page.' },
                {
                  id: 'b32',
                  type: 'case_study',
                  title: 'Local Bakery Weekend Pre-Order Campaign',
                  scenario: 'A neighborhood bakery ran generic "Fresh bread daily" ads with 0.4% CTR. Switching the hook to "Pre-order warm sourdough boxes before Friday 4 PM for Saturday morning pickup" lifted CTR to 2.1% and lowered cost per order by 48%.',
                  takeaway: 'Specific offer + clear deadline + local relevance beats vague brand slogans.',
                },
              ],
              summary: 'Lead with specific customer outcomes and keep ad copy aligned with landing page headlines.',
              takeaways: ['First 2 lines determine scroll-stop rate', 'Include one explicit Call To Action'],
            }),
          ],
        },
        {
          id: 'ph-fb1-3',
          position: 3,
          title: 'Phase 3: Practical Mastery & Audit',
          summary: 'Audit an underperforming beginner campaign and submit a structured campaign blueprint.',
          difficulty: 'Beginner',
          estHours: 4.5,
          objectives: ['Diagnose objective mismatches', 'Complete the Fundamentals assessment and blueprint challenge'],
          completionRequirements: ['Pass Fundamentals Assessment', 'Earn challenge approval'],
          lessons: [
            buildLesson({
              id: 'les-fb1-4',
              position: 1,
              title: 'Pre-Launch Quality & Compliance Review',
              introduction: 'Before spending budget, verify pixel firing, UTM parameters, mobile landing speed, and compliance.',
              objectives: ['Run a 6-point pre-launch checklist', 'Document UTM campaign naming conventions'],
              estMinutes: 25,
              blocks: [
                {
                  id: 'b41',
                  type: 'bullets',
                  title: 'Pre-Launch Audit Checklist',
                  items: [
                    'Verify destination URL loads in under 3 seconds on 4G mobile.',
                    'Attach clean utm_source, utm_medium, and utm_campaign tags.',
                    'Confirm ad preview across Feed, Stories, and Reels safe zones.',
                  ],
                },
              ],
              summary: 'Consistent naming and pre-launch audits prevent wasted spend on broken links.',
              takeaways: ['Always test destination links on mobile before publishing'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-fb-2',
      skillId: 'skill-facebook-instagram-ads',
      slug: 'facebook-ads-campaign-setup',
      title: 'Facebook Ads Campaign Setup: Beginner to Intermediate',
      description: 'Configure Meta Pixel & Conversions API tracking, audience segmentation, placements, and clean A/B creative tests.',
      difficulty: 'Intermediate',
      estimatedDurationWeeks: 5,
      recommendedWeeklyHours: 5,
      recommendedSchedule: '3 phases across 5 weeks with pixel & audience labs',
      prerequisites: ['Facebook Ads Fundamentals: Beginner'],
      outcomes: ['Verify Pixel standard events', 'Build Saved, Custom, and Lookalike audiences cleanly'],
      phases: [
        {
          id: 'ph-fb2-1',
          position: 1,
          title: 'Phase 1: Pixel, Events & Attribution Setup',
          summary: 'Connect browser Pixel and Conversions API (CAPI) signals accurately.',
          difficulty: 'Intermediate',
          estHours: 5,
          objectives: ['Prioritize conversion events', 'Verify PageView, ViewContent, Lead, and Purchase firing'],
          completionRequirements: ['Complete Pixel setup lesson'],
          lessons: [
            buildLesson({
              id: 'les-fb2-1',
              position: 1,
              title: 'Meta Pixel & Conversions API Foundations',
              introduction: 'Browser privacy controls limit cookie-only tracking. Combining Pixel + server-side CAPI improves attribution accuracy.',
              objectives: ['Deduplicate browser and server events', 'Test events in Events Manager'],
              estMinutes: 35,
              blocks: [
                { id: 'f2b1', type: 'heading', text: 'Standard Events Funnel' },
                { id: 'f2b2', type: 'steps', title: 'Setup Sequence', items: ['Install base Pixel snippet or partner integration.', 'Configure Lead / Purchase standard events.', 'Verify deduplication event_id in Test Events.'] },
              ],
              summary: 'Clean event signals feed the delivery algorithm with reliable conversion data.',
              takeaways: ['Always verify Purchase/Lead events before scaling budget'],
            }),
          ],
        },
        {
          id: 'ph-fb2-2',
          position: 2,
          title: 'Phase 2: Audience Architecture & Placements',
          summary: 'Balance Advantage+ broad audiences with targeted interest and lookalike segments.',
          difficulty: 'Intermediate',
          estHours: 5,
          objectives: ['Prevent audience overlap across ad sets', 'Design 3:2:2 creative testing ad sets'],
          completionRequirements: ['Complete audience & testing lesson'],
          lessons: [
            buildLesson({
              id: 'les-fb2-2',
              position: 1,
              title: 'Avoiding Audience Fragmentation',
              introduction: 'Splitting a $20/day budget across 10 tiny ad sets traps campaigns in the Learning Phase.',
              objectives: ['Consolidate ad sets for 50 weekly conversions', 'Use Advantage+ Placements wisely'],
              estMinutes: 30,
              blocks: [
                { id: 'f2b3', type: 'paragraph', text: 'Consolidating ad sets concentrates conversion data so Meta exits the Learning Phase faster and lowers CPA.' },
              ],
              summary: 'Fewer, well-funded ad sets outperform hyper-fragmented micro-targeting.',
              takeaways: ['Aim for 50 optimization events per ad set per week'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-fb-3',
      skillId: 'skill-facebook-instagram-ads',
      slug: 'advanced-meta-ads-campaign-management',
      title: 'Advanced Meta Ads Campaign Management',
      description: 'Scale winning creatives with Advantage+ Shopping/Leads, CBO budget rules, and structured creative testing sprints.',
      difficulty: 'Advanced',
      estimatedDurationWeeks: 6,
      recommendedWeeklyHours: 6,
      recommendedSchedule: 'Weekly creative iteration & budget scaling reviews',
      prerequisites: ['Facebook Ads Campaign Setup'],
      outcomes: ['Manage CBO scaling safely without resetting learning', 'Run weekly creative testing matrices'],
      phases: [
        {
          id: 'ph-fb3-1',
          position: 1,
          title: 'Phase 1: Scaling & Creative Testing Architecture',
          summary: 'Separate sandbox testing campaigns from evergreen CBO scaling campaigns.',
          difficulty: 'Advanced',
          estHours: 6,
          objectives: ['Apply the 20% vertical scaling rule', 'Graduate winning ads via Post ID'],
          completionRequirements: ['Complete scaling architecture lesson'],
          lessons: [
            buildLesson({
              id: 'les-fb3-1',
              position: 1,
              title: 'Sandbox vs. Scaling Campaign Architecture',
              introduction: 'Dropping untested creatives straight into a high-spend scaling campaign can disrupt winning delivery.',
              objectives: ['Isolate new concepts in ABO test ad sets', 'Promote proven Post IDs with social proof intact'],
              estMinutes: 35,
              blocks: [
                { id: 'f3b1', type: 'paragraph', text: 'Maintain one Testing Campaign to validate hooks and formats, and one Scaling Campaign holding your top 3–5 proven winners.' },
              ],
              summary: 'Keep testing controlled and graduation systematic.',
              takeaways: ['Scale winners gradually by 15–20% every 48–72 hours'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-fb-4',
      skillId: 'skill-facebook-instagram-ads',
      slug: 'conversion-optimization-and-retargeting',
      title: 'Conversion Optimization and Retargeting',
      description: 'Design full-funnel retargeting sequences for video viewers, cart abandoners, and landing-page friction reduction.',
      difficulty: 'Intermediate',
      estimatedDurationWeeks: 4,
      recommendedWeeklyHours: 4,
      recommendedSchedule: '2 lessons + funnel diagnostic weekly',
      prerequisites: ['Facebook Ads Campaign Setup'],
      outcomes: ['Build 7-day / 30-day custom retargeting windows', 'Exclude recent converters to prevent wasted frequency'],
      phases: [
        {
          id: 'ph-fb4-1',
          position: 1,
          title: 'Phase 1: Smart Retargeting & Exclusions',
          summary: 'Re-engage warm prospects with social proof and objection handling rather than repetitive ads.',
          difficulty: 'Intermediate',
          estHours: 4,
          objectives: ['Configure exclusion windows for past purchasers', 'Match warm ad copy to buyer objections'],
          completionRequirements: ['Complete retargeting lesson'],
          lessons: [
            buildLesson({
              id: 'les-fb4-1',
              position: 1,
              title: 'Warm Funnel Angles & Frequency Caps',
              introduction: 'Warm audiences are small—showing the exact same ad 12 times creates ad fatigue and negative comments.',
              objectives: ['Monitor Ad Frequency below 3.5–4.0 per 7 days', 'Rotate testimonial and FAQ creatives'],
              estMinutes: 30,
              blocks: [
                { id: 'f4b1', type: 'paragraph', text: 'Always exclude 30-day purchasers from acquisition and retargeting ad sets unless running a dedicated upsell campaign.' },
              ],
              summary: 'Thoughtful exclusions protect ROAS and customer goodwill.',
              takeaways: ['Fresh testimonials convert warm fence-sitters better than repeating cold hooks'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-fb-5',
      skillId: 'skill-facebook-instagram-ads',
      slug: 'meta-ads-analytics-performance-optimization',
      title: 'Meta Ads Analytics and Performance Optimization',
      description: 'Interpret Thumbstop Rate, Hold Rate, CTR, CPC, CPM, CPA, and ROAS to diagnose funnel bottlenecks objectively.',
      difficulty: 'Advanced',
      estimatedDurationWeeks: 4,
      recommendedWeeklyHours: 5,
      recommendedSchedule: 'Weekly metric audit + optimization memo',
      prerequisites: ['Conversion Optimization and Retargeting'],
      outcomes: ['Pinpoint whether bottlenecks lie in creative, targeting, or landing page', 'Present clear executive ad performance reports'],
      phases: [
        {
          id: 'ph-fb5-1',
          position: 1,
          title: 'Phase 1: Diagnostic Metrics & Attribution',
          summary: 'Read leading and lagging Meta Ads indicators cleanly.',
          difficulty: 'Advanced',
          estHours: 5,
          objectives: ['Calculate Hook Rate (3s plays / impressions) and Hold Rate', 'Diagnose high CTR + low Conversion Rate'],
          completionRequirements: ['Complete analytics diagnostic lesson'],
          lessons: [
            buildLesson({
              id: 'les-fb5-1',
              position: 1,
              title: 'Diagnosing Funnel Drop-Off by Metric Pairs',
              introduction: 'Never pause an ad just because CPA spiked yesterday without checking whether CTR dropped or landing page CVR collapsed.',
              objectives: ['Map metric pairs to exact fixes', 'Build custom Ads Manager reporting columns'],
              estMinutes: 35,
              blocks: [
                {
                  id: 'f5b1',
                  type: 'table',
                  title: 'Diagnostic Action Matrix',
                  headers: ['Symptom', 'Likely Root Cause', 'Next Action'],
                  rows: [
                    ['Low Hook Rate (<20%)', 'Weak first 3 seconds of video', 'Test 3 new visual hooks keeping body intact'],
                    ['High Outbound CTR + Low Page CVR', 'Slow mobile site or offer mismatch', 'Fix landing speed & align hero headline'],
                    ['High Frequency (>4.5) + Rising CPA', 'Audience saturation / fatigue', 'Introduce fresh creative formats & expand audience'],
                  ],
                },
              ],
              summary: 'Metric pairs tell you what to fix—creative vs. landing page vs. audience saturation.',
              takeaways: ['Diagnose creative, click, and conversion stages separately'],
            }),
          ],
        },
      ],
    },
  ];
  courses.push(...fbCourses);

  addAssessment({
    id: 'quiz-fb1-final',
    skillId: 'skill-facebook-instagram-ads',
    courseId: 'course-fb-1',
    quizType: 'skill_check',
    title: 'Facebook Ads Fundamentals Assessment',
    description: '10-question multi-format assessment covering campaign hierarchy, ODAX objectives, compliance, and creative structure.',
    passPercent: 70,
    timeLimitMinutes: 20,
    maxAttempts: 3,
    questions: [
      {
        questionType: 'multiple_choice',
        difficulty: 'easy',
        marks: 2,
        prompt: 'Which Ads Manager level determines your overall campaign objective (e.g., Leads or Sales)?',
        options: ['Campaign level', 'Ad Set level', 'Ad level', 'Business Portfolio settings'],
        correctIndex: 0,
        explanation: 'Campaign objectives are always configured at the top Campaign level.',
      },
      {
        questionType: 'true_false',
        difficulty: 'easy',
        marks: 1,
        prompt: 'True or False: Asking "Are you struggling with debt or diabetes?" is compliant with Meta ad copy policies.',
        options: ['True', 'False'],
        correctIndex: 1,
        explanation: 'False. Meta prohibits asserting or implying personal health or financial struggles in ad copy.',
      },
      {
        questionType: 'multiple_select',
        difficulty: 'medium',
        marks: 2,
        prompt: 'Select ALL controls typically managed at the Ad Set level (choose 2).',
        options: ['Target audience location', 'Primary ad image or video', 'Placement selection', 'Account billing currency'],
        correctIndices: [0, 2],
        explanation: 'Ad Sets configure audience, placements, optimization event, and scheduling.',
      },
      {
        questionType: 'ordering',
        difficulty: 'medium',
        marks: 2,
        prompt: 'Order the Meta Ads Manager hierarchy from highest level to lowest level.',
        options: ['Ad (Creative & Copy)', 'Campaign (Objective)', 'Ad Set (Audience & Placements)'],
        correctOrder: [1, 2, 0],
        explanation: 'Campaign sits at the top, followed by Ad Set, and then individual Ads.',
      },
      {
        questionType: 'fill_blank',
        difficulty: 'medium',
        marks: 1,
        prompt: 'Fill in the blank: Only the first ~125 characters of primary text appear before "See more", making the opening ______ critical.',
        acceptedAnswers: ['hook', 'line', 'sentence', 'opening line'],
        explanation: 'The opening hook determines whether mobile scrollers stop and read.',
      },
      {
        questionType: 'scenario',
        difficulty: 'medium',
        marks: 2,
        prompt: 'Scenario: An online store chose the "Traffic" objective and got 2,000 cheap clicks with zero purchases. What should they change?',
        contextText: 'They have a verified Meta Pixel with Purchase events active on their checkout page.',
        options: [
          'Switch campaign objective to Sales optimized for Purchase conversions',
          'Increase daily budget on the Traffic campaign',
          'Remove the CTA button from the ad',
        ],
        correctIndex: 0,
        explanation: 'Traffic optimizes for cheap clicks; Sales optimizes for buyers likely to purchase.',
      },
    ],
  });

  challenges.push({
    id: 'chal-fb1-blueprint',
    skillId: 'skill-facebook-instagram-ads',
    courseId: 'course-fb-1',
    title: 'Design a Beginner Meta Ads Campaign Blueprint',
    brief: 'Create a structured 1-campaign, 2-ad-set blueprint for a local or digital business of your choice, including objective rationale, audience definitions, compliant copy hooks, and creative direction.',
    instructions: 'Include Campaign Objective, 2 distinct Ad Sets (audience, age/location, placements), and 2 policy-safe ads following Hook–Value–CTA.',
    expectedDeliverables: [
      'Campaign objective & conversion event justification',
      '2 Ad Set definitions with budget split',
      '2 complete ad copy variations (Primary Text, Headline, CTA)',
    ],
    submissionFormat: 'Google Doc / PDF / Notion link or pasted written blueprint',
    deliverableHint: 'Provide a clear link or paste your structured blueprint in the submission text.',
    maxScore: 20,
    passingScore: 14,
    rubric: [
      { id: 'fb-r1', label: 'Objective & Hierarchy Alignment', description: 'ODAX objective cleanly matches business goal.', maxPoints: 5 },
      { id: 'fb-r2', label: 'Audience & Placement Logic', description: 'Ad Sets avoid pointless overlap and fit budget.', maxPoints: 5 },
      { id: 'fb-r3', label: 'Policy-Safe Copy & Hook', description: 'Strong opening hooks with zero policy violations.', maxPoints: 5 },
      { id: 'fb-r4', label: 'Measurement & CTA Clarity', description: 'Clear UTM/tracking and landing page alignment.', maxPoints: 5 },
    ],
  });

  // =========================================================================
  // 2. WRITING & CONTENT CREATION: Creative Writing (5 Progressive Courses)
  // =========================================================================
  const cwCourses = [
    {
      id: 'course-cw-1',
      skillId: 'skill-creative-writing',
      slug: 'introduction-to-creative-writing',
      title: 'Introduction to Creative Writing',
      description: 'Build daily observation habits, sensory detail ("show, don’t tell"), crisp opening hooks, and clean scene grounding.',
      difficulty: 'Beginner',
      estimatedDurationWeeks: 4,
      recommendedWeeklyHours: 4,
      recommendedSchedule: '3 reading + writing craft sessions weekly',
      prerequisites: [],
      outcomes: ['Replace abstract telling with concrete sensory details', 'Write opening paragraphs that establish character, tension, and setting'],
      phases: [
        {
          id: 'ph-cw1-1',
          position: 1,
          title: 'Phase 1: Observation & Sensory Detail',
          summary: 'Anchor readers in physical reality through sight, sound, texture, and specific verbs.',
          difficulty: 'Beginner',
          estHours: 4,
          objectives: ['Convert abstract emotion statements into observable action', 'Cut weak adverb crutches'],
          completionRequirements: ['Complete sensory craft lessons'],
          lessons: [
            buildLesson({
              id: 'les-cw1-1',
              position: 1,
              title: 'Show, Don’t Tell: Grounding Readers in Scene',
              introduction: 'Readers connect deeply when they experience clues through sensory evidence rather than being told how a character feels.',
              objectives: ['Distinguish summary telling from scenic showing', 'Use concrete nouns and active verbs'],
              estMinutes: 30,
              blocks: [
                { id: 'cw1b1', type: 'heading', text: 'Replacing Abstractions with Physical Evidence' },
                { id: 'cw1b2', type: 'example', title: 'Telling vs. Showing', body: 'Telling: "Tariq was nervous before the meeting."\nShowing: "Tariq folded his agenda along the same crease four times until the paper tore at the corner."' },
                { id: 'cw1b3', type: 'demonstration', title: '5-Minute Sensory Rewrite', instructions: 'Take a plain sentence ("The market was busy") and write three lines capturing one sound, one smell, and one physical movement.', expectedOutcome: 'A vivid mini-scene that drops the reader straight onto the street.' },
              ],
              videos: [
                yt('vid-cw1-1', 'Writing Vivid Scenes & Sensory Hooks', 'dQw4w9WgXcQ', '08:40', 'Craft breakdown on opening hooks and sensory immersion.', 'Focus on how the first two sentences orient time, place, and stakes.', 'Focus on concrete objects and deliberate verbs.'),
              ],
              summary: 'Specific sensory choices make even quiet scenes unforgettable.',
              takeaways: ['Choose exact nouns over stacked adjectives', 'Show emotions through posture, gesture, and pacing'],
            }),
          ],
        },
        {
          id: 'ph-cw1-2',
          position: 2,
          title: 'Phase 2: Compelling Openings & Voice',
          summary: 'Hook readers in the first paragraph by introducing movement, voice, and an unanswered question.',
          difficulty: 'Beginner',
          estHours: 4,
          objectives: ['Craft openings with immediate narrative curiosity', 'Maintain consistent narrative voice'],
          completionRequirements: ['Complete opening hooks lesson', 'Submit Phase 2 assessment'],
          lessons: [
            buildLesson({
              id: 'les-cw1-2',
              position: 1,
              title: 'Designing Unforgettable First Paragraphs',
              introduction: 'An opening paragraph is a quiet contract with the reader: it promises tone, character agency, and something slightly unsettled.',
              objectives: ['Spot throat-clearing backstory openings', 'Start scenes as late as possible while keeping clarity'],
              estMinutes: 25,
              blocks: [
                { id: 'cw1b4', type: 'paragraph', text: 'Avoid starting a story with a character waking up to an alarm unless the wake-up itself creates immediate conflict.' },
              ],
              summary: 'Begin inside a meaningful moment where a choice or change is underway.',
              takeaways: ['Enter scenes mid-motion', 'Cut the first three throat-clearing sentences during revision'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-cw-2',
      skillId: 'skill-creative-writing',
      slug: 'storytelling-character-development',
      title: 'Storytelling and Character Development',
      description: 'Create multidimensional characters driven by clear desires, flaws, contradictions, and authentic dialogue subtext.',
      difficulty: 'Beginner',
      estimatedDurationWeeks: 5,
      recommendedWeeklyHours: 4,
      prerequisites: ['Introduction to Creative Writing'],
      outcomes: ['Build character arcs around want vs. need', 'Write dialogue rich with subtext'],
      phases: [
        {
          id: 'ph-cw2-1',
          position: 1,
          title: 'Phase 1: Want, Flaw & Character Contradiction',
          summary: 'Characters feel human when their stated goal clashes with their hidden emotional wound.',
          difficulty: 'Beginner',
          estHours: 5,
          objectives: ['Define external goal vs. internal flaw', 'Use subtext in two-person dialogue'],
          completionRequirements: ['Complete character design lesson'],
          lessons: [
            buildLesson({
              id: 'les-cw2-1',
              position: 1,
              title: 'Desire, Obstacle & Subtext in Dialogue',
              introduction: 'Great dialogue rarely states feelings head-on; characters speak around what hurts or what they want to hide.',
              objectives: ['Write 12 lines of dialogue where neither character says their true motive directly'],
              estMinutes: 30,
              blocks: [
                { id: 'cw2b1', type: 'definition', term: 'Dialogue Subtext', meaning: 'The unspoken tension or motive beneath what a character literally says aloud.' },
              ],
              summary: 'Give every character an immediate goal in every conversation.',
              takeaways: ['Conflict drives character revelation'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-cw-3',
      skillId: 'skill-creative-writing',
      slug: 'fiction-writing-narrative-structure',
      title: 'Fiction Writing and Narrative Structure',
      description: 'Master scene-sequel pacing, cause-and-effect plotting, POV distance, and rising dramatic tension.',
      difficulty: 'Intermediate',
      estimatedDurationWeeks: 6,
      recommendedWeeklyHours: 5,
      prerequisites: ['Storytelling and Character Development'],
      outcomes: ['Plot scenes with cause-and-effect ("therefore / but") momentum', 'Switch POV deliberately without head-hopping'],
      phases: [
        {
          id: 'ph-cw3-1',
          position: 1,
          title: 'Phase 1: Scene Momentum & POV Control',
          summary: 'Link scenes through consequence rather than "and then" chronology.',
          difficulty: 'Intermediate',
          estHours: 6,
          objectives: ['Apply Goal-Conflict-Outcome scene structure', 'Eliminate accidental POV slips'],
          completionRequirements: ['Complete structure lesson'],
          lessons: [
            buildLesson({
              id: 'les-cw3-1',
              position: 1,
              title: 'Cause-and-Effect Scene Architecture',
              introduction: 'If two scenes are joined by "and then", readers lose urgency. Join scenes with "therefore" or "but".',
              objectives: ['Outline a 5-scene short story arc'],
              estMinutes: 35,
              blocks: [
                { id: 'cw3b1', type: 'steps', title: 'Scene Beat Check', items: ['Character enters with an immediate objective.', 'An obstacle complicates the attempt.', 'The scene ends in a turn (Yes-but or No-furthermore).'] },
              ],
              summary: 'Every scene must change the character’s situation before the page ends.',
              takeaways: ['End scenes with changed stakes, not neat resolutions'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-cw-4',
      skillId: 'skill-creative-writing',
      slug: 'advanced-creative-writing',
      title: 'Advanced Creative Writing',
      description: 'Experiment with unreliable narrators, thematic layering, lyrical compression, and multi-strand short fiction.',
      difficulty: 'Advanced',
      estimatedDurationWeeks: 8,
      recommendedWeeklyHours: 6,
      prerequisites: ['Fiction Writing and Narrative Structure'],
      outcomes: ['Sustain complex thematic motifs', 'Control narrative time (compression vs. dilation)'],
      phases: [
        {
          id: 'ph-cw4-1',
          position: 1,
          title: 'Phase 1: Time Control & Thematic Resonance',
          summary: 'Control when to linger frame-by-frame and when to summarize whole seasons in one sentence.',
          difficulty: 'Advanced',
          estHours: 8,
          objectives: ['Balance scenic dilation with crisp summary transitions'],
          completionRequirements: ['Complete advanced pacing lesson'],
          lessons: [
            buildLesson({
              id: 'les-cw4-1',
              position: 1,
              title: 'Pacing Time & Unreliable Perspective',
              introduction: 'Master storytellers manipulate time like a camera lens—zooming in when tension peaks and skipping flat weeks cleanly.',
              objectives: ['Rewrite a passage shifting narrative distance'],
              estMinutes: 40,
              blocks: [{ id: 'cw4b1', type: 'paragraph', text: 'Contrast close third-person psychic distance with panoramic summary to create emotional rhythm.' }],
              summary: 'Time dilation signals emotional weight.',
              takeaways: ['Slow down at turning points; compress routine travel'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-cw-5',
      skillId: 'skill-creative-writing',
      slug: 'editing-publishing-professional-writing',
      title: 'Editing, Publishing, and Professional Writing',
      description: 'Revise full manuscripts systematically, prepare query letters/synopses, and navigate literary & independent publishing.',
      difficulty: 'Intermediate',
      estimatedDurationWeeks: 5,
      recommendedWeeklyHours: 4,
      prerequisites: ['Fiction Writing and Narrative Structure'],
      outcomes: ['Separate structural developmental edits from line-level polish', 'Draft submission-ready pitches and manuscripts'],
      phases: [
        {
          id: 'ph-cw5-1',
          position: 1,
          title: 'Phase 1: Developmental & Line Revision',
          summary: 'Revise structure first before polishing individual sentences.',
          difficulty: 'Intermediate',
          estHours: 5,
          objectives: ['Audit scene purpose before line editing', 'Format clean literary submissions'],
          completionRequirements: ['Complete revision workflow lesson'],
          lessons: [
            buildLesson({
              id: 'les-cw5-1',
              position: 1,
              title: 'Two-Pass Revision: Structure Before Style',
              introduction: 'Polishing the prose of a scene that actually needs to be deleted wastes hours. Always revise big-to-small.',
              objectives: ['Complete a reverse outline on a draft story'],
              estMinutes: 30,
              blocks: [{ id: 'cw5b1', type: 'paragraph', text: 'Create a reverse outline listing what each paragraph accomplishes for plot or character before polishing word choices.' }],
              summary: 'Structural clarity makes line edits twice as effective.',
              takeaways: ['Cut redundant scenes ruthlessly before line-editing'],
            }),
          ],
        },
      ],
    },
  ];
  courses.push(...cwCourses);

  addAssessment({
    id: 'quiz-cw1-check',
    skillId: 'skill-creative-writing',
    courseId: 'course-cw-1',
    quizType: 'skill_check',
    title: 'Creative Writing Foundations & Craft Check',
    description: 'Includes objective craft questions plus a short-answer sensory rewrite reviewed by an administrator.',
    passPercent: 70,
    requiresManualReview: true,
    questions: [
      {
        questionType: 'multiple_choice',
        difficulty: 'easy',
        marks: 2,
        prompt: 'Which line best demonstrates "showing" rather than "telling"?',
        options: [
          'She was furious about the delay.',
          'She tapped her watch against the counter, staring past the clerk at the closed gate.',
          'She felt very angry inside.',
        ],
        correctIndex: 1,
        explanation: 'Physical action and concrete setting details let the reader feel her impatience directly.',
      },
      {
        questionType: 'short_answer',
        difficulty: 'medium',
        marks: 4,
        prompt: 'Short Creative Exercise: Rewrite "The room was lonely" in 2–3 sentences using sensory objects without using the word "lonely".',
        explanation: 'Evaluated on sensory specificity and mood.',
      },
    ],
  });

  challenges.push({
    id: 'chal-cw1-story',
    skillId: 'skill-creative-writing',
    courseId: 'course-cw-1',
    title: 'Write a Compelling Opening & Short Scene (500–800 words)',
    brief: 'Write an original opening scene introducing a protagonist facing an immediate dilemma, grounded in sensory detail and clear voice.',
    instructions: 'Avoid abstract emotion summaries and backstory dumps in paragraph one. Focus on concrete action and setting.',
    expectedDeliverables: ['Original 500–800 word scene', 'Brief 2-sentence reflection on one "show vs. tell" revision you made'],
    submissionFormat: 'Written story pasted directly or via document link',
    deliverableHint: 'Paste your scene or provide a viewable document link.',
    maxScore: 20,
    passingScore: 14,
    rubric: [
      { id: 'cw-r1', label: 'Opening Hook & Tension', description: 'Draws reader into an active moment.', maxPoints: 5 },
      { id: 'cw-r2', label: 'Sensory Detail (Show, Don’t Tell)', description: 'Concrete imagery over abstract labels.', maxPoints: 5 },
      { id: 'cw-r3', label: 'Voice & Character Clarity', description: 'Consistent perspective and believable motive.', maxPoints: 5 },
      { id: 'cw-r4', label: 'Prose Rhythm & Polish', description: 'Clean syntax and deliberate word choice.', maxPoints: 5 },
    ],
  });

  // =========================================================================
  // 3. COMMUNICATION: Effective Communication (2 Courses)
  // =========================================================================
  courses.push(
    {
      id: 'course-comm-1',
      skillId: 'skill-effective-communication',
      slug: 'workplace-communication-clarity',
      title: 'Workplace & Written Communication Clarity',
      description: 'Master BLUF summaries, difficult client emails, active listening checks, and concise meeting recaps.',
      difficulty: 'Beginner',
      estimatedDurationWeeks: 3,
      recommendedWeeklyHours: 3,
      recommendedSchedule: '2 concise workshops per week across 3 weeks',
      prerequisites: [],
      outcomes: ['Write concise executive summaries', 'Respond calmly and constructively to upset clients'],
      phases: [
        {
          id: 'ph-c1-1',
          position: 1,
          title: 'Phase 1: Foundations of Reader-First Clarity',
          summary: 'Put decisions, context, and next steps in plain, respectful language.',
          difficulty: 'Beginner',
          estHours: 3,
          objectives: ['Apply BLUF (Bottom Line Up Front)', 'Eliminate buried action items'],
          completionRequirements: ['Complete clarity lesson'],
          lessons: [
            buildLesson({
              id: 'les-c1-1',
              position: 1,
              title: 'Writing with Bottom Line Up Front (BLUF)',
              introduction: 'Busy colleagues skim messages in under 15 seconds. Lead with the decision, recommendation, or core ask.',
              objectives: ['Restructure long updates using BLUF', 'Highlight owners and due dates explicitly'],
              estMinutes: 25,
              blocks: [
                { id: 'c1b1', type: 'heading', text: 'The 3-Part BLUF Structure' },
                { id: 'c1b2', type: 'steps', title: 'BLUF Blueprint', items: ['Lead sentence: Decision needed or headline outcome.', 'Context: 2–4 concise bullets with evidence.', 'Next steps: Exact owner and deadline.'] },
                { id: 'c1b3', type: 'example', title: 'Before vs. After Subject & Opening', body: 'Before: "Update on Q3 project"\nAfter: "Decision needed by Thu 4 PM: Approve revised launch date (Oct 14)"' },
              ],
              summary: 'Leading with the point respects your reader’s attention and prevents missed deadlines.',
              takeaways: ['Put the ask in the first two lines', 'Format dates and owners cleanly'],
            }),
          ],
        },
        {
          id: 'ph-c1-2',
          position: 2,
          title: 'Phase 2: Handling Difficult Conversations by Email',
          summary: 'Acknowledge impact without defensiveness, state verified facts, and propose concrete remedies.',
          difficulty: 'Beginner',
          estHours: 3,
          objectives: ['De-escalate tense client emails', 'Offer clear recovery options'],
          completionRequirements: ['Complete difficult client lesson'],
          lessons: [
            buildLesson({
              id: 'les-c1-2',
              position: 1,
              title: 'De-Escalating an Upset Client Response',
              introduction: 'When a client is frustrated, defensive explanations escalate friction. Acknowledge their impact first, then move swiftly to solutions.',
              objectives: ['Use the Acknowledge–Clarify–Resolve pattern'],
              estMinutes: 25,
              blocks: [
                { id: 'c1b4', type: 'callout', title: 'Tone Rule', text: 'Own your side calmly without blaming teammates or arguing semantics.' },
              ],
              summary: 'Empathy paired with concrete timelines restores client confidence.',
              takeaways: ['Acknowledge frustration directly', 'Give two specific recovery steps and dates'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-comm-2',
      skillId: 'skill-effective-communication',
      slug: 'persuasive-presentations-stakeholder-alignment',
      title: 'Persuasive Presentations & Stakeholder Alignment',
      description: 'Run crisp meetings, handle tough Q&A objections, and align cross-functional teams around clear trade-offs.',
      difficulty: 'Intermediate',
      estimatedDurationWeeks: 4,
      recommendedWeeklyHours: 4,
      recommendedSchedule: 'Weekly meeting & presentation labs',
      prerequisites: ['Workplace & Written Communication Clarity'],
      outcomes: ['Run focused 25-minute alignment meetings', 'Deliver persuasive trade-off briefings'],
      phases: [
        {
          id: 'ph-c2-1',
          position: 1,
          title: 'Phase 1: Framing Trade-Offs & Alignment',
          summary: 'Present options objectively with risks and clear recommendations.',
          difficulty: 'Intermediate',
          estHours: 4,
          objectives: ['Structure an Options Matrix for stakeholders'],
          completionRequirements: ['Complete alignment lesson'],
          lessons: [
            buildLesson({
              id: 'les-c2-1',
              position: 1,
              title: 'Presenting Options & Handling Pushback',
              introduction: 'Stakeholders trust presenters who surface trade-offs honestly rather than hiding risks.',
              objectives: ['Compare 2–3 viable options using shared criteria'],
              estMinutes: 30,
              blocks: [{ id: 'c2b1', type: 'paragraph', text: 'Always bring a recommended option alongside the criteria you used to rank alternatives.' }],
              summary: 'Structured trade-offs accelerate executive sign-off.',
              takeaways: ['Recommend one path clearly while respecting constraints'],
            }),
          ],
        },
      ],
    }
  );

  addAssessment({
    id: 'quiz-comm-1',
    skillId: 'skill-effective-communication',
    courseId: 'course-comm-1',
    quizType: 'skill_check',
    title: 'Workplace Communication Check',
    description: 'Assess BLUF mastery, client de-escalation, and clarity principles.',
    passPercent: 70,
    questions: [
      {
        questionType: 'multiple_choice',
        marks: 1,
        prompt: 'What does BLUF stand for in business communication?',
        options: ['Brief Listing Under Footer', 'Bottom Line Up Front', 'Basic Language Usage Format'],
        correctIndex: 1,
        explanation: 'BLUF places your key conclusion or request in the very first lines.',
      },
      {
        questionType: 'true_false',
        marks: 1,
        prompt: 'True or False: When responding to an upset client, acknowledging their frustration before listing next steps helps de-escalate conflict.',
        options: ['True', 'False'],
        correctIndex: 0,
        explanation: 'Validation lowers defensiveness and makes the client receptive to your solution.',
      },
    ],
  });

  challenges.push({
    id: 'chal-comm-client',
    skillId: 'skill-effective-communication',
    courseId: 'course-comm-1',
    title: 'Respond to a Difficult Client Delay',
    brief: 'A key client emailed upset that a promised deliverable missed Friday’s deadline due to an internal review error. Write a calm, professional email response restoring trust.',
    instructions: 'Use BLUF + Acknowledge–Clarify–Resolve. Include a revised delivery timestamp and a concrete check-in plan.',
    expectedDeliverables: ['Complete client email (subject line + body, 150–250 words)'],
    submissionFormat: 'Text or link',
    deliverableHint: 'Paste your subject line and email body or link a shared doc.',
    maxScore: 20,
    passingScore: 14,
    rubric: [
      { id: 'cm-r1', label: 'Calm Ownership & Empathy', description: 'Acknowledges impact without blaming.', maxPoints: 5 },
      { id: 'cm-r2', label: 'BLUF & Scannable Structure', description: 'Immediate clarity in opening lines.', maxPoints: 5 },
      { id: 'cm-r3', label: 'Concrete Recovery Timeline', description: 'Specific next steps, owner, and time.', maxPoints: 5 },
      { id: 'cm-r4', label: 'Professional Tone & Grammar', description: 'Concise, courteous workplace polish.', maxPoints: 5 },
    ],
  });

  // =========================================================================
  // 4. DIGITAL MARKETING: Social Media Management (4-phase course)
  // =========================================================================
  courses.push({
    id: 'course-smm-1',
    skillId: 'skill-social-media-management',
    slug: 'social-media-strategy-content-calendars',
    title: 'Social Media Strategy & 30-Day Content Calendars',
    description: 'Plan balanced content pillars, write platform-native posts, manage communities, and report monthly engagement lift.',
    difficulty: 'Beginner',
    estimatedDurationWeeks: 6,
    recommendedWeeklyHours: 4,
    recommendedSchedule: '4 progressive phases across 6 weeks',
    prerequisites: [],
    outcomes: ['Design a 4-pillar 30-day calendar', 'Analyze reach, saves, shares, and conversion traffic'],
    phases: [
      {
        id: 'ph-smm-1',
        position: 1,
        title: 'Phase 1: Content Pillars & Channel Fit',
        summary: 'Balance educational, proof, behind-the-scenes, and promotional posts.',
        difficulty: 'Beginner',
        estHours: 4,
        objectives: ['Define 4 repeatable content pillars', 'Avoid posting 100% promotional flyers'],
        completionRequirements: ['Complete content pillars lesson'],
        lessons: [
          buildLesson({
            id: 'les-smm-1',
            position: 1,
            title: 'Building a Sustainable 4-Pillar Content Mix',
            introduction: 'Accounts that only shout "Buy now!" lose organic reach. Strong brands educate, prove results, and invite dialogue.',
            objectives: ['Map 4 content pillars for any brand'],
            estMinutes: 30,
            blocks: [
              {
                id: 'smmb1',
                type: 'table',
                title: 'Balanced 30-Day Mix',
                headers: ['Pillar', 'Share of Calendar', 'Goal'],
                rows: [
                  ['Educational / How-To', '40%', 'Saves & authority'],
                  ['Social Proof & Case Studies', '25%', 'Trust & credibility'],
                  ['Community / Behind the Scenes', '20%', 'Comments & relatability'],
                  ['Direct Offer / CTA', '15%', 'Leads & conversions'],
                ],
              },
            ],
            summary: 'Content pillars remove guesswork when planning a full month of posts.',
            takeaways: ['Optimize saves and shares, not empty likes'],
          }),
        ],
      },
    ],
  });

  challenges.push({
    id: 'chal-smm-calendar',
    skillId: 'skill-social-media-management',
    courseId: 'course-smm-1',
    title: 'Build a 30-Day Social Media Content Calendar',
    brief: 'Develop a 30-day content calendar (at least 12 structured posts across 4 weeks) for a brand, including pillar, format, hook, CTA, and target metric.',
    instructions: 'Balance educational, proof, community, and promotional posts across 2 channels.',
    expectedDeliverables: ['30-day calendar table or link', 'Brief strategy summary explaining target audience & KPIs'],
    submissionFormat: 'Spreadsheet/Doc URL or structured written plan',
    deliverableHint: 'Share a viewable spreadsheet/doc URL or summarize your 30-day schedule.',
    maxScore: 20,
    passingScore: 14,
    rubric: [
      { id: 'sm-r1', label: 'Pillar Balance & Audience Fit', description: 'Balanced non-spammy mix.', maxPoints: 5 },
      { id: 'sm-r2', label: 'Hooks & Format Variety', description: 'Carousels, reels, and text posts tailored well.', maxPoints: 5 },
      { id: 'sm-r3', label: 'Clear CTAs & Cadence', description: 'Realistic sustainable publishing schedule.', maxPoints: 5 },
      { id: 'sm-r4', label: 'KPI & Reporting Logic', description: 'Metrics aligned with campaign goals.', maxPoints: 5 },
    ],
  });

  // =========================================================================
  // 5. ENTREPRENEURSHIP & BUSINESS: Entrepreneurship (2 Courses)
  // =========================================================================
  courses.push(
    {
      id: 'course-ent-1',
      skillId: 'skill-entrepreneurship',
      slug: 'startup-fundamentals-validation',
      title: 'Startup Fundamentals & Customer Validation',
      description: 'Test business assumptions cheaply through customer interviews, value propositions, and lean MVPs before writing code or signing leases.',
      difficulty: 'Beginner',
      estimatedDurationWeeks: 4,
      recommendedWeeklyHours: 5,
      recommendedSchedule: '1 phase per week with real customer discovery exercises',
      prerequisites: [],
      outcomes: ['Conduct unbiased customer discovery interviews', 'Complete a Business Model Canvas'],
      phases: [
        {
          id: 'ph-ent1-1',
          position: 1,
          title: 'Phase 1: Problem Discovery & Business Model Canvas',
          summary: 'Ask about past behavior rather than pitching hypothetical future interest.',
          difficulty: 'Beginner',
          estHours: 5,
          objectives: ['Spot leading interview questions', 'Map the 9 blocks of a Business Model Canvas'],
          completionRequirements: ['Complete validation lesson'],
          lessons: [
            buildLesson({
              id: 'les-ent1-1',
              position: 1,
              title: 'Why Asking "Would You Buy This?" Fails',
              introduction: 'Friends politely say "Yes, great idea!" when asked hypothetical questions. Real validation uncovers what customers already spend time or money on today.',
              objectives: ['Draft 5 non-leading discovery questions'],
              estMinutes: 30,
              blocks: [
                { id: 'eb1', type: 'bullets', title: 'Better Discovery Questions', items: ['Tell me about the last time this problem cost you time or money.', 'What workaround are you using right now?', 'What prevented you from solving it earlier?'] },
              ],
              summary: 'Validate urgency and current spending before building full inventory or software.',
              takeaways: ['Talk about their past habits, not your future solution'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-ent-2',
      skillId: 'skill-entrepreneurship',
      slug: 'business-planning-financial-projections',
      title: 'Business Planning & Financial Projections',
      description: 'Model unit economics, break-even volume, 12-month cash flow forecasts, and actionable operating milestones.',
      difficulty: 'Intermediate',
      estimatedDurationWeeks: 6,
      recommendedWeeklyHours: 5,
      recommendedSchedule: 'Weekly financial modeling & risk reviews',
      prerequisites: ['Startup Fundamentals & Customer Validation'],
      outcomes: ['Calculate contribution margin & break-even units', 'Build a 12-month cash runway sheet'],
      phases: [
        {
          id: 'ph-ent2-1',
          position: 1,
          title: 'Phase 1: Unit Economics & Cash Flow',
          summary: 'Distinguish paper revenue from cash-in-bank survival.',
          difficulty: 'Intermediate',
          estHours: 6,
          objectives: ['Compute gross margin and fixed-cost break-even'],
          completionRequirements: ['Complete unit economics lesson'],
          lessons: [
            buildLesson({
              id: 'les-ent2-1',
              position: 1,
              title: 'Break-Even Analysis & Cash Runway',
              introduction: 'Profitable businesses still fail if receivables arrive 60 days after payroll and rent are due.',
              objectives: ['Compute Break-Even Units = Fixed Costs / (Price - Variable Cost)'],
              estMinutes: 35,
              blocks: [{ id: 'eb2', type: 'code', title: 'Break-Even Formula', language: 'text', code: 'Contribution Margin = Unit Price - Variable Cost per Unit\nBreak-Even Volume = Monthly Fixed Costs / Contribution Margin' }],
              summary: 'Know your exact monthly survival volume before scaling fixed expenses.',
              takeaways: ['Track cash timing separately from accrual profit'],
            }),
          ],
        },
      ],
    }
  );

  challenges.push({
    id: 'chal-ent-canvas',
    skillId: 'skill-entrepreneurship',
    courseId: 'course-ent-1',
    title: 'Prepare a Lean Business Model Canvas & Validation Plan',
    brief: 'Develop a 9-block Business Model Canvas for a venture idea and document 5 real customer discovery questions plus your MVP test.',
    instructions: 'Be specific about customer segments, revenue pricing, and cost drivers.',
    expectedDeliverables: ['9-block Business Model Canvas', '5 customer discovery questions + validation success metric'],
    submissionFormat: 'Text or document link',
    deliverableHint: 'Paste your structured canvas or attach/link your document.',
    maxScore: 20,
    passingScore: 14,
    rubric: [
      { id: 'en-r1', label: 'Customer & Value Clarity', description: 'Sharp problem-solution fit.', maxPoints: 5 },
      { id: 'en-r2', label: 'Revenue & Cost Realism', description: 'Plausible pricing and cost structure.', maxPoints: 5 },
      { id: 'en-r3', label: 'Non-Leading Discovery Questions', description: 'Focuses on real past behavior.', maxPoints: 5 },
      { id: 'en-r4', label: 'Lean Validation Test', description: 'Low-cost measurable experiment.', maxPoints: 5 },
    ],
  });

  // =========================================================================
  // 6. CREATIVE & DESIGN: Graphic Design (2 Courses)
  // =========================================================================
  courses.push(
    {
      id: 'course-gd-1',
      skillId: 'skill-graphic-design',
      slug: 'visual-hierarchy-layout-foundations',
      title: 'Visual Hierarchy, Typography & Layout Foundations',
      description: 'Guide viewer attention intentionally using scale contrast, grid alignment, whitespace, and accessible color pairings.',
      difficulty: 'Beginner',
      estimatedDurationWeeks: 4,
      recommendedWeeklyHours: 4,
      recommendedSchedule: '2 layout critiques + 1 flyer redesign weekly',
      prerequisites: [],
      outcomes: ['Apply CRAP design principles cleanly', 'Pair display and body typography with readable contrast'],
      phases: [
        {
          id: 'ph-gd1-1',
          position: 1,
          title: 'Phase 1: Hierarchy, Alignment & Whitespace',
          summary: 'Eliminate cluttered flyers where every element screams at the same size.',
          difficulty: 'Beginner',
          estHours: 4,
          objectives: ['Establish clear primary, secondary, and tertiary focal levels', 'Use generous margins and breathing room'],
          completionRequirements: ['Complete hierarchy lesson'],
          lessons: [
            buildLesson({
              id: 'les-gd1-1',
              position: 1,
              title: 'Why Whitespace Makes Designs Look Professional',
              introduction: 'Beginners try to fill every square centimeter. Whitespace groups related ideas and lets the headline breathe.',
              objectives: ['Identify primary focal points within 2 seconds'],
              estMinutes: 25,
              blocks: [
                { id: 'gd1b1', type: 'bullets', title: 'Four Core Layout Rules', items: ['Contrast: Make headlines clearly larger/bolder than body text.', 'Repetition: Reuse at most 2 typefaces and 1–2 accent colors.', 'Alignment: Snap edges to an invisible grid.', 'Proximity: Group related metadata together with generous gaps between groups.'] },
              ],
              summary: 'Deliberate hierarchy tells the eye where to look first, second, and third.',
              takeaways: ['Leave outer margins wider than inner element gaps'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-gd-2',
      skillId: 'skill-graphic-design',
      slug: 'brand-identity-marketing-deliverables',
      title: 'Brand Identity & Marketing Deliverables',
      description: 'Build cohesive brand kits, social campaign templates, print flyers, and concise client design rationales.',
      difficulty: 'Intermediate',
      estimatedDurationWeeks: 6,
      recommendedWeeklyHours: 5,
      recommendedSchedule: 'Weekly portfolio deliverable + rationale write-up',
      prerequisites: ['Visual Hierarchy, Typography & Layout Foundations'],
      outcomes: ['Deliver complete social + print brand kits', 'Present objective design rationales'],
      phases: [
        {
          id: 'ph-gd2-1',
          position: 1,
          title: 'Phase 1: Brand Kits & Deliverable Systems',
          summary: 'Move from one-off graphics to repeatable brand identity systems.',
          difficulty: 'Intermediate',
          estHours: 5,
          objectives: ['Define color contrast ratios and logo clear-space rules'],
          completionRequirements: ['Complete brand kit lesson'],
          lessons: [
            buildLesson({
              id: 'les-gd2-1',
              position: 1,
              title: 'Packaging Brand Systems for Real Teams',
              introduction: 'A strong brand kit lets anyone on a marketing team produce consistent flyers and carousels without guessing fonts.',
              objectives: ['Document primary, neutral, and semantic color tokens'],
              estMinutes: 30,
              blocks: [{ id: 'gd2b1', type: 'paragraph', text: 'Specify exact hex codes, font pairings, minimum margins, and misuse examples inside a 1-page brand sheet.' }],
              summary: 'Consistency builds instant brand recognition.',
              takeaways: ['Verify WCAG text contrast on every brand color pair'],
            }),
          ],
        },
      ],
    }
  );

  challenges.push({
    id: 'chal-gd-flyer',
    skillId: 'skill-graphic-design',
    courseId: 'course-gd-1',
    title: 'Design an Event Marketing Flyer & Rationale',
    brief: 'Design a clean event or product promotional flyer (using Canva, Figma, or any design tool) and present a short rationale explaining your hierarchy, font pairing, and color choices.',
    instructions: 'Include clear event title, date/time/location hierarchy, one high-contrast CTA, and balanced margins.',
    expectedDeliverables: ['Image/PDF upload or viewable Figma/Canva link', 'Design rationale (100+ words)'],
    submissionFormat: 'File upload or public design link + rationale',
    deliverableHint: 'Attach an image/PDF or share a Figma/Canva link plus your rationale.',
    maxScore: 20,
    passingScore: 14,
    rubric: [
      { id: 'gd-r1', label: 'Visual Hierarchy & Scan Order', description: 'Immediate 1-2-3 focal flow.', maxPoints: 5 },
      { id: 'gd-r2', label: 'Typography & Contrast', description: 'Readable sizes and accessible contrast.', maxPoints: 5 },
      { id: 'gd-r3', label: 'Grid Alignment & Margins', description: 'Clean alignment and balanced whitespace.', maxPoints: 5 },
      { id: 'gd-r4', label: 'Design Rationale Quality', description: 'Explains intentional design decisions.', maxPoints: 5 },
    ],
  });

  // =========================================================================
  // 7. TECHNOLOGY & DIGITAL: Web Development (2 Courses) + Data Analysis (1 Course)
  // =========================================================================
  courses.push(
    {
      id: 'course-web-1',
      skillId: 'skill-web-development',
      slug: 'html-css-accessible-web-foundations',
      title: 'HTML, CSS & Accessible Web Foundations',
      description: 'Build semantic HTML5 document structures, responsive CSS Grid/Flexbox layouts, and WCAG AA accessible user interfaces.',
      difficulty: 'Beginner',
      estimatedDurationWeeks: 6,
      recommendedWeeklyHours: 5,
      recommendedSchedule: '4 phases across 6 weeks',
      prerequisites: [],
      outcomes: ['Write landmark-based semantic HTML5', 'Create responsive layouts without horizontal overflow'],
      phases: [
        {
          id: 'ph-w1-1',
          position: 1,
          title: 'Phase 1: Semantic Landmarks & Accessibility',
          summary: 'Screen readers and keyboards rely on native HTML landmarks, labels, and contrast.',
          difficulty: 'Beginner',
          estHours: 4,
          objectives: ['Use <header>, <nav>, <main>, <button>, and <label> natively', 'Verify 4.5:1 text contrast'],
          completionRequirements: ['Complete semantic HTML lesson'],
          lessons: [
            buildLesson({
              id: 'les-w1-1',
              position: 1,
              title: 'Why Native HTML Controls Beat Clickable Divs',
              introduction: 'Replacing native buttons and links with styled <div> tags breaks keyboard Tab order, Space/Enter activation, and screen reader announcements.',
              objectives: ['Audit interactive elements for keyboard accessibility'],
              estMinutes: 30,
              blocks: [
                {
                  id: 'w1b1',
                  type: 'code',
                  title: 'Accessible Form Field Example',
                  language: 'html',
                  code: '<label for="email">Work email</label>\n<input id="email" name="email" type="email" required />',
                },
                {
                  id: 'w1b2',
                  type: 'knowledge_check',
                  prompt: 'Which attribute connects a <label> to its <input>?',
                  options: ['class matching id', 'for matching id', 'name matching type'],
                  correctIndex: 1,
                  explanation: 'The label "for" attribute must match the input "id" attribute.',
                },
              ],
              videos: [
                yt('vid-w1-1', 'Semantic HTML & Keyboard Navigation', 'M7lc1UVf-VE', '09:10', 'Practical keyboard-only inspection walkthrough.', 'Try navigating your own page using only Tab, Shift+Tab, and Enter.'),
              ],
              summary: 'Semantic HTML builds accessibility in from day one with zero extra JavaScript.',
              takeaways: ['Use <button> for actions and <a href> for navigation'],
            }),
          ],
        },
        {
          id: 'ph-w1-2',
          position: 2,
          title: 'Phase 2: Modern CSS Layout (Flexbox & Grid)',
          summary: 'Build fluid responsive cards and two-column workspaces cleanly.',
          difficulty: 'Beginner',
          estHours: 5,
          objectives: ['Use CSS Grid minmax() for auto-responsive card grids'],
          completionRequirements: ['Complete CSS layout lesson'],
          lessons: [
            buildLesson({
              id: 'les-w1-2',
              position: 1,
              title: 'Fluid Grids with CSS Custom Properties',
              introduction: 'CSS custom properties centralize spacing, radii, and colors cleanly across an application.',
              objectives: ['Define reusable design tokens in :root'],
              estMinutes: 30,
              blocks: [{ id: 'w1b3', type: 'code', title: 'Responsive 3-Column Grid', language: 'css', code: '.grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));\n  gap: 1.25rem;\n}' }],
              summary: 'Combine Grid for two-dimensional layouts and Flexbox for single-row alignments.',
              takeaways: ['Prevent horizontal overflow with minmax(0, 1fr)'],
            }),
          ],
        },
      ],
    },
    {
      id: 'course-web-2',
      skillId: 'skill-web-development',
      slug: 'interactive-javascript-application-architecture',
      title: 'Interactive JavaScript & Application Architecture',
      description: 'Build modular vanilla ES6+ state stores, safe DOM rendering, async fetch workflows, and idempotent mutations.',
      difficulty: 'Intermediate',
      estimatedDurationWeeks: 10,
      recommendedWeeklyHours: 6,
      recommendedSchedule: 'Weekly modular JavaScript labs',
      prerequisites: ['HTML, CSS & Accessible Web Foundations'],
      outcomes: ['Manage client state cleanly without XSS', 'Design idempotent form submissions'],
      phases: [
        {
          id: 'ph-w2-1',
          position: 1,
          title: 'Phase 1: Safe DOM Rendering & Idempotent Events',
          summary: 'Escape user-supplied strings and prevent duplicate network writes.',
          difficulty: 'Intermediate',
          estHours: 6,
          objectives: ['Escape dynamic text safely before template rendering', 'Disable buttons & attach idempotency keys during async calls'],
          completionRequirements: ['Complete JS architecture lesson'],
          lessons: [
            buildLesson({
              id: 'les-w2-1',
              position: 1,
              title: 'Preventing Double-Submit Bugs in Web Forms',
              introduction: 'Users double-click submit buttons on slow networks. Combine UI locking with deterministic idempotency keys.',
              objectives: ['Implement click-lock + deduplicated mutations'],
              estMinutes: 35,
              blocks: [{ id: 'w2b1', type: 'paragraph', text: 'Always guard async form submissions by disabling the button immediately on submit and re-enabling only inside error recovery.' }],
              summary: 'Clean state transitions protect data integrity.',
              takeaways: ['Never trust raw user text in unescaped HTML templates'],
            }),
          ],
        },
      ],
    }
  );

  addAssessment({
    id: 'quiz-web1-final',
    skillId: 'skill-web-development',
    courseId: 'course-web-1',
    quizType: 'skill_check',
    title: 'Web Foundations & Accessibility Exam',
    description: 'Verifies semantic HTML, WCAG AA contrast, and responsive CSS layout fluency.',
    passPercent: 75,
    questions: [
      {
        questionType: 'multiple_choice',
        marks: 1,
        prompt: 'What is the minimum WCAG AA contrast ratio for normal body text?',
        options: ['2.5:1', '3.0:1', '4.5:1', '7.0:1'],
        correctIndex: 2,
        explanation: 'WCAG AA requires 4.5:1 for normal text and 3:1 for large text.',
      },
      {
        questionType: 'fill_blank',
        marks: 1,
        prompt: 'Fill in the blank: Use the semantic <______> element for the primary navigation block of a page.',
        acceptedAnswers: ['nav'],
        explanation: '<nav> exposes a clear navigation landmark to assistive technology.',
      },
    ],
  });

  challenges.push({
    id: 'chal-web1-audit',
    skillId: 'skill-web-development',
    courseId: 'course-web-1',
    title: 'Accessible Responsive Card Grid & Audit',
    brief: 'Build or inspect a responsive 3-card web page and submit a structured audit covering semantic landmarks, keyboard focus order, and contrast verification.',
    instructions: 'Include screenshot or code link plus your 4-part accessibility check.',
    expectedDeliverables: ['Live/Repo link or code snippet', 'Accessibility audit summary'],
    submissionFormat: 'URL, file, or structured text',
    deliverableHint: 'Share a GitHub/CodePen link or paste your semantic HTML/CSS and audit notes.',
    maxScore: 20,
    passingScore: 14,
    rubric: [
      { id: 'wb-r1', label: 'Semantic HTML Landmarks', description: 'Proper header, main, nav, heading order.', maxPoints: 5 },
      { id: 'wb-r2', label: 'Keyboard & Focus Order', description: 'All controls reachable without mouse.', maxPoints: 5 },
      { id: 'wb-r3', label: 'Contrast & Legibility', description: 'Passes 4.5:1 normal text ratio.', maxPoints: 5 },
      { id: 'wb-r4', label: 'Responsive Grid Fidelity', description: 'Zero horizontal scroll on mobile.', maxPoints: 5 },
    ],
  });

  // =========================================================================
  // 8. CAREER & PROFESSIONAL: CV & Resume Writing (1 Course)
  // =========================================================================
  courses.push({
    id: 'course-cv-1',
    skillId: 'skill-cv-resume-writing',
    slug: 'impact-driven-cv-resume-writing',
    title: 'Impact-Driven CV & Resume Writing',
    description: 'Transform passive job-duty bullets into measurable accomplishment statements tailored cleanly for human reviewers and ATS systems.',
    difficulty: 'Beginner',
    estimatedDurationWeeks: 2,
    recommendedWeeklyHours: 3,
    recommendedSchedule: '2 short sprints over 2 weeks',
    prerequisites: [],
    outcomes: ['Write XYZ accomplishment bullets (Accomplished X, measured by Y, by doing Z)', 'Format clean single-column ATS-safe CVs'],
    phases: [
      {
        id: 'ph-cv-1',
        position: 1,
        title: 'Phase 1: Outcome Bullets & Role Tailoring',
        summary: 'Show measurable results instead of copying old job descriptions.',
        difficulty: 'Beginner',
        estHours: 3,
        objectives: ['Rewrite 5 responsibility bullets into measurable outcomes'],
        completionRequirements: ['Complete XYZ bullets lesson'],
        lessons: [
          buildLesson({
            id: 'les-cv-1',
            position: 1,
            title: 'The Action–Metric–Method (XYZ) Bullet Formula',
            introduction: 'Recruiters scan CVs in seconds. Concrete numbers and scope immediately separate your work from vague summaries.',
            objectives: ['Convert duties into impact statements'],
            estMinutes: 25,
            blocks: [
              { id: 'cvb1', type: 'example', title: 'Duty vs. Impact Bullet', body: 'Duty: "Managed social media accounts."\nImpact: "Grew Instagram engagement by 38% across 90 days by launching a weekly 4-pillar carousel calendar."' },
            ],
            summary: 'Quantify scale, speed, quality, or cost saved wherever possible.',
            takeaways: ['Start every bullet with a clear active verb'],
          }),
        ],
      },
    ],
  });

  challenges.push({
    id: 'chal-cv-tailor',
    skillId: 'skill-cv-resume-writing',
    courseId: 'course-cv-1',
    title: 'Tailored 1-Page CV & 4 XYZ Accomplishment Bullets',
    brief: 'Submit a clean 1-page CV tailored to a specific role on Kord Opportunities (or your target job) with at least 4 rewritten XYZ impact bullets.',
    instructions: 'Avoid multi-column decorative tables that scramble ATS parsers.',
    expectedDeliverables: ['CV PDF/Doc upload or link', 'Brief note highlighting 4 rewritten XYZ bullets'],
    submissionFormat: 'File upload, link, or pasted CV text',
    deliverableHint: 'Attach your CV file or paste your summary and rewritten bullets.',
    maxScore: 20,
    passingScore: 14,
    rubric: [
      { id: 'cv-r1', label: 'Role Tailoring & Summary', description: 'Clear alignment to target role.', maxPoints: 5 },
      { id: 'cv-r2', label: 'XYZ Impact Bullets', description: 'Measurable outcomes instead of passive duties.', maxPoints: 5 },
      { id: 'cv-r3', label: 'Clean ATS-Safe Formatting', description: 'Readable scannable hierarchy.', maxPoints: 5 },
      { id: 'cv-r4', label: 'Concise Proofread Polish', description: 'Zero typos or filler clichés.', maxPoints: 5 },
    ],
  });

  return {
    courses,
    quizzes,
    privateQuizAnswers,
    challenges,
  };
}
