import { randomUUID } from "node:crypto";
import type { Hono, Context } from "hono";
import {
  type ExtractProvider,
  type Trip,
  verifyGuestFacingText,
} from "../../../ai/src/index.js";
import {
  buildHonoQuotationDraft,
  recalculateQuotationTotals,
  diffBffTrip,
  pricedFactsChanged,
  guestLinkFor,
  synthesizeConfirmedQuotationReply,
  guestFacingFactsFor,
  type HonoQuotationDraft,
  type QuotationSubmission,
} from "../../../quotation/src/index.js";
import { BffTrip } from "../../../contracts/src/index.js";
import { themeCss } from "../views/theme.js";
import { renderGuestQuotationCopyHtml } from "../views/guestQuotationCopy.js";
import { renderOpsSheetHtml } from "../views/opsPage.js";
import {
  saveQuotationDraft,
  getQuotationByIdOrSlug,
  listQuotations,
  duplicateQuotationIds,
  filterQuotations,
  removeQuotation,
  renderHonoQuotationEditorHtml,
} from "../stores/quotationStore.js";
import type { EstimatorPort } from "../services/estimatorPort.js";
import type { DemoRole } from "../auth/demoAuth.js";
import {
  checkRecipient,
  explainMetaError,
  WhatsAppSendError,
  createWhatsAppSender,
  whatsAppConfig,
  type WhatsAppSendText,
} from "../services/whatsapp.js";
import { resortWhatsAppNumber, absoluteUrl } from "../services/whatsappTurnService.js";
import {
  editableQuotationFields,
  alreadySharedRefusal,
  partnerRefusalFor,
  deletableByCleanup,
  buildEstimatePreview,
  estimateToRecord,
  ReservationContact,
} from "../services/quotationService.js";

function canonicalOrigin(c: Context): string {
  const envUrl = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (envUrl) return envUrl;
  return new URL(c.req.url).origin;
}

export interface QuotesRouteDeps {
  estimator: EstimatorPort;
  providerHolder: { get: () => Promise<ExtractProvider> };
  optionsProvider?: ExtractProvider;
  staffSession: (c: Context) => { ok: boolean; role: DemoRole | null };
  staffWriter: (c: Context) => boolean;
  sendWhatsApp?: WhatsAppSendText;
}

