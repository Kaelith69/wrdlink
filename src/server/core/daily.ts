export type DailyProfile = {
  totalCompleted: number;
  totalScore: number;
  totalMoves: number;
  currentStreak: number;
  bestStreak: number;
  lastDailyDate: string | null;
  graceTokens: number;
  badges: string[];
};


export function formatDailyShareText(
  result: { date: string; start: string; target: string; moves: number; score: number },
  currentStreak: number
): string {
  const streakLabel = currentStreak === 1 ? '1 day' : `${currentStreak} days`;
  return [
    'WRDLINK Daily Challenge',
    `Puzzle: ${result.start} → ${result.target}`,
    `Date: ${result.date}`,
    `Finished in ${result.moves} moves`,
    `Streak: ${streakLabel}`,
    `Points: ${result.score}`,
    'Think you can beat it? Give today’s puzzle a try!',
  ].join('\n\n');
}

export function formatDailyPostContent(
  dateKey: string,
  puzzle: { start: string; target: string; optimalMoves: number }
): { title: string; body: string } {
  const timestamp = parseDateKey(dateKey);
  if (timestamp === null) throw new Error('Invalid daily post date.');
  if (!/^[A-Z]{4}$/.test(puzzle.start) || !/^[A-Z]{4}$/.test(puzzle.target) ||
      !Number.isSafeInteger(puzzle.optimalMoves) || puzzle.optimalMoves < 1) {
    throw new Error('Invalid daily post puzzle.');
  }
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(timestamp));
  return {
    title: `Can you get from ${puzzle.start} to ${puzzle.target}? | WRDLINK Daily`,
    body: [
      `**${dateLabel}**`,
      `**Start:** ${puzzle.start}`,
      `**Target:** ${puzzle.target}`,
      `**Optimal:** ${puzzle.optimalMoves} moves`,
      'Change exactly one letter per move. Every intermediate word must be valid. Do not reuse words.',
      "Open the post to play today's challenge.",
    ].join('\n\n'),
  };
}

export type StreakUpdate = {
  currentStreak: number;
  bestStreak: number;
  graceTokens: number;
  lastDailyDate: string;
  graceUsed: boolean;
  graceEarned: boolean;
};

const DAY_MS = 86_400_000;

export function utcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateKey(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

export function isoWeekKey(dateKey: string): string {
  const timestamp = parseDateKey(dateKey);
  if (timestamp === null) throw new Error('Invalid daily date.');
  const date = new Date(timestamp);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

export function updateDailyStreak(
  profile: Pick<DailyProfile, 'currentStreak' | 'bestStreak' | 'lastDailyDate' | 'graceTokens'>,
  dateKey: string
): StreakUpdate {
  const currentTime = parseDateKey(dateKey);
  if (currentTime === null) throw new Error('Invalid daily date.');
  const previousTime = profile.lastDailyDate ? parseDateKey(profile.lastDailyDate) : null;
  if (previousTime !== null && currentTime <= previousTime) {
    return {
      currentStreak: profile.currentStreak,
      bestStreak: profile.bestStreak,
      graceTokens: profile.graceTokens,
      lastDailyDate: profile.lastDailyDate ?? dateKey,
      graceUsed: false,
      graceEarned: false,
    };
  }

  const gap = previousTime === null ? 0 : Math.round((currentTime - previousTime) / DAY_MS);
  let graceTokens = Math.max(0, Math.min(2, profile.graceTokens));
  let currentStreak = 1;
  let graceUsed = false;

  if (gap === 1) {
    currentStreak = profile.currentStreak + 1;
  } else if (gap === 2 && graceTokens > 0) {
    currentStreak = profile.currentStreak + 1;
    graceTokens -= 1;
    graceUsed = true;
  }

  const graceEarned = !graceUsed && currentStreak > 0 && currentStreak % 7 === 0 && graceTokens < 2;
  if (graceEarned) graceTokens += 1;
  return {
    currentStreak,
    bestStreak: Math.max(profile.bestStreak, currentStreak),
    graceTokens,
    lastDailyDate: dateKey,
    graceUsed,
    graceEarned,
  };
}

export function earnedBadges(profile: DailyProfile, moves: number, optimalMoves: number, hintsUsed: number, score: number): string[] {
  const earned = new Set(profile.badges);
  if (profile.totalCompleted >= 1) earned.add('FIRST_SOLVE');
  if (profile.totalCompleted >= 5) earned.add('FIVE_SOLVES');
  if (profile.totalCompleted >= 25) earned.add('TWENTY_FIVE_SOLVES');
  if (profile.totalCompleted >= 100) earned.add('HUNDRED_SOLVES');
  if (moves === optimalMoves) earned.add('OPTIMAL_PATH');
  const maximumDailyScore = Math.max(0, 25 - optimalMoves) + 25;
  if (moves === optimalMoves && hintsUsed === 0 && score === maximumDailyScore) earned.add('PERFECT_SOLVE');
  if (profile.currentStreak >= 3) earned.add('STREAK_3');
  if (profile.currentStreak >= 7) earned.add('STREAK_7');
  if (profile.currentStreak >= 30) earned.add('STREAK_30');
  return [...earned].sort();
}

export function dailyRankScore(
  score: number,
  moves: number,
  completedAt: number,
  metric: 'score' | 'moves'
): number {
  const dayMilliseconds = DAY_MS;
  const timeOfDay = Math.floor(completedAt) % dayMilliseconds;
  // A primary metric must always outrank every possible secondary metric,
  // and a secondary metric must always outrank the completion timestamp.
  // Daily chains are capped at 200 words by validateSequence().
  const primaryScale = 1_000_000_000_000;
  return metric === 'score'
    ? (1000 - score) * primaryScale + moves * dayMilliseconds + timeOfDay
    : moves * primaryScale + (1000 - score) * dayMilliseconds + timeOfDay;
}

export function aggregateRankScore(
  totalScore: number,
  totalMoves: number,
  completedCount: number,
  metric: 'score' | 'moves'
): number {
  const averageMoves = completedCount ? Math.round((totalMoves / completedCount) * 1000) : 0;
  return metric === 'score'
    ? (1_000_000 - Math.min(totalScore, 1_000_000)) * 1_000_000 + averageMoves
    : averageMoves * 2_000_000 + (1_000_000 - Math.min(totalScore, 1_000_000));
}
