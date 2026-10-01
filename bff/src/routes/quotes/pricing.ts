/** Pricing: ask the estimator for a figure, re-sync a scenario, apply a trip edit. */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Trip } from "../../../../ai/src/index.ts";
import { buildHonoQuotationDraft, recalculateQuotationTotals, diffBffTrip, type HonoQuotationDraft } from "../../quote/index.ts";
import { BffTrip } from "../../../../ai/src/index.ts";
import { saveQuotationDraft, getQuotationByIdOrSlug } from "../../store/quotationStore.ts";
import { buildEstimatePreview, estimateToRecord } from "./service.ts";
import type { QuotesRouteDeps } from "./shared.ts";

export function pricingRoutes(deps: QuotesRouteDeps): Hono {
  const app = new Hono();
  const { estimator, staffWriter } = deps;

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

  return app;
}
