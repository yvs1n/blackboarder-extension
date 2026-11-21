/**
 * Multi-column assessment table and weighted line parser for course syllabi.
 * Extracted cleanly so both courseDocument.ts and unit tests can reuse it while staying modular.
 */
import type { CustomSyllabusComponent } from '../types';
import { makeSyllabusComponent } from './courseImporter';

const ASSESSMENT_HEADER = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:(?:course|module)\s+)?(?:(?:assessments?|grading|evaluation|grade\s+(?:distribution|breakdown)|marks?\s+(?:distribution|allocation)|distribution\s+of\s+(?:marks|grades)|weighting|assessment\s+(?:methods?|plan|strategy|tools|components?|criteria)|scheme\s+of\s+assessment|summative\s+assessment|course\s+(?:grade|requirements?|evaluation)|grading\s+(?:policy|scheme|criteria|system|breakdown)|evaluation\s+breakdown)\b|توزيع\s*(?:الدرجات|العلامات)|التقييم|طرق\s*التقييم|خطة\s*التقييم)/i;
const PROSE = /\b(?:will|must|should|shall|more than|less than|at least|up to|exceed|deduct|penalt|plagiar|similarity|turnitin|absen|late\b|warning|receive|obtain|minimum|maximum)/i;
const GRADE_ROW = /^\s*(?:[A-F][+-]?\s*[:=\t ]\s*\(?\d|\b\d{2,3}(?:\.\d+)?\s*(?:-|to)\s*\d{2,3}(?:\.\d+)?\s*(?:%|[:=\t ]\s*[A-F][+-]?))/i;

const TABLE_HEADER_NAME = /\b(?:assessments?|components?|tasks?|activities|activity|evaluations?|methods?|tools?|descriptions?|titles?|names?|types?|items?|instruments?|work|deliverables?|modules?)\b|التقييم|الاختبار|المهمة|البند|طريقة التقييم|نوع التقييم|النشاط|الأداة|العنصر/i;
const TABLE_HEADER_WEIGHT = /\b(?:weights?|weightings?|percentages?|%|marks?|grades?|points?|scores?|share|distributions?|out\s*of)\b|النسبة|الدرجة|العلامة|الوزن/i;
const TABLE_HEADER_DATE = /\b(?:dates?|due|weeks?|timing|deadlines?|schedule|submission)\b|التاريخ|الأسبوع|موعد|أسبوع/i;
const TABLE_HEADER_NOTES = /\b(?:notes?|remarks?|details?|comments?|clos?|plos?|topics?|coverage|learning\s*outcomes?)\b|ملاحظات|تفاصيل/i;

export const sumOfWeights = (comps: CustomSyllabusComponent[]) => comps.reduce((s, c) => s + c.totalWeight, 0);

function splitLineCells(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.includes('\t')) return trimmed.split('\t').map(c => c.trim()).filter(Boolean);
  if (trimmed.includes('|')) return trimmed.split('|').map(c => c.trim()).filter(Boolean);
  if (/\s{2,}/.test(trimmed)) return trimmed.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
  return [trimmed];
}

/** Resolves nested parent category totals (e.g. Theory 70% with sub-items Midterm 30%, Quizzes 15%, Final 25%). */
export function resolveNestedCategories(components: CustomSyllabusComponent[]): CustomSyllabusComponent[] {
  const sum = sumOfWeights(components);
  if (Math.abs(sum - 100) <= 5) return components;

  const toRemove = new Set<number>();
  for (let i = 0; i < components.length; i++) {
    const parentWeight = components[i].totalWeight;
    let subSum = 0;
    const subIdxs: number[] = [];
    for (let j = i + 1; j < components.length; j++) {
      subSum += components[j].totalWeight;
      subIdxs.push(j);
      if (Math.abs(subSum - parentWeight) <= 0.5 && subIdxs.length >= 2) {
        toRemove.add(i);
        break;
      }
      if (subSum > parentWeight + 1) break;
    }
  }

  if (toRemove.size > 0) {
    const filtered = components.filter((_, idx) => !toRemove.has(idx));
    if (Math.abs(sumOfWeights(filtered) - 100) <= 5) return filtered;
  }
  return components;
}

