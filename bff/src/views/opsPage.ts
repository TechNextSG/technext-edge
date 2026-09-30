/**
 * The Ops Sheet: one page per day of the stay, for the people who run the day.
 *
 * It replaces the paper board the morning meeting is worked from — front desk, housekeeping, dive
 * centre, kitchen, transfers — and it is deliberately **money-free**. That is not squeamishness
 * about the numbers: this sheet is printed, carried and left on counters, and the people holding it
 * need to know who arrives, which rooms are occupied, who is on the boat and how many meals to
 * cook. A price on it would be a price in a place nobody agreed to put one.
 *
 * The days come from the pricing engine's own operational half (`stayDates`, `presence`, `covers`,
 * `dayPlans`, `vanRuns`), not from re-deriving them here: those are the same rows their Ops Sheet
 * reads, and computing a second version in our UI is how the two start disagreeing.
 *
 * A quotation that has not been priced has no operational data, and this says so instead of
 * inventing an empty day.
 */
import { themeCss } from "./theme.js";
import type { HonoQuotationDraft } from "../../../ai/src/index.js";
import { escapeHtml } from "./html.js";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri, Nov 20, 2026" — how the customer's own sheet heads a day. */
function longDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${SHORT_DAYS[d.getUTCDay()]}, ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** A room's guest-facing label, from the trip's room list by id. */
function roomLabels(draft: HonoQuotationDraft): Record<string, string> {
  const out: Record<string, string> = {};
  const rooms = draft.bffTrip?.rooms ?? [];
  const perType: Record<string, number> = {};
  for (const room of rooms) {
    if (!room.id) continue;
    if (room.name) {
      out[room.id] = room.name;
      continue;
    }
    const index = perType[room.type] ?? 0;
    perType[room.type] = index + 1;
    const prefix = room.type === "standard" ? "Standard" : room.type === "deluxe" ? "Deluxe" : "Suite";
    out[room.id] = `${prefix} ${String.fromCharCode(65 + index)}`;
  }
  return out;
}

function list(names: string[]): string {
  if (names.length === 0) return "—";
  return names.map((n) => escapeHtml(n)).join(", ");
}

export function renderOpsSheetHtml(draft: HonoQuotationDraft): string {
  const pricing = draft.pricing ?? null;
  const ops = pricing?.ops ?? null;

  const backLink = `<a class="back no-print" href="/quotes/${encodeURIComponent(draft.quoteId)}">← Back to the quotation</a>`;
  const heading = `<header>
    <h1>Ops sheet</h1>
    <div class="sub">${escapeHtml(draft.guestName || "Guest")} · ${escapeHtml(draft.checkIn)} → ${escapeHtml(draft.checkOut)} · ${draft.stayingGuests} guest(s)</div>
  </header>`;

  if (!ops || ops.stayDates.length === 0) {
    return page(
      `${heading}
    <div class="bar">${backLink}<span class="pill">not priced yet</span></div>
    <div class="empty">This quotation has no operational data yet. Price it in the studio first — the ops sheet is built from the pricing engine's own day rows, so there is nothing to show until it has answered.</div>`,
    );
  }

  const labels = roomLabels(draft);
  const roomsFor = (roomId: string) => labels[roomId] ?? roomId ?? "—";

  // The stay's nights, plus the departure day: the last morning is the one with the most work on
  // it (seven check-outs and a van), so leaving it off would be the opposite of useful.
  const days = [...ops.stayDates, addDaysIso(draft.checkOut || ops.stayDates[ops.stayDates.length - 1]!, 0)];

  const sheets = days
    .map((date, index) => {
      const present = ops.presence[date] ?? [];
      const previous = index > 0 ? ops.presence[days[index - 1]!] ?? [] : [];
      const previousNames = new Set(previous.map((g) => g.name));
      const presentNames = new Set(present.map((g) => g.name));

      const arrivals = index === 0 ? present.map((g) => g.name) : present.filter((g) => !previousNames.has(g.name)).map((g) => g.name);
      const departures = previous.filter((g) => !presentNames.has(g.name)).map((g) => g.name);

      const rooms = new Map<string, string[]>();
      for (const guest of present) {
        const key = roomsFor(guest.room);
        rooms.set(key, [...(rooms.get(key) ?? []), guest.name]);
      }

      const dive = ops.dayPlans.find((plan) => plan.date === date);
      // Only the direction the guest asked for. The engine's van runs come back for both ends of a
      // return trip; a guest who wanted the pickup alone must not get a departure van on the sheet.
      const transfers = ops.transfers.filter(
        (run) => run.date === date && (!draft.transferDirection || run.dir === draft.transferDirection),
      );
      const covers = ops.covers[date];

      return `<article class="day print-page">
  <h2>${escapeHtml(longDay(date))}${index === 0 ? ' <span class="tag">arrival day</span>' : index === days.length - 1 ? ' <span class="tag">departure day</span>' : ""}</h2>
  <div class="blocks">
    <section>
      <h3>Front desk</h3>
      <dl>
        <dt>Check-in</dt><dd>${list(arrivals)}</dd>
        <dt>Check-out</dt><dd>${list(departures)}</dd>
      </dl>
    </section>
    <section>
      <h3>Housekeeping</h3>
      ${
        rooms.size === 0
          ? `<p class="none">No rooms occupied</p>`
          : `<dl>${[...rooms.entries()]
              .map(([room, names]) => `<dt>${escapeHtml(room)}</dt><dd>${list(names)}</dd>`)
              .join("")}</dl>`
      }
    </section>
    <section>
      <h3>Dive centre</h3>
      ${
        dive && dive.divers.length > 0
          ? `<dl><dt>Any boat</dt><dd>${list(dive.divers)} · ${dive.divers.length} diver(s)</dd></dl>`
          : `<p class="none">No diving</p>`
      }
    </section>
    <section>
      <h3>Kitchen</h3>
      <dl><dt>Covers</dt><dd>${typeof covers === "number" ? `${covers} covers` : "—"}</dd>
      ${draft.dietNotes ? `<dt>Diet / allergies</dt><dd>${escapeHtml(draft.dietNotes)}</dd>` : ""}</dl>
    </section>
    <section>
      <h3>Transfers</h3>
      ${
        transfers.length === 0
          ? `<p class="none">No vans</p>`
          : `<dl>${transfers
              .map((run) => `<dt>${escapeHtml(run.dir === "departure" ? "Departure" : "Arrival")}</dt><dd>${run.pax} pax</dd>`)
              .join("")}</dl>`
      }
    </section>
  </div>
</article>`;
    })
    .join("\n");

  return page(
    `${heading}
  <div class="bar">
    ${backLink}
    <span class="pill">${days.length} day(s)</span>
    <button type="button" class="no-print" onclick="window.print()">Print</button>
    <button type="button" class="theme-btn no-print" id="theme-toggle-btn" onclick="toggleTheme()">Dark Mode</button>
  </div>
  ${sheets}`,
  );
}

