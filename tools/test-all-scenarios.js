const url = process.env.CONVERSE_URL || 'https://technext-edge-casa-bff.vercel.app/v1/converse';

const scenarios = [
  {
    name: 'Scenario 1: David (Mixed Group: Diver + AOW Student + Relaxer)',
    payload: {
      message: "Hi Casa Escondida! I'm David. We are a group of 3 friends planning a trip from Dec 10 to Dec 13 (3 nights) with full board. We need 2 deluxe rooms for the 3 of us. Regarding activities: I will dive on Dec 11 and Dec 12; John wants to take the Advanced Open Water (AOW) course; Sarah does not dive at all, just relaxation and meals. No airport transfer needed. Please prepare our detailed quotation!"
    }
  },
  {
    name: 'Scenario 2: Chen Wei (Chinese / zh: 4 Divers, Full Board, Roundtrip Van)',
    payload: {
      message: '你好 Casa Escondida！我是陈伟（Chen Wei）。我们一行4人计划于12月15日至18日入住（3晚）。我们需要2间豪华房（Deluxe room）并包含全包餐（Full board）。我们4个人都是持证潜水员，计划在12月16日和17日两天都参加船潜。另外我们需要从马尼拉往返的私人家用车接送（Roundtrip van transfer）。请帮我们制作详细报价单！'
    }
  },
  {
    name: 'Scenario 3: Alex (Change of Mind: 2 guests -> 3 guests, 2 nights -> 3 nights, 2 standard rooms, adds diving)',
    multiTurn: true,
    turn1: {
      message: "Hi, I'm Alex. Need a quote for 2 people from Dec 5 to Dec 7 (2 nights), 1 standard room, full board, no diving."
    },
    turn2Msg: "Wait, change of plans! My brother is joining so we are 3 people now. Please extend checkout to Dec 8 (3 nights). We will need 2 standard rooms and full board, and all 3 of us will do boat diving on Dec 6 and Dec 7."
  },
  {
    name: 'Scenario 4: Robert (Group of 7, 4 Standard Rooms, Van Split Algorithm)',
    payload: {
      message: "Hello Casa Escondida, I'm Robert. We are a group of 7 guests staying from Dec 20 to Dec 22 (2 nights). We need 4 standard rooms and full board. All 7 of us will be boat diving on Dec 21. Also, we definitely need private roundtrip van transfer from Manila for all 7 of us. Please send us the quotation!"
    }
  },
  {
    name: 'Scenario 5: Marcus (PADI Instructor B2B Partner Quotation)',
    payload: {
      message: "Hi Casa Escondida, I am Marcus, a certified PADI Dive Instructor. I'm bringing 4 students (total 5 guests) for a dive trip from Dec 12 to 14 (2 nights). We need 3 standard rooms and full board. All 5 of us will be diving on both Dec 12 and Dec 13. No airport transfer needed. Please quote your instructor/partner rates for accommodation and diving."
    }
  },
  {
    name: 'Scenario 6: Kevin (Adversarial Room Capacity Guard: 5 adults in 1 standard room)',
    payload: {
      message: "Hi Casa Escondida, I am Kevin. We have 5 adults visiting from Dec 10 to 12 with full board, no diving. We want to save money so please put all 5 of us into just 1 single Standard room. Can you send the quote?"
    },
    expectBlocked: true
  }
];

async function run() {
  console.log(`Testing all scenarios against ${url}...\n`);
  for (const sc of scenarios) {
    console.log(`=======================================================`);
    console.log(`RUNNING: ${sc.name}`);
    console.log(`=======================================================`);

    if (sc.multiTurn) {
      const res1 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sc.turn1)
      }).then(r => r.json());
      console.log(`Turn 1: done=${res1.done}, questions=${res1.questions?.length}`);

      const res2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: [
            { role: 'guest', text: sc.turn1.message },
            { role: 'assistant', text: res1.reply }
          ],
          message: sc.turn2Msg
        })
      }).then(r => r.json());
      console.log(`Turn 2: done=${res2.done}, questions=${res2.questions?.length}`);
      console.log(`Bot Reply:\n${res2.reply}\n`);
      console.log(`Quote ID: ${res2.toolCall?.result?.quoteId || 'N/A'}`);
    } else {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sc.payload)
      }).then(r => r.json());
      console.log(`done=${res.done}, questions=${res.questions?.length}`);
      if (sc.expectBlocked) {
        console.log(`Validation Issues (Expected Guard):`, res.bffValidationIssues);
        console.log(`Quote Generated: ${res.toolCall?.result?.quoteId ? 'YES (UNEXPECTED)' : 'NO (CORRECT)'}`);
      } else {
        console.log(`Language=${res.trip?.language?.value}`);
        console.log(`Bot Reply:\n${res.reply}\n`);
        console.log(`Quote ID: ${res.toolCall?.result?.quoteId || 'N/A'}`);
        console.log(`Total: ₱${res.toolCall?.result?.totalAmount || 'N/A'}`);
      }
    }
  }
}

run().catch(console.error);
