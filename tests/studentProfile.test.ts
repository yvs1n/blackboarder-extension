import { describe, it, expect } from 'vitest';
import { sanitizeProfile, newerProfile } from '../src/core/studentProfile';
import { extractStudentFromExamHtml } from '../src/core/examSchedule';
import { fetchSession } from '../src/scan/blackboardApi';
import { StudentProfile } from '../src/types';

describe('studentProfile identity fields', () => {
  it('sanitizes student profile identity properties safely', () => {
    const raw = {
      universityId: 'uos',
      updatedAt: new Date().toISOString(),
      studentName: '  John Doe  ',
      studentId: '  U21100123  ',
      studentEmail: '  jdoe@sharjah.ac.ae  ',
      college: '  College of Computing  ',
      major: '  Computer Science  '
    };

    const sanitized = sanitizeProfile(raw);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.studentName).toBe('John Doe');
    expect(sanitized?.studentId).toBe('U21100123');
    expect(sanitized?.studentEmail).toBe('jdoe@sharjah.ac.ae');
    expect(sanitized?.college).toBe('College of Computing');
    expect(sanitized?.major).toBe('Computer Science');
  });

  it('newerProfile preserves and merges student identity when newer profile omits them', () => {
    const older: StudentProfile = {
      universityId: 'uos',
      updatedAt: '2026-10-01T10:00:00.000Z',
      studentName: 'Jane Doe',
      studentId: 'U21100999',
      college: 'College of Engineering',
      major: 'Electrical Engineering'
    };

    const newer: StudentProfile = {
      universityId: 'uos',
      updatedAt: '2026-10-02T10:00:00.000Z'
      // identity omitted in newer sync write
    };

    const merged = newerProfile(older, newer);
    expect(merged?.updatedAt).toBe('2026-10-02T10:00:00.000Z');
    expect(merged?.studentName).toBe('Jane Doe');
    expect(merged?.studentId).toBe('U21100999');
    expect(merged?.college).toBe('College of Engineering');
    expect(merged?.major).toBe('Electrical Engineering');
  });
});

describe('Banner exam schedule student extraction', () => {
  it('extracts student name, ID, college, and major from Banner HTML (key-value table)', () => {
    const html = `
      <table class="datadisplaytable">
        <tr>
          <th>Student ID</th>
          <td>U21100456</td>
          <th>Student Name</th>
          <td>Jane Al-Sharqi</td>
        </tr>
        <tr>
          <th>College</th>
          <td>College of Computing and Informatics</td>
          <th>Major</th>
          <td>Computer Science</td>
        </tr>
      </table>
    `;

    const profile = extractStudentFromExamHtml(html);
    expect(profile).not.toBeNull();
    expect(profile?.studentId).toBe('U21100456');
    expect(profile?.studentName).toBe('Jane Al-Sharqi');
    expect(profile?.college).toBe('College of Computing and Informatics');
    expect(profile?.major).toBe('Computer Science');
  });

  it('extracts student name, ID, college, and major from Banner HTML (column-header table)', () => {
    const html = `
      <table>
        <tr>
          <th>Student ID</th>
          <th>Student Name</th>
          <th>College</th>
          <th>Major</th>
        </tr>
        <tr>
          <td>U19100111</td>
          <td>Tariq Al-Nuaimi</td>
          <td>Engineering</td>
          <td>Mechanical Engineering</td>
        </tr>
      </table>
    `;

    const profile = extractStudentFromExamHtml(html);
    expect(profile).not.toBeNull();
    expect(profile?.studentId).toBe('U19100111');
    expect(profile?.studentName).toBe('Tariq Al-Nuaimi');
    expect(profile?.college).toBe('Engineering');
    expect(profile?.major).toBe('Mechanical Engineering');
  });
});

describe('Blackboard API fetchSession student extraction', () => {
  it('parses student name, ID and email from users/me endpoint', async () => {
    const mockFetch = async () => new Response(JSON.stringify({
      id: '_12345_1',
      userName: 'u19100789',
      studentId: 'U19100789',
      name: {
        display: 'Yassin Student',
        given: 'Yassin',
        family: 'Student'
      },
      contact: {
        email: 'yassin@sharjah.ac.ae'
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const session = await fetchSession(mockFetch as any);
    expect(session.state).toBe('ok');
    expect(session.userId).toBe('_12345_1');
    expect(session.studentName).toBe('Yassin Student');
    expect(session.studentId).toBe('U19100789');
    expect(session.studentEmail).toBe('yassin@sharjah.ac.ae');
  });

  it('rethrows AbortError on cancelled session fetch', async () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    const mockFetch = async () => { throw abortErr; };

    await expect(fetchSession(mockFetch as any)).rejects.toThrow('Aborted');
  });
});
