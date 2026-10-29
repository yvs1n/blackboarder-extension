import type { UserCourseConfig } from '../../src/types';

/**
 * Made-up course list for tests, shaped like a real UOS semester: six courses with codes, CRNs,
 * aliases, class times and syllabus weights, including a lecture course and its lab ("Physics 1"
 * and "Physics 1 Lab"). The product has no built-in courses; tests that need active courses call
 * setActiveUserCourses(SAMPLE_COURSES).
 */
export const SAMPLE_COURSES: UserCourseConfig[] = [
  // 1. Introduction to Computer Eng.
  {
    id: 'compeng',
    courseCode: '1502101',
    courseName: 'Introduction to Computer Eng.',
    crn: '12056',
    creditHours: 3,
    colorHex: '#7c7c7c',
    aliases: [
      'intro.*comp',
      'comp(?:uter)?\\s*eng',
      'هندسة.*حاسوب',
      'حاسوب',
      '1502 101 01',
      '1502 101',
      '1502101',
      '0402101',
      '0402102'
    ],
    scheduleSlots: [
      {
        days: ['Tuesday', 'Thursday'],
        startTime: '11:00',
        endTime: '12:15',
        room: 'A8-103',
        location: "Room A8-103",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'compeng_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 45,
        unitWeight: 45,
        note: 'TBA (45%)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي']
      },
      {
        id: 'compeng_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 30,
        unitWeight: 30,
        note: 'TBA (30%)',
        keywords: ['midterm\\s*exam', 'midterm', 'امتحان\\s*نصفي', 'نصفي', 'منتصف']
      },
      {
        id: 'compeng_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 25,
        count: 3,
        outOf: 4,
        unitWeight: 8.33,
        note: 'Best 3 of 4 quizzes (average taken, ~8.33% each, 25% total, no HWs)',
        keywords: ['quiz', 'كويز', 'امتحان\\s*قصير']
      }
    ]
  },

  // 2. Calculus I for Engineering
  {
    id: 'calc1',
    courseCode: '1440133',
    courseName: 'Calculus I for Engineering',
    crn: '10806',
    creditHours: 3,
    colorHex: '#dc2626',
    aliases: [
      'calculus',
      'calc\\b',
      'حسبان',
      '1440 133 02',
      '1440 133',
      '1440133',
      '1440131',
      '0401101',
      '0401201'
    ],
    scheduleSlots: [
      {
        days: ['Tuesday', 'Thursday'],
        startTime: '12:30',
        endTime: '13:45',
        room: 'A12-110',
        location: "Room A12-110",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'calc1_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'On paper (40%)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي']
      },
      {
        id: 'calc1_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 30,
        unitWeight: 30,
        note: 'On paper (30%)',
        keywords: ['midterm\\s*exam', 'midterm', 'امتحان\\s*نصفي', 'نصفي', 'منتصف']
      },
      {
        id: 'calc1_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        count: 2,
        outOf: 3,
        unitWeight: 10,
        note: 'On paper, best 2 of 3 quizzes (10% each, 20% total)',
        keywords: ['quiz', 'كويز', 'امتحان\\s*قصير']
      },
      {
        id: 'calc1_assignments',
        name: 'Homeworks',
        type: 'assignment',
        totalWeight: 10,
        count: 3,
        outOf: 4,
        unitWeight: 3.33,
        note: 'Online, best 3 of 4 homeworks (~3.33% each, 10% total)',
        keywords: ['assignment', 'hw', 'homework', 'واجب', 'connect']
      }
    ]
  },

  // 3. English for Academic Purposes
  {
    id: 'eap',
    courseCode: '0202112',
    courseName: 'English for Academic Purposes',
    crn: '10175',
    creditHours: 3,
    colorHex: '#525252',
    aliases: [
      'english',
      'eap\\b',
      'academic\\s*purposes',
      'academic\\s*english',
      'إنجليزي',
      'انجليزي',
      '0202 112 09',
      '0202 112',
      '0202112',
      '0202111'
    ],
    scheduleSlots: [
      {
        days: ['Tuesday', 'Thursday'],
        startTime: '14:00',
        endTime: '15:15',
        room: 'A3-184',
        location: "Room A3-184",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'eap_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'Week 16 (40%)',
        keywords: ['final\\s*exam', 'final', 'نهائي']
      },
      {
        id: 'eap_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 20,
        unitWeight: 20,
        note: 'Week 8 (20%)',
        keywords: ['midterm\\s*exam', 'midterm', 'نصفي', 'منتصف']
      },
      {
        id: 'eap_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        count: 2,
        unitWeight: 10,
        note: '2 Quizzes: Quiz 1 in Wk 4, Quiz 2 in Wk 7 (10% each, 20% total)',
        keywords: ['quiz', 'كويز']
      },
      {
        id: 'eap_essay',
        name: 'Cause-Effect Essay',
        type: 'assignment',
        totalWeight: 10,
        unitWeight: 10,
        note: 'Week 12 Writing Assignment (10%)',
        keywords: ['essay', 'cause.*effect', 'writing\\s*assignment', 'مقال']
      },
      {
        id: 'eap_employability',
        name: 'Employability Skills',
        type: 'assignment',
        totalWeight: 10,
        count: 5,
        unitWeight: 2,
        note: '5 Employability Tasks across Weeks 2-13 (2% each, 10% total)',
        keywords: ['employability', 'skill', 'task', 'مهام', 'مهارات']
      }
    ]
  },

  // 4. Physics 1 Lab (Ordered before Physics 1 to guarantee priority matching)
  {
    id: 'phy1lab',
    courseCode: '1430116',
    courseName: 'Physics 1 Lab',
    crn: '10708',
    creditHours: 1,
    colorHex: '#4b99d2',
    aliases: [
      'physics.*lab',
      'phy(?:sics)?\\s*1\\s*lab',
      'مختبر.*فيزياء',
      'فيزياء.*عملي',
      '1430 116 11L',
      '1430 116',
      '1430116',
      '1430117',
      '0401116',
      'measuring\\s*density',
      'free\\s*fall',
      "student'?s\\s*lab"
    ],
    scheduleSlots: [
      {
        days: ['Wednesday'],
        startTime: '14:00',
        endTime: '16:45',
        room: 'Central Lab Men - 105',
        location: "Central Lab 105",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'phy1lab_final',
        name: 'Final Examination',
        type: 'exam',
        totalWeight: 40,
        unitWeight: 40,
        note: 'Practical Final Exam during last week (40%)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي', 'عملي']
      },
      {
        id: 'phy1lab_quizzes',
        name: 'Lab Quizzes',
        type: 'quiz',
        totalWeight: 30,
        count: 3,
        outOf: 4,
        unitWeight: 10,
        note: '4 scheduled, top 3 counted (10% each, 30% total)',
        keywords: ['quiz', 'كويز']
      },
      {
        id: 'phy1lab_reports',
        name: 'Experiments & Lab Reports',
        type: 'lab',
        totalWeight: 30,
        count: 9,
        unitWeight: 3.33,
        note: '9 Weekly lab reports (approx 3.33% each, 30% total)',
        keywords: ['report', 'experiment', 'تقرير', 'تجربة', 'مختبر']
      }
    ]
  },

  // 5. Physics 1
  {
    id: 'phy1',
    courseCode: '1430115',
    courseName: 'Physics 1',
    crn: '10668',
    creditHours: 3,
    colorHex: '#4b99d2',
    aliases: [
      'physics\\s*1(?!\\s*lab)',
      'general\\s*physics\\s*1',
      'فيزياء\\s*1(?!\\s*عملي)',
      'فيزياء\\s*عامة\\s*1',
      '1430 115 02',
      '1430 115',
      '1430115',
      '1430111',
      '0401115'
    ],
    scheduleSlots: [
      {
        days: ['Monday', 'Wednesday'],
        startTime: '11:00',
        endTime: '12:15',
        room: 'A8-110',
        location: "Room A8-110",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'phy1_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 45,
        unitWeight: 45,
        note: 'Final Examination (45 marks)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي']
      },
      {
        id: 'phy1_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 25,
        unitWeight: 25,
        note: 'Midterm Exam (25 marks)',
        keywords: ['midterm\\s*exam', 'midterm', 'امتحان\\s*نصفي', 'نصفي', 'منتصف']
      },
      {
        id: 'phy1_quizzes',
        name: 'Quizzes',
        type: 'quiz',
        totalWeight: 20,
        unitWeight: 20,
        note: 'Quizzes throughout semester (average = 20 marks)',
        keywords: ['quiz', 'كويز', 'امتحان\\s*قصير']
      },
      {
        id: 'phy1_assignments',
        name: 'Assignments',
        type: 'assignment',
        totalWeight: 10,
        unitWeight: 10,
        note: 'Assignments / Homework (10 marks total)',
        keywords: ['assignment', 'hw', 'homework', 'واجب']
      }
    ]
  },

  // 6. Islamic Culture
  {
    id: 'islamic',
    courseCode: '0104100',
    courseName: 'Islamic Culture',
    crn: '10475',
    creditHours: 3,
    colorHex: '#489160',
    aliases: [
      'islamic',
      'ثقافة\\s*إسلامية',
      'ثقافة\\s*اسلامية',
      'إسلام',
      'اسلام',
      '0104 100 13A',
      '0104 100',
      '0104100',
      '0104101'
    ],
    scheduleSlots: [
      {
        days: ['Monday', 'Wednesday'],
        startTime: '17:00',
        endTime: '18:15',
        room: 'A8-TH005',
        location: "Room A8-TH005",
        instructor: 'Course Faculty'
      }
    ],
    syllabus: [
      {
        id: 'islamic_final',
        name: 'Final Exam',
        type: 'exam',
        totalWeight: 50,
        unitWeight: 50,
        note: 'Comprehensive final exam (50%)',
        keywords: ['final\\s*exam', 'final', 'امتحان\\s*نهائي', 'نهائي']
      },
      {
        id: 'islamic_midterm',
        name: 'Midterm Exam',
        type: 'exam',
        totalWeight: 25,
        unitWeight: 25,
        note: 'Midterm exam (25%)',
        keywords: ['midterm\\s*exam', 'midterm', 'امتحان\\s*نصفي', 'نصفي', 'منتصف']
      },
      {
        id: 'islamic_coursework',
        name: 'Coursework & Research',
        type: 'project',
        totalWeight: 25,
        unitWeight: 15,
        note: 'واجبات، تقارير، مشروعات، امتحانات قصيرة (25% total)',
        keywords: ['بحث', 'مشروع', 'تقرير', 'واجب', 'عرض', 'project', 'research', 'assignment', 'report', 'quiz', 'كويز']
      }
    ]
  }
];
