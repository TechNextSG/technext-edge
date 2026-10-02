# ADR-010: Staff hand-off: how staff are told, and where they reply

- **Status:** Proposed (for Lead / Anthony / resort review; no runtime code is written, no template is submitted to Meta)
- **Date:** 2026-10-02
- **Deciders:** Lead (Duy), Anthony, the resort. Proposed by the TechNext Edge pod (`aidev1-technext`).
- **Related:** [ADR-008](./ADR-008-advisory-agent.md) (its `advice_unanswered` hand-off). [ADR-009](./ADR-009-advisory-langgraph.md) (LangGraph `interrupt()`) waits until this one is decided.
- **Diagram:** [handoff-flow.html](../diagrams/handoff-flow.html) (dashed nodes do not exist in code yet)

---

## 1. Context

The Lead asked two questions about the moment the bot hands a guest to staff:

1. **How are staff told?** They will not watch a web page all day.
2. **Where and how do staff reply?** The WhatsApp number is a Meta Cloud API number, so staff cannot simply open WhatsApp and answer.

What the code does today, checked on 2026-10-02:

- **Nobody is told.** `store.pause(...)` in `bff/src/channels/whatsapp/turn.ts` (lines 228, 256, 284 and 384) only records the pause.
  The thread then appears in `/handoff` (`bff/src/routes/handoff.ts:22`, `bff/src/views/handoffPage.ts`). There is no email, chat, push or any other
  notification channel in `bff/src` (no mail, Slack, Telegram, Viber or push library, and no code that sends anything to a staff address).
  The only outbound messages are the replies to guests (`createWhatsAppSender`, `bff/src/channels/whatsapp/meta.ts:287`).
- **Staff cannot reply from the system.** `/handoff` has two actions: `resume`, which gives the thread back to the bot (`handoff.ts:30`), and `reset`, which
  clears it (`handoff.ts:38`; the forms are at `handoffPage.ts:69-70`). There is no compose box.
- **The bot makes a promise that nothing keeps.** `fallbackReply("handoff" | "not_booking" | "apology")` tells the guest a person will reply "here"
  (`ai/src/application/questions.ts:1033-1049`). With a Cloud API number, "here" can only be reached through the API. Two of the three texts
  already add the front-desk hours ("open until 9 PM, Manila time"); the `not_booking` text does not.
- **The staff inbox already knows why.** `REASON_LABELS` (`handoffPage.ts:22-34`) names the reasons: a guest asked for a person, a cancellation or
  complaint, not a booking, stalled, turn limit, our side failed, partner self-serve. An alert can reuse them.
- **Today's sending is on a test number.** `explainMetaError` explains Meta error 131030, "this number isn't on the WhatsApp test list"
  (`meta.ts:223-224`). A test number can only reach a short list of verified recipients, which matters for alerts (section 8, question 1).

### Meta facts this proposal relies on (re-read on 2026-10-02)

- **The 24-hour customer service window.** It opens when a WhatsApp user messages the business and resets on each new guest message.
  Inside it, non-template (free-form) messages are free; utility templates delivered inside it are free too. Outside it, a template is the only
  message type that can be sent, and it is charged by category (marketing, utility, authentication) and recipient country.
  Source: [Meta, WhatsApp Business Platform pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md).
- **Coexistence.** One number can be used in the WhatsApp Business app and on the Cloud API at the same time.
  Source: [Meta, onboarding WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md).
  - Needs Business app version 2.24.17 or higher, and onboarding through **Embedded Signup by a Solution Partner or Tech Provider**.
  - Replies typed in the app arrive at our webhook as `smb_message_echoes`.
  - Throughput is fixed at 20 messages per second.
  - These stop working: group sync, disappearing messages in 1:1 chats, view-once messages, live location, broadcast lists.
  - Messages the business sends from the app stay free.
  - Messages from the last 180 days (about 6 months) can sync.

## 2. Decision, in phases

Three phases, each useful alone. Phase 0 is wording only.

### Phase 0: fix the promise (wording only, now)

Until Phase A ships, the hand-off texts should not promise a reply "here" unless someone really watches `/handoff`. Propose the wording: say a person will
reply, give the front-desk hours in every variant (including `not_booking`), and avoid "here". The texts live in `ai/` (a mirror of the team repo), so this
goes as a PR on `TechNextSG/tn-casa-quotation-estimator`, not as an edit here. **No change is made by this ADR.**

### Phase A: notify (small, inside this repository)

- On every `pause`, send one alert to the **on-duty staff** WhatsApp numbers with a **utility template** (for example `casa_handoff_alert`). It carries:
  the reason label from `REASON_LABELS`, the masked guest number, the guest's last line (`PausedThread.context`), and a link to `/handoff`.
- **Fallback channel: email.** For staff who are not on WhatsApp, or when a send fails.
- **Remind once** if nobody has acted on the thread within N minutes (proposed start: 15).
- **Respect desk hours.** Outside 08:00-21:00 Manila the alert is queued for the morning, **unless** the reason is `complaint_or_cancel` or `turn_failed`, which go out at once.
- **Staff numbers and email live in settings** (the KV settings store now, Postgres after the port). They are never in code or in logs.
- **Staff opt in** to receiving these messages.

### Phase B: reply from `/handoff`

