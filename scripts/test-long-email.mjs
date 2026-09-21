import { converse, extract } from "../packages/extractor/src/index.ts";

const emailText = `Dear Casa Escondida Team,

Good day! My name is Dr. Christopher Vance. My dive group from Singapore (a party of 6 adults) is planning a 4-night dive holiday to Anilao next month.

We will be arriving at Manila NAIA Airport on Friday, October 23rd, 2026 around noon, and we would like to stay for 4 nights, checking out on Tuesday, October 27th. 

We would need 3 twin rooms for the 6 of us, with full board meal packages (breakfast, lunch, dinner). Four of us are Advanced Open Water divers and plan to do 3 boat dives a day starting Saturday, Oct 24th through Monday, Oct 26th. The remaining two guests are non-divers who will just join for snorkeling and pool relaxation.

Could you also arrange a private roundtrip van transfer from NAIA Terminal 3 to the resort and back? 

Please provide availability and an estimated cost breakdown for accommodation, diving, meals, and transport.

Warm regards,
Dr. Christopher Vance
WhatsApp: +65 9876 5432`;

import { createProviderFromEnv } from "../packages/extractor/src/providerFromEnv.js";

async function main() {
  console.log("=== Testing Long Email Inquiry ===");
  const provider = createProviderFromEnv();
  console.log("Using provider:", provider.id);
  const res = await converse({ message: emailText }, provider);
  console.log("\n--- Bot Reply ---");
  console.log(res.reply);
  console.log("\n--- Reply Kind ---");
  console.log(res.replyKind);
  console.log("\n--- Done Flag ---");
  console.log(res.done);
  console.log("\n--- Questions Remaining ---");
  console.log(res.questions);
  console.log("\n--- Trip Object Extracted ---");
  console.log(JSON.stringify(res.trip, null, 2));
}

main().catch(console.error);
