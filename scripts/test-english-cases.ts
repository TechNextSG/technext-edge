import { createProviderFromEnv, converse, extract } from "../packages/extractor/src/index.js";

const ENGLISH_SCENARIOS = [
  {
    category: "Solo Travelers & Divers",
    cases: [
      {
        name: "Solo Diver (explicit 1 guest)",
        text: "Hi! I'm Mark. Solo diver looking to stay for 3 nights starting Oct 28th. Need diving, full board, and airport transfer.",
        expect: { guests: 1, nights: 3, diver: true, transport: true, meals: "full_board", contactName: "Mark" },
      },
      {
        name: "Solo Guest ('just me')",
        text: "Hello, it's just me coming for 2 nights starting Nov 5th. No diving, I have my own car. Name is Sarah.",
        expect: { guests: 1, nights: 2, diver: false, transport: false, contactName: "Sarah" },
      },
    ],
  },
  {
    category: "Couples & Honeymooners",
    cases: [
      {
        name: "Couple / 2 pax with rooms specified",
        text: "Hi Casa Escondida! Booking for 2 pax, 1 deluxe room, 3 nights starting Nov 12th. We have our own vehicle. Name: David Miller.",
        expect: { guests: 2, rooms: 1, nights: 3, transport: false, contactName: "David Miller" },
      },
      {
        name: "Couple with date range (DD to DD Month)",
        text: "Hello, my wife and I (2 guests) would like to stay from 14 Nov to 18 Nov. We want full board and roundtrip airport transfer. I'm James.",
        expect: { guests: 2, nights: 4, meals: "full_board", transport: true, contactName: "James" },
      },
    ],
  },
  {
    category: "Groups & Traps (Phone / Dives Logged / Party vs Staying)",
    cases: [
      {
        name: "Phone number prefix trap",
        text: "My phone number is +1 555-019-2834. We are 4 divers staying 3 nights from Oct 15th. Call me, I'm Chris.",
        expect: { guests: 4, nights: 3, contactName: "Chris" },
      },
      {
        name: "Dives logged trap (50 dives logged each)",
        text: "Hi, 3 certified divers with 50 dives logged each coming for 4 nights starting Nov 8th. Transfer needed. Name: Kevin.",
        expect: { guests: 3, nights: 4, transport: true, contactName: "Kevin" },
      },
      {
        name: "Group vs staying count (6 people, 3 staying)",
        text: "Our group has 6 people but only 3 are staying for 2 nights starting Oct 10th. My name is Michael.",
        expect: { nights: 2, contactName: "Michael" }, // guests will either be 3 or asked cleanly
      },
    ],
  },
  {
    category: "Transport Negation ('own car', 'driving ourselves')",
    cases: [
      {
        name: "Own car negation",
        text: "Hi, 2 guests staying 2 nights starting Dec 5th. We have our own car so no pickup needed. Name: Emily.",
        expect: { guests: 2, nights: 2, transport: false, contactName: "Emily" },
      },
      {
        name: "Driving ourselves negation",
        text: "Booking for 3 people, 3 nights from Nov 20th. We are driving ourselves from Makati. Name: Brian.",
        expect: { guests: 3, nights: 3, transport: false, contactName: "Brian" },
      },
    ],
  },
  {
    category: "Travel Agency & B2B Inquiries",
    cases: [
      {
        name: "Travel Agency B2B Discount Detection",
        text: "Greetings from Pacific Waves Travel Agency. We wish to book 4 guests for 5 nights starting Dec 1st. Contact: Agent Rachel.",
        expect: { guestType: "agent", guests: 4, nights: 5, contactName: "Rachel" },
      },
    ],
  },
  {
    category: "Diving Course & Certification Packages",
    cases: [
      {
        name: "PADI Open Water Course Inquiry",
        text: "Hi, 2 of us want to take the PADI Open Water course, arriving Nov 10 for 4 nights. Need full board and airport pickup. Name: Daniel.",
        expect: { guests: 2, nights: 4, diver: true, meals: "full_board", transport: true, contactName: "Daniel" },
      },
      {
        name: "Fun diving every day",
        text: "3 certified rescue divers coming for 5 nights starting Nov 2, planning fun diving every day, we will arrange our own car. Name: Luke.",
        expect: { guests: 3, nights: 5, diver: true, transport: false, contactName: "Luke" },
      },
    ],
  },
];

async function run() {
  console.log("================================================================================");
  console.log("            COMPREHENSIVE ENGLISH SCENARIO TEST SUITE (EXTRACTOR)               ");
  console.log("================================================================================\n");

  const provider = createProviderFromEnv();
  console.log(`Provider: ${provider.id}\n`);

  let total = 0;
  let passed = 0;

  for (const cat of ENGLISH_SCENARIOS) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`📁 CATEGORY: ${cat.category}`);
    console.log(`--------------------------------------------------------------------------------`);

    for (const c of cat.cases) {
      total++;
      console.log(`\n  Scenario: "${c.name}"`);
      console.log(`  Input:    "${c.text}"`);

      const outcome = await extract(c.text, provider);
      const trip = outcome.trip;

      let casePassed = true;
      const issues: string[] = [];

      for (const [key, expectedVal] of Object.entries(c.expect)) {
        const actualVal = (trip as any)[key]?.value;
        const actualState = (trip as any)[key]?.state;

        if (expectedVal !== undefined && actualVal !== expectedVal) {
          // Special exception for guests when group is ambiguous
          if (key === "guests" && c.name.includes("Group vs staying")) {
            if (actualState === "missing" || actualVal === 3) {
              continue; // Safe!
            }
          }
          casePassed = false;
          issues.push(`${key}: expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)} (state: ${actualState})`);
        }
      }

      if (casePassed) {
        passed++;
        console.log(`  ✅ PASS`);
        console.log(`     Extracted: checkIn=${trip.checkIn?.value}, nights=${trip.nights?.value}, guests=${trip.guests?.value}, transport=${trip.transport?.value}, diver=${trip.diver?.value}, meals=${trip.meals?.value}, name=${trip.contactName?.value}`);
      } else {
        console.log(`  ❌ FAIL:`);
        for (const issue of issues) console.log(`     - ${issue}`);
      }
    }
  }

  console.log("\n================================================================================");
  console.log(`RESULT: ${passed} / ${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log("================================================================================\n");
}

run().catch(console.error);
