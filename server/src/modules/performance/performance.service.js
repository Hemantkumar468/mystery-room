import mongoose from 'mongoose';
import { User } from '../auth/auth.model.js';
import { Team } from '../org/teams/team.model.js';
import { Branch } from '../org/branches/branch.model.js';
import { scopeService } from '../org/scope.service.js';
import { tz, dateKey, startOfDay, endOfDay } from '../../core/utils/opsTime.js';
import { DELEGATION_STATUS as S } from '../../core/constants/ops.js';

/**
 * Performance — computed on read from delegation and checklist data.
 *
 * KRA report (per person, 0–100 each, averaged):
 *   Delegation
 *     timeliness     = on-time % − overdue-pending % × 0.3
 *     quality        = 100 − rework % × 0.6 − send-back % × 0.4
 *     responsiveness = 100 − % of tasks that needed a management follow-up
 *     ownership      = completion % − shifted % × 0.3
 *     priority       = completion % of high/critical tasks
 *   Checklist
 *     timeliness     = on-time % − overdue-pending % × 0.3
 *     responsiveness = 100 − follow-up %
 *     ownership      = completion %
 *   A KRA with no input (nothing completed yet) is left out rather than scored 0.
 *
 * Scoreboard (XP):
 *   each completed & approved delegation +10, on time +5, high/critical +5,
 *   reworked/sent back −5 (never below 0 per task);
 *   each completed checklist occurrence +10, on time +5.
 *
 * Reads models through mongoose's registry so this module never imports the
 * delegation/checklist internals.
 */
const M = (name) => mongoose.model(name);
const REJECTION_RE = /sent back by|disapproved by/i;
const DAY = 86_400_000;

// Aggregation-safe open/closed tests (a missing actualDate is not `null` to $eq).
const ACTUAL = { $ifNull: ['$actualDate', null] };
const IS_OPEN = { $eq: [ACTUAL, null] };
const IS_CLOSED = { $ne: [ACTUAL, null] };

const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
const floor0 = (n) => Math.max(0, Math.round(n));
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const avg1 = (sum, d) => (d ? Math.round((sum / d) * 10) / 10 : 0);

const POINTS = { base: 10, onTime: 5, priority: 5, rework: 5 };
const LEVELS = [
  { name: 'Rookie', min: 0 },
  { name: 'Puzzle Solver', min: 250 },
  { name: 'Code Breaker', min: 750 },
  { name: 'Mastermind', min: 1500 },
];

export const levelFor = (xp) => {
  let i = 0;
  LEVELS.forEach((l, idx) => { if (xp >= l.min) i = idx; });
  const next = LEVELS[i + 1];
  return {
    name: LEVELS[i].name,
    next: next
      ? { name: next.name, xpNeeded: next.min - xp, progressPct: Math.min(100, Math.round(((xp - LEVELS[i].min) / (next.min - LEVELS[i].min)) * 100)) }
      : null,
  };
};

/** Resolve branch + team/group + visibility into a doer-id restriction. */
async function resolveScope(query, user, { restrictToVisible }) {
  const branch = await scopeService.resolveBranch(query.branch, user);
  let ids = restrictToVisible ? await scopeService.visibleUserIds(user) : null;
  const intersect = (list) => {
    ids = ids ? ids.filter((x) => list.includes(x)) : list;
  };
  if (query.team) intersect(await scopeService.teamMemberIds(query.team));
  if (query.group) intersect(await scopeService.groupMemberIds(query.group));
  if (query.department) {
    const people = await User.find({ department: query.department }).select('_id').lean();
    intersect(people.map((p) => String(p._id)));
  }
  return { branch, doerIds: ids };
}

const periodStart = (period) => {
  const now = tz();
  if (period === 'all') return new Date(0);
  if (period === 'week') return startOfDay(now.subtract((now.day() + 6) % 7, 'day').format('YYYY-MM-DD'));
  if (period === 'quarter') return startOfDay(now.month(Math.floor(now.month() / 3) * 3).date(1).format('YYYY-MM-DD'));
  return startOfDay(now.date(1).format('YYYY-MM-DD'));
};

async function people(ids) {
  const rows = await User.find({ _id: { $in: ids } }).select('name title department avatarColor branch').lean();
  return new Map(rows.map((p) => [String(p._id), p]));
}

