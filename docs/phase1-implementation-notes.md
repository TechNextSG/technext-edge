# Nhật Ký Kỹ Thuật (Engineering Log) — Phase 1: Giải Quyết "Logicalize Model" Bằng Hybrid AI

**Ngày thực hiện:** 23/09/2026  
**Người thực hiện:** `aidev1-technext`  
**Mục tiêu:** Giải quyết dứt điểm tình trạng bot bị "logicalize" (cứng nhắc, hỏi lặp lại thông tin khách vừa nói trên WhatsApp), đồng thời gia cố rào chắn an toàn sau khi AI sinh câu trả lời (`Post-Generation Symbolic Fact Gate`) và cảnh báo bàn giao nhân viên (`Staff Alerts`).

---

## 1. Tóm Tắt 5 Hạng Mục Đã Can Thiệp & Khắc Phục

| STT | Hạng mục | Thực trạng cũ (Bị Logicalize) | Giải pháp Hybrid AI (Neuro-Symbolic) đã triển khai | File can thiệp |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Quy tắc `NEVER RE-ASK` cho lịch lặn lẻ ngày** | Khi khách nói *"1 người lặn ngày đầu, 5 người lặn cả 2 ngày"*, AI lưu vào `diveNotes` nhưng ô số nguyên `divers` vẫn là `missing`. Tầng câu hỏi máy móc hỏi lại: *"Có bao nhiêu người sẽ lặn?"* | Bổ sung quy tắc **`NEVER RE-ASK`**: Khi `diveNotes` đã có dữ liệu (`stated` hoặc `inferred`), tự động bỏ qua câu hỏi `divers`, `diveFrom`, `diveTo` và chuyển thẳng ghi chú sang nhân viên báo giá. | [`packages/extractor/src/questions.ts`](file:///e:/technext-edge/packages/extractor/src/questions.ts#L77-L106) |
| **2** | **Tách cụm từ lặn khỏi bộ đếm tổng số khách (`DIVE_CLAUSE_AFTER_NOUN`)** | Khi khách viết *"6 of us... 1 person dives day 1, 5 people dive both days"* (hoặc *"1 người lặn"*), bộ kiểm tra số lượng trong `counts.ts` đọc nhầm `"1 person"` và `"5 people"` là tổng số khách lưu trú $\rightarrow$ tưởng khách khai mâu thuẫn (`1`, `5` vs `6`) nên **xóa luôn `guests: 6`** về `missing` và bắt hỏi lại tổng số khách! | Thêm lookahead `DIVE_CLAUSE_AFTER_NOUN` vào `patternFor("guests")`: Bỏ qua các danh từ chỉ người (`person`, `people`, `người`, `bạn`) nếu ngay sau đó là động từ lặn (`dive`, `dives`, `diving`, `lặn`, `潜水`). Giữ nguyên vẹn `guests: 6`. | [`packages/extractor/src/counts.ts`](file:///e:/technext-edge/packages/extractor/src/counts.ts#L123-L139) |
| **3** | **Bảo toàn ghi chú tự do (`diveNotes`, `specialRequests`)** | Hàm `enforceVerbatimEvidence` trước đây xóa trắng (`value: null`) cả `diveNotes` và `specialRequests` nếu AI tóm tắt ý của khách mà không trích dẫn nguyên văn 100% chuỗi con. | Nếu `diveNotes`, `specialRequests`, hoặc `guestNames` có nội dung nhưng `evidence` bị diễn giải lại, chuyển trạng thái về `inferred` thay vì xóa mất dữ liệu của khách. | [`packages/extractor/src/extract.ts`](file:///e:/technext-edge/packages/extractor/src/extract.ts#L493-L511) |
| **4** | **Kiểm duyệt câu trả lời của AI (`Post-Generation Fact Gate`)** | Tầng Neuro (`synthesizeHospitalityReply`) viết câu lễ tân tự nhiên nhưng chưa có bộ lọc tất định chặn trường hợp LLM tự ý bịa giá hoặc viết nhầm số đêm/số phòng. | Xây dựng hàm **`verifySynthesizedReply(text, trip)`**: Quét và chặn 100% ký hiệu tiền tệ (`$`, `₱`, `PHP`, `USD`, `VND`), câu hứa hẹn đã giữ phòng, hoặc lệch số đêm (`nights`) / số phòng (`rooms`). Nếu vi phạm $\rightarrow$ tự động rollback về `fallbackText`. | [`packages/extractor/src/synthesis.ts`](file:///e:/technext-edge/packages/extractor/src/synthesis.ts#L38-L74) |
| **5** | **Rà soát giả định tính tiền (`Staff Alerts` / Chiết khấu Đại lý 30%)** | Phát hiện `guestType: "agent"` hoặc `"instructor"` nhưng ẩn trong JSON nội bộ, dễ dẫn tới nhầm lẫn mức chiết khấu 30%. | Xây dựng hàm **`getStaffAlerts(trip, lang)`**: Tự động gắn nhãn cảnh báo chính sách Đại lý/Đối tác (30% agency discount) và lịch lặn lẻ ngày ngay trên bản tóm tắt bàn giao. | [`packages/extractor/src/questions.ts`](file:///e:/technext-edge/packages/extractor/src/questions.ts#L567-L607) |

---

## 2. Chi Tiết Kỹ Thuật Từng Bước

### 2.1. Quy tắc `NEVER RE-ASK` ([`packages/extractor/src/questions.ts`](file:///e:/technext-edge/packages/extractor/src/questions.ts))
- Thêm hàm `notedValue<T>(trip, key)` nhận diện cả trạng thái `stated` và `inferred` cho các trường ngữ nghĩa tự do (`diveNotes`, `specialRequests`, `guestNames`).
- Cập nhật điều kiện `when` cho 3 câu hỏi lặn (`divers`, `diveFrom`, `diveTo`):
  ```ts
  when: (trip) => trip.diver?.value === true && !notedValue<string>(trip, "diveNotes")
  ```
- Cập nhật test cũ tại [`packages/extractor/test/extract.test.ts`](file:///e:/technext-edge/packages/extractor/test/extract.test.ts#L439-L462): Trước đây test cũ ép `expect(outcome.questions).toContain("divers")` (chính là nguyên nhân gây lỗi hỏi lặp trên WhatsApp). Nay cập nhật thành `expect(outcome.questions).not.toContain("divers")` khi `diveNotes` đã ghi nhận lịch lặn.

### 2.2. Chống xung đột số khách khi có câu mô tả lặn ([`packages/extractor/src/counts.ts`](file:///e:/technext-edge/packages/extractor/src/counts.ts))
- Thêm biểu thức lookahead `DIVE_CLAUSE_AFTER_NOUN`:
  ```ts
  const DIVE_CLAUSE_AFTER_NOUN =
    "(?!\\s+(?:will\\s+|want\\s+to\\s+|going\\s+to\\s+|are\\s+|is\\s+)?(?:dive|dives|diving)\\b|\\s+(?:sẽ\\s+|đi\\s+|muốn\\s+)?(?:lặn|lan)\\b|\\s*(?:去|要|会)?(?:潜水|潛水))";
  ```
- Giúp `corroborateCount("guests", ...)` không bao giờ xóa nhầm tổng số khách (`guests`) khi khách liệt kê số người đi lặn theo từng ngày ở câu sau.

### 2.3. Bộ lọc `verifySynthesizedReply` ([`packages/extractor/src/synthesis.ts`](file:///e:/technext-edge/packages/extractor/src/synthesis.ts))
- Kiểm tra 4 điều kiện khóa cứng trước khi trả tin nhắn về WhatsApp:
  1. `unauthorized_price_quote`: Chặn mọi biểu thức tiền tệ (`$150`, `₱12,500`, `300 USD`, `PHP`, `VND`...).
  2. `false_booking_confirmation`: Chặn các câu khẳng định đã đặt phòng thành công khi chưa có nhân viên duyệt.
  3. `mismatched_nights_count`: Đối chiếu số đêm trong câu văn của AI với `trip.nights.value`.
  4. `mismatched_rooms_count`: Đối chiếu số phòng trong câu văn của AI với `trip.rooms.value`.

---

## 3. Kết Quả Kiểm Thử Tự Động (Verification & Unit Tests)

- **Lệnh kiểm tra:** `npm run verify` (`tsc --noEmit` + `vitest run`)
- **Kết quả:** **16/16 Test Files Passed — 233/233 Unit Tests Passed (100% Xanh)**.
- **3 kịch bản test mới tại [`packages/extractor/test/questions.test.ts`](file:///e:/technext-edge/packages/extractor/test/questions.test.ts#L487-L596):**
  1. `NEVER RE-ASK: skips asking divers/diveFrom/diveTo when diveNotes already records split-day schedule`
  2. `Post-Generation Fact Gate: rejects LLM replies that invent prices or contradict verified counts`
  3. `Staff Alerts: flags travel agency / partner enquiries for 30% discount confirmation`
