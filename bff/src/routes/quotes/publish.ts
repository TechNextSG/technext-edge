/** Publishing: create the guest link, and send it to the guest on WhatsApp. */
import { loadEnv } from "../../env.ts";
import type { Hono } from "hono";
import { type ExtractProvider, verifyGuestFacingText } from "../../../../ai/src/index.ts";
import { guestLinkFor, synthesizeConfirmedQuotationReply, guestFacingFactsFor } from "../../quote/index.ts";
import { saveQuotationDraft, getQuotationByIdOrSlug } from "../../store/quotationStore.ts";
import { checkRecipient, explainMetaError, WhatsAppSendError, createWhatsAppSender, whatsAppConfig, type WhatsAppSendText } from "../../channels/whatsapp/index.ts";
import { absoluteUrl } from "../../channels/whatsapp/index.ts";
import { partnerRefusalFor } from "./service.ts";
import { canonicalOrigin, type QuotesRouteDeps } from "./shared.ts";

export function registerPublishRoutes(app: Hono, deps: QuotesRouteDeps): void {
  const { estimator, providerHolder, staffWriter } = deps;

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
    const forceCopy = (loadEnv().GUEST_LINK_MODE ?? "").trim().toLowerCase() === "copy";
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
