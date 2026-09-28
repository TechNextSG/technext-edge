/**
 * The handoff inbox: the page a person reads to pick up what the bot stopped answering.
 *
 * Why this exists: the stopping point (`ASK_LIMIT`, `stalled`, `wantsHuman`, a cancellation, a
 * failed turn) only means something if a human can see it. Until this page, a parked thread was
 * reachable through `GET /v1/channels/whatsapp/threads` — JSON, behind a header token — which is
 * fine for a script and useless for reception. The failure mode that produces is the exact one the
 * parking exists to prevent: the guest is told a person is on it, and no person ever is.
 *
 * The page is deliberately the same shape as the demo sign-in (light/dark theme, the same type),
 * because it is used by the same people in the same sitting.
 *
 * Reads only what the store already records. `missingFields` and `context` are best-effort: park
 * records written before those existed simply do not have them, and the row must still render.
 */
import { themeCss } from "./theme.js";
import type { PausedThread } from "./conversationStore.js";
import type { DemoRole } from "./demoAuth.js";
import { escapeHtml } from "./html.js";

/** A parked thread's reason, in words a person can act on. */
const REASON_LABELS: Record<string, string> = {
  guest_asked_for_human: "Guest asked for a person",
  complaint_or_cancel: "Cancellation / complaint",
  not_booking: "Not a booking enquiry",
  stalled: "Stuck — same questions open",
  asking_limit: "Turn limit reached",
  turn_failed: "Our side failed on their message",
  // Parked on purpose, and the only reason where the bot is still listening: an agency enquiry is
  // priced on their own sign-in page rather than by us, and the guest can send it back here by
  // saying they are booking for themselves. The row has to say that, because "nothing for you to
  // do" and "invited to self-serve" otherwise look identical in a list of parked threads.
  partner_self_serve: "Partner — invited to self-serve",
};

/** The pipeline's field names, in words a person can read off a phone call. */
const FIELD_LABELS: Record<string, string> = {
  checkIn: "check-in date",
  checkOut: "check-out date",
  nights: "number of nights",
  guests: "number of guests",
  rooms: "number of rooms",
  roomType: "room type (standard / deluxe / suite)",
  meals: "meal plan",
  transport: "airport transfer (yes/no)",
  transportType: "one-way or return",
  contactName: "name for the booking",
  diver: "whether they dive",
  divers: "how many dive",
  diveFrom: "first dive day",
  diveTo: "last dive day",
};

function waitingFor(since: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

function renderRow(thread: PausedThread, now: number, role: DemoRole): string {
  const missing = (thread.missingFields ?? []).map((f) => FIELD_LABELS[f] ?? f);
  const reason = REASON_LABELS[thread.reason] ?? thread.reason;
  const phone = escapeHtml(thread.phone);
  // Only staff may hand a thread back, because resume() changes who owns the conversation. An
  // agent reading the list is useful; an agent un-parking someone else's guest is not.
  const actions =
    role === "staff"
      ? `<form method="post" action="/handoff/${encodeURIComponent(thread.phone)}/resume"><button type="submit">Take it back to the bot</button></form>
         <form method="post" action="/handoff/${encodeURIComponent(thread.phone)}/reset"><button type="submit" class="danger">Clear the thread</button></form>`
      : `<span class="readonly">Staff only</span>`;

  return `<tr>
  <td><span class="phone">${phone}</span><div class="since">waiting ${waitingFor(thread.since, now)}</div></td>
  <td><span class="reason">${escapeHtml(reason)}</span></td>
  <td>${missing.length > 0 ? `<ul>${missing.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : `<span class="muted">—</span>`}</td>
  <td class="msg">${thread.context ? escapeHtml(thread.context) : `<span class="muted">—</span>`}</td>
  <td class="actions">${actions}</td>
</tr>`;
}

export function renderHandoffPageHtml(paused: PausedThread[], role: DemoRole = "staff", now = Date.now()): string {
  const rows = paused.map((thread) => renderRow(thread, now, role)).join("\n");

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Handoff Inbox — Casa Escondida</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg); color: var(--text); margin: 0; padding: 24px;
    }
    header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
    h1 { font-size: 22px; font-weight: 800; margin: 0; }
    .sub { color: var(--muted); font-size: 14px; font-weight: 500; }
    .bar { display: flex; gap: 10px; align-items: center; margin: 16px 0; flex-wrap: wrap; }
    .pill { background: var(--warn-bg); color: var(--warn); border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 700; }
    .theme-btn, button {
      font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
      background: var(--card); color: var(--text); border: 2px solid var(--border);
      border-radius: 999px; padding: 8px 14px;
    }
    .theme-btn { margin-left: auto; }
    .danger { color: #e11d48; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 2px solid var(--border); border-radius: 14px; overflow: hidden; }
    th, td { text-align: left; vertical-align: top; padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 14px; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); background: var(--row); }
    tr:last-child td { border-bottom: none; }
    td ul { margin: 0; padding-left: 18px; }
    .phone { font-weight: 700; }
    .since { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .reason { font-weight: 700; }
    .msg { max-width: 340px; color: var(--muted); font-size: 13px; }
    .muted { color: var(--muted); }
    .actions form { display: inline-block; margin: 0 6px 6px 0; }
    .empty { background: var(--card); border: 2px dashed var(--border); border-radius: 14px; padding: 32px; text-align: center; color: var(--muted); font-weight: 600; }
    a.back { color: var(--primary); font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <h1>Handoff inbox</h1>
    <span class="sub">Enquiries the bot stopped answering, waiting for a person</span>
  </header>
  <div class="bar">
    <span class="pill">${paused.length} waiting</span>
    <a class="back" href="/quotes">← Quotation studio</a>
    <form method="post" action="/logout" style="display:inline;"><button type="submit">Sign out</button></form>
    <button type="button" class="theme-btn" id="theme-toggle-btn" onclick="toggleTheme()">Dark Mode</button>
  </div>
  ${
    paused.length === 0
      ? `<div class="empty">Nothing is waiting. Every thread is still the bot's.</div>`
      : `<table>
    <thead>
      <tr><th>Guest</th><th>Why it stopped</th><th>Still needed</th><th>Their last message</th><th>Action</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>`
  }
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
  </script>
</body>
</html>`;
}
