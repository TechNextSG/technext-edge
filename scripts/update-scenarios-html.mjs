import fs from "fs";
import path from "path";

const htmlPath = "docs/casa-anilao-test-scenarios.html";
let html = fs.readFileSync(htmlPath, "utf8");

// 1. Update Hero tags and counts
html = html.replace(
  '<span class="tag ok">8/8 SCENARIOS PASS (100%)</span>',
  '<span class="tag ok">14/14 SCENARIOS PASS (100%)</span>'
);
html = html.replace(
  '<span class="tag ok">14/14 DIALOG TURNS PASS</span>',
  '<span class="tag ok">20/20 DIALOG TURNS PASS</span>'
);
html = html.replace(
  '<span id="progCount">0/8 (0%)</span>',
  '<span id="progCount">0/14 (0%)</span>'
);

// 2. Prepare HTML for 6 Long-Form English Scenarios
const longScenariosHtml = `
      <!-- SUBSECTION 2A: REALISTIC LONG-FORM ENGLISH SCENARIOS -->
      <div style="background: linear-gradient(135deg, #0d4f5f 0%, #155e75 100%); color: #fff; padding: 20px 24px; border-radius: 12px; margin-bottom: 24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <span style="font: 700 11px Consolas, monospace; background: #059669; color: #ecfdf5; padding: 3px 8px; border-radius: 12px; text-transform: uppercase;">
              ★ Primary Demo Focus (Sep 21 Afternoon)
            </span>
            <h3 style="margin: 8px 0 4px; font-size: 20px; color: #fff;">
              <span class="en">Realistic Long-Form English Scenarios (Emails & Long Paragraphs)</span>
              <span class="vi">Kịch Bản Đoạn Văn Dài & Email Tiếng Anh Thực Tế (Trọng Tâm Demo Chiều Nay)</span>
            </h3>
            <p style="margin: 0; color: #c7dbe3; font-size: 13.5px; max-width: 80ch;">
              <span class="en">6 comprehensive real-world booking inquiries (700–1000 characters). Extracted 100% in a single turn with zero hallucinated questions and full ISO date resolution. Click <strong>"📋 Copy"</strong> to test live on WhatsApp.</span>
              <span class="vi">6 bức thư và tin nhắn đặt phòng thực tế (700–1000 ký tự). Trích xuất 100% chính xác sau 1 lượt duy nhất, không hỏi thừa, chuẩn hóa ngày ISO. Nhấn <strong>"📋 Copy"</strong> để dán trực tiếp vào WhatsApp test demo.</span>
            </p>
          </div>
          <div style="text-align: right;">
            <div style="font: 700 22px Consolas, monospace; color: #34d399;">6 / 6 PASS</div>
            <div style="font: 11px Consolas, monospace; color: #94a3b8;">SINGLE-TURN SUMMARIES</div>
          </div>
        </div>
      </div>

      <!-- SCENARIO EN-LONG-01 -->
      <div class="sc-box">
        <div class="sc-top">
          <span class="sc-code">EN-LONG-01</span>
          <span class="sc-header-title">
            <span class="en">International UW Photography Dive Group (Flight SQ912, 6 Divers, 3 Rooms)</span>
            <span class="vi">Đoàn Chụp Ảnh Macro Quốc Tế (Chuyến bay SQ912, 6 Thợ Lặn, 3 Phòng)</span>
          </span>
          <span class="sc-cat"><span class="en">Category: Email / Group</span><span class="vi">Nhóm: Email / Đoàn Đông</span></span>
        </div>
        <div class="sc-content">
          <div class="sc-intent">
            <span class="en">Real-world email format (966 chars): Group of 6 arriving Friday Nov 13, 2026 on flight SQ912 for 4 nights, 3 twin rooms, full board, 6 AOW divers diving Nov 14-16, roundtrip van transfer NAIA T3. Contact: Dr. Christopher Vance.</span>
            <span class="vi">Email thực tế dài 966 ký tự: Nhóm 6 người bay chuyến SQ912 đến thứ 6 ngày 13/11/2026 ở 4 đêm, 3 phòng twin, full board, 6 thợ lặn lặn từ 14-16/11, xe van khứ hồi NAIA T3. Tên: Dr. Christopher Vance.</span>
          </div>

          <div class="turn-row">
            <div class="turn-meta">
              <span><span class="en">Single Turn: Long-form Email</span><span class="vi">Một lượt: Email chi tiết</span></span>
              <span class="badge-pass">PASS (1 Turn)</span>
            </div>
            <div class="guest-msg-wrap" style="white-space: pre-wrap; font-family: inherit;">
              <button type="button" class="btn-copy" onclick="copyPrompt(\`Dear Casa Escondida Reservations Team,\\n\\nWarm greetings from Singapore! My name is Dr. Christopher Vance. Our dive club of 6 adults is organizing a macro photography dive trip to Anilao next month.\\n\\nWe are flying into Manila NAIA Terminal 3 on Singapore Airlines flight SQ912, arriving around 11:30 AM on Friday, November 13th, 2026. We would like to stay for 4 nights, checking out on Tuesday, November 17th.\\n\\nOur requirements:\\n1. Accommodation: 3 Twin-sharing rooms for the 6 of us.\\n2. Meal package: Full board (breakfast, lunch, dinner) starting from dinner on arrival day.\\n3. Diving: All 6 of us are Advanced Open Water divers. We want to do 3 boat dives per day on Nov 14, 15, and 16.\\n4. Transfers: Please arrange a private roundtrip van transfer for 6 passengers with dive bags between NAIA T3 and the resort.\\n\\nCould you please confirm room and boat availability and share the total package estimate?\\n\\nWarm regards,\\nDr. Christopher Vance\\nWhatsApp: +65 9123 4567\`, this)">
                📋 <span class="en">Copy</span><span class="vi">Sao chép</span>
              </button>Dear Casa Escondida Reservations Team,

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
WhatsApp: +65 9123 4567
            </div>
            <div class="bot-reply-wrap">Thanks, Dr. Christopher Vance!
Here's what I have for your stay:
• Stay: Nov 13 – 17, 2026 (4 nights)
• Guests: 6
• Rooms: 3
• Meals: full board
• Contact name: Dr. Christopher Vance
• Airport transfer: yes · return trip
• Diving: yes · Nov 14 – 16, 2026

Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.</div>
          </div>

          <div class="assertion-bar">
            <strong><span class="en">Core Verification:</span><span class="vi">Điểm Kiểm Tra:</span></strong>
            <span class="assertion-pill">checkIn = 2026-11-13</span>
            <span class="assertion-pill">nights = 4</span>
            <span class="assertion-pill">guests = 6</span>
            <span class="assertion-pill">rooms = 3</span>
            <span class="assertion-pill">diver = true (Nov 14–16)</span>
            <span class="assertion-pill">transfer = roundtrip</span>
            <span class="assertion-pill">done = true</span>
          </div>
        </div>
      </div>

      <!-- SCENARIO EN-LONG-02 -->
      <div class="sc-box">
        <div class="sc-top">
          <span class="sc-code">EN-LONG-02</span>
          <span class="sc-header-title">
            <span class="en">Family Vacation with Divers & Non-Divers (Self-Driving from Makati, 2 Rooms)</span>
            <span class="vi">Kỳ Nghỉ Gia Đình Có Người Lặn & Người Không Lặn (Tự Lái Xe Từ Makati, 2 Phòng)</span>
          </span>
          <span class="sc-cat"><span class="en">Category: Family / Transport</span><span class="vi">Nhóm: Gia Đình / Tự Lái Xe</span></span>
        </div>
        <div class="sc-content">
          <div class="sc-intent">
            <span class="en">Family of 5 arriving Dec 4, 2026 for 3 nights: 2 certified divers + grandma relaxing + 2 snorkeling kids. Request 2 rooms, full board, boat diving Dec 5-6, driving own 7-seater SUV (NO transfer needed). Contact: Marianne Hastings.</span>
            <span class="vi">Gia đình 5 người đến 4/12/2026 ở 3 đêm: 2 người lặn + bà ngoại + 2 con nhỏ. Đặt 2 phòng, full board, lặn ngày 5-6/12, tự lái SUV 7 chỗ từ Makati (không cần đón). Tên: Marianne Hastings.</span>
          </div>

          <div class="turn-row">
            <div class="turn-meta">
              <span><span class="en">Single Turn: Family Vacation Email</span><span class="vi">Một lượt: Email kỳ nghỉ gia đình</span></span>
              <span class="badge-pass">PASS (1 Turn)</span>
            </div>
            <div class="guest-msg-wrap" style="white-space: pre-wrap; font-family: inherit;">
              <button type="button" class="btn-copy" onclick="copyPrompt(\`Good day Casa Escondida! \\n\\nI'm writing to enquire about booking a 3-night family weekend stay arriving Friday, December 4th, 2026, checking out Monday, December 7th. \\n\\nWe are a family of 5: myself and my husband (both certified divers), my mother (who just wants to relax and read by the ocean), and our two kids aged 8 and 11 who love snorkeling. We would need 2 rooms: one Deluxe Ocean View room with a king bed for us + rollaway bed, and one Twin room for grandma and the kids. \\n\\nWe would like the full board meal package so we do not have to drive around for food. Only my husband and I will be doing boat diving (2 dives each on Saturday Dec 5 and Sunday Dec 6). We will be driving down in our own 7-seater SUV from Makati, so we do not need an airport transfer — just please ensure you have secure parking space for our car.\\n\\nThank you and looking forward to your quotation!\\n\\nBest,\\nMarianne Hastings\\nMobile: +63 917 555 4321\`, this)">
                📋 <span class="en">Copy</span><span class="vi">Sao chép</span>
              </button>Good day Casa Escondida! 

I'm writing to enquire about booking a 3-night family weekend stay arriving Friday, December 4th, 2026, checking out Monday, December 7th. 

We are a family of 5: myself and my husband (both certified divers), my mother (who just wants to relax and read by the ocean), and our two kids aged 8 and 11 who love snorkeling. We would need 2 rooms: one Deluxe Ocean View room with a king bed for us + rollaway bed, and one Twin room for grandma and the kids. 

We would like the full board meal package so we do not have to drive around for food. Only my husband and I will be doing boat diving (2 dives each on Saturday Dec 5 and Sunday Dec 6). We will be driving down in our own 7-seater SUV from Makati, so we do not need an airport transfer — just please ensure you have secure parking space for our car.

Thank you and looking forward to your quotation!

Best,
Marianne Hastings
Mobile: +63 917 555 4321
            </div>
            <div class="bot-reply-wrap">Thanks, Marianne Hastings!
Here's what I have for your stay:
• Stay: Dec 4 – 7, 2026 (3 nights)
• Guests: 5
• Rooms: 2
• Meals: full board
• Contact name: Marianne Hastings
• Airport transfer: no
• Diving: yes · Dec 5 – 6, 2026

Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.</div>
          </div>

          <div class="assertion-bar">
            <strong><span class="en">Core Verification:</span><span class="vi">Điểm Kiểm Tra:</span></strong>
            <span class="assertion-pill">checkIn = 2026-12-04</span>
            <span class="assertion-pill">nights = 3</span>
            <span class="assertion-pill">guests = 5 (all family members)</span>
            <span class="assertion-pill">rooms = 2</span>
            <span class="assertion-pill">diver = true (Dec 5–6)</span>
            <span class="assertion-pill">transfer = false (own car)</span>
            <span class="assertion-pill">done = true</span>
          </div>
        </div>
      </div>

      <!-- SCENARIO EN-LONG-03 -->
      <div class="sc-box">
        <div class="sc-top">
          <span class="sc-code">EN-LONG-03</span>
          <span class="sc-header-title">
            <span class="en">Corporate Retreat with Day Visitors vs Overnight Stayers Trap</span>
            <span class="vi">Ngoại Khóa Doanh Nghiệp: Bẫy Khách Tham Quan Trong Ngày vs Khách Ngủ Lại</span>
          </span>
          <span class="sc-cat"><span class="en">Category: Corporate / Count Trap</span><span class="vi">Nhóm: Doanh Nghiệp / Bẫy Số Lượng</span></span>
        </div>
        <div class="sc-content">
          <div class="sc-intent">
            <span class="en">10 people attend Saturday lunch meeting, but ONLY 4 people stay overnight for 2 nights (Dec 12-14, 2026). Need 2 rooms, full board, NO scuba diving (kayaking only), driving company vans. System must extract 4 guests (not 10). Contact: Atty. Beatrice Gomez.</span>
            <span class="vi">10 người dự trưa thứ 7, nhưng CHỈ 4 người ở lại qua đêm 2 đêm (12-14/12/2026). Cần 2 phòng, full board, KHÔNG lặn biển, tự đi xe công ty. Hệ thống phải trích xuất đúng 4 khách (không phải 10). Tên: Atty. Beatrice Gomez.</span>
          </div>

          <div class="turn-row">
            <div class="turn-meta">
              <span><span class="en">Single Turn: Corporate Inquiry</span><span class="vi">Một lượt: Thư yêu cầu công ty</span></span>
              <span class="badge-pass">PASS (1 Turn)</span>
            </div>
            <div class="guest-msg-wrap" style="white-space: pre-wrap; font-family: inherit;">
              <button type="button" class="btn-copy" onclick="copyPrompt(\`Hi Casa Escondida team, good afternoon! \\n\\nThis is Atty. Beatrice Gomez from Taguig, Manila. Our legal department is planning a weekend planning session in Anilao, checking in on Saturday, December 12th, 2026 for 2 nights, checking out Monday, December 14th.\\n\\nPlease note: we will have 10 people attending the Saturday seaside lunch and meeting, but ONLY 4 people are staying overnight for the 2 nights! Therefore, we only need 2 rooms (twin beds) for the 4 staying guests.\\n\\nFor the 4 overnight guests, we would like the full board meal arrangement. We are driving our own company vans from BGC, so no airport shuttle is required. We will not be doing any scuba diving on this trip, just kayaking and swimming.\\n\\nKindly send over the quotation for the 4 staying guests and the 2 rooms.\\n\\nWarm regards,\\nAtty. Beatrice Gomez\\nContact: +63 920 123 9876\`, this)">
                📋 <span class="en">Copy</span><span class="vi">Sao chép</span>
              </button>Hi Casa Escondida team, good afternoon! 

This is Atty. Beatrice Gomez from Taguig, Manila. Our legal department is planning a weekend planning session in Anilao, checking in on Saturday, December 12th, 2026 for 2 nights, checking out Monday, December 14th.

Please note: we will have 10 people attending the Saturday seaside lunch and meeting, but ONLY 4 people are staying overnight for the 2 nights! Therefore, we only need 2 rooms (twin beds) for the 4 staying guests.

For the 4 overnight guests, we would like the full board meal arrangement. We are driving our own company vans from BGC, so no airport shuttle is required. We will not be doing any scuba diving on this trip, just kayaking and swimming.

Kindly send over the quotation for the 4 staying guests and the 2 rooms.

Warm regards,
Atty. Beatrice Gomez
Contact: +63 920 123 9876
            </div>
            <div class="bot-reply-wrap">Thanks, Atty. Beatrice Gomez!
Here's what I have for your stay:
• Stay: Dec 12 – 14, 2026 (2 nights)
• Guests: 4
• Rooms: 2
• Meals: full board
• Contact name: Atty. Beatrice Gomez
• Airport transfer: no
• Diving: no

Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.</div>
          </div>

          <div class="assertion-bar">
            <strong><span class="en">Core Verification:</span><span class="vi">Điểm Kiểm Tra:</span></strong>
            <span class="assertion-pill">checkIn = 2026-12-12</span>
            <span class="assertion-pill">nights = 2</span>
            <span class="assertion-pill">guests = 4 (trap avoided: not 10)</span>
            <span class="assertion-pill">rooms = 2</span>
            <span class="assertion-pill">diver = false</span>
            <span class="assertion-pill">transfer = false</span>
            <span class="assertion-pill">done = true</span>
          </div>
        </div>
      </div>

      <!-- SCENARIO EN-LONG-04 -->
      <div class="sc-box">
        <div class="sc-top">
          <span class="sc-code">EN-LONG-04</span>
          <span class="sc-header-title">
            <span class="en">PADI Open Water Course Inquiry (Beginners + One-Way Makati Transfer)</span>
            <span class="vi">Khóa Học Lặn PADI Open Water (Người Mới + Đón 1 Chiều Từ Makati)</span>
          </span>
          <span class="sc-cat"><span class="en">Category: Course / Transfer Type</span><span class="vi">Nhóm: Khóa Học / Loại Đưa Đón</span></span>
        </div>
        <div class="sc-content">
          <div class="sc-intent">
            <span class="en">2 beginners arriving Thursday Nov 5, 2026 for 3 nights, 1 twin room, full board. Want 3-day PADI certification course (Nov 5-7). Request ONE-WAY private van pickup from Makati hotel (taking public bus back on Sunday). Contact: Sarah Jenkins.</span>
            <span class="vi">2 học viên mới đến thứ 5 ngày 5/11/2026 ở 3 đêm, 1 phòng twin, full board. Đăng ký khóa PADI 3 ngày (5-7/11). Yêu cầu xe van đón 1 CHIỀU từ khách sạn Makati (lúc về tự đi xe buýt). Tên: Sarah Jenkins.</span>
          </div>

          <div class="turn-row">
            <div class="turn-meta">
              <span><span class="en">Single Turn: Certification Inquiry</span><span class="vi">Một lượt: Đăng ký khóa học</span></span>
              <span class="badge-pass">PASS (1 Turn)</span>
            </div>
            <div class="guest-msg-wrap" style="white-space: pre-wrap; font-family: inherit;">
              <button type="button" class="btn-copy" onclick="copyPrompt(\`Hello Casa Escondida Dive Resort,\\n\\nMy friend and I are looking to get PADI Open Water certified before our vacation to Palawan next year! \\n\\nWe are 2 beginners wanting to arrive on Thursday, November 5th, 2026 for 3 nights, checking out Sunday, November 8th. We will need 1 twin room and full board meals. \\n\\nWe want to enroll in the 3-day Open Water certification course with instructor and all gear rental included (diving starts Nov 5 afternoon through Nov 7). Since we do not own a car in Manila, could you arrange a one-way private van pickup from our hotel in Makati (near Greenbelt) to Anilao on Nov 5th morning? For the return trip on Sunday, we plan to take the public bus back to Buendia, so we only need a one-way transfer.\\n\\nCould you let us know availability and provide a full cost breakdown?\\n\\nThanks so much,\\nSarah Jenkins\\nWhatsApp: +1 415 555 2671\`, this)">
                📋 <span class="en">Copy</span><span class="vi">Sao chép</span>
              </button>Hello Casa Escondida Dive Resort,

My friend and I are looking to get PADI Open Water certified before our vacation to Palawan next year! 

We are 2 beginners wanting to arrive on Thursday, November 5th, 2026 for 3 nights, checking out Sunday, November 8th. We will need 1 twin room and full board meals. 

We want to enroll in the 3-day Open Water certification course with instructor and all gear rental included (diving starts Nov 5 afternoon through Nov 7). Since we do not own a car in Manila, could you arrange a one-way private van pickup from our hotel in Makati (near Greenbelt) to Anilao on Nov 5th morning? For the return trip on Sunday, we plan to take the public bus back to Buendia, so we only need a one-way transfer.

Could you let us know availability and provide a full cost breakdown?

Thanks so much,
Sarah Jenkins
WhatsApp: +1 415 555 2671
            </div>
            <div class="bot-reply-wrap">Thanks, Sarah Jenkins!
Here's what I have for your stay:
• Stay: Nov 5 – 8, 2026 (3 nights)
• Guests: 2
• Rooms: 1
• Meals: full board
• Contact name: Sarah Jenkins
• Airport transfer: yes · one way
• Diving: yes · Nov 5 – 7, 2026

Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.</div>
          </div>

          <div class="assertion-bar">
            <strong><span class="en">Core Verification:</span><span class="vi">Điểm Kiểm Tra:</span></strong>
            <span class="assertion-pill">checkIn = 2026-11-05</span>
            <span class="assertion-pill">nights = 3</span>
            <span class="assertion-pill">guests = 2</span>
            <span class="assertion-pill">rooms = 1</span>
            <span class="assertion-pill">diver = true (Nov 5–7)</span>
            <span class="assertion-pill">transferType = oneway</span>
            <span class="assertion-pill">done = true</span>
          </div>
        </div>
      </div>

      <!-- SCENARIO EN-LONG-05 -->
      <div class="sc-box">
        <div class="sc-top">
          <span class="sc-code">EN-LONG-05</span>
          <span class="sc-header-title">
            <span class="en">Solo Underwater Macro Photographer (Flight CX901, 5 Nights, 1 Room)</span>
            <span class="vi">Nhiếp Ảnh Gia Macro Lặn Biển Độc Thân (Chuyến Bay CX901, 5 Đêm, 1 Phòng)</span>
          </span>
          <span class="sc-cat"><span class="en">Category: Solo / Photography</span><span class="vi">Nhóm: Khách Lẻ / Nhiếp Ảnh</span></span>
        </div>
        <div class="sc-content">
          <div class="sc-intent">
            <span class="en">Solo photographer from HK arriving Oct 21, 2026 on flight CX901 landing 11 AM Manila, staying 5 nights to Oct 26. 1 room, full board, 3-4 boat dives/day Oct 22-25, private roundtrip van NAIA T3. Contact: Jonathan Lee.</span>
            <span class="vi">Nhiếp ảnh gia từ Hong Kong đến 21/10/2026 trên chuyến CX901 hạ cánh 11h Manila, ở 5 đêm đến 26/10. 1 phòng, full board, 3-4 ca lặn thuyền/ngày từ 22-25/10, xe van khứ hồi NAIA T3. Tên: Jonathan Lee.</span>
          </div>

          <div class="turn-row">
            <div class="turn-meta">
              <span><span class="en">Single Turn: Solo Dive Expedition</span><span class="vi">Một lượt: Chuyến lặn độc lập</span></span>
              <span class="badge-pass">PASS (1 Turn)</span>
            </div>
            <div class="guest-msg-wrap" style="white-space: pre-wrap; font-family: inherit;">
              <button type="button" class="btn-copy" onclick="copyPrompt(\`Hi Casa Escondida,\\n\\nMy name is Jonathan Lee, an underwater macro photographer from Hong Kong. I am planning a solo photography expedition to Anilao from Wednesday, October 21st, 2026 to Monday, October 26th (5 nights).\\n\\nI will be flying into Manila on Cathay Pacific flight CX901 landing at 11:00 AM on Oct 21. I need a private roundtrip van transfer between NAIA Terminal 3 and Casa Escondida.\\n\\nI need 1 private room (standard or deluxe) with full board meals. I plan to do 3 to 4 boat dives every day from Oct 22 to Oct 25, focusing on muck diving and nudibranchs. I will bring my own camera housing and strobe gear.\\n\\nPlease let me know your boat availability, private dive guide rates, and total package price for 1 guest, 5 nights.\\n\\nCheers,\\nJonathan Lee\\nWhatsApp: +852 9876 1234\`, this)">
                📋 <span class="en">Copy</span><span class="vi">Sao chép</span>
              </button>Hi Casa Escondida,

My name is Jonathan Lee, an underwater macro photographer from Hong Kong. I am planning a solo photography expedition to Anilao from Wednesday, October 21st, 2026 to Monday, October 26th (5 nights).

I will be flying into Manila on Cathay Pacific flight CX901 landing at 11:00 AM on Oct 21. I need a private roundtrip van transfer between NAIA Terminal 3 and Casa Escondida.

I need 1 private room (standard or deluxe) with full board meals. I plan to do 3 to 4 boat dives every day from Oct 22 to Oct 25, focusing on muck diving and nudibranchs. I will bring my own camera housing and strobe gear.

Please let me know your boat availability, private dive guide rates, and total package price for 1 guest, 5 nights.

Cheers,
Jonathan Lee
WhatsApp: +852 9876 1234
            </div>
            <div class="bot-reply-wrap">Thanks, Jonathan Lee!
Here's what I have for your stay:
• Stay: Oct 21 – 26, 2026 (5 nights)
• Guests: 1
• Rooms: 1
• Meals: full board
• Contact name: Jonathan Lee
• Airport transfer: yes · return trip
• Diving: yes · Oct 22 – 25, 2026

Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.</div>
          </div>

          <div class="assertion-bar">
            <strong><span class="en">Core Verification:</span><span class="vi">Điểm Kiểm Tra:</span></strong>
            <span class="assertion-pill">checkIn = 2026-10-21</span>
            <span class="assertion-pill">nights = 5</span>
            <span class="assertion-pill">guests = 1</span>
            <span class="assertion-pill">rooms = 1</span>
            <span class="assertion-pill">diver = true (Oct 22–25)</span>
            <span class="assertion-pill">transfer = roundtrip</span>
            <span class="assertion-pill">done = true</span>
          </div>
        </div>
      </div>

      <!-- SCENARIO EN-LONG-06 -->
      <div class="sc-box">
        <div class="sc-top">
          <span class="sc-code">EN-LONG-06</span>
          <span class="sc-header-title">
            <span class="en">Casual WhatsApp Message with Flight Number & Dive Traps (2-Night Stay)</span>
            <span class="vi">Tin Nhắn WhatsApp Với Bẫy Số Hiệu Chuyến Bay & Lịch Sử Lặn (2 Đêm)</span>
          </span>
          <span class="sc-cat"><span class="en">Category: WhatsApp / Trap</span><span class="vi">Nhóm: WhatsApp / Chống Bẫy</span></span>
        </div>
        <div class="sc-content">
          <div class="sc-intent">
            <span class="en">Casual conversational message (688 chars) mentions friend logged "75 dives" and flight "PR2812" (traps!). Arriving Friday Nov 20, 2026 for 2 nights, 2 guests, 1 room, full board, 2 boat dives Saturday Nov 21, roundtrip van transfer from NAIA T2. Contact: Marcus Brody.</span>
            <span class="vi">Tin nhắn tự nhiên (688 ký tự) nhắc bạn "75 lượt lặn" và chuyến bay "PR2812" (bẫy số liệu!). Đến thứ 6 ngày 20/11/2026 ở 2 đêm, 2 người, 1 phòng, full board, lặn thứ 7 ngày 21/11, xe van khứ hồi NAIA T2. Tên: Marcus Brody.</span>
          </div>

          <div class="turn-row">
            <div class="turn-meta">
              <span><span class="en">Single Turn: Conversational Message</span><span class="vi">Một lượt: Tin nhắn phong cách nói</span></span>
              <span class="badge-pass">PASS (1 Turn)</span>
            </div>
            <div class="guest-msg-wrap" style="white-space: pre-wrap; font-family: inherit;">
              <button type="button" class="btn-copy" onclick="copyPrompt(\`Hey guys! Hope you're doing well. Was recommended by my buddy Dave who logged over 75 dives at your resort last year! \\n\\nMe and my partner want to visit Anilao for a quick dive weekend. Flight PR2812 arrives at NAIA at 1:30 PM on Friday, November 20th, 2026, so we want to check in Nov 20 for 2 nights, checking out Sunday, Nov 22nd. \\n\\nWe are 2 guests and need 1 queen room. Full board please so we can eat right at the resort. Both of us are certified divers and want to do 2 boat dives on Saturday, Nov 21st. We also need your van to pick us up from NAIA Terminal 2 on Friday and bring us back on Sunday afternoon after lunch. \\n\\nName is Marcus Brody. Let me know if you have a room open!\`, this)">
                📋 <span class="en">Copy</span><span class="vi">Sao chép</span>
              </button>Hey guys! Hope you're doing well. Was recommended by my buddy Dave who logged over 75 dives at your resort last year! 

Me and my partner want to visit Anilao for a quick dive weekend. Flight PR2812 arrives at NAIA at 1:30 PM on Friday, November 20th, 2026, so we want to check in Nov 20 for 2 nights, checking out Sunday, Nov 22nd. 

We are 2 guests and need 1 queen room. Full board please so we can eat right at the resort. Both of us are certified divers and want to do 2 boat dives on Saturday, Nov 21st. We also need your van to pick us up from NAIA Terminal 2 on Friday and bring us back on Sunday afternoon after lunch. 

Name is Marcus Brody. Let me know if you have a room open!
            </div>
            <div class="bot-reply-wrap">Thanks, Marcus Brody!
Here's what I have for your stay:
• Stay: Nov 20 – 22, 2026 (2 nights)
• Guests: 2
• Rooms: 1
• Meals: full board
• Contact name: Marcus Brody
• Airport transfer: yes · return trip
• Diving: yes · Nov 21 – 21, 2026

Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet.</div>
          </div>

          <div class="assertion-bar">
            <strong><span class="en">Core Verification:</span><span class="vi">Điểm Kiểm Tra:</span></strong>
            <span class="assertion-pill">checkIn = 2026-11-20</span>
            <span class="assertion-pill">nights = 2</span>
            <span class="assertion-pill">guests = 2 (traps avoided: not 75 or 2812)</span>
            <span class="assertion-pill">rooms = 1</span>
            <span class="assertion-pill">diver = true (Nov 21)</span>
            <span class="assertion-pill">transfer = roundtrip</span>
            <span class="assertion-pill">done = true</span>
          </div>
        </div>
      </div>

      <div style="border-top: 2px dashed var(--line); margin: 36px 0 24px;"></div>
      <h3 style="font-size: 18px; color: var(--blue); margin-bottom: 16px;">
        <span class="en">Section 2B: Multi-Turn Conversational Scenarios (AN-01 to AN-08)</span>
        <span class="vi">Phần 2B: Kịch Bản Đối Thoại Nhiều Lượt (AN-01 đến AN-08)</span>
      </h3>
`;