- A **compose box per thread**, on a mobile-first page, so a staff member goes from the alert link straight to a reply.
- The BFF sends through the existing Graph API sender (`createWhatsAppSender`) **under `withPhoneLock`** (`bff/src/store/conversationStore.ts:44`) so a staff send cannot interleave with a guest turn.
- The message is appended to the history as role `staff` (or as `assistant` with an author field), so the bot, when it takes the thread back, sees what a person said.
- The thread **stays paused** until staff press "Hand back to bot" (today's `resume`).
- **The 24-hour rule.** The page shows the time left in the guest's window. When the window is closed, free text is disabled and only an approved
  follow-up template can be sent. The code already knows this case: Meta error 131047 is translated for the studio's send (`meta.ts:227-228`).
- Writes are guarded by the existing `staffSession` and `staffWriter` (`handoff.ts:31-33`, `:39-41`).
- **Claim a thread** (who is handling it) so two staff do not both answer.

### Phase C: Coexistence (preferred long term; depends on the number decision)

Staff answer in the WhatsApp Business app they already know.

- Handle the `smb_message_echoes` webhook. A message typed by a person **auto-pauses the bot** for that phone (new reason `staff_replied`) and is appended to the history. Today the parser drops everything that is not a guest text (`meta.ts:248-254`), so this is new code.
- Needs Embedded Signup through a **Solution Partner or Tech Provider**. Whether TechNext is one, or goes through a BSP, is an open question.
- Messages from the app stay free; the cost of Coexistence is the list of features that stop working (section 1).
- **Phase B stays** as the fallback for threads the app cannot reach.

## 3. Data model

New fields on the thread, all optional so old records still load:

| Field | Purpose |
|---|---|
| `claimedBy` | which staff member is handling the thread |
| `notifiedAt` | when the alert went out, and when the reminder did |
| `lastGuestAt` | when the guest last wrote, to compute the 24-hour window |
| a staff message role | so the history records who said what |

Today the pause record is `PausedThread` (`bff/src/store/conversationStore.ts:116-132`: `reason`, `since`, `toldAt`, `missingFields`, `context`) and the
history entry is `ThreadEntry` (`conversationStore.ts:161-170`). Neither has these fields. They live in KV (Upstash Redis) now and move to
Postgres with the port to the team repo.

## 4. Alternatives considered

- **A shared inbox such as Chatwoot**, as a WhatsApp Cloud inbox with an agent bot. It solves notify and reply in one product, but adds a system to host
  and moves the webhook away from our BFF. Kept as an option if the resort wants a full CRM.
- **Telegram or Viber alerts.** Viber is common in the Philippines, but each is one more app for staff to install and watch.
- **Email only.** Rejected: too slow for a guest who is waiting on WhatsApp.

## 5. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Template approval time and cost | A utility template sent to a staff number is business-initiated, so it is outside any window and is charged | Start with a short template; count alerts per day; the budget is a decision (section 8) |
| Staff numbers are personal data | Phone numbers and emails in settings | Stored in settings only, masked in logs, opt-in, deleted on request |
| Two people reply at once | The guest gets two answers | The claim in Phase B |
| A missed alert at night | The guest waits until morning | Desk-hours wording in the guest texts; morning queue; urgent reasons go out at once |
| Reply outside the 24-hour window | Meta refuses a free-form message | The page shows the time left and switches to a template (Phase B) |
| Coexistence limits | 20 messages per second; no groups or broadcast lists; needs a Solution Partner or Tech Provider | Keep Phase B; decide the number first |
| The test number | It only reaches a few verified recipients, so alerts cannot reach everyone | Section 8, question 1 comes first |

## 6. What does not change

The bot's decision to hand over, the reasons and their labels, the guest-facing wording (until the Phase 0 PR), `resume` and `reset`, and the rule that the
bot never quotes a price.

## 7. Phasing and order

Phase 0 can happen any time. Phase A needs the number decision (so alerts can reach staff) and an approved template. Phase B needs Phase A's data fields.
Phase C needs the number decision and a Solution Partner or Tech Provider. ADR-009 (LangGraph `interrupt()`) builds on Phase B's reply route, so it waits.

## 8. Open questions for the Lead / Anthony / resort

1. **Which number goes to production?** The resort's existing WhatsApp (through Coexistence), a new number on the Cloud API, or the current Meta test number? The test number only reaches a few verified recipients.
2. **Who is on duty, at what hours, and who receives the alerts?** (The website says the front desk is open until 21:00; the resort has not confirmed it.)
3. **Is TechNext a Tech Provider or Solution Partner, or do we use a BSP?** Phase C depends on it.
4. **Should the reply box live in our `/handoff` or in the team's app after the port?**
5. **Budget for template messages.**

## 9. References checked on 2026-10-02

| Reference | Where |
|---|---|
| The four `pause` calls | `bff/src/channels/whatsapp/turn.ts:228`, `:256`, `:284`, `:384` |
| `/handoff` list, resume, reset | `bff/src/routes/handoff.ts:22`, `:30`, `:38` |
| Staff guards on the routes | `bff/src/routes/handoff.ts:31-33`, `:39-41` |
| Reason labels | `bff/src/views/handoffPage.ts:22-34` |
| Resume and reset forms | `bff/src/views/handoffPage.ts:69-70` |
| Hand-off promises to the guest | `ai/src/application/questions.ts:1033-1049` |
| Graph API sender | `bff/src/channels/whatsapp/meta.ts:287` |
| Closed-window error (131047) | `bff/src/channels/whatsapp/meta.ts:227-228` |
| Test-list error (131030) | `bff/src/channels/whatsapp/meta.ts:223-224` |
| Webhook parser drops non-text | `bff/src/channels/whatsapp/meta.ts:248-254` |
| Pause record | `bff/src/store/conversationStore.ts:116-132` |
| Thread entry | `bff/src/store/conversationStore.ts:161-170` |
| Phone lock | `bff/src/store/conversationStore.ts:44` |
| Meta pricing and the 24-hour window | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md |
| Meta Coexistence onboarding | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md |
