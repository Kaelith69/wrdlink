export type AchievementStats = {
  dailySolves: number;
  totalPoints: number;
  optimalSolves: number;
  flawlessSolves: number;
  eliteScores: number;
  strongScores: number;
  efficientSolves: number;
  enduranceSolves: number;
  totalMoves: number;
  totalWords: number;
  fastSolves: number;
  patientSolves: number;
  weekendSolves: number;
  weekdaySolves: number;
  shortSolves: number;
  mediumSolves: number;
  longSolves: number;
  graceTokensEarned: number;
  currentStreak: number;
  bestStreak: number;
};

export const EMPTY_ACHIEVEMENT_STATS: AchievementStats = {
  dailySolves: 0, totalPoints: 0, optimalSolves: 0, flawlessSolves: 0,
  eliteScores: 0, strongScores: 0, efficientSolves: 0, enduranceSolves: 0,
  totalMoves: 0, totalWords: 0, fastSolves: 0, patientSolves: 0,
  weekendSolves: 0, weekdaySolves: 0, shortSolves: 0, mediumSolves: 0,
  longSolves: 0, graceTokensEarned: 0, currentStreak: 0, bestStreak: 0,
};

const THRESHOLDS = [1, 2, 3, 4, 5, 7, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000] as const;
const TIERS = ['Initiate', 'Apprentice', 'Regular', 'Adept', 'Skilled', 'Dedicated', 'Veteran', 'Expert', 'Specialist', 'Virtuoso', 'Master', 'Elite', 'Champion', 'Legend', 'Icon', 'Prodigy', 'Savant', 'Luminary', 'Paragon', 'Pioneer', 'Exemplar', 'Ascendant', 'Mythic', 'Transcendent', 'Eternal'] as const;

const TRACKS = [
  { key: 'dailySolves', title: 'Daily Pathfinder', category: 'Consistency', icon: '🧭', description: 'Complete daily puzzles.' },
  { key: 'currentStreak', title: 'Unbroken Chain', category: 'Consistency', icon: '🔥', description: 'Maintain your current daily streak.' },
  { key: 'bestStreak', title: 'Streak Keeper', category: 'Consistency', icon: '⏳', description: 'Set a personal best daily streak.' },
  { key: 'totalPoints', title: 'Point Collector', category: 'Scoring', icon: '✦', description: 'Accumulate points from verified daily solves.' },
  { key: 'optimalSolves', title: 'Shortest Bridge', category: 'Precision', icon: '🎯', description: 'Solve in the optimal number of moves.' },
  { key: 'flawlessSolves', title: 'Flawless Mind', category: 'Precision', icon: '💎', description: 'Solve optimally with the maximum score.' },
  { key: 'eliteScores', title: 'Perfect Ten', category: 'Scoring', icon: '🏅', description: 'Earn at least 45 points in a daily puzzle.' },
  { key: 'strongScores', title: 'High Scorer', category: 'Scoring', icon: '⭐', description: 'Earn at least 40 points in a daily puzzle.' },
  { key: 'efficientSolves', title: 'Efficient Route', category: 'Technique', icon: '⚡', description: 'Complete a puzzle in five moves or fewer.' },
  { key: 'enduranceSolves', title: 'Long Haul', category: 'Technique', icon: '🛤️', description: 'Complete a puzzle in ten moves or more.' },
  { key: 'totalMoves', title: 'Word Walker', category: 'Technique', icon: '👣', description: 'Make valid moves across completed daily puzzles.' },
  { key: 'totalWords', title: 'Vocabulary Builder', category: 'Vocabulary', icon: '📚', description: 'Play words in verified daily solutions.' },
  { key: 'fastSolves', title: 'Quick Thinker', category: 'Time', icon: '⏱️', description: 'Finish a daily puzzle within one minute.' },
  { key: 'patientSolves', title: 'Deliberate Solver', category: 'Time', icon: '🧠', description: 'Spend at least three minutes on a completed puzzle.' },
  { key: 'weekendSolves', title: 'Weekend Wordsmith', category: 'Consistency', icon: '🌤️', description: 'Complete daily puzzles on Saturdays or Sundays.' },
  { key: 'weekdaySolves', title: 'Weekday Regular', category: 'Consistency', icon: '📅', description: 'Complete daily puzzles Monday through Friday.' },
  { key: 'shortSolves', title: 'Swift Ladder', category: 'Technique', icon: '🪜', description: 'Finish in three moves or fewer.' },
  { key: 'mediumSolves', title: 'Steady Climber', category: 'Technique', icon: '🧗', description: 'Finish in four to six moves.' },
  { key: 'longSolves', title: 'Deep Explorer', category: 'Technique', icon: '🗺️', description: 'Finish in seven to nine moves.' },
  { key: 'graceTokensEarned', title: 'Grace Keeper', category: 'Consistency', icon: '🛡️', description: 'Earn streak protection tokens.' },
] as const;

