// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeProfile, newerProfile } from '../src/core/studentProfile';
import { extractStudentFromExamHtml } from '../src/core/examSchedule';
import { fetchSession, extractUserName, isGenericPlaceholderName } from '../src/scan/blackboardApi';
import { extractStudentFromBlackboardPage } from '../src/content/studentProfileExtractor';
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

  it('queries fallback public user endpoint when /users/me omits student name', async () => {
    const mockFetch = async (url: string) => {
      if (url === '/learn/api/v1/users/me') {
        return new Response(JSON.stringify({
          id: '_99999_1',
          userName: 'u21100999'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === '/learn/api/public/v1/users/me') {
        return new Response(JSON.stringify({
          id: '_99999_1',
          name: {
            given: 'Rashid',
            family: 'Al-Ketbi'
          },
          contact: {
            email: 'rashid@sharjah.ac.ae'
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    };

    const session = await fetchSession(mockFetch as any);
    expect(session.state).toBe('ok');
    expect(session.studentName).toBe('Rashid Al-Ketbi');
    expect(session.studentId).toBe('u21100999');
    expect(session.studentEmail).toBe('rashid@sharjah.ac.ae');
  });
});

describe('extractUserName and placeholder rejection', () => {
  it('extracts various formatted name structures and rejects placeholders', () => {
    expect(extractUserName({ displayName: 'Fatima Al-Ali' })).toBe('Fatima Al-Ali');
    expect(extractUserName({ formattedName: 'Omar Hassan' })).toBe('Omar Hassan');
    expect(extractUserName({ fullName: 'Salem Al-Zaabi' })).toBe('Salem Al-Zaabi');
    expect(extractUserName({ name: { given: 'Hamad', family: 'Sultan' } })).toBe('Hamad Sultan');
    expect(extractUserName({ givenName: 'Mariam', familyName: 'Khalid' })).toBe('Mariam Khalid');
    expect(extractUserName({ user: { displayName: 'Noura Salem' } })).toBe('Noura Salem');

    expect(isGenericPlaceholderName('Student')).toBe(true);
    expect(isGenericPlaceholderName('student')).toBe(true);
    expect(isGenericPlaceholderName('User')).toBe(true);
    expect(isGenericPlaceholderName('طالب')).toBe(true);
    expect(isGenericPlaceholderName('unknown')).toBe(true);
    expect(isGenericPlaceholderName('Student Name')).toBe(true);
    expect(isGenericPlaceholderName('اسم الطالب')).toBe(true);
    expect(isGenericPlaceholderName('Rashid Al-Ketbi')).toBe(false);

    expect(extractUserName({ name: 'Student' })).toBeUndefined();
    expect(extractUserName({ displayName: 'طالب' })).toBeUndefined();
  });
});

describe('extractStudentFromBlackboardPage DOM extraction', () => {
  it('extracts student name from Ultra avatar alt text', () => {
    const doc = document.implementation.createHTMLDocument('bb');
    doc.body.innerHTML = `
      <div class="user-info">
        <img class="bb-avatar" alt="Profile photo of Saeed Al-Mehairi" src="/avatar.jpg" />
      </div>
    `;
    const res = extractStudentFromBlackboardPage(doc);
    expect(res).not.toBeNull();
    expect(res?.studentName).toBe('Saeed Al-Mehairi');
  });

  it('extracts student name from Arabic Ultra avatar alt text', () => {
    const doc = document.implementation.createHTMLDocument('bb');
    doc.body.innerHTML = `
      <div class="user-info">
        <img class="bb-avatar" alt="صورة الملف الشخصي لـ خولة راشد" src="/avatar.jpg" />
      </div>
    `;
    const res = extractStudentFromBlackboardPage(doc);
    expect(res).not.toBeNull();
    expect(res?.studentName).toBe('خولة راشد');
  });

  it('extracts student name from Ultra base navigation profile link', () => {
    const doc = document.implementation.createHTMLDocument('bb');
    doc.body.innerHTML = `
      <nav class="base-navigation">
        <a href="/ultra/profile" class="base-navigation-button">
          <span class="profile-name">Zayed Al-Mansouri</span>
        </a>
      </nav>
    `;
    const res = extractStudentFromBlackboardPage(doc);
    expect(res).not.toBeNull();
    expect(res?.studentName).toBe('Zayed Al-Mansouri');
  });

  it('extracts student name from Classic Blackboard global nav', () => {
    const doc = document.implementation.createHTMLDocument('bb');
    doc.body.innerHTML = `
      <header>
        <span id="global-nav-link">Aisha Al-Suwaidi</span>
      </header>
    `;
    const res = extractStudentFromBlackboardPage(doc);
    expect(res).not.toBeNull();
    expect(res?.studentName).toBe('Aisha Al-Suwaidi');
  });

  it('ignores generic placeholder names in DOM', () => {
    const doc = document.implementation.createHTMLDocument('bb');
    doc.body.innerHTML = `
      <div class="user-info">
        <img class="bb-avatar" alt="Profile photo of Student" src="/avatar.jpg" />
      </div>
    `;
    const res = extractStudentFromBlackboardPage(doc);
    expect(res).toBeNull();
  });
});

describe('bilingual Banner exam schedule extraction', () => {
  it('extracts student info from bilingual UOS Banner headers', () => {
    const html = `
      <table class="datadisplaytable">
        <tr>
          <th>Student ID / رقم الطالب</th>
          <td>U21100777</td>
          <th>Student Name / اسم الطالب</th>
          <td>Mayed Al-Qasimi</td>
        </tr>
        <tr>
          <th>College / الكلية</th>
          <td>College of Computing and Informatics</td>
          <th>Major / التخصص</th>
          <td>Information Technology</td>
        </tr>
      </table>
    `;

    const profile = extractStudentFromExamHtml(html);
    expect(profile).not.toBeNull();
    expect(profile?.studentId).toBe('U21100777');
    expect(profile?.studentName).toBe('Mayed Al-Qasimi');
    expect(profile?.college).toBe('College of Computing and Informatics');
    expect(profile?.major).toBe('Information Technology');
  });
});
