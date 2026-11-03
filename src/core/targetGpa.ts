import type { DeadlineTask } from '../types';
import { GradeRow } from './universities';
import { CourseGrade, GpaSummary, UOS_GRADE_SCALE } from '../utils/gpa';
import { round1, round2 } from '../utils/uiCommon';

export interface UpcomingTaskRequirement {
  id: string;
  title: string;
  type: string;
  weight: number;
  maxScore: number;
  targetScore: number;
  safeScore?: number;
  displayRange?: string;
}

export interface CourseScoreTrend {
  direction: 'improving' | 'consistent' | 'needs-focus';
  label: string;
  sampleCount: number;
  averagePercent: number;
  variance: number;
  momentum: number;
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

export interface TaskTargetAllocation {
  taskId: string;
  courseName: string;
  targetLetter: string;
  targetScore: number;
  safeScore?: number;
  displayRange?: string;
  maxScore: number;
  requiredPercent: number;
}

export interface TrajectoryCoursePlan {
  courseName: string;
  creditHours: number;
  currentLetter?: string;
  currentPercent?: number;
  gradedWeight: number;
  remainingWeight: number;
  historicalPercent: number;
  maxPossiblePercent: number;
  targetLetter: string;
  targetPoints: number;
  requiredPercent: number;
  safePercent: number;
  safeBuffer: number;
  displayRange: string;
  stretch: number;
  status?: 'on-track' | 'achievable' | 'stretch' | 'unattainable' | 'guaranteed';
  isGuaranteed: boolean;
  isUnattainable: boolean;
  trend: CourseScoreTrend;
  upcomingTasks: UpcomingTaskRequirement[];
}

/**
 * Computes historical grade momentum, variance and trend trajectory for a course
 * based on completed assessments and gradebook marks.
 */
export function calculateCourseTrend(
  tasks: DeadlineTask[] = [],
  courseName: string
): CourseScoreTrend {
  const cTarget = (courseName || '').toLowerCase().trim();
  const scoredTasks = tasks.filter(t => {
    if (!t || typeof t.score !== 'number' || typeof t.maxScore !== 'number' || t.maxScore <= 0) return false;
    const cName = (t.courseName || '').toLowerCase().trim();
    return cName && (cName === cTarget || cTarget.includes(cName) || cName.includes(cTarget));
  });

  if (scoredTasks.length === 0) {
    return {
      direction: 'consistent',
      label: 'Consistent →',
      sampleCount: 0,
      averagePercent: 0,
      variance: 0,
      momentum: 0
    };
  }

  // Sort chronologically: dueDate or gradedAt if available, preserving stable order
  const sorted = [...scoredTasks].sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : 0;
    return da - db;
  });

  const percentages = sorted.map(t => round1(((t.score! / t.maxScore!) * 100)));
  const sum = percentages.reduce((acc, p) => acc + p, 0);
  const averagePercent = round1(sum / percentages.length);

  // Standard deviation
  const varianceSum = percentages.reduce((acc, p) => acc + Math.pow(p - averagePercent, 2), 0);
  const variance = round1(Math.sqrt(varianceSum / percentages.length));

  // Momentum: compare recent score to prior baseline
  let momentum = 0;
  if (percentages.length >= 2) {
    const recent = percentages[percentages.length - 1];
    const priorAvg = percentages.slice(0, -1).reduce((acc, p) => acc + p, 0) / (percentages.length - 1);
    momentum = round1(recent - priorAvg);
  }

  let direction: 'improving' | 'consistent' | 'needs-focus' = 'consistent';
  let label = 'Consistent →';
  if (momentum >= 4.0) {
    direction = 'improving';
    label = 'Improving ↗';
  } else if (momentum <= -4.0) {
    direction = 'needs-focus';
    label = 'Needs Focus ↘';
  }

  return {
    direction,
    label,
    sampleCount: percentages.length,
    averagePercent,
    variance,
    momentum
  };
}

export interface TrajectoryTargetPlan {
  targetGpa: number;
  totalCredits: number;
  plannedGpa: number;
  maxPossibleGpa: number;
  possible: boolean;
  courses: TrajectoryCoursePlan[];
  taskTargetMap: Record<string, TaskTargetAllocation>;
}

/**
 * Calculates an optimal, trajectory-weighted course target allocation to achieve a student's
 * desired Term GPA, taking into account their historical performance in each course.
 *
 * If a student averages higher marks in Course A (e.g. 92%) and lower marks in Course B (e.g. 68%),
 * the planner assigns targets proportionally: expecting Course A to maintain strong performance (A / A-),
 * while allocating realistic, attainable targets for Course B (e.g. B / B+) rather than demanding
 * uniform or unrealistic jumps across all courses.
 */
