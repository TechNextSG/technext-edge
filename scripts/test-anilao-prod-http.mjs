// Replays the 8 AN-* scenarios from test-anilao-real-matrix.ts, but via real
// HTTP calls to the deployed production /v1/converse endpoint — so it
// exercises whatever DEEPSEEK_GATEWAY_KEY/EXTRACTOR_PROVIDER is actually
// configured in Vercel, not a key supplied on this machine.
const BASE_URL = "https://technext-edge-casa-bff.vercel.app";

const SCENARIOS = [
  {
    id: "AN-01",
    title: "Day Visitors vs Staying Guests (6, only 3 staying)",
    turns: [
      {
        guest: "Hi! Our group has 6 people coming this Saturday, but only 3 are staying for 2 nights, the others are just day visitors. My name is Michael.",
        check: (t) => t.guests?.value === 3 && t.nights?.value === 2 && t.contactName?.value === "Michael",
        label: "guests=3, nights=2, name=Michael",
      },
      {
        guest: "Yes, we'd love to go diving on Oct 11th.",
        check: (t) => t.diver?.value === true && typeof t.diveFrom?.value === "string" && t.diveFrom.value.endsWith("10-11"),
        label: "diver=true, diveFrom=...-10-11",
      },
    ],
  },
  {
    id: "AN-02",
    title: "No-Fly safety advisory on checkout day",
    turns: [
      {
        guest: "Hi, I'm Alex. 2 guests for 2 nights starting Nov 10th. We want to dive. No airport transfer.",
        check: (t) => t.guests?.value === 2 && t.nights?.value === 2 && t.diver?.value === true,
        label: "guests=2, nights=2, diver=true",
      },
      {
        guest: "We want to dive on Nov 11 to Nov 12.",
        check: (t, reply) => reply.includes("PADI/DAN") && t.diveTo?.value === t.checkOut?.value,
        label: "No-Fly advisory present, diveTo==checkOut",
      },
    ],
  },
  {
    id: "AN-03",
    title: "Family with children (2 adults + 2 kids = 4)",
    turns: [
      {
        guest: "Hi, we are 2 adults and 2 kids coming for 3 nights from Dec 15th. We need 2 rooms and full board. Contact: David.",
        check: (t) => t.guests?.value === 4 && t.rooms?.value === 2,
        label: "guests=4, rooms=2",
      },
      {
        guest: "No diving for the family, thanks!",
        check: (t) => t.diver?.value === false,
        label: "diver=false",
      },
    ],
  },
  {
    id: "AN-04",
    title: "Self-driving transport negation",
    turns: [
      {
        guest: "Hi, 2 guests arriving Nov 20 for 2 nights. We will drive our own car from Makati, so no transfer needed. Name: Emily.",
        check: (t) => t.transport?.value === false,
        label: "transport=false",
      },
      {
        guest: "No diving, just relaxing by the bay.",
        check: (t) => t.diver?.value === false,
        label: "diver=false",
      },
    ],
  },
  {
    id: "AN-05",
    title: "PADI Open Water course + roundtrip transfer",
    turns: [
      {
        guest: "Hello, 2 of us want to take the PADI Open Water course starting Nov 5 for 4 nights. Full board and need airport pickup. I'm Kevin.",
        check: (t) => t.guests?.value === 2 && t.nights?.value === 4 && t.diver?.value === true && t.transport?.value === true,
        label: "guests=2, nights=4, diver=true, transport=true",
      },
      {
        guest: "Course from Nov 6 to Nov 8, and roundtrip pickup please.",
        check: (t) => t.diver?.value === true && t.transportType?.value === "roundtrip",
        label: "diver=true, transportType=roundtrip",
      },
    ],
  },
  {
    id: "AN-06",
    title: "Mid-chat flight reschedule",
    turns: [
      {
        guest: "Booking for 2 guests, 2 nights from Oct 10. Name: Sarah. No diving, no pickup.",
        check: (t) => t.checkIn?.value?.endsWith("10-10") && t.nights?.value === 2,
        label: "checkIn=...-10-10, nights=2",
      },
      {
        guest: "Wait, our flight changed! Can we move to Oct 25 for 3 nights instead? Still 2 people, no diving.",
        check: (t) => t.checkIn?.value?.endsWith("10-25") && t.nights?.value === 3 && t.checkOut?.value?.endsWith("10-28"),
        label: "checkIn=...-10-25, nights=3, checkOut=...-10-28",
      },
    ],
  },
  {
    id: "AN-07",
    title: "B2B travel agency booking",
    turns: [
      {
        guest: "Greetings from Pacific Waves Travel Agency. Booking 4 rooms for 8 guests, 3 nights starting Dec 1st. Contact: Rachel. No diving, no transfer.",
        check: (t) => t.guestType?.value === "agent" && t.rooms?.value === 4 && t.guests?.value === 8,
        label: "guestType=agent, rooms=4, guests=8",
      },
    ],
  },
  {
    id: "AN-08",
    title: "International phone number trap",
    turns: [
      {
        guest: "Hello, I'm calling from +1 (555) 019-2834. Booking 1 room for 2 guests for 2 nights starting Nov 18. Name: George. No transfer, no diving.",
        check: (t) => t.rooms?.value === 1 && t.guests?.value === 2 && t.nights?.value === 2,
        label: "rooms=1, guests=2, nights=2",
      },
    ],
  },
];

let passedScenarios = 0;
let totalTurns = 0;
let passedTurns = 0;

console.log("=".repeat(70));
console.log("ANILAO SCENARIOS — LIVE PRODUCTION HTTP (real deployed key)");
console.log("=".repeat(70));

for (const scenario of SCENARIOS) {
  console.log(`\n[${scenario.id}] ${scenario.title}`);
  const history = [];
  let scenarioOk = true;
  let lastTrip = null;
  let lastReply = "";

  for (const turn of scenario.turns) {
    totalTurns++;
    const res = await fetch(`${BASE_URL}/v1/converse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(history.length ? { history, message: turn.guest } : { message: turn.guest }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.log(`  ❌ HTTP ${res.status}: ${JSON.stringify(body)}`);
      scenarioOk = false;
      continue;
    }
    lastTrip = body.trip;
    lastReply = body.reply;
    const ok = turn.check(body.trip, body.reply);
    if (ok) {
      passedTurns++;
      console.log(`  ✅ ${turn.label}`);
    } else {
      scenarioOk = false;
      console.log(`  ❌ ${turn.label}`);
      console.log(`     reply: ${lastReply.split("\n").join(" / ")}`);
    }
    history.push({ role: "guest", text: turn.guest });
    history.push({ role: "assistant", text: body.reply });
  }
  if (scenarioOk) passedScenarios++;
}

console.log("\n" + "=".repeat(70));
console.log(`Scenarios: ${passedScenarios}/${SCENARIOS.length} (${Math.round((passedScenarios / SCENARIOS.length) * 100)}%)`);
console.log(`Turns:     ${passedTurns}/${totalTurns} (${Math.round((passedTurns / totalTurns) * 100)}%)`);
console.log("=".repeat(70));
