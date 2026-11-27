import type { SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'learner' | 'admin';
export type AccountStatus = 'active' | 'suspended';
export type PublicationStatus = 'draft' | 'published' | 'archived';
export type SkillLevel = 'declared' | 'practising' | 'demonstrated' | 'verified';
export type CourseCompletionState =
  | 'not_started'
  | 'in_progress'
  | 'awaiting_practical_assessment'
  | 'completed'
  | 'completed_verified';
export type SubmissionStatus = 'pending' | 'approved' | 'needs_revision';
export type AssessmentReviewStatus = 'auto_graded' | 'pending_review' | 'reviewed';

export interface KordUser {
  id: string;
  email: string;
  firstName: string;
  lastName?: string;
  fullName: string;
  role: UserRole;
  accountStatus: AccountStatus;
  password?: string;
  createdAt?: string;
}

export interface AuthSession {
  user: KordUser;
}

export interface AuthChangePayload {
  event: string;
  rawEvent?: string;
  session: AuthSession | null;
  crossTab?: boolean;
}

export interface RecoveryState {
  status: 'ready' | 'invalid_link' | 'missing_session';
  session: AuthSession | null;
  error: string | null;
}

export interface OAuthCallbackState {
  status: 'authenticated' | 'error' | 'missing_callback';
  session: AuthSession | null;
  error: string | null;
}

export interface SupabaseAuthErrorLike {
  message: string;
  status?: number;
  code?: string;
}

export interface SupabaseAuthUserLike {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface SupabaseAuthSessionLike {
  user: SupabaseAuthUserLike;
  access_token?: string;
  refresh_token?: string;
}

export interface SupabaseAuthLike {
  getSession(): Promise<{ data: { session: SupabaseAuthSessionLike | null }; error: SupabaseAuthErrorLike | null }>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: SupabaseAuthUserLike | null; session: SupabaseAuthSessionLike | null };
    error: SupabaseAuthErrorLike | null;
  }>;
  signUp(credentials: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown> };
  }): Promise<{
    data: { user: SupabaseAuthUserLike | null; session: SupabaseAuthSessionLike | null };
    error: SupabaseAuthErrorLike | null;
  }>;
  resetPasswordForEmail?(
    email: string,
    options?: { redirectTo?: string }
  ): Promise<{ data?: unknown; error: SupabaseAuthErrorLike | null }>;
  recoverPassword?(
    email: string,
    options?: { redirectTo?: string }
  ): Promise<{ data?: unknown; error: SupabaseAuthErrorLike | null }>;
  signInWithOAuth?(options: {
    provider: 'google' | string;
    options?: {
      redirectTo?: string;
      queryParams?: Record<string, string>;
    };
  }): Promise<{ data: { url?: string | null; provider?: string } | null; error: SupabaseAuthErrorLike | null }>;
  exchangeCodeForSession?(
    authCode: string,
    options?: { flowId?: string }
  ): Promise<{
    data: { session: SupabaseAuthSessionLike | null; user?: SupabaseAuthUserLike | null };
    error: SupabaseAuthErrorLike | null;
  }>;
  verifyOtp?(params: {
    token_hash: string;
    type: string;
  }): Promise<{
    data: { session: SupabaseAuthSessionLike | null; user?: SupabaseAuthUserLike | null };
    error: SupabaseAuthErrorLike | null;
  }>;
  updateUser(attributes: { password?: string; data?: Record<string, unknown> }): Promise<{
    data: { user: SupabaseAuthUserLike | null };
    error: SupabaseAuthErrorLike | null;
  }>;
  signOut(): Promise<{ error: SupabaseAuthErrorLike | null } | void>;
  onAuthStateChange(
    callback: (event: string, session: SupabaseAuthSessionLike | null) => void
  ): {
    data: {
      subscription: {
        unsubscribe: () => void;
      };
    };
  };
}

export interface SupabaseQueryResultLike<T = Record<string, unknown>> {
  data: T | null;
  error: SupabaseAuthErrorLike | null;
}

export interface SupabaseFromBuilderLike {
  select(columns?: string): SupabaseFromBuilderLike;
  update(values: Record<string, unknown>): SupabaseFromBuilderLike;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): SupabaseFromBuilderLike;
  upsert(values: Record<string, unknown> | Record<string, unknown>[]): SupabaseFromBuilderLike;
  delete(): SupabaseFromBuilderLike;
  eq(column: string, value: unknown): SupabaseFromBuilderLike;
  in(column: string, values: unknown[]): SupabaseFromBuilderLike;
  order(column: string, opts?: { ascending?: boolean }): SupabaseFromBuilderLike;
  limit(count: number): SupabaseFromBuilderLike;
  single<T = Record<string, unknown>>(): Promise<SupabaseQueryResultLike<T>>;
  maybeSingle<T = Record<string, unknown>>(): Promise<SupabaseQueryResultLike<T>>;
}

