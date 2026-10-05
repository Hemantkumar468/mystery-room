import { useState } from 'react';

/**
 * TruncatedText — word-based text truncation with inline View more / View less.
 *
 * Requirements:
 *  - If text contains <= 10 words: display it normally without any "View more" button.
 *  - If text contains > 10 words: display the first 10 words + "... " + "View more" button.
 *  - Clicking "View more": expands to show complete original text + " " + "View less" button.
 *  - Clicking "View less": collapses back to first 10 words + "... " + "View more" button.
 *  - Inline interaction: does not navigate, does not open modals/forms, keeps all data intact.
 */
/**
 * Pure helper function to compute word-based truncation:
 * <= maxWords: isTruncated = false, full text returned.
 * > maxWords: isTruncated = true, collapsedText = first 10 words + '...'
 */
export function truncateByWords(text, maxWords = 10) {
  if (text === null || text === undefined || text === '') {
    return { isTruncated: false, text: '', words: [] };
  }
  const str = String(text);
  const words = str.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return { isTruncated: false, text: str, words };
  }
  return {
    isTruncated: true,
    text: str,
    collapsedText: words.slice(0, maxWords).join(' ') + '...',
    words,
  };
}

export function TruncatedText({ text, maxWords = 10, className = '' }) {
  const [expanded, setExpanded] = useState(false);

  const info = truncateByWords(text, maxWords);
  if (!info.text) {
    return null;
  }

  if (!info.isTruncated) {
    return className ? <span className={className}>{info.text}</span> : info.text;
  }

  return (
    <span className={`truncate-text-wrap ${className}`.trim()}>
      <span className="truncate-text-content">
        {expanded ? info.text : info.collapsedText}
      </span>
      {' '}
      <button
        type="button"
        className="view-more-btn"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
        title={expanded ? 'Show less' : 'Show full text'}
      >
        {expanded ? 'View less' : 'View more'}
      </button>
    </span>
  );
}

export default TruncatedText;