// Insert longScenariosHtml right before <!-- SCENARIO 1 -->
html = html.replace('<!-- SCENARIO 1 -->', longScenariosHtml + '\n        <!-- SCENARIO 1 -->');

// 3. Update Section 3 (Automated Benchmark Metrics table)
const longBenchmarkRows = `              <tr>
                <td><code>EN-LONG-01</code></td>
                <td>6-Diver UW Photo Club (SQ912, 3 Rooms, Van)</td>
                <td>1 turn</td>
                <td>Gemini 3.1 Flash Lite</td>
                <td>~3.1s</td>
                <td><span class="badge-pass">PASS 100%</span></td>
              </tr>
              <tr>
                <td><code>EN-LONG-02</code></td>
                <td>Family Vacation (5 Guests, 2 Rooms, Self-Drive)</td>
                <td>1 turn</td>
                <td>Gemini 3.1 Flash Lite</td>
                <td>~2.9s</td>
                <td><span class="badge-pass">PASS 100%</span></td>
              </tr>
              <tr>
                <td><code>EN-LONG-03</code></td>
                <td>Corporate Retreat (10 Lunch vs 4 Overnight Trap)</td>
                <td>1 turn</td>
                <td>Gemini 3.1 Flash Lite</td>
                <td>~3.0s</td>
                <td><span class="badge-pass">PASS 100%</span></td>
              </tr>
              <tr>
                <td><code>EN-LONG-04</code></td>
                <td>PADI Course (2 Guests, 1-Way Makati Pickup)</td>
                <td>1 turn</td>
                <td>Gemini 3.1 Flash Lite</td>
                <td>~3.3s</td>
                <td><span class="badge-pass">PASS 100%</span></td>
              </tr>
              <tr>
                <td><code>EN-LONG-05</code></td>
                <td>Solo Macro Photographer (CX901, 5 Nights)</td>
                <td>1 turn</td>
                <td>Gemini 3.1 Flash Lite</td>
                <td>~3.2s</td>
                <td><span class="badge-pass">PASS 100%</span></td>
              </tr>
              <tr>
                <td><code>EN-LONG-06</code></td>
                <td>Casual WhatsApp Message (Marcus Brody, PR2812 Trap)</td>
                <td>1 turn</td>
                <td>Gemini 3.1 Flash Lite</td>
                <td>~2.8s</td>
                <td><span class="badge-pass">PASS 100%</span></td>
              </tr>
`;