export type Achievement = {
  id: string;
  name: string;
  description: string;
  category: string;
  target: number;
  icon: string;
  stat: keyof AchievementStats;
};

export const DAILY_ACHIEVEMENTS: Achievement[] = TRACKS.flatMap((track) =>
  THRESHOLDS.map((target, index) => ({
    id: track.key.toUpperCase() + '_' + String(target).padStart(4, '0'),
    name: track.title + ': ' + TIERS[index],
    description: track.description,
    category: track.category,
    target,
    icon: track.icon + ' ' + String(index + 1).padStart(2, '0'),
    stat: track.key,
  }))
);

export function normalizeAchievementStats(value: unknown): AchievementStats {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.keys(EMPTY_ACHIEVEMENT_STATS).map((key) => [
    key,
    Number.isSafeInteger(source[key]) && Number(source[key]) >= 0 ? Number(source[key]) : 0,
  ])) as unknown as AchievementStats;
}

export function earnedAchievementIds(stats: AchievementStats): string[] {
  return DAILY_ACHIEVEMENTS.filter((achievement) => stats[achievement.stat] >= achievement.target).map((achievement) => achievement.id);
}

export function recordAchievementStats(
  previous: AchievementStats,
  result: { score: number; moves: number; optimalMoves: number; words: string[]; completedAt: number; startedAt?: number; date: string },
  streak: { currentStreak: number; bestStreak: number; graceEarned: boolean },
): AchievementStats {
  const duration = Math.max(0, result.completedAt - (result.startedAt ?? result.completedAt));
  const day = new Date(result.date + 'T00:00:00.000Z').getUTCDay();
  const maximumScore = Math.max(0, 25 - result.optimalMoves) + 25;
  const next: AchievementStats = {
    ...previous,
    dailySolves: previous.dailySolves + 1,
    totalPoints: previous.totalPoints + result.score,
    optimalSolves: previous.optimalSolves + Number(result.moves === result.optimalMoves),
    flawlessSolves: previous.flawlessSolves + Number(result.moves === result.optimalMoves && result.score === maximumScore),
    eliteScores: previous.eliteScores + Number(result.score >= 45),
    strongScores: previous.strongScores + Number(result.score >= 40),
    efficientSolves: previous.efficientSolves + Number(result.moves <= 5),
    enduranceSolves: previous.enduranceSolves + Number(result.moves >= 10),
    totalMoves: previous.totalMoves + result.moves,
    totalWords: previous.totalWords + Math.max(0, result.words.length - 1),
    fastSolves: previous.fastSolves + Number(duration <= 60_000),
    patientSolves: previous.patientSolves + Number(duration >= 180_000),
    weekendSolves: previous.weekendSolves + Number(day === 0 || day === 6),
    weekdaySolves: previous.weekdaySolves + Number(day >= 1 && day <= 5),
    shortSolves: previous.shortSolves + Number(result.moves <= 3),
    mediumSolves: previous.mediumSolves + Number(result.moves >= 4 && result.moves <= 6),
    longSolves: previous.longSolves + Number(result.moves >= 7 && result.moves <= 9),
    graceTokensEarned: previous.graceTokensEarned + Number(streak.graceEarned),
    currentStreak: streak.currentStreak,
    bestStreak: streak.bestStreak,
  };
  return next;
}
