// Comprehensive Benchmark Suite for Casa Escondida Anilao Resort & PADI Center
// Evaluates real-world guest scenarios, PADI/DAN safety rules, staying vs day visitors,
// adults+children sums, self-driving transport negation, and B2B agent discounts.

import { converse, type ConversationTurn } from "../packages/extractor/src/converse.js";
import { createProviderFromEnv } from "../packages/extractor/src/providerFromEnv.js";

interface TestCase {
  id: string;
  category: string;
  title: string;
  dialogue: Array<{
    guest: string;
    description: string;
    check: (outcome: Awaited<ReturnType<typeof converse>>) => { pass: boolean; details: string };
  }>;
}

export const ANILAO_TEST_MATRIX: TestCase[] = [
  {
    id: "AN-01",
    category: "Day Visitors vs Staying Guests",
    title: "Party of 6 with only 3 staying overnight (others are day visitors)",
    dialogue: [
      {
        guest: "Hi! Our group has 6 people coming this Saturday, but only 3 are staying for 2 nights, the others are just day visitors. My name is Michael.",
        description: "Turn 1: Settle staying_guests=3 without getting stuck in ambiguity",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 3 && conv.trip.nights?.value === 2 && conv.trip.contactName?.value === "Michael",
          details: `guests=${conv.trip.guests?.value}, nights=${conv.trip.nights?.value}, name=${conv.trip.contactName?.value}`,
        }),
      },
      {
        guest: "Yes, we'd love to go diving on Oct 11th.",
        description: "Turn 2: Confirm diving on Oct 11",
        check: (conv) => ({
          pass: conv.trip.diver?.value === true && conv.trip.diveFrom?.value?.includes("10-11") === true,
          details: `diver=${conv.trip.diver?.value}, diveFrom=${conv.trip.diveFrom?.value}`,
        }),
      },
    ],
  },
  {
    id: "AN-02",
    category: "Dive Safety (DAN / PADI No-Fly Rule)",
    title: "Diving on checkout day triggers safety advisory regarding flights from Manila",
    dialogue: [
      {
        guest: "Hi, I'm Alex. 2 guests for 2 nights starting Nov 10th. We want to dive. No airport transfer.",
        description: "Turn 1: 2 guests, 2 nights Nov 10–12",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 2 && conv.trip.nights?.value === 2 && conv.trip.diver?.value === true,
          details: `checkIn=${conv.trip.checkIn?.value}, nights=${conv.trip.nights?.value}, diver=${conv.trip.diver?.value}`,
        }),
      },
      {
        guest: "We want to dive on Nov 11 to Nov 12.",
        description: "Turn 2: Diving ending on Nov 12 (checkout day) triggers No-Fly safety note",
        check: (conv) => ({
          pass: conv.done === true && conv.reply.includes("PADI/DAN guidelines recommend an 18–24 hour surface interval"),
          details: `done=${conv.done}, hasNoFlyAdvisory=${conv.reply.includes("PADI/DAN guidelines recommend an 18–24 hour surface interval")}`,
        }),
      },
    ],
  },
  {
    id: "AN-03",
    category: "Families & Children",
    title: "Family with 2 adults and 2 kids (children policy) + 2 rooms",
    dialogue: [
      {
        guest: "Hi, we are 2 adults and 2 kids coming for 3 nights from Dec 15th. We need 2 rooms and full board. Contact: David.",
        description: "Turn 1: Sum 2 adults + 2 kids = 4 guests, 2 rooms",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 4 && conv.trip.rooms?.value === 2 && conv.trip.nights?.value === 3 && conv.trip.meals?.value === "full_board",
          details: `guests=${conv.trip.guests?.value}, rooms=${conv.trip.rooms?.value}, nights=${conv.trip.nights?.value}`,
        }),
      },
      {
        guest: "No diving for the family, thanks!",
        description: "Turn 2: Complete booking with diver=false",
        check: (conv) => ({
          pass: conv.trip.diver?.value === false && conv.done === true,
          details: `diver=${conv.trip.diver?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "AN-04",
    category: "Transport Negation & Parking",
    title: "Guests driving themselves from Makati (free parking for 20 cars)",
    dialogue: [
      {
        guest: "Hi, 2 guests arriving Nov 20 for 2 nights. We will drive our own car from Makati, so no transfer needed. Name: Emily.",
        description: "Turn 1: Set transport=false, do NOT ask for transfer type",
        check: (conv) => ({
          pass: conv.trip.transport?.value === false && !conv.reply.includes("One-way or return"),
          details: `transport=${conv.trip.transport?.value}, asksTransferType=${conv.reply.includes("One-way or return")}`,
        }),
      },
      {
        guest: "No diving, just relaxing by the bay.",
        description: "Turn 2: Settle diver=false -> complete",
        check: (conv) => ({
          pass: conv.trip.diver?.value === false && conv.done === true,
          details: `diver=${conv.trip.diver?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "AN-05",
    category: "PADI Open Water Certification",
    title: "Course inquiry with roundtrip NAIA transfer",
    dialogue: [
      {
        guest: "Hello, 2 of us want to take the PADI Open Water course starting Nov 5 for 4 nights. Full board and need airport pickup. I'm Kevin.",
        description: "Turn 1: Extract 2 guests, 4 nights, diver=true, transport=true",
        check: (conv) => ({
          pass: conv.trip.guests?.value === 2 && conv.trip.diver?.value === true && conv.trip.transport?.value === true,
          details: `guests=${conv.trip.guests?.value}, diver=${conv.trip.diver?.value}, transport=${conv.trip.transport?.value}`,
        }),
      },
      {
        guest: "Course from Nov 6 to Nov 8, and roundtrip pickup please.",
        description: "Turn 2: Settle dive window & roundtrip transfer",
        check: (conv) => ({
          pass: conv.trip.transportType?.value === "roundtrip" && conv.trip.diveFrom?.value === "2026-11-06" && conv.done === true,
          details: `transportType=${conv.trip.transportType?.value}, diveFrom=${conv.trip.diveFrom?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "AN-06",
    category: "Mid-Chat Modifications",
    title: "Flight reschedule dynamically updates check-in and nights",
    dialogue: [
      {
        guest: "Booking for 2 guests, 2 nights from Oct 10. Name: Sarah. No diving, no pickup.",
        description: "Turn 1: Initial booking Oct 10 (2 nights)",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-10-10" && conv.trip.nights?.value === 2 && conv.done === true,
          details: `checkIn=${conv.trip.checkIn?.value}, nights=${conv.trip.nights?.value}`,
        }),
      },
      {
        guest: "Wait, our flight changed! Can we move to Oct 25 for 3 nights instead? Still 2 people, no diving.",
        description: "Turn 2: Dynamically update check-in to Oct 25, nights to 3",
        check: (conv) => ({
          pass: conv.trip.checkIn?.value === "2026-10-25" && conv.trip.nights?.value === 3 && conv.done === true,
          details: `checkIn=${conv.trip.checkIn?.value}, nights=${conv.trip.nights?.value}, checkOut=${conv.trip.checkOut?.value}`,
        }),
      },
    ],
  },
  {
    id: "AN-07",
    category: "B2B Travel Agency",
    title: "Travel agency booking triggers guestType=agent (30% discount in Odoo)",
    dialogue: [
      {
        guest: "Greetings from Pacific Waves Travel Agency. Booking 4 rooms for 8 guests, 3 nights starting Dec 1st. Contact: Rachel. No diving, no transfer.",
        description: "Turn 1: Detect agency -> guestType=agent",
        check: (conv) => ({
          pass: conv.trip.guestType?.value === "agent" && conv.trip.guests?.value === 8 && conv.trip.rooms?.value === 4 && conv.done === true,
          details: `guestType=${conv.trip.guestType?.value}, guests=${conv.trip.guests?.value}, rooms=${conv.trip.rooms?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
  {
    id: "AN-08",
    category: "Fabrication & Phone Traps",
    title: "International phone number directly before room and guest counts",
    dialogue: [
      {
        guest: "Hello, I'm calling from +1 (555) 019-2834. Booking 1 room for 2 guests for 2 nights starting Nov 18. Name: George. No transfer, no diving.",
        description: "Turn 1: Do NOT extract phone prefix as rooms/guests",
        check: (conv) => ({
          pass: conv.trip.rooms?.value === 1 && conv.trip.guests?.value === 2 && conv.trip.nights?.value === 2 && conv.done === true,
          details: `rooms=${conv.trip.rooms?.value}, guests=${conv.trip.guests?.value}, nights=${conv.trip.nights?.value}, done=${conv.done}`,
        }),
      },
    ],
  },
];

async function runBenchmark() {
  console.log("================================================================================");
  console.log("       CASA ESCONDIDA ANILAO: 8 REAL RESORT BUSINESS SCENARIOS                  ");
  console.log("================================================================================\n");

  const provider = createProviderFromEnv();
  console.log(`Provider in use: ${provider.id}\n`);

  let totalTurns = 0;
  let passedTurns = 0;
  let passedScenarios = 0;

  for (const tc of ANILAO_TEST_MATRIX) {
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
  console.log("                            FINAL BENCHMARK SUMMARY                             ");
  console.log("================================================================================");
  console.log(`Total Scenarios:     ${ANILAO_TEST_MATRIX.length}`);
  console.log(`Scenarios Passed:    ${passedScenarios} / ${ANILAO_TEST_MATRIX.length} (${Math.round((passedScenarios / ANILAO_TEST_MATRIX.length) * 100)}%)`);
  console.log(`Total Dialog Turns:  ${totalTurns}`);
  console.log(`Turns Passed:        ${passedTurns} / ${totalTurns} (${Math.round((passedTurns / totalTurns) * 100)}%)`);
  console.log("================================================================================\n");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