export interface SupabaseClientLike {
  auth: SupabaseAuthLike;
  from(table: string): SupabaseFromBuilderLike;
  rpc?(fn: string, params?: Record<string, unknown>): Promise<SupabaseQueryResultLike<unknown>>;
}

export type AppSupabaseClient = SupabaseClient | SupabaseClientLike;

export interface AuthService {
  getCurrentSession: () => Promise<AuthSession | null>;
  signIn: (creds: { email: string; password: string }) => Promise<AuthSession | null>;
  signUp: (creds: {
    firstName: string;
    lastName: string;
    fullName?: string;
    email: string;
    password: string;
  }) => Promise<AuthSession | null>;
  signInWithGoogle: () => Promise<{ provider: string; url: string; redirectTo: string }>;
  resolveOAuthCallback: () => Promise<OAuthCallbackState>;
  recoverPassword: (email: string) => Promise<{ sent: boolean; email: string; note: string }>;
  requestPasswordReset: (email: string) => Promise<{ sent: boolean; email: string; note: string }>;
  resolvePasswordRecoverySession: () => Promise<RecoveryState>;
  updatePassword: (newPassword: string) => Promise<AuthSession | null>;
  updateOwnProfile: (profile: {
    firstName?: string;
    fullName?: string;
    role?: string;
  }) => Promise<Omit<KordUser, 'accountStatus'> | null>;
  signOut: () => Promise<void>;
  isPasswordRecoveryMode: () => boolean;
  subscribeAuthChanges: (listener: (payload: AuthChangePayload) => void) => () => void;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  position?: number;
}

export interface Skill {
  id: string;
  categoryId?: string | null;
  categoryName?: string;
  slug: string;
  title: string;
  category: string;
  level: string;
  summary: string;
  competencyExpectations?: string;
  prerequisites?: string[];
  supportedByCourseSlug?: string | null;
  publicationStatus?: PublicationStatus | string;
  roadmapStatus?: string;
  estHours?: number;
  outcomes?: string[];
  courseCount?: number;
  draftCourseCount?: number;
  totalCourseCount?: number;
  courses?: Course[];
  skillCheckQuizId?: string | null;
  challengeId?: string | null;
  assessments?: Quiz[];
  challenges?: Challenge[];
}

export interface UserSkill {
  id?: string;
  userId: string;
  skillId: string;
  level: SkillLevel;
  updatedAt?: string;
}

export interface FurtherReadingItem {
  title: string;
  source?: string;
  url: string;
  resourceType?: string;
}

export interface VideoEntry {
  id?: string;
  provider?: string;
  videoId?: string;
  title?: string;
  url?: string;
  originalUrl?: string;
  embedUrl?: string;
  description?: string;
  duration?: string;
  transcript?: string;
  viewingInstructions?: string;
  embedRestricted?: boolean;
}

export interface LessonBlock {
  id?: string;
  type: string;
  level?: number;
  text?: string;
  title?: string;
  items?: string[];
  term?: string;
  meaning?: string;
  body?: string;
  scenario?: string;
  takeaway?: string;
  headers?: string[];
  rows?: string[][];
  variant?: string;
  instructions?: string;
  expectedOutcome?: string;
  language?: string;
  code?: string;
  url?: string;
  alt?: string;
  caption?: string;
  provider?: string;
  videoId?: string;
  description?: string;
  duration?: string;
  transcript?: string;
  viewingInstructions?: string;
  embedRestricted?: boolean;
  formatLabel?: string;
  prompt?: string;
  options?: string[];
  correctIndex?: number;
  explanation?: string;
}

export interface Lesson {
  id: string;
  phaseId?: string;
  position: number;
  title: string;
  introduction?: string;
  objectives?: string[];
  estMinutes?: number;
  blocks?: LessonBlock[];
  videos?: VideoEntry[];
  summary?: string;
  takeaways?: string[];
  furtherReading?: FurtherReadingItem[];
  isRequired?: boolean;
  completionCriteria?: string;
  publicationStatus?: PublicationStatus | string;
}