export function registerQuotesRoutes(app: Hono, deps: QuotesRouteDeps): void {
  const { estimator, providerHolder, staffSession, staffWriter } = deps;

  app.get("/quotes", async (c) => {
    const auth = staffSession(c);
    if (!auth.ok) return c.redirect("/login");
    const all = await listQuotations();
    const latest = all[0]!;
    return c.html(renderHonoQuotationEditorHtml(latest, all, auth.role ?? "staff", estimator.kind));
  });

  app.get("/quotes/:id", async (c) => {
    const auth = staffSession(c);
    const id = c.req.param("id");
    if (!auth.ok) return c.redirect(`/login?next=${encodeURIComponent(`/quotes/${id}`)}`);
    const found = await getQuotationByIdOrSlug(id);
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.html(renderHonoQuotationEditorHtml(found, await listQuotations(), auth.role ?? "staff", estimator.kind));
  });

  app.get("/q/:slug", async (c) => {
    const slug = c.req.param("slug");
    const found = await getQuotationByIdOrSlug(slug);
    if (!found) return c.json({ error: "not_found" }, 404);

    const guestUrl = found.estimator?.guestUrl;
    if (found.estimator?.mirrorUrl && found.status !== "cancelled") {
      const resortNumber = resortWhatsAppNumber();
      return c.html(
        renderGuestQuotationCopyHtml(found, {
          replyUrl: resortNumber
            ? `https://wa.me/${resortNumber}?text=${encodeURIComponent(
                "Hello Casa Escondida, I am looking at my quotation and have a question.",
              )}`
            : null,
        }),
      );
    }
    if (found.status === "cancelled") {
      if (c.req.header("accept")?.includes("text/html")) {
        return c.html(
          `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation Cancelled — Casa Escondida Anilao</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 44px 36px;
      max-width: 520px;
      width: 100%;
      box-shadow: var(--shadow);
      text-align: center;
    }
    .kicker {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #f43f5e;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 14px;
      color: var(--text);
    }
    p {
      font-size: 15.5px;
      line-height: 1.65;
      color: var(--muted);
      margin: 0 0 20px;
    }
    .footer {
      font-size: 13px;
      color: var(--muted);
      font-weight: 500;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">Casa Escondida Anilao</div>
    <h1>Quotation Cancelled</h1>
    <p>This quotation has expired or was cancelled by the resort reservation team. Please contact us on WhatsApp if you would like an updated quote.</p>
    <div class="footer">Anilao, Batangas, Philippines · Thank you for your understanding</div>
  </div>
</body>
</html>`,
          410
        );
      }
      return c.json({ error: "quotation_cancelled", detail: "this quotation was cancelled" }, 410);
    }
    if (guestUrl) return c.redirect(guestUrl);

    if (c.req.header("accept")?.includes("text/html")) {
      return c.html(
        `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quotation In Preparation — Casa Escondida Anilao</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${themeCss()}
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
    }
    .card {
      background: var(--card);
      border: 2px solid var(--border);
      border-radius: 20px;
      padding: 44px 36px;
      max-width: 520px;
      width: 100%;
      box-shadow: var(--shadow);
      text-align: center;
    }
    .kicker {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 12px;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 14px;
      color: var(--text);
    }
    p {
      font-size: 15.5px;
      line-height: 1.65;
      color: var(--muted);
      margin: 0 0 20px;
    }
    .box {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
      font-size: 14px;
      color: var(--text);
      margin-bottom: 24px;
      line-height: 1.6;
      text-align: left;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 22px;
    }
    .btn {
      display: block;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      border-radius: 999px;
      padding: 12px 18px;
      border: 2px solid var(--border);
      background: var(--card);
      color: var(--text);
      cursor: pointer;
    }
    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--primary-text);
    }
    .footer {
      font-size: 13px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">CASA ESCONDIDA RESORT &amp; DIVE CENTER</div>
    <h1>Your Quotation Is Being Prepared</h1>
    <p>Our reservations team is currently reviewing your trip details and checking resort availability to ensure the most accurate rates.</p>
    <div class="box">
      <strong>What happens next?</strong><br />
      You do not need to take any action. Once reviewed and confirmed by our team, your official quotation link will be sent directly to your WhatsApp.
    </div>
    <div class="actions">
      <a class="btn btn-primary" href="https://wa.me/?text=${encodeURIComponent(
        "Hello Casa Escondida, I opened my quotation link and it says it is still being prepared.",
      )}" target="_blank" rel="noopener">Reply on WhatsApp instead of waiting</a>
      <a class="btn" href="/login">Staff sign-in — open this quotation in the studio</a>
    </div>
    <div class="footer">Anilao, Batangas, Philippines · Thank you for your patience</div>
  </div>
</body>
</html>`,
        410,
      );
    }

    return c.json(
      {
        error: "not_published",
        detail: "this quotation has no guest link yet — the resort team sends it after reviewing the price",
      },
      410,
    );
  });

  app.get("/v1/quotes", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const limitRaw = Number(c.req.query("limit") ?? "");
    const all = await listQuotations();
    const quotations = filterQuotations(all, {
      status: c.req.query("status"),
      q: c.req.query("q"),
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200,
    });
    return c.json({ quotations, total: all.length, returned: quotations.length });
  });

  app.get("/v1/quotes/estimator-status", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const baseUrl = estimator.baseUrl ?? null;
    if (estimator.kind === "remote" && !baseUrl) {
      return c.json({
        configured: false,
        kind: estimator.kind,
        baseUrl: null,
        reachable: null,
        mode: null,
        detail: "ESTIMATOR_MODE=remote but ESTIMATOR_BASE_URL is not set, so quotations cannot be priced",
      });
    }
    const health = await estimator.checkHealth();
    return c.json({
      configured: true,
      kind: estimator.kind,
      baseUrl,
      reachable: health.reachable,
      mode: health.mode,
      detail: health.reachable
        ? estimator.kind === "simulated"
          ? "priced by the built-in simulated engine: sample data, not a real quote"
          : health.mode === "fixture"
            ? "connected in FIXTURE mode: prices are captured samples, not real quotes"
            : "connected"
        : `no answer from ${baseUrl}/api/health`,
    });
  });

  app.post("/v1/quotes/compute", async (c) => {
    if (!staffWriter(c)) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      trip?: Trip;
      phone?: string;
      discountPercent?: number;
      draft?: Partial<HonoQuotationDraft>;
    };

    if (body.trip) {
      const computed = buildHonoQuotationDraft(body.trip, undefined, body.phone);
      if (typeof body.discountPercent === "number") {
        computed.discountPercent = body.discountPercent;
      }
      const finalComputed = recalculateQuotationTotals(computed);
      return c.json({
        ok: true,
        computed: finalComputed,
        estimatePreview: buildEstimatePreview(finalComputed, estimator),
      });
    }

    if (!Array.isArray(body.draft?.lineItems)) {
      return c.json(
        {
          error: "bad_request",
          message:
            "Provide `trip` to price an enquiry, or `draft.lineItems` to price an edited quotation. " +
            "This endpoint is stateless and never reads stored quotations.",
        },
        400,
      );
    }

    const now = new Date().toISOString();
    const quoteId = body.draft.quoteId ?? `QT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const baseUrl = "https://technext-edge-casa-bff.vercel.app";
    const recomputed = recalculateQuotationTotals({
      quoteId,
      slug: body.draft.slug ?? randomUUID(),
      status: "pending_hono_review",
      createdAt: now,
      updatedAt: now,
      phone: body.phone,
      guestName: "Priced draft",
      checkIn: "",
      checkOut: "",
      nights: 0,
      stayingGuests: 0,
      totalGroupSize: 0,
      rooms: 0,
      mealPlan: "full_board",
      diver: false,
      divers: null,
      diveNotes: null,
      guestType: null,
      currency: "PHP",
      discountPercent: body.discountPercent ?? body.draft.discountPercent ?? 0,
      subtotalAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      quotationUrl: `${baseUrl}/q/${body.draft.slug ?? quoteId.toLowerCase()}`,
      honoEditorUrl: `${baseUrl}/quotes/${quoteId}`,
      staffNotes: "",
      staffAlerts: [],
      ...body.draft,
      lineItems: body.draft.lineItems,
    } as HonoQuotationDraft);
    return c.json({
      ok: true,
      computed: recomputed,
      estimatePreview: buildEstimatePreview(recomputed, estimator),
    });
  });

  app.post("/v1/quotes/submit", async (c) => {
    if (!staffWriter(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      trip?: Trip;
      phone?: string;
      discountPercent?: number;
    };
    if (!body.trip) {
      return c.json({ ok: false, error: "trip object is required for submit_quotation_to_hono" }, 400);
    }
    const draft = buildHonoQuotationDraft(body.trip, undefined, body.phone);
    if (typeof body.discountPercent === "number") {
      draft.discountPercent = body.discountPercent;
    }
    const saved = await saveQuotationDraft(recalculateQuotationTotals(draft));
    return c.json({
      ok: true,
      quotation: saved,
      estimatePreview: buildEstimatePreview(saved, estimator),
    });
  });

  app.get("/v1/quotes/:id", async (c) => {
    if (!staffSession(c).ok) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const found = await getQuotationByIdOrSlug(c.req.param("id"));
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.json({ quotation: found, estimatePreview: buildEstimatePreview(found, estimator) });
  });

  app.put("/v1/quotes/:id", async (c) => {
    if (!staffWriter(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const frozen = alreadySharedRefusal(existing);
    if (frozen) return frozen;
    const rawBody = (await c.req.json().catch(() => ({}))) as Partial<HonoQuotationDraft>;

    const { edits, ignored } = editableQuotationFields(rawBody);

    const merged: HonoQuotationDraft = {
      ...existing,
      ...edits,
      quoteId: existing.quoteId,
    };
    const saved = await saveQuotationDraft(merged);
    return c.json({
      ok: true,
      quotation: saved,
      estimatePreview: buildEstimatePreview(saved, estimator),
      ...(ignored.length > 0 ? { ignored } : {}),
    });
  });

  app.post("/v1/quotes/:id/confirm", async (c) => {
    if (!staffWriter(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const frozen = alreadySharedRefusal(existing);
    if (frozen) return frozen;
    if (!existing.pricing) {
      return c.json(
        {
          ok: false,
          reason: "not_priced",
          detail: "this quotation has no price yet — price the trip on the team estimator, then approve it",
        },
        409,
      );
    }
    const rawBody = (await c.req.json().catch(() => ({}))) as Partial<HonoQuotationDraft>;
    const { edits, ignored, claimedTrip } = editableQuotationFields(rawBody);

    const posted = BffTrip.safeParse(claimedTrip);
    const correctedFields =
      posted.success && existing.bffTrip ? diffBffTrip(existing.bffTrip, posted.data) : [];
    if (posted.success && existing.bffTrip && pricedFactsChanged(existing.bffTrip, posted.data)) {
      return c.json(
        {
          ok: false,
          reason: "trip_changed",
          detail:
            "the trip changed after it was priced — price it again on the team estimator, then approve",
          fields: correctedFields,
        },
        409,
      );
    }

    const merged: HonoQuotationDraft = {
      ...existing,
      ...edits,
      quoteId: existing.quoteId,
      status: "confirmed_by_hono",
      confirmedAt: new Date().toISOString(),
      confirmedBy: "Hono Reservation Studio",
      bffTrip: existing.bffTrip,
    };
    if (correctedFields.length > 0) {
      merged.staffEdits = [
        ...(existing.staffEdits ?? []),
        { at: new Date().toISOString(), fields: correctedFields, source: "approve" },
      ];
    }
    const saved = await saveQuotationDraft(merged);
    let provider: ExtractProvider | undefined;
    try {
      provider = deps.optionsProvider ?? (await providerHolder.get());
    } catch {}
    const aiReply = await synthesizeConfirmedQuotationReply(saved, provider);
    saved.aiConfirmedReply = aiReply;
    await saveQuotationDraft(saved);
    return c.json({
      ok: true,
      quotation: saved,
      aiReply,
      estimatePreview: buildEstimatePreview(saved, estimator),
      ...(ignored.filter((key) => key !== "bffTrip").length > 0
        ? { ignored: ignored.filter((key) => key !== "bffTrip") }
        : {}),
    });
  });

  app.post("/v1/quotes/:id/cancel", async (c) => {
    if (!staffWriter(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    existing.status = "cancelled";
    existing.updatedAt = new Date().toISOString();
    const saved = await saveQuotationDraft(existing);
    return c.json({ ok: true, quotation: saved });
  });

  app.post("/v1/quotes/patch-mirror-url", async (c) => {
    if (!staffWriter(c)) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: unknown;
      mirrorUrl?: unknown;
      confirm?: unknown;
    };
    if (typeof body.id !== "string" || !body.id) return c.json({ error: "id required" }, 400);
    if (typeof body.mirrorUrl !== "string" || !body.mirrorUrl.startsWith("https://")) {
      return c.json({ error: "mirrorUrl must be an absolute https URL" }, 400);
    }
    const existing = await getQuotationByIdOrSlug(body.id);
    if (!existing) return c.json({ error: "not found" }, 404);
    if (body.confirm !== true) {
      return c.json({
        dryRun: true,
        quoteId: existing.quoteId,
        currentMirrorUrl: existing.estimator?.mirrorUrl ?? null,
        proposedMirrorUrl: body.mirrorUrl,
        detail: "POST {confirm: true} to apply",
      });
    }
    const updated = await saveQuotationDraft({
      ...existing,
      estimator: {
        ...(existing.estimator ?? { id: null, cookie: null, seq: null, guestUrl: null, sharedAt: null }),
        mirrorUrl: body.mirrorUrl,
      },
    });
    return c.json({ ok: true, quoteId: updated.quoteId, mirrorUrl: updated.estimator?.mirrorUrl ?? null });
  });

  app.post("/v1/quotes/cleanup-duplicates", async (c) => {
    if (!staffWriter(c)) return c.json({ error: "unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      confirm?: unknown;
      ids?: unknown;
      force?: unknown;
      allExceptSeed?: unknown;
    };
    const all = await listQuotations();
    const isForce = body.force === true;
    const allExceptSeed = body.allExceptSeed === true;
    const named = allExceptSeed
      ? new Set(all.filter((q) => q.quoteId !== "QT-1010-SKY" && typeof q.seedVersion !== "number").map((q) => q.quoteId))
      : Array.isArray(body.ids)
        ? new Set(body.ids.map(String))
        : null;
    const canDelete = (q: HonoQuotationDraft) => {
      if (q.quoteId === "QT-1010-SKY" || typeof q.seedVersion === "number") return false;
      return isForce ? true : deletableByCleanup(q);
    };
    const considered = named ? all.filter((q) => named.has(q.quoteId)) : all;
    const doomed = named ? considered.filter(canDelete) : duplicateQuotationIds(all);
    const refused = named ? considered.filter((q) => !canDelete(q)) : [];
    const notFound = named && !allExceptSeed ? [...named].filter((id) => !all.some((q) => q.quoteId === id)) : [];

    if (body.confirm !== true) {
      return c.json({
        ok: true,
        dryRun: true,
        total: all.length,
        wouldRemove: doomed.map((q) => ({
          quoteId: q.quoteId,
          phone: q.phone ?? null,
          guestName: q.guestName,
          createdAt: q.createdAt,
        })),
        refused: refused.map((q) => q.quoteId),
        notFound,
        detail: "nothing was removed — POST {confirm: true} to apply",
      });
    }

    const removed: string[] = [];
    for (const q of doomed) {
      if (await removeQuotation(q.quoteId)) removed.push(q.quoteId);
    }
    return c.json({
      ok: true,
      dryRun: false,
      total: all.length,
      removed,
      refused: refused.map((q) => q.quoteId),
      notFound,
      kept: all.length - removed.length,
    });
  });

  app.post("/v1/quotes/:id/sync-estimate", async (c) => {
    if (!staffWriter(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (existing.estimator?.sharedAt) {
      return c.json(
        {
          ok: false,
          reason: "already_shared",
          detail:
            "this quotation is already published, so its price is frozen on the guest's link — re-pricing it here would make the studio and the link disagree. Start a new quotation instead.",
          guestUrl: existing.estimator.guestUrl,
        },
        409,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { trip?: unknown };
    let tripToPrice = existing.bffTrip;
    let staffEdits = existing.staffEdits ?? [];
    if (body.trip !== undefined) {
      const parsed = BffTrip.safeParse(body.trip);
      if (!parsed.success) {
        return c.json(
          {
            ok: false,
            reason: "invalid_trip",
            detail: "the edited trip does not match the estimator contract",
            fields: parsed.error.issues.map((i) => i.path.join(".") || "(root)"),
          },
          422,
        );
      }
      const precheck = buildEstimatePreview({ ...existing, bffTrip: parsed.data }, estimator).validationIssues;
      if (precheck.some((i) => i.level === "error")) {
        return c.json({ ok: false, reason: "trip_not_priceable", issues: precheck }, 422);
      }
      const changed = existing.bffTrip ? diffBffTrip(existing.bffTrip, parsed.data) : [];
      if (changed.length > 0) {
        staffEdits = [...staffEdits, { at: new Date().toISOString(), fields: changed, source: "trip" }];
      }
      tripToPrice = parsed.data;
    }

    const session = { id: existing.estimator?.id ?? null, cookie: existing.estimator?.cookie ?? null };
    const result = await estimator.sendEstimate(tripToPrice, session);
    if (!result.ok) {
      const status = result.reason === "rejected" ? 422 : result.reason === "not_configured" ? 503 : 502;
      return c.json(
        {
          ok: false,
          reason: result.reason,
          detail: result.detail,
          fields: result.fields,
          estimatePreview: buildEstimatePreview(existing, estimator),
        },
        status,
      );
    }

    const pricing = estimateToRecord(existing, result, estimator.kind);
    await saveQuotationDraft({
      ...existing,
      ...pricing,
      bffTrip: tripToPrice,
      staffEdits,
      status: "pending_hono_review",
      confirmedAt: undefined,
      confirmedBy: undefined,
      aiConfirmedReply: undefined,
    });

    return c.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      endpoint:
        estimator.kind === "simulated"
          ? "simulated engine (in-process)"
          : `${estimator.baseUrl ?? "https://casa-bff-production.up.railway.app"}/api/estimates`,
      role: result.role,
      issues: result.issues,
      computedAt: result.computedAt,
      sample: result.sample,
      mode: result.mode,
      model: result.model,
      pricing: pricing.pricing,
      estimatePreview: buildEstimatePreview(existing, estimator),
    });
  });

  app.post("/v1/quotes/:id/trip", async (c) => {
    if (!staffWriter(c)) return c.json({ error: "unauthorized" }, 401);
    const existing = await getQuotationByIdOrSlug(c.req.param("id"));
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (!existing.bffTrip) {
      return c.json({ ok: false, reason: "no_trip", detail: "this quotation has no trip to edit" }, 409);
    }
    if (existing.estimator?.sharedAt) {
      return c.json(
        {
          ok: false,
          reason: "already_shared",
          detail: "this quotation is already published; a published trip must not change — start a new quotation instead",
          guestUrl: existing.estimator.guestUrl,
        },
        409,
      );
    }

    const body = (await c.req.json().catch(() => null)) as { trip?: unknown } | null;
    const parsed = BffTrip.safeParse(body?.trip);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          reason: "invalid_trip",
          detail: "the edited trip does not match the estimator contract",
          fields: parsed.error.issues.map((i) => i.path.join(".") || "(root)"),
        },
        422,
      );
    }

    const precheck = buildEstimatePreview({ ...existing, bffTrip: parsed.data }, estimator).validationIssues;
    if (precheck.some((i) => i.level === "error")) {
      return c.json({ ok: false, reason: "trip_not_priceable", issues: precheck }, 422);
    }

    const session = { id: existing.estimator?.id ?? null, cookie: existing.estimator?.cookie ?? null };
    let result = await estimator.updateEstimate(session, parsed.data);
    let recovered = false;
    if (!result.ok && result.status === 404) {
      result = await estimator.sendEstimate(parsed.data, session);
      recovered = result.ok;
    }
    if (!result.ok) {
      const status = result.reason === "rejected" ? 422 : result.reason === "not_configured" ? 503 : 502;
      return c.json(
        { ok: false, reason: result.reason, detail: result.detail, fields: result.fields, code: result.code ?? null, issues: result.issues ?? [] },
        status,
      );
    }

    const recorded = estimateToRecord(existing, result, estimator.kind);
    const changedFields = diffBffTrip(existing.bffTrip, parsed.data);
    const staffEdits = [...(existing.staffEdits ?? [])];
    if (changedFields.length > 0) {
      staffEdits.push({ at: new Date().toISOString(), fields: changedFields, source: "trip" });
    }

    const saved = await saveQuotationDraft({
      ...existing,
      ...recorded,
      bffTrip: parsed.data,
      staffEdits,
      status: "pending_hono_review",
      confirmedAt: undefined,
      confirmedBy: undefined,
      aiConfirmedReply: undefined,
    });

    return c.json({
      ok: true,
      editedAt: new Date().toISOString(),
      changedFields,
      recovered,
      issues: [...precheck, ...result.issues.map((i) => ({ level: "warn", source: "estimator", detail: i }))],
      computedAt: result.computedAt,
      sample: result.sample,
      mode: result.mode,
      pricing: recorded.pricing,
      quotation: saved,
    });
  });

  app.post("/v1/quotes/:id/publish", async (c) => {
    if (!staffWriter(c)) return c.json({ error: "unauthorized" }, 401);
    const existing = await getQuotationByIdOrSlug(c.req.param("id"));
    if (!existing) return c.json({ error: "not_found" }, 404);

    if (typeof existing.seedVersion === "number") {
      return c.json(
        {
          ok: false,
          reason: "seeded_fixture",
          detail:
            "this is the studio's cold-start example, not a guest's quotation — take an enquiry through the flow and publish that instead",
        },
        409,
      );
    }
    if (!existing.bffTrip) {
      return c.json({ ok: false, reason: "no_trip", detail: "this quotation has no trip to send" }, 409);
    }
    const partnerRefusal = partnerRefusalFor(existing);
    if (partnerRefusal) return partnerRefusal;
    if (existing.status !== "confirmed_by_hono") {
      return c.json({ ok: false, reason: "not_approved", detail: "approve the quotation before publishing it" }, 409);
    }
    if (existing.estimator?.sharedAt) {
      return c.json(
        {
          ok: false,
          reason: "already_shared",
          detail: "this quotation is already published; edit nothing and publish a new quotation instead",
          guestUrl: existing.estimator.guestUrl,
        },
        409,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { acknowledgeSample?: boolean };
    if (existing.pricing?.sample && body.acknowledgeSample !== true) {
      return c.json(
        {
          ok: false,
          reason: "sample_not_acknowledged",
          detail: "this price came from sample data — acknowledge it before a guest can be sent the link",
        },
        409,
      );
    }

    const session = { id: existing.estimator?.id ?? null, cookie: existing.estimator?.cookie ?? null };
    if (!existing.pricing) {
      return c.json(
        { ok: false, reason: "not_priced", detail: "this quotation has no price yet — get the price, then publish" },
        409,
      );
    }
    if (!session.id) {
      return c.json(
        {
          ok: false,
          reason: "no_scenario",
          detail: "this price did not come from the booking engine, which has no scenario to freeze — get the price from step 2 first",
        },
        409,
      );
    }

    let committed = await estimator.commit(session, existing.bffTrip);
    if (!committed.ok && (committed.detail?.toLowerCase().includes("not found") || committed.reason === "no_snapshot" || committed.reason === "unexpected")) {
      const refreshed = await estimator.sendEstimate(existing.bffTrip, session);
      if (refreshed.ok && refreshed.id) {
        session.id = refreshed.id;
        if (refreshed.sessionCookie) session.cookie = refreshed.sessionCookie;
        committed = await estimator.commit(session, existing.bffTrip);
      }
    }
    if (!committed.ok) {
      const status = committed.reason === "not_configured" ? 503 : 502;
      return c.json({ ok: false, reason: committed.reason, detail: committed.detail }, status);
    }

    let shared = await estimator.share({ ...session, id: session.id });
    if (!shared.ok && (shared.detail?.toLowerCase().includes("not found") || shared.reason === "no_snapshot" || shared.reason === "unexpected")) {
      const refreshed = await estimator.sendEstimate(existing.bffTrip, session);
      if (refreshed.ok && refreshed.id) {
        session.id = refreshed.id;
        if (refreshed.sessionCookie) session.cookie = refreshed.sessionCookie;
        const reCommitted = await estimator.commit(session, existing.bffTrip);
        if (reCommitted.ok) {
          shared = await estimator.share({ ...session, id: session.id });
        }
      }
    }
    if (!shared.ok) {
      const status = shared.reason === "not_configured" ? 503 : 502;
      return c.json({ ok: false, reason: shared.reason, detail: shared.detail }, status);
    }

    const guestUrl = absoluteUrl(shared.url, estimator.appBaseUrl ?? estimator.baseUrl);
    let mirrorUrl: string | null = null;
    let mirrorReason: string | null = null;
    const forceCopy = (process.env.GUEST_LINK_MODE ?? "").trim().toLowerCase() === "copy";
    if (!guestUrl || estimator.kind === "remote") {
      const check = !guestUrl
        ? ({
            ok: false as const,
            reason: "not_configured" as const,
            detail: "the engine returned a relative link and no guest app host is configured",
          })
        : forceCopy
          ? ({ ok: false as const, reason: "not_found" as const, detail: "this deployment is set to send our own copy" })
          : await estimator.verifyGuestLink(guestUrl);
      if (!check.ok) {
        mirrorUrl = `${canonicalOrigin(c)}/q/${encodeURIComponent(existing.slug)}`;
        mirrorReason = forceCopy
          ? "this deployment is set to send our own copy of the quotation (GUEST_LINK_MODE=copy)"
          : check.reason === "not_configured"
            ? "this deployment has no guest app to open the booking engine's link on, so the guest gets a copy of the same revision on our own page"
            : check.reason === "not_found"
              ? "the booking app did not recognise the link it had just issued, so the guest gets a copy of the same revision on our own page"
              : `the booking app could not be asked whether the link opens (${check.reason}), so the guest gets a copy of the same revision on our own page`;
        // eslint-disable-next-line no-console
        console.warn(
          `[casa-bff] publish ${existing.quoteId}: using our copy of the quotation (${forceCopy ? "configured" : check.reason}: ${check.detail})`,
        );
      }
    }

    const saved = await saveQuotationDraft({
      ...existing,
      estimator: {
        ...session,
        seq: committed.seq,
        guestUrl,
        sharedAt: new Date().toISOString(),
        mirrorUrl,
        mirrorReason,
      },
    });

    return c.json({
      ok: true,
      guestUrl,
      guestLink: guestLinkFor(saved),
      mirrorUrl,
      mirrorReason,
      seq: committed.seq,
      expiresAt: shared.expiresAt,
      sample: Boolean(existing.pricing?.sample),
      quotation: saved,
    });
  });

  app.get("/quotes/:id/ops", async (c) => {
    const auth = staffSession(c);
    const id = c.req.param("id");
    if (!auth.ok) return c.redirect(`/login?next=${encodeURIComponent(`/quotes/${id}/ops`)}`);
    const found = await getQuotationByIdOrSlug(id);
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.html(renderOpsSheetHtml(found));
  });

  app.post("/v1/quotes/:id/submit", async (c) => {
    if (!staffWriter(c)) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id");
    const existing = await getQuotationByIdOrSlug(id);
    if (!existing) return c.json({ error: "not_found" }, 404);

    if (estimator.kind === "remote") {
      return c.json(
        {
          ok: false,
          reason: "wrong_place",
          detail: "reservations are taken on the quotation's own page — publish it and send the guest their link",
        },
        409,
      );
    }

    const parsed = ReservationContact.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "Check the contact details", fields: parsed.error.issues.map((i) => `contact.${i.path.join(".")}`) },
        422,
      );
    }
    const contact = parsed.data;
    if (!contact.email.includes("@")) {
      return c.json({ ok: false, error: "Check the contact details", fields: ["contact.email"] }, 422);
    }

    const previous = existing.submission ?? null;
    if (previous && previous.state !== "failed") {
      return c.json({ ok: false, error: "A reservation is already recorded for this quote", reason: "already", submission: previous }, 409);
    }
    if (!existing.bffTrip) {
      return c.json({ ok: false, error: "This quotation has no trip to book", reason: "no_trip" }, 409);
    }

    const now = () => new Date().toISOString();
    const pending: QuotationSubmission = {
      state: "pending",
      seq: (previous?.seq ?? 0) + 1,
      contact: { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone?.trim() || null },
      folioId: null,
      orderIds: null,
      sample: true,
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await saveQuotationDraft({ ...existing, submission: pending });

    const result = await estimator.submit({
      trip: existing.bffTrip,
      contact: pending.contact,
      estimatorId: existing.estimator?.id ?? null,
      estimatorCookie: existing.estimator?.cookie ?? null,
      estimatorSeq: existing.estimator?.seq ?? null,
    });
    const settled: QuotationSubmission = result.ok
      ? { ...pending, state: "confirmed", folioId: result.folioId, orderIds: result.orderIds, sample: result.sample, updatedAt: now() }
      : {
          ...pending,
          state: result.reason === "unknown" ? "unknown" : "failed",
          error: result.reason,
          updatedAt: now(),
        };
    await saveQuotationDraft({ ...existing, submission: settled });

    if (result.ok) return c.json({ ok: true, submission: settled });
    const status = result.reason === "closed" ? 503 : result.reason === "unknown" ? 502 : 502;
    return c.json({ ok: false, reason: result.reason, detail: result.detail, submission: settled }, status);
  });

  app.get("/v1/quotes/:id/submission", async (c) => {
    if (!staffSession(c).ok) return c.json({ error: "unauthorized" }, 401);
    const found = await getQuotationByIdOrSlug(c.req.param("id"));
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, submission: found.submission ?? null });
  });

  app.post("/v1/quotes/:id/send-whatsapp", async (c) => {
    try {
      if (!staffWriter(c)) {
        return c.json({ error: "unauthorized" }, 401);
      }
      const id = c.req.param("id");
      const existing = await getQuotationByIdOrSlug(id);
      if (!existing) return c.json({ error: "not_found" }, 404);

      if (existing.status !== "confirmed_by_hono") {
        return c.json(
          { ok: false, reason: "not_approved", error: "Approve the quotation before sending it to the guest." },
          409,
        );
      }
      const partnerRefusalOnSend = partnerRefusalFor(existing);
      if (partnerRefusalOnSend) return partnerRefusalOnSend;

      const guestUrl = guestLinkFor(existing);
      if (!existing.estimator?.sharedAt || !guestUrl) {
        return c.json(
          {
            ok: false,
            reason: "not_published",
            error:
              "Publish the quotation first — the message carries the link to the guest's own quotation page, and that link does not exist yet.",
          },
          409,
        );
      }

      let draft = existing;
      if (!draft.estimator?.mirrorUrl && estimator.kind === "remote") {
        const linkCheck = await estimator.verifyGuestLink(guestUrl);
        if (!linkCheck.ok) {
          const mirrorReason =
            linkCheck.reason === "not_found"
              ? "the booking app no longer recognises the link it issued, so the guest was sent a copy of the same revision on our own page"
              : `the booking app could not be asked for the link (${linkCheck.reason}: ${linkCheck.detail}), so the guest was sent a copy of the same revision on our own page`;
          draft = await saveQuotationDraft({
            ...existing,
            estimator: {
              ...(existing.estimator ?? { id: null, cookie: null, seq: null, guestUrl: null, sharedAt: null }),
              mirrorUrl: `${canonicalOrigin(c)}/q/${encodeURIComponent(existing.slug)}`,
              mirrorReason,
            },
          });
          // eslint-disable-next-line no-console
          console.warn(`[casa-bff] send ${id}: their link failed verification (${linkCheck.reason}); sending our copy`);
        }
      }
      const guestLinkSent = guestLinkFor(draft) ?? guestUrl;

      const body = (await c.req.json().catch(() => ({}))) as { phone?: string };
      const recipient = checkRecipient(body.phone || existing.phone || "");
      if (!recipient.ok) {
        return c.json({ ok: false, reason: recipient.code, error: recipient.message }, 400);
      }

      let provider: ExtractProvider | undefined;
      try {
        provider = deps.optionsProvider ?? (await providerHolder.get());
      } catch {}
      const text = await synthesizeConfirmedQuotationReply(
        draft.sentToGuestAt ? draft : { ...draft, sentToGuestAt: new Date().toISOString() },
        provider,
      );

      const factGate = verifyGuestFacingText(text, guestFacingFactsFor(draft));
      if (!factGate.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[casa-bff] send ${id}: message stopped by the fact gate (${factGate.reason})`);
        return c.json(
          {
            ok: false,
            reason: "guest_text_failed_fact_gate",
            detail: `the message does not match this trip (${factGate.reason}), so it was not sent — check the trip and the message before sending`,
          },
          422,
        );
      }

      let send: WhatsAppSendText;
      try {
        send = deps.sendWhatsApp ?? createWhatsAppSender(whatsAppConfig());
      } catch (configErr) {
        // eslint-disable-next-line no-console
        console.error(`[casa-bff] whatsapp sender configuration failed for ${id}:`, configErr);
        return c.json(
          {
            ok: false,
            reason: "send_failed",
            error: configErr instanceof Error ? configErr.message : "WhatsApp credentials are not configured on this server.",
          },
          500,
        );
      }

      try {
        await send({ to: recipient.phone, body: text });
        const sentAt = new Date().toISOString();
        await saveQuotationDraft({ ...draft, sentToGuestAt: sentAt, sentToPhone: recipient.phone });
        return c.json({
          ok: true,
          phone: recipient.phone,
          body: text,
          guestLink: guestLinkSent,
          sentAt,
          mirror: Boolean(draft.estimator?.mirrorUrl),
        });
      } catch (err) {
        const meta = err instanceof WhatsAppSendError ? err : null;
        // eslint-disable-next-line no-console
        console.error(`[casa-bff] whatsapp send failed for ${id}: ${meta?.detail ?? String(err)}`);
        return c.json(
          { ok: false, reason: "send_failed", error: explainMetaError(meta?.code, meta?.detail ?? String(err)) },
          502,
        );
      }
    } catch (topErr) {
      // eslint-disable-next-line no-console
      console.error(`[casa-bff] send-whatsapp top-level error:`, topErr);
      return c.json(
        {
          ok: false,
          reason: "internal_error",
          error: topErr instanceof Error ? topErr.message : String(topErr),
        },
        500,
      );
    }
  });
}
