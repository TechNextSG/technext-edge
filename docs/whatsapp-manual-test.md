# Kịch bản test tay trên WhatsApp

> **Đã cập nhật cho Đợt 1.** Bot **không còn gửi link báo giá**. Link khách nhận là link do **app
> báo giá của khách** phát ra, và chỉ được phát khi **nhân viên bấm Publish** trong studio. Nếu bạn
> test trên production mà bot vẫn gửi `/q/...` thì production đang chạy **build cũ** — xem mục cuối.

Trang để kiểm chứng: `https://technext-edge-casa-bff.vercel.app`
Staff key: **lấy từ Vercel env `WHATSAPP_VERIFY_TOKEN`** (Production). Không dán vào file này, không dán vào chat, không chụp màn hình kèm.

| Cần mở | Ở đâu |
|---|---|
| Hộp thư chờ người | `/handoff` |
| Studio báo giá | `/quotes` |
| Link khách | do app báo giá của khách phát, sau khi bấm **Publish guest link** |

## Chuẩn bị — đọc trước, nếu không sẽ test "không thấy gì"

1. **Số nhận là `+1 555-150-6595`.** Nhắn từ điện thoại của bạn tới số này.
2. **Số của bạn phải nằm trong danh sách test của Meta** (App Dashboard → WhatsApp → API Setup →
   "To" → Manage phone number list). Nếu không, bot **vẫn xử lý** nhưng tin trả về sẽ không tới —
   đã đo được đúng ca này: lượt đó trả `failed: 1, replied: 0`, và thread vẫn được park nên
   `/handoff` vẫn thấy. Đây là lỗi gửi phía Meta, không phải lỗi logic.
3. **Giữa các kịch bản, gõ `reset`** để xoá thread. (Từ khoá nhận: `reset`, `start over`,
   `restart`, `重置`, `重新开始`.)
4. Meta chỉ cho trả tin tự do trong **24h** kể từ tin cuối của khách. Test trong phiên là thoải mái.
5. Gửi **từng tin một, chờ trả lời** rồi mới gửi tin kế.

---

## KB1 — Chốt đủ trong một lượt, và **không** có link

**Gửi (copy nguyên):**
> Hi, I'm Miguel. We are 4 guests and we need 1 deluxe room. Check in on 2026-11-20 and check out on 2026-11-22, so 2 nights. Full board please. No airport transfer. All 4 of us will dive on 2026-11-21.

**Mong đợi:**
- Tóm tắt đầy đủ thông tin, trong đó có dòng **`• Room type: deluxe`** (không có chữ *(assumed)*).
- Câu **"Our reservations team is preparing your quotation now, and will send it to you here shortly."**
- **KHÔNG có link** — không `/q/...`, không `/quote/...`, không biểu tượng 🔗. Đây là điểm chính của Đợt 1: giá không được tới tay khách trước khi nhân viên xem.
- Không hỏi lại "how many of you will be diving" (câu "All 4 of us will dive" là ca `DIVERS_CLAUSE`).
- Không hỏi lại **"Would you like a standard, deluxe, or suite room?"** — đã nói "deluxe room".

**Kiểm chứng:** mở `/quotes` → quotation vừa sinh → **xem tiếp mục "Publish" bên dưới**.

---

## KB2 — Thiếu ngày (hai lượt)

**Lượt 1:** `Hi, 4 of us, full board, we want to dive.`
**Mong đợi:** bot hỏi **ngày check-in** và **số đêm**.

**Lượt 2:** `Oct 17 to Oct 20, so 3 nights, 2 deluxe rooms, name is Miguel.`
**Mong đợi:** không hỏi lại số đêm (đã suy ra từ khoảng ngày), đi tới tóm tắt, **không link**.

---

## KB2b — Câu hỏi mới: loại phòng (Đợt 4)

**Gửi:** `Hi, 2 of us from Oct 17 to Oct 19, full board, no transfer, no diving, name is Miguel.`
**Mong đợi:** bot **hỏi đúng một câu còn thiếu**:
> Would you like a standard, deluxe, or suite room?

