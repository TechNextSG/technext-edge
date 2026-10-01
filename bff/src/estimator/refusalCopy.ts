/**
 * What staff read when the booking engine answers 422 with a code.
 *
 * Their 422 body is `{ error, code, fields, issues: [{ code, fields, level, params? }] }`, and `error`
 * is a Vietnamese sentence ("Chuyến không hợp lệ") that tells a receptionist nothing. The `code` is the
 * stable part, so it is what gets translated here. `TripIssueCode` on the team estimator's side is a closed union
 * (`bff/src/trip/validate.ts`); `refusalCopy.test.ts` fails when the vendored snapshot of that
 * union holds a code missing from `ISSUE_COPY`, so a new rule cannot arrive as an unexplained refusal.
 *
 * A code this table does not know is shown as itself, with its fields — never swallowed.
 */

export interface RefusalIssue {
  code: string;
  fields?: string[];
  level?: string;
  params?: Record<string, unknown>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-20" -> "Nov 20". Anything else passes through unchanged. */
function shortDate(value: unknown): string {
  const m = typeof value === "string" ? /^\d{4}-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return String(value ?? "that night");
  return `${MONTHS[Number(m[1]) - 1] ?? m[1]} ${Number(m[2])}`;
}

export const ISSUE_COPY: Record<string, (issue: RefusalIssue) => string> = {
  "room-over-capacity": (i) => {
    const p = i.params ?? {};
    return `Room ${String(p.roomId ?? "?")} holds ${String(p.cap ?? "?")}; ${String(p.n ?? "more")} guests on ${shortDate(p.date)} — add a room`;
  },
  "checkout-not-after-checkin": () => "Check-out must be after check-in",
  "checkin-in-past": () => "Check-in is in the past",
  "dive-window-reversed": () => "The dive window ends before it starts",
  "dive-window-outside-stay": () => "The dive window falls outside the stay (check-in to check-out)",
  "dive-days-outside-window": () => "A guest has dive days outside the dive window",
  "arrive-depart-outside-stay": () => "A guest's arrival or departure is outside the stay",
  "divers-over-guests": () => "More divers than guests",
  "room-empty": () => "A room has no guest in it",
};

/** Codes that have a sentence above. The parity test reads this. */
export const KNOWN_ISSUE_CODES: readonly string[] = Object.keys(ISSUE_COPY);

function issuesOf(parsed: Record<string, unknown>): RefusalIssue[] {
  if (!Array.isArray(parsed.issues)) return [];
  return parsed.issues.flatMap((raw): RefusalIssue[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.code !== "string") return [];
    return [
      {
        code: r.code,
        fields: Array.isArray(r.fields) ? r.fields.map(String) : [],
        level: typeof r.level === "string" ? r.level : undefined,
        params: typeof r.params === "object" && r.params !== null ? (r.params as Record<string, unknown>) : undefined,
      },
    ];
  });
}

/** The 422 body's `issues`, cleaned to the shape above. Empty when there are none. */
export function refusalIssues(parsed: Record<string, unknown>): RefusalIssue[] {
  return issuesOf(parsed);
}

/** The body's top-level `code`, when it has one. */
export function refusalCode(parsed: Record<string, unknown>): string | null {
  return typeof parsed.code === "string" && parsed.code ? parsed.code : null;
}

function sentenceFor(issue: RefusalIssue): string {
  const known = ISSUE_COPY[issue.code];
  if (known) return known(issue);
  const fields = issue.fields && issue.fields.length > 0 ? ` (${issue.fields.join(", ")})` : "";
  return `${issue.code}${fields}`;
}

/**
 * One line for staff from a 422 body, or `null` when the body carries nothing to translate.
 * Errors are listed; warnings are not a reason the engine said no.
 */
export function describeRefusal(parsed: Record<string, unknown>): string | null {
  const blocking = issuesOf(parsed).filter((i) => i.level !== "warn");
  if (blocking.length > 0) return blocking.map(sentenceFor).join("; ");

  const code = refusalCode(parsed);
  if (code) {
    const fields = Array.isArray(parsed.fields) ? parsed.fields.map(String).filter(Boolean) : [];
    return sentenceFor({ code, fields });
  }
  return null;
}