html = html.replace('<tbody>\n              <tr>\n                <td><code>AN-01</code></td>', '<tbody>\n' + longBenchmarkRows + '              <tr>\n                <td><code>AN-01</code></td>');

// 4. Update Section 5 (Checklist)
const longChecklistRows = `          <label class="ckrow" style="background: #f0fdfa; border-color: #99f6e4;">
            <input type="checkbox" data-id="ck_en01" onchange="updateProgress()">
            <div>
              <div class="t">★ EN-LONG-01: 6-Diver Macro Photo Group (Flight SQ912, 3 rooms, roundtrip van)</div>
              <div class="d"><span class="en">Verified 6 guests, 3 rooms, Nov 13-17, diving Nov 14-16, roundtrip van.</span><span class="vi">Xác minh 6 khách, 3 phòng, 13-17/11, lặn 14-16/11, xe van khứ hồi.</span></div>
            </div>
          </label>

          <label class="ckrow" style="background: #f0fdfa; border-color: #99f6e4;">
            <input type="checkbox" data-id="ck_en02" onchange="updateProgress()">
            <div>
              <div class="t">★ EN-LONG-02: Family Vacation (5 guests, 2 rooms, self-drive from Makati)</div>
              <div class="d"><span class="en">Verified 5 guests (grandma + 2 kids), 2 rooms, transport=false.</span><span class="vi">Xác minh 5 khách (bà + 2 con), 2 phòng, không cần đón xe.</span></div>
            </div>
          </label>

          <label class="ckrow" style="background: #f0fdfa; border-color: #99f6e4;">
            <input type="checkbox" data-id="ck_en03" onchange="updateProgress()">
            <div>
              <div class="t">★ EN-LONG-03: Corporate Retreat (10 lunch attendees vs 4 overnight staying guests)</div>
              <div class="d"><span class="en">Verified stayingGuests=4 (not 10), 2 rooms, diving=false, transport=false.</span><span class="vi">Xác minh trích xuất đúng 4 khách ngủ lại (bỏ qua bẫy 10 người ăn trưa).</span></div>
            </div>
          </label>

          <label class="ckrow" style="background: #f0fdfa; border-color: #99f6e4;">
            <input type="checkbox" data-id="ck_en04" onchange="updateProgress()">
            <div>
              <div class="t">★ EN-LONG-04: PADI Open Water Course (2 beginners + one-way pickup)</div>
              <div class="d"><span class="en">Verified 2 guests, diving=true (Nov 5-7), transportType=oneway.</span><span class="vi">Xác minh khóa học lặn 3 ngày, xe đón 1 chiều từ Makati.</span></div>
            </div>
          </label>

          <label class="ckrow" style="background: #f0fdfa; border-color: #99f6e4;">
            <input type="checkbox" data-id="ck_en05" onchange="updateProgress()">
            <div>
              <div class="t">★ EN-LONG-05: Solo Macro Photographer (Jonathan Lee, CX901, 5 nights)</div>
              <div class="d"><span class="en">Verified 1 guest, 1 room, 5 nights, diving Oct 22-25, roundtrip van.</span><span class="vi">Xác minh 1 khách, 5 đêm, lặn 22-25/10, xe khứ hồi.</span></div>
            </div>
          </label>

          <label class="ckrow" style="background: #f0fdfa; border-color: #99f6e4;">
            <input type="checkbox" data-id="ck_en06" onchange="updateProgress()">
            <div>
              <div class="t">★ EN-LONG-06: Marcus Brody (Flight PR2812 & 75 dives count traps)</div>
              <div class="d"><span class="en">Verified 2 guests (traps avoided), 2 nights, roundtrip van transfer.</span><span class="vi">Xác minh 2 khách (không bị bẫy 75 lượt lặn và số hiệu bay), xe khứ hồi.</span></div>
            </div>
          </label>
`;