export interface PhaseActivity {
  id: string;
  phaseId: string;
  lessonId?: string | null;
  position: number;
  title: string;
  description?: string;
  estMinutes?: number;
  instructions?: string;
  expectedOutput?: string;
  isRequired?: boolean;
  resources?: FurtherReadingItem[];
}

export interface Phase {
  id: string;
  courseId?: string;
  position: number;
  title: string;
  summary?: string;
  objectives?: string[];
  difficulty?: string;
  estHours?: number;
  publicationStatus?: PublicationStatus | string;
  activities?: PhaseActivity[];
  lessons?: Lesson[];
}

export interface CompletionRules {
  requireAllRequiredLessons?: boolean;
  requireAllActivities?: boolean;
  requireAllAssessments?: boolean;
  requireChallengeSubmission?: boolean;
  requireChallengeApproval?: boolean;
}

export interface Course {
  id: string;
  skillId: string;
  associatedSkillIds?: string[];
  categoryId?: string | null;
  categoryName?: string;
  skill?: Skill | null;
  slug: string;
  title: string;
  description: string;
  targetAudience?: string;
  outcomes?: string[];
  difficulty?: string;
  estimatedDurationWeeks?: number;
  estimatedDuration?: string;
  recommendedWeeklyHours?: number;
  recommendedSchedule?: string;
  prerequisites?: string[];
  thumbnailUrl?: string;
  authorName?: string;
  completionRules?: CompletionRules;
  publicationStatus?: PublicationStatus | string;
  version?: number;
  position?: number;
  createdAt?: string;
  updatedAt?: string;
  phases?: Phase[];
  assessments?: Quiz[];
  challenges?: Challenge[];
  associatedSkills?: Skill[];
  versions?: CourseVersion[];
}

export interface CourseVersion {
  id: string;
  courseId: string;
  versionNumber: number;
  snapshot?: Record<string, unknown>;
  publishedAt?: string;
  publishedBy?: string | null;
  notes?: string;
  changeNotes?: string;
  createdAt?: string;
}

export interface QuizQuestion {
  id: string;
  quizId?: string;
  position?: number;
  questionType?: string;
  difficulty?: string;
  marks?: number;
  prompt: string;
  contextText?: string;
  options?: string[];
  requiresManualReview?: boolean;
}

export interface QuizAnswerKey {
  correctIndex?: number | null;
  correctIndices?: number[] | null;
  acceptedAnswers?: string[] | null;
  correctOrder?: number[] | null;
  explanation?: string;
}

export interface Quiz {
  id: string;
  skillId: string;
  courseId?: string | null;
  phaseId?: string | null;
  lessonId?: string | null;
  quizType?: string;
  title: string;
  description?: string;
  passPercent?: number;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  shuffleQuestions?: boolean;
  requiresManualReview?: boolean;
  questions?: QuizQuestion[];
}

export interface QuizAttemptResultItem {
  questionId: string;
  questionType: string;
  marks: number;
  earnedMarks: number;
  submittedAnswer: unknown;
  selectedIndex?: number | null;
  isCorrect: boolean;
  pendingReview: boolean;
  correctIndex: number | null;
  answerConfig: {
    correctIndices: number[] | null;
    acceptedAnswers: string[] | null;
    correctOrder: number[] | null;
  } | null;
  explanation: string;
}

export interface QuizAttempt {
  id: string;
  userId: string;
  quizId: string;
  courseId?: string | null;
  attemptNumber?: number;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  reviewStatus: AssessmentReviewStatus | string;
  hasManualItems?: boolean;
  results?: QuizAttemptResultItem[];
  answers?: Record<string, unknown>;
  manualScores?: Record<string, number>;
  manualFeedback?: string;
  feedback?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  idempotencyKey?: string;
  createdAt: string;
}

export interface QuizSession {
  id: string;
  userId: string;
  quizId: string;
  startedAt: string;
  expiresAt?: string | null;
  status: string;
  questionOrder?: string[];
  completedAttemptId?: string | null;
  createdAt?: string;
}

export interface RubricCriterion {
  id: string;
  label: string;
  description?: string;
  maxPoints: number;
  weightPercent?: number;
  weight?: number;
}

export interface Challenge {
  id: string;
  skillId: string;
  courseId?: string | null;
  phaseId?: string | null;
  title: string;
  brief: string;
  instructions?: string;
  expectedDeliverables?: string[];
  allowedEvidenceTypes?: string[];
  allowedMimeTypes?: string[];
  maxFileSizeMb?: number;
  isRequired?: boolean;
  submissionFormat?: string;
  deliverableHint?: string;
  maxScore: number;
  passingScore: number;
  rubric?: RubricCriterion[];
}