/** Parses a table row when table header column positions are known. */
function parseTableRowWithHeader(
  cells: string[],
  map: { nameCol: number; weightCol: number; dateCol: number; notesCol: number },
  idx: number,
  rawLine: string,
  allowLargePoints = false
): CustomSyllabusComponent | null {
  if (cells.length < 2) return null;
  const lineText = cells.join(' ');
  if (/^total\b|\btotal\s*[:=]?\s*\d{2,4}\b|المجموع|الإجمالي/i.test(lineText)) return null;
  const rawNameCell = (cells[map.nameCol] || '').trim();
  if (GRADE_ROW.test(lineText) || (PROSE.test(rawNameCell) && rawNameCell.length > 35)) return null;

  let weight: number | undefined;
  const weightCell = cells[map.weightCol] || '';
  const maxAllowed = allowLargePoints ? 2000 : 100;
  const weightMatch = weightCell.match(/(\d{1,4}(?:\.\d+)?)\s*%?/) || lineText.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (weightMatch) {
    const val = parseFloat(weightMatch[1]);
    if (val > 0 && val <= maxAllowed) weight = val;
  }
  if (weight === undefined) {
    for (let i = 0; i < cells.length; i++) {
      if (i === map.nameCol) continue;
      const m = cells[i].match(/^(\d{1,4}(?:\.\d+)?)$/);
      if (m) {
        const val = parseFloat(m[1]);
        if (val > 0 && val <= maxAllowed) { weight = val; break; }
      }
    }
  }
  if (weight === undefined) return null;

  let name = (cells[map.nameCol] || '')
    .replace(/^[\s\-•*●▪◦·]+/, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .replace(/\s*\([^)]*\d[^)]*\)\s*$/, '')
    .replace(/[\s:=\-–(|,]+$/, '')
    .trim();

  if (!name || !/[A-Za-z؀-ۿ]{2}/.test(name)) {
    for (let i = 0; i < cells.length; i++) {
      if (i === map.weightCol) continue;
      const candidate = cells[i].replace(/^[\s\-•*●▪◦·]+/, '').trim();
      if (/[A-Za-z؀-ۿ]{2}/.test(candidate) && !/^\d+$/.test(candidate) && !/^(?:week|date|due|tbd|day|room)\b/i.test(candidate)) {
        name = candidate;
        break;
      }
    }
  }
  if (!name || !/[A-Za-z؀-ۿ]{2}/.test(name) || name.length > 75 || PROSE.test(name)) return null;

  const notesText = (map.notesCol >= 0 ? cells[map.notesCol] + ' ' : '') + lineText;
  const countMatch = notesText.match(/best\s+(\d{1,2})\s+(?:out\s+)?of\s+(?:the\s+)?(\d{1,2})/i)
    || notesText.match(/أفضل\s+(\d{1,2})\s+من\s+(\d{1,2})/)
    || notesText.match(/\((\d{1,2})\)/)
    || notesText.match(/\b(\d{1,2})\s*[x×]\s*\d/)
    || notesText.match(/[x×]\s*(\d{1,2})\b(?!\s*%)/)
    || notesText.match(/\b(\d{1,2})\s+(?:(?:quizzes|quiz|exams|tests|assignments|homeworks?|reports|labs|projects|presentations|activities|tasks|experiments)\b|كويزات|واجبات|اختبارات)/i);

  const count = countMatch ? parseInt(countMatch[1], 10) : undefined;
  const outOf = countMatch && countMatch[2] ? parseInt(countMatch[2], 10) : undefined;

  return makeSyllabusComponent(name, weight, count && count > 0 ? count : undefined, idx, rawLine, outOf);
}

/** Normalizes raw point values to percentages totaling 100 when a points table ends with an explicit Total or sums cleanly. */
function normalizePointComponents(components: CustomSyllabusComponent[], explicitTotal: number | null): CustomSyllabusComponent[] {
  const sum = sumOfWeights(components);
  if (Math.abs(sum - 100) <= 5) return components;
  const targetTotal = explicitTotal && explicitTotal >= 20 && Math.abs(sum - explicitTotal) <= 5 ? explicitTotal : null;
  if (!targetTotal || components.length < 2) return components;
  return components.map(c => {
    const pct = Number(((c.totalWeight / targetTotal) * 100).toFixed(2));
    return {
      ...c,
      totalWeight: pct,
      unitWeight: c.count && c.count > 1 ? Number((pct / c.count).toFixed(2)) : pct
    };
  });
}

