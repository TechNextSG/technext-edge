# Kịch bản test tay trên WhatsApp

> **Chạy tự động được rồi (27/09).** Toàn bộ kịch bản dưới đây có một bản chạy bằng script, và nó đọc
> **đúng tin nhắn mà khách sẽ nhận** thay vì chỉ tin rằng webhook trả `replied: 1`:
>
> ```powershell
> # terminal 1 — BFF cục bộ, trỏ sender về máy mình để bắt được tin gửi đi
> $env:PORT="8799"; $env:WHATSAPP_GRAPH_BASE_URL="http://127.0.0.1:8899"; npx tsx apps/casa-bff/src/dev.ts
> # terminal 2
> node apps/casa-bff/scripts/whatsapp-manual-run.mjs --port 8799 --capture 8899 --delay 4000 --verbose
> ```
>
> Kết quả lần chạy 27/09: **22/22 check xanh** (KB1–KB10). Hai điều cần biết khi đọc kết quả: `--delay` để tránh
> quota Gemini free tier (15 request/phút, mỗi lượt tốn vài request); và nếu lượt nào provider chết thì
> script ghi **`⊘ skipped`** chứ không tính là lỗi sản phẩm — một lượt không tới được model thì không
> nói gì về bot cả.

### Kiểm chứng hành trình (đóng vai guest → staff → guest)

Muốn xem **cả hành trình trong một lần chạy**, in ra đúng những gì mỗi vai nhìn thấy:

```powershell
# terminal 1 — BFF nối đúng như khi demo (engine của khách + bắt tin gửi đi ở máy mình)
$env:PORT="8799"; $env:ESTIMATOR_MODE="remote"
$env:ESTIMATOR_BASE_URL="https://tn-casa-estimator-fixture.vercel.app"
$env:WHATSAPP_GRAPH_BASE_URL="http://127.0.0.1:8899"; npx tsx apps/casa-bff/src/dev.ts
# terminal 2
node apps/casa-bff/scripts/journey-walkthrough.mjs --port 8799 --capture 8899
```

Sáu bước, đúng thứ tự một khách thật đi: guest hỏi (thiếu loại phòng) → bot hỏi đúng một câu → guest
trả lời → **staff** mở studio (thấy chuyến bot dựng) → staff định giá + sửa chuyến + re-price → approve
→ publish → **guest** mở link và đọc trang báo giá của khách.

