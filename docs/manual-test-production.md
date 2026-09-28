# Chạy tay thật: WhatsApp thật → bot → studio → link khách

Dành cho người **tự bấm tay** trên production, không dùng script. Mỗi lần chạy hết ~5 phút, và
điện thoại của bạn sẽ nhận tin thật.

> **Điều phải biết trước:** deployment engine mà production đang trỏ vào là bản **fixture** của khách
> (`tn-casa-estimator-fixture.vercel.app`). Bản đó giữ scenario + share token trong **bộ nhớ của một
> instance serverless**, nên link có thể 404 bất cứ lúc nào — publish **không** còn từ chối vì lý do đó,
> nó kiểm link rồi gửi **bản sao của mình** (`/q/<slug>`) nếu link khách không mở, và studio ghi rõ lý do.
> Số đo: `docs/upstream-note-bff-vercel-deploy.md`. Vì vậy **bước 5 dưới đây phải mở link ngay**, và câu
> nói thật khi demo nằm ở cuối file.

---

## 0. Chuẩn bị (2 phút)

1. **Số điện thoại của bạn phải nằm trong danh sách test của Meta app.** Số đang dùng được:
   `84359386414`. Nếu chưa có, vào Meta App → WhatsApp → API Setup → *To* → thêm số.
2. **Lấy key staff** để mở studio. Từ 2026-09-28 key này là `STAFF_ACCESS_KEY` (không còn là
   `WHATSAPP_VERIFY_TOKEN` — key đó Meta cũng biết, và đã lộ trong chat nên production đã đổi; token cũ
   giờ trả **401**). Key nằm trong `.env.local`:

   ```powershell
   cd E:\technext-edge
   $t = (Get-Content .env.local | Where-Object { $_ -match '^STAFF_ACCESS_KEY=' }) -replace '^STAFF_ACCESS_KEY=','' -replace '"',''
   Start-Process "https://technext-edge-casa-bff.vercel.app/quotes?token=$t"
   ```

   **Hai secret khác nhau, đừng lẫn** (từ 2026-09-28): `STAFF_ACCESS_KEY` mở studio và mọi route
   `/v1/quotes/*`. Các route của **kênh** (`/v1/channels/whatsapp/threads/...`) vẫn dùng
   `WHATSAPP_VERIFY_TOKEN` — vì Meta cũng là người gọi chúng. Đo trên production: key staff vào route
   kênh → **401**; token WhatsApp vào → 200.
3. **Tab thứ hai (tuỳ chọn)** — chỉ cần khi muốn cho lead thấy *tiền đổi theo dữ liệu*: tab đó là
   `https://technext-edge-casa-bff-sim.vercel.app/quotes?token=$t`, chạy engine giả lập **có tính lại**
   (7.600 → 11.200/đêm khi đổi sang deluxe). Tab production thì **không** đổi số, vì fixture trả lại bản
   chụp — nói thẳng điều đó khi demo.
4. **Reset cho lần chạy sạch** (xoá hội thoại + đóng báo giá đang mở của số đó) — dùng token **kênh**:

   ```powershell
   $w = (Get-Content .env.local | Where-Object { $_ -match '^WHATSAPP_VERIFY_TOKEN=' }) -replace '^WHATSAPP_VERIFY_TOKEN=','' -replace '"',''
   Invoke-RestMethod -Method Post -Uri "https://technext-edge-casa-bff.vercel.app/v1/channels/whatsapp/threads/84359386414/reset" -Headers @{ 'x-verify-token' = $w }
   ```

   > Reset **đóng** báo giá đang mở của số đó (nó chuyển sang tab *Archived*). Record đã publish thì
   > không bị đóng. Nên chạy reset **trước** mỗi lần test, không phải giữa chừng.

---

## 1. Kịch bản A — luồng đầy đủ (khách lẻ, có lặn)

Nhắn **từ WhatsApp của bạn** tới số resort (số test `+1 555-150-6595`), đúng hai tin sau.

### Tin 1 — cố tình thiếu loại phòng

> Hi, I'm Ana. 2 guests, 1 room. Check in on 2026-11-20 and check out on 2026-11-22, so 2 nights. Full board please. No airport transfer. One of us will dive on 2026-11-21.

**Phải thấy trên điện thoại:** bot đọc lại ngày/khách/ăn/lặn, và hỏi **đúng một câu**:
*"Would you prefer a standard, deluxe, or suite room?"* — không hỏi lại ngày, không hỏi lại số khách.
**Không được có:** link, giá, chữ "confirmed".

