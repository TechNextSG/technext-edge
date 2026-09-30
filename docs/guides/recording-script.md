# Kịch bản tự quay bằng Snipping Tool — từng màn một (~6 phút)

Quay **từng màn riêng**, không chia đôi màn hình: mỗi màn là một take ngắn, sau đó ghép lại theo thứ tự.
Lợi thế: hỏng đoạn nào chỉ quay lại đúng đoạn đó. Lời thuyết minh bằng tiếng Anh, đọc trực tiếp khi quay
(bật micro trong Snipping Tool) hoặc đọc lại sau.

Nội dung bám đúng lượt chạy thật ngày 29/09 trên production: các bước, câu bot trả và con số (₱31.200) bên
dưới là những gì đã thấy.

---

## 0. Quy tắc quan trọng nhất: thứ tự và điểm không quay lại

Các take **phải quay đúng thứ tự 1 → 2 → 3 → 4**, vì trạng thái nối tiếp nhau (báo giá sinh ở take 1, được
duyệt ở take 2, link tới ở take 3). Và:

> **Bấm "Create link & send" ở take 2 là điểm không quay lại.** Sau đó báo giá đóng băng, không sửa được.
> Nếu take 2 hỏng **trước** bước này thì quay lại take 2. Nếu hỏng **sau** bước này, phải `reset` và quay lại
> từ take 1 với một cuộc hỏi mới.

Vì vậy: **diễn tập cả chuỗi một lần trước (không quay)**, rồi `reset` và quay bản chính.

---

## 1. Chuẩn bị (10 phút, trước khi bấm quay)

**Thiết lập chung**

1. Mở **hai cửa sổ trình duyệt riêng**: một cho WhatsApp Web (đã mở sẵn luồng chat với `+1 (555) 150-6595`),
   một cho studio (đã đăng nhập ở `/login`; phiên chỉ sống **8 giờ**, đăng nhập lại ngay trước khi quay;
   đừng dán khoá lên URL).
2. Snipping Tool: `Win + Shift + R` → chọn vùng → bật micro nếu đọc trực tiếp, tắt âm thanh hệ thống. Bản
   Windows 11 mới có nút **Pause** trong lúc quay, dùng khi bot đang nghĩ nếu muốn cắt khoảng chờ.
3. Bật **Không làm phiền** của Windows, đóng Zalo/Teams/Slack, ẩn thanh dấu trang, phóng to 100%.
4. Mỗi take: **đứng yên 2 giây** đầu và cuối để dễ cắt khi ghép.

**Riêng tư — bắt buộc với các take WhatsApp**

WhatsApp Web hiện **danh bạ thật** ở bên trái (tên đồng nghiệp, nhóm nội bộ, số điện thoại). Khi chọn vùng quay
cho WhatsApp, **kéo vùng bắt đầu ngay sau đường kẻ dọc ngăn danh bạ**, chỉ ôm khung hội thoại bên phải. Kiểm
bằng mắt sau khi chọn vùng, trước khi bấm quay: trong vùng không được có tên ai khác. Ở màn hình 1920 px,
danh bạ chiếm khoảng 660 px bên trái. Vùng còn lại xấp xỉ tỉ lệ 3:2 — bình thường.

**Dữ liệu**

5. Số của bạn phải nằm trong danh sách test của Meta (số đang dùng: `84359386414`).
6. Gửi thử `hi`, chờ bot trả lời để chắc quota model còn. Nếu im hoặc báo *"something went wrong on our
   side"* thì đợi ~1 phút. Đừng để lỗi này xảy ra giữa lúc đang quay.
7. Sau buổi diễn tập, **`reset`** để bắt đầu từ luồng chat sạch. `reset` là công cụ test của bạn, **không nhắn
   nó trong lúc quay**.
8. Giao diện WhatsApp đang là **tiếng Việt** ("Soạn tin nhắn", "Hôm nay"). Đổi sang tiếng Anh nếu được; nếu
   không thì đừng để camera dừng lâu ở các nhãn đó.

