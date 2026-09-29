/**
 * Escape user input before it goes into a RegExp. Unescaped search text lets a
 * stray "(" crash the query and a crafted pattern pin the CPU.
 */
export const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive "contains" matcher for a search box. */
export const containsRegex = (s) => new RegExp(escapeRegex(String(s).trim()), 'i');

export default { escapeRegex, containsRegex };
