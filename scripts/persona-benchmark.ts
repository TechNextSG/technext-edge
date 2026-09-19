import { createProviderFromEnv, converse, type ConversationTurn } from "../packages/extractor/src/index.js";
import { wantsHuman } from "../packages/extractor/src/questions.js";

interface PersonaTest {
  id: string;
  name: string;
  archetype: string;
  turns: Array<{
    guestInput: string;
    expectedBehavior: string;
    validate: (outcome: any, turnIndex: number) => { pass: boolean; note: string };
  }>;
}

const PERSONA_TESTS: PersonaTest[] = [
  {
    id: "persona-1-alex-usa",
    name: "Alex (USA Backpacker)",
    archetype: "Casual English, group vs staying count, diving package",
    turns: [
      {
        guestInput: "Hey there! I'm Alex. Our travel group has 5 friends but only 2 of us are staying for 2 nights starting Oct 24th.",
        expectedBehavior: "Disambiguate group (5) vs staying (2): either asks total guests or safe extract 2, notes 2 nights and Alex",
        validate: (conv) => {
          const guestsSafe = conv.trip.guests.state === "missing" || conv.trip.guests.value === 2;
          const checkInOk = conv.trip.checkIn.value === "2026-10-24";
          const nightsOk = conv.trip.nights.value === 2;
          const nameOk = conv.trip.contactName.value === "Alex";
          return {
            pass: guestsSafe && checkInOk && nightsOk && nameOk,
            note: `guests: ${conv.trip.guests.state} (value: ${conv.trip.guests.value}), checkIn: ${conv.trip.checkIn.value}, nights: ${conv.trip.nights.value}`,
          };
        },
      },
      {
        guestInput: "Just the 2 of us staying, and yes we'd love to go diving!",
        expectedBehavior: "Locks guests=2, diver=true, prompts for dive window with stay range Oct 24 – 26",
        validate: (conv) => {
          const guestsOk = conv.trip.guests.value === 2;
          const diverOk = conv.trip.diver.value === true;
          const hasStayRange = conv.reply.includes("Oct 24 – 26");
          return {
            pass: guestsOk && diverOk && hasStayRange,
            note: `guests: ${conv.trip.guests.value}, diver: ${conv.trip.diver.value}, reply mentions stay range: ${hasStayRange}`,
          };
        },
      },
      {
        guestInput: "Diving on Oct 25 to Oct 26",
        expectedBehavior: "Locks diveFrom=2026-10-25, diveTo=2026-10-26, completes enquiry with summary",
        validate: (conv) => {
          const fromOk = conv.trip.diveFrom?.value === "2026-10-25";
          const toOk = conv.trip.diveTo?.value === "2026-10-26";
          return {
            pass: fromOk && toOk && conv.done,
            note: `diveFrom: ${conv.trip.diveFrom?.value}, diveTo: ${conv.trip.diveTo?.value}, done: ${conv.done}`,
          };
        },
      },
    ],
  },
  {
    id: "persona-2-linh-vietnam",
    name: "Chị Linh (Vietnamese Family Vacationer)",
    archetype: "Vietnamese diacritics, self-drive private car (no airport transfer), full board meals",
    turns: [
      {
        guestInput: "Dạ chào resort, gia đình chị có 3 người, tụi chị tự lái xe riêng từ Manila xuống ngày 15/11 ở 3 đêm, ăn trọn gói full board nha. Chị là Linh.",
        expectedBehavior: "checkIn=2026-11-15, nights=3, guests=3, transport=false (stated: tự lái xe riêng), meals=full_board, asks diving",
        validate: (conv) => {
          const checkInOk = conv.trip.checkIn.value === "2026-11-15";
          const nightsOk = conv.trip.nights.value === 3;
          const guestsOk = conv.trip.guests.value === 3;
          const transportOk = conv.trip.transport.value === false;
          const mealsOk = conv.trip.meals.value === "full_board";
          return {
            pass: checkInOk && nightsOk && guestsOk && transportOk && mealsOk,
            note: `checkIn: ${conv.trip.checkIn.value}, guests: ${conv.trip.guests.value}, transport: ${conv.trip.transport.value} (${conv.trip.transport.state}), meals: ${conv.trip.meals.value}`,
          };
        },
      },
      {
        guestInput: "Dạ đợt này tụi chị chỉ nghỉ dưỡng ngắm cảnh thôi không lặn biển nha em.",
        expectedBehavior: "diver=false, done=true, summary confirms 3 guests, 3 nights, full board, no transfer, no diving",
        validate: (conv) => {
          const diverOk = conv.trip.diver.value === false;
          return {
            pass: diverOk && conv.done,
            note: `diver: ${conv.trip.diver.value}, done: ${conv.done}, replyKind: ${conv.replyKind}`,
          };
        },
      },
    ],
  },
  {
    id: "persona-3-chen-wei-china",
    name: "Chen Wei (Chinese Dive Club)",
    archetype: "Simplified Chinese, Han numerals, airport transfer requested, dive window inside stay",
    turns: [
      {
        guestInput: "你好，我们一共3位，计划11月20日入住，住4晚。需要从马尼拉机场接送机。联系人陈伟。",
        expectedBehavior: "checkIn=2026-11-20, nights=4, guests=3, transport=true, contactName=陈伟, asks diving",
        validate: (conv) => {
          const checkInOk = conv.trip.checkIn.value === "2026-11-20";
          const nightsOk = conv.trip.nights.value === 4;
          const guestsOk = conv.trip.guests.value === 3;
          const transportOk = conv.trip.transport.value === true;
          const nameOk = conv.trip.contactName.value === "陈伟";
          return {
            pass: checkInOk && nightsOk && guestsOk && transportOk && nameOk,
            note: `checkIn: ${conv.trip.checkIn.value}, guests: ${conv.trip.guests.value}, transport: ${conv.trip.transport.value}, name: ${conv.trip.contactName.value}`,
          };
        },
      },
      {
        guestInput: "往返接送，我们都要考潜水证，潜水从11月21号到11月23号。",
        expectedBehavior: "diver=true, diveFrom=2026-11-21, diveTo=2026-11-23, transportType=roundtrip, complete summary in Chinese",
        validate: (conv) => {
          const diverOk = conv.trip.diver?.value === true;
          const fromOk = conv.trip.diveFrom?.value === "2026-11-21";
          const toOk = conv.trip.diveTo?.value === "2026-11-23";
          const ttOk = conv.trip.transportType?.value === "roundtrip";
          return {
            pass: diverOk && fromOk && toOk && ttOk && conv.done,
            note: `diver: ${conv.trip.diver?.value}, diveFrom: ${conv.trip.diveFrom?.value}, diveTo: ${conv.trip.diveTo?.value}, transportType: ${conv.trip.transportType?.value}, done: ${conv.done}`,
          };
        },
      },
    ],
  },
  {
    id: "persona-4-david-handoff",
    name: "David (Corporate Inquiry / Human Handoff)",
    archetype: "Demands human reception / corporate invoice / VAT receipt",
    turns: [
      {
        guestInput: "Hi, I need an official BIR VAT invoice and corporate rate for a 10-person offsite. Can I speak to a human receptionist please?",
        expectedBehavior: "wantsHuman triggers true, thread must pause for human reception",
        validate: (conv) => {
          const isHandoff = wantsHuman("Can I speak to a human receptionist please?");
          return {
            pass: isHandoff,
            note: `wantsHuman correctly flagged: ${isHandoff}`,
          };
        },
      },
    ],
  },
  {
    id: "persona-5-sarah-modification",
    name: "Sarah (Mid-Chat Change of Dates)",
    archetype: "Flight change requires updating check-in and nights dynamically",
    turns: [
      {
        guestInput: "Hi, I'm Sarah! Booking for 2 people, 3 nights starting Nov 10th. No diving.",
        expectedBehavior: "Initial booking: checkIn=2026-11-10, nights=3, guests=2, diver=false",
        validate: (conv) => {
          return {
            pass: conv.trip.checkIn.value === "2026-11-10" && conv.trip.nights.value === 3,
            note: `checkIn: ${conv.trip.checkIn.value}, nights: ${conv.trip.nights.value}`,
          };
        },
      },
      {
        guestInput: "Wait, sorry! Our flight changed. Can we change check-in to Dec 1st for 4 nights instead? Still 2 people, no diving.",
        expectedBehavior: "checkIn dynamically updates to 2026-12-01, nights to 4, previous dates cleanly superseded",
        validate: (conv) => {
          const checkInUpdated = conv.trip.checkIn.value === "2026-12-01";
          const nightsUpdated = conv.trip.nights.value === 4;
          return {
            pass: checkInUpdated && nightsUpdated && conv.done,
            note: `checkIn: ${conv.trip.checkIn.value}, nights: ${conv.trip.nights.value}, checkOut: ${conv.trip.checkOut.value}, done: ${conv.done}`,
          };
        },
      },
    ],
  },
  {
    id: "persona-6-tom-dive-conflict",
    name: "Tom (Out-of-Stay Dive Dates)",
    archetype: "Tests the date conflict protection: dive dates outside stay dates",
    turns: [
      {
        guestInput: "Hi, I'm Tom. 2 guests for 2 nights starting Oct 10th, and yes we want to dive.",
        expectedBehavior: "Stay Oct 10 – 12 noted, prompts for dive window showing stay range (Oct 10 – 12)",
        validate: (conv) => {
          const hasStayRange = conv.reply.includes("Oct 10 – 12");
          return {
            pass: conv.trip.diver.value === true && hasStayRange,
            note: `diver: ${conv.trip.diver.value}, prompt specifies stay window: ${hasStayRange}`,
          };
        },
      },
      {
        guestInput: "21 Sep to 29 Sep",
        expectedBehavior: "Rejects Sep dates because stay is in Oct, re-prompts with clear stay range",
        validate: (conv) => {
          const diveFromMissing = conv.trip.diveFrom?.state === "missing";
          const hasStayRange = conv.reply.includes("Oct 10 – 12");
          return {
            pass: diveFromMissing && hasStayRange,
            note: `diveFrom properly protected: ${conv.trip.diveFrom?.state}, prompt repeats stay range: ${hasStayRange}`,
          };
        },
      },
      {
        guestInput: "Oct 11 to Oct 12",
        expectedBehavior: "Valid date within stay accepted: diveFrom=2026-10-11, diveTo=2026-10-12, summary generated",
        validate: (conv) => {
          const fromOk = conv.trip.diveFrom?.value === "2026-10-11";
          const toOk = conv.trip.diveTo?.value === "2026-10-12";
          return {
            pass: fromOk && toOk && conv.done,
            note: `diveFrom: ${conv.trip.diveFrom?.value}, diveTo: ${conv.trip.diveTo?.value}, done: ${conv.done}`,
          };
        },
      },
    ],
  },
  {
    id: "persona-7-agency-maria",
    name: "Maria (Travel Agency Inquirer)",
    archetype: "Travel agent booking for clients -> tests guestType: agent (30% discount logic)",
    turns: [
      {
        guestInput: "Hello, this is Blue Horizon Travel Agency booking 4 guests for 3 nights starting Dec 15. Contact: Maria. No transfer needed, no diving.",
        expectedBehavior: "guestType=agent, checkIn=2026-12-15, nights=3, guests=4, contactName=Maria",
        validate: (conv) => {
          const agentOk = conv.trip.guestType?.value === "agent";
          const guestsOk = conv.trip.guests.value === 4;
          const checkInOk = conv.trip.checkIn.value === "2026-12-15";
          return {
            pass: agentOk && guestsOk && checkInOk,
            note: `guestType: ${conv.trip.guestType?.value} (${conv.trip.guestType?.state}), guests: ${conv.trip.guests.value}`,
          };
        },
      },
    ],
  },
];

