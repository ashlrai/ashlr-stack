/** Process statuses used by Stack itself. Wrapped commands may return other codes. */
export const EXIT_CODES = {
  OK: 0,
  ERROR: 1,
  NOT_FOUND: 2,
  NOT_ALLOWED: 3,
  UNAVAILABLE: 4,
  // Doctor already uses 2 when it finds issues.
  DOCTOR_ISSUES: 2,
} as const;
