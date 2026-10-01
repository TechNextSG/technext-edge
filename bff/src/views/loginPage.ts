import { themeCss } from "./theme.ts";
import { SAFE_NEXT_PREFIXES } from "../auth/demoAuth.ts";

/**
 * The demo sign-in page. One password field, and a `role` field the form fills with `staff` — the
 * studio is a staff tool, and a session's role only changes what a view is *called*. (This comment
 * used to say the page had a role picker; it never did, and the picker that existed lived in the
 * studio header and has been removed.)
 */
export function renderLoginHtml(error = false, nextPath = "/quotes"): string {
  // An allow-list of prefixes, never a passthrough: `next` arrives from the query string, so
  // echoing it back unchecked is an open redirect. `/handoff` is here because the handoff inbox
  // deep-links itself ("/login?next=%2Fhandoff") and the earlier check only knew about `/quotes`,
  // so a person sent to sign in from the inbox landed in the studio instead.
  const safeNext = SAFE_NEXT_PREFIXES.some((prefix) => nextPath.startsWith(prefix)) ? nextPath : "/quotes";
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staff Sign-In — Casa Escondida Quotation Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
      transition: background 0.2s, color 0.2s;
      position: relative;
    }
    .theme-bar {
      position: fixed;
      top: 20px;
      right: 24px;
      z-index: 50;
    }
    .theme-btn {
      background: var(--card);
      color: var(--text);
      border: 2px solid var(--border);
      border-radius: 999px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      transition: border-color 0.15s;
    }
    .theme-btn:hover { border-color: var(--primary); }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 40px 36px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }
    .brand-kicker {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--primary);
      margin-bottom: 8px;
    }
    h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; }
    p.sub { color: var(--muted); font-size: 15px; margin: 0 0 26px; font-weight: 500; }
    label { display: block; font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    .password-wrapper {
      position: relative;
      margin-bottom: 24px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      background: var(--input-bg);
      border: 2px solid var(--border);
      color: var(--text);
      padding: 13px 48px 13px 14px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
    }
    input:focus { outline: none; border-color: var(--primary); }
    .pwd-toggle {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 6px;
    }
    .pwd-toggle:hover { color: var(--text); }
    button[type="submit"] {
      width: 100%;
      background: var(--primary);
      color: var(--primary-text);
      border: none;
      padding: 15px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
      transition: filter 0.15s;
    }
    button[type="submit"]:hover { filter: brightness(1.08); }
    .err {
      background: rgba(244, 63, 94, 0.12);
      border: 2px solid #f43f5e;
      color: #e11d48;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14.5px;
      font-weight: 700;
      margin: 0 0 20px;
    }
    .footer-note {
      font-size: 13px;
      color: var(--muted);
      text-align: center;
      margin-top: 26px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="theme-bar">
    <button type="button" class="theme-btn" id="theme-toggle-btn" onclick="toggleTheme()">Dark Mode</button>
  </div>
  <form class="card" method="post" action="/login">
    <input type="hidden" name="next" value="${safeNext.replace(/"/g, "&quot;")}" />
    <input type="hidden" name="role" value="staff" />
    <div class="brand-kicker">CASA ESCONDIDA RESORT &amp; DIVE CENTER</div>
    <h1>Quotation Studio</h1>
    <p class="sub">Staff sign-in to review &amp; finalize guest reservations</p>
    ${error ? `<p class="err">Incorrect password. Please verify and try again.</p>` : ""}
    <label for="password">Staff Access Key / Password</label>
    <div class="password-wrapper">
      <input id="password" name="password" type="password" placeholder="Enter staff access key or password..." autocomplete="current-password" autofocus />
      <button type="button" class="pwd-toggle" id="pwd-toggle-btn" onclick="togglePasswordVisibility()">Show</button>
    </div>
    <button type="submit">Sign In to Quotation Studio</button>
    <div class="footer-note">
      Casa Escondida Anilao · Reservation Management System<br />
      <span style="font-size:12px;opacity:0.8;">Authorized personnel and resort staff only</span>
    </div>
  </form>
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
    function togglePasswordVisibility() {
      const input = document.getElementById('password');
      const btn = document.getElementById('pwd-toggle-btn');
      if (!input || !btn) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    }
  </script>
</body>
</html>`;
}

