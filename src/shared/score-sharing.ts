export type CampaignScoreSummary = {
  level: number;
  start: string;
  target: string;
  moves: number;
  score: number;
  words: string[];
};

export type DailyScoreSummary = {
  date: string;
  start: string;
  target: string;
  moves: number;
  score: number;
  currentStreak: number;
};

export type CommentaryValidation =
  | { valid: true; value: string }
  | { valid: false; message: string };

export function formatCampaignScoreComment(result: CampaignScoreSummary): string {
  return [
    `WRDLINK Campaign · Level ${result.level}`,
    `${result.start} → ${result.target}`,
    `Moves: ${result.moves} · Score: ${result.score}`,
    'Status: Completed',
    `Solution: >!${result.words.join(' → ')}!<`,
    'Play WRDLINK: https://www.reddit.com/r/WRDLINK/',
  ].join('\n\n');
}

export function formatDailyScoreComment(result: DailyScoreSummary): string {
  const streakLabel = result.currentStreak === 1 ? '1 day' : `${result.currentStreak} days`;
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

export function validateMeaningfulCommentary(value: string): CommentaryValidation {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (normalized.length < 25) {
    return { valid: false, message: 'Add a little more detail. Use at least 25 characters.' };
  }
  if (normalized.length > 500) {
    return { valid: false, message: 'Keep your message to 500 characters or fewer.' };
  }

  const words = normalized.match(/[\p{L}\p{N}']+/gu) ?? [];
  const uniqueWords = new Set(words.map((word) => word.toLocaleLowerCase()));
  if (words.length < 5 || uniqueWords.size < 4) {
    return { valid: false, message: 'Add meaningful commentary using at least five words.' };
  }

  if (/^(?:wrdlink\s+(?:campaign|daily|score)\b|(?:puzzle|moves|score|points|streak|status)\s*:)/i.test(normalized)) {
    return { valid: false, message: 'Write a personal message, not a generated score template.' };
  }

  return { valid: true, value: normalized };
}

export function formatCustomScoreComment(commentary: string, generatedScore: string): string {
  const validation = validateMeaningfulCommentary(commentary);
  if (!validation.valid) throw new Error(validation.message);
  return `${validation.value}\n\n${generatedScore}`;
}
