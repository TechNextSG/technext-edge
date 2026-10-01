/**
 * The three small helpers the staff page's browser script defines, held as text so there is one source for each.
 * Each constant is inserted into `client.ts` exactly where the function used to be written out, so the rendered page
 * is byte for byte what it was (`bff/test/editorSnapshot.test.ts`).
 */

/** Escapes a value for innerHTML, the way `views/html.ts` does on the server. */
export const ESC_HTML_JS = `    // The same escaping the server does (html.ts), for the parts of this page the browser draws. A
    // line description and a guest name arrive from WhatsApp, so a less-than sign in either is not
    // markup — it is a guest's own text, and it reaches staff who are signed in.
    function escHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }`;

/** Reads a response as JSON, and turns a non-JSON body into a readable error object instead of throwing. */
export const SAFE_JSON_JS = `    async function safeJson(res) {
      if (typeof res.text === 'function') {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (err) {
          const snippet = text ? text.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
          return {
            ok: false,
            reason: 'server_error',
            error: 'Server returned ' + (res.status || 'error') + (res.statusText ? ' ' + res.statusText : '') + (snippet ? ': ' + snippet : '')
          };
        }
      }
      if (typeof res.json === 'function') {
        try {
          return await res.json();
        } catch (err) {
          return { ok: false, reason: 'parse_error', error: String(err) };
        }
      }
      return { ok: false, reason: 'unknown_response', error: 'Invalid response' };
    }`;

/** A whole-number amount in the quotation's currency (peso sign unless USD). */
export const FMT_MONEY_JS = `    function fmtMoney(n, currency) {
      const sym = (currency || state.currency) === 'USD' ? '$' : '₱';
      return sym + Number(n || 0).toLocaleString('en-US');
    }`;
