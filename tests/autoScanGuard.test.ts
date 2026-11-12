// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isAssessmentTakingPage } from '../src/content/scraper';

describe('isAssessmentTakingPage guard', () => {
  it('detects classic Blackboard assessment take URLs', () => {
    const loc = { pathname: '/webapps/assessment/take/launch.jsp', search: '' } as Location;
    expect(isAssessmentTakingPage(loc, document)).toBe(true);

    const loc2 = { pathname: '/webapps/assessment/do/take', search: '' } as Location;
    expect(isAssessmentTakingPage(loc2, document)).toBe(true);
  });

  it('detects attempt or assessment id query parameters', () => {
    const loc = { pathname: '/ultra/courses/_123_1/outline', search: '?attempt_id=98765' } as Location;
    expect(isAssessmentTakingPage(loc, document)).toBe(true);

    const loc2 = { pathname: '/webapps/blackboard/content/launchLink.jsp', search: '?course_assessment_id=_456_1' } as Location;
    expect(isAssessmentTakingPage(loc2, document)).toBe(true);
  });

  it('detects Ultra test submission paths', () => {
    const loc = { pathname: '/ultra/courses/_123_1/assessment/take/launch', search: '' } as Location;
    expect(isAssessmentTakingPage(loc, document)).toBe(true);

    const loc2 = { pathname: '/ultra/courses/_123_1/attempt/_999_1', search: '' } as Location;
    expect(isAssessmentTakingPage(loc2, document)).toBe(true);
  });

  it('returns false for normal course pages and stream', () => {
    const locStream = { pathname: '/ultra/stream', search: '' } as Location;
    expect(isAssessmentTakingPage(locStream, document)).toBe(false);

    const locOutline = { pathname: '/ultra/courses/_123_1/outline', search: '' } as Location;
    expect(isAssessmentTakingPage(locOutline, document)).toBe(false);

    const locGrades = { pathname: '/ultra/courses/_123_1/grades', search: '' } as Location;
    expect(isAssessmentTakingPage(locGrades, document)).toBe(false);
  });

  it('detects active test taking DOM elements', () => {
    const loc = { pathname: '/webapps/portal/execute/defaultTab', search: '' } as Location;
    const div = document.createElement('div');
    div.id = 'timer-div';
    document.body.appendChild(div);

    expect(isAssessmentTakingPage(loc, document)).toBe(true);
    div.remove();
  });
});
