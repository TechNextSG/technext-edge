# Kịch Bản & Bộ Test Case Nâng Cao (Advanced Live Demo Scenarios)

Tài liệu này tổng hợp **6 kịch bản thử thách chuyên sâu (Stress & Edge Cases)** được thiết kế riêng cho buổi review kỹ thuật và nghiệm thu hệ thống Casa Escondida AI Booking Engine.

Mỗi kịch bản đều có:
- **Tin nhắn mẫu** (copy-paste trực tiếp vào WhatsApp).
- **Phản hồi kỳ vọng của Bot & AI Extractor**.
- **Cơ chế kỹ thuật ngầm** (các hàm, schema và bài test bảo vệ tương ứng trong codebase).
- **Điểm nhấn cần show trên Quotation Studio & Ops Sheet**.

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

#### 2. Kết quả trích xuất & Cơ chế kỹ thuật:
- **AI Trích xuất (`ai/src/domain/counts.ts`):**
  - Khách 1 (Người gửi): `diver: true`, lịch lặn 11/12 & 12/12.
  - Khách 2 (John): `diver: true`, `courses: ["aow"]`.
  - Khách 3: `diver: false`, `meals: true`.
- **Định giá tự động (`bff/src/quote/rates.ts`):**
  - Khóa AOW được tính theo `COURSE_RATES.aow` = **₱18,000**.
  - Tiền lặn tính theo tier số người ra biển mỗi ngày (`diveTierPrice`).
  - Tiền phòng được chia theo tỷ lệ người ở (`nightly / occupancy`).
- **Trên Quotation Studio:**
  - Bảng giá thể hiện từng khách riêng biệt, có dòng học phí AOW cho John và suất ăn 3 người đầy đủ.

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

#### 2. Kết quả trích xuất & Cơ chế kỹ thuật:
- **Phát hiện ngôn ngữ (`detectLanguage`):** Bot nhận diện mã ngôn ngữ `vi` $\rightarrow$ Toàn bộ câu trả lời chào và xác nhận được sinh tự động bằng **Tiếng Việt**.
- **Xử lý ngày tháng linh hoạt (`ai/src/domain/dates.ts`):**
  - Check-in: `2026-12-15`, Check-out: `2026-12-18` (3 đêm).
  - Lịch lặn: `2026-12-16` đến `2026-12-17` (2 ngày).
- **Ánh xạ thuật ngữ:** Hiểu cụm `"ăn trọn gói 3 bữa"` là `mealPlan: "full_board"`.
- **Chia phòng tự động:** 4 người $\rightarrow$ 2 phòng Standard (mỗi phòng 2 người, đúng chuẩn max capacity).

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

#### 3. Kết quả trích xuất & Cơ chế kỹ thuật:
- **Nguyên tắc "1 Enquiry = 1 Quotation" (`oneEnquiryOneQuotation.test.ts`):** Hệ thống không tạo mới mà update trực tiếp vào quotation của Alex (`QT-...`).
- **Cơ chế bảo vệ tiền (`pricedFactsChanged`):** Nếu nhân viên đã lỡ Approve giá cũ, việc khách đổi số đêm (2 $\rightarrow$ 3 đêm) và số khách (2 $\rightarrow$ 3) sẽ tự động **thu hồi trạng thái Approve**, buộc phải tính giá lại để chống thất thoát doanh thu.
- **Diff chuyến đi (`diffBffTrip`):** Studio hiển thị rõ các trường dữ liệu vừa thay đổi.

---

<a id="case-4-dua-don-san-bay-van-split"></a>
### Case 4: Yêu cầu đưa đón sân bay & Thuật toán chia xe (Van Split Algorithm)
- **Độ khó:** ⭐⭐⭐⭐ (4/5)
- **Mục tiêu:** Thử thách năng lực logistics: nhóm đông 7 người vượt quá sức chứa 1 xe van 6 chỗ của resort.

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hello, we are a group of 7 guests staying from Dec 20 to Dec 22. 
We need full board, diving on Dec 21, and we definitely need private roundtrip van transfer from Manila for all 7 of us.
```

#### 2. Kết quả trích xuất & Cơ chế kỹ thuật:
- **Thuật toán chia xe (`vansForGuests(7) = 2 vans`):** Sức chứa 1 van là 6 khách. Nhóm 7 khách $\rightarrow$ Hệ thống tự động điều động **2 xe van khứ hồi**.
- **Chia đều chi phí xe (`van split`):**
  - Chi phí 2 xe được bổ đều vào từng hóa đơn của 7 khách (`catRev.transport`).
- **Trang Vận hành (`/ops`):** Bảng phân công xe thể hiện rõ 2 xe đón ngày 20/12 và 2 xe tiễn ngày 22/12.

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

#### 2. Kết quả trích xuất & Cơ chế kỹ thuật:
- **Phân loại đối tác (`classifyEnquiry`):** Nhận diện `guestType: "instructor"`.
- **Kỷ luật chính sách giá Casa Escondida (`rates.ts`):**
  - **Giảm 30% tiền phòng** (`PARTNER_DISCOUNT_PCT`).
  - **Tuyệt đối KHÔNG giảm tiền ăn** (*Meals are NEVER discounted per resort policy*).
- **Màn hình Agent View trong Studio:** Cho phép nhân viên đối chiếu 2 cột: Giá bán lẻ (Retail) vs Giá đối tác (Instructor) để quản lý biên lợi nhuận.

---

<a id="case-6-chong-nhoi-nhet-phong"></a>
### Case 6: Phòng thủ gian lận / Nhồi nhét phòng (Room Capacity & Fact Gate Guard)
- **Độ khó:** ⭐⭐⭐⭐⭐ (5/5 - Adversarial Defense)
- **Mục tiêu:** Khách cố tình yêu cầu nhồi 5 người vào 1 phòng Standard duy nhất (vượt quá công suất tối đa của resort).

#### 1. Tin nhắn copy-paste vào WhatsApp:
```text
Hi, we have 5 adults visiting from Dec 10 to 12. We want to save money so please put all 5 of us into just 1 single Standard room. Can you send the quote?
```

#### 2. Phản ứng phòng thủ của hệ thống:
- **Bộ lọc công suất phòng (`roomCapacity.ts`):** Phòng Standard chỉ chứa tối đa 2 người lớn (`maxOccupancy = 2`). Yêu cầu 5 người/1 phòng Standard vi phạm chính sách resort.
- **AI không làm bừa:** Thay vì sinh báo giá sai luật, bot lịch sự giải thích quy định an toàn và gợi ý tách thành tối thiểu 3 phòng Standard hoặc phòng Suite lớn.
- **Fact Gate chặn ở cửa ngõ (`p5-guest-facing-gate.ts`):** Nếu model cố tình xác nhận một điều vô lý, Fact Gate sẽ chặn đứng tin nhắn không cho phát ra WhatsApp và chuyển cảnh báo cho nhân viên trên Studio.

---

## Tóm tắt Lệnh Kiểm Thử Nhanh (Cheat-sheet)

```bash
# 1. Chạy thẩm định ranh giới kiến trúc, typecheck và toàn bộ 956 automated tests:
npm run verify

# 2. Chạy nhanh unit test:
npm test

# 3. Chạy script mô phỏng 42 kịch bản tự động:
node bff/scripts/whatsapp-manual-run.mjs --port 8787 --verbose
```