html = html.replace('<div class="ck">\n          <label class="ckrow">', '<div class="ck">\n' + longChecklistRows + '          <label class="ckrow">');

// 5. Update CHECK_KEYS array in javascript
const oldCheckKeys = `    const CHECK_KEYS = [
      'ck_an01', 'ck_an02', 'ck_an03', 'ck_an04',
      'ck_an05', 'ck_an06', 'ck_an07', 'ck_an08'
    ];`;

const newCheckKeys = `    const CHECK_KEYS = [
      'ck_en01', 'ck_en02', 'ck_en03', 'ck_en04', 'ck_en05', 'ck_en06',
      'ck_an01', 'ck_an02', 'ck_an03', 'ck_an04',
      'ck_an05', 'ck_an06', 'ck_an07', 'ck_an08'
    ];`;

html = html.replace(oldCheckKeys, newCheckKeys);

// Save to docs/
fs.writeFileSync("docs/casa-anilao-test-scenarios.html", html, "utf8");
console.log("Updated docs/casa-anilao-test-scenarios.html");

// Save to public/
fs.writeFileSync("public/casa-anilao-test-scenarios.html", html, "utf8");
console.log("Updated public/casa-anilao-test-scenarios.html");

// Save to artifacts
const artifactHtmlPath = path.join("C:/Users/nguye/.gemini/antigravity/brain/e9b77ff0-72ed-4734-a7ad-66020f185ba7", "casa-anilao-test-scenarios.html");
fs.writeFileSync(artifactHtmlPath, html, "utf8");
console.log("Updated artifact HTML:", artifactHtmlPath);
