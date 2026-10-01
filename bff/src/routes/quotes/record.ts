/** One quotation record: read it, save staff edits, approve, archive, repair a link, clean up duplicates. */
import type { Hono } from "hono";
import type { ExtractProvider } from "../../../../ai/src/index.ts";
import { diffBffTrip, pricedFactsChanged, synthesizeConfirmedQuotationReply, type HonoQuotationDraft } from "../../quote/index.ts";
import { BffTrip } from "../../../../ai/src/index.ts";
import { saveQuotationDraft, getQuotationByIdOrSlug, listQuotations, duplicateQuotationIds, removeQuotation } from "../../store/quotationStore.ts";
import { editableQuotationFields, alreadySharedRefusal, deletableByCleanup, buildEstimatePreview } from "./service.ts";
import type { QuotesRouteDeps } from "./shared.ts";

export function registerRecordRoutes(app: Hono, deps: QuotesRouteDeps): void {
  const { estimator, providerHolder, staffSession, staffWriter } = deps;

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
}