export interface Submission {
  id: string;
  userId: string;
  challengeId: string;
  skillId?: string;
  courseId?: string | null;
  evidenceUrl?: string | null;
  repoUrl?: string | null;
  fileName?: string | null;
  fileMimeType?: string | null;
  fileSizeBytes?: number | null;
  filePath?: string | null;
  fileUrl?: string | null;
  submissionText?: string;
  explanation?: string;
  status: SubmissionStatus | string;
  totalScore?: number | null;
  rubricTotal?: number | null;
  rubricMax?: number;
  rubricScores?: Record<string, number> | null;
  feedback?: string;
  reviewerFeedback?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt?: string;
  userName?: string;
  userEmail?: string;
  challengeTitle?: string;
  skillTitle?: string;
}

export interface RequiredSkillRef {
  slug: string;
  neededLevel: SkillLevel | string;
}

export interface OpportunityMatchSkill {
  slug: string;
  title: string;
  level?: string | null;
  label?: string;
  neededLevel?: string;
  neededLabel?: string;
}

export interface Opportunity {
  id: string;
  title: string;
  organization: string;
  opportunityType: string;
  workMode: string;
  location: string;
  summary: string;
  aboutRole?: string;
  responsibilities?: string[];
  requirements?: string[];
  requiredSkills?: RequiredSkillRef[];
  requiredSkillSlugs?: string[];
  otherInfo?: {
    compensation?: string;
    duration?: string;
    schedule?: string;
    deadline?: string;
  };
  orgTips?: {
    aboutOrg?: string;
    howToApply?: string;
    tips?: string[];
  };
  isSample?: boolean;
  applyUrl?: string;
  publicationStatus?: PublicationStatus | string;
  matchPercent?: number;
  matchTier?: string;
  matchedSkills?: OpportunityMatchSkill[];
  missingSkills?: OpportunityMatchSkill[];
  isSaved?: boolean;
}

export interface CourseEnrollment {
  id: string;
  userId: string;
  courseId: string;
  skillId?: string;
  status: string;
  completionState?: CourseCompletionState | string;
  enrolledAt: string;
  completedAt?: string | null;
  updatedAt?: string;
}

export interface LessonProgressEntry {
  id?: string;
  userId: string;
  courseId: string;
  phaseId?: string;
  lessonId?: string;
  activityId?: string;
  notes?: string;
  completed: boolean;
  minutesSpent?: number | null;
  completedAt?: string | null;
  updatedAt?: string;
}

export interface ActivityProgressEntry {
  id?: string;
  userId: string;
  courseId: string;
  phaseId?: string;
  activityId: string;
  notes?: string;
  completed: boolean;
  minutesSpent?: number | null;
  completedAt?: string | null;
  updatedAt?: string;
}

export interface PhaseProgressSummary {
  phaseId: string | null;
  totalLessons: number;
  requiredLessonsCount: number;
  completedLessonsCount: number;
  totalActivities: number;
  requiredActivitiesCount: number;
  completedActivitiesCount: number;
  assessmentsCount: number;
  passedAssessmentsCount: number;
  challengesCount: number;
  approvedChallengesCount: number;
  totalLessonsMinutes: number;
  completedLessonsMinutes: number;
  progressPercent: number;
  isCompleted: boolean;
  status: 'completed' | 'in_progress' | 'not_started';
}

export interface CourseProgressSummary {
  totalLessons: number;
  requiredLessonsCount: number;
  completedLessonsCount: number;
  totalActivities: number;
  requiredActivitiesCount: number;
  completedActivitiesCount: number;
  totalPhasesCount: number;
  completedPhasesCount: number;
  phaseProgressById: Record<string, PhaseProgressSummary>;
  assessmentsCount: number;
  passedAssessmentsCount: number;
  challengesCount: number;
  submittedChallengesCount: number;
  approvedChallengesCount: number;
  progressPercent: number;
  percent?: number;
  actualMinutesSpent: number;
  estimatedTotalMinutes: number;
  remainingMinutes: number;
  projectedCompletionAt: string;
  lessonsOk: boolean;
  activitiesOk: boolean;
  assessmentsOk: boolean;
  challengesOk: boolean;
  practicalApproved: boolean;
  completionState: CourseCompletionState;
  isCompleted: boolean;
}

