import type { DeadlineTask } from '../types';
import { GradeRow } from './universities';
import { CourseGrade, GpaSummary, UOS_GRADE_SCALE } from '../utils/gpa';

export interface UpcomingTaskRequirement {
  id: string;
  title: string;
  type: string;
  weight: number;
  maxScore: number;
  targetScore: number;
}

export interface TargetGradeRequirement {
  letter: string;
  minPercent: number;
  points: number;
  requiredPercent: number;
  guaranteed: boolean;
  unattainable: boolean;
  statusLabel: string;
  upcomingTasks?: UpcomingTaskRequirement[];
}

export interface CourseTargetAnalysis {
  courseName: string;
  creditHours: number;
  gradedWeight: number;
  earnedWeight: number;
  remainingWeight: number;
  currentPercent?: number;
  currentLetter?: string;
  maxPossiblePercent: number;
  targets: TargetGradeRequirement[];
}

export interface CoursePlanItem {
  courseName: string;
  creditHours: number;
  currentLetter?: string;
  targetLetter: string;
  targetPoints: number;
  maxPossiblePoints: number;
}

export interface TermTargetPlan {
  targetGpa: number;
  totalCredits: number;
  requiredTotalPoints: number;
  maxPossibleGpa: number;
  possible: boolean;
  coursePlans: CoursePlanItem[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Calculates the exact exam score percentage needed on remaining course assessments to achieve
 * each letter grade on the university's grading scale.
 */
export function calculateCourseTargetAnalysis(
  courseGrade: CourseGrade,
  tasks: DeadlineTask[] = [],
  scale: ReadonlyArray<GradeRow> = UOS_GRADE_SCALE
): CourseTargetAnalysis {
  const gradedWeight = Math.min(100, Math.max(0, courseGrade.gradedWeight || 0));
  const earnedWeight = Math.max(0, courseGrade.earnedWeight || 0);
  const remainingWeight = Math.max(0, 100 - gradedWeight);
  const maxPossiblePercent = round1(Math.min(100, earnedWeight + remainingWeight));

  // Find upcoming pending tasks for this course
  const pendingTasks = tasks.filter(t => {
    if (!t || t.status === 'completed') return false;
    const cName = (t.courseName || '').toLowerCase();
    const targetName = (courseGrade.courseName || '').toLowerCase();
    return cName && (cName === targetName || targetName.includes(cName) || cName.includes(targetName));
  });

  const activeScale = scale.length ? scale : UOS_GRADE_SCALE;
  const targets: TargetGradeRequirement[] = [];

  for (const row of activeScale) {
    const minPercent = row.min;

    if (remainingWeight === 0) {
      const isAchieved = earnedWeight >= minPercent;
      targets.push({
        letter: row.letter,
        minPercent,
        points: row.points,
        requiredPercent: isAchieved ? 0 : 101,
        guaranteed: isAchieved,
        unattainable: !isAchieved,
        statusLabel: isAchieved ? 'Achieved' : 'Unattainable'
      });
      continue;
    }

    if (earnedWeight >= minPercent) {
      targets.push({
        letter: row.letter,
        minPercent,
        points: row.points,
        requiredPercent: 0,
        guaranteed: true,
        unattainable: false,
        statusLabel: 'Guaranteed'
      });
      continue;
    }

    if (minPercent > maxPossiblePercent) {
      targets.push({
        letter: row.letter,
        minPercent,
        points: row.points,
        requiredPercent: round1(((minPercent - earnedWeight) / remainingWeight) * 100),
        guaranteed: false,
        unattainable: true,
        statusLabel: `Unattainable (max ${maxPossiblePercent.toFixed(1)}%)`
      });
      continue;
    }

    const neededRaw = ((minPercent - earnedWeight) / remainingWeight) * 100;
    const requiredPercent = round1(neededRaw);

    // Compute task-by-task breakdown for upcoming pending assessments
    const upcomingTasks: UpcomingTaskRequirement[] = [];
    for (const pt of pendingTasks) {
      const weight = Number(pt.weight) || 0;
      const maxScore = typeof pt.maxScore === 'number' && pt.maxScore > 0 ? pt.maxScore : 100;
      const targetScore = round1((neededRaw / 100) * maxScore);
      upcomingTasks.push({
        id: pt.id,
        title: pt.title,
        type: pt.type,
        weight,
        maxScore,
        targetScore
      });
    }

    targets.push({
      letter: row.letter,
      minPercent,
      points: row.points,
      requiredPercent,
      guaranteed: false,
      unattainable: false,
      statusLabel: `Need ${requiredPercent.toFixed(1)}%`,
      upcomingTasks: upcomingTasks.length > 0 ? upcomingTasks : undefined
    });
  }

  return {
    courseName: courseGrade.courseName,
    creditHours: courseGrade.creditHours || 3,
    gradedWeight,
    earnedWeight,
    remainingWeight,
    currentPercent: courseGrade.percent,
    currentLetter: courseGrade.letter,
    maxPossiblePercent,
    targets
  };
}

/**
 * Plans course grade allocations to achieve a target Term SGPA across active courses.
 */
export function calculateTermTargetPlan(
  gpaSummary: GpaSummary,
  targetGpa: number,
  scale: ReadonlyArray<GradeRow> = UOS_GRADE_SCALE
): TermTargetPlan {
  const activeScale = scale.length ? scale : UOS_GRADE_SCALE;
  const sortedScale = [...activeScale].sort((a, b) => b.points - a.points);
  const totalCredits = gpaSummary.totalCredits || (gpaSummary.courses.length * 3) || 3;
  const requiredTotalPoints = round2(targetGpa * totalCredits);

  // Determine max possible grade points for each course
  let maxPossibleTotalPoints = 0;
  const courseCapacities = gpaSummary.courses.map(c => {
    const credits = c.creditHours || 3;
    const gradedWeight = Math.min(100, Math.max(0, c.gradedWeight || 0));
    const earnedWeight = Math.max(0, c.earnedWeight || 0);
    const remainingWeight = Math.max(0, 100 - gradedWeight);
    const maxPercent = earnedWeight + remainingWeight;

    // Find highest grade row achievable
    const bestRow = sortedScale.find(r => maxPercent >= r.min) || sortedScale[sortedScale.length - 1];
    const maxPoints = bestRow ? bestRow.points : 0;
    maxPossibleTotalPoints += maxPoints * credits;

    return {
      courseName: c.courseName,
      creditHours: credits,
      currentLetter: c.letter,
      currentPoints: c.points ?? 0,
      maxPossiblePoints: maxPoints
    };
  });

  const maxPossibleGpa = round2(maxPossibleTotalPoints / totalCredits);
  const possible = requiredTotalPoints <= maxPossibleTotalPoints;

  // Allocate target grades greedily starting from courses that can reach higher points
  const coursePlans: CoursePlanItem[] = [];
  let remainingNeeded = requiredTotalPoints;
  let remainingCredits = totalCredits;

  for (let i = 0; i < courseCapacities.length; i++) {
    const cap = courseCapacities[i];
    const neededAverage = remainingCredits > 0 ? remainingNeeded / remainingCredits : 0;

    // Choose grade row that closest matches or exceeds needed average without exceeding max possible
    let chosenRow = sortedScale.find(r => r.points <= cap.maxPossiblePoints && r.points >= neededAverage)
      || sortedScale.find(r => r.points <= cap.maxPossiblePoints)
      || sortedScale[sortedScale.length - 1];

    coursePlans.push({
      courseName: cap.courseName,
      creditHours: cap.creditHours,
      currentLetter: cap.currentLetter,
      targetLetter: chosenRow.letter,
      targetPoints: chosenRow.points,
      maxPossiblePoints: cap.maxPossiblePoints
    });

    remainingNeeded = Math.max(0, remainingNeeded - (chosenRow.points * cap.creditHours));
    remainingCredits -= cap.creditHours;
  }

  return {
    targetGpa,
    totalCredits,
    requiredTotalPoints,
    maxPossibleGpa,
    possible,
    coursePlans
  };
}