Đây là lý do có câu hỏi này: bảng giá của khách (`rates.json`) tính **standard 7,600 / deluxe 11,200 /
suite 14,200** cho 2 khách một đêm. Trước đây payload luôn gửi `standard`, nên khách hỏi "deluxe" bị
báo giá thấp hơn **47%** ở dòng lớn nhất của kỳ nghỉ, và không ai nhìn ra.

**Gửi tiếp:** `Deluxe please`
**Mong đợi:** tóm tắt có **`• Room type: deluxe`**, không link.
**Kiểm chứng giá:** sau khi publish trong studio, mở link khách → tiền phòng phải theo giá deluxe
(2 đêm × 11,200 = 22,400), **không phải** 15,200 của standard. Đây là điểm kiểm tiền quan trọng nhất
của đợt này.

---

## KB3 — Lịch lặn lẻ ngày (NEVER RE-ASK)

**Gửi:** `We are 6 guests staying 3 nights from 2026-12-01 in 3 deluxe rooms, full board, no transfer. Diving: 1 person dives day 1, 5 people dive both days. Name is Ana.`

**Mong đợi:** **KHÔNG** hỏi "How many of you will be diving?" — thay vào đó là câu
**"We've noted your diving plan (…) — our team will confirm the day-by-day details with you."**

Không được thấy chữ **"routed to staff"** hay **"per-day quote calculation"** (đó là cách nói nội bộ, đã bỏ ở Đợt 2).

---

## KB4 — Khách đổi số đã chốt (đọc lại một lần)

**Lượt 1:** `we are 5 of us` → **Lượt 2:** `sorry, actually 3 of us` → **Lượt 3:** `yes that's right`

**Mong đợi:** lượt 2 có **"Just to check — … 5 guests → 3 guests …"**; lượt 3 **không nhắc lại**.

---

## KB5 — Điểm dừng: nói mãi không chốt

**Gửi lần lượt 4 tin:** `hmm` → `not sure yet` → `still thinking` → `maybe later`

**Mong đợi:** tới tin thứ 4 bot **dừng hỏi**, báo đã chuyển cho người **kèm danh sách còn thiếu**.
**Kiểm chứng:** `/handoff` → lý do **"Stuck — same questions open"**, có cột *Still needed* và *Their last message*.

---

## KB6 — Huỷ / hoàn tiền (chuyển người ngay)

**Gửi:** `Please cancel my booking for next week`
**Mong đợi:** **không** hỏi ngày check-in, chỉ câu "A member of the Casa team is handling your enquiry now…". `/handoff` → **"Cancellation / complaint"**.
Thử thêm: `I want a refund`, `this is a complaint`, `cancelling`.

---

## KB7 — Không phải câu hỏi đặt phòng

**Gửi:** `hey what is the wifi password?`
**Mong đợi:** một câu nói rõ số này dùng cho **yêu cầu đặt phòng mới**, đã chuyển team. `/handoff` → **"Not a booking enquiry"**.
Đối chứng (phải là booking bình thường): `do you have a room for two on Saturday?`

---

## KB8 — Không hứa điều sản phẩm không làm

Đây là phần **khó kiểm bằng mắt** vì nó phụ thuộc model. Sau mỗi lượt, đọc kỹ tin bot trả và
**báo lại nguyên văn** nếu thấy bất kỳ câu nào sau:
- một **con số tiền** (₱, $, PHP…)
- "your booking is confirmed" / "you're all set" / "reserved for you" / "we'll email you a confirmation"
- số khách / số đêm / số phòng **khác** với thứ bạn vừa nói
- **loại phòng khác** với thứ bạn vừa nói (bạn nói deluxe mà bot đọc lại standard/suite)
- một **ngày** bạn không hề nhắc

Bot phải nói "nothing is booked yet" và "someone from our team will follow up".

---

## KB9 — Tiếng Trung

