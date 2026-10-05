import { describe, expect, it } from 'vitest';
import { truncateByWords } from '../../components/ui/TruncatedText.jsx';
import { assessmentRowColumns } from './AssessmentScoreCell.jsx';

describe('Text Overflow & 10-word Truncation Logic', () => {
  const shortText = 'Footfall is excellent here'; // 4 words
  const tenWordText = 'One two three four five six seven eight nine ten'; // 10 words
  const userExample = 'To establish how this outlet would run day to day and understand the operational requirements of the property.'; // 18 words

  it('does not truncate text with <= 10 words', () => {
    const result = truncateByWords(shortText, 10);
    expect(result.isTruncated).toBe(false);
    expect(result.text).toBe(shortText);
    expect(result.words).toHaveLength(4);
  });

  it('does not truncate text with exactly 10 words', () => {
    const result = truncateByWords(tenWordText, 10);
    expect(result.isTruncated).toBe(false);
    expect(result.text).toBe(tenWordText);
    expect(result.words).toHaveLength(10);
  });

  it('truncates text with > 10 words to first 10 words + "..."', () => {
    const result = truncateByWords(userExample, 10);
    expect(result.isTruncated).toBe(true);
    expect(result.text).toBe(userExample);
    expect(result.words).toHaveLength(18);
    expect(result.collapsedText).toBe('To establish how this outlet would run day to day...');
  });

  it('handles empty, null, or undefined gracefully', () => {
    expect(truncateByWords('')).toEqual({ isTruncated: false, text: '', words: [] });
    expect(truncateByWords(null)).toEqual({ isTruncated: false, text: '', words: [] });
    expect(truncateByWords(undefined)).toEqual({ isTruncated: false, text: '', words: [] });
  });

  it('handles extra whitespace between words properly', () => {
    const messyText = '  Word1   Word2  Word3  Word4 Word5 Word6 Word7 Word8 Word9 Word10 Word11   ';
    const result = truncateByWords(messyText, 10);
    expect(result.isTruncated).toBe(true);
    expect(result.words).toHaveLength(11);
    expect(result.collapsedText).toBe('Word1 Word2 Word3 Word4 Word5 Word6 Word7 Word8 Word9 Word10...');
  });
});

describe('assessmentRowColumns Notes & purpose integration', () => {
  it('renders TruncatedText component for notes column when answers exist', () => {
    const cols = assessmentRowColumns({});
    const notesCol = cols.find((c) => c.key === 'notes');
    expect(notesCol).toBeDefined();

    const mockRow = {
      type: 'operational',
      label: 'Operational',
      entry: {
        values: {
          purpose: 'To establish how this outlet would run day to day and understand the operational requirements of the property.',
        },
      },
    };

    const rendered = notesCol.render(mockRow);
    expect(rendered).toBeDefined();
    expect(rendered.props.className).toBe('as-notes');
    // Child is TruncatedText with text prop containing the full purpose
    const child = rendered.props.children;
    expect(child.props.text).toBe('To establish how this outlet would run day to day and understand the operational requirements of the property.');
    expect(child.props.className).toBe('as-notes-text');
  });

  it('joins multiple written answers with newlines to ensure no information is lost', () => {
    const cols = assessmentRowColumns({});
    const notesCol = cols.find((c) => c.key === 'notes');

    const mockRow = {
      type: 'feasibility',
      label: 'Feasibility',
      entry: {
        values: {
          purpose: 'Primary purpose for feasibility analysis of this property location.',
          remarks: 'Good footfall potential during evenings and weekends.',
        },
      },
    };

    const rendered = notesCol.render(mockRow);
    const child = rendered.props.children;
    expect(child.props.text).toContain('Primary purpose');
    expect(child.props.text).toContain('Good footfall potential');
    expect(child.props.text).toBe(
      'Primary purpose for feasibility analysis of this property location.\n\nGood footfall potential during evenings and weekends.'
    );
  });
});
