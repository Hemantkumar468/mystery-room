/**
 * Dependency-free CSV export for the Site Evaluation dashboard — there's no
 * spreadsheet/PDF library in this project's package.json, and a single
 * "Export Report" action only needs one, universally-openable format, so
 * this is a plain Blob download rather than a new dependency.
 */
const escapeCsv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function exportCsv(rows, columns, filename = 'export.csv') {
  const header = columns.map((c) => escapeCsv(c.label)).join(',');
  const lines = rows.map((row) => columns
    .map((c) => {
      const raw = typeof c.get === 'function' ? c.get(row) : row[c.key];
      return escapeCsv(raw == null ? '' : String(raw));
    })
    .join(','));
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const rowsToHtmlTable = (rows, columns) => `
  <table border="1">
    <thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>${columns.map((c) => {
        const raw = typeof c.get === 'function' ? c.get(row) : row[c.key];
        return `<td>${raw == null ? '' : escapeHtml(raw)}</td>`;
      }).join('')}</tr>`).join('')}
    </tbody>
  </table>
`;

/**
 * Dependency-free "Excel" export — an HTML table served with a .xls
 * filename, which Excel opens natively (it detects the HTML content and
 * renders it as a worksheet). Not a real binary .xlsx, but requires no new
 * library and every column/formatting choice stays identical to exportCsv.
 */
export function exportXls(rows, columns, filename = 'export.xls') {
  const html = `<html><head><meta charset="utf-8"></head><body>${rowsToHtmlTable(rows, columns)}</body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Dependency-free "PDF" export — opens the browser's native print dialog on
 * a print-formatted version of the table in a hidden iframe; the user picks
 * "Save as PDF" as the destination. No PDF library, no popup-blocker issues
 * (same-window iframe, not window.open).
 */
export function exportPdf(title, rows, columns) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 16px; }
          h1 { font-size: 16px; margin-bottom: 12px; }
          table { border-collapse: collapse; width: 100%; font-size: 11px; }
          th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
          th { background: #f3f3f3; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${rowsToHtmlTable(rows, columns)}
      </body>
    </html>
  `);
  doc.close();

  iframe.onload = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1000);
  };
}
