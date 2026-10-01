/* Sample enquiries for the extraction PoC.
 *
 * THESE ARE MADE UP. I wrote both the questions and, implicitly, what I expect back —
 * so any hit rate you read off them measures nothing except that the harness runs.
 * A real number needs ~30 de-identified enquiries that actual guests sent.
 * Until then these exist to exercise the UI and to see whether the model copes at all.
 *
 * Each entry is chosen to break a different thing: a full agent booking, a bare
 * one-liner, a message that corrects itself, dates with no year, a language switch.
 */
export const SYNTHETIC_ENQUIRIES = [
  {
    id: 'agent-full',
    label: 'Singapore agent — complete',
    breaks: 'the easy case: almost every field is stated outright',
    text: `Hi Sky,

We have a group of 7 divers coming from Singapore, arriving 12 Oct and leaving 15 Oct.
2 of them don't dive, they'll just relax at the resort. We'd like 2 deluxe rooms and
1 standard twin. Full board for everyone please.

We need airport pickup from Manila for the whole group, and a drop-off back on the 15th.

One of our divers, Mei, is celebrating her 100th dive on the 14th — a small cake would
be lovely if you can manage it.

Best,
John Tan
Blue Reef Divers Pte Ltd`
  },
  {
    id: 'retail-direct',
    label: 'Direct retail enquiry',
    breaks: 'no agency, no room type, no mention of board',
    text: `Hello! My partner and I want to come diving for 3 nights starting Nov 20.
We're both Open Water certified. Do you have availability? We'll drive ourselves from
Manila so no transfer needed. Thanks!`
  },
  {
    id: 'sparse',
    label: 'Almost everything missing',
    breaks: 'only a month, no dates, no headcount — most fields must come back missing',
    text: `Hi, do you have rooms available in October? Looking for a dive package.`
  },
  {
    id: 'vietnamese',
    label: 'Vietnamese',
    breaks: 'another language, Vietnamese date style, "khách" as the unit',
    text: `Chào shop, bên mình có nhóm 12 khách muốn đi lặn 2 ngày 1 đêm, dự kiến ngày
5 tháng 12. Trong nhóm có 4 bạn chưa biết lặn, muốn học thử. Bên mình cần xe đón ở
sân bay Manila. Cho mình xin báo giá với ạ. Mình là Trang, công ty du lịch Biển Xanh.`
  },
  {
    id: 'course',
    label: 'With a course',
    breaks: 'course + student count; courses are not on the Odoo web form',
    text: `Hi there — 4 of us, Jan 8 to Jan 12. Two of us are already AOW certified and
just want fun dives. The other two have never dived before and want to do the full
Open Water course while they're there. Is 4 days enough for the course? Standard rooms
are fine, we're not fussy. No airport transfer, we have a van.`
  },
  {
    id: 'self-correcting',
    label: 'Self-correcting',
    breaks: 'a figure given twice, the later one overrides the earlier',
    text: `Hi! Booking for 4 people, checking in on the 3rd of March for 4 nights.

Actually sorry — make that 5 people, my brother in law just decided to join. He doesn't
dive though. So 4 divers, 5 guests total. Two twin rooms and one single if possible.`
  },
  {
    id: 'vague-dates',
    label: 'Vague dates',
    breaks: '"next weekend", "the following Monday" — no absolute date anywhere',
    text: `Hey, are you open next weekend? Three of us would like to come down Friday
evening and dive Saturday and Sunday, heading back the following Monday morning.
All certified. Do you do nitrox?`
  },
  {
    id: 'children',
    label: 'With children',
    breaks: 'Odoo has child age bands but Sky\'s engine has no child pricing',
    text: `Good afternoon. Family of 5 — myself, my wife and three children aged 4, 7
and 11. We'd like to come 22-26 December. My wife and I dive, the kids don't (though
the 11 year old might like to try something in the pool?). One family room or two
connecting rooms, whatever works. Full board definitely, and we'll need transport
from the airport — we land at 3pm on the 22nd.`
  },
  {
    id: 'rambling',
    label: 'Long and rambling',
    breaks: 'many words, few facts; tempts the model to invent something',
    text: `Hi Casa Escondida team!

I hope this email finds you well. I've been following your resort on Instagram for
absolutely ages and the macro photography coming out of Anilao is just incredible —
those hairy frogfish shots! Our little club back home has been talking about doing a
trip to the Philippines for literally three years now and I think we're finally going
to pull the trigger.

There'd be about eight or nine of us, all pretty experienced, most of us shooting
either compact or full mirrorless setups. We're not fussed about luxury, we just want
good diving and somewhere to charge batteries and rinse gear properly.

Timing is the tricky bit — a few of us can only do school holidays. We're loosely
looking at some point in the first half of next year. Muck diving is the priority,
we're not really interested in the reef stuff.

Could you send over what a week would look like? And do you have camera tables and
a dedicated rinse tank? That's honestly a dealbreaker for a couple of our members.

Cheers,
Dave`
  },
  {
    id: 'almost-nothing',
    label: 'Nearly nothing',
    breaks: 'the honesty test: done right, most fields must be missing',
    text: `how much for diving?`
  }
];