Script **dừng và báo lỗi** nếu hành trình đó không sinh ra quotation, hoặc sinh ra nhiều hơn một — vì
một walkthrough không phân biệt được "bot không tạo gì" với "đây là việc bot đã làm" thì tệ hơn không
có. Lần chạy đầu của nó đã bắt được một lỗi thật: `roomType` bị mất chữ `i` trong bảng regex, nên khách
trả lời "**Deluxe** please" bị bot hỏi lại — xem `docs/01-team-guide.md` (mục "A table of hand-written
regexes drifts").
>
> **Khoá DeepSeek trong `.env.local` đã chết** (`404 Application not found`), nên khi Gemini bị 429 thì
> lượt đó fail. Bản production có env riêng trên Vercel và đang chạy tốt.

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

> **Đọc trước: KB1 được viết lại cho khớp bản chụp (27/09).** Ở chế độ fixture, BFF của khách **không
> tính giá** — nó chọn một response đã chụp theo *hình dạng* chuyến (`bff/src/odoo/fixture.ts`), và
> khách lẻ có lặn, không học khoá thì luôn rơi vào `compute.retail-couple.json`: **2 khách Ana và Ben,
> 20–21/11/2026, phòng "Standard A", ₱31.200**.
>
> Bản KB1 cũ (4 khách, 1 phòng deluxe) vì thế làm **link khách nói ngược lại cuộc chat**: WhatsApp đọc
> lại "4 khách · Room type: deluxe", còn link khách mở ra 2 người lạ, phòng Standard, ngày khác. Đúng
> lúc đang định chứng minh bot hiểu đúng loại phòng thì màn hình cho thấy điều ngược lại. Nên KB1 dùng
> **cùng hình dạng với bản chụp** — 2 khách, 20/11, 2 đêm, Ana đi cùng Ben — để tên, ngày, số khách, số
> đêm đều khớp; **chỉ còn loại phòng lệch**, và chỗ lệch đó là cảnh trung thực nhất để nói (xem mục
> Publish).

**Gửi (copy nguyên):**
> Hi, I'm Ana and I'm travelling with Ben. 2 guests, 1 deluxe room. Check in on 2026-11-20 and check out on 2026-11-22, so 2 nights. Full board please. No airport transfer. One of us will dive on 2026-11-21.

**Mong đợi:**
- Tóm tắt đầy đủ thông tin, và **có chữ `Deluxe`** — model có thể in thành dòng `• Room type: Deluxe`
  hoặc gộp vào `• Rooms: 1 Deluxe Room`; cả hai đều đúng, điều cần kiểm là **đúng loại khách nói**.
- `Guests: 2` và `Stay: Nov 20 – 22, 2026 (2 nights)`.
- Câu **"Our reservations team is preparing your quotation now, and will send it to you here shortly."**
- **KHÔNG có link** — không `/q/...`, không `/quote/...`, không biểu tượng 🔗. Đây là điểm chính của Đợt 1: giá không được tới tay khách trước khi nhân viên xem.
- Không hỏi lại **"Would you like a standard, deluxe, or suite room?"** — đã nói "deluxe room".
- Không hỏi lại "how many of you will be diving" (câu "One of us will dive" là ca `DIVERS_CLAUSE`).

**Kiểm chứng:** mở `/quotes` → quotation vừa sinh → **xem tiếp mục "Publish" bên dưới**.

---

## KB2 — Thiếu ngày (hai lượt)

**Lượt 1:** `Hi, 4 of us, full board, we want to dive.`
**Mong đợi:** bot hỏi **ngày check-in** và **số đêm**.

**Lượt 2:** `Oct 17 to Oct 20, so 3 nights, 2 deluxe rooms, name is Miguel.`
**Mong đợi:** không hỏi lại số đêm (đã suy ra từ khoảng ngày), đi tới tóm tắt, **không link**.

---

## KB2b — Câu hỏi mới: loại phòng

**Gửi:** `Hi, 2 of us from Nov 20 to Nov 22, full board, no transfer, no diving, name is Ana.`
**Mong đợi:** bot **hỏi đúng một câu còn thiếu**:
> Would you like a standard, deluxe, or suite room?

Đây là lý do có câu hỏi này: bảng giá của khách (`rates.json`) tính **standard 7.600 / deluxe 11.200 /
suite 14.200** cho 2 khách một đêm. Trước đây payload luôn gửi `standard`, nên khách hỏi "deluxe" bị
**báo thiếu ₱3.600 mỗi đêm** ở dòng lớn nhất của kỳ nghỉ, và không ai nhìn ra. Nói bằng **peso mỗi đêm**
chứ đừng nói "47%": 3.600 so với 7.600 là con số người nghe kiểm được ngay trên bảng giá, còn phần trăm
thì đổi nghĩa tuỳ số khách trong phòng (4 khách một phòng deluxe là 16.400/đêm, không so với 7.600 được).

**Gửi tiếp:** `Deluxe please`
**Mong đợi:** tóm tắt có **`• Room type: deluxe`**, không link.

**Kiểm chứng giá:** đây là chỗ **hai chế độ khác nhau**, và phải nói đúng đang ở chế độ nào:
- **`ESTIMATOR_MODE=simulated`** (tab "số tiền đổi theo dữ liệu"): đổi loại phòng → tiền phòng đổi thật,
  2 đêm: **15.200 → 22.400** (₱3.600 × 2 đêm). Đây là cảnh duy nhất cho thấy con số chạy theo dữ liệu.
- **`ESTIMATOR_MODE=remote`** (tab "tích hợp thật"): dòng giá **đứng yên** vì bản chụp của khách không
  tính lại. Nói: *"revision đóng băng mang `deluxe`, còn dòng tiền vẫn là Standard vì fixture của anh
  trả lại bản chụp. Nối Odoo thật thì dòng này là Deluxe, cộng ₱3.600 mỗi đêm."*

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

## Sau khi chat: Publish trong studio — ✅ chạy được end-to-end (27/09)

> **Cập nhật 27/09:** bản fixture của BFF khách (`tn-casa-estimator-fixture.vercel.app`) đã được
> build lại từ **Stage1_Estimator_Tools hiện tại** (`dac70e6`), nên `POST /api/estimates` **có trả
> `id`** và **có set cookie `ubg_sid`**, và `PATCH /api/estimates/:id` + `commit` + `share` đều chạy.
> Chuỗi dưới đây đã chạy hết một lần thật trên production (ghi lại ở mục "Đã kiểm live" cuối file).
>
> **Một điều phải nói đúng khi demo:** gateway fixture của khách **không tính giá** — nó trả về
> response đã chụp (`bff/src/odoo/fixture.ts`: *"Không có logic giá ở đây"*, chọn file theo hình dạng
> trip). Nên trong chế độ `remote` + fixture, sửa **loại phòng** đổi **payload và revision** nhưng
> **không đổi con số** (vẫn 31.200 của ca couple đã chụp). Đó cũng là lý do KB1 được viết lại cho khớp
> hình dạng bản chụp: nếu chat nói 4 khách còn link nói 2 khách thì màn hình đang phản bác chính điều
> mình vừa chứng minh.
>
> **Cảnh "tiền đổi theo dữ liệu" chỉ chạy ở chế độ `simulated`** — dùng tab Preview riêng
> (`technext-edge-casa-bff-sim.vercel.app`), xem mục "Hai tab khi demo" ở cuối file.

1. `/login` (staff key) → `/quotes` → mở quotation.
   - Sidebar giờ có thẻ **🎯 Extractor scorecard**: *x/y unchanged* — bao nhiêu báo giá đã được định giá
     mà **không phải sửa chuyến**. Đây là con số duy nhất đo được chất lượng trích xuất, và là thứ
     đáng cho lead xem.
2. Bấm **Price with the Estimator BFF** → thẻ **Per guest**, nhãn `SAMPLE DATA`, khối *From the booking engine*.
   - Badge **"FIXTURE — prices are captured samples"** = đang gọi BFF của khách (đúng cấu hình hiện tại).
   - Badge **"SIMULATED"** = đang chạy bộ giả lập trong tiến trình.
3. **Trip review** (mới): bảng **Rooms** (chọn `standard/deluxe/suite` cho từng phòng) và bảng **Guests**
   (phòng của từng khách, khoá học `DSD / Open Water / AOW`, và lưới **D · 3rd · Night** cho từng ngày).
   - Sửa xong bấm **Save trip & re-price** → giá được tính lại **trên cùng một scenario** (PATCH), không
     tạo scenario thứ hai.
   - **Sửa chuyến sẽ huỷ duyệt**: status về *Pending Hono Confirmation* và tin nhắn đã soạn bị xoá —
     nên phải Approve lại. Đây là điều cố ý: duyệt là duyệt cho **một chuyến cụ thể**.
   - Bấm **Save trip & re-price** khi không sửa gì → không ghi nhận "sửa" (scorecard không bị lệch).
4. Bấm **Approve Quotation & Prepare Guest Message** (bắt buộc — publish từ chối báo giá chưa duyệt).
5. Khung **Publish guest link**: tick **"I have checked this SAMPLE price"** rồi bấm **Publish guest link**.
   - Chưa tick → **409 `sample_not_acknowledged`** (đúng thiết kế).
   - Thành công → `✅ Published as version 1` + link dạng
     `https://tn-casa-estimator-fixture.vercel.app/quote/<token>`.
   - Đã publish rồi thì **không sửa chuyến được nữa** → **409 `already_shared`** (khách đang giữ link;
     sửa dưới chân khách là tự động đổi giá — Q-005).
6. Mở link đó → mở được app báo giá của khách (SPA của họ), số tiền **trùng** số trong studio, có nhãn
   sample. `GET /api/share/<token>` trả đúng revision đã đóng băng, **kèm `trip.rooms[].type`** — đây là
   chỗ chứng minh loại phòng khách nói đi tới tận bản đã publish.
7. Bấm **Publish** lần hai → **409 `already_shared`** (một link cho mỗi báo giá; Q-005).
8. `/q/<slug>` (đường cũ của mình) → **410**, không còn phục vụ báo giá — trang đó giờ có hai nút:
   *Reply on WhatsApp* và *Staff sign-in*.

**Không còn bảng giá tự nhập.** Bảng line-item và ô `Discount %` đã bị bỏ: chúng là nguồn giá thứ hai
( nhập tay 42.400 trong khi engine, thẻ per-guest và link khách nói số khác). Giá bây giờ chỉ có một
nguồn: engine. Nếu thấy chỗ nào vẫn cho nhập giá bằng tay, **báo lại ngay** — đó là lỗi.

### Đã kiểm live (27/09, production)

| Bước | Kết quả |
|---|---|
| `POST /v1/converse` đúng câu KB1 | `done=true`, draft mang **`rooms: r1:deluxe`**, guests **Ana + Ben** |
| `POST /v1/quotes/:id/sync-estimate` | 200, ghi được `estimator.id` + cookie `ubg_sid` (BFF khách đã trả) |
| `POST /v1/quotes/:id/confirm` | 200, `confirmed_by_hono` |
| `POST /v1/quotes/:id/publish` + `acknowledgeSample` | 200, `seq=1`, link `…/quote/ye2Gtt0se…` |
| Mở link khách | 200 (SPA của khách) |
| `GET /api/share/<token>` | `seq=1`, label **`Ana — 2 nights`**, guests **Ana + Ben**, `2026-11-20 → 2026-11-22`, **`rooms: r1:deluxe`** |
| ...nhưng dòng giá trong cùng bản đó | **`Standard A — 2 nights`, ₱7.600** × 2 → tổng ₱31.200 (**bản chụp**, không tính lại) |
| `/api/health` của BFF khách | `{"ok":true,"mode":"fixture"}` |

**Câu nói đúng cho chỗ lệch cuối bảng đó** (đây là cảnh trung thực nhất, đừng giấu):

> "Revision đã đóng băng mang đúng `deluxe` mà khách nói — anh xem `rooms: r1:deluxe`, tên Ana và Ben,
> đúng ngày. Dòng tiền vẫn ghi `Standard A` vì fixture của anh **không tính giá**, nó trả lại bản chụp.
> Nối Odoo thật thì dòng này là Deluxe: **+₱3.600 mỗi đêm**."

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
| `/q/<slug>` | **410** (trang khách cũ đã bỏ), HTML có 2 nút |
| `/v1/converse` đủ thông tin | `done=true`, reply **không có** `/q/` lẫn `/quote/` |
| BFF khách `/api/health` | `{"ok":true,"mode":"fixture"}` — build từ Stage1 `dac70e6` |

**Test được ngay:** tất cả — bot (KB1–KB10) **và** mục Publish → link khách, vì BFF của khách đã được
build lại từ Stage1 hiện tại nên có `id`, cookie `ubg_sid`, `PATCH`, `commit`, `share`. Xem bảng
"Đã kiểm live" ở mục Publish.

**Giá vẫn là sample** ở cả hai đường: bản deploy của khách chạy `FIXTURE_MODE=1`, và bộ giả lập của
mình luôn gắn `sample: true`. Khác biệt duy nhất đáng nhớ: **fixture của khách trả lại response đã
chụp** (không tính giá), còn `ESTIMATOR_MODE=simulated` **tính theo `rates.json`** — nên chỉ ở chế độ
simulated mới thấy con số đổi khi sửa loại phòng / số ngày lặn.

---

## Hai tab khi demo (và tab nào nói điều gì)

| | Tab "tích hợp thật" | Tab "số tiền đổi theo dữ liệu" |
|---|---|---|
| URL | `technext-edge-casa-bff.vercel.app` (**Production**) | `technext-edge-casa-bff-sim.vercel.app` (**Preview**) |
| `ESTIMATOR_MODE` | `remote` → gọi BFF của khách | `simulated` → tính trong tiến trình |
| Badge trên studio | `FIXTURE — prices are captured samples` | `SIMULATED — sample prices, not a real quote` |
| Chứng minh | bot → BFF của khách → app của khách → **link khách mở được**; revision đóng băng mang `rooms[].type` | đổi loại phòng → **tiền phòng đổi thật** (15.200 → 22.400 cho 2 đêm) |
| Đừng làm gì ở tab này | đừng kỳ vọng con số đổi khi sửa chuyến (fixture không tính lại) | **đừng bấm Publish** — bộ giả lập không có host cho `/quote/<token>` |

**Thứ tự đề xuất (≈8 phút):** WhatsApp thật (KB1) → studio tab "tích hợp thật" (Per guest + Trip review,
nói về lỗi loại phòng bằng peso/đêm) → Approve → Publish → **mở link khách** → quay lại scorecard →
cuối cùng nhảy sang tab simulated, đổi `standard` ↔ `deluxe` cho lead thấy con số chạy.

**Hai điều phải nói rõ, tránh bị hỏi ngược:** giá là **sample** ở cả hai tab (cứ đọc theo badge trên
trang); và fixture của khách **không tính giá**, nên con số thật chỉ có khi Phillip đưa key Odoo.
**Đừng publish bản seed `QT-1010-SKY`** trong lúc demo — publish là một chiều, bản đó sẽ hết sửa được.

