/**
 * Curriculum Expansion & Domain Textbook Synthesis Engine
 *
 * Transforms compact course/lesson domain specifications across Kord's 59 catalog
 * courses into cohesive, textbook-grade instructional chapters (~800–1,100 words),
 * concrete Practical Applications, 3–4 Learning Objectives, and 3–4 meaningful
 * post-submission Assessment Questions without breaking Schema v1.0 compatibility.
 */

/** @typedef {'communication' | 'writing' | 'business' | 'marketing' | 'creative' | 'tech' | 'career'} CurriculumDomain */

const CODE_TO_DOMAIN = /** @type {Record<string, CurriculumDomain>} */ ({
  ec: 'communication', bc: 'communication', pc: 'communication', ns: 'communication',
  pi: 'communication', al: 'communication', cr: 'communication', ei: 'communication',
  lt: 'communication', ct: 'communication', ps: 'communication', pr: 'communication',
  nr: 'communication',
  gw: 'writing', pw: 'writing', bw: 'writing', cw: 'writing', st: 'writing',
  cp: 'writing', tw: 'writing', aw: 'writing', rw: 'writing', ew: 'writing',
  bl: 'writing', sw: 'writing', cs: 'writing', ep: 'writing', seo: 'writing',
  en: 'business', bd: 'business', bp: 'business', sf: 'business', bm: 'business',
  mr: 'business', fl: 'business', sb: 'business', sa: 'business', crm: 'business',
  br: 'business', pm: 'business', pj: 'business', sth: 'business', bn: 'business',
  smm: 'marketing', psa: 'marketing', sem: 'marketing', ecl: 'marketing', mac: 'marketing',
  uux: 'creative', cbi: 'creative', pvm: 'creative',
  wdv: 'tech', bdf: 'tech', mat: 'tech', cdc: 'tech', dam: 'tech',
  cvm: 'career', rwp: 'career', fcf: 'career',
});

/** @type {Record<CurriculumDomain, {
 *   practitioner: string;
 *   stakeholder: string;
 *   artifactNoun: string;
 *   domainPrinciples: string[];
 *   diagnosticQuestions: string[];
 *   pitfallPatterns: Array<{ trap: string; symptom: string; fix: string }>;
 *   qualityLens: string[];
 * }>} */