async function teamIndex() {
  const teams = await Team.find().select('name color members.user').lean();
  const byUser = new Map();
  for (const t of teams) for (const m of t.members) {
    const k = String(m.user);
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push({ _id: String(t._id), name: t.name, color: t.color });
  }
  return { teams, byUser };
}

export const performanceService = {
  /* ---------------------------------------------------------------- */
  /* KRA / KPI report                                                  */
  /* ---------------------------------------------------------------- */

  async kraReport(query, user) {
    const { branch, doerIds } = await resolveScope(query, user, { restrictToVisible: true });
    const now = new Date();
    const from = query.from ? startOfDay(query.from) : null;
    const to = query.to ? endOfDay(query.to) : null;

    const dFilter = { deletedAt: null };
    if (branch) dFilter.branch = branch;
    if (doerIds) dFilter.doer = { $in: doerIds };
    if (from || to) dFilter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };

    const cMatch = { isNonFunctional: false, plannedDate: { $lte: to || now } };
    if (from) cMatch.plannedDate.$gte = from;
    if (branch) cMatch.branch = new mongoose.Types.ObjectId(branch);
    if (doerIds) cMatch.doer = { $in: doerIds.map((id) => new mongoose.Types.ObjectId(id)) };
    const todayStart = startOfDay(dateKey(now));

    const wantDel = query.source !== 'checklist';
    const wantChk = query.source !== 'delegation';

    const [delRows, chkRows] = await Promise.all([
      wantDel
        ? M('Delegation').find(dFilter).select('doer status dueDate completedAt revisionCount followUpCount priority managementRemark').lean()
        : [],
      wantChk
        ? M('ChecklistTask').aggregate([
          { $match: cMatch },
          {
            $group: {
              _id: '$doer',
              total: { $sum: 1 },
              completed: { $sum: { $cond: [IS_CLOSED, 1, 0] } },
              pending: { $sum: { $cond: [IS_OPEN, 1, 0] } },
              onTime: { $sum: { $cond: [{ $and: [IS_CLOSED, { $lte: ['$actualDate', { $add: ['$plannedDate', DAY - 1] }] }] }, 1, 0] } },
              delaySum: {
                $sum: {
                  $cond: [
                    { $and: [IS_CLOSED, { $gt: ['$actualDate', { $add: ['$plannedDate', DAY - 1] }] }] },
                    { $ceil: { $divide: [{ $subtract: ['$actualDate', { $add: ['$plannedDate', DAY - 1] }] }, DAY] } },
                    0,
                  ],
                },
              },
              overduePending: { $sum: { $cond: [{ $and: [IS_OPEN, { $lt: ['$plannedDate', todayStart] }] }, 1, 0] } },
              followUpSum: { $sum: '$followUpCount' },
              followUpNeeded: { $sum: { $cond: [{ $gt: ['$followUpCount', 0] }, 1, 0] } },
            },
          },
        ])
        : [],
    ]);

    // Delegation buckets per doer.
    const del = new Map();
    for (const t of delRows) {
      const k = String(t.doer);
      if (!del.has(k)) {
        del.set(k, { total: 0, completed: 0, shifted: 0, pending: 0, overduePending: 0, withDates: 0, onTime: 0, delaySum: 0, revisionSum: 0, rework: 0, sentBack: 0, submitted: 0, followUpSum: 0, followUpNeeded: 0, hiTotal: 0, hiDone: 0 });
      }
      const d = del.get(k);
      d.total += 1;
      if (t.status === S.COMPLETED) d.completed += 1;
      else if (t.status === S.SHIFTED) d.shifted += 1;
      else if (t.status !== S.AWAITING_VERIFICATION) {
        d.pending += 1;
        if (t.dueDate && t.dueDate < now) d.overduePending += 1;
      }
      if (t.completedAt) {
        d.submitted += 1;
        if (t.dueDate) {
          d.withDates += 1;
          if (t.completedAt <= t.dueDate) d.onTime += 1;
          else d.delaySum += Math.ceil((t.completedAt - t.dueDate) / DAY);
        }
      }
      d.revisionSum += t.revisionCount || 0;
      if ((t.revisionCount || 0) > 0) d.rework += 1;
      if (t.managementRemark && REJECTION_RE.test(t.managementRemark)) d.sentBack += 1;
      d.followUpSum += t.followUpCount || 0;
      if ((t.followUpCount || 0) > 0) d.followUpNeeded += 1;
      if (['high', 'critical'].includes(t.priority)) {
        d.hiTotal += 1;
        if (t.status === S.COMPLETED) d.hiDone += 1;
      }
    }

    const scoreDelegation = (d) => {
      const onTimePct = pct(d.onTime, d.withDates);
      const overduePendingPct = pct(d.overduePending, d.pending) ?? 0;
      const reworkPct = pct(d.rework, d.total) ?? 0;
      const sentBackPct = pct(d.sentBack, d.submitted) ?? 0;
      const followUpPct = pct(d.followUpNeeded, d.total) ?? 0;
      const completionPct = pct(d.completed, d.total) ?? 0;
      const shiftedPct = pct(d.shifted, d.total) ?? 0;
      const priorityPct = pct(d.hiDone, d.hiTotal);
      const k = {
        timeliness: { onTimePct, avgDelayDays: avg1(d.delaySum, d.withDates), overduePendingPct, score: onTimePct === null ? null : floor0(onTimePct - overduePendingPct * 0.3) },
        quality: { avgRevisions: avg1(d.revisionSum, d.total), reworkPct, sentBackPct, score: floor0(100 - reworkPct * 0.6 - sentBackPct * 0.4) },
        responsiveness: { avgFollowUp: avg1(d.followUpSum, d.total), followUpPct, score: floor0(100 - followUpPct) },
        ownership: { totalTasks: d.total, completionPct, shiftedPct, score: floor0(completionPct - shiftedPct * 0.3) },
        priority: { priorityCompletionPct: priorityPct, totalCriticalHigh: d.hiTotal, score: priorityPct },
      };
      return { totalTasks: d.total, kra: k, score: mean(Object.values(k).map((x) => x.score).filter((s) => s !== null)) };
    };

    const scoreChecklist = (c) => {
      const onTimePct = pct(c.onTime, c.completed);
      const overduePendingPct = pct(c.overduePending, c.pending) ?? 0;
      const completionPct = pct(c.completed, c.total) ?? 0;
      const followUpPct = pct(c.followUpNeeded, c.total) ?? 0;
      const k = {
        timeliness: { onTimePct, avgDelayDays: avg1(c.delaySum, c.completed - c.onTime), overduePendingPct, score: onTimePct === null ? null : floor0(onTimePct - overduePendingPct * 0.3) },
        responsiveness: { avgFollowUp: avg1(c.followUpSum, c.total), followUpPct, score: floor0(100 - followUpPct) },
        ownership: { totalTasks: c.total, completionPct, score: completionPct },
      };
      return { totalTasks: c.total, kra: k, score: mean(Object.values(k).map((x) => x.score).filter((s) => s !== null)) };
    };

    const chk = new Map(chkRows.map((r) => [String(r._id), r]));
    const ids = [...new Set([...del.keys(), ...chk.keys()])];
    const info = await people(ids);
    const { byUser } = await teamIndex();

    const rows = ids.map((id) => {
      const delegation = del.has(id) ? scoreDelegation(del.get(id)) : null;
      const checklist = chk.has(id) ? scoreChecklist(chk.get(id)) : null;
      const overallScore = delegation && checklist ? Math.round((delegation.score + checklist.score) / 2) : (delegation || checklist)?.score ?? 0;
      const p = info.get(id);
      return {
        doerId: id,
        doer: p?.name || 'Unknown',
        avatarColor: p?.avatarColor,
        title: p?.title,
        department: p?.department,
        teams: byUser.get(id) || [],
        totalTasks: (delegation?.totalTasks || 0) + (checklist?.totalTasks || 0),
        delegation,
        checklist,
        overallScore,
      };
    });
    rows.sort((a, b) => b.overallScore - a.overallScore || b.totalTasks - a.totalTasks);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { branch, rows };
  },

  /* ---------------------------------------------------------------- */
  /* Scoreboard                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Gamified leaderboard. Everyone may see it (names and points only — never
   * task detail), filtered by branch / team / group. Also rolls points up by
   * team and by branch for the team-wise and branch-wise boards.
   */
  async scoreboard(query, user) {
    const period = query.period || 'month';
    const { branch, doerIds } = await resolveScope(query, user, { restrictToVisible: false });
    const since = periodStart(period);
    const now = new Date();
    const wantDel = query.source !== 'checklist';
    const wantChk = query.source !== 'delegation';

    const dFilter = { deletedAt: null, status: S.COMPLETED, completedAt: { $gte: since } };
    const cFilter = { actualDate: { $gte: since }, isNonFunctional: false };
    if (branch) {
      dFilter.branch = branch;
      cFilter.branch = branch;
    }
    if (doerIds) {
      dFilter.doer = { $in: doerIds };
      cFilter.doer = { $in: doerIds };
    }

    // Streak/badge window: the last 60 days regardless of period.
    const sixty = new Date(now.getTime() - 60 * DAY);
    const [dels, chks, recentDels, recentChks] = await Promise.all([
      wantDel ? M('Delegation').find(dFilter).select('doer branch dueDate completedAt priority revisionCount managementRemark').lean() : [],
      wantChk ? M('ChecklistTask').find(cFilter).select('doer branch plannedDate actualDate').lean() : [],
      wantDel ? M('Delegation').find({ ...dFilter, completedAt: { $gte: sixty } }).select('doer dueDate completedAt').lean() : [],
      wantChk ? M('ChecklistTask').find({ ...cFilter, actualDate: { $gte: sixty } }).select('doer plannedDate actualDate').lean() : [],
    ]);

    const stats = new Map();
    const bump = (id, branchId) => {
      const k = String(id);
      if (!stats.has(k)) stats.set(k, { points: 0, completed: 0, onTime: 0, branches: new Map() });
      const s = stats.get(k);
      if (branchId) s.branches.set(String(branchId), (s.branches.get(String(branchId)) || 0) + 1);
      return s;
    };

    for (const t of dels) {
      const s = bump(t.doer, t.branch);
      let pts = POINTS.base;
      const onTime = t.dueDate && t.completedAt <= t.dueDate;
      if (onTime) pts += POINTS.onTime;
      if (['high', 'critical'].includes(t.priority)) pts += POINTS.priority;
      if ((t.revisionCount || 0) > 0 || REJECTION_RE.test(t.managementRemark || '')) pts -= POINTS.rework;
      s.points += Math.max(0, pts);
      s.completed += 1;
      if (onTime) s.onTime += 1;
    }
    for (const t of chks) {
      const s = bump(t.doer, t.branch);
      const onTime = t.actualDate.getTime() <= t.plannedDate.getTime() + DAY - 1;
      s.points += POINTS.base + (onTime ? POINTS.onTime : 0);
      s.completed += 1;
      if (onTime) s.onTime += 1;
    }

    // Daily activity for streaks and badges.
    const days = new Map(); // doer -> Map(dayKey -> {done, late, early})
    const mark = (doer, at, late, early) => {
      const k = String(doer);
      if (!days.has(k)) days.set(k, new Map());
      const dk = dateKey(at);
      const m = days.get(k);
      const e = m.get(dk) || { done: 0, late: 0, early: 0 };
      e.done += 1;
      if (late) e.late += 1;
      if (early) e.early += 1;
      m.set(dk, e);
    };
    for (const t of recentDels) {
      const late = t.dueDate && t.completedAt > t.dueDate;
      const early = t.dueDate && t.dueDate.getTime() - t.completedAt.getTime() >= 2 * DAY;
      mark(t.doer, t.completedAt, late, early);
    }
    for (const t of recentChks) mark(t.doer, t.actualDate, t.actualDate.getTime() > t.plannedDate.getTime() + DAY - 1, false);

    const weekAgoKey = tz().subtract(7, 'day').format('YYYY-MM-DD');
    const streakOf = (m) => {
      // Consecutive active days without a late completion, walking back from the
      // most recent active day. Quiet days don't break it; a late one does; no
      // activity for a week lapses it.
      const keys = [...m.keys()].sort().reverse();
      if (!keys.length || keys[0] < weekAgoKey) return 0;
      let streak = 0;
      for (const k of keys) {
        if (m.get(k).late) break;
        streak += 1;
      }
      return streak;
    };

    // Roster: everyone with points, plus the caller so they always have a rank.
    const roster = new Set(stats.keys());
    if (!doerIds || doerIds.includes(String(user.id))) roster.add(String(user.id));
    const ids = [...roster];
    const info = await people(ids);
    const { teams, byUser } = await teamIndex();

    const standings = ids
      .map((id) => {
        const s = stats.get(id) || { points: 0, completed: 0, onTime: 0 };
        const p = info.get(id);
        return {
          doerId: id,
          doer: p?.name || 'Unknown',
          avatarColor: p?.avatarColor,
          title: p?.title,
          department: p?.department,
          teams: byUser.get(id) || [],
          points: s.points,
          completed: s.completed,
          onTimePct: s.completed ? Math.round((s.onTime / s.completed) * 100) : 0,
        };
      })
      .sort((a, b) => b.points - a.points || b.onTimePct - a.onTimePct || b.completed - a.completed || a.doer.localeCompare(b.doer));

    standings.forEach((r, i) => {
      r.rank = i + 1;
      r.xp = r.points;
      const lv = levelFor(r.xp);
      r.level = lv.name;
      r.nextLevel = lv.next;
      const m = days.get(r.doerId) || new Map();
      r.streak = streakOf(m);
      let wkDone = 0;
      let wkLate = 0;
      let early = 0;
      for (const [k, e] of m) {
        if (k >= weekAgoKey) {
          wkDone += e.done;
          wkLate += e.late;
          early += e.early;
        }
      }
      const badges = [];
      if (r.rank === 1 && r.xp > 0) badges.push({ id: 'top', label: 'Top Performer', icon: '🏆' });
      if (wkDone >= 5 && wkLate === 0) badges.push({ id: 'perfect_week', label: 'Perfect Week', icon: '🏅' });
      if (early >= 3) badges.push({ id: 'speed', label: 'Speed Runner', icon: '⚡' });
      if (r.onTimePct >= 95 && r.completed >= 20) badges.push({ id: 'reliable', label: 'Reliability Champion', icon: '🛡️' });
      if (r.streak >= 30) badges.push({ id: 'streak30', label: '30-Day Streak', icon: '🔥' });
      else if (r.streak >= 14) badges.push({ id: 'streak14', label: '14-Day Streak', icon: '🔥' });
      else if (r.streak >= 7) badges.push({ id: 'streak7', label: '7-Day Streak', icon: '🔥' });
      r.badges = badges;
    });

    // Team-wise board: total and per-member average.
    const pointsOf = new Map(standings.map((s) => [s.doerId, s]));
    const teamBoard = teams
      .map((t) => {
        const members = t.members.map((m) => pointsOf.get(String(m.user))).filter(Boolean);
        const points = members.reduce((a, m) => a + m.points, 0);
        const completed = members.reduce((a, m) => a + m.completed, 0);
        return {
          teamId: String(t._id),
          name: t.name,
          color: t.color,
          members: t.members.length,
          active: members.filter((m) => m.completed > 0).length,
          points,
          completed,
          avgPoints: t.members.length ? Math.round(points / t.members.length) : 0,
        };
      })
      .filter((t) => t.points > 0 || t.completed > 0)
      .sort((a, b) => b.avgPoints - a.avgPoints || b.points - a.points);

    // Branch-wise board: where the points were earned.
    const branchPts = new Map();
    for (const t of dels) {
      const k = String(t.branch);
      const e = branchPts.get(k) || { points: 0, completed: 0 };
      e.completed += 1;
      branchPts.set(k, e);
    }
    for (const t of chks) {
      const k = String(t.branch);
      const e = branchPts.get(k) || { points: 0, completed: 0 };
      e.completed += 1;
      branchPts.set(k, e);
    }
    // Distribute each person's points across branches in proportion to where they completed work.
    for (const s of stats.values()) {
      const total = [...s.branches.values()].reduce((a, b) => a + b, 0);
      for (const [b, n] of s.branches) {
        const e = branchPts.get(b);
        if (e && total) e.points += Math.round((s.points * n) / total);
      }
    }
    const branchDocs = await Branch.find({ _id: { $in: [...branchPts.keys()] } }).select('name code type').lean();
    const branchBoard = branchDocs
      .map((b) => ({ branchId: String(b._id), name: b.name, code: b.code, type: b.type, ...branchPts.get(String(b._id)) }))
      .sort((a, b) => b.points - a.points);

    return {
      period,
      since,
      branch,
      updatedAt: now,
      totalPlayers: standings.length,
      top: standings.slice(0, 3),
      standings,
      me: standings.find((s) => s.doerId === String(user.id)) || null,
      teams: teamBoard,
      branches: branchBoard,
      levels: LEVELS,
    };
  },
};

export default performanceService;
