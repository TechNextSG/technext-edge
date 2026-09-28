# Đối chiếu website resort ↔ engine ↔ rate card của mình

Ngày 28/09/2026. Nguồn: website thật của khách (`https://www.casaescondida-anilao.com`, các trang
`/rooms`, `/book-now`, `/location`) đối chiếu với rate card mẫu của mình
(`packages/extractor/src/rates.ts`) và các bản compute đã chụp của engine khách
(`contracts/odoo/examples/compute.*.json` trong repo `tn-casa-quotation-estimator`).

Mục đích: biết chỗ nào ba bên **khớp**, chỗ nào **lệch**, để không hứa sai với lead và để hỏi Phillip
đúng câu.

---

## 1. Khớp (dùng được làm điểm tin cậy khi demo)

| Hạng mục | Website khách | Engine khách (bản chụp) | Rate card mẫu của mình |
|---|---|---|---|
| Số phòng & loại | **24 phòng: 16 Standard, 4 Deluxe, 4 Suite** | `roomNames`: Standard A–P (16), Deluxe A–D (4), Suite A–D (4) | 3 loại `standard/deluxe/suite` |
| Sức chứa | Standard ≤2 (1 king **hoặc** 2 single), Deluxe ≤4 (2 queen), Suite ≤4 (2 queen/king) | giá phòng theo *số người trong phòng*: 2 và 4 | `ROOM_RATES` có đúng các mức 2 và 4 người |
| Full board | **+1.500/người/đêm**, không gồm trong giá phòng | `Full board — N days`, `₱1,500 per person/day` | `MEAL_RATE = 1500` × `nights` |
| Giá phòng 2 người | (không công bố) | Standard A 2 đêm = 11.000 → 5.500/đêm | standard 2pax = 7.600/đêm (rate card Phillip đưa) |
| Vai trò khách | Guest · Travel Agent · Dive Instructor (agent/instructor phải upload chứng chỉ) | `guestType: retail/agent/instructor` | `guestType` + chiết khấu 30% **chỉ phòng** |
| Tên phòng trên trang khách | — | "Standard A — 4 nights" (tên resource thật) | — |

→ Hai điểm đáng nói với lead: **danh mục phòng khớp từng phòng một** (16/4/4, đúng tên resource), và
**giá full board khớp** giữa website, engine và mình. Cái nhãn "Standard A" trên trang báo giá mẫu là
**tên phòng của engine**, không phải lỗi của mình.

## 2. Lệch — cần Phillip xác nhận

### 2.1. Giá van sân bay: website 14.000 vs **hai** nguồn của khách là 13.000

- Website `/book-now`: *"PHP 14,000 per van, round trip · max 7 pax with light luggage"*.
- **Rate card của chính khách** — `contracts/odoo/examples/rates.json`:
  `"transport":{"roundtrip":13000.0,"oneway":6500.0}`.
- Engine khách: mỗi **lượt** van là `rev: 6500`; round trip = 2 lượt = **13.000**
  (`compute.agent-group.json`: `vanRuns` arrival + departure, `vanCount: 2, rev: 13000`).
- Mình: `TRANSPORT_RATE.roundtrip` **đã trả về 13.000** (quyết định 28/09, xem kết luận bên dưới).

→ **Đã chốt 28/09 (TechNext tự quyết, không chờ Phillip): giữ 13.000, theo dữ liệu của khách.** Lý do:
engine mới là nơi thu tiền thật, và rate card này tồn tại để **xấp xỉ câu trả lời của engine** — bản nháp
nói 14.000 trong khi engine nói 13.000 là bản nháp mâu thuẫn với nguồn sự thật, đúng loại lỗi repo này
đang chống. Nếu trang web mới là đúng thì **sửa ở trang web (hoặc trong Odoo — nơi engine đọc)**, rồi con
số ở đây đi theo sau. Đã đổi `TRANSPORT_RATE.roundtrip` về 13.000 và khoá bằng test. Khi gặp Phillip chỉ
cần nói một câu: trang `/book-now` đang ghi 14.000, lệch 1.000/van so với rate card trong Odoo.

### 2.2. Sức chứa van: website 7 khách, engine chia 6+1 → chọn **6**

