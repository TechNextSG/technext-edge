// PLACEHOLDER values — these are guesses standing in for real Casa house norms.
// Confirm the actual defaults with Jett/Eloa before this feeds the eval run;
// wrong guesses here surface as fabricated-looking fields, which the eval's
// zero-tolerance metric will (correctly) flag.
export const HOUSE_NORMS = {
  meals: "full_board",
  transport: false,
  rooms: 1,
  language: "en",
} as const;
