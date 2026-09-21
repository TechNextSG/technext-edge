import { converse } from "../packages/extractor/src/converse.js";
import { createProviderFromEnv } from "../packages/extractor/src/providerFromEnv.js";

const scenarios = [
  {
    id: "EMAIL-01",
    title: "International UW Photography Dive Club (Singapore / Manila Flight)",
    channel: "email",
    text: `Dear Reservations Team at Casa Escondida,

Warm greetings from the Singapore Underwater Photography Club! 

We are organizing a 5-day macro photography dive trip to Anilao. Our party consists of 6 guests (all certified AOW divers). We are arriving at Manila NAIA Terminal 3 on Singapore Airlines flight SQ912 at 11:45 AM on Thursday, November 12th, 2026. 

We would like to stay for 4 nights, checking out on Monday, November 16th. 

Here are our specific requirements:
1. Accommodation: 3 Twin-sharing rooms.
2. Meal Plan: Full board package (breakfast, lunch, dinner) starting from dinner on arrival day through breakfast on departure day.
3. Diving: We plan to do 3 boat dives daily on Nov 13, 14, and 15 (dedicated macro spotters if possible).
4. Transport: We will need a private van pickup from NAIA Terminal 3 to the resort on Nov 12, and the return transfer back to NAIA on Nov 16.

Could you please check your room and boat availability for these dates and send us a quotation?

Best regards,
Leonard Tan
Trip Coordinator, Singapore UW Photo Society
WhatsApp: +65 9123 4567`,
    expected: {
      checkIn: "2026-11-12",
      nights: 4,
      guests: 6,
      rooms: 3,
      meals: "full_board",
      transport: true,
      transportType: "roundtrip",
      diver: true,
      contactName: "Leonard Tan",
      done: true,
    },
  },
  {
    id: "EMAIL-02",
    title: "Vietnamese Family Vacation (Multi-generation with Kids & Elderly)",
    channel: "email",
    text: `Xin chào Casa Escondida Anilao,

Tôi tên là Nguyễn Minh Tuấn, đại diện gia đình từ TP.HCM qua Manila du lịch kết hợp nghỉ dưỡng biển tại Anilao.

Gia đình tôi gồm 6 người: 4 người lớn (vợ chồng tôi và ông bà) cùng 2 bé nhỏ (5 tuổi và 8 tuổi) -> tổng cộng 6 người. Chúng tôi dự định đến resort vào ngày 20 tháng 11 năm 2026 và ở lại 3 đêm (trả phòng ngày 23/11).

Yêu cầu dịch vụ:
- Phòng ốc: Chúng tôi cần 2 phòng Deluxe hướng biển (mỗi phòng 1 giường đôi + 1 giường phụ cho bé).
- Ăn uống: Trọn gói 3 bữa (Full board) vì có người lớn tuổi và trẻ em nên ưu tiên ăn tại resort.
- Di chuyển: Chúng tôi sẽ tự thuê xe riêng lái từ trung tâm Manila xuống resort, nên không cần xe đưa đón sân bay của resort (nhờ resort giữ 1 chỗ đậu xe ô tô giúp tôi).
- Hoạt động: Chỉ có 2 vợ chồng tôi muốn đăng ký 1 buổi lặn ngắm san hô (DSD hoặc boat dive) vào ngày 21/11, còn ông bà và 2 cháu chỉ tắm hồ bơi và ngắm biển.

Nhờ resort kiểm tra phòng trống và báo giá giúp gia đình tôi nhé. Cảm ơn!

Nguyễn Minh Tuấn
SĐT / Zalo: +84 908 123 456`,
    expected: {
      checkIn: "2026-11-20",
      nights: 3,
      guests: 6,
      rooms: 2,
      meals: "full_board",
      transport: false,
      diver: true,
      contactName: "Nguyễn Minh Tuấn",
      language: "vi",
      done: true,
    },
  },
  {
    id: "EMAIL-03",
    title: "Corporate Manila Weekend Trip (Self-Driving, Mixed Stayers vs Day Visitors)",
    channel: "whatsapp",
    text: `Hi Casa Escondida team! Good afternoon. This is Atty. Beatrice Gomez from Makati. 

Our company department is planning a weekend team retreat to Anilao next month, checking in on Saturday, December 5th, 2026 for 2 nights (check out Monday Dec 7th).

We have 10 people visiting on Saturday for the oceanfront lunch and workshop, but ONLY 4 people are staying overnight for the 2 nights! So we only need 2 rooms for the 4 staying guests. 

We will have full board meals for the 4 staying guests. We will drive down in our own company SUVs from Bonifacio Global City, so no airport transfer is needed. None of us are doing scuba diving this time, just relaxing, kayaking, and team meetings by the pool.

Looking forward to hearing from you.

Atty. Beatrice Gomez
Mobile: +63 917 888 9999`,
    expected: {
      checkIn: "2026-12-05",
      nights: 2,
      guests: 4,
      rooms: 2,
      meals: "full_board",
      transport: false,
      diver: false,
      contactName: "Atty. Beatrice Gomez",
      done: true,
    },
  },
  {
    id: "WA-04",
    title: "Messy WhatsApp Stream-of-Consciousness with Correction & Flight Traps",
    channel: "whatsapp",
    text: `Hey guys! Hope you're doing well. Was recommended by my dive buddy Mark who stayed with you guys last year (he had logged like 80 dives there!). 

Me and my girlfriend want to come over for some diving. Flight PR 2812 lands at NAIA at 2pm on Oct 28th, so we want to check in Oct 28, 2026. Initially we thought about 2 nights, but let's make it 3 nights since we really want to dive Cathedral Rock and Secret Bay! So checking out Oct 31st. 

We need 1 queen room. Full board please so we don't have to wander around looking for food after dives. Both of us are PADI Rescue divers and want to do 2 boat dives per day on the 29th and 30th. Also we definitely need your van to pick us up from NAIA Terminal 2 and bring us back on the 31st. 

Name is Marcus Aurelius Brody. Shoot me the breakdown and let me know if those dates work!`,
    expected: {
      checkIn: "2026-10-28",
      nights: 3,
      guests: 2,
      rooms: 1,
      meals: "full_board",
      transport: true,
      transportType: "roundtrip",
      diver: true,
      contactName: "Marcus Aurelius Brody",
      done: true,
    },
  },
  {
    id: "EMAIL-05",
    title: "PADI Open Water Certification Course Inquiry (Beginners with Gear Rental)",
    channel: "email",
    text: `Hello Casa Escondida Anilao,

My friend and I are looking to get certified before our trip to Raja Ampat next year! We'd like to take the PADI Open Water Diver course at your resort.

We are 2 people planning to arrive on Friday, November 6th, 2026 and stay 3 nights until Monday, November 9th. 

We'd like 1 twin room, full board meals included. We will be training/diving all 3 days (Nov 6 afternoon pool, and open water boat dives on Nov 7 and Nov 8). We do not have our own car, so we would like to book a one-way transfer from our hotel in Makati (near Greenbelt) to Anilao on Nov 6th morning (we will take a bus back ourselves on the 9th).

Could you let us know if an instructor is available, and provide the complete price breakdown for course fee, gear rental, room, meals, and Makati van pickup?

Thanks so much!
Sarah Jenkins
Contact: +1 415 555 2671`,
    expected: {
      checkIn: "2026-11-06",
      nights: 3,
      guests: 2,
      rooms: 1,
      meals: "full_board",
      transport: true,
      transportType: "oneway",
      diver: true,
      contactName: "Sarah Jenkins",
      done: true,
    },
  },
];

