import {
  declinesPartner,
  partnerInvitationReply,
  changedValueNotice,
  pathsRestatedByGuest,
  STALL_LIMIT,
} from "../../../../../../ai/src/index.ts";
import {
  diffBffTrip,
  pricedFactsChanged,
  type HonoQuotationDraft,
} from "../../../../quote/index.ts";
import { createEstimatorOutbox } from "../../../../estimator/outbox.ts";
import type { TurnContext, StepResult } from "../types.ts";

export function absoluteUrl(url: string, baseUrl: string | undefined): string | null {
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return null;
  try {
    return new URL(url, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

export function guestPendingQuotationNote(): string {
  return "\n\nOur reservations team is preparing your quotation now, and will send it to you here shortly.";
}

/**
 * Step 4: Check if the enquiry is complete or an existing draft was updated (Pattern 4).
 * IMPORTANT: This runs BEFORE stepLimits so complete enquiries on turn >= ASK_LIMIT are not aborted.
 */
export async function stepDoneCheck(ctx: TurnContext): Promise<StepResult> {
  const outcome = ctx.converseOutcome;
  if (!outcome) return { type: "continue" };

  const partnerType = outcome.trip.guestType?.value;
  const partnerDeclined = ctx.history.some((t) => t.role === "guest" && declinesPartner(t.text));

  // 1. Partner self-serve check
  if (
    outcome.quotationDraft &&
    !partnerDeclined &&
    (partnerType === "agent" || partnerType === "instructor")
  ) {
    const signInUrl = absoluteUrl("/signin", ctx.deps.estimator.appBaseUrl ?? ctx.deps.estimator.baseUrl);
    if (signInUrl) {
      const replyText = partnerInvitationReply(outcome.trip.language?.value ?? null, signInUrl);
      return {
        type: "stop",
        outcome: {
          kind: "handoff",
          reason: "partner_self_serve",
          replyText,
          context: ctx.combinedText.slice(0, 200),
        },
      };
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[casa-bff] partner enquiry invited nowhere: no absolute app base URL is configured (ESTIMATOR_APP_BASE_URL / ESTIMATOR_BASE_URL)",
    );
  }

  // 2. Complete enquiry -> Create or update quotation draft
  if (outcome.quotationDraft) {
    const carried = ctx.existingDraft;
    const botTrip = outcome.quotationDraft.bffTrip;
    const correctedTrip = carried?.bffTrip;
    const changedPaths = correctedTrip && botTrip ? diffBffTrip(correctedTrip, botTrip) : [];

    // If a draft already exists and this message changed no priced facts, let stepLimits evaluate stall.
    if (carried && changedPaths.length === 0) {
      return { type: "continue" };
    }

    const humanCorrected = (carried?.staffEdits ?? []).length > 0;
    const restated = humanCorrected
      ? pathsRestatedByGuest(changedPaths, outcome.trip, ctx.combinedText)
      : changedPaths;
    const keepCorrectedTrip = Boolean(
      carried && correctedTrip && humanCorrected && changedPaths.length > 0 && restated.length === 0,
    );
    const keptPricedDifference = keepCorrectedTrip && pricedFactsChanged(correctedTrip, botTrip);
    const pricedFactsMoved =
      !keepCorrectedTrip && Boolean(carried && pricedFactsChanged(correctedTrip, botTrip));

    const draft: HonoQuotationDraft = carried
      ? {
          ...outcome.quotationDraft,
          quoteId: carried.quoteId,
          slug: carried.slug,
          quotationUrl: carried.quotationUrl,
          honoEditorUrl: carried.honoEditorUrl,
          createdAt: carried.createdAt,
          bffTrip: keepCorrectedTrip ? correctedTrip : botTrip,
          status: pricedFactsMoved ? "pending_hono_review" : carried.status,
          confirmedAt: pricedFactsMoved ? undefined : carried.confirmedAt,
          confirmedBy: pricedFactsMoved ? undefined : carried.confirmedBy,
          staffNotes: carried.staffNotes,
          aiConfirmedReply: pricedFactsMoved ? undefined : carried.aiConfirmedReply,
          pricing: pricedFactsMoved ? null : (carried.pricing ?? null),
          staffEdits: carried.staffEdits,
          submission: carried.submission ?? null,
          estimator: carried.estimator ?? null,
          staffAlerts: keepCorrectedTrip
            ? keptPricedDifference
              ? [
                  ...(carried.staffAlerts.length > 0 ? carried.staffAlerts : outcome.quotationDraft.staffAlerts),
                  `The guest's latest message would change priced facts you corrected (${changedPaths.join(", ")}). The corrected trip and its price were kept — edit the trip if the guest is right.`,
                ]
              : (carried.staffAlerts.length > 0 ? carried.staffAlerts : outcome.quotationDraft.staffAlerts)
            : pricedFactsMoved
              ? [
                  ...(carried.staffAlerts.length > 0 ? carried.staffAlerts : outcome.quotationDraft.staffAlerts),
                  "The guest changed the trip after it was priced, so the price and the approval were dropped — review it again.",
                ]
              : outcome.quotationDraft.staffAlerts,
        }
      : outcome.quotationDraft;

    draft.phone = ctx.phone;

    if (keepCorrectedTrip) {
      // eslint-disable-next-line no-console
      console.log("quotation kept a staff correction", draft.quoteId, changedPaths.join(","));
    }
    if (pricedFactsMoved) {
      // eslint-disable-next-line no-console
      console.log("quotation reopened: priced facts changed", draft.quoteId);
    }

    await ctx.deps.store.noteOpenFields(
      ctx.phone,
      [...outcome.questions.map((q) => String(q.field)), ...Object.keys(ctx.statedMoneyValues).map((k) => `stated:${k}`)],
      STALL_LIMIT,
    );
    const valueChanges = await ctx.deps.store.noteStatedValues(ctx.phone, ctx.statedMoneyValues);
    const changeNotice = changedValueNotice(valueChanges, ctx.language);

    const shouldCreateEstimate = !carried || pricedFactsMoved;

    if (shouldCreateEstimate && ctx.deps.estimator && draft.bffTrip && draft.bffTrip.checkIn && draft.bffTrip.checkOut) {
      try {
        const trip = draft.bffTrip;
        const idempotencyKey = ctx.batch[0]?.message.id ?? `turn-${ctx.phone}-${Date.now()}`;
        const outbox = ctx.deps.outbox ?? createEstimatorOutbox({ estimator: ctx.deps.estimator });
        const draftRes = await outbox.executeDraft(idempotencyKey, trip);
        if (draftRes.ok) {
          draft.estimator = {
            id: draftRes.id,
            cookie: draftRes.session?.cookie ?? null,
            seq: draftRes.seq ?? null,
            guestUrl: null,
            sharedAt: null,
          };
        } else if (draftRes.status === 422) {
          const refusalMsg = draftRes.detail ?? "We could not calculate an estimate for these dates or guest count. Please check and let us know.";
          return {
            type: "stop",
            outcome: {
              kind: "reply",
              replyText: `${outcome.reply}\n\n${refusalMsg}`,
            },
          };
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[turn] estimator createDraft error:", err);
      }
    }

    const replyText = `${outcome.reply}${changeNotice ? `\n\n${changeNotice}` : ""}${guestPendingQuotationNote()}`;

    return {
      type: "stop",
      outcome: {
        kind: "reply",
        replyText,
        quotationDraft: draft,
      },
    };
  }

  return { type: "continue" };
}
