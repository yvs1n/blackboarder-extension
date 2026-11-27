import type { UiLanguage } from '../../types';

export function getGradesLabels(lang: UiLanguage = 'en') {
  const isAr = lang === 'ar';
  return {
    isAr,
    noCourses: isAr
      ? 'لا توجد مساقات بعد. أضفها في تبويب المساقات أو افحص بلاك بورد.'
      : 'No courses yet. Add them in the Courses tab or scan Blackboard.',
    noIndividualMarks: isAr
      ? 'لم تُرصد درجات فردية في سجل الدرجات بعد.'
      : 'No individual marks recorded in gradebook yet.',
    includeMarkTitle: isAr ? 'تضمين الدرجة في حساب المساق والمعدل' : 'Include mark in course grade & GPA',
    ignoreMarkTitle: isAr ? 'تجاهل الدرجة (استبعادها من المساق والمعدل)' : 'Ignore mark (exclude from course grade & GPA)',
    ignored: isAr ? 'مستبعدة' : 'Ignored',
    deleteBonusTitle: isAr ? 'حذف درجة البونص' : 'Delete bonus mark',
    bonus: isAr ? 'بونص' : 'Bonus',
    waiting: isAr ? 'بانتظار النتيجة' : 'Waiting',
    submitted: isAr ? 'تم التسليم' : 'Submitted',
    enterScoreBtn: isAr ? '+ درجة' : '+ Score',
    enterScoreTitle: isAr ? 'أدخل درجتك يدوياً (أو اتركها بانتظار بلاك بورد)' : 'Enter your mark manually (or leave Waiting for Blackboard)',
    pts: isAr ? 'نقطة' : 'pts',
    extraCredit: isAr ? 'درجة إضافية' : 'extra credit',
    bonusMark: isAr ? 'درجة بونص' : 'bonus mark',
    onTarget: isAr ? 'على' : 'on',
    worth: isAr ? 'بقيمة' : 'worth',
    ofWeight: (e: number, w: number) => (isAr ? `${e} من ${w}%` : `${e} of ${w}% weight`),
    currentStanding: isAr ? 'الوضع الحالي' : 'Current Standing',
    termSgpa: isAr ? 'المعدل الفصلي' : 'Term SGPA',
    cumulativeCgpa: isAr ? 'المعدل التراكمي' : 'Cumulative CGPA',
    academicGoal: isAr ? 'الهدف الأكاديمي' : 'Academic Goal',
    targetCgpa: isAr ? 'المعدل التراكمي المستهدف' : 'Target CGPA',
    plannedSgpa: isAr ? 'المعدل الفصلي المخطط' : 'Planned SGPA',
    requiresPlanned: (v: string) => (isAr ? `يتطلب <strong>${v}</strong> كمعدل فصلي مخطط` : `Requires <strong>${v}</strong> Planned SGPA`),
    projectedCgpa: (v: string) => (isAr ? `المعدل التراكمي المتوقع: <strong class="marks-gpa-cgpa-val">${v}</strong>` : `Projected CGPA: <strong class="marks-gpa-cgpa-val">${v}</strong>`),
    targetSgpaLabel: (v: string) => (isAr ? `المعدل الفصلي المستهدف: ${v}` : `Target SGPA: ${v}`),
    modeCgpa: isAr ? 'المعدل التراكمي (للمنحة)' : 'Cumulative CGPA (Scholarship)',
    modeTerm: isAr ? 'المعدل الفصلي' : 'Term SGPA',
    howItWorks: isAr ? 'كيف يعمل' : 'How It Works',
    targetCumLabel: isAr ? 'المعدل التراكمي المستهدف (للمنحة):' : 'Target Cumulative CGPA (Scholarship):',
    targetTermLabel: isAr ? 'المعدل الفصلي المستهدف:' : 'Target Term SGPA (Semester):',
    driver: isAr ? 'الأساسي' : 'Driver',
    guideTitle: isAr ? 'كيف يعمل حاسبة المعدل وتوقع المنحة' : 'How the GPA &amp; Scholarship Predictor Works',
    guideBadge: isAr ? 'دليل' : 'Guide',
    crLabel: isAr ? 'ساعة' : 'cr',
    degreeProgress: (done: number, target: number, pct: number) =>
      isAr ? `تقدم التخصص: ${done} من ${target} ساعة مكتملة (${pct}%)` : `Degree Progress: ${done} of ${target} cr completed (${pct}%)`,
    notGradedYet: isAr ? 'غير مرصودة بعد' : 'Not graded yet',
    noMarksYet: isAr ? 'لا توجد درجات بعد' : 'No marks yet',
    graded100: isAr ? 'مرصود 100%' : '100% Graded',
    gradedRem: (g: number) => (isAr ? `مرصود ${g}% (متبقي ${100 - g}%)` : `${g}% Graded (${100 - g}% Remaining)`),
    creditHours: (n: number) => (isAr ? `${n} ساعة معتمدة` : `${n} credit hour${n === 1 ? '' : 's'}`),
    marksRecorded: (n: number) => (isAr ? `تم تسجيل ${n} درجة` : `${n} mark${n === 1 ? '' : 's'} recorded`),
    addBonusBtn: isAr ? '+ بونص' : '+ Bonus',
    addBonusMarkBtn: isAr ? '+ درجة بونص' : '+ Bonus Mark',
    currentTermGrades: isAr ? 'درجات الفصل الحالي' : 'Current Term Grades',
    unconfiguredCourse: isAr ? 'مساق غير مهيأ' : 'Unconfigured Course',
    noSyllabus: isAr ? 'لم تُحدد خطة الدرجات' : 'No syllabus configured',
    targetGradeBreakdown: isAr ? 'تفصيل الدرجات المستهدفة' : 'Target Grade Breakdown',
    predicted: isAr ? 'المتوقع' : 'Predicted',
    predictedGoal: isAr ? 'الهدف المتوقع:' : 'Predicted Goal:',
    noTargetAvailable: isAr ? 'لا يتوفر هدف' : 'No target available',
    earned: isAr ? 'المكتسب' : 'Earned',
    cutoff: isAr ? 'الحد الأدنى' : 'Cutoff',
    max: isAr ? 'الأقصى' : 'Max',
    targetColon: isAr ? 'المستهدف:' : 'Target:',
    trendLabels: {
      consistent: isAr ? 'ثابت ←' : 'Consistent →',
      improving: isAr ? 'يتحسن ↗' : 'Improving ↗',
      'needs-focus': isAr ? 'يحتاج تركيزاً ↘' : 'Needs Focus ↘',
    },
    archivedTerm: isAr ? 'فصل مؤرشف' : 'Archived Term',
    termGpa: isAr ? 'المعدل الفصلي' : 'Term GPA',
    archivedCourses: isAr ? 'مساقات الفصل المؤرشف' : 'Archived Term Courses',
    noArchivedCourses: isAr ? 'لا توجد سجلات مساقات في هذا الفصل المؤرشف.' : 'No course records in this archived semester.',
    coursesCount: (n: number) => (isAr ? `${n} مساقات` : `${n} Course${n === 1 ? '' : 's'}`),
    gradedSummary: (g: number, s: number, c: number) =>
      isAr
        ? `${g} مرصودة · ${s > 0 ? `${s} بانتظار الرصد · ` : ''}${c} مساقات`
        : `${g} Graded · ${s > 0 ? `${s} Awaiting · ` : ''}${c} Course${c === 1 ? '' : 's'}`,
  };
}