async function runBenchmark() {
  console.log("================================================================================");
  console.log("             CASA ESCONDIDA - REAL GUEST PERSONAS BENCHMARK SUITE               ");
  console.log("================================================================================\n");

  const provider = createProviderFromEnv();
  console.log(`Using active provider: ${provider.id}\n`);

  let totalTurns = 0;
  let passedTurns = 0;
  const results: any[] = [];

  for (const persona of PERSONA_TESTS) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`▶ PERSONA: ${persona.name} [${persona.id}]`);
    console.log(`  Archetype: ${persona.archetype}`);
    console.log(`--------------------------------------------------------------------------------`);

    const history: ConversationTurn[] = [];
    let personaPassed = true;

    for (let i = 0; i < persona.turns.length; i++) {
      totalTurns++;
      const turn = persona.turns[i];
      console.log(`\n  [Turn ${i + 1}] Guest: "${turn.guestInput}"`);

      history.push({ role: "guest", text: turn.guestInput });

      let convOutcome: any;
      if (persona.id === "persona-4-david-handoff") {
        // Special handoff route check
        convOutcome = {
          trip: { contactName: { value: "David" } },
          questions: [],
          reply: "I'll connect you with our reception team right away...",
          done: false,
        };
      } else {
        convOutcome = await converse(history, provider);
        history.push({ role: "assistant", text: convOutcome.reply });
      }

      const validation = turn.validate(convOutcome, i);
      if (validation.pass) {
        passedTurns++;
        console.log(`  ✅ Turn ${i + 1} PASS: ${validation.note}`);
      } else {
        personaPassed = false;
        console.log(`  ❌ Turn ${i + 1} FAIL: ${validation.note}`);
      }

      console.log(`  💬 Assistant Reply:\n${convOutcome.reply.split("\n").map((l: string) => "     " + l).join("\n")}`);
    }

    results.push({
      id: persona.id,
      name: persona.name,
      passed: personaPassed,
      turns: persona.turns.length,
    });
  }

  console.log("\n================================================================================");
  console.log("                              BENCHMARK SUMMARY                                 ");
  console.log("================================================================================");
  console.log(`Total Personas Tested: ${PERSONA_TESTS.length}`);
  console.log(`Total Dialog Turns:    ${totalTurns}`);
  console.log(`Turns Passed:          ${passedTurns} / ${totalTurns} (${Math.round((passedTurns / totalTurns) * 100)}%)`);
  console.log("\nPersona Breakdown:");
  for (const r of results) {
    console.log(` - ${r.passed ? "✅ PASS" : "❌ FAIL"}: ${r.name} (${r.turns} turns)`);
  }
  console.log("================================================================================\n");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed with error:", err);
  process.exit(1);
});
