export type TaskType = 
  | 'quiz' 
  | 'assignment' 
  | 'exam' 
  | 'project' 
  | 'lab' 
  | 'meeting' 
  | 'other';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'completed' | 'dismissed';

export type Weekday = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface CustomScheduleSlot {
  days: Weekday[];
  startTime: string; // 24-hour "HH:MM", e.g. "11:00"
  endTime: string;   // 24-hour "HH:MM", e.g. "12:15"
  room: string;      // e.g. "A8-103", "Central Lab Men - 105"
  location?: string; // e.g. "UOS Men's Campus, A8, 103"
  instructor?: string;
}

export interface CustomSyllabusComponent {
  id: string;
  name: string;
  type: TaskType;
  totalWeight: number; // e.g. 20 for 20%
  count?: number;      // e.g. 4 for 4 quizzes
  outOf?: number;      // items held when only the best `count` count, e.g. 3 for "best 2 of 3"
  unitWeight?: number; // e.g. 5 for 5% each
  note?: string;
  keywords?: string[]; // e.g. ["quiz", "test", "كويز"]
}

export interface UserCourseConfig {
  id: string;
  courseCode: string;
  courseName: string;
  crn?: string;
  creditHours?: number; // for the GPA; 3 when missing
  colorHex: string;
  aliases: string[];
  scheduleSlots: CustomScheduleSlot[];
  syllabus: CustomSyllabusComponent[];
}

/**
 * Who the student is, academically: the university (grading scale, quick links) and an optional
 * edited scale. Synced inside the data payload; the newer updatedAt wins.
 */
export interface StudentProfile {
  universityId: string;
  /** The student's own scale; replaces the university's when set */
  gradeScale?: { letter: string; min: number; points: number }[];
  /** 'picked' in onboarding or Settings, 'detected' from the Blackboard address */
  source?: 'picked' | 'detected';
  updatedAt: string;
}

export interface FirebaseSyncPayload {
  tasks: DeadlineTask[];
  lastSync: string;
  device?: string;
  count: number;
  syncKey?: string;
  quickLinks?: QuickLink[];
  courses?: UserCourseConfig[];
  coursesUpdatedAt?: string;
  tombstones?: Record<string, string>;
  profile?: StudentProfile;
}

export interface Announcement {
  id: string;
  courseCode: string;
  courseName: string;
  title: string;
  author?: string;
  postedAt?: string; // ISO date string
  contentText: string;
  contentHtml?: string;
  sourceUrl: string;
  scannedAt: string;
}