---

## 2. Các take

### Take 1 — WhatsApp: khách nhắn, bot hỏi một câu (~2:10)

Vùng quay: **chỉ khung hội thoại** của WhatsApp (xem mục Riêng tư).

| Giờ | Làm | Nói (tiếng Anh) |
|---|---|---|
| 0:00 | Đứng yên, chưa gõ | *"This is a real run on our production system. A guest is talking to the resort's WhatsApp number. Prices you'll see later are sample data, and I'll say so when it matters."* |
| 0:20 | Gõ và gửi **Tin 1** (bên dưới). Chờ bot; đừng gõ thêm gì | *"Ana writes the way guests really write: dates, two people, one diver, full board. She doesn't say which room she wants."* |
| 0:50 | Bot trả lời. Để nguyên 6 giây | *"The reply reads everything back correctly and asks just one question: standard, deluxe or suite. It doesn't ask again for anything she already said."* |
| 1:15 | Gửi **Tin 2**: `Deluxe please`. Chờ bot | *"She answers, 'Deluxe please'."* |
| 1:40 | Bot trả lời. Để nguyên 6 giây | *"The summary now says Deluxe, and it makes two things clear: nothing is booked yet, and the team is preparing a quotation. There is no price and no link. The assistant is not allowed to quote."* |
| 2:10 | Đứng yên 2 giây, dừng quay | — |

**Tin 1 — copy nguyên văn:**

> Hi, I'm Ana Reyes. 2 guests, 1 room, 2 nights from 2026-11-20 to 2026-11-22. Full board please. No airport transfer. 1 diver, diving on 2026-11-21.

### Take 2 — Studio: nhân viên duyệt và gửi (~2:30)

Vùng quay: cửa sổ trình duyệt của studio (toàn bộ, không có gì riêng tư).

| Giờ | Làm | Nói (tiếng Anh) |
|---|---|---|
| 0:00 | Mở studio, **làm mới**. Báo giá mới ở đầu danh sách: **Needs review**, phòng `deluxe`, *not priced yet* | *"On the staff side the quotation has appeared by itself. Room type deluxe, not priced yet. Staff can correct the facts here — rooms, who dives which day — but they never type a price."* |
| 0:35 | Bấm **Save & get price**, chờ vài giây | *"Get price asks the resort's booking engine. The total is thirty-one thousand two hundred pesos, and it's labelled as a sample."* |
| 1:05 | **Continue to approve →**, rồi **Approve quotation** | *"A person approves it. Nothing goes to the guest before this."* |
| 1:30 | Tick **I have checked this sample price** | *"Sending is a deliberate step. The staff member confirms they've checked the sample price…"* |
| 1:45 | Bấm **Create link & send — MỘT lần, rồi chờ, không bấm lại** | *"…and presses send once."* |
| 2:10 | Đợi tới khi ghi **Sent to guest** và dòng *"the trip and its price are frozen"* | *"The quotation is now frozen. To change it, staff start a new one."* |
| 2:30 | Đứng yên 2 giây, dừng quay | — |

### Take 3 — WhatsApp: khách nhận link (~0:30)

Vùng quay: khung hội thoại WhatsApp, như take 1.

| Giờ | Làm | Nói (tiếng Anh) |
|---|---|---|
| 0:00 | Tin thứ ba từ resort đã hiện, có link. Để nguyên 8 giây | *"The guest receives the link, a notice that these are sample prices, and again: nothing is booked yet."* |
| 0:20 | **Copy link** (chưa mở), dừng quay | — |

### Take 4 — Trang khách: link mở ra (~0:50)

Vùng quay: cửa sổ trình duyệt. **Mở link ngay sau take 3, đừng để lâu.**