**Gửi:** `我想找人工客服` → mong đợi câu giữ chỗ **bằng tiếng Trung**.
**Gửi tiếp:** `我们4个人，11月20日入住，住2晚，要豪华房，全餐，不需要接送，我的名字是 Miguel。` → tóm tắt tiếng Trung có dòng **`• 房型: 豪华房`**, **không link**.

---

## KB10 — Reset

**Gửi:** `reset` → lời chào mới, thread sạch.

---

## Sau khi chat: Publish trong studio — ⛔ chưa test được, xem lý do dưới

> **Trạng thái 27/09:** phần này sẽ trả **409 `not_priced`** ở bước 4 cho tới khi BFF của khách được
> deploy lại. Không phải lỗi phía mình — bản deploy hiện tại của họ là build cũ (`4c48918`) và
> `POST /api/estimates` **không trả `id`** cũng **không set cookie `ubg_sid`**, nên không có scenario
> nào để commit/share. Đã kiểm chứng bằng E2E cục bộ với code Stage1 của họ: chuỗi chạy hết và ra
> link mở được. Các bước 1–2 (định giá) thì **chạy được ngay**.

1. `/login` (staff key) → `/quotes` → mở quotation.
2. Bấm **Price with the Estimator BFF** → thẻ **Per guest**, nhãn `SAMPLE DATA`, khối *From the booking engine*.
   - Badge **"FIXTURE — prices are captured samples"** = đang gọi BFF của khách (đúng cấu hình hiện tại).
   - Badge **"SIMULATED"** = đang chạy bộ giả lập trong tiến trình.
3. Bấm **Approve Quotation & Prepare Guest Message** (bắt buộc — publish từ chối báo giá chưa duyệt).
4. Khung **Publish guest link**: tick **"I have checked this SAMPLE price"** rồi bấm **Publish guest link**.
   - Chưa tick → **409 `sample_not_acknowledged`** (đúng thiết kế).
   - **Hiện tại → 409 `not_priced`** (BFF cũ của khách, xem khung trên).
   - Khi có BFF mới → `✅ Published as version 1` + link.
5. Mở link đó → phải mở được app báo giá của khách, số tiền **trùng** số trong studio, có nhãn sample.
6. Bấm **Publish** lần hai → **409 `already_shared`** (một link cho mỗi báo giá; Q-005).
7. `/q/<slug>` (đường cũ của mình) → **410**, không còn phục vụ báo giá. ← **kiểm được ngay**

## Nếu có gì sai, gửi mình
- Nguyên văn tin bạn gửi và **nguyên văn tin bot trả**.
- Ảnh `/handoff` (nếu thread bị park) và ảnh khung Publish (nếu publish lỗi).
- Thời điểm gửi (giờ VN) và badge estimator đang ghi gì.

---

## Trạng thái production (27/09) — đọc trước khi test

Đã deploy build mới và đặt `ESTIMATOR_MODE=remote`. Kiểm live:

| Kiểm | Kết quả |
|---|---|
| `/healthz` | 200 |
| `estimator-status` | `kind:"remote"`, `reachable:true`, `mode:"fixture"` — gọi BFF của khách |
| `/q/<slug>` | **410** (trang khách cũ đã bỏ) |
| `/v1/converse` đủ thông tin | `done=true`, reply **không có** `/q/` lẫn `/quote/` |

**Test được ngay:** mọi thứ thuộc về bot — KB1 (không có link trong tin), KB2, **KB2b (loại phòng)**,
KB3–KB10.

**Chưa test được:** mục Publish → link khách, vì bản deploy BFF của khách là build cũ
(`POST /api/estimates` không trả `id`, không set `ubg_sid`). Cần deploy lại BFF của họ từ nhánh
Stage1 — xem `docs/upstream-note-bff-vercel-deploy.md` cho cách bundle đã dùng lần trước.

**Giá vẫn là sample** ở cả hai đường: bản deploy của khách chạy `FIXTURE_MODE=1`.

