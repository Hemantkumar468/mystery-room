import { describe, expect, it } from 'vitest';
import { assessmentRows } from './assessmentRows.jsx';
import { assessmentRowColumns } from './AssessmentScoreCell.jsx';

describe('Assessment group rowSpan and alignment', () => {
  const mockProperties = [
    {
      id: 'prop-1',
      title: 'demo',
      city: 'Amritsar',
      locality: 'Mall Road',
      assessments: [
        { type: 'feasibility', status: 'approved', values: { footfall_assessment: 8 } },
        { type: 'financial', status: 'filed', values: { roi: 25 } },
        { type: 'operational', status: 'draft', values: {} },
      ],
      assessmentSlots: [
        { type: 'feasibility', state: 'filed', assignedTo: 'Alice', planDate: '2026-10-10' },
        { type: 'financial', state: 'filed', assignedTo: 'Bob', planDate: '2026-10-12' },
        { type: 'operational', state: 'open', assignedTo: 'Charlie', planDate: '2026-10-15' },
      ],
    },
    {
      id: 'prop-2',
      title: 'gandhi naagar',
      city: 'Amritsar',
      locality: 'Gandhi Nagar',
      assessments: [
        { type: 'financial', status: 'filed', values: { roi: 18 } },
        { type: 'operational', status: 'completed', values: {} },
      ],
      assessmentSlots: [
        { type: 'financial', state: 'filed', assignedTo: 'Bob' },
        { type: 'operational', state: 'filed', assignedTo: 'David' },
      ],
    },
  ];

  it('generates rows where each property has span equal to asked assessments count', () => {
    const rows = assessmentRows(mockProperties);
    // prop-1 has 3 assessments, prop-2 has 2 assessments -> total 5 rows
    expect(rows).toHaveLength(5);

    const prop1Rows = rows.filter((r) => r.property.id === 'prop-1');
    expect(prop1Rows).toHaveLength(3);
    expect(prop1Rows[0].span).toBe(3);
    expect(prop1Rows[0].isFirst).toBe(true);
    expect(prop1Rows[0].isLast).toBe(false);
    expect(prop1Rows[1].span).toBe(3);
    expect(prop1Rows[1].isFirst).toBe(false);
    expect(prop1Rows[1].isLast).toBe(false);
    expect(prop1Rows[2].span).toBe(3);
    expect(prop1Rows[2].isFirst).toBe(false);
    expect(prop1Rows[2].isLast).toBe(true);

    const prop2Rows = rows.filter((r) => r.property.id === 'prop-2');
    expect(prop2Rows).toHaveLength(2);
    expect(prop2Rows[0].span).toBe(2);
    expect(prop2Rows[0].isFirst).toBe(true);
    expect(prop2Rows[0].isLast).toBe(false);
    expect(prop2Rows[1].span).toBe(2);
    expect(prop2Rows[1].isFirst).toBe(false);
    expect(prop2Rows[1].isLast).toBe(true);
  });

  it('keeps each assessment row individual data unchanged', () => {
    const rows = assessmentRows(mockProperties);
    const prop1Rows = rows.filter((r) => r.property.id === 'prop-1');

    expect(prop1Rows[0].type).toBe('feasibility');
    expect(prop1Rows[0].slot.assignedTo).toBe('Alice');
    expect(prop1Rows[1].type).toBe('financial');
    expect(prop1Rows[1].slot.assignedTo).toBe('Bob');
    expect(prop1Rows[2].type).toBe('operational');
    expect(prop1Rows[2].slot.assignedTo).toBe('Charlie');
  });

  it('Location column provides rowSpan covering all assessments on the first row and 0 on subsequent rows', () => {
    const cols = assessmentRowColumns({});
    const cityCol = cols.find((c) => c.key === 'city');

    expect(cityCol).toBeDefined();
    expect(cityCol.className).toContain('pcx-span');

    const rows = assessmentRows(mockProperties);
    const prop1Rows = rows.filter((r) => r.property.id === 'prop-1');

    // First row: rowSpan returns 3
    expect(cityCol.rowSpan(prop1Rows[0])).toBe(3);
    // Intermediate rows: rowSpan returns 0 (merged, not rendered separately)
    expect(cityCol.rowSpan(prop1Rows[1])).toBe(0);
    expect(cityCol.rowSpan(prop1Rows[2])).toBe(0);
  });

  it('Property Name column provides rowSpan covering all assessments on the first row and 0 on subsequent rows', () => {
    const cols = assessmentRowColumns({});
    const titleCol = cols.find((c) => c.key === 'title');

    expect(titleCol).toBeDefined();
    expect(titleCol.className).toContain('pcx-span');

    const rows = assessmentRows(mockProperties);
    const prop1Rows = rows.filter((r) => r.property.id === 'prop-1');

    // First row: rowSpan returns 3
    expect(titleCol.rowSpan(prop1Rows[0])).toBe(3);
    // Intermediate rows: rowSpan returns 0
    expect(titleCol.rowSpan(prop1Rows[1])).toBe(0);
    expect(titleCol.rowSpan(prop1Rows[2])).toBe(0);
  });
});
