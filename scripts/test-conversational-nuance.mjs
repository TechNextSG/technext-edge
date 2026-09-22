import { converse } from "../packages/extractor/src/converse.js";
import { createProviderFromEnv } from "../packages/extractor/src/providerFromEnv.js";

async function testMichaelScenario() {
  const provider = createProviderFromEnv();
  console.log(`Using Provider: ${provider.id}\n`);

  console.log("================================================================================");
  console.log("TURN 1: Group of 6, 3 staying overnight, 3 day visitors");
  console.log("--------------------------------------------------------------------------------");
  const turn1Input = {
    message: "Hi! Our group has 6 people coming this Saturday, but only 3 are staying for 2 nights, the others are just day visitors. My name is Michael.",
    channel: "whatsapp",
  };
  const res1 = await converse(turn1Input, provider);
  console.log("BOT REPLY TURN 1:\n" + res1.reply);
  console.log("\nEXTRACTED TRIP TURN 1:");
  console.log({
    guests: res1.trip.guests?.value,
    nights: res1.trip.nights?.value,
    contactName: res1.trip.contactName?.value,
    specialRequests: res1.trip.specialRequests?.value,
    questions: res1.questions.map((q) => q.question),
  });

  console.log("\n================================================================================");
  console.log("TURN 2: 'One person will dive on the first day and five will dive on both'");
  console.log("--------------------------------------------------------------------------------");
  const turn2Input = {
    message: "One person will dive on the first day and five will dive on both",
    history: [
      { role: "guest", text: turn1Input.message },
      { role: "assistant", text: res1.reply },
    ],
    channel: "whatsapp",
  };
  const res2 = await converse(turn2Input, provider);
  console.log("BOT REPLY TURN 2:\n" + res2.reply);
  console.log("\nREPLY KIND: " + res2.replyKind + " | DONE: " + res2.done);
  console.log("EXTRACTED TRIP TURN 2:");
  console.log({
    checkIn: res2.trip.checkIn?.value,
    checkOut: res2.trip.checkOut?.value,
    nights: res2.trip.nights?.value,
    guests: res2.trip.guests?.value,
    rooms: res2.trip.rooms?.value,
    diver: res2.trip.diver?.value,
    diveFrom: res2.trip.diveFrom?.value,
    diveTo: res2.trip.diveTo?.value,
    diveNotes: res2.trip.diveNotes?.value,
    specialRequests: res2.trip.specialRequests?.value,
  });
}

testMichaelScenario().catch(console.error);