### Tin 2 — trả lời loại phòng

> Deluxe please

**Phải thấy:** tóm tắt có dòng room **Deluxe**, câu *"nothing is booked yet"* và *"our team is preparing your quotation"*.
**Vẫn không được có:** link hay giá.

### Trong studio (tab 1)

Mở báo giá mới nhất của Ana trong sidebar (mã dạng `QT-1120-ANA-…`). Trạng thái lúc này:
**Needs review**, màn 1, `Rooms: r1:deluxe`.

> Queue hiện có sẵn vài record test cũ. **Bỏ qua** `QT-1121-ANA-911E50C7` (record tôi publish lúc audit,
> `Link ready — not sent`) và `QT-1205-SAM-7798D2B1` (record test trên tab sim). Record của lần chạy này
> là record **mới nhất** cùng số điện thoại, và là record duy nhất ở trạng thái `Needs review` có
> `r1:deluxe` do chính bạn vừa tạo.

| Bước | Bấm | Phải thấy |
|---|---|---|
| 1 | **Save & get price** (thanh dưới) | vài giây → màn 2 · badge `Priced — needs approval` · **Engine total ₱31.200** · badge engine `Sample engine (captured prices) — not a real quote` |
| 2 | **Continue to approve →** | màn 3 · `Step 3 · Approve` · preview lời nhắn |
| 3 | **Approve quotation** | tự sang màn 4 · `Approved — not sent yet` · nút "Create link & send" **mờ** vì chưa tick |
| 4 | tick **I have checked this sample price** | hai nút sáng lên |
| 5 | **Create link & send** | `Sent to guest` + ô link có URL `…/quote/<token>` — hoặc link `/q/<slug>` của mình nếu link khách không mở được, kèm câu giải thích |

> Nếu bạn bấm **Create link only** (không gửi), badge phải là **`Link ready — not sent`** và nút chính
> đổi thành **Send the message** — không còn nói "đã gửi khách" khi thực ra chưa gửi. Đây là lỗi tìm
> thấy trên production 2026-09-28 và đã sửa.

**Trên điện thoại:** tin nhắn thứ ba từ resort, chứa **link báo giá**. Kiểm tra: tin đó **không có giá**
của mình, có nhãn "Sample prices", và câu *"nothing is booked yet"*.

### Mở link — làm NGAY, đừng để lâu

Mở link trên điện thoại (hoặc dán vào tab 3 của máy tính). Phải thấy trang báo giá của khách:

- banner *"Sample data — prices are captured examples, not live quotes"*
- **Your quote · Version 1**
- **TOTAL ₱31.200** và itinerary có ngày lặn
- thẻ *Per guest* với phòng "Standard A" và Full board

> Thẻ per-guest ghi **"Standard A"** dù mình đặt deluxe: đó là **bản chụp** của fixture, không phải lỗi
> phía mình — engine không tính lại, chỉ phát lại câu trả lời đã chụp (đây chính là điều phải nói thật
> với lead). Phòng **deluxe** mà studio gửi đi thì kiểm được ở payload: `GET /v1/quotes/<ID>` → `bffTrip.rooms[0].type`.

> ⚠️ Nếu hiện *"This quote link is not valid or has expired"*: đó là **bản fixture của khách mất dữ
> liệu**, không phải lỗi luồng. Bấm **Create link only** một lần nữa rồi mở lại ngay — nếu vẫn 404 thì
> đúng là đang gặp instance khác. Ghi lại thời điểm gặp để báo khách.

---

## 2. Kịch bản B — hai bẫy phải tự kiểm

### B1. Khách đổi số lượng giữa chừng (trong cùng một enquiry)

Sau khi đã Approve ở kịch bản A, nhắn tiếp từ điện thoại:

> Sorry, there are 4 of us

**Phải thấy trong studio** (tải lại trang): **giữ nguyên mã báo giá**, nhưng
`status` về `Priced — needs approval`, **mất duyệt**, có dòng cảnh báo *"The guest changed the trip
after it was priced…"*. Bấm Approve lại mới gửi được. Đây là điều cố ý: duyệt là duyệt cho **một
chuyến cụ thể**.

### B1b. Sửa của nhân viên phải sống sót (bẫy A1 — đã sửa 2026-09-28)

Nếu bạn **đã sửa chuyến trong studio** (ví dụ đổi ngày lặn từ Ana sang Ben) rồi Approve, sau đó khách
nhắn một câu **không nói lại** thông tin đó:

