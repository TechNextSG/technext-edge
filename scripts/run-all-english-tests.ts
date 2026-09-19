import { createProviderFromEnv, converse, type ConversationTurn } from "../packages/extractor/src/index.js";
import { wantsHuman } from "../packages/extractor/src/questions.js";

interface TestScenario {
  id: string;
  category: string;
  title: string;
  dialogue: Array<{
    guest: string;
    description: string;
    check: (conv: any) => { pass: boolean; details: string };
  }>;
}

const TEST_MATRIX: TestScenario[] = [
  // 1. Solo Travelers
  {
    id: "TC-01",
    category: "Solo Travelers",
    title: "Solo diver with full board and airport transfer",
    dialogue: [
      {
        guest: "Hi! I'm Mark. Solo diver looking to stay for 3 nights starting Oct 28th. Need diving, full board, and airport transfer from NAIA.",
        description: "Turn 1: Extract dates, name, diving, transport, ask guest count if needed",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-10-28" && conv.trip.nights?.value === 3 && conv.trip.contactName?.value === "Mark" && conv.trip.diver?.value === true && conv.trip.transport?.value === true,
          details: `checkIn=${conv.trip.checkIn?.value}, nights=${conv.trip.nights?.value}, name=${conv.trip.contactName?.value}, diver=${conv.trip.diver?.value}, transport=${conv.trip.transport?.value}`,
        }),
      },
      {
        guest: "Just 1 person, and I want to dive on Oct 29 and Oct 30.",
        description: "Turn 2: Settle 1 guest and dive window within stay",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 1 && conv.trip.diveFrom?.value === "2026-10-29" && conv.trip.diveTo?.value === "2026-10-30" && conv.done === true,
          details: `guests=${conv.trip.guests?.value}, diveFrom=${conv.trip.diveFrom?.value}, diveTo=${conv.trip.diveTo?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "TC-02",
    category: "Solo Travelers",
    title: "Solo non-diver with own car ('just me', no diving, own car)",
    dialogue: [
      {
        guest: "Hello, it's just me coming for 2 nights starting Nov 5th. No diving, I have my own car so no transfer needed. Name is Sarah Jenkins.",
        description: "Turn 1: Zero-question complete enquiry",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-11-05" && conv.trip.nights?.value === 2 && conv.trip.guests?.value === 1 && conv.trip.diver?.value === false && conv.trip.transport?.value === false && conv.trip.contactName?.value === "Sarah Jenkins" && conv.done === true,
          details: `checkIn=${conv.trip.checkIn?.value}, nights=${conv.trip.nights?.value}, guests=${conv.trip.guests?.value}, diver=${conv.trip.diver?.value}, transport=${conv.trip.transport?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 2. Couples
  {
    id: "TC-03",
    category: "Couples & Honeymooners",
    title: "Couple booking with explicit rooms ('2 pax, 1 room')",
    dialogue: [
      {
        guest: "Hi Casa Escondida! Booking for 2 pax, 1 room, 3 nights starting Nov 12th. We have our own vehicle. Name: David Miller.",
        description: "Turn 1: Extract 2 guests, 1 room, 3 nights, own car -> ask diving",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-11-12" && conv.trip.nights?.value === 3 && conv.trip.guests?.value === 2 && conv.trip.rooms?.value === 1 && conv.trip.transport?.value === false,
          details: `checkIn=${conv.trip.checkIn?.value}, nights=${conv.trip.nights?.value}, guests=${conv.trip.guests?.value}, rooms=${conv.trip.rooms?.value}, transport=${conv.trip.transport?.value}`,
        }),
      },
      {
        guest: "Yes, we want to dive on Nov 13th.",
        description: "Turn 2: Confirm diving on Nov 13",
        check: (conv) => ({
          pass: conv.trip.diver?.value === true && conv.trip.diveFrom?.value === "2026-11-13" && conv.done === true,
          details: `diver=${conv.trip.diver?.value}, diveFrom=${conv.trip.diveFrom?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "TC-04",
    category: "Couples & Honeymooners",
    title: "Couple with date range ('14 Nov to 18 Nov')",
    dialogue: [
      {
        guest: "Hello, my wife and I (2 guests) would like to stay from 14 Nov to 18 Nov. We want full board and roundtrip airport transfer. I'm James.",
        description: "Turn 1: Extract dates, 2 guests, full board, transfer",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-11-14" && conv.trip.guests?.value === 2 && conv.trip.meals?.value === "full_board" && conv.trip.transport?.value === true,
          details: `checkIn=${conv.trip.checkIn?.value}, guests=${conv.trip.guests?.value}, meals=${conv.trip.meals?.value}, transport=${conv.trip.transport?.value}`,
        }),
      },
      {
        guest: "That's 4 nights, and no diving for us, just relaxing.",
        description: "Turn 2: Clarify 4 nights and no diving",
        check: (conv) => ({
          pass: conv.trip.nights?.value === 4 && conv.trip.diver?.value === false && conv.done === true,
          details: `nights=${conv.trip.nights?.value}, diver=${conv.trip.diver?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 3. Families & Groups
  {
    id: "TC-05",
    category: "Families & Groups",
    title: "Group vs Staying trap (6 in group, but only 3 staying)",
    dialogue: [
      {
        guest: "Our group has 6 people but only 3 are staying for 2 nights starting Oct 10th. My name is Michael.",
        description: "Turn 1: Disambiguate group vs staying (must NOT falsely take 6)",
        check: (conv) => ({
          pass: (conv.trip.guests?.state === "missing" || conv.trip.guests?.value === 3) && conv.trip.checkIn?.value === "2026-10-10" && conv.trip.nights?.value === 2 && conv.trip.contactName?.value === "Michael",
          details: `guests=${conv.trip.guests?.value} (state: ${conv.trip.guests?.state}), nights=${conv.trip.nights?.value}, checkIn=${conv.trip.checkIn?.value}`,
        }),
      },
      {
        guest: "3 guests staying, and yes we'd love to go diving!",
        description: "Turn 2: Confirm 3 guests staying, request diving",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 3 && conv.trip.diver?.value === true,
          details: `guests=${conv.trip.guests?.value}, diver=${conv.trip.diver?.value}`,
        }),
      },
      {
        guest: "Oct 11 to Oct 12",
        description: "Turn 3: Settle dive window within stay",
        check: (conv) => ({
          pass: conv.trip.diveFrom?.value === "2026-10-11" && conv.trip.diveTo?.value === "2026-10-12" && conv.done === true,
          details: `diveFrom=${conv.trip.diveFrom?.value}, diveTo=${conv.trip.diveTo?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "TC-06",
    category: "Families & Groups",
    title: "Family with kids & 2 rooms ('2 adults, 2 kids, 2 rooms')",
    dialogue: [
      {
        guest: "Hi, family of 4 (2 adults and 2 kids) staying 3 nights from Dec 20th. We need 2 rooms, full board, and airport pickup. Contact: Robert Taylor.",
        description: "Turn 1: Extract 4 guests, 2 rooms, 3 nights, full board, transfer",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-12-20" && conv.trip.nights?.value === 3 && conv.trip.guests?.value === 4 && conv.trip.rooms?.value === 2 && conv.trip.meals?.value === "full_board" && conv.trip.transport?.value === true && conv.trip.contactName?.value === "Robert Taylor",
          details: `checkIn=${conv.trip.checkIn?.value}, guests=${conv.trip.guests?.value}, rooms=${conv.trip.rooms?.value}, meals=${conv.trip.meals?.value}, transport=${conv.trip.transport?.value}`,
        }),
      },
      {
        guest: "No diving, kids are too young. And return transfer please.",
        description: "Turn 2: No diving & return transfer -> complete booking",
        check: (conv) => ({
          pass: conv.trip.diver?.value === false && conv.trip.transportType?.value === "roundtrip" && conv.done === true,
          details: `diver=${conv.trip.diver?.value}, transportType=${conv.trip.transportType?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 4. Diving Packages
  {
    id: "TC-07",
    category: "Diving Packages",
    title: "PADI Open Water certification course inquiry",
    dialogue: [
      {
        guest: "Hi! 2 of us want to take the PADI Open Water course, arriving Nov 10 for 4 nights. Need full board and airport pickup. Name: Daniel.",
        description: "Turn 1: Extract 2 guests, 4 nights, diver=true, full board, pickup",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-11-10" && conv.trip.nights?.value === 4 && conv.trip.guests?.value === 2 && conv.trip.diver?.value === true && conv.trip.meals?.value === "full_board" && conv.trip.transport?.value === true && conv.trip.contactName?.value === "Daniel",
          details: `checkIn=${conv.trip.checkIn?.value}, guests=${conv.trip.guests?.value}, diver=${conv.trip.diver?.value}, transport=${conv.trip.transport?.value}`,
        }),
      },
      {
        guest: "Course runs from Nov 11 to Nov 13, and one-way transfer please.",
        description: "Turn 2: Settle course window 11–13 Nov & one-way transfer -> complete booking",
        check: (conv) => ({
          pass: conv.trip.diveFrom?.value === "2026-11-11" && conv.trip.diveTo?.value === "2026-11-13" && conv.trip.transportType?.value === "oneway" && conv.done === true,
          details: `diveFrom=${conv.trip.diveFrom?.value}, diveTo=${conv.trip.diveTo?.value}, transportType=${conv.trip.transportType?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "TC-08",
    category: "Diving Packages",
    title: "Dives logged trap ('50 dives logged each')",
    dialogue: [
      {
        guest: "Hi, 3 certified divers with 50 dives logged each coming for 4 nights starting Nov 8th. Transfer needed. Name: Kevin. No extra courses.",
        description: "Turn 1: Do NOT confuse '50 dives' with guests or nights",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 3 && conv.trip.nights?.value === 4 && conv.trip.checkIn?.value === "2026-11-08" && conv.trip.diver?.value === true && conv.trip.contactName?.value === "Kevin",
          details: `guests=${conv.trip.guests?.value}, nights=${conv.trip.nights?.value}, diver=${conv.trip.diver?.value}, name=${conv.trip.contactName?.value}`,
        }),
      },
      {
        guest: "Diving Nov 9 to Nov 11, and roundtrip transfer please.",
        description: "Turn 2: Settle dive window & roundtrip transfer",
        check: (conv) => ({
          pass: conv.trip.diveFrom?.value === "2026-11-09" && conv.trip.diveTo?.value === "2026-11-11" && conv.trip.transportType?.value === "roundtrip" && conv.done === true,
          details: `diveFrom=${conv.trip.diveFrom?.value}, diveTo=${conv.trip.diveTo?.value}, transportType=${conv.trip.transportType?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 5. Transport Negation
  {
    id: "TC-09",
    category: "Transport Negation",
    title: "Own car negation ('we have our own car so no pickup needed')",
    dialogue: [
      {
        guest: "Hi, 2 guests staying 2 nights starting Dec 5th. We have our own car so no pickup needed. Name: Emily.",
        description: "Turn 1: transport must be strictly false",
        check: (conv) => ({
          pass: conv.trip.transport?.value === false && conv.trip.checkIn?.value === "2026-12-05" && conv.trip.nights?.value === 2 && conv.trip.guests?.value === 2,
          details: `transport=${conv.trip.transport?.value} (state: ${conv.trip.transport?.state}), checkIn=${conv.trip.checkIn?.value}, guests=${conv.trip.guests?.value}`,
        }),
      },
      {
        guest: "No diving, thanks!",
        description: "Turn 2: Complete booking without diving",
        check: (conv) => ({
          pass: conv.trip.diver?.value === false && conv.done === true,
          details: `diver=${conv.trip.diver?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "TC-10",
    category: "Transport Negation",
    title: "Driving ourselves negation ('driving ourselves from Makati')",
    dialogue: [
      {
        guest: "Booking for 3 people, 3 nights from Nov 20th. We are driving ourselves from Makati. Name: Brian. No diving.",
        description: "Turn 1: Driving ourselves -> transport=false, complete booking",
        check: (conv) => ({
          pass: conv.trip.transport?.value === false && conv.trip.diver?.value === false && conv.trip.guests?.value === 3 && conv.trip.nights?.value === 3 && conv.trip.contactName?.value === "Brian" && conv.done === true,
          details: `transport=${conv.trip.transport?.value}, diver=${conv.trip.diver?.value}, guests=${conv.trip.guests?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 6. Mid-Conversation Modifications
  {
    id: "TC-11",
    category: "Mid-Chat Modifications",
    title: "Flight reschedule: check-in date and nights changed dynamically",
    dialogue: [
      {
        guest: "Hi, I'm Sarah! Booking for 2 people, 3 nights starting Nov 10th. No diving.",
        description: "Turn 1: Initial booking for Nov 10 (3 nights)",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-11-10" && conv.trip.nights?.value === 3 && conv.trip.diver?.value === false,
          details: `checkIn=${conv.trip.checkIn?.value}, nights=${conv.trip.nights?.value}`,
        }),
      },
      {
        guest: "Wait, sorry! Our flight changed. Can we change check-in to Dec 1st for 4 nights instead? Still 2 people, no diving.",
        description: "Turn 2: Dynamically update check-in to Dec 1st, nights to 4",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-12-01" && conv.trip.nights?.value === 4 && conv.trip.diver?.value === false && conv.done === true,
          details: `checkIn=${conv.trip.checkIn?.value}, nights=${conv.trip.nights?.value}, checkOut=${conv.trip.checkOut?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "TC-12",
    category: "Mid-Chat Modifications",
    title: "Guest count increase ('my brother is joining, so 3 guests total')",
    dialogue: [
      {
        guest: "Booking for 2 guests, check in Nov 15 for 2 nights. Name: John. No diving, no transfer.",
        description: "Turn 1: Initial booking for 2 guests",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 2 && conv.trip.checkIn?.value === "2026-11-15",
          details: `guests=${conv.trip.guests?.value}`,
        }),
      },
      {
        guest: "Actually my brother is joining us, so it will be 3 guests in total now.",
        description: "Turn 2: Update guests from 2 to 3",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 3 && conv.trip.checkIn?.value === "2026-11-15" && conv.done === true,
          details: `guests=${conv.trip.guests?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 7. Out-of-Stay Date Conflicts
  {
    id: "TC-13",
    category: "Out-of-Stay Date Conflicts",
    title: "Guest enters dive dates before check-in (Sep dates on Oct stay)",
    dialogue: [
      {
        guest: "Hi, I'm Tom. 2 guests for 2 nights starting Oct 10th, and yes we want to dive.",
        description: "Turn 1: Stay Oct 10–12, asks dive window with prompt showing stay range",
        check: (conv) => ({
          pass: conv.trip.diver?.value === true && conv.reply.includes("Oct 10 – 12"),
          details: `diver=${conv.trip.diver?.value}, prompt includes stay range: ${conv.reply.includes("Oct 10 – 12")}`,
        }),
      },
      {
        guest: "21 Sep to 29 Sep",
        description: "Turn 2: September dates rejected, bot repeats stay range",
        check: (conv) => ({
          pass: conv.trip.diveFrom?.state === "missing" && conv.reply.includes("Oct 10 – 12"),
          details: `diveFrom=${conv.trip.diveFrom?.state}, prompt maintains stay range: ${conv.reply.includes("Oct 10 – 12")}`,
        }),
      },
      {
        guest: "Oct 11 to Oct 12",
        description: "Turn 3: Valid stay dates accepted, summary produced",
        check: (conv) => ({
          pass: conv.trip.diveFrom?.value === "2026-10-11" && conv.trip.diveTo?.value === "2026-10-12" && conv.done === true,
          details: `diveFrom=${conv.trip.diveFrom?.value}, diveTo=${conv.trip.diveTo?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 8. B2B & Travel Agency
  {
    id: "TC-14",
    category: "B2B & Travel Agency",
    title: "Travel agency inquiry triggers guestType=agent (30% discount tier)",
    dialogue: [
      {
        guest: "Greetings from Pacific Waves Travel Agency. We wish to book 4 guests for 5 nights starting Dec 1st. Contact: Rachel. No transfer, no diving.",
        description: "Turn 1: Detect agency phrasing -> guestType: agent",
        check: (conv) => ({
          pass: conv.trip.guestType?.value === "agent" && conv.trip.guests?.value === 4 && conv.trip.nights?.value === 5 && conv.trip.contactName?.value?.includes("Rachel") && conv.done === true,
          details: `guestType=${conv.trip.guestType?.value}, guests=${conv.trip.guests?.value}, nights=${conv.trip.nights?.value}, name=${conv.trip.contactName?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 9. Casual & Slang
  {
    id: "TC-15",
    category: "Casual & Slang",
    title: "Short slang input ('2pax', 'yep', 'nah')",
    dialogue: [
      {
        guest: "2pax 2 nights next Friday. Ben.",
        description: "Turn 1: Extract 2 guests, 2 nights, name Ben",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 2 && conv.trip.nights?.value === 2 && conv.trip.contactName?.value === "Ben",
          details: `guests=${conv.trip.guests?.value}, nights=${conv.trip.nights?.value}, name=${conv.trip.contactName?.value}`,
        }),
      },
      {
        guest: "nah no diving, yep airport pickup needed",
        description: "Turn 2: Slang 'nah' -> diver=false, 'yep' -> transport=true",
        check: (conv) => ({
          pass: conv.trip.diver?.value === false && conv.trip.transport?.value === true,
          details: `diver=${conv.trip.diver?.value}, transport=${conv.trip.transport?.value}`,
        }),
      },
      {
        guest: "roundtrip please",
        description: "Turn 3: Settle roundtrip transfer -> done",
        check: (conv) => ({
          pass: conv.trip.transportType?.value === "roundtrip" && conv.done === true,
          details: `transportType=${conv.trip.transportType?.value}, done=${conv.done}`,
        }),
      },
    ],
  },

  // 10. Phone Number Traps
  {
    id: "TC-16",
    category: "Phone Number Traps",
    title: "International phone number directly before room & guest counts",
    dialogue: [
      {
        guest: "Hello, I'm calling from +1 (555) 019-2834. We need 3 rooms for 6 guests from Nov 20 for 3 nights. Name: George. No transfer, no diving.",
        description: "Turn 1: Do NOT extract phone prefixes as rooms/guests",
        check: (conv) => ({
          pass: conv.trip.rooms?.value === 3 && conv.trip.guests?.value === 6 && conv.trip.nights?.value === 3 && conv.trip.checkIn?.value === "2026-11-20" && conv.trip.contactName?.value === "George" && conv.done === true,
          details: `rooms=${conv.trip.rooms?.value}, guests=${conv.trip.guests?.value}, nights=${conv.trip.nights?.value}, checkIn=${conv.trip.checkIn?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
];

async function runTestMatrix() {
  console.log("================================================================================");
  console.log("           LIVE EXECUTION: 16 COMPREHENSIVE ENGLISH SCENARIOS                   ");
  console.log("================================================================================\n");

  const provider = createProviderFromEnv();
  console.log(`Provider in use: ${provider.id}\n`);

  let totalTurns = 0;
  let passedTurns = 0;
  let passedScenarios = 0;

  for (const tc of TEST_MATRIX) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[${tc.id}] [${tc.category}] ${tc.title}`);
    console.log(`--------------------------------------------------------------------------------`);

    const history: ConversationTurn[] = [];
    let scenarioSuccess = true;

    for (let i = 0; i < tc.dialogue.length; i++) {
      totalTurns++;
      const step = tc.dialogue[i];
      console.log(`\n  💬 Turn ${i + 1} | Guest: "${step.guest}"`);

      history.push({ role: "guest", text: step.guest });
      const outcome = await converse(history, provider);
      history.push({ role: "assistant", text: outcome.reply });

      const result = step.check(outcome);
      if (result.pass) {
        passedTurns++;
        console.log(`  ✅ PASS: ${step.description}`);
        console.log(`     Data: ${result.details}`);
      } else {
        scenarioSuccess = false;
        console.log(`  ❌ FAIL: ${step.description}`);
        console.log(`     Data: ${result.details}`);
      }

      console.log(`  🤖 Bot:\n${outcome.reply.split("\n").map((l: string) => "     " + l).join("\n")}`);
      await new Promise((r) => setTimeout(r, 1200));
    }

    if (scenarioSuccess) passedScenarios++;
  }

  console.log("\n================================================================================");
  console.log("                            FINAL TEST SUMMARY                                  ");
  console.log("================================================================================");
  console.log(`Total Scenarios:     ${TEST_MATRIX.length}`);
  console.log(`Scenarios Passed:    ${passedScenarios} / ${TEST_MATRIX.length} (${Math.round((passedScenarios / TEST_MATRIX.length) * 100)}%)`);
  console.log(`Total Dialog Turns:  ${totalTurns}`);
  console.log(`Turns Passed:        ${passedTurns} / ${totalTurns} (${Math.round((passedTurns / totalTurns) * 100)}%)`);
  console.log("================================================================================\n");
}

runTestMatrix().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