export interface AdminAuditLogEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  actorEmail?: string | null;
  action: string;
  targetTable: string;
  targetId: string;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
}

export interface DemoState {
  seedVersion: number;
  users: KordUser[];
  categories: Category[];
  skills: Skill[];
  courses: Course[];
  courseVersions: CourseVersion[];
  quizzes: Quiz[];
  privateQuizAnswers: Record<string, QuizAnswerKey>;
  challenges: Challenge[];
  opportunities: Opportunity[];
  userSkills: UserSkill[];
  courseEnrollments: CourseEnrollment[];
  lessonProgress: LessonProgressEntry[];
  activityProgress: ActivityProgressEntry[];
  quizAttempts: QuizAttempt[];
  quizSessions: QuizSession[];
  submissions: Submission[];
  courseCompletions: Record<string, unknown>[];
  adminAuditLogs: AdminAuditLogEntry[];
  enrollments?: CourseEnrollment[];
  syntheticHistory?: Record<string, unknown>[];
  sampleHistoryInjected?: boolean;
  savedOpportunities?: Array<{ userId: string; opportunityId: string; createdAt?: string }>;
}

export interface DemoStoreLike {
  getDemoState: () => DemoState;
  updateDemoState: (updater: DemoState | ((draft: DemoState) => DemoState)) => DemoState;
  subscribeDemoState: (
    fn: (
      state: DemoState,
      meta: {
        fromStorageEvent?: boolean;
        previousUserId?: string | null;
        previousRole?: string | null;
        nextUserId?: string | null;
        nextRole?: string | null;
      }
    ) => void
  ) => () => void;
  getDemoCurrentUserId: () => string | null;
  setDemoCurrentUserId: (userId: string | null) => void;
}

export interface DashboardWeeklyMinute {
  key: string;
  label: string;
  minutes: number;
}

export interface DashboardHourlyBucket {
  label: string;
  start: number;
  end: number;
  minutes: number;
}

export interface DashboardEnrolledCourse {
  id: string;
  slug: string;
  title: string;
  skillTitle: string;
  skillSlug: string;
  difficulty?: string;
  estimatedDurationWeeks?: number;
  status: string;
  completionState: string;
  progress: CourseProgressSummary;
}

export interface DashboardData {
  learning: {
    activeCourses: number;
    pausedCourses: number;
    completedCourses: number;
    activeRoadmaps: number;
    pausedRoadmaps: number;
    completedLessons: number;
    completedActivities: number;
    minutesLearned: number;
  };
  understanding: {
    passedQuizzes: number;
    totalAttempts: number;
    averageScore: number;
  };
  demonstrating: {
    approvedSubmissions: number;
    pendingSubmissions: number;
    needsRevisionSubmissions: number;
    totalSubmissions: number;
  };
  enrolledCourses: DashboardEnrolledCourse[];
  skillLevels: Array<{
    skillId: string;
    slug: string;
    title: string;
    category: string;
    level: string;
    updatedAt?: string;
  }>;
  weeklyMinutes: DashboardWeeklyMinute[];
  hourlyDistribution: DashboardHourlyBucket[];
  recommendations: Opportunity[];
}

export interface PageView {
  html: string;
  bind?: (root: HTMLElement) => void;
}

export interface RouteContext {
  params: Record<string, string>;
  session: AuthSession | null;
  auth: AuthService;
  recoveryState: RecoveryState | null;
  oauthCallbackState: OAuthCallbackState | null;
  signOut: (opts?: { redirectTo?: string; toastMessage?: string }) => Promise<void>;
  currentPath: string;
  navigate: (path: string) => Promise<void>;
  rerender: (opts?: { silent?: boolean; animateRoute?: boolean }) => Promise<void>;
}

export interface RouteDefinition {
  pattern: string;
  access: 'public' | 'auth_page' | 'recovery' | 'oauth_callback' | 'learner' | 'admin';
  render: (ctx: RouteContext) => Promise<PageView> | PageView;
}

export interface CourseBuilderHelpers {
  buildLesson: (lesson: Partial<Lesson> & { id: string; position: number; title: string }) => Lesson;
  buildActivity: (
    activity: Partial<PhaseActivity> & { id: string; phaseId: string; title: string }
  ) => PhaseActivity;
  addAssessment: (
    assessment: Omit<Partial<Quiz>, 'questions'> & {
      id: string;
      skillId: string;
      courseId: string;
      title: string;
      questions?: Array<
        Partial<QuizQuestion> &
          Partial<QuizAnswerKey> & {
            prompt: string;
            contextText?: string;
          }
      >;
    }
  ) => void;
}