| Giờ | Làm | Nói (tiếng Anh) |
|---|---|---|
| 0:00 | Dán link vào thanh địa chỉ, mở | *"This is the customer's own quotation app, opened from that link."* |
| 0:12 | Để nguyên; rê chuột qua tổng tiền | *"Version one, total thirty-one thousand two hundred pesos, with a sample-data banner."* |
| 0:30 | Đứng yên | *"Two honest notes. The room line still says 'Standard A', because the customer's test engine returns a captured price — the room type we sent is deluxe, and with Odoo connected that line follows it. And every price here is a sample until Odoo is connected."* |
| 0:50 | Dừng quay | — |

### Take 5 (tuỳ chọn, chỉ để dùng nội bộ) — một khách hỏi giá rồi muốn huỷ (tin nhắn đầy đủ: mục 6, ca B1 và B2)

Làm **sau khi đã quay xong take 1–4**, vì cần `reset` (reset không đóng báo giá đã publish). Video này bộc lộ
hai điểm chưa hoàn thiện, nên chỉ dùng nội bộ. Vùng quay: khung hội thoại WhatsApp.

1. `reset`, rồi gửi: `Hi, how much is a deluxe room for 2 people for 2 nights? Can we get a discount?`
   Bot **không nêu con số nào và không hứa giảm giá** — nhưng cũng **không trả lời câu hỏi giá**, chỉ nói về
   giảm giá. Ghi nhận đúng như vậy.
2. Gửi: `I want to cancel my booking please`. Bot dừng, nói một người sẽ trả lời. Đổi sang studio, mở `/handoff`:
   thread hiện lý do **Cancellation / complaint** kèm tin của khách.

---

## 3. Không làm khi đang quay

Mỗi mục đã thấy hoặc đã đo là gây rắc rối:

- **Nhắn thêm bất cứ gì vào WhatsApp sau khi đã nhận link**, kể cả "thanks!". Nó sinh ra một báo giá mới trùng, và bot lại nói "đang chuẩn bị báo giá".
- **Bấm đúp "Create link & send".** Bấm một lần và chờ.
- **Gõ `reset` khi đang quay** take 1–4.
- **Viết ngày dạng `dd/mm/yyyy`.** Luôn dùng `2026-11-20` như Tin 1.
- **Nhắc chữ "agency" hay "agent"** trong tin nhắn.
- **Mở báo giá `QT-1010-SKY` rồi bấm Publish.** Nó bị từ chối (đúng thiết kế) nhưng sẽ làm người xem thắc mắc.
- **Đọc hoặc hiện khoá nhân viên trên màn hình**, kể cả lúc đăng nhập. Đăng nhập trước khi bấm quay.
- **Zoom vào các dòng `* *Guest Name:*` trong bản tóm tắt của bot** (xem mục 5).

---

## 4. Nếu có sự cố khi đang quay

| Hiện tượng | Làm gì |
|---|---|
| Bot im hoặc báo *"something went wrong on our side"* | Dừng take, đợi 1 phút. Nếu chưa bấm Create link & send thì `reset` và quay lại take 1 |
| Link mở ra *"not valid or has expired"* | App demo phía khách đôi khi không tìm thấy link (đo được: có lúc 6/6 lần 404, một phút sau 6/6 lần 200). Thử tải lại vài lần. Nếu vẫn lỗi, bấm **Send the message again** ở studio một lần, hệ thống sẽ gửi bản sao của mình; nếu dùng đoạn đó thì nói rõ đó là bản sao |
| Tin không tới, webhook báo `failed:1` | Số chưa có trong danh sách test Meta (`#131030`). Thêm số rồi quay lại |
| Bấm nhầm hoặc vấp trong take 1, 3 hay 4 | Quay lại đúng take đó |
| Bấm nhầm hoặc vấp trong take 2 **sau** khi đã bấm Create link & send | Không sửa được. `reset` và quay lại từ take 1 |

---

## 5. Điều cần biết trước khi phát video này

Đo trong lượt chạy 29/09:

1. **Bản tóm tắt của bot hiện dấu `*` thừa** trên WhatsApp: model viết Markdown (`**Guest Name:**`, bullet `* `)
   mà WhatsApp chỉ hiểu một dấu sao. Nó xuất hiện ở mọi bản tóm tắt do model viết, tức ngay Tin 1 và Tin 2.
   Người xem sẽ thấy `*  *Guest Name:* Ana Reyes`. Đây là lỗi hiển thị nhỏ nhưng nằm trên đường demo.
   **Nếu video gửi cho khách, nên sửa trước khi quay** (một hàm nhỏ đổi `**x**` thành `*x*` và `* ` đầu dòng
   thành `•`, khoảng 15 phút cộng test). Nếu là video nội bộ thì để nguyên và nói thẳng.
2. **Hỏi "how much?" thì bot không trả lời câu hỏi giá** (chỉ nói về giảm giá). Không nằm trong take 1–4.
3. **Link của app khách chập chờn**, xem bảng sự cố ở trên.
4. **Chưa ai chạy đúng chuỗi ghép này một mạch từ đầu.** Diễn tập một lần không lưu trước khi quay bản chính.

---

## 6. Kho tin nhắn — copy nguyên văn, gửi đúng thứ tự

**Quy tắc chung cho mọi ca dưới đây**

- **Gửi `reset` trước mỗi ca** (chỉ từ số test của bạn). Chờ bot chào lại rồi mới gửi tin đầu của ca.
- **Gửi từng tin một, chờ bot trả lời xong** rồi mới gửi tin kế. Bot thường mất 5–15 giây.
- Dán nguyên văn, đừng gõ lại (dấu nháy, dấu chấm và ngày dạng `2026-11-20` đều có chủ ý).
- Nhãn trạng thái của từng ca:
  - ✅ **đã thấy tận mắt ngày 29/09** trên production;
  - 📄 **theo runbook**, đã chạy bằng script ngày 27–28/09, chưa thấy lại hôm nay;
  - ⚠️ **lỗi đã biết**, chạy thấy đúng như mô tả là bình thường, không phải bạn làm sai;
  - 🆕 **tin do tôi soạn mới, chưa chạy lần nào** — runbook chỉ mô tả ca đó, không có nguyên văn. Kết quả ghi
    bên cạnh là **dự đoán từ đọc code**, không phải đã thấy. Chạy ca nào thì ghi lại kết quả thật.
- Chữ trong ngoặc kép ở cột "Bot phải trả lời" là ý chính, không nhất thiết từng chữ (model viết lại mỗi lần).

### A. Luồng chính (dùng cho take 1–4) ✅

| # | Gửi | Bot phải trả lời |
|---|---|---|
| A1 | `reset` | ✅ *"Conversation reset! Welcome to Casa Escondida…"* |
| A2 | `Hi, I'm Ana Reyes. 2 guests, 1 room, 2 nights from 2026-11-20 to 2026-11-22. Full board please. No airport transfer. 1 diver, diving on 2026-11-21.` | ✅ Đọc lại đúng ngày, 2 khách, 1 phòng, full board, 1 người lặn 21/11, không cần xe. **Hỏi đúng một câu:** *"Would you prefer a standard, deluxe, or suite room?"* Không link, không giá. ⚠️ có dấu `*` thừa trong phần tóm tắt |
| A3 | `Deluxe please` | ✅ Tóm tắt có `Room type: Deluxe`, *"nothing is booked yet"*, *"Our reservations team is preparing your quotation now…"*. Không link, không giá |

Sau A3 chuyển sang studio (take 2). **Đừng gửi thêm gì** cho tới khi nhận tin thứ ba có link.

### B. Ca dùng cho video nội bộ / kiểm thử (mỗi ca quay riêng, sau take 1–4)