/** LLM-grade table parser for multi-column syllabus assessment tables. */
export function parseAssessmentTable(lines: string[]): CustomSyllabusComponent[] {
  for (let i = 0; i < lines.length; i++) {
    const cells = splitLineCells(lines[i]);
    if (cells.length < 2) continue;

    let nameCol = -1;
    let weightCol = -1;
    let dateCol = -1;
    let notesCol = -1;

    cells.forEach((cell, idx) => {
      if (TABLE_HEADER_NAME.test(cell) && nameCol < 0) nameCol = idx;
      else if (TABLE_HEADER_WEIGHT.test(cell) && weightCol < 0) weightCol = idx;
      else if (TABLE_HEADER_DATE.test(cell) && dateCol < 0) dateCol = idx;
      else if (TABLE_HEADER_NOTES.test(cell) && notesCol < 0) notesCol = idx;
    });

    if (weightCol >= 0) {
      if (nameCol < 0) nameCol = cells.findIndex((_, idx) => idx !== weightCol);
      if (nameCol >= 0) {
        const headerWeight = (cells[weightCol] || '').toLowerCase();
        const isPointCol = /\b(?:points?|marks?|scores?|out\s*of)\b/.test(headerWeight) && !headerWeight.includes('%');
        const map = { nameCol, weightCol, dateCol, notesCol };
        const components: CustomSyllabusComponent[] = [];
        const seenNames = new Set<string>();
        let emptyCount = 0;
        let explicitTotal: number | null = null;
        const headerTotal = headerWeight.match(/out\s*of\s*(\d{2,4})/i);
        if (headerTotal) explicitTotal = parseFloat(headerTotal[1]);

        for (let j = i + 1; j < Math.min(lines.length, i + 50); j++) {
          const rowLine = lines[j].trim();
          if (!rowLine) {
            emptyCount++;
            if (emptyCount >= 3) break;
            continue;
          }
          emptyCount = 0;
          const totalMatch = rowLine.match(/^(?:grand\s*)?total\b.*?\b(\d{2,4}(?:\.\d+)?)\s*(?:pts?|points?|marks?|%)?\s*$/i)
            || rowLine.match(/(?:المجموع|الإجمالي)\s*[:=]?\s*(\d{2,4})/);
          if (totalMatch || /^total\b|المجموع|الإجمالي/i.test(rowLine)) {
            if (totalMatch) explicitTotal = parseFloat(totalMatch[1]);
            break;
          }
          if (/^(?:course\s+policies|attendance|grading\s+scale|academic\s+integrity|schedule|weekly|lecture)/i.test(rowLine)) break;

          const rowCells = splitLineCells(rowLine);
          const comp = parseTableRowWithHeader(rowCells, map, components.length, rowLine, isPointCol);
          if (comp) {
            const key = comp.name.toLowerCase();
            if (!seenNames.has(key)) {
              seenNames.add(key);
              components.push(comp);
            }
          } else if (components.length > 0) {
            const dropMatch = rowLine.match(/best\s+(\d{1,2})\s+(?:out\s+)?of\s+(?:the\s+)?(\d{1,2})/i)
              || rowLine.match(/أفضل\s+(\d{1,2})\s+من\s+(\d{1,2})/);
            if (dropMatch) {
              const lastComp = components[components.length - 1];
              lastComp.count = parseInt(dropMatch[1], 10);
              if (dropMatch[2]) lastComp.outOf = parseInt(dropMatch[2], 10);
            }
          }
        }

        let resolved = resolveNestedCategories(components);
        if (isPointCol && Math.abs(sumOfWeights(resolved) - 100) > 5) {
          resolved = normalizePointComponents(resolved, explicitTotal);
        }
        const totalWeight = sumOfWeights(resolved);
        if (resolved.length >= 2 && Math.abs(totalWeight - 100) <= 5) {
          return resolved;
        }
      }
    }
  }
  return [];
}

/** Splits comma/semicolon-separated multi-assessment lines ("Midterm 30%, Final 40%, Quizzes 30%") cleanly. */
function assessmentsFromLine(line: string, inSection: boolean, startIdx: number): CustomSyllabusComponent[] {
  const pctCount = (line.match(/\d{1,3}(?:\.\d+)?\s*%/g) || []).length;
  if (pctCount >= 2 && /[,;•·|]/.test(line)) {
    const parts = line.split(/\s*[,;•·|]\s*/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const multi: CustomSyllabusComponent[] = [];
      for (const part of parts) {
        const comp = assessmentFromLine(part, true, startIdx + multi.length);
        if (comp) multi.push(comp);
      }
      if (multi.length >= 2) return multi;
    }
  }
  const single = assessmentFromLine(line, inSection, startIdx);
  return single ? [single] : [];
}