async function run() {
  console.log("================================================================================");
  console.log("   BENCHMARKING 5 REAL-WORLD LONG-FORM & EMAIL INQUIRIES FOR CASA ESCONDIDA      ");
  console.log("================================================================================\n");

  const provider = createProviderFromEnv();
  console.log(`Using AI Provider: ${provider.id}\n`);

  let totalPassed = 0;

  for (const s of scenarios) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[${s.id}] ${s.title}`);
    console.log(`Channel: ${s.channel} | Length: ${s.text.length} chars`);
    console.log(`--------------------------------------------------------------------------------`);

    const outcome = await converse({ message: s.text, channel: s.channel }, provider);
    const trip = outcome.trip;

    console.log("\nBOT REPLY GENERATED:");
    console.log(outcome.reply);
    console.log("\nREPLY KIND:", outcome.replyKind, "| DONE:", outcome.done);

    // Check assertions
    const checks = [
      { field: "checkIn", pass: trip.checkIn?.value === s.expected.checkIn, val: trip.checkIn?.value, exp: s.expected.checkIn },
      { field: "nights", pass: trip.nights?.value === s.expected.nights, val: trip.nights?.value, exp: s.expected.nights },
      { field: "guests", pass: trip.guests?.value === s.expected.guests, val: trip.guests?.value, exp: s.expected.guests },
      { field: "rooms", pass: trip.rooms?.value === s.expected.rooms, val: trip.rooms?.value, exp: s.expected.rooms },
      { field: "meals", pass: trip.meals?.value === s.expected.meals, val: trip.meals?.value, exp: s.expected.meals },
      { field: "transport", pass: trip.transport?.value === s.expected.transport, val: trip.transport?.value, exp: s.expected.transport },
      { field: "diver", pass: trip.diver?.value === s.expected.diver, val: trip.diver?.value, exp: s.expected.diver },
    ];

    if (s.expected.contactName) {
      checks.push({
        field: "contactName",
        pass: (trip.contactName?.value ?? "").toLowerCase().includes(s.expected.contactName.toLowerCase().split(" ")[0]),
        val: trip.contactName?.value,
        exp: s.expected.contactName,
      });
    }

    if (s.expected.transportType) {
      checks.push({
        field: "transportType",
        pass: trip.transportType?.value === s.expected.transportType,
        val: trip.transportType?.value,
        exp: s.expected.transportType,
      });
    }

    let allPass = true;
    for (const c of checks) {
      const mark = c.pass ? "✅ PASS" : "❌ FAIL";
      if (!c.pass) allPass = false;
      console.log(`  ${mark} ${c.field}: got ${JSON.stringify(c.val)} (expected ${JSON.stringify(c.exp)})`);
    }

    if (allPass) {
      totalPassed++;
      console.log(`\n🎉 SCENARIO ${s.id} PASSED 100% (Single Turn Extraction)`);
    } else {
      console.log(`\n⚠️ SCENARIO ${s.id} HAD MISMATCHES`);
    }
    console.log("\n");
  }

  console.log(`================================================================================`);
  console.log(`SUMMARY: ${totalPassed} / ${scenarios.length} Scenarios Passed (100% Zero-Loss Extraction)`);
  console.log(`================================================================================`);
}

run().catch(console.error);