**B1. Hỏi giá và giảm giá** ✅ (take 5)

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B1.1 | `reset` | chào lại |
| B1.2 | `Hi, how much is a deluxe room for 2 people for 2 nights? Can we get a discount?` | ✅ **Không có con số tiền nào, không hứa giảm giá.** Nói sẽ xem gói khi có ngày cụ thể, hỏi ngày nhận phòng, có lặn không, tên. ⚠️ không trả lời câu hỏi giá; có dấu `*` thừa |

**B2. Khách muốn huỷ** ✅ (take 5)

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B2.1 | `I want to cancel my booking please` | ✅ Bot dừng, nói một thành viên Casa sẽ trả lời, giờ mở cửa lễ tân tới 9 PM giờ Manila. **Không hỏi ngày**. Studio `/handoff` ghi *Cancellation / complaint* kèm tin này |

Thử thêm, mỗi tin sau một `reset`: `I want a refund` · `this is a complaint` · `Please cancel my booking for next week` 📄

**B3. Câu hỏi không phải đặt phòng** 📄

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B3.1 | `hey what is the wifi password?` | Nói số này dành cho yêu cầu đặt phòng mới, đã chuyển đội ngũ. `/handoff` ghi *Not a booking enquiry* |
| B3.2 | (sau `reset`) `do you have a room for two on Saturday?` | Đối chứng: coi là **đặt phòng bình thường**, không bị chuyển người |

**B4. Thiếu thông tin, hai lượt** 📄

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B4.1 | `Hi, 4 of us, full board, we want to dive.` | Hỏi **ngày nhận phòng** và **số đêm** |
| B4.2 | `Oct 17 to Oct 20, so 3 nights, 2 deluxe rooms, name is Miguel.` | **Không hỏi lại số đêm** (đã suy ra từ khoảng ngày); đi tới tóm tắt; không link |

**B5. Hỏi loại phòng riêng** 📄

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B5.1 | `Hi, 2 of us from Nov 20 to Nov 22, full board, no transfer, no diving, name is Ana.` | Hỏi đúng một câu: *"Would you like a standard, deluxe, or suite room?"* |
| B5.2 | `Deluxe please` | Tóm tắt có `Room type: deluxe`, không link |

**B6. Lịch lặn lẻ ngày** 📄

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B6.1 | `We are 6 guests staying 3 nights from 2026-12-01 in 3 deluxe rooms, full board, no transfer. Diving: 1 person dives day 1, 5 people dive both days. Name is Ana.` | **Không hỏi** "How many of you will be diving?". Thay vào đó: *"We've noted your diving plan (…) — our team will confirm the day-by-day details with you."* Không có chữ "routed to staff" hay "per-day quote calculation" |

**B7. Khách đổi số giữa chừng** 📄

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B7.1 | `we are 5 of us` | hỏi tiếp các thông tin còn thiếu |
| B7.2 | `sorry, actually 3 of us` | Đọc lại một lần: *"Just to check — … 5 guests → 3 guests …"* |
| B7.3 | `yes that's right` | **Không nhắc lại** lần nữa |

**B8. Khách đổi số sau khi báo giá đã được duyệt (nhưng chưa publish)** 📄

Làm **ngay sau A3 và sau khi Approve ở studio, trước khi bấm Create link & send**:

| # | Gửi | Studio phải thấy |
|---|---|---|
| B8.1 | `Sorry, there are 4 of us` | Giữ **nguyên mã báo giá**, nhưng mất duyệt, có dòng *"The guest changed the trip after it was priced…"*. Phải Approve lại mới gửi được |

**B9. Nói mãi không chốt** 📄

| # | Gửi (lần lượt 4 tin, chờ bot sau mỗi tin) | Bot phải trả lời |
|---|---|---|
| B9.1 | `hmm` | hỏi lại |
| B9.2 | `not sure yet` | hỏi lại |
| B9.3 | `still thinking` | hỏi lại |
| B9.4 | `maybe later` | **Dừng hỏi**, báo đã chuyển cho người, kèm danh sách còn thiếu. `/handoff` ghi *Stuck — same questions open* |