const DOMAIN_KNOWLEDGE = {
  communication: {
    practitioner: 'communicator',
    stakeholder: 'listeners and collaborators',
    artifactNoun: 'conversation or briefing',
    domainPrinciples: [
      'Clarity is judged by what the receiver accurately retains and acts upon, not by how fluent or thorough the speaker felt while delivering it.',
      'High-stakes interactions fail most often in the unstated assumptions between turns: implicit expectations around ownership, timing, and risk tolerance.',
      'Deliberate structure—naming purpose before supporting detail—reduces defensive listening because people do not have to guess where an argument is heading.',
      'Emotional pacing matters as much as word choice: rushing through sensitive updates compresses listening bandwidth and invites misinterpretation.',
    ],
    diagnosticQuestions: [
      'What exact understanding, alignment, or decision must exist once this exchange ends?',
      'Which acronym, background constraint, or deadline have I assumed the other person already knows?',
      'What could someone misread if they hear only the opening twenty seconds or scan only the first two lines?',
      'How will both sides verify shared meaning before dispersing into independent work?',
    ],
    pitfallPatterns: [
      {
        trap: 'Chronological narration before stating the point',
        symptom: 'Listeners tune out halfway through background history while trying to guess what action is being requested.',
        fix: 'State the headline conclusion or ask in the opening two sentences, then supply only the context needed to evaluate it.',
      },
      {
        trap: 'Treating polite silence as genuine agreement',
        symptom: 'People nod in the moment to end discomfort, then act on conflicting mental models later in the week.',
        fix: 'Invite concrete paraphrase or ask an open calibration check such as what edge cases or constraints look different from their vantage point.',
      },
      {
        trap: 'Escalating friction inside low-bandwidth text channels',
        symptom: 'Short written replies get read with unintended hostility, multiplying back-and-forth clarifications without progress.',
        fix: 'Move ambiguous or emotionally charged disagreements onto a short live voice or video call, then confirm agreed decisions in writing.',
      },
    ],
    qualityLens: [
      'Intent and next step are unmistakable without reading between the lines.',
      'Tone respects the listener’s time, emotional state, and decision authority.',
      'Closing verification leaves zero ambiguity around owners, standards, and timestamps.',
    ],
  },
  writing: {
    practitioner: 'writer',
    stakeholder: 'target readers',
    artifactNoun: 'written draft',
    domainPrinciples: [
      'Readers scan with limited working memory; clear syntax puts the real actor and concrete action early so comprehension stays effortless.',
      'Good structure separates drafting from editing: first capture complete logic and evidence, then cut filler, fix transitions, and tighten rhythm.',
      'Every section and paragraph needs one governing job—when two competing arguments share a paragraph, skimmers lose both.',
      'Tone and detail density must match the reader’s task: operational readers want direct instructions, whereas executive readers want implications first.',
    ],
    diagnosticQuestions: [
      'If a busy reader inspects only headings and opening sentences, do they still follow the complete argument?',
      'Where do abstract nouns, passive constructions, or hedged qualifiers obscure who is responsible for acting?',
      'Does each paragraph open from familiar context before introducing new evidence at the end of sentences?',
      'Which two lines or transitions can be tightened or cut without losing factual precision?',
    ],
    pitfallPatterns: [
      {
        trap: 'Throat-clearing openings and buried main claims',
        symptom: 'Readers wade through three paragraphs of historical setup before discovering why the document exists.',
        fix: 'Move the bottom-line claim into the opening paragraph and promote supporting reasons into scannable subheadings.',
      },
      {
        trap: 'Editing word choice before fixing macro structure',
        symptom: 'Polished sentences sit inside an illogical sequence, forcing full rewrites once reviewers point out missing logic.',
        fix: 'Verify outline sequence and paragraph topic sentences via reverse-outlining before polishing phrasing or punctuation.',
      },
      {
        trap: 'Writing for internal vanity instead of reader workflow',
        symptom: 'Dense domain jargon and long wall-of-text blocks force readers to ask clarifying questions in follow-up messages.',
        fix: 'Translate specialist terminology into plain concrete language and test the draft aloud for breath and cadence.',
      },
    ],
    qualityLens: [
      'Every heading and topic sentence makes a specific factual or directional promise.',
      'Concrete verbs and active actors keep average sentence complexity easy to parse on first read.',
      'The closing pass verifies factual accuracy, consistent formatting, and zero stray typos.',
    ],
  },
  business: {
    practitioner: 'operator',
    stakeholder: 'customers, teammates, and partners',
    artifactNoun: 'operating plan or brief',
    domainPrinciples: [
      'Durable commercial decisions test real behavior and unit economics before committing irreversible cash, headcount, or long vendor contracts.',
      'Surface revenue without margin discipline hides cash burn; operators watch contribution margin, payback cycles, and collection timing together.',
      'Cross-functional execution breaks down at handoffs where scope, acceptance criteria, and fallback ownership stay implied rather than written.',
      'Listening closely to customer friction and operational bottlenecks reveals leverage that internal brainstorming sessions rarely spot.',
    ],
    diagnosticQuestions: [
      'What is the riskiest commercial or operational assumption here, and how can we test it cheaply in days rather than months?',
      'Do the unit numbers—price, variable fulfillment cost, acquisition cost, and cash timing—still hold under conservative volume?',
      'Who owns each deliverable handoff, and what concrete metric confirms whether execution succeeded?',
      'What happens to customer trust and operating capacity if demand rises or slips by thirty percent?',
    ],
    pitfallPatterns: [
      {
        trap: 'Scaling overhead ahead of verified customer pull',
        symptom: 'Fixed commitments—custom software, long leases, or extra inventory—lock up cash before repeat demand is proven.',
        fix: 'Deliver pilot value manually or at small batch scale first until retention and conversion math repeat reliably.',
      },
      {
        trap: 'Confusing top-line activity with healthy unit economics',
        symptom: 'Sales volume rises while net cash shrinks due to unpriced support overhead, discounting, or slow receivable collection.',
        fix: 'Track gross contribution per unit alongside working-capital timing every week rather than waiting for quarter-end close.',
      },
      {
        trap: 'Ambiguous prioritization across competing stakeholder asks',
        symptom: 'Teams stay busy shipping low-leverage tasks while critical bottlenecks remain unresolved.',
        fix: 'Anchor weekly decisions to measurable constraints and explicitly name what will not be pursued this cycle.',
      },
    ],
    qualityLens: [
      'Assumptions are separated cleanly from observed customer and financial evidence.',
      'Trade-offs state explicit costs, downside boundaries, and measurable triggers for adjustment.',
      'Next steps specify accountable owners, timelines, and verification criteria.',
    ],
  },
  marketing: {
    practitioner: 'marketer',
    stakeholder: 'prospective buyers',
    artifactNoun: 'campaign asset or funnel brief',
    domainPrinciples: [
      'Effective marketing aligns message-match across the whole buyer path: the promise in the hook must mirror the landing page and offer immediately.',
      'Channel tactics fail when they compensate for vague audience research; real customer wording converts better than clever internal slogans.',
      'Vanity reach without qualified intent wastes budget—healthy programs tie creative angles to downstream leads, activation, and payback.',
      'Iterative optimization requires changing one meaningful variable per test with enough sample discipline to separate signal from noise.',
    ],
    diagnosticQuestions: [
      'Does this message speak directly to a buyer pain, trigger event, or desired outcome in their own everyday language?',
      'Where is the sharpest friction drop-off between initial impression, click, landing page read, and action completion?',
      'Which single conversion metric justifies spend here, and how is attribution tracked cleanly without double counting?',
      'What hypothesis are we testing next if creative engagement fatigues or acquisition cost climbs?',
    ],
    pitfallPatterns: [
      {
        trap: 'Broken message-match between ad hook and destination page',
        symptom: 'Click-through rates look encouraging while landing-page bounce rates spike and conversions stall.',
        fix: 'Mirror the primary hook promise, proof element, and specific call-to-action directly above the fold on the destination page.',
      },
      {
        trap: 'Optimizing surface vanity metrics over commercial funnel outcomes',
        symptom: 'Campaign dashboards celebrate impressions and likes while cost per qualified lead quietly deteriorates.',
        fix: 'Evaluate campaigns bottom-up from qualified pipeline, customer acquisition cost, and payback alongside engagement diagnostics.',
      },
      {
        trap: 'Tweaking micro-details while ignoring offer and audience fit',
        symptom: 'Button-color A/B tests stall with flat results because prospects do not grasp why the core offer matters right now.',
        fix: 'Test major value-proposition angles, objection handling, and audience triggers before micro-optimizing UI polish.',
      },
    ],
    qualityLens: [
      'Audience problem, value proposition, and concrete call-to-action connect without friction.',
      'Tracking parameters, naming taxonomy, and attribution windows stay consistent across launches.',
      'Optimization tests declare hypothesis, primary metric, and decision rule before going live.',
    ],
  },
  creative: {
    practitioner: 'designer',
    stakeholder: 'viewers and product users',
    artifactNoun: 'visual design or prototype',
    domainPrinciples: [
      'Design solves communication and usability problems inside explicit constraints—visual polish without hierarchy still leaves users lost.',
      'Deliberate contrast in scale, weight, spacing, and color guides attention sequentially from primary focal point to supporting action.',
      'Rapid low-fidelity exploration protects teams from falling in love with their first mediocre composition before testing alternatives.',
      'Clean production discipline—consistent naming, reusable styles, accessible contrast, and verified exports—keeps creative work shippable across media.',
    ],
    diagnosticQuestions: [
      'When viewed at small scale or squinted at briefly, what single focal element commands attention first?',
      'Does generous negative space separate distinct groupings clearly, or do borders and competing accents clutter the canvas?',
      'Are all foreground/background pairings readable across real lighting, mobile viewports, and assistive contrast standards?',
      'Can another teammate open the source file tomorrow and edit components, layers, and export presets cleanly?',
    ],
    pitfallPatterns: [
      {
        trap: 'Decorating weak layout structure with extra gradients and badges',
        symptom: 'The canvas looks busy yet viewers hesitate to identify the main headline, key takeaway, or action trigger.',
        fix: 'Strip ornaments back to black-and-white wireframe hierarchy first until spacing and scale alone guide the eye cleanly.',
      },
      {
        trap: 'Designing solely on a large bright studio monitor',
        symptom: 'Small body captions, subtle gray labels, and cramped tap targets become unusable on real phones or printed stock.',
        fix: 'Inspect compositions at true 1:1 mobile viewport or physical print proof size and verify contrast ratios numerically.',
      },
      {
        trap: 'Skipping structured feedback and usability observation',
        symptom: 'Internal taste debates drag on while first-time users stumble over labels or navigation assumptions immediately.',
        fix: 'Observe three to five target users completing concrete tasks silently and fix actual comprehension bottlenecks first.',
      },
    ],
    qualityLens: [
      'Clear focal entry point and balanced alignment grid hold together across viewports.',
      'Typography, color palette, and spacing tokens follow consistent visual rhythm.',
      'Deliverables ship in clean resolution, aspect ratio, and color profile matching target output.',
    ],
  },
  tech: {
    practitioner: 'engineer',
    stakeholder: 'users and engineering teammates',
    artifactNoun: 'implementation module',
    domainPrinciples: [
      'Clean software separates concerns deliberately—data state, validation rules, and UI/API boundaries—so changes stay local rather than cascading bugs.',
      'Security, accessibility, and input validation belong inside the core design from line one, never bolted on after features appear finished.',
      'Small atomic increments verified against edge cases beat giant unreviewed rewrites that obscure which change broke existing behavior.',
      'Readable naming, explicit error handling, and reproducible checks turn solo prototypes into systems teammates can safely maintain.',
    ],
    diagnosticQuestions: [
      'What happens when inputs are empty, malformed, slow to arrive, or controlled purely via keyboard navigation?',
      'Could untrusted strings or unvalidated parameters alter markup, database queries, or authorization boundaries?',
      'Is single-source-of-truth state clearly separated from derived rendering or formatting helpers?',
      'How can another developer reproduce, verify, and safely roll back this change if production metrics regress?',
    ],
    pitfallPatterns: [
      {
        trap: 'Happy-path implementation without boundary or failure handling',
        symptom: 'Demos work on clean sample records yet crash or corrupt state silently on missing fields, latency, or unexpected types.',
        fix: 'Validate boundaries explicitly with guard clauses, safe defaults, and automated edge-case tests before merging.',
      },
      {
        trap: 'Coupling presentation markup directly with raw mutable state and unsafe HTML',
        symptom: 'Small UI tweaks break event listeners, create duplicate state, or open injection flaws via unescaped strings.',
        fix: 'Render deterministically from explicit state, escape untrusted text strictly, and delegate events cleanly.',
      },
      {
        trap: 'Shipping large unverified diffs without reproducible checks',
        symptom: 'Regressions surface late in production because local environments hid path, migration, or dependency assumptions.',
        fix: 'Commit small logical units, run type/lint/test checks before push, and verify production behavior cleanly post-deploy.',
      },
    ],
    qualityLens: [
      'Boundary validation, safe escaping, and error recovery handle malformed inputs cleanly.',
      'Modules remain decoupled, readable, and easy for a teammate to reason about without guesswork.',
      'Verification covers happy paths, failure paths, and cross-environment consistency.',
    ],
  },
  career: {
    practitioner: 'professional',
    stakeholder: 'hiring leads, clients, and teammates',
    artifactNoun: 'career or client deliverable',
    domainPrinciples: [
      'Decision-makers judge capability through concrete evidence of solved problems and reliable follow-through—not generic self-descriptions.',
      'Sustainable career and freelance momentum relies on clear scope boundaries, calm async visibility, and repeatable daily focus blocks.',
      'Preparing crisp STAR proof stories and quantified portfolio artifacts lowers interview and client-pitch anxiety by turning performance into recallable facts.',
      'Proactive clarity around expectations, rates, timelines, and feedback protects trust while preventing quiet burnout.',
    ],
    diagnosticQuestions: [
      'What specific measurable problem, action, and outcome does this artifact prove within the first fifteen seconds of review?',
      'Where could unclear scope, unspoken deadlines, or missing status updates create anxiety for the client or manager?',
      'Does my weekly schedule guard deep uninterrupted execution blocks away from reactive chat noise?',
      'What financial reserve, pricing floor, or skill investment protects long-term flexibility over the next six months?',
    ],
    pitfallPatterns: [
      {
        trap: 'Listing responsibilities instead of demonstrating concrete outcomes',
        symptom: 'CVs, portfolios, and client proposals blend into indistinguishable buzzwords that fail to earn interviews.',
        fix: 'Rewrite every bullet and case summary around problem context, specific action taken, and measurable before/after impact.',
      },
      {
        trap: 'Accepting vague verbal scope to appear agreeable',
        symptom: 'Extra unbilled revisions, shifting deadlines, and late scope surprises erode margins and goodwill on both sides.',
        fix: 'Confirm deliverables, revision caps, turnaround windows, and payment milestones in brief clear writing before starting.',
      },
      {
        trap: 'Confusing constant instant chat availability with deep productivity',
        symptom: 'Days fragment into shallow replies while major deliverables slip into stressful late-night crunches.',
        fix: 'Batch communication windows, share crisp asynchronous progress notes, and block focused deep-work hours daily.',
      },
    ],
    qualityLens: [
      'Evidence leads immediately with concrete problem context, personal contribution, and verified impact.',
      'Agreements, expectations, and follow-ups remain documented clearly in plain accessible language.',
      'Workflows protect focused execution energy alongside honest client or team communication.',
    ],
  },
};

