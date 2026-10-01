# Kịch Bản & Bộ Test Case Nâng Cao (100% Live Verified)

Tài liệu này tổng hợp **6 kịch bản thử thách chuyên sâu (Stress & Edge Cases)** với **Input đầy đủ 100% dữ kiện** (Tên khách, Ngày đến/đi, Số người, Loại phòng, Bữa ăn, Lịch lặn, Xe đưa đón).

> 💡 **Giao diện HTML trực quan (có nút 1-Click Copy Prompt & Bảng giá):**  
> 👉 [`docs/guides/advanced-demo-scenarios.html`](advanced-demo-scenarios.html)

---

## 💬 Hướng Dẫn Nhanh: Luồng WhatsApp Đang Mở Dở Với David

Nếu bạn vừa gửi Case 1 cũ và bot hỏi lại:
> *"You mentioned you were looking for 1 standard and 1 deluxe room. Just to confirm, would you like a standard, deluxe, or suite room for each of these bookings?"*

👉 **Chỉ cần gửi tin nhắn sau vào WhatsApp:**
```text
Please make both 2 Deluxe rooms.
```
Bot sẽ ngay lập tức chốt đơn, tạo mã Báo Giá trên Quotation Studio và trả về tóm tắt đầy đủ!

---

## Mục lục Kịch Bản

