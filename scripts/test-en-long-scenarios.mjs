import { converse } from "../packages/extractor/src/converse.js";
import { createProviderFromEnv } from "../packages/extractor/src/providerFromEnv.js";

const scenarios = [
  {
    id: "EN-LONG-01",
    title: "International UW Photography Dive Group (Flight SQ912, 6 Divers, 3 Rooms)",
    text: `Dear Casa Escondida Reservations Team,

Warm greetings from Singapore! My name is Dr. Christopher Vance. Our dive club of 6 adults is organizing a macro photography dive trip to Anilao next month.

We are flying into Manila NAIA Terminal 3 on Singapore Airlines flight SQ912, arriving around 11:30 AM on Friday, November 13th, 2026. We would like to stay for 4 nights, checking out on Tuesday, November 17th.

Our requirements:
1. Accommodation: 3 Twin-sharing rooms for the 6 of us.
2. Meal package: Full board (breakfast, lunch, dinner) starting from dinner on arrival day.
3. Diving: All 6 of us are Advanced Open Water divers. We want to do 3 boat dives per day on Nov 14, 15, and 16.
4. Transfers: Please arrange a private roundtrip van transfer for 6 passengers with dive bags between NAIA T3 and the resort.

Could you please confirm room and boat availability and share the total package estimate?

Warm regards,
Dr. Christopher Vance
WhatsApp: +65 9123 4567`,
  },
  {
    id: "EN-LONG-02",
    title: "Family Vacation with Divers & Non-Divers (Self-Driving from Makati, 2 Rooms)",
    text: `Good day Casa Escondida! 

I'm writing to enquire about booking a 3-night family weekend stay arriving Friday, December 4th, 2026, checking out Monday, December 7th. 

We are a family of 5: myself and my husband (both certified divers), my mother (who just wants to relax and read by the ocean), and our two kids aged 8 and 11 who love snorkeling. We would need 2 rooms: one Deluxe Ocean View room with a king bed for us + rollaway bed, and one Twin room for grandma and the kids. 

We would like the full board meal package so we do not have to drive around for food. Only my husband and I will be doing boat diving (2 dives each on Saturday Dec 5 and Sunday Dec 6). We will be driving down in our own 7-seater SUV from Makati, so we do not need an airport transfer — just please ensure you have secure parking space for our car.

Thank you and looking forward to your quotation!

Best,
Marianne Hastings
Mobile: +63 917 555 4321`,
  },
  {
    id: "EN-LONG-03",
    title: "Corporate Retreat with Day Visitors vs Overnight Stayers Trap",
    text: `Hi Casa Escondida team, good afternoon! 

This is Atty. Beatrice Gomez from Taguig, Manila. Our legal department is planning a weekend planning session in Anilao, checking in on Saturday, December 12th, 2026 for 2 nights, checking out Monday, December 14th.

Please note: we will have 10 people attending the Saturday seaside lunch and meeting, but ONLY 4 people are staying overnight for the 2 nights! Therefore, we only need 2 rooms (twin beds) for the 4 staying guests.

For the 4 overnight guests, we would like the full board meal arrangement. We are driving our own company vans from BGC, so no airport shuttle is required. We will not be doing any scuba diving on this trip, just kayaking and swimming.

Kindly send over the quotation for the 4 staying guests and the 2 rooms.

Warm regards,
Atty. Beatrice Gomez
Contact: +63 920 123 9876`,
  },
  {
    id: "EN-LONG-04",
    title: "PADI Open Water Course Inquiry (Beginners + One-Way Makati Transfer)",
    text: `Hello Casa Escondida Dive Resort,

My friend and I are looking to get PADI Open Water certified before our vacation to Palawan next year! 

We are 2 beginners wanting to arrive on Thursday, November 5th, 2026 for 3 nights, checking out Sunday, November 8th. We will need 1 twin room and full board meals. 

We want to enroll in the 3-day Open Water certification course with instructor and all gear rental included (diving starts Nov 5 afternoon through Nov 7). Since we do not own a car in Manila, could you arrange a one-way private van pickup from our hotel in Makati (near Greenbelt) to Anilao on Nov 5th morning? For the return trip on Sunday, we plan to take the public bus back to Buendia, so we only need a one-way transfer.

Could you let us know availability and provide a full cost breakdown?

Thanks so much,
Sarah Jenkins
WhatsApp: +1 415 555 2671`,
  },
  {
    id: "EN-LONG-05",
    title: "Solo Underwater Macro Photographer (Flight CX901, 5 Nights, 1 Room)",
    text: `Hi Casa Escondida,

My name is Jonathan Lee, an underwater macro photographer from Hong Kong. I am planning a solo photography expedition to Anilao from Wednesday, October 21st, 2026 to Monday, October 26th (5 nights).

I will be flying into Manila on Cathay Pacific flight CX901 landing at 11:00 AM on Oct 21. I need a private roundtrip van transfer between NAIA Terminal 3 and Casa Escondida.

I need 1 private room (standard or deluxe) with full board meals. I plan to do 3 to 4 boat dives every day from Oct 22 to Oct 25, focusing on muck diving and nudibranchs. I will bring my own camera housing and strobe gear.

Please let me know your boat availability, private dive guide rates, and total package price for 1 guest, 5 nights.

Cheers,
Jonathan Lee
WhatsApp: +852 9876 1234`,
  },
  {
    id: "EN-LONG-06",
    title: "Casual WhatsApp Message with Flight Number, Dive Count Traps & 2-Night Stay",
    text: `Hey guys! Hope you're doing well. Was recommended by my buddy Dave who logged over 75 dives at your resort last year! 

Me and my partner want to visit Anilao for a quick dive weekend. Flight PR2812 arrives at NAIA at 1:30 PM on Friday, November 20th, 2026, so we want to check in Nov 20 for 2 nights, checking out Sunday, Nov 22nd. 

We are 2 guests and need 1 queen room. Full board please so we can eat right at the resort. Both of us are certified divers and want to do 2 boat dives on Saturday, Nov 21st. We also need your van to pick us up from NAIA Terminal 2 on Friday and bring us back on Sunday afternoon after lunch. 

Name is Marcus Brody. Let me know if you have a room open!`,
  },
];

async function run() {
  const provider = createProviderFromEnv();
  console.log(`Using Provider: ${provider.id}\n`);

  for (const s of scenarios) {
    console.log(`================================================================================`);
    console.log(`[${s.id}] ${s.title}`);
    console.log(`Length: ${s.text.length} chars`);
    console.log(`--------------------------------------------------------------------------------`);
    const outcome = await converse({ message: s.text, channel: "whatsapp" }, provider);
    console.log("BOT REPLY:\n" + outcome.reply);
    console.log(`\nREPLY KIND: ${outcome.replyKind} | DONE: ${outcome.done}`);
    console.log("EXTRACTED TRIP SUMMARY:");
    console.log({
      checkIn: outcome.trip.checkIn?.value,
      checkOut: outcome.trip.checkOut?.value,
      nights: outcome.trip.nights?.value,
      guests: outcome.trip.guests?.value,
      rooms: outcome.trip.rooms?.value,
      meals: outcome.trip.meals?.value,
      transport: outcome.trip.transport?.value,
      transportType: outcome.trip.transportType?.value,
      diver: outcome.trip.diver?.value,
      diveFrom: outcome.trip.diveFrom?.value,
      diveTo: outcome.trip.diveTo?.value,
      contactName: outcome.trip.contactName?.value,
    });
    console.log("\n");
  }
}

run().catch(console.error);