→ **Cũng chốt 28/09:** giữ `VAN_CAPACITY = 6`, vì đó là sức chứa duy nhất mà hệ thống của khách đã thể
hiện (một chuyến 7 khách bị chia thành van 6 + van 1), và đó là cách engine của họ tính tiền. Nếu trang
web đúng (7 khách) thì **số học của engine** mới là thứ cần sửa; còn nếu mình giả định 7 thì bản nháp
**thiếu một van** cho đoàn 7 người — tức thiếu tiền thật.

→ Ảnh hưởng tiền thật với nhóm đông: 7 khách = **2 van × 13.000 = 26.000** (không phải 1 van).

→ Ảnh hưởng tiền thật với nhóm đông: 7 khách = **2 van** (26.000), không phải 1 van.


### 2.3. Rate card mẫu của mình chỉ tính **1 van** cho mọi nhóm

`quotationTool.ts` sinh một dòng `Private Van Transfer (Round-Trip)` với `quantity: 1`. Với nhóm ≤6
khách thì đúng; nhóm lớn hơn thì **bản nháp của mình thiếu van** so với engine. Chỉ ảnh hưởng con số
nháp trước khi engine trả lời (giá thật vẫn của engine), nhưng nên biết mà không hứa "giá nháp là giá
thật".

### 2.4. Trẻ 0–6 tuổi miễn phí — mình không mô hình hoá

Website `/rooms`: *"Children 0–6 years old are free of charge"*. Engine có khối `foc` nhưng đó là FOC
**theo nhóm** (`per: 5, bracket: 6` = 1 miễn phí mỗi 5 khách trả tiền), không phải FOC theo tuổi.
`Trip.guests[].foc` trong schema chỉ là cờ do người dùng bật. Nếu khách hay đi cùng trẻ nhỏ, đây là
một dòng tiền đang thiếu trong cả hai hệ.

### 2.5. Day use và khách vãng lai — mình không có

- Website: day use phòng **8:00–17:00**; khách ở quá **3 giờ** tính giá day trip.
- Không có dòng tương ứng trong schema/engine (engine có `items` cho front desk tự thêm tay).

→ Chỉ cần nếu lễ tân muốn dùng hệ cho day-tripper; hiện phải thêm bằng `items`.

### 2.6. Giờ làm việc của lễ tân và lời hứa của bot
- Website: **lễ tân mở đến 21:00**, check-in từ 14:00, check-out 12:00.
- Bot: mọi handoff đều hứa *"a member of the Casa team will reply here"*, **không nói giờ**.

→ 22:00 khách nhận lời hứa đó và tới sáng mới có người. Nên thêm một câu theo giờ (hoặc nói rõ
"trong giờ làm việc"). Đây là câu chữ hướng khách, nên hỏi trước khi sửa.

## 3. Số WhatsApp: bot đang gửi từ số test, không phải số resort

- Website công bố **Phone/Viber +63 977 837 2272** (không nói WhatsApp), email
  `casaescondidaanilao@gmail.com`, Facebook `@CasaEscondidaAnilao`.
- Bot đang gửi từ số **Cloud API test `+1 555-150-6595`** (hỏi Meta: `qualityRating GREEN`,
  `platformType CLOUD_API`). Nút "Reply on WhatsApp" trên trang báo giá của mình đang trỏ về **số này** —
  đúng về mặt kỹ thuật (đó là cuộc trò chuyện khách đang ở trong), nhưng nhìn thì lạ.
- Cách sửa đúng: **đăng ký số của resort cho WhatsApp Cloud API** rồi đổi
  `RESORT_WHATSAPP_NUMBER=639778372272` trên Vercel (một biến, không cần sửa code). Chưa đổi bây giờ vì
  nếu số đó chưa bật WhatsApp thì nút sẽ dẫn vào ngõ cụt.

## 4. Hai đường cho đại lý, trong cùng một hệ sinh thái của khách

- Website: agent/instructor chọn vai trò rồi **upload chứng chỉ**, nhận báo giá qua **email**.
- Bot WhatsApp: mời **đăng nhập app báo giá** để tự phục vụ (`partnerInvitationReply`).

→ Cả hai đều của khách, nhưng là hai luồng khác nhau. Cần Phillip chốt luồng nào là chính thức cho
đại lý, để mình không mời sai chỗ.

## 5. Việc nên làm trước buổi demo