export interface DeadlineTask {
  id: string;
  announcementId?: string;
  courseCode: string;
  courseName: string;
  title: string;
  description: string;
  dueDate: string; // ISO 8601 string
  hasSpecificTime: boolean;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  sourceSnippet: string;
  confidence: number; // 0.0 - 1.0
  extractedBy: 'local' | 'ai' | 'manual';
  weight?: number; // Grade percentage, e.g. 5 for 5%
  weightDisplay?: string; // Formatted badge text, e.g. "5% of Grade"
  syllabusNote?: string; // Syllabus rule explanation
  room?: string; // Classroom, lab, or hall (e.g. "A8-103", "W8-Lab 3")
  notes?: string; // Student custom notes and instructions
  submissionStatus?: 'pending' | 'submitted' | 'graded';
  submittedAt?: string; // ISO string or human-readable date
  submissionReceipt?: string; // Confirmation receipt number
  score?: number; // Earned marks (e.g. 9.5)
  maxScore?: number; // Total possible points (e.g. 10)
  scoreDisplay?: string; // Formatted badge text (e.g. "9.5 / 10" or "95%")
  gradeFeedback?: string; // Instructor feedback comments
  gradedAt?: string;
  markProvisional?: boolean; // Mark from a column first seen graded before the item's date; any other column replaces it // When Blackboard says that column was graded; a later-graded column replaces an earlier one
  gradeSourceId?: string; // Gradebook column the mark came from ("gb:_123_1"); only that column updates it
  gradeSourcesBefore?: string[]; // Gradebook columns already graded before this task's date (a practice run), never applied to it
  calendarSynced?: boolean;
  userEdited?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSubmissionUpdate {
  courseCode?: string;
  courseName?: string;
  title: string;
  submissionStatus: 'submitted' | 'graded';
  submittedAt?: string;
  submissionReceipt?: string;
  score?: number;
  maxScore?: number;
  scoreDisplay?: string;
  feedback?: string;
  sourceId?: string; // Gradebook column id ("gb:_123_1")
  gradedAt?: string; // When Blackboard recorded the grade, if it says
}

// Generative AI service. Each keeps its own key, so switching back and forth loses nothing
export type AiProvider = 'openrouter' | 'ifm' | 'custom';

export interface UserSettings {
  openRouterApiKey: string;
  openRouterModel: string;
  useAiExtraction: boolean;
  aiProvider?: AiProvider;
  ifmApiKey?: string;
  customAiBaseUrl?: string; // Any OpenAI-compatible service, e.g. https://api.example.com/v1
  customAiApiKey?: string;
  customAiModel?: string;
  aiPass?: string; // Lets paired phones use the AI model; travels only in the pairing link
  autoScanOnPageLoad: boolean;
  badgeNotification: boolean;
  reminderHoursBefore: number;
  /** Minutes before each class to remind; 0 turns class reminders off */
  classReminderMinutes?: number;
  /** Each day's classes in Blackboarder's calendar (Settings > Calendar); on unless turned off */
  showClassesInCalendar?: boolean;
  customDomains: string[];
  customWeights?: Record<string, any>;
  autoSyncMidnight?: boolean;
  autoSyncOnScan?: boolean;
  syncKey?: string;
  theme?: 'light' | 'dark' | 'system';
  blackboardDarkMode?: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  openRouterApiKey: '',
  openRouterModel: 'google/gemini-3.8-flash',
  useAiExtraction: false,
  aiProvider: 'openrouter',
  ifmApiKey: '',
  customAiBaseUrl: '',
  customAiApiKey: '',
  customAiModel: '',
  autoScanOnPageLoad: true,
  badgeNotification: true,
  reminderHoursBefore: 24,
  classReminderMinutes: 15,
  showClassesInCalendar: true,
  customDomains: ['blackboard.sharjah.ac.ae', 'elearning.sharjah.ac.ae', 'blackboard.com'],
  autoSyncMidnight: true,
  autoSyncOnScan: true,
  syncKey: '',
  theme: 'system',
  blackboardDarkMode: true
};

export interface ScanResult {
  announcementsFound: number;
  newDeadlinesFound: number;
  tasks: DeadlineTask[];
}

export type QuickLinkCategory = 'attendance' | 'study_plan' | 'marks' | 'portal' | 'other';

export interface QuickLink {
  id: string;
  title: string;
  url: string;
  category: QuickLinkCategory;
  icon?: string;
  createdAt: string;
  updatedAt?: string;
}

export const DEFAULT_QUICK_LINKS: QuickLink[] = [
  {
    id: 'ql-attendance',
    title: 'Attendance (Banner)',
    url: 'https://banner.sharjah.ac.ae',
    category: 'attendance',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql-studyplan',
    title: 'Study Plan & Degree Audit',
    url: 'https://banner.sharjah.ac.ae/StudentRegistrationSsb/',
    category: 'study_plan',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql-marks',
    title: 'Final Marks & Transcript',
    url: 'https://banner.sharjah.ac.ae',
    category: 'marks',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql-blackboard',
    title: 'Blackboard Ultra Portal',
    url: 'https://elearning.sharjah.ac.ae/ultra/course',
    category: 'portal',
    createdAt: '2026-09-01T00:00:00.000Z'
  }
];

