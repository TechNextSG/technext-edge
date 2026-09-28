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
- Mình: `TRANSPORT_RATE = { roundtrip: 14000, oneway: 6500 }` — round trip **theo website**, one-way
  theo rate card.

→ **Hai nguồn của khách nói 13.000, một trang công khai nói 14.000.** Engine mới là chỗ tính tiền thật,
nên hôm nay khách sẽ bị tính 13.000 còn trang web nói 14.000 — một trong hai đã cũ. Câu hỏi cho Phillip:
*giá van round trip hiện hành là bao nhiêu, và nguồn nào chuẩn — trang web hay rate card trong Odoo?*
Nếu chốt 13.000 thì sửa **một dòng** (`TRANSPORT_RATE.roundtrip`) + test.

### 2.2. Sức chứa van: website 7 khách, mình **suy ra** 6 từ một ví dụ

- Website: *"max 7 pax with light luggage"*.
- Engine: trong **một** bản chụp, 7 khách được chia **2 van** (van 1: 6 khách, van 2: 1 khách).
- `VAN_CAPACITY = 6` trong `rates.ts` là **suy luận của mình** từ đúng một data point đó — không nguồn
  nào nói sức chứa là 6. Cần Phillip xác nhận 6 hay 7; con số này chỉ dùng để nháp đủ số van,
  giá thật vẫn của engine.

→ Ảnh hưởng tiền thật với nhóm đông: 7 khách theo website = 1 van 14.000; theo engine = 2 van
26.000 (và nếu tính 6.500/lượt thì 2 lượt × 2 van = 26.000).


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
| Giá van | `TRANSPORT_RATE.roundtrip: 13000 → 14000` (giữ `oneway: 6500` của engine) | Theo **giá công bố trên website**; engine vẫn tính 13.000 → **vẫn là câu hỏi mở cho Phillip**, đã ghi ngay trong comment của `rates.ts` |
| Số van theo nhóm | thêm `VAN_CAPACITY = 6`, `vansForGuests()`, `vanLoads()`; `quotationTool.ts` và `simulatedEstimator.ts` đều tính đủ van | Nhóm 7 khách: 2 van × 14.000 = 28.000 (trước đây luôn 1 van) |
| Câu chữ handoff | `fallbackReply("handoff")` và `("apology")` thêm *"Our front desk is open until 9 PM (Manila time) … next morning"* (+ bản tiếng Trung) | Câu tĩnh, đúng ở mọi giờ; câu mở đầu mà test/field guide đang gắn vẫn giữ nguyên |

Vẫn **chưa** làm, vì cần Phillip chốt: trẻ 0–6 tuổi miễn phí, day use, và luồng đại lý nào là chính
(website upload chứng chỉ hay app tự phục vụ).

