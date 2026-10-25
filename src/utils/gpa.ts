import type { DeadlineTask, TaskType } from '../types';

/**
 * University of Sharjah undergraduate grading (4-point scale, catalog 2025-2026):
 * a course percentage maps to a letter and its grade points. D is the lowest pass.
 */
export const UOS_GRADE_SCALE: ReadonlyArray<{ letter: string; min: number; points: number }> = [
  { letter: 'A', min: 90, points: 4.0 },
  { letter: 'B+', min: 85, points: 3.5 },
  { letter: 'B', min: 80, points: 3.0 },
  { letter: 'C+', min: 75, points: 2.5 },
  { letter: 'C', min: 70, points: 2.0 },
  { letter: 'D+', min: 65, points: 1.5 },
  { letter: 'D', min: 60, points: 1.0 },
  { letter: 'F', min: 0, points: 0 }
];

/** Credit hours used when a course does not say (most UOS courses are 3). */
export const DEFAULT_CREDIT_HOURS = 3;

export function gradeForPercent(percent: number): { letter: string; points: number } {
  const row = UOS_GRADE_SCALE.find(g => percent >= g.min) || UOS_GRADE_SCALE[UOS_GRADE_SCALE.length - 1];
  return { letter: row.letter, points: row.points };
}

/** The fields this needs from a syllabus component (the extension and phone shapes both have them). */
export interface GpaComponent {
  name: string;
  type: TaskType;
  totalWeight: number;
  /** How many items count towards the grade */
  count?: number;
  /** How many items are held, when only the best `count` of them count */
  outOf?: number;
  note?: string;
  matcher: RegExp;
}

export interface GpaSyllabus {
  courseName: string;
  courseCodePattern: RegExp;
  totalWeight?: number;
  creditHours?: number;
  components?: GpaComponent[];
}

export interface GradedItem {
  title: string;
  percent: number;
}

export interface ComponentGrade {
  name: string;
  /** Items that count, best first */
  counted: GradedItem[];
  /** Items left out because only the best ones count */
  dropped: GradedItem[];
  /** Count rule, e.g. "best 2 of 3" */
  rule?: string;
}

export interface CourseGrade {
  courseName: string;
  creditHours: number;
  /** Course weight already graded (counted items only) */
  gradedWeight: number;
  /** Course percentage earned from that weight */
  earnedWeight: number;
  /** Score on what is graded so far, 0-100; undefined before the first mark */
  percent?: number;
  letter?: string;
  points?: number;
  components: ComponentGrade[];
}

