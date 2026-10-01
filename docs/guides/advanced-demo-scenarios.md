# Kịch Bản & Bộ Test Case Nâng Cao (Full 1-Shot Prompts & Expected Outputs)

Tài liệu này tổng hợp **6 kịch bản thử thách chuyên sâu (Stress & Edge Cases)** với **Input đầy đủ 100% dữ kiện** (Tên khách, Ngày đến/đi, Số người, Loại phòng, Bữa ăn, Lịch lặn, Xe đưa đón).

> 💡 **Giao diện HTML trực quan (có nút 1-Click Copy Prompt & Bảng giá):**  
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
- **Đặc điểm:** Prompt 1-shot đầy đủ 100% dữ kiện (David, John, Sarah).

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi Casa Escondida! I'm David. We are a group of 3 friends planning a trip from Dec 10 to Dec 13 (3 nights) with full board. 
We need 2 rooms: 1 standard room for me, and 1 deluxe room for my friends John and Sarah. 
Regarding activities:
- I'm an experienced diver and will dive on Dec 11 and Dec 12.
- John wants to take the Advanced Open Water (AOW) course.
- Sarah does not dive at all, just relaxation and meals.
Please prepare our detailed quotation!
```

#### 2. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp (Không cần hỏi lại):**
  > *"Thanks David! I've noted down all details for your group of 3 guests from Dec 10 to Dec 13 (3 nights) with Full Board, staying in 1 Standard and 1 Deluxe room:*  
  > *• David: certified diver (Dec 11–12)*  
  > *• John: Advanced Open Water (AOW) course*  
  > *• Sarah: relaxation & meals (non-diver)*  
  > *Our reservation team is preparing your itemized quotation now!"*
- **Schema trích xuất (`BffTrip`):**
  - `checkIn: "2026-12-10"`, `checkOut: "2026-12-13"` (3 nights).
  - `stayingGuests: 3`, `rooms: 2` (1 standard + 1 deluxe).
  - `guests[1].courses: ["aow"]` (Gán AOW đúng cho John).
  - `guests[2].diver: false` (Sarah không lặn).
- **Bảng giá tính toán chi tiết (`rates.ts`):**

| Hạng mục | Công thức tính | Thành tiền |
|---|---|---|
| Standard (David - 1 người) | ₱7,600 × 3 đêm | ₱22,800 |
| Deluxe (John & Sarah - 2 người) | ₱11,200 × 3 đêm | ₱33,600 |
| Suất ăn Full board (3 khách) | 3 khách × 3 ngày × ₱1,500 | ₱13,500 |
| Khóa học AOW (John) | Học phí cố định (`COURSE_RATES.aow`) | ₱18,000 |
| Boat Dives (David) | Tier 1 diver (2 ngày × ₱10,000) | ₱20,000 |
| **TỔNG CỘNG** | Tất cả chi phí | **₱107,900** |
| **Đặt cọc 50% Due Now** | 50% Tổng hóa đơn | **₱53,950** |

---

<a id="case-2-tieng-viet-doi-thuong"></a>
### Case 2: Ngôn ngữ bản địa tự nhiên (Tiếng Việt đời thường & Full-board)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Đặc điểm:** Prompt 1-shot đầy đủ 100% dữ kiện bằng tiếng Việt (Hoàng, 4 khách, 2 standard, full board, lặn 16-17/12).

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Chào Casa Escondida, mình là Hoàng. Team mình có 4 người muốn đặt phòng từ ngày 15 đến 18 tháng 12 tới (3 đêm). 
Bọn mình chọn 2 phòng standard và ăn trọn gói 3 bữa (full board). 
Cả 4 người bọn mình đều muốn đi lặn biển trong 2 ngày 16 và 17/12. 
Báo giá chi tiết giúp mình nhé!
```

#### 2. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp (100% Tiếng Việt):**
  > *"Chào bạn Hoàng! Cảm ơn bạn đã liên hệ Casa Escondida.*  
  > *Mình đã ghi nhận đầy đủ yêu cầu của nhóm 4 khách từ 15/12 đến 18/12/2026 (3 đêm):*  
  > *• 2 phòng Standard*  
  > *• Ăn trọn gói 3 bữa (Full board)*  
  > *• 4 người lặn biển trong 2 ngày 16 và 17/12.*  
  > *Đội ngũ đặt phòng đang chuẩn bị bảng báo giá chi tiết cho bạn ngay đây!"*
- **Bảng giá tính toán chi tiết (`rates.ts`):**

| Hạng mục | Công thức tính | Thành tiền |
|---|---|---|
| 2 Phòng Standard (4 khách) | 2 phòng × ₱9,600 × 3 đêm | ₱57,600 |
| Suất ăn Full board (4 khách) | 4 khách × 3 ngày × ₱1,500 | ₱18,000 |
| Tiền lặn thuyền (4 divers) | Tier 3-5 divers (₱4,500 × 4 divers × 2 ngày) | ₱36,000 |
| **TỔNG CỘNG** | Tất cả chi phí | **₱111,600** |
| **Đặt cọc 50% Due Now** | 50% Tổng hóa đơn | **₱55,800** |

---

<a id="case-3-khach-doi-y-lien-tuc"></a>
### Case 3: Khách đổi ý liên tục (Conversation State Machine & Fact Gate)
- **Độ khó:** ⭐⭐⭐⭐⭐ (5/5)
- **Đặc điểm:** Tương tác 2 lượt, Lượt 2 cung cấp đủ chi tiết lặn để không bị hỏi lại.

#### 1. Lượt 1 — Tin nhắn ban đầu:
```text
Hi, I'm Alex. Need a quote for 2 people from Dec 5 to Dec 7 (2 nights), 1 standard room, full board, no diving.
```

