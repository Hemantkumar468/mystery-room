import { ersGet, ersHasKey } from './ers.client.js';

/**
 * The Employee Performance read model.
 *
 * ONE UPSTREAM CALL FEEDS BOTH SCREENS. `/api/leaderboard/v2` returns the whole
 * ranked set in a single response — every employee with their metrics and
 * ranks, the summary counts, and the filter options — so the overview and the
 * full leaderboard are two views of the same fetch rather than two round trips.
 *
 * SEARCH, SORT AND PAGING HAPPEN HERE, not upstream, because upstream offers
 * none of them: it takes location filters and a limit and nothing else. With
 * 148 employees that is the right trade — the whole set is a few hundred
 * kilobytes, it is cached for a minute (see ers.client.js), and doing it here
 * means the page gets the same server-paged contract every other table in this
 * app uses instead of a special case.
 *
 * If this ever grows to thousands of employees, the fix is to ask the client
 * for `page`/`search` upstream — not to move this into the browser.
 */

export const SORT_KEYS = ['rank', 'name', 'avg_rating', 'total_reviews', 'cps', 'positive_pct', 'outlet'];
export const PERIODS = ['week', 'month', 'quarter', 'year', 'all'];

/** Sort key → the field it reads. One table, so the column headings, the
    allowed-keys list and the comparator can never drift apart. */
const SORT_FIELD = {
  rank: (r) => r.rank,
  name: (r) => r.name,
  outlet: (r) => r.outlet,
  avg_rating: (r) => r.avgRating,
  total_reviews: (r) => r.totalReviews,
  positive_pct: (r) => r.positivePct,
  cps: (r) => r.cps,
};

/**
 * The three bands the client talks about, derived from the rating.
 *
 * Upstream sends a `status` string per employee, and it is used as-is when
 * present — deriving our own would risk this dashboard and their own screens
 * disagreeing about who is "Perfect". The thresholds below are only a fallback
 * for a row that arrives without one.
 */
