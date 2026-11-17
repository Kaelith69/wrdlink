import { bodyLimit } from 'hono/body-limit';

// Score sharing accepts at most 500 Unicode characters of commentary plus
// a small JSON envelope. Keep the network boundary substantially below the
// 4 MB Devvit platform ceiling.
export const SCORE_SHARE_MAX_BODY_BYTES = 4 * 1024;

export const scoreShareBodyLimit = bodyLimit({
  maxSize: SCORE_SHARE_MAX_BODY_BYTES,
  onError: (c) => c.json({
    error: 'The score sharing request is too large. Keep personal commentary to 500 characters.',
    code: 'REQUEST_TOO_LARGE',
  }, 413),
});
