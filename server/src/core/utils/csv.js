/**
 * CSV that cannot break the row, or the spreadsheet that opens it.
 *
 * Extracted from crm/exports/export.service.js so HRMS candidate exports get
 * the same protection instead of a second, subtly weaker copy. The formula
 * guard in particular is the kind of rule that gets re-implemented from
 * memory and re-implemented wrong.
 */

/** One cell, quoted and made safe for Excel. */
export function csvCell(value) {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  /* A leading =, +, - or @ makes Excel treat the cell as a FORMULA. An exported
     customer name of `=cmd|...` is a live attack on whoever opens the file, and
     it arrives looking like our own export. Prefixed with a quote, which Excel
     shows as text and every other reader ignores. */
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Rows to a CSV document.
 *
 * @param {string[]} headers   the header row, written as-is
 * @param {Array<Array<*>>} rows
 * @returns {string} CRLF-separated, with a UTF-8 BOM.
 */
export function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  /* BOM first: without it Excel on Windows opens UTF-8 as the local codepage
     and every non-ASCII name in the file arrives mangled. CRLF for the same
     audience. */
  return `﻿${lines.join('\r\n')}\r\n`;
}

export default { csvCell, toCsv };