> One more thing: our flight lands at 4pm, everything else is as we said

**Phải thấy:** bản sửa của bạn **vẫn còn** (`Ben: dive 22/11`, `Ana: no dive`), badge **vẫn
`Sent to guest`/`Approved`** theo trạng thái thật, và một dòng cảnh báo dạng *"the guest's latest
message would change priced facts you corrected … The corrected trip and its price were kept"*. Nếu
thay vào đó bản sửa bị đảo lại và mất duyệt kèm câu đổ lỗi cho khách — đó là lỗi cũ, báo ngay.
(Đo trước khi sửa: đúng y hệt như vậy, trên `QT-1121-ANA-46717280`.)

### B2. Reset là hết một enquiry

Nhắn tiếp:

> reset

**Phải thấy:** lời chào mới. Và trong studio: báo giá cũ **đã đóng** (tab *Archived*, ghi chú "Closed
when the guest restarted the conversation"). Nhắn một enquiry mới → **mã báo giá mới**, tên mới, không
`pricing`, không duyệt — **không** thừa hưởng gì của enquiry trước. (Đây là lỗi đã sửa: hôm trước một
báo giá đã duyệt còn hiện tên khách của enquiry sau.)

### B3. Nhân viên đổi chuyến

Trong studio màn 1: đổi một phòng sang `suite`, bấm **Save & get price**. Phải thấy giá được tính lại
**trên cùng một scenario** và duyệt bị huỷ. Ở tab production **số không đổi** (fixture trả bản chụp) —
nói thẳng; muốn thấy số đổi thì làm ở tab sim.

---

## 3. Những câu phải nói thật khi demo

1. **Bot không báo giá, không gửi link.** Giá chỉ tới tay khách sau khi **một người** duyệt và gửi.
2. **Giá là của engine, không phải của mình.** Con số ₱31.200 là câu trả lời của engine; sửa chuyến thì
   payload + bản đóng băng đổi, còn fixture thì trả lại bản chụp nên số có thể đứng yên.
3. **Link do app của quý khách phát hành.** Và: *bản demo đó chưa có database nên link chỉ sống khi
   request rơi đúng instance; bản thật chạy Odoo thì bền.* Khi link đó không mở, khách nhận **bản sao
   cùng revision trên trang của mình** (`/q/<slug>`), studio nói rõ vì sao — không có chuyện gửi link
   chết mà báo thành công.
4. **Bot không tự bịa.** Nếu model viết câu sai (giá, chữ "confirmed", loại phòng khác), câu đó bị chặn
   và thay bằng bản do code dựng.

---

## 4. Sự cố thường gặp

| Hiện tượng | Nghĩa | Làm gì |
|---|---|---|
| Trang khách "not valid or has expired" | Fixture của khách mất token | Mở link `/q/<slug>` mà studio đưa (bản sao của mình), rồi ghi lại thời điểm để báo khách |
| Studio: badge `Link ready — not sent` | Đã tạo link nhưng **chưa** gửi tin cho khách | Bấm **Send the message** — badge chỉ đổi sang `Sent to guest` sau khi gửi thật |
| Studio: *"this price did not come from the booking engine…"* | Record có giá sample nhưng chưa có scenario | Vào **màn 2 → Get price**, rồi Approve lại |
| Bot im lặng, hoặc trả lời *"something went wrong on our side"* | Gemini free tier 429 (15 req/phút) | Đợi ~1 phút rồi nhắn lại |
| Tin không tới điện thoại, webhook trả `failed:1` | Meta từ chối (`#131030` = số chưa có trong danh sách test) | Thêm số vào *To* trong Meta App |
| Muốn chạy lại từ đầu | — | Mục 0.4 (reset) rồi bắt đầu lại từ tin 1 |

---

## 5. Sau khi test xong

Xoá dữ liệu test khỏi queue để buổi demo sạch:

```powershell
# đóng báo giá test (giữ record, chỉ rời khỏi queue đang làm việc)
$t = (Get-Content .env.local | Where-Object { $_ -match '^STAFF_ACCESS_KEY=' }) -replace '^STAFF_ACCESS_KEY=','' -replace '"',''
Invoke-RestMethod -Method Post -Uri "https://technext-edge-casa-bff.vercel.app/v1/quotes/<QUOTE_ID>/cancel?token=$t"
```

Báo giá đã publish thì **không sửa được nữa** (link khách đang giữ) — muốn demo lại từ đầu thì tạo
enquiry mới, đừng cố sửa bản đã gửi.