/** @param {string} str */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** @param {string} s */
function stripTrailingPeriod(s) {
  return String(s || '').trim().replace(/[.?!]+$/, '');
}

/** @param {string} s */
function ensureSentence(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  return /[.?!]$/.test(t) ? t : `${t}.`;
}

/** @param {string} s */
function lowerFirst(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (/^[A-Z0-9]{2,}/.test(t)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** @param {string} s */
function cleanInlineTags(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Rotates options deterministically so correct answers distribute across indices 0, 1, 2
 * without ever mutating authoring semantics.
 *
 * @param {string[]} options
 * @param {number} correctIndex
 * @param {number} targetIndex
 */
function rotateOptionsToIndex(options, correctIndex, targetIndex) {
  const clean = options.map((o) => cleanInlineTags(o)).filter(Boolean);
  if (clean.length < 2) return { options: clean, correctIndex: 0 };
  const safeCorrect = Math.max(0, Math.min(clean.length - 1, Number(correctIndex || 0)));
  const safeTarget = Math.max(0, Math.min(clean.length - 1, targetIndex % clean.length));
  if (safeCorrect === safeTarget) return { options: clean, correctIndex: safeCorrect };

  const correctVal = clean[safeCorrect];
  const others = clean.filter((_, idx) => idx !== safeCorrect);
  const reordered = [];
  for (let i = 0; i < clean.length; i += 1) {
    if (i === safeTarget) {
      reordered.push(correctVal);
    } else {
      reordered.push(others.shift() || '');
    }
  }
  return { options: reordered, correctIndex: safeTarget };
}

/**
 * Expands a single domain lesson specification into rich, continuous textbook-grade
 * Lesson data (~800–1,100 main words, 3–4 objectives, concrete Practical Application,
 * concise summary/takeaways, and 3–4 assessment questions).
 *
 * @param {{
 *   cfg: import('../../types/kord.d.ts').DomainCourseConfig;
 *   mod: import('../../types/kord.d.ts').DomainCourseModule;
 *   modIndex: number;
 *   lesson: import('../../types/kord.d.ts').DomainLessonItem;
 *   lessonIndex: number;
 *   siblingLesson: import('../../types/kord.d.ts').DomainLessonItem | null;
 *   allCourseDefs: Array<{ term: string; meaning: string; lessonTitle: string }>;
 *   readingPool: Array<{ title: string; source?: string; url: string; resourceType?: string }>;
 * }} ctx
 */
export function expandDomainLessonSpec(ctx) {
  const { cfg, mod, modIndex, lesson: l, lessonIndex, siblingLesson, allCourseDefs, readingPool } = ctx;
  const domain = CODE_TO_DOMAIN[cfg.code] || 'business';
  const dk = DOMAIN_KNOWLEDGE[domain];
  const seedHash = hashString(`${cfg.code}:${modIndex}:${lessonIndex}:${l.t}`);

  const term = cleanInlineTags(l.def?.[0] || l.h || l.t);
  const meaning = ensureSentence(l.def?.[1] || l.exp);
  const exTitle = cleanInlineTags(l.ex?.[0] || `Worked Walkthrough: ${l.t}`);
  const exBody = ensureSentence(l.ex?.[1] || l.exp);
  const csTitle = cleanInlineTags(l.cs?.[0] || `${l.t} in Practice`);
  const csScenario = ensureSentence(l.cs?.[1] || l.exp);
  const csTakeaway = ensureSentence(l.cs?.[2] || l.sum);
  const tipTitle = cleanInlineTags(l.tip?.[0] || 'Practitioner Standard');
  const tipBody = ensureSentence(l.tip?.[1] || l.sum);
  const steps = Array.isArray(l.steps) ? l.steps.map((s) => ensureSentence(s)).filter(Boolean) : [];
  const takeaways = Array.isArray(l.tk) ? l.tk.map((t) => stripTrailingPeriod(t)).filter(Boolean) : [];

  const pitfall = dk.pitfallPatterns[(modIndex + lessonIndex + (seedHash % 3)) % dk.pitfallPatterns.length];
  const secondPitfall = dk.pitfallPatterns[(modIndex + lessonIndex + 1) % dk.pitfallPatterns.length];
  const principleA = dk.domainPrinciples[(modIndex + lessonIndex) % dk.domainPrinciples.length];
  const principleB = dk.domainPrinciples[(modIndex + lessonIndex + 2) % dk.domainPrinciples.length];
  const diagQ1 = dk.diagnosticQuestions[(modIndex * 2 + lessonIndex) % dk.diagnosticQuestions.length];
  const diagQ2 = dk.diagnosticQuestions[(modIndex * 2 + lessonIndex + 1) % dk.diagnosticQuestions.length];
  const qualityPoint = dk.qualityLens[(modIndex + lessonIndex) % dk.qualityLens.length];

  // 1. Expand Learning Objectives to 3–4 crisp, measurable targets
  const baseObjectives = Array.isArray(l.o) ? l.o.map((x) => stripTrailingPeriod(x)).filter(Boolean) : [];
  const objectiveCandidates = [
    ...baseObjectives,
    `Define ${term} and explain how it prevents failure in ${lowerFirst(mod.t.replace(/^Module \d+:\s*/i, ''))}`,
    steps[0]
      ? `Execute a structured workflow for ${lowerFirst(l.t)} starting from: ${stripTrailingPeriod(steps[0])}`
      : `Apply ${lowerFirst(l.t)} systematically to real deliverables`,
    `Diagnose common failure signals seen in "${csTitle}" and verify quality before delivery`,
  ];
  /** @type {string[]} */
  const objectives = [];
  const seenObj = new Set();
  for (const cand of objectiveCandidates) {
    const norm = cand.toLowerCase();
    if (cand.length >= 10 && !seenObj.has(norm)) {
      seenObj.add(norm);
      objectives.push(cand);
    }
    if (objectives.length >= 4) break;
  }

  // 2. Build Continuous Textbook-Grade Main Instructional Blocks (~800–1,050 words)
  const modLabel = mod.t.replace(/^Module \d+:\s*/i, '').trim();
  const lessonSlot = modIndex * 2 + lessonIndex;

  const siblingIntroClean = siblingLesson?.intro ? ensureSentence(siblingLesson.intro) : '';
  const siblingRef = siblingLesson
    ? lessonIndex === 0
      ? `Getting this foundation right prepares you directly for the next lesson in the module, "${siblingLesson.t}". ${siblingIntroClean}`
      : `Building directly on "${siblingLesson.t}", this chapter turns core principles into reliable day-to-day execution inside ${modLabel}.`
    : `Within ${modLabel}, this topic connects foundational reasoning directly to finished deliverable quality.`;

  const stageNote =
    modIndex < 2
      ? `Early in ${cfg.title}, resisting the impulse to rush straight to polished artifacts pays huge dividends: clarifying the underlying mental model now eliminates the rework that slows down unpracticed beginners.`
      : modIndex < 4
        ? `At this intermediate point in ${cfg.title}, simple checklist compliance is no longer enough—experienced ${dk.practitioner}s weigh competing constraints deliberately, catch edge cases early, and adapt choices to real stakeholder conditions.`
        : `In the later stages of ${cfg.title}, technical and procedural accuracy must hold up under deadline pressure, imperfect inputs, and cross-team review—where combining habits across modules separates dependable practitioners from novices.`;

  const introContextPara = `${ensureSentence(l.exp)} Formally, **${term}** refers to ${lowerFirst(meaning)} ${principleA} ${siblingRef}`;

  const mechanicsLeadVariants = [
    `Knowing why this principle holds under pressure matters just as much as memorizing individual rules. Whenever a ${dk.practitioner} skips or misapplies **${term}**, friction rarely stays isolated in one step; instead, ${lowerFirst(pitfall.symptom)}`,
    `Why does this distinction change real outcomes so sharply? Because once **${term}** breaks down mid-workflow, downstream steps inherit hidden errors—most visibly when ${lowerFirst(pitfall.symptom)}`,
    `Examining the underlying mechanics clarifies why experienced ${dk.practitioner}s guard **${term}** closely. Without that structural discipline, predictable bottlenecks surface fast: ${lowerFirst(pitfall.symptom)}`,
    `Most avoidable mistakes around ${lowerFirst(l.t)} begin long before final delivery. When teams neglect **${term}**, problems compound quietly until ${lowerFirst(pitfall.symptom)}`,
  ];
  const mechanicsPara = `${mechanicsLeadVariants[lessonSlot % mechanicsLeadVariants.length]} ${stageNote} Before committing to a direction with ${dk.stakeholder}, test two practical diagnostic questions: ${diagQ1} ${diagQ2}`;

  const demoLeadVariants = [
    `To see these principles operating on real material, study **${exTitle}**: ${exBody} Look closely at what distinguishes deliberate execution from improvised guesswork here.`,
    `Concrete examples make abstract rules immediate. Consider **${exTitle}**: ${exBody} Notice how the stronger version eliminates ambiguity upfront rather than hoping ${dk.stakeholder} read between the lines.`,
    `In **${exTitle}**, the difference between fragile and dependable practice becomes concrete: ${exBody} Rather than rushing straight into surface decoration, structure leads the choice.`,
    `Walk through **${exTitle}** to observe how this technique performs in real conditions: ${exBody} The contrast highlights why intentional framing prevents confusion downstream.`,
  ];
  const workedWalkthroughIntro = `${demoLeadVariants[(lessonSlot + 1) % demoLeadVariants.length]} Instead of treating ${lowerFirst(l.t)} as an isolated box to tick, the stronger path aligns core purpose first so ${dk.stakeholder} immediately follow each decision. ${principleB}`;

  const workflowGuidancePara = `Turning ${lowerFirst(l.t)} into a repeatable habit requires moving sequentially through the steps above rather than jumping prematurely to final formatting. ${steps.map((st, idx) => `During step ${idx + 1} (${stripTrailingPeriod(st)}), verify that earlier constraints still hold before locking the next choice.`).join(' ')} Keeping every step transparent also streamlines peer review, allowing collaborators to address specific gaps rather than guessing at intent.`;

  const tradeOffVariants = [
    `Live work rarely arrives with unlimited schedule slack, spotless inputs, or single-stakeholder consensus. Dependable ${dk.practitioner}s separate surface speed from structural resilience—testing how **${term}** holds up when priorities tighten mid-week. As a reliable standard, remember **${tipTitle}**: ${tipBody}`,
    `Real constraints force deliberate trade-offs between quick short-term output and lasting clarity. When budgets or timelines narrow, keeping **${term}** intact protects trust with ${dk.stakeholder} vastly better than cutting foundational corners. Apply **${tipTitle}** consistently: ${tipBody}`,
    `Theory looks effortless in calm examples, whereas real projects test judgement under shifting constraints. Balancing speed against accuracy around ${lowerFirst(l.t)} comes down to guarding **${term}** before polishing surface details—guided directly by **${tipTitle}**: ${tipBody}`,
  ];
  const tradeOffIntro = tradeOffVariants[lessonSlot % tradeOffVariants.length];

  const caseLeadVariants = [
    `Examine the operational breakdown documented in **${csTitle}**. ${csScenario} At first glance, setbacks like this look like isolated bad luck; closer inspection reveals the classic failure pattern of ${lowerFirst(pitfall.trap)}. ${csTakeaway}`,
    `Real-world projects routinely expose hidden gaps, as illustrated in **${csTitle}**. ${csScenario} What made that outcome avoidable was spotting the root cause early—specifically ${lowerFirst(pitfall.trap)}. ${csTakeaway}`,
    `A clear cautionary lesson appears in **${csTitle}**: ${csScenario} Notice how quickly ${lowerFirst(pitfall.trap)} cascades into wasted effort across ${dk.stakeholder}. ${csTakeaway}`,
  ];
  const caseAnalysisPara = `${caseLeadVariants[(lessonSlot + 2) % caseLeadVariants.length]} Whenever early warning signs look like ${lowerFirst(secondPitfall.symptom)}, pushing harder along the flawed path only multiplies rework; step back immediately and apply **${tipTitle}**: ${tipBody}`;

  const avoidancePara = `Three recurring mistakes account for most early stumbles with ${lowerFirst(l.t)}. First is rushing past upfront diagnosis—assuming context is obvious—which leaves hidden gaps unchallenged until late revisions hit. Second is treating **${term}** as an optional formality rather than an active decision filter; ${lowerFirst(pitfall.fix)} Third is shipping the finished ${dk.artifactNoun} without running an independent quality check. Before signing off, verify these core standards: ${takeaways.map((t) => lowerFirst(t)).join('; ')}. Above all, ${lowerFirst(qualityPoint)}`;

  /** @type {import('../../types/kord.d.ts').LessonBlock[]} */
  const mainBlocks = [
    { type: 'heading', level: 2, text: l.h },
    { type: 'paragraph', text: introContextPara },
    { type: 'paragraph', text: mechanicsPara },

    { type: 'heading', level: 2, text: `Worked Demonstration: ${exTitle}` },
    { type: 'paragraph', text: workedWalkthroughIntro },
    ...(steps.length > 0
      ? [
          {
            type: 'steps',
            title: `Execution Sequence for ${l.t}`,
            items: steps,
          },
        ]
      : []),
    { type: 'paragraph', text: workflowGuidancePara },

    { type: 'heading', level: 2, text: 'Decision Standards & Operational Trade-Offs' },
    { type: 'paragraph', text: tradeOffIntro },
    {
      type: 'table',
      title: `Evaluating ${l.t}: Fragile vs. Disciplined Practice`,
      headers: ['Dimension', 'Common Fragile Shortcut', 'Disciplined Standard'],
      rows: [
        [
          `Applying ${term}`,
          `Assumed implicitly or skipped under deadline pressure`,
          `${meaning}`,
        ],
        [
          'Workflow Sequence',
          pitfall.trap,
          steps[0] || `Follow ordered verification steps deliberately`,
        ],
        [
          'Verification Standard',
          secondPitfall.symptom,
          takeaways[0] ? ensureSentence(takeaways[0]) : qualityPoint,
        ],
        [
          tipTitle,
          'Relying on last-minute guesswork without peer calibration',
          tipBody,
        ],
      ],
    },

    { type: 'heading', level: 2, text: `Case Analysis & Common Mistakes: ${csTitle}` },
    { type: 'paragraph', text: caseAnalysisPara },
    { type: 'paragraph', text: avoidancePara },
  ];

  // 3. Concrete Lesson-Level Practical Application (`demonstration` block)
  const actTitle = cleanInlineTags(mod.act?.[0] || `${l.t} Applied Practice`);
  const actBrief = ensureSentence(mod.act?.[1] || `Apply ${l.t} directly to a realistic ${dk.artifactNoun}.`);
  const actInstr = ensureSentence(mod.act?.[2] || '');
  const actExpected = ensureSentence(mod.act?.[3] || `A verified ${dk.artifactNoun} applying ${term}.`);

  const pracInstructions = [
    `Apply the frameworks from "${l.t}" to build a concrete artifact connected to ${actTitle}. ${actBrief}`,
    `Execution steps: (1) Select one real or realistic scenario modeled on "${exTitle}". (2) Walk step-by-step through the sequence: ${steps.join(' ')} (3) Audit your draft against "${tipTitle}" (${stripTrailingPeriod(tipBody)}) and resolve any weak spots matching "${csTitle}". ${actInstr}`.trim(),
  ].join('\n\n');

  const pracOutcome = `A satisfactory submission clearly applies ${term} without relying on vague filler, explicitly addresses the failure pattern highlighted in "${csTitle}", and satisfies "${stripTrailingPeriod(actExpected)}" (${takeaways.slice(0, 2).join('; ') || qualityPoint}).`;

  mainBlocks.push({
    type: 'demonstration',
    title: `Applied Practice: ${l.t}`,
    instructions: pracInstructions,
    expectedOutcome: pracOutcome,
  });

  // 4. Meaningful Assessment Questions (3–4 distinct `knowledge_check` blocks)
  /** @type {Array<{ prompt: string; options: string[]; correctIndex: number; explanation: string }>} */
  const questions = [];

  // Q1: Original authored check (with balanced option position)
  if (l.chk && l.chk[0] && Array.isArray(l.chk[1]) && l.chk[1].length >= 2) {
    const q1 = rotateOptionsToIndex(l.chk[1], l.chk[2] ?? 0, seedHash % l.chk[1].length);
    questions.push({
      prompt: cleanInlineTags(l.chk[0]),
      options: q1.options,
      correctIndex: q1.correctIndex,
      explanation: ensureSentence(l.chk[3] || l.sum),
    });
  }

  // Q2: Concept precision check built using real sibling definitions from the same course
  const siblingDefs = allCourseDefs.filter(
    (d) => d.term.toLowerCase() !== term.toLowerCase() && d.meaning && d.meaning.length >= 25
  );
  if (siblingDefs.length >= 2 && meaning.length >= 20) {
    const d1 = siblingDefs[(modIndex + lessonIndex) % siblingDefs.length];
    const d2 = siblingDefs[(modIndex + lessonIndex + 3) % siblingDefs.length];
    const distractorMeanings = [ensureSentence(d1.meaning), ensureSentence(d2.meaning)];
    const uniqueOpts = Array.from(new Set([meaning, ...distractorMeanings]));
    if (uniqueOpts.length >= 3) {
      const q2Rot = rotateOptionsToIndex(uniqueOpts.slice(0, 3), 0, (seedHash + 1) % 3);
      questions.push({
        prompt: `Which description accurately defines "${term}" as applied in ${l.t}?`,
        options: q2Rot.options,
        correctIndex: q2Rot.correctIndex,
        explanation: `"${term}" means ${lowerFirst(meaning)} The remaining options describe "${d1.term}" and "${d2.term}", which address distinct parts of the workflow.`,
      });
    }
  }

  // Q3: Case diagnosis & recovery check
  const q3OptionsRaw = [
    csTakeaway,
    `Continue pushing the existing process faster without reviewing ${lowerFirst(term)} until final sign-off.`,
    `Delegate the bottleneck without documenting expectations, owners, or verification criteria.`,
  ];
  const q3Rot = rotateOptionsToIndex(q3OptionsRaw, 0, (seedHash + 2) % 3);
  questions.push({
    prompt: `When facing the breakdown pattern illustrated in "${csTitle}", which corrective response addresses the root cause most effectively?`,
    options: q3Rot.options,
    correctIndex: q3Rot.correctIndex,
    explanation: `${csTakeaway} Speeding up an uncalibrated process or handing off vague expectations repeats the underlying breakdown rather than fixing ${lowerFirst(term)}.`,
  });

  // Q4: Execution & Quality Verification check (included across odd/even balance or mastery lessons -> avg ~3.5 questions/lesson)
  if ((modIndex + lessonIndex) % 2 === 1 || questions.length < 3) {
    const bestPractice =
      takeaways.length >= 2
        ? `${ensureSentence(takeaways[0])} Additionally, ${lowerFirst(ensureSentence(takeaways[1]))}`
        : tipBody;
    const q4OptionsRaw = [
      bestPractice,
      `Skip upfront framing and rely purely on cosmetic formatting right before delivery.`,
      `Ignore early warning signs in "${csTitle}" as long as surface activity volume looks high.`,
    ];
    const q4Rot = rotateOptionsToIndex(q4OptionsRaw, 0, (seedHash + 3) % 3);
    questions.push({
      prompt: `Before considering a ${dk.artifactNoun} complete for "${l.t}", which verification habit best aligns with ${tipTitle}?`,
      options: q4Rot.options,
      correctIndex: q4Rot.correctIndex,
      explanation: `${tipBody} Cosmetic polish and high activity volume cannot substitute for verifying structural clarity and core takeaways.`,
    });
  }

  for (const q of questions) {
    mainBlocks.push({
      type: 'knowledge_check',
      prompt: q.prompt,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    });
  }

  const summary = `${ensureSentence(l.sum)} Mastering ${term} alongside consistent verification habits ensures "${l.t}" holds up reliably in independent practice.`;

  return {
    title: l.t,
    introduction: ensureSentence(l.intro),
    objectives,
    estMinutes: Math.max(25, Number(l.min || 28)),
    blocks: mainBlocks,
    summary,
    takeaways: takeaways.length >= 3 ? takeaways : [...takeaways, `Apply ${term} systematically before final delivery`],
    furtherReading: readingPool,
    completionCriteria: `Study the instructional article on "${l.t}", complete the practical application exercise, and answer all ${questions.length} assessment questions.`,
  };
}