export type CourseBuilderFn = (helpers: CourseBuilderHelpers) => {
  course: Course;
  challenge: Challenge;
};

export interface DomainLessonItem {
  t: string;
  intro: string;
  o: string[];
  h: string;
  exp: string;
  def: [string, string];
  ex: [string, string, string?];
  steps: string[];
  cs: [string, string, string?];
  tip: [string, string];
  chk: [string, string[], number, string];
  sum: string;
  tk: string[];
  min?: number;
}

export type DomainLessonHelper = (
  t: string,
  intro: string,
  h: string,
  exp: string,
  def: [string, string],
  ex: [string, string, string?],
  steps: string[],
  cs: [string, string, string?],
  tip: [string, string],
  chk: [string, string[], number, string],
  sum: string,
  tk: string[],
  o?: string[]
) => DomainLessonItem;

export type DomainQuestionTuple = [
  string,
  string[],
  number,
  string,
  string?
];

export interface DomainCourseConfig {
  code: string;
  skillId: string;
  associatedSkillIds?: string[];
  categoryId?: string | null;
  slug: string;
  slugTitle?: string;
  title: string;
  description: string;
  targetAudience: string;
  outcomes: string[];
  difficulty?: string;
  weeks?: number;
  weeklyHours?: number;
  schedule?: string;
  prerequisites?: string[];
  author?: string;
  resources: FurtherReadingItem[];
  modules: Array<{
    t: string;
    s: string;
    o: string[];
    h?: number;
    act: [string, string, string, string];
    l: DomainLessonItem[];
  }>;
  mq: DomainQuestionTuple[];
  fq: DomainQuestionTuple[];
  ch: {
    title: string;
    brief: string;
    instructions: string;
    deliverables: string[] | string;
    evidenceTypes?: string[];
    mimeTypes?: string[];
    format?: string;
    hint?: string;
    rubric: Array<[string, string, number, number]>;
  };
}

export interface CoursePackageSpec {
  code: string;
  skillId: string;
  associatedSkillIds?: string[];
  categoryId?: string | null;
  slug: string;
  title: string;
  description: string;
  targetAudience: string;
  outcomes: string[];
  difficulty?: string;
  estimatedDurationWeeks?: number;
  recommendedWeeklyHours?: number;
  recommendedSchedule?: string;
  prerequisites?: string[];
  thumbnailUrl?: string;
  authorName?: string;
  createdAt?: string;
  resources?: FurtherReadingItem[];
  modules: Array<{
    title: string;
    summary: string;
    objectives: string[];
    difficulty?: string;
    estHours?: number;
    lessons: Array<{
      title: string;
      introduction: string;
      objectives: string[];
      estMinutes?: number;
      conceptHeading: string;
      conceptExplanation: string;
      definition: { term: string; meaning: string };
      example: { title: string; body: string };
      stepsTitle?: string;
      steps: string[];
      caseStudy: { title: string; scenario: string; takeaway: string };
      callout: { variant?: string; title: string; text: string };
      inlineCheck: { prompt: string; options: string[]; correctIndex?: number; explanation: string };
      summary: string;
      takeaways: string[];
      furtherReading?: FurtherReadingItem[];
      completionCriteria?: string;
    }>;
    activity: {
      title: string;
      description: string;
      instructions: string;
      expectedOutput: string;
      estMinutes?: number;
    };
  }>;
  moduleQuiz?: {
    title: string;
    description: string;
    passPercent?: number;
    timeLimitMinutes?: number;
    maxAttempts?: number;
    questions: Array<Partial<QuizQuestion> & Partial<QuizAnswerKey> & { prompt: string }>;
  };
  finalExam?: {
    title: string;
    description: string;
    passPercent?: number;
    timeLimitMinutes?: number;
    maxAttempts?: number;
    questions: Array<Partial<QuizQuestion> & Partial<QuizAnswerKey> & { prompt: string }>;
  };
  challenge: {
    title: string;
    brief: string;
    instructions: string;
    expectedDeliverables: string[];
    allowedEvidenceTypes?: string[];
    allowedMimeTypes?: string[];
    maxFileSizeMb?: number;
    submissionFormat?: string;
    deliverableHint?: string;
    passingScore?: number;
    rubric: RubricCriterion[];
  };
}