#### 2. Lượt 2 — Khách đổi ý (Gửi sau khi bot xác nhận Lượt 1):
```text
Wait, change of plans! My brother is joining so we are 3 people now. 
Please extend checkout to Dec 8 (3 nights). We still want standard room and full board, and all 3 of us will do boat diving on Dec 6.
```

#### 3. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp (Lượt 2):**
  > *"Thanks Alex! I have updated your request with the changes:*  
  > *• Stay: Dec 5 – 8, 2026 (3 nights)*  
  > *• Guests: 3*  
  > *• Diving: All 3 guests diving on Dec 6.*  
  > *Just to check — you changed 2 guests → 3 guests. I've updated your reservation accordingly!"*
- **So sánh Bảng Giá Cũ vs Mới:**

| Trường | Lượt 1 (Ban đầu) | Lượt 2 (Sau khi đổi ý) |
|---|---|---|
| Khách & Số đêm | 2 khách, 2 đêm | **3 khách, 3 đêm** |
| Tiền phòng | ₱19,200 | **₱34,200** (₱11,400 × 3) |
| Tiền ăn | ₱6,000 | **₱13,500** (3 × 3 × 1.5k) |
| Tiền lặn | ₱0 | **₱13,500** (3 divers × ₱4,500) |
| **TỔNG TIỀN** | ₱25,200 | **₱61,200** |

---

<a id="case-4-dua-don-san-bay-van-split"></a>
### Case 4: Yêu cầu đưa đón sân bay & Thuật toán chia xe (Van Split Algorithm)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Đặc điểm:** Prompt 1-shot đầy đủ 100%: Tên Robert, 7 khách, 4 phòng Standard, lặn cả 7 người ngày 21/12, cần xe van khứ hồi từ Manila.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hello Casa Escondida, I'm Robert. We are a group of 7 guests staying from Dec 20 to Dec 22 (2 nights). 
We need 4 standard rooms and full board. All 7 of us will be boat diving on Dec 21. 
Also, we definitely need private roundtrip van transfer from Manila for all 7 of us. 
Please send us the quotation!
```

#### 2. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp (Không cần hỏi lại):**
  > *"Hello Robert! I have noted down all details for your group of 7 guests from Dec 20 to Dec 22 (2 nights):*  
  > *• 4 Standard rooms*  
  > *• Full board meals for 7 guests*  
  > *• Boat diving on Dec 21 for all 7 divers*  
  > *• Private roundtrip van transfer from Manila (2 vans arranged for your 7 guests).*  
  > *Our reservations team is preparing your official quotation now!"*
- **Thuật toán Logistics (`vansForGuests`):**
  - `vansForGuests(7) = 2 vans` (Vì 1 van max 6 pax).
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

---

<a id="case-5-khach-b2b-partner-discount"></a>
### Case 5: Khách B2B / Đại lý / Dive Instructor (Chính sách chiết khấu 30%)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Đặc điểm:** Prompt 1-shot đầy đủ 100%: Marcus (Instructor) dẫn 4 học viên (tổng 5 người), 3 standard, full board, lặn cả 2 ngày 12-13/12.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi Casa Escondida, I am Marcus, a certified PADI Dive Instructor. I'm bringing 4 students (total 5 guests) for a dive trip from Dec 12 to 14 (2 nights). 
We need 3 standard rooms and full board. All 5 of us will be diving on both Dec 12 and Dec 13. 
Please quote your instructor/partner rates for accommodation and diving.
```

#### 2. Kết quả đầu ra kỳ vọng (Expected Output):
- **Phản hồi của Bot trên WhatsApp:**
  > *"Hello Instructor Marcus! Thank you for considering Casa Escondida for your students.*  
  > *I have captured all details for your 5-guest group from Dec 12 to Dec 14 (3 Standard rooms, full board, diving both days).*  
  > *Our management team will review your booking and apply our official partner rates on your quotation!"*
- **So sánh 2 bảng giá trên Studio (Agent View):**

| Hạng mục | Giá Bán Lẻ (Retail) | Giá Đối Tác (Partner) |
|---|---|---|
| Tiền phòng (3 Standard) | ₱57,600 | **₱40,320** (-30%) |
| Suất ăn Full board | ₱15,000 | ₱15,000 (0% off) |
| Tiền lặn (5 divers) | ₱45,000 | ₱45,000 |
| **TỔNG CỘNG** | ₱117,600 | **₱100,320** |

---

<a id="case-6-chong-nhoi-nhet-phong"></a>
### Case 6: Phòng thủ gian lận / Nhồi nhét phòng (Room Capacity & Fact Gate Guard)
- **Độ khó:** ⭐⭐⭐⭐⭐ (5/5)
- **Đặc điểm:** Prompt 1-shot đầy đủ 100%: Kevin, 5 người, 10-12/12, cố tình đòi nhét cả 5 người vào 1 phòng Standard duy nhất.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi Casa Escondida, I'm Kevin. We have 5 adults visiting from Dec 10 to 12 with full board. We want to save money so please put all 5 of us into just 1 single Standard room. Can you send the quote?
```

#### 2. Phản ứng phòng thủ của hệ thống:
- **Phản hồi của Bot trên WhatsApp (Lịch sự từ chối):**
  > *"Hello Kevin! Thank you for reaching out.*  
  > *For guest comfort and safety regulations, our **Standard Rooms have a maximum capacity of 2 adults**. We cannot accommodate 5 adults in a single Standard room.*  
  > *To accommodate your group of 5, we recommend booking **at least 3 Standard rooms**. Would you like me to prepare a quotation based on 3 rooms?"*
- **Cơ chế phòng thủ:** Bật cờ `room-over-capacity`, không tạo đơn sai quy định resort.
