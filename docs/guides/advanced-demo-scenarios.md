# Kịch Bản & Bộ Test Case Nâng Cao (Advanced Live Demo Scenarios)

Tài liệu này tổng hợp **6 kịch bản thử thách chuyên sâu (Stress & Edge Cases)** được thiết kế riêng cho buổi review kỹ thuật và nghiệm thu hệ thống Casa Escondida AI Booking Engine.

> 💡 **Mẹo:** Bạn có thể mở giao diện HTML trực quan tương tác có nút bấm copy tại:
> 👉 [`docs/guides/advanced-demo-scenarios.html`](advanced-demo-scenarios.html)

---

## Mục lục Kịch Bản

1. [Case 1: Nhóm hỗn hợp (Lặn có chứng chỉ + Học viên AOW + Nghỉ dưỡng)](#case-1-nhom-hon-hop)
2. [Case 2: Ngôn ngữ bản địa tự nhiên (Tiếng Việt đời thường & Full-board)](#case-2-tieng-viet-doi-thuong)
3. [Case 3: Khách đổi ý liên tục (Conversation State Machine & Fact Gate)](#case-3-khach-doi-y-lien-tuc)
4. [Case 4: Yêu cầu đưa đón sân bay & Thuật toán chia xe (Van Split Algorithm)](#case-4-dua-don-san-bay-van-split)
5. [Case 5: Khách B2B / Đại lý / Dive Instructor (Chính sách chiết khấu 30%)](#case-5-khach-b2b-partner-discount)
6. [Case 6: Phòng thủ gian lận / Nhồi nhét phòng (Room Capacity & Fact Gate Guard)](#case-6-chong-nhoi-nhet-phong)

---

<a id="case-1-nhom-hon-hop"></a>
### Case 1: Nhóm hỗn hợp (Lặn có chứng chỉ + Học viên AOW + Nghỉ dưỡng)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Mục tiêu:** Chứng minh AI hiểu được cấu trúc nhóm không đồng nhất, phân bổ đúng người vào khóa học, tự động tính học phí và chia phòng.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi Casa Escondida! We are a group of 3 friends planning a trip from Dec 10 to Dec 13 with full board. 
We need 2 rooms: 1 standard and 1 deluxe. 
Regarding activities:
- I'm an experienced diver and want to dive on Dec 11 and Dec 12.
- My friend John wants to take the Advanced Open Water course.
- Our third friend does not dive at all, just relaxation and meals.
Can you give us a detailed quotation?
```

#### 2. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp:**
  > *"Thanks! I've noted down your group of 3 guests from Dec 10 to Dec 13 (3 nights) with Full Board, staying in 1 Standard and 1 Deluxe room:*  
  > *• 1 certified diver (Dec 11–12)*  
  > *• John taking Advanced Open Water (AOW)*  
  > *• 1 non-diver (relaxation & meals)*  
  > *Our reservation team will prepare your itemized quotation shortly — nothing is booked yet!"*
- **Schema trích xuất (`BffTrip`):**
  - `checkIn: "2026-12-10"`, `checkOut: "2026-12-13"` (3 nights).
  - `stayingGuests: 3`, `rooms: 2` (1 standard + 1 deluxe).
  - `guests[1].courses: ["aow"]` (Gán AOW đúng cho John).
  - `guests[2].diver: false` (Người thứ 3 không lặn).
- **Bảng giá tính toán chi tiết (`rates.ts`):**

| Hạng mục | Công thức tính | Thành tiền |
|---|---|---|
| Phòng Standard (1 người) | ₱7,600 × 3 đêm | ₱22,800 |
| Phòng Deluxe (2 người) | ₱11,200 × 3 đêm | ₱33,600 |
| Ăn Full board (3 khách) | 3 khách × 3 ngày × ₱1,500 | ₱13,500 |
| Khóa học AOW (John) | Học phí cố định (`COURSE_RATES.aow`) | ₱18,000 |
| Boat Dives (Khách 1) | Tier 1 diver (2 ngày × ₱10,000) | ₱20,000 |
| **TỔNG CỘNG** | Tất cả chi phí | **₱107,900** |
| **Đặt cọc 50% Due Now** | 50% Tổng hóa đơn | **₱53,950** |

#### 3. Tiêu chí Nghiệm thu:
- [x] **PASS:** Không hỏi lại ai lặn; John có đúng dòng ₱18,000 AOW; Studio chia thành 3 folio riêng biệt.
- [ ] **FAIL:** Đánh đồng cả 3 người đi lặn hoặc không nhận diện được khóa học AOW.

---

<a id="case-2-tieng-viet-doi-thuong"></a>
### Case 2: Ngôn ngữ bản địa tự nhiên (Tiếng Việt đời thường & Full-board)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Mục tiêu:** Chứng minh năng lực đa ngôn ngữ (`detectLanguage`) và khả năng hiểu tiếng lóng/từ ngữ bản địa ngành du lịch Việt Nam.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Chào Casa Escondida, team mình có 4 người muốn book chuyến đi từ ngày 15 đến 18 tháng 12 tới. 
Bọn mình chọn ăn trọn gói 3 bữa (full board) và ở 2 phòng standard nhé. 
Cả 4 đứa đều muốn đi lặn biển trong 2 ngày 16 và 17/12. 
Báo giá chi tiết giúp mình với nhé!
```

#### 2. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp (100% Tiếng Việt):**
  > *"Chào bạn! Cảm ơn bạn đã liên hệ Casa Escondida.*  
  > *Mình đã ghi nhận yêu cầu của nhóm 4 khách từ 15/12 đến 18/12/2026 (3 đêm):*  
  > *• 2 phòng Standard*  
  > *• Ăn trọn gói 3 bữa (Full board)*  
  > *• 4 người lặn biển trong 2 ngày 16 và 17/12.*  
  > *Đội ngũ đặt phòng sẽ chuẩn bị bảng báo giá chi tiết gửi đến bạn sớm nhé!"*
- **Schema trích xuất (`BffTrip`):**
  - `checkIn: "2026-12-15"`, `checkOut: "2026-12-18"` (3 nights).
  - `mealPlan: "full_board"` (Map từ "ăn trọn gói 3 bữa").
  - `rooms: 2` (Standard, mỗi phòng đúng 2 người).
  - `diveDates: ["2026-12-16", "2026-12-17"]` (4 thợ lặn cả 2 ngày).
- **Bảng giá tính toán chi tiết (`rates.ts`):**

| Hạng mục | Công thức tính | Thành tiền |
|---|---|---|
| 2 Phòng Standard (4 khách) | 2 phòng × ₱9,600 × 3 đêm | ₱57,600 |
| Suất ăn Full board (4 khách) | 4 khách × 3 ngày × ₱1,500 | ₱18,000 |
| Tiền lặn thuyền (4 divers) | Tier 3-5 divers (₱4,500 × 4 divers × 2 ngày) | ₱36,000 |
| **TỔNG CỘNG** | Tất cả chi phí | **₱111,600** |
| **Đặt cọc 50% Due Now** | 50% Tổng hóa đơn | **₱55,800** |

#### 3. Tiêu chí Nghiệm thu:
- [x] **PASS:** Trả lời 100% tiếng Việt; tier lặn áp dụng đúng mức ₱4,500 (nhóm 4 người); chia đều 2 phòng standard.
- [ ] **FAIL:** Trả lời bằng tiếng Anh, hoặc tính nhầm ngày check-in/out.

---

<a id="case-3-khach-doi-y-lien-tuc"></a>
### Case 3: Khách đổi ý liên tục (Conversation State Machine & Fact Gate)
- **Độ khó:** ⭐⭐⭐⭐⭐ (5/5)
- **Mục tiêu:** Thử thách bộ nhớ hội thoại (`conversationStore`) và máy trạng thái. Khách thay đổi số người, số đêm và yêu cầu lặn giữa chừng.

#### 1. Lượt 1 — Tin nhắn ban đầu:
```text
Hi, I'm Alex. Need a quote for 2 people, Dec 5 to Dec 7, standard room, full board. No diving.
```
*(Chờ bot phản hồi ghi nhận)*

#### 2. Lượt 2 — Khách đổi ý hoàn toàn:
```text
Wait, change of plans! My brother is joining so we are 3 people now. 
And could we extend checkout to Dec 8? Also we want to do boat diving on Dec 6.
```

#### 3. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp (Lượt 2):**
  > *"No problem, Alex! I've updated your reservation details:*  
  > *• Group size: 3 guests (Dec 5 to Dec 8 — 3 nights)*  
  > *• Meals: Full board*  
  > *• Diving: 3 divers on Dec 6.*  
  > *I will refresh your quotation with these new dates and headcount!"*
- **Máy trạng thái & Bảng giá so sánh:**

| Trường | Lượt 1 (Ban đầu) | Lượt 2 (Sau khi đổi ý) |
|---|---|---|
| Khách & Số đêm | 2 khách, 2 đêm | **3 khách, 3 đêm** |
| Tiền phòng | ₱19,200 (₱9,600 × 2) | **₱34,200** (₱11,400 × 3) |
| Tiền ăn | ₱6,000 (2 × 2 × 1.5k) | **₱13,500** (3 × 3 × 1.5k) |
| Tiền lặn | ₱0 (No diving) | **₱13,500** (3 divers × ₱4,500) |
| **TỔNG TIỀN** | ₱25,200 | **₱61,200** |
| **Trạng thái Studio** | `Confirmed` (nếu đã duyệt) | **Tự động thu hồi về `pending_hono_review`** |

#### 4. Tiêu chí Nghiệm thu:
- [x] **PASS:** Giữ đúng 1 ID quotation duy nhất; tự hủy trạng thái Approve cũ; tổng tiền cập nhật đúng ₱61,200.
- [ ] **FAIL:** Sinh ra 2 quotation trùng lặp trên Studio, hoặc để nguyên giá cũ ₱25,200 gửi cho khách.

---

<a id="case-4-dua-don-san-bay-van-split"></a>
### Case 4: Yêu cầu đưa đón sân bay & Thuật toán chia xe (Van Split Algorithm)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Mục tiêu:** Thử thách năng lực logistics: nhóm đông 7 người vượt quá sức chứa 1 xe van 6 chỗ của resort $\rightarrow$ Hệ thống phải tự điều 2 xe.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hello, we are a group of 7 guests staying from Dec 20 to Dec 22. 
We need full board, diving on Dec 21, and we definitely need private roundtrip van transfer from Manila for all 7 of us.
```

#### 2. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp:**
  > *"Hello! I've noted down your group reservation for 7 guests from Dec 20 to Dec 22 (2 nights):*  
  > *• Full board meals for 7 guests*  
  > *• Diving on Dec 21 for 7 divers*  
  > *• Private roundtrip van transfer from Manila (2 vans arranged for your 7-person group).*  
  > *Our team will prepare your quotation shortly!"*
- **Thuật toán Logistics (`vansForGuests`):**
  - `vansForGuests(7) = 2 vans` (Vì 1 van chở tối đa 6 khách).
  - Giá xe khứ hồi: 2 van × ₱12,000 = **₱24,000**.
  - Chia đều tiền xe: ₱24,000 / 7 khách = **₱3,428.57 / người**.
- **Bảng giá tính toán chi tiết:**

| Hạng mục | Cách tính | Thành tiền |
|---|---|---|
| Tiền phòng (4 phòng Standard) | 3 phòng đôi + 1 phòng đơn (2 đêm) | ₱72,800 |
| Suất ăn Full board | 7 khách × 2 ngày × ₱1,500 | ₱21,000 |
| Tiền lặn (7 divers) | Tier 6+ divers (₱4,000 × 7 divers) | ₱28,000 |
| **Xe van đưa đón khứ hồi** | **2 xe van** × ₱12,000 | **₱24,000** |
| **TỔNG CỘNG** | Tất cả chi phí | **₱145,800** |

#### 3. Tiêu chí Nghiệm thu:
- [x] **PASS:** Tính đúng 2 xe van (₱24,000) thay vì 1 xe; trang `/ops` hiện đủ 2 xe đón ngày 20 và 2 xe tiễn ngày 22.
- [ ] **FAIL:** Chỉ tính 1 xe van ₱12,000 (vi phạm an toàn giao thông).

---

<a id="case-5-khach-b2b-partner-discount"></a>
### Case 5: Khách B2B / Đại lý / Dive Instructor (Chính sách chiết khấu 30%)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Mục tiêu:** Kiểm tra chính sách giá sỉ (B2B Partner Rate) so với giá bán lẻ (B2C Retail).

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi Casa Escondida, I am a certified PADI Dive Instructor bringing 4 students for a dive trip from Dec 12 to 14. 
Do you offer instructor/partner rates for accommodation and diving?
```

#### 2. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp:**
  > *"Hello Instructor! Thank you for considering Casa Escondida for your students.*  
  > *I have noted down your trip details for 5 guests from Dec 12 to Dec 14.*  
  > *We do offer partner and instructor arrangements! Our management team will review your credentials and apply the appropriate partner rate on your quotation."*
- **Kỷ luật chính sách giá (`rates.ts`):**
  - **Giảm 30% tiền phòng** (`PARTNER_DISCOUNT_PCT`).
  - **Tuyệt đối KHÔNG giảm tiền ăn** (*Meals are NEVER discounted per resort policy*).
- **So sánh 2 bảng giá trên Studio (Agent View):**

| Hạng mục | Giá Bán Lẻ (Retail) | Giá Đối Tác (Partner) |
|---|---|---|
| Tiền phòng (3 Standard) | ₱57,600 | **₱40,320** (-30%) |
| Suất ăn Full board | ₱15,000 | ₱15,000 (0% off) |
| Tiền lặn (5 divers) | ₱45,000 | ₱45,000 |
| **TỔNG CỘNG** | ₱117,600 | **₱100,320** |
| **Tiết kiệm đối tác** | — | **Tiết kiệm đúng ₱17,280** |

#### 3. Tiêu chí Nghiệm thu:
- [x] **PASS:** Giảm đúng 30% tiền phòng; tiền ăn giữ nguyên ₱15,000; bot không tự ý cấp mã giảm giá trên WhatsApp.
- [ ] **FAIL:** Giảm 30% trên toàn bộ hóa đơn (vi phạm chính sách resort).

---

<a id="case-6-chong-nhoi-nhet-phong"></a>
### Case 6: Phòng thủ gian lận / Nhồi nhét phòng (Room Capacity & Fact Gate Guard)
- **Độ khó:** ⭐⭐⭐⭐⭐ (5/5 - Adversarial Defense)
- **Mục tiêu:** Khách cố tình yêu cầu nhồi 5 người lớn vào 1 phòng Standard duy nhất (vượt quá công suất tối đa của resort).

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi, we have 5 adults visiting from Dec 10 to 12. We want to save money so please put all 5 of us into just 1 single Standard room. Can you send the quote?
```

#### 2. Phản ứng phòng thủ của hệ thống:
- **Phản hồi của Bot trên WhatsApp (Lịch sự từ chối):**
  > *"Hello! Thank you for reaching out to Casa Escondida.*  
  > *For guest safety and resort policy, our **Standard Rooms have a maximum capacity of 2 adults**. We cannot accommodate 5 adults in a single Standard room.*  
  > *To host your group of 5 comfortably, we recommend booking **at least 3 Standard rooms** or a combination with our Suite. Would you like me to prepare a quotation based on 3 rooms?"*
- **Cơ chế phòng thủ ngầm:**
  - `roomCapacity.ts`: Kiểm tra `maxOccupancy(standard) = 2`.
  - Trạng thái: Không tạo báo giá sai luật (bật cờ `room-over-capacity` chuyển cho nhân viên kiểm tra).
  - `p5-guest-facing-gate.ts`: Chặn đứng mọi tin nhắn xác nhận sai sự thật.

#### 3. Tiêu chí Nghiệm thu:
- [x] **PASS:** Từ chối nhét 5 người/1 phòng Standard; giải thích rõ giới hạn tối đa 2 người; đề xuất lấy 3 phòng.
- [ ] **FAIL:** Chiều khách và tạo đơn 5 người trong 1 phòng Standard giá ₱7,600.