export interface GpaSummary {
  courses: CourseGrade[];
  /** Projected GPA over courses with at least one mark, rounded to 2 decimals like the registrar */
  gpa?: number;
  /** Credit hours behind that GPA */
  gradedCredits: number;
  totalCredits: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reads "best 2 of 3", "top 3 of 4", "4 scheduled, top 3 counted" or "best 3 out of 4" from a
 * syllabus note, for courses set up before the count rule had its own field.
 */
export function bestOfFromNote(note?: string): { count: number; outOf: number } | null {
  if (!note) return null;
  const m = note.match(/\b(?:best|top|highest)\s+(\d+)\s+(?:out\s+)?of\s+(?:the\s+)?(\d+)/i);
  if (m) return { count: +m[1], outOf: +m[2] };
  const held = note.match(/(\d+)\s+(?:scheduled|held|given)[^0-9]*\b(?:best|top|highest)\s+(\d+)/i);
  if (held) return { count: +held[2], outOf: +held[1] };
  return null;
}

function isGraded(t: DeadlineTask): boolean {
  return t.submissionStatus === 'graded' && typeof t.score === 'number' && !!t.maxScore && t.maxScore > 0;
}

function pickComponent(task: DeadlineTask, components: GpaComponent[]): GpaComponent | undefined {
  const title = task.title || '';
  return components.find(c => c.type === task.type && c.matcher.test(title))
    || components.find(c => c.matcher.test(title))
    || components.find(c => c.type === task.type);
}

/**
 * Each course's grade so far and the projected GPA, from the marks Blackboard has given.
 * Where the syllabus counts only the best items ("best 2 of 3 quizzes"), the best ones count and
 * the rest are dropped. Items not graded yet do not count either way, so the grade is the score
 * on what has been marked so far.
 */
export function buildGpaSummary(tasks: DeadlineTask[], syllabi: GpaSyllabus[]): GpaSummary {
  const graded = (tasks || []).filter(t => t && isGraded(t));
  const courses: CourseGrade[] = [];

  for (const syl of syllabi || []) {
    const creditHours = Number(syl.creditHours) > 0 ? Number(syl.creditHours) : DEFAULT_CREDIT_HOURS;
    const totalWeight = syl.totalWeight || 100;
    const mine = graded.filter(t =>
      syl.courseCodePattern.test(t.courseName || '') || syl.courseCodePattern.test(t.courseCode || '')
    );
    const components = syl.components || [];
    const byComponent = new Map<GpaComponent, GradedItem[]>();
    let gradedWeight = 0;
    let earnedWeight = 0;

    for (const t of mine) {
      const item = { title: t.title, percent: (t.score! / t.maxScore!) * 100 };
      const comp = pickComponent(t, components);
      if (comp) {
        const list = byComponent.get(comp) || [];
        list.push(item);
        byComponent.set(comp, list);
      } else if (Number(t.weight) > 0) {
        // Not in the syllabus, but the item says what it is worth
        gradedWeight += Number(t.weight);
        earnedWeight += (item.percent / 100) * Number(t.weight);
      }
    }

    const componentGrades: ComponentGrade[] = [];
    for (const comp of components) {
      const items = (byComponent.get(comp) || []).sort((a, b) => b.percent - a.percent);
      if (!items.length) continue;
      const fromNote = bestOfFromNote(comp.note);
      const count = comp.count || fromNote?.count;
      const outOf = comp.outOf || fromNote?.outOf;
      let counted = items;
      let dropped: GradedItem[] = [];
      if (count && count > 0) {
        // Each counted item is worth an equal share; only the best `count` count
        counted = items.slice(0, count);
        dropped = items.slice(count);
        const unit = comp.totalWeight / count;
        gradedWeight += counted.length * unit;
        earnedWeight += counted.reduce((s, i) => s + (i.percent / 100) * unit, 0);
      } else {
        // One item, or several averaged into the component
        const avg = items.reduce((s, i) => s + i.percent, 0) / items.length;
        gradedWeight += comp.totalWeight;
        earnedWeight += (avg / 100) * comp.totalWeight;
      }
      componentGrades.push({
        name: comp.name,
        counted: counted.map(i => ({ ...i, percent: round1(i.percent) })),
        dropped: dropped.map(i => ({ ...i, percent: round1(i.percent) })),
        rule: count && outOf && outOf > count ? `best ${count} of ${outOf}` : undefined
      });
    }

    gradedWeight = Math.min(gradedWeight, totalWeight);
    const course: CourseGrade = {
      courseName: syl.courseName,
      creditHours,
      gradedWeight: round1(gradedWeight),
      earnedWeight: round1(earnedWeight),
      components: componentGrades
    };
    if (gradedWeight > 0) {
      course.percent = round1((earnedWeight / gradedWeight) * 100);
      Object.assign(course, gradeForPercent(course.percent));
    }
    courses.push(course);
  }

  const counted = courses.filter(c => c.points !== undefined);
  const gradedCredits = counted.reduce((s, c) => s + c.creditHours, 0);
  const totalCredits = courses.reduce((s, c) => s + c.creditHours, 0);
  const summary: GpaSummary = { courses, gradedCredits, totalCredits };
  if (gradedCredits > 0) {
    summary.gpa = round2(counted.reduce((s, c) => s + c.points! * c.creditHours, 0) / gradedCredits);
  }
  return summary;
}

export function gpaBadgeText(s: GpaSummary): string {
  return s.gpa === undefined ? 'No marks yet' : `GPA ${s.gpa.toFixed(2)}`;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** The GPA card body, shared by the extension popup and the phone app (same classes in both stylesheets). */
export function gpaSummaryHtml(s: GpaSummary, colorFor: (courseName: string) => string): string {
  if (!s.courses.length) return '<div class="marks-empty">No courses configured yet.</div>';
  const head = s.gpa === undefined
    ? '<div class="gpa-head"><span class="gpa-value">-</span><span class="gpa-caption">No marks yet. Your GPA appears after the first graded item.</span></div>'
    : `<div class="gpa-head"><span class="gpa-value">${s.gpa.toFixed(2)}</span><span class="gpa-caption">Projected GPA from marks so far, ${s.gradedCredits} of ${s.totalCredits} credit hours</span></div>`;
  const rows = s.courses.map(c => {
    const right = c.percent === undefined
      ? '<span class="marks-awaiting">No marks yet</span>'
      : `<span class="marks-pct">${c.percent}%</span><span class="gpa-letter">${esc(c.letter)}</span>`;
    const detail = c.percent === undefined ? '' : `<div class="gpa-detail">${c.earnedWeight}% of ${c.gradedWeight}% graded · ${c.points!.toFixed(1)} points</div>`;
    const drops = c.components.filter(k => k.dropped.length).map(k =>
      `<div class="gpa-detail">${esc(k.name)}${k.rule ? ` (${esc(k.rule)})` : ''}: not counted ${k.dropped.map(d => `${esc(d.title)} ${d.percent}%`).join(', ')}</div>`
    ).join('');
    return `<div class="marks-course">
      <div class="marks-course-head"><span class="marks-dot" style="background:${esc(colorFor(c.courseName))}"></span><span class="marks-course-name">${esc(c.courseName)}</span><span class="marks-course-total">${c.creditHours} cr</span><span class="marks-right">${right}</span></div>
      ${detail}${drops}
    </div>`;
  }).join('');
  const scale = UOS_GRADE_SCALE.filter(g => g.letter !== 'F').map(g => `${g.letter} ${g.min}+`).join(' · ');
  return `${head}${rows}<div class="gpa-note">UOS scale: ${scale} · F below 60. Grades are your score on what is graded so far; set credit hours in Settings &gt; Courses.</div>`;
}