1. Hỏi Phillip **giá van round trip** (13.000 hay 14.000) và **sức chứa van** (6 hay 7 khách).
2. Nếu chốt 14.000: sửa `rates.ts` + test, và nói rõ với lead rằng con số engine vẫn là giá thật.
3. Nếu có số WhatsApp chính thức: set `RESORT_WHATSAPP_NUMBER` và (nếu Cloud API) đổi luôn số gửi.
4. Cân nhắc câu chữ handoff theo **giờ lễ tân 21:00**.

## 6. Đã làm ngày 28/09/2026 (theo yêu cầu)

| Việc | Thay đổi | Ghi chú |
|---|---|---|
| Giá van | đổi 13.000 → 14.000 (28/09 sáng), rồi **trả về 13.000** (28/09 tối) | Chốt cuối: theo dữ liệu của khách (rate card + engine). Trang `/book-now` ghi 14.000 là chỗ lệch cần khách sửa |
| Số van theo nhóm | thêm `VAN_CAPACITY = 6`, `vansForGuests()`, `vanLoads()`; `quotationTool.ts` và `simulatedEstimator.ts` đều tính đủ van | Nhóm 7 khách: 2 van × 14.000 = 28.000 (trước đây luôn 1 van) |
| Câu chữ handoff | `fallbackReply("handoff")` và `("apology")` thêm *"Our front desk is open until 9 PM (Manila time) … next morning"* (+ bản tiếng Trung) | Câu tĩnh, đúng ở mọi giờ; câu mở đầu mà test/field guide đang gắn vẫn giữ nguyên |

Vẫn **chưa** làm, vì cần Phillip chốt: trẻ 0–6 tuổi miễn phí, day use, và luồng đại lý nào là chính
(website upload chứng chỉ hay app tự phục vụ).

## 7. Chính sách cọc & hạn giữ chỗ (bổ sung 28/09, tối)

Đã làm: khối **Booking & Deposit Policy** trên trang copy của khách (`/q/:slug`), huy hiệu **Follow up
(>48h)** và **Stale (>72h)** trong studio (thẻ workflow + sidebar), mẫu tin nhắn nhắc copy được ở Bước 4,
và điều khoản nằm luôn trong tin nhắn gửi khách. Cửa sổ 48/72 giờ đọc từ `QUOTATION_NUDGE_HOURS` /
`QUOTATION_VALID_HOURS` (mặc định 48/72), tính từ **`sentToGuestAt`** — không phải từ lúc publish, và
bỏ qua record đã huỷ hoặc đã có folio (`submission`).

**Nguồn của từng câu** (vì đây là câu nói với khách):

| Câu | Nguồn | Trạng thái |
|---|---|---|
| "50% non-refundable down payment confirms your reservation" | `rates.json` → `terms.depositPct: 50` **và** website | ✅ hai nguồn |
| "The balance is due at least 1 month before your travel date" | website (`/rooms` → Booking & Payment) | ✅ một nguồn |
| "This quotation is valid until &lt;ngày giờ Manila&gt;" | **của mình** — mình biết lúc gửi, nên mình nói được lúc hết hạn; đây là hạn của **báo giá**, không phải lời hứa giữ phòng | ✅ trong tầm kiểm soát |
| ~~"we are holding your room for 72 hours"~~ | **không nguồn nào** — hệ thống mình không giữ phòng; phòng nằm trong Odoo của khách và do lễ tân xếp | ❌ đã bỏ, chờ Phillip |
| ~~"rooms and dive boats are first-come, first-served"~~ | website có câu "first come, first served" nhưng nói về **bãi xe** ("free for the first 20 cars") | ❌ đã bỏ, chờ Phillip |
| ~~"rooms are filling up quickly"~~ (mẫu tin nhắc) | **không nguồn nào** — mình không đọc tồn phòng của Odoo | ❌ đã bỏ |

**Hai câu hỏi cho Phillip** (nếu trả lời "có", mỗi câu là một dòng trong `bookingPolicyLines`):

1. Lễ tân có **thực sự giữ phòng** cho một báo giá chưa cọc không, và giữ bao lâu? Nếu có, câu chữ
   được phép nói "we are holding room X until …" — nhưng khi đó cần một chỗ trong hệ thống để lễ tân
   **thấy và gia hạn** việc giữ đó, chứ không chỉ là câu nói.
2. Phòng và thuyền lặn có theo nguyên tắc **ai cọc trước giữ trước** không? (Website hiện chỉ nói vậy
   với bãi xe.)