**B10. Lịch lặn nằm ngoài kỳ ở** 🆕

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B10.1 | `Hi, I'm Ben Cruz. 2 guests, 1 deluxe room, 2 nights from 2026-11-20 to 2026-11-22. Full board. No transfer. 2 divers, diving on 2026-11-25.` | **Hỏi lại ngày lặn**, kèm khoảng ngày ở (20–22/11), không chấp nhận 25/11 |

**B11. Tiếng Trung** 📄

| # | Gửi | Bot phải trả lời |
|---|---|---|
| B11.1 | `我想找人工客服` | Câu giữ chỗ **bằng tiếng Trung** |
| B11.2 | (sau `reset`) `我们4个人，11月20日入住，住2晚，要豪华房，全餐，不需要接送，我的名字是 Miguel。` | Tóm tắt tiếng Trung có dòng `• 房型: 豪华房`, không link |

### C. Ca cho thấy lỗi đã biết (chỉ để ghi nhận, đừng đưa vào video khách)

Kết quả ở đây **đọc từ code và từ các phát hiện trước**, chưa ca nào được chạy lại trên production hôm nay.

| # | Gửi | Nhãn | Bạn sẽ thấy nếu đúng như đã phân tích |
|---|---|---|---|
| C1 | Sau khi đã nhận link ở take 3: `thanks!` — hoặc `actually we are 3 now` | ⚠️ | Bot lại nói *"Our reservations team is preparing your quotation now"*, studio có thêm **một báo giá mới trùng**, link cũ vẫn sống ở giá cũ |
| C2 | Gửi một **voice note** (giữ nút micro 2 giây rồi thả) hoặc **một ảnh** | ⚠️ | **Không có phản hồi nào.** Webhook bỏ qua, nhân viên cũng không thấy gì |
| C3 | `Hi, I'm Kenji Sato. 2 guests, 1 room, from 2026-11-20 to 2026-11-22. 日本から来ました。` | 🆕 ⚠️ | Trả lời bằng **tiếng Trung** (bộ nhận diện chỉ tìm chữ Hán, và tiếng Nhật dùng chữ Hán) |
| C4 | `Hi, I'm Lea. 2 guests, 1 deluxe room, check in 10/12/2026 for 2 nights.` | 🆕 ⚠️ | Đọc `10/12` thành **10 tháng 12** (luôn đọc ngày trước khi có năm), trong khi khách Philippines thường viết tháng trước. **Đọc dòng tóm tắt bot đọc lại** |
| C5 | Từ số **không phải số test**, gửi đúng `start over` | ⚠️ | Xoá thread và đóng báo giá đang mở, kể cả bản đã duyệt. Chỉ thử được nếu bạn có một số thứ hai trong danh sách test Meta |
| C6 | `Hi, I'm from Blue Reef Travel Agency, booking for 4 guests, 3 nights from 2026-11-20.` | 🆕 ⚠️ | Bot nhận ra là đại lý và **mời tự đăng nhập app báo giá** thay vì tạo báo giá giá lẻ. Đường dẫn đăng nhập đó **chưa được kiểm với app thật** |

### Lịch gợi ý cho một buổi quay đầy đủ

1. **Take 1–4** với A1 → A3 rồi studio (kịch bản chính, ~6 phút).
2. Nếu muốn video nội bộ: **B1, B2** (đã thấy hôm nay), rồi **B3, B9** (ngắn, dễ quay).
3. Quay **B8** trong lúc làm take 2, đúng vị trí: sau Approve và trước Create link & send.
4. **B4, B5, B6, B7, B10, B11** là kiểm thử, không cần quay video.
5. **C1–C6** chỉ ghi nhận bằng ảnh chụp và ghi vào bảng kết quả ở `docs/guides/manual-test-production.md` §2b.
