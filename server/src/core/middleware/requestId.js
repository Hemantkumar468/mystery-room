import { randomUUID } from 'node:crypto';

/**
 * Give every request an id, and put it on the response.
 *
 * The point is being able to follow ONE request through the logs. Without it,
 * a 500 at 11:04 and the three lines that explain it are only related by
 * timestamp — and under any real load timestamps interleave. With it, the user
 * reads the id off the error, and `grep <id> logs/app-*.log` returns that
 * request's whole story: the access line, the warning, the stack.
 *
 * An inbound `X-Request-Id` is honoured rather than replaced, so a proxy, a
 * load balancer or the frontend can set one and have it survive end to end.
 * Untrusted input, so it is length-capped and stripped of anything that would
 * make a log line lie (newlines, control characters).
 */
const clean = (v) => String(v).replace(/[^\w.:-]/g, '').slice(0, 64);

export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming ? clean(incoming) || randomUUID() : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export default requestId;
