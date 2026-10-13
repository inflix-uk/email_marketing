// A/B subject test settings, shared by the editor form (client) and the save action.

export const AB_TEST_DEFAULTS = { testPercent: 20, waitHours: 4 } as const;

export const AB_TEST_LIMITS = {
  testPercent: { min: 10, max: 100 },
  waitHours: { min: 1, max: 72 },
} as const;