1. [Case 1: Nhóm hỗn hợp (Lặn có chứng chỉ + Học viên AOW + Nghỉ dưỡng) - David](#case-1-david)
2. [Case 2: Khách Trung Quốc (Chinese zh: Deluxe + Lặn + Xe đưa đón) - Chen Wei](#case-2-chen-wei)
3. [Case 3: Khách đổi ý liên tục (Conversation State Machine & Fact Gate) - Alex](#case-3-alex)
4. [Case 4: Yêu cầu đưa đón sân bay & Thuật toán chia xe (Van Split Algorithm) - Robert](#case-4-robert)
5. [Case 5: Khách B2B / Đại lý / Dive Instructor (Chính sách chiết khấu 30%) - Marcus](#case-5-marcus)
6. [Case 6: Phòng thủ gian lận / Nhồi nhét phòng (Room Capacity Guard) - Kevin](#case-6-kevin)

---

<a id="case-1-david"></a>
### Case 1: Nhóm hỗn hợp (Lặn có chứng chỉ + Học viên AOW + Nghỉ dưỡng)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Ngôn ngữ:** English (`en`)
- **Đặc điểm:** Prompt 1-shot đầy đủ 100% dữ kiện (David, John, Sarah) với 2 phòng Deluxe đồng nhất.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi Casa Escondida! I'm David. We are a group of 3 friends planning a trip from Dec 10 to Dec 13 (3 nights) with full board. We need 2 deluxe rooms for the 3 of us. Regarding activities: I will dive on Dec 11 and Dec 12; John wants to take the Advanced Open Water (AOW) course; Sarah does not dive at all, just relaxation and meals. No airport transfer needed. Please prepare our detailed quotation!
```

#### 2. Kết quả đầu ra thực tế (Live Verified):
- **Phản hồi của Bot trên WhatsApp (Không hỏi lại, tạo đơn ngay):**
  > *"Hi David! It’s a pleasure to assist you.*  
  > *Thank you for providing those details. I’ve carefully noted your specific group arrangements: David diving on Dec 11 and 12, John undertaking his Advanced Open Water (AOW) course, and Sarah joining you for full-board relaxation while you explore our reefs.*  
  > *Here is the summary of your request:*  
  > *• Stay: Dec 10 – 13, 2026 (3 nights)*  
  > *• Guests: 3*  
  > *• Rooms: 2 Deluxe Rooms*  
  > *• Meals: Full board*  
  > *• Contact name: David*  
  > *• Airport transfer: Not required*  
  > *• Diving: Yes (David diving Dec 11–12; John taking AOW course; Sarah no diving)*  
  > *• Guest names: David, John, Sarah"*
- **Mã Báo Giá:** `QT-1210-DAVI-5325FCBD`
- **Tổng tiền trên Studio:** ₱80,700
- **Lưu ý kiến trúc:** Schema `Trip.roomType` áp dụng 1 hạng phòng cho mỗi booking (`standard | deluxe | suite`). Việc chọn 2 phòng Deluxe giúp tạo đơn 1-shot không bị vướng câu hỏi phân tách hạng phòng.

---

<a id="case-2-chen-wei"></a>
### Case 2: Khách Trung Quốc (Chinese zh: Deluxe + Lặn + Xe đưa đón)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Ngôn ngữ:** Chinese (`zh`)
- **Đặc điểm:** Prompt 1-shot bằng tiếng Trung chuẩn. Resort Casa Escondida Anilao phục vụ khách quốc tế, hỗ trợ bản địa hóa sâu tiếng Anh và tiếng Trung.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
你好 Casa Escondida！我是陈伟（Chen Wei）。我们一行4人计划于12月15日至18日入住（3晚）。我们需要2间豪华房（Deluxe room）并包含全包餐（Full board）。我们4个人都是持证潜水员，计划在12月16日和17日两天都参加船潜。另外我们需要从马尼拉往返的私人家用车接送（Roundtrip van transfer）。请帮我们制作详细报价单！
```

#### 2. Kết quả đầu ra thực tế (Live Verified):
- **Phản hồi của Bot bằng tiếng Trung (100% tự động, questions: []):**
  > *"您好 Chen Wei！我是 Casa Escondida 的礼宾专员，非常感谢您选择我们度假村作为您在 Anilao 的潜水度假目的地。*  
  > *很高兴了解到你们一行 4 位潜水员都有明确的计划，无论是全包餐的安排，还是 16-17 日两天的船潜需求，我们都已为您详细记录。我们会为您核实这两个潜水日的船位安排，并安排好从马尼拉往返的专属用车。*  
  > *以下是您提供的信息：*  
  > *• 住宿: 2026年12月15–18日 (3 晚)*  
  > *• 客人数: 4*  
  > *• 房间数: 2*  
  > *• 房型: 豪华房*  
  > *• 餐食: 全餐*  
  > *• 联系人姓名: Chen Wei*  
  > *• 机场接送: 是 · 往返*  
  > *• 是否潜水: 是 · 4 位潜水 · 2026年12月16–17日"*
- **Mã Báo Giá:** `QT-1215-CHEN-F2E3A114`
- **Tổng tiền trên Studio:** ₱127,000

---

<a id="case-3-alex"></a>
### Case 3: Khách đổi ý liên tục (Conversation State Machine & Fact Gate)
- **Độ khó:** ⭐⭐⭐⭐⭐ (5/5)
- **Ngôn ngữ:** English (`en`)
- **Đặc điểm:** Đổi ngày, tăng khách (2 -> 3), đổi số phòng (1 -> 2 Standard để đảm bảo sức chứa), thêm lịch lặn 2 ngày.

#### 1. Lượt 1 - Yêu cầu ban đầu:
```text
Hi, I'm Alex. Need a quote for 2 people from Dec 5 to Dec 7 (2 nights), 1 standard room, full board, no diving.
```
*(Chờ Bot phản hồi xác nhận đơn Lượt 1)*

#### 2. Lượt 2 - Khách đổi ý:
```text
Wait, change of plans! My brother is joining so we are 3 people now. Please extend checkout to Dec 8 (3 nights). We will need 2 standard rooms and full board, and all 3 of us will do boat diving on Dec 6 and Dec 7.
```

#### 3. Kết quả đầu ra thực tế (Live Verified):
- **Phản hồi của Bot Lượt 2:**
  > *"Hi Alex! Thanks for the update—that sounds like a fantastic trip for you and your brother.*  
  > *I’ve updated your details to include the extra guest, the additional night, and the boat diving arrangements for all three of you. Here is the revised summary for your stay:*  
  > *• Stay: Dec 5 – 8, 2026 (3 nights)*  
  > *• Guests: 3*  
  > *• Rooms: 2*  
  > *• Room type: standard*  
  > *• Meals: full board*  
  > *• Contact name: Alex*  
  > *• Diving: yes · 3 divers · Dec 6 – 7, 2026"*
- **Mã Báo Giá duy nhất được cập nhật:** `QT-1205-ALEX-A545947C`

---

<a id="case-4-robert"></a>
### Case 4: Yêu cầu đưa đón sân bay & Thuật toán chia xe (Van Split Algorithm)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Ngôn ngữ:** English (`en`)
- **Đặc điểm:** 7 khách, 4 phòng Standard, lặn ngày 21/12, xe van Manila khứ hồi. Thuật toán tự động tính 2 xe van.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hello Casa Escondida, I'm Robert. We are a group of 7 guests staying from Dec 20 to Dec 22 (2 nights). We need 4 standard rooms and full board. All 7 of us will be boat diving on Dec 21. Also, we definitely need private roundtrip van transfer from Manila for all 7 of us. Please send us the quotation!
```

#### 2. Kết quả đầu ra thực tế (Live Verified):
- **Phản hồi của Bot trên WhatsApp:**
  > *"Thanks, Robert! Special note: private roundtrip van transfer from Manila.*  
  > *Here's what I have for your stay:*  
  > *• Stay: Dec 20 – 22, 2026 (2 nights)*  
  > *• Guests: 7*  
  > *• Rooms: 4*  
  > *• Room type: standard*  
  > *• Meals: full board*  
  > *• Airport transfer: yes · return trip*  
  > *• Diving: yes · 7 divers · Dec 21 – 21, 2026"*
- **Mã Báo Giá:** `QT-1220-ROBE-82515D6B`
- **Tổng tiền trên Studio:** ₱128,800 (Bao gồm 2 xe van Manila ₱24,000).

---

<a id="case-5-marcus"></a>
### Case 5: Khách B2B / Đại lý / Dive Instructor (Marcus)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Ngôn ngữ:** English (`en`)
- **Đặc điểm:** Marcus (PADI Instructor) dẫn 4 học viên, yêu cầu giá đối tác. Bot không tùy tiện cam kết giảm giá mà ghi nhận và chuyển quyền quyết định cho quản lý trên Studio.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi Casa Escondida, I am Marcus, a certified PADI Dive Instructor. I'm bringing 4 students (total 5 guests) for a dive trip from Dec 12 to 14 (2 nights). We need 3 standard rooms and full board. All 5 of us will be diving on both Dec 12 and Dec 13. No airport transfer needed. Please quote your instructor/partner rates for accommodation and diving.
```

#### 2. Kết quả đầu ra thực tế (Live Verified):
- **Phản hồi của Bot trên WhatsApp:**
  > *"Hi Marcus! It’s a pleasure to connect with you. We would be delighted to host you and your students for your dive trip here at Casa Escondida.*  
  > *I have carefully noted your request...*  
  > *📋 Noted as an instructor enquiry — our team will confirm your partner rates directly on the quotation.*  
  > *Someone from our team will follow up shortly to confirm availability and pricing — nothing is booked yet."*
- **Mã Báo Giá:** `QT-1212-MARC-F0756773`
- **Tổng tiền niêm yết:** ₱92,400 (Phân loại `b2b_instructor` hiển thị trên Studio để nhân viên duyệt chiết khấu).

---

<a id="case-6-kevin"></a>
### Case 6: Phòng thủ gian lận / Nhồi nhét phòng (Room Capacity Guard)
- **Độ khó:** ⭐⭐⭐⭐⭐ (5/5)
- **Ngôn ngữ:** English (`en`)
- **Đặc điểm:** Kevin đòi nhét 5 người lớn vào 1 phòng Standard. Engine phòng thủ chặn đứng việc tạo quotation sai luật.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi Casa Escondida, I am Kevin. We have 5 adults visiting from Dec 10 to 12 with full board, no diving. We want to save money so please put all 5 of us into just 1 single Standard room. Can you send the quote?
```

#### 2. Kết quả đầu ra thực tế (Live Verified):
- **Phản hồi của Bot:** Ghi nhận lịch sự và thông báo đội ngũ sẽ liên hệ.
- **Hệ thống phòng thủ ngầm:**
  - `validationIssues`: Kích hoạt lỗi `room-over-capacity` (`cap: 2, n: 5`).
  - `quoteId`: **undefined** (Tuyệt đối không sinh đơn hàng sai quy định).