const bandFor = (rating, reviews) => {
  if (!reviews) return 'No reviews';
  if (rating >= 4.8) return 'Perfect';
  if (rating >= 4.0) return 'Good';
  return 'Needs Improvement';
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clean = (v) => (v == null ? '' : String(v).trim());

/** Flatten one upstream employee into the shape the table actually renders. */
function toRow(e) {
  const m = e.metrics || {};
  const r = e.ranks || {};
  return {
    id: e.id,
    name: clean(e.name),
    photo: clean(e.photo),
    position: clean(e.position),
    code: clean(e.zimyo_id),
    joinDate: e.join_date || null,

    outlet: e.outlet?.name || '',
    outletId: e.outlet?.id ?? null,
    brand: e.brand?.name || '',
    brandId: e.brand?.id ?? null,
    city: e.city?.name || '',
    state: e.state?.name || '',
    country: e.country?.name || '',

    /* The eight metrics the detail drawer shows, named as upstream names them
       so a reader can match this against their API reference. */
    avgRating: num(m.avg_rating),
    totalReviews: num(m.total_reviews),
    positivePct: num(m.positive_pct),
    cps: num(m.cps),
    bayesian: num(m.bayesian_score),
    stddev: num(m.stddev),
    volumeBonus: num(m.volume_bonus),
    consistencyBonus: num(m.consistency_bonus),

    rank: r.global?.rank ?? null,
    ranks: {
      global: r.global || null,
      country: r.country || null,
      state: r.state || null,
      city: r.city || null,
      outlet: r.outlet || null,
    },

    status: clean(e.status) || bandFor(num(m.avg_rating), num(m.total_reviews)),
  };
}

/** Upstream's photo paths are relative to their host; make them absolute once. */
const absolutePhoto = (photo, base) => (photo && photo.startsWith('/') ? `${base}${photo}` : photo);

export const ersService = {
  /**
   * The whole ranked set for a given scope, normalised. Everything else in this
   * service is a view over this.
   */
  async board({ period, brandId, outletId, cityId, stateId } = {}) {
    const body = await ersGet('/api/leaderboard/v2', {
      period, brandId, outletId, cityId, stateId, limit: 500,
    });
    const d = body?.data || {};
    const base = 'https://feedback.mysteryrooms.co.in';

    const rows = (d.employees || []).map(toRow).map((r) => ({
      ...r,
      photo: absolutePhoto(r.photo, base),
    }));

    return {
      rows,
      summary: d.summary || {},
      formula: d.formula || null,
      filterOptions: d.filterOptions || {},
      period: d.period || period || 'month',
      lastUpdated: d.lastUpdated || null,
    };
  },

  /**
   * The dashboard: the counts, the top three, and the head of the table.
   *
   * `hasKey` rides along so the page can tell an honest story about the parts
   * that are not available yet rather than showing an empty panel.
   */
  async overview(params = {}) {
    const b = await this.board(params);
    const s = b.summary;

    return {
      counts: {
        employees: num(s.total_employees),
        reviews: num(s.total_reviews),
        avgRating: num(s.overall_avg),
        globalAvg: num(s.global_avg),
        perfect: num(s.perfect_count),
        good: num(s.good_count),
        needsImprovement: num(s.needs_improvement_count),
        noReviews: num(s.no_reviews_count),
        outlets: (b.filterOptions?.outlets || []).length,
      },
      podium: b.rows.slice(0, 3),
      top: b.rows.slice(0, 10),
      /* The outlet roll-up is computed here rather than fetched: upstream has no
         per-outlet aggregate, but every employee carries their outlet, so the
         same response answers it. */
      outlets: this.byOutlet(b.rows),
      formula: b.formula,
      filterOptions: b.filterOptions,
      period: b.period,
      lastUpdated: b.lastUpdated,
      hasKey: ersHasKey(),
    };
  },

  /** One page of the full leaderboard, searched, filtered, sorted and paged. */
  async leaderboard(params = {}) {
    const {
      search, status, sort = 'rank', dir = 'asc', page = 1, limit = 25, ...scope
    } = params;

    const b = await this.board(scope);
    let rows = b.rows;

    const q = clean(search).toLowerCase();
    if (q) {
      rows = rows.filter((r) => [r.name, r.code, r.position, r.outlet, r.city, r.brand]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    if (clean(status)) rows = rows.filter((r) => r.status === clean(status));

    const key = SORT_KEYS.includes(sort) ? sort : 'rank';
    const mul = dir === 'desc' ? -1 : 1;
    const value = SORT_FIELD[key];
    rows = [...rows].sort((a, x) => {
      const av = value(a);
      const xv = value(x);
      if (typeof av === 'string') return mul * av.localeCompare(xv);
      /* An unranked employee (no reviews) sorts last whichever way the column
         is pointed — they are not "the best" simply because rank is null. */
      if (!av && !xv) return 0;
      if (!av) return 1;
      if (!xv) return -1;
      return mul * (av - xv);
    });

    const safeLimit = Math.min(Math.max(num(limit) || 25, 1), 200);
    const total = rows.length;
    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    const safePage = Math.min(Math.max(num(page) || 1, 1), totalPages);

    /* Counts over the FILTERED set, so the strip above the table describes
       what is being looked at rather than the whole company. */
    const counts = {
      shown: total,
      perfect: rows.filter((r) => r.status === 'Perfect').length,
      good: rows.filter((r) => r.status === 'Good').length,
      needsImprovement: rows.filter((r) => r.status === 'Needs Improvement').length,
      noReviews: rows.filter((r) => !r.totalReviews).length,
      reviews: rows.reduce((t, r) => t + r.totalReviews, 0),
      avgRating: total ? Number((rows.reduce((t, r) => t + r.avgRating, 0) / total).toFixed(2)) : 0,
    };

    return {
      rows: rows.slice((safePage - 1) * safeLimit, safePage * safeLimit),
      /* The highest CPS on the WHOLE board, not on this page. The table shades
         each score against the leader, and taking the maximum from the rows on
         screen would repaint page three entirely green — everyone there would
         be measured against the best of page three. */
      topCps: b.rows.reduce((m, r) => Math.max(m, r.cps || 0), 0),
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      counts,
      summary: b.summary,
      filterOptions: b.filterOptions,
      formula: b.formula,
      period: b.period,
      lastUpdated: b.lastUpdated,
    };
  },

  /** One employee, with their ranks and the formula that produced their score. */
  async employee(id, params = {}) {
    const b = await this.board(params);
    const row = b.rows.find((r) => String(r.id) === String(id));
    if (!row) return null;
    /* Their outlet-mates, so the drawer can say "1st of 6 here" and show who
       the other five are without a second call. */
    const peers = b.rows
      .filter((r) => r.outletId && r.outletId === row.outletId && r.id !== row.id)
      .slice(0, 8);
    return { employee: row, peers, formula: b.formula, period: b.period };
  },

  /** Employees grouped by outlet — the Outlet comparison view. */
  byOutlet(rows) {
    const by = new Map();
    for (const r of rows) {
      const k = r.outlet || '—';
      if (!by.has(k)) {
        by.set(k, {
          outlet: k, outletId: r.outletId, city: r.city, state: r.state, brand: r.brand,
          employees: 0, reviews: 0, ratingSum: 0, best: null,
        });
      }
      const o = by.get(k);
      o.employees += 1;
      o.reviews += r.totalReviews;
      o.ratingSum += r.avgRating;
      if (!o.best || r.cps > o.best.cps) o.best = r;
    }
    return [...by.values()]
      .map((o) => ({
        ...o,
        avgRating: o.employees ? Number((o.ratingSum / o.employees).toFixed(2)) : 0,
        ratingSum: undefined,
      }))
      .sort((a, b2) => b2.avgRating - a.avgRating || b2.reviews - a.reviews);
  },
};

export default ersService;