/** One page shell, so the empty state and the real sheet cannot drift apart. */
function page(body: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ops sheet — Casa Escondida</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
${themeCss()}
    body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
    header { margin-bottom: 6px; }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px; }
    .sub { color: var(--muted); font-size: 14px; font-weight: 600; }
    .bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 16px 0 22px; }
    .pill { background: var(--row); color: var(--muted); border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 700; }
    button { font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
      background: var(--card); color: var(--text); border: 2px solid var(--border); border-radius: 999px; padding: 8px 14px; }
    a.back { color: var(--primary); font-weight: 700; text-decoration: none; }
    .empty { background: var(--card); border: 2px dashed var(--border); border-radius: 14px; padding: 32px; color: var(--muted); font-weight: 600; }
    .day { background: var(--card); border: 2px solid var(--border); border-radius: 16px; padding: 22px 24px; margin-bottom: 18px; }
    .day h2 { font-size: 19px; font-weight: 800; margin: 0 0 14px; }
    .tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; vertical-align: middle; }
    .blocks { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    section h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 8px; }
    dl { margin: 0; }
    dt { font-size: 12px; color: var(--muted); font-weight: 700; margin-top: 6px; }
    dd { margin: 1px 0 0; font-size: 15px; font-weight: 600; }
    .none { color: var(--muted); font-size: 15px; font-weight: 600; margin: 0; }
    @media print {
      body { background: #fff; color: #000; padding: 10mm 12mm; }
      .no-print { display: none !important; }
      .day { border: 1.5px solid #444; border-radius: 6px; break-after: page; padding: 18px 20px; margin-bottom: 0; box-shadow: none; background: #fff; }
      .day:last-of-type { break-after: auto; }
      .blocks { grid-template-columns: repeat(2, 1fr); gap: 14px; }
      .tag { border-color: #444; color: #000; }
    }
  </style>
</head>
<body>
  ${body}
  <script>
    (function initTheme() {
      const saved = localStorage.getItem('casa_theme') || 'light';
      document.documentElement.setAttribute('data-theme', saved);
      updateThemeBtn(saved);
    })();
    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      localStorage.setItem('casa_theme', cur);
      updateThemeBtn(cur);
    }
    function updateThemeBtn(theme) {
      const btn = document.getElementById('theme-toggle-btn');
      if (btn) btn.textContent = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
    (function syncBackLink() {
      const tok = new URLSearchParams(window.location.search).get('token');
      if (!tok) return;
      const back = document.querySelector('a.back');
      if (back && !back.href.includes('token=')) {
        back.href += (back.href.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(tok);
      }
    })();
  </script>
</body>
</html>`;
}