export function calculateTrajectoryTargetPlan(
  gpaSummary: GpaSummary,
  targetGpa: number,
  tasks: DeadlineTask[] = [],
  scale: ReadonlyArray<GradeRow> = UOS_GRADE_SCALE
): TrajectoryTargetPlan {
  const activeScale = scale.length ? scale : UOS_GRADE_SCALE;
  const sortedScale = [...activeScale].sort((a, b) => b.points - a.points);
  const totalCredits = gpaSummary.totalCredits || (gpaSummary.courses.length * 3) || 3;
  const requiredTotalPoints = round2(targetGpa * totalCredits);

  interface CourseAnalysisInternal {
    courseGrade: CourseGrade;
    credits: number;
    gradedWeight: number;
    earnedWeight: number;
    remainingWeight: number;
    historicalPercent: number;
    maxPossiblePercent: number;
    maxPossiblePoints: number;
    pendingTasks: DeadlineTask[];
    options: Array<{
      row: GradeRow;
      reqPercent: number;
      attainable: boolean;
      guaranteed: boolean;
      stretch: number;
    }>;
    selectedIndex: number;
  }

  const courseAnalyses: CourseAnalysisInternal[] = gpaSummary.courses.map(c => {
    const credits = c.creditHours || 3;
    const gradedWeight = Math.min(100, Math.max(0, c.gradedWeight || 0));
    const earnedWeight = Math.max(0, c.earnedWeight || 0);
    const remainingWeight = Math.max(0, 100 - gradedWeight);
    const historicalPercent = gradedWeight > 0
      ? round1((earnedWeight / gradedWeight) * 100)
      : (c.percent !== undefined ? c.percent : 85);
    const maxPossiblePercent = round1(Math.min(100, earnedWeight + remainingWeight));

    const bestRow = sortedScale.find(r => maxPossiblePercent >= r.min) || sortedScale[sortedScale.length - 1];
    const maxPossiblePoints = bestRow ? bestRow.points : 0;

    const pendingTasks = tasks.filter(t => {
      if (!t || t.status === 'completed') return false;
      const cName = (t.courseName || '').toLowerCase();
      const targetName = (c.courseName || '').toLowerCase();
      return cName && (cName === targetName || targetName.includes(cName) || cName.includes(targetName));
    });

    const options = sortedScale.map(row => {
      if (remainingWeight === 0) {
        const isAchieved = earnedWeight >= row.min;
        return {
          row,
          reqPercent: isAchieved ? 0 : 101,
          attainable: isAchieved,
          guaranteed: isAchieved,
          stretch: isAchieved ? 0 : 99
        };
      }
      const guaranteed = earnedWeight >= row.min;
      const attainable = row.min <= maxPossiblePercent;
      const reqPercent = guaranteed
        ? 0
        : (attainable ? round1(((row.min - earnedWeight) / remainingWeight) * 100) : 101);
      const stretch = round1(reqPercent - historicalPercent);
      return {
        row,
        reqPercent,
        attainable,
        guaranteed,
        stretch
      };
    });

    const projectedPercent = round1(earnedWeight + (remainingWeight * (historicalPercent / 100)));
    let baselineIndex = options.findIndex(o => o.attainable && projectedPercent >= o.row.min);
    if (baselineIndex === -1) {
      baselineIndex = options.findIndex(o => o.attainable);
      if (baselineIndex === -1) baselineIndex = options.length - 1;
    }

    return {
      courseGrade: c,
      credits,
      gradedWeight,
      earnedWeight,
      remainingWeight,
      historicalPercent,
      maxPossiblePercent,
      maxPossiblePoints,
      pendingTasks,
      options,
      selectedIndex: baselineIndex
    };
  });

  const maxPossibleTotalPoints = courseAnalyses.reduce((sum, c) => sum + (c.maxPossiblePoints * c.credits), 0);
  const maxPossibleGpa = round2(maxPossibleTotalPoints / totalCredits);
  const possible = requiredTotalPoints <= maxPossibleTotalPoints;

  const currentTotalPoints = () => courseAnalyses.reduce((sum, c) => sum + (c.options[c.selectedIndex].row.points * c.credits), 0);

  let iterations = 0;
  while (currentTotalPoints() < requiredTotalPoints && iterations < 30) {
    iterations++;
    let bestCourse: CourseAnalysisInternal | null = null;
    let lowestCostPerPoint = Infinity;

    for (const ca of courseAnalyses) {
      if (ca.selectedIndex <= 0) continue;
      const currentOpt = ca.options[ca.selectedIndex];
      const targetOpt = ca.options[ca.selectedIndex - 1];
      if (!targetOpt.attainable) continue;

      const pointDiff = targetOpt.row.points - currentOpt.row.points;
      if (pointDiff <= 0) continue;

      const stretchIncrease = Math.max(1, targetOpt.stretch > 0 ? targetOpt.stretch : (targetOpt.reqPercent / 10));
      const costPerPoint = stretchIncrease / (pointDiff * ca.credits);

      if (costPerPoint < lowestCostPerPoint) {
        lowestCostPerPoint = costPerPoint;
        bestCourse = ca;
      }
    }

    if (!bestCourse) break;
    bestCourse.selectedIndex--;
  }

  const plannedTotalPoints = currentTotalPoints();
  const plannedGpa = round2(plannedTotalPoints / totalCredits);

  const courses: TrajectoryCoursePlan[] = [];
  const taskTargetMap: Record<string, TaskTargetAllocation> = {};

  for (const ca of courseAnalyses) {
    const selOpt = ca.options[ca.selectedIndex];
    const targetLetter = selOpt.row.letter;
    const targetPoints = selOpt.row.points;
    const requiredPercent = selOpt.reqPercent;
    const stretch = selOpt.stretch;

    const trend = calculateCourseTrend(tasks, ca.courseGrade.courseName);
    const safeBuffer = Math.min(8.0, Math.max(2.5, round1(trend.variance * 0.4)));

    let safePercent = requiredPercent;
    let displayRange = '0% (Secured)';
    if (selOpt.guaranteed) {
      safePercent = 0;
      displayRange = '0% (Secured)';
    } else if (!selOpt.attainable) {
      safePercent = 101;
      displayRange = 'Unattainable';
    } else {
      safePercent = Math.min(100, round1(requiredPercent + safeBuffer));
      displayRange = `${requiredPercent.toFixed(1)}%–${safePercent.toFixed(1)}%`;
    }

    const upcomingTasks: UpcomingTaskRequirement[] = [];
    for (const pt of ca.pendingTasks) {
      const weight = Number(pt.weight) || 0;
      const maxScore = typeof pt.maxScore === 'number' && pt.maxScore > 0 ? pt.maxScore : 100;
      const targetScore = round1((Math.min(100, Math.max(0, requiredPercent)) / 100) * maxScore);
      const safeScore = round1((Math.min(100, Math.max(0, safePercent)) / 100) * maxScore);
      const taskDisplayRange = (targetScore === safeScore || selOpt.guaranteed)
        ? `${targetScore}/${maxScore}`
        : `${targetScore}–${safeScore}/${maxScore}`;

      upcomingTasks.push({
        id: pt.id,
        title: pt.title,
        type: pt.type,
        weight,
        maxScore,
        targetScore,
        safeScore,
        displayRange: taskDisplayRange
      });

      taskTargetMap[pt.id] = {
        taskId: pt.id,
        courseName: ca.courseGrade.courseName,
        targetLetter,
        targetScore,
        safeScore,
        displayRange: taskDisplayRange,
        maxScore,
        requiredPercent
      };
    }

    let status: 'on-track' | 'achievable' | 'stretch' | 'unattainable' | 'guaranteed' = 'achievable';
    if (selOpt.guaranteed) status = 'guaranteed';
    else if (!selOpt.attainable) status = 'unattainable';
    else if (stretch <= 0) status = 'on-track';
    else if (stretch > 12) status = 'stretch';

    courses.push({
      courseName: ca.courseGrade.courseName,
      creditHours: ca.credits,
      currentLetter: ca.courseGrade.letter,
      currentPercent: ca.courseGrade.percent,
      gradedWeight: ca.gradedWeight,
      remainingWeight: ca.remainingWeight,
      historicalPercent: ca.historicalPercent,
      maxPossiblePercent: ca.maxPossiblePercent,
      targetLetter,
      targetPoints,
      requiredPercent,
      safePercent,
      safeBuffer,
      displayRange,
      stretch,
      status,
      isGuaranteed: selOpt.guaranteed,
      isUnattainable: !selOpt.attainable,
      trend,
      upcomingTasks
    });
  }

  return {
    targetGpa,
    totalCredits,
    plannedGpa,
    maxPossibleGpa,
    possible,
    courses,
    taskTargetMap
  };
}