/** One weighted assessment from a line ("Midterm Exam 30%", "Quizzes (4) 20%", "Labs 4 x 5%"), or null. */
export function assessmentFromLine(line: string, inSection: boolean, idx: number): CustomSyllabusComponent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 220 || /^total\b|\btotal\s*[:=]?\s*100|المجموع|الإجمالي/i.test(trimmed)) return null;
  if (GRADE_ROW.test(trimmed)) return null;

  const cells = splitLineCells(line);
  if (cells.length >= 2) {
    let weightCellIdx = -1;
    let weightVal: number | undefined;

    for (let c = cells.length - 1; c >= 0; c--) {
      const pm = cells[c].match(/(\d{1,3}(?:\.\d+)?)\s*%/);
      if (pm) {
        const val = parseFloat(pm[1]);
        if (val > 0 && val <= 100) { weightCellIdx = c; weightVal = val; break; }
      }
    }
    if (weightVal === undefined && inSection) {
      for (let c = cells.length - 1; c >= 0; c--) {
        const nm = cells[c].match(/^(\d{1,3}(?:\.\d+)?)$/);
        if (nm) {
          const val = parseFloat(nm[1]);
          if (val > 0 && val <= 100) { weightCellIdx = c; weightVal = val; break; }
        }
      }
    }

    if (weightVal !== undefined && weightCellIdx >= 0) {
      let nameCellIdx = -1;
      for (let c = 0; c < cells.length; c++) {
        if (c === weightCellIdx) continue;
        const candidate = cells[c].replace(/^[\s\-•*●▪◦·]+/, '').trim();
        if (/[A-Za-z؀-ۿ]{2}/.test(candidate) && !/^(?:week|date|due|tbd|day|room)\b/i.test(candidate)) {
          nameCellIdx = c;
          break;
        }
      }
      if (nameCellIdx >= 0) {
        const name = cells[nameCellIdx]
          .replace(/^[\s\-•*●▪◦·]+/, '')
          .replace(/^\d{1,2}[.)]\s+/, '')
          .replace(/\s*\([^)]*\d[^)]*\)\s*$/, '')
          .replace(/[\s:=\-–(|,]+$/, '')
          .trim();

        const restText = cells.join(' ');
        const countMatch = restText.match(/best\s+(\d{1,2})\s+(?:out\s+)?of\s+(?:the\s+)?(\d{1,2})/i)
          || restText.match(/أفضل\s+(\d{1,2})\s+من\s+(\d{1,2})/)
          || restText.match(/\((\d{1,2})\)/)
          || restText.match(/\b(\d{1,2})\s*[x×]\s*\d/)
          || restText.match(/[x×]\s*(\d{1,2})\b(?!\s*%)/)
          || restText.match(/\b(\d{1,2})\s+(?:(?:quizzes|quiz|exams|tests|assignments|homeworks?|reports|labs|projects|presentations|activities|tasks|experiments)\b|كويزات|واجبات|اختبارات)/i);

        const count = countMatch ? parseInt(countMatch[1], 10) : undefined;
        const outOf = countMatch && countMatch[2] ? parseInt(countMatch[2], 10) : undefined;

        if (name && /[A-Za-z؀-ۿ]{2}/.test(name) && name.length <= 75 && !PROSE.test(name)) {
          return makeSyllabusComponent(name, weightVal, count && count > 0 ? count : undefined, idx, line, outOf);
        }
      }
    }
  }

  if (PROSE.test(trimmed)) return null;

  const text = line.replace(/\s+/g, ' ').trim();
  const pcts: { value: number; index: number; each: boolean; length: number }[] = [];
  const re = /(\d{1,3}(?:\.\d+)?)\s*%/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    pcts.push({ value: parseFloat(m[1]), index: m.index, length: m[0].length, each: /^\s*(?:each|per\b|\/\s*each|for each|apiece)/i.test(after) || /[x×*]\s*$/.test(before) });
  }
  let total: number | undefined;
  let unit: number | undefined;
  let numberAt = -1;
  for (const p of pcts) {
    if (p.each && unit === undefined) { unit = p.value; if (numberAt < 0) numberAt = p.index; }
    if (!p.each && total === undefined) { total = p.value; if (numberAt < 0 || p.index < numberAt) numberAt = p.index; }
  }
  if (!pcts.length && inSection) {
    const tabCells = line.split('\t').map(c => c.trim()).filter(Boolean);
    const last = tabCells[tabCells.length - 1];
    if (tabCells.length >= 2 && /^\d{1,3}(?:\.\d+)?$/.test(last) && /[A-Za-z؀-ۿ]{3}/.test(tabCells[0])) {
      total = parseFloat(last);
      numberAt = text.lastIndexOf(last);
    }
  }
  const countMatch = text.match(/best\s+(\d{1,2})\s+(?:out\s+)?of\s+(?:the\s+)?(\d{1,2})/i)
    || text.match(/\((\d{1,2})\)/)
    || text.match(/\b(\d{1,2})\s*[x×]\s*\d/)
    || text.match(/[x×]\s*(\d{1,2})\b(?!\s*%)/)
    || text.match(/\b(\d{1,2})\s+(?:quizzes|quiz|exams|tests|assignments|homeworks?|reports|labs|projects|presentations|activities|tasks|experiments)\b/i);
  const count = countMatch ? parseInt(countMatch[1], 10) : undefined;
  const outOf = countMatch && countMatch[2] ? parseInt(countMatch[2], 10) : undefined;
  if (total === undefined && unit !== undefined && count) total = Number((unit * count).toFixed(2));
  if (total === undefined || !(total > 0 && total <= 100) || numberAt < 0) return null;

  let name = text.slice(0, numberAt)
    .replace(/\s*\([^)]*\d[^)]*\)\s*$/, '')
    .replace(/\b\d{1,2}\s*[x×]\s*$/, '')
    .replace(/^[\s\-•*●▪◦·]+/, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .replace(/[\s:=\-–(|,]+$/, '')
    .trim();
  if (!/[A-Za-z؀-ۿ]{2}/.test(name)) {
    name = text.slice(numberAt).replace(/^\d{1,3}(?:\.\d+)?\s*%?\s*(?:each\s*)?[\-:–]?\s*/, '').replace(/\(.*$/, '').trim();
  }
  if (!/[A-Za-z؀-ۿ]{2}/.test(name) || name.length > 60) return null;
  return makeSyllabusComponent(name, total, count && count > 0 ? count : undefined, idx, text, outOf);
}

function weightsFrom(lines: string[], inSection: boolean): CustomSyllabusComponent[] {
  const out: CustomSyllabusComponent[] = [];
  const names = new Set<string>();
  let sum = 0;
  for (const line of lines) {
    const items = assessmentsFromLine(line, inSection, out.length);
    for (const comp of items) {
      const key = comp.name.toLowerCase();
      if (names.has(key)) continue;
      names.add(key);
      out.push(comp);
      sum += comp.totalWeight;
      if (inSection && sum >= 99.5) break;
    }
    if (inSection && sum >= 99.5) break;
  }
  return resolveNestedCategories(out);
}

/** The assessment weights: from the grading section closest to 100%, else from anywhere if they add up. */
export function syllabusWeights(lines: string[]): CustomSyllabusComponent[] {
  const tableResult = parseAssessmentTable(lines);
  if (tableResult.length >= 2 && Math.abs(sumOfWeights(tableResult) - 100) <= 5) {
    return tableResult;
  }

  let best: CustomSyllabusComponent[] = [];
  lines.forEach((line, i) => {
    if (line.length > 90 || !ASSESSMENT_HEADER.test(line.trim())) return;
    const found = weightsFrom(lines.slice(i + 1, i + 60), true);
    if (Math.abs(sumOfWeights(found) - 100) < Math.abs(sumOfWeights(best) - 100) || (!best.length && found.length)) best = found;
  });
  if (best.length >= 2 && Math.abs(sumOfWeights(best) - 100) <= 5) return best;
  const anywhere = weightsFrom(lines, false);
  if (anywhere.length >= 2 && Math.abs(sumOfWeights(anywhere) - 100) <= 5) return anywhere;
  return best.length >= 2 ? best : [];
}
