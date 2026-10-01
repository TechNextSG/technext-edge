/** Booking: submit a quotation to the estimator and read the submission back. */
import { Hono } from "hono";
import type { Trip } from "../../../../ai/src/index.ts";
import { buildHonoQuotationDraft, recalculateQuotationTotals, type QuotationSubmission } from "../../quote/index.ts";
import { saveQuotationDraft, getQuotationByIdOrSlug } from "../../store/quotationStore.ts";
import { buildEstimatePreview, ReservationContact } from "./service.ts";
import type { QuotesRouteDeps } from "./shared.ts";

export function bookingRoutes(deps: QuotesRouteDeps): Hono {
  const app = new Hono();
  const { estimator, staffSession, staffWriter } = deps;

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

  return app;
}
