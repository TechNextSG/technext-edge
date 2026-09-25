# Schema và hợp đồng API cho kênh AI (P5)

Trạng thái: bàn giao 2026-09-25 · nhánh `feat/p2-booking` · đọc cùng `contracts/` và `bff/src/`
Dành cho: người dựng extractor / chatbot trong `ai/` (WhatsApp, email, chat → Trip → link báo giá).

Tài liệu này mô tả Odoo **như BFF đang dùng nó**, không phải Odoo trần. Mọi dòng dưới đây kiểm
được trong file nguồn ghi ở cột hay ở mục 9. Chỗ nào repo chưa định nghĩa thì ghi "chưa có".

## 1. Mục đích và ranh giới

```
chat / email / WhatsApp --> ai/ extractor --> Trip JSON --> BFF /api/estimates ==> Odoo compute
                                                              |
                                                              +--> Draft store --> /quote/:token (link)
```

- **Extractor nhận text, trả `Trip` kèm trạng thái từng field.** Không đọc DB, không biết Odoo tồn
  tại, không tính giá, không submit (spec §2 "Ranh giới với `ai/`", backlog B-002).
- **Mọi lời gọi đi qua BFF (`/api/*`).** Không gọi `/v1/*` của Odoo trực tiếp, không cầm `api-key`
  nào. Key Odoo chỉ sống ở server (`bff/src/auth/credential.ts`).
- **Không bao giờ gọi đặt chỗ.** `POST /api/estimates/:id/submit` là của người đã đăng nhập, bấm tay
  (spec §13: `submit` "Không bao giờ … Từ AI").
- **Không tự tính tiền, không tự quyết vai.** Số nào bot đọc cho khách phải lấy nguyên văn từ
  `model`; vai do phiên quyết, không do payload (mục 4).
- Che PII, xác thực người gọi, ghi bản ghi `extraction` là việc của `bff`, không phải của extractor
  (spec §2). Cả ba **chưa dựng** (mục 8).

## 2. Đối tượng `Trip` BFF nhận

Nguồn: `contracts/src/trip.zod.ts` (zod, BFF parse bằng nó) đối chiếu `contracts/odoo/estimate-api.v1.json`
(`components.schemas.Trip`, spec Odoo đã pin 2026-09-16). Kiểu TS: `TripShape` (zod) và `Trip` (sinh
từ spec), cả hai export ở `contracts/src/index.ts`. Test `contracts/test/contract.test.ts` ("Trip, the
schema the extractor must produce") giữ tên các field này không bị đổi âm thầm.

**Sáu nhóm field phải khai tường minh** (`bff/src/trip/fill.ts`). Thiếu thì Odoo vẫn trả HTTP 200,
`warnings` rỗng, nhưng **giá sai** (đo 17/09/2026). BFF chặn bằng 422, không cho mặc định:
`guestType` · `transportType` · `checkIn`/`checkOut` · `diveFrom`/`diveTo` (khi có người lặn) ·
`guests[i].roomId` · `guests[i].days` (khi `diver`). Cột "Bắt buộc" đánh dấu ★.

### 2.1 `Trip`

| Field | Kiểu / enum | Bắt buộc | Mặc định | Trần | Ghi chú |
|---|---|---|---|---|---|
| `label` | string \| null | không | null | 120 | Không ảnh hưởng giá |
| `guestType` | `retail` \| `agent` \| `instructor` | ★ khoá phải có mặt | `retail` | — | Server ghi đè theo vai phiên (mục 4). Gửi `null` là 422 zod |
| `transportType` | `none` \| `roundtrip` \| `oneway` | ★ khoá phải có mặt | `none` | — | |
| `checkIn`, `checkOut` | string \| null | ★ khác null | null | 120 | Schema không ép định dạng, nhưng luật app so chuỗi **`YYYY-MM-DD`** |
| `diveFrom`, `diveTo` | string \| null | ★ khi có ≥1 khách `diver` | null | 120 | `YYYY-MM-DD`, gồm cả hai đầu |
| `bookedDaysAhead` | number | không | 0 | — | Server tự tính = ngày từ hôm nay (giờ Manila) tới `checkIn` |
| `rooms` | `Room[]` | không | `[]` | 30 | |
| `guests` | `Guest[]` | không | `[]` | 40 | 0 khách: không luật nào chặn — hành vi Odoo chưa có fixture |
| `items` | `CustomItem[]` | không | `[]` | 50 | Phụ thu tự do `{id,name,price≥0,qty≥1,mode,date,dateTo,gids[]}`. UI chưa dùng (spec §16.7) |
| `vanSplit` | `equal` \| `vehicle` \| null | không | null | — | |
| `vanMeta` | map<runKey, `{date,time,price,foc}`> | không | `{}` | — | Việc của staff |
| `extraDMByDay`, `dmByDay` | map<string, string> | không | `{}` | — | Việc của staff, UI chưa dùng |

Khoá lạ bị bỏ: zod `z.object` cắt khoá không khai, Odoo `sanitize_trip` cũng vậy. Ví dụ
`agencyName` trong `requests/compute.req.2.json` không bao giờ tới Odoo qua BFF.

### 2.2 `Guest`

| Field | Kiểu | Bắt buộc | Mặc định | Trần | Ghi chú |
|---|---|---|---|---|---|
| `id` | string \| null | nên có | null | 120 | Form dùng `g1..gn`. `gwin`, `quotes[].g.id` trả về theo id này |
| `name` | string | không | `"Guest"` | 120 | Không ảnh hưởng giá. Đi vào snapshot và trang link |
| `diver` | boolean | không | **`true`** | — | Bỏ trống = thợ lặn, kéo theo ★ `days` + cửa sổ lặn. Người không lặn phải ghi `false` |
| `meals` | boolean | không | `true` | — | Full board |
| `transport` | boolean | không | `true` | — | Có ngồi xe đưa đón |
| `foc` | boolean | không | `false` | — | Suất miễn phí; UI chỉ cho bật khi `model.foc.ok` và vai ≠ guest |
| `roomId` | string \| null | ★ | null | 120 | Phải trùng một `rooms[].id` |
| `courses` | (`dsd`\|`refresher`\|`ow`\|`aow`\|`rescue`)[] | không | `[]` | 5 | `/rates` thiếu `refresher`, `rescue` nhưng compute vẫn tính (fixture `compute.courses.json`) |
| `days` | map<`YYYY-MM-DD`, `DayPlanEntry`> | ★ khi `diver` (≥1 khoá) | `{}` | — | Mọi khoá phải nằm trong `[diveFrom, diveTo]` |
| `arrive`, `depart` | string \| null | không | null | 120 | Đến muộn / về sớm; phải nằm trong kỳ ở. `""` coi như không có |
| `comment` | string \| null | không | null | 500 | Không ảnh hưởng giá |
| `vanA`, `vanD` | string \| null | không | null | 120 | zod nhận cả số rồi ép về chuỗi |

### 2.3 `Room` và `DayPlanEntry`

| Field | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `Room.id` | string \| null (≤120) | null | id = null thì không khách nào trỏ tới được, sinh cảnh báo `room-empty` |
| `Room.type` | `standard` \| `deluxe` \| `suite` | `standard` | |
| `Room.name` | string \| null (≤120) | null | Tên phòng thật, ví dụ `Deluxe B`, lấy từ `model.roomAvailability[type]`. Tên lạ vẫn tính cùng giá |
| `DayPlanEntry.dive` / `third` / `night` | boolean | false | Lặn ngày đó / lặn thứ 3 / lặn đêm |
| `DayPlanEntry.boatId` | string \| null (≤120) | null | Từ `GET /api/boats`. Fixture trả rỗng. Để null thì Odoo sinh warning "no boat picked yet" |

### 2.4 Ví dụ đầy đủ

Lấy từ `contracts/odoo/examples/requests/compute.req.1.json`, thêm các field mà form cũng gửi
(`bff/app/src/lib/buildTrip.ts`). Qua được `fillTrip` và `validateTrip`. Bản gốc cũng qua được:
các field thiếu nhận mặc định.

```json
{
  "trip": {
    "label": "Retail couple — 2 nights",
    "guestType": "retail", "transportType": "none",
    "checkIn": "2026-11-20", "checkOut": "2026-11-22",
    "diveFrom": "2026-11-21", "diveTo": "2026-11-21",
    "bookedDaysAhead": 0,
    "rooms": [{ "id": "r1", "type": "standard", "name": null }],
    "guests": [
      { "id": "g1", "name": "Ana", "diver": true, "meals": true, "transport": false, "foc": false,
        "roomId": "r1", "courses": [],
        "days": { "2026-11-21": { "dive": true, "third": false, "night": false, "boatId": null } } },
      { "id": "g2", "name": "Ben", "diver": false, "meals": true, "transport": false, "foc": false,
        "roomId": "r1", "courses": [], "days": {} }
    ],
    "items": [], "vanSplit": null, "vanMeta": {}, "extraDMByDay": {}, "dmByDay": {}
  }
}
```

**Form dịch 7 câu trả lời thành Trip như thế nào** (`buildTrip.ts`), extractor nên ra cùng hình:
N khách → `g1..gN` tên `Guest n`. **Mọi khách vào một phòng `r1` standard.** Người lặn là `diverCount`
người đầu. Mỗi người lặn có `days` = mọi ngày từ `diveFrom` tới `diveTo` (`datesBetween`, gồm hai đầu)
với `{dive:true, third:false, night:false, boatId:null}`. `meals` = "full board?" cho cả nhóm.
`transport` = `transportType ≠ none`. Không có người lặn thì `diveFrom`/`diveTo` = null.
`bookedDaysAhead: 0` (server tính lại).

## 3. Luật hợp lệ trước khi tính

Thứ tự trong `checkTrip` (`bff/src/routes/estimates.ts`): zod parse → `fillTrip` → `validateTrip` →
`deriveTrip` → Odoo `compute` → `checkComputeSane`. Mọi nhánh đỏ trước `compute` trả 422 và
**không gọi Odoo, không ghi DB**.

| `code` (`bff/src/trip/validate.ts`) | `fields` | Mức | Chính sách tạm (`VALIDATE_POLICY`) |
|---|---|---|---|
| `checkout-not-after-checkin` | `checkIn`, `checkOut` | error | `minNights: 1`, không có day-use 0 đêm — Q-009 pending |
| `checkin-in-past` | `checkIn` | error | So với hôm nay giờ Manila. Staff được miễn — Q-012 pending |
| `dive-window-reversed` | `diveFrom`, `diveTo` | error | |
| `dive-window-outside-stay` | `diveFrom`, `diveTo` | error | `blockDiveWindowOutsideStay: true` — Q-010. Biên gồm cả hai đầu — Q-008 |
| `dive-days-outside-window` | `guests[i].days` | error | Mọi khoá của `days`, kể cả `dive:false` |
| `arrive-depart-outside-stay` | `guests[i].arrive` / `.depart` | error | |
| `room-empty` | `rooms[j]` | **warn** | `roomEmptyLevel: 'warn'` — Q-011. Không chặn; nằm trong `issues` của 201/200 |

Luật không báo dây chuyền: kỳ ở hỏng thì bỏ các luật so với kỳ ở; cửa sổ lặn đảo thì bỏ luật so
ngày lặn.

**Hậu kiểm sau compute** (`bff/src/model/sane.ts`), trả trong `issues` dạng `{code, text}`:
`dive-revenue-zero`, `dive-dates-outside-window`, `transport-revenue-zero`, `room-revenue-zero`.
Có issue loại này thì con số **không đáng tin**. Bot không được báo giá đó cho khách.

**Extractor nên tự kiểm, không cần BFF:** ngày ra đúng `YYYY-MM-DD`. Field ★ nào không đọc được từ
tin nhắn thì đánh trạng thái "thiếu" và hỏi lại người dùng, **không điền mặc định** (đó đúng là cái
bẫy `fillTrip` chặn). Ghi `diver:false` tường minh cho người không lặn.
**Để BFF quyết:** mọi luật ở bảng trên. Không chép luật sang `ai/`; gửi lên rồi đọc `code` + `fields`
của 422. Client mirror `bff/app/src/lib/validateTrip.ts` chỉ dành cho UI, giữ khớp bằng parity test.

## 4. Vai và `guestType`

- Vai đến từ cookie đã ký, không từ payload. `resolveOwner` (`bff/src/auth/owner.ts`) đọc
  `ubg_auth` trước (phiên đăng nhập Odoo, vai từ `user_session.role`, ref `odoo:<login>`), không có
  thì `ubg_sid` (khách ẩn danh, luôn `guest`). Cả hai là `<id>.<hmac>`, `HttpOnly; SameSite=Lax;
  Path=/`, hạn 30 ngày. `ensureOwner` phát `ubg_sid` ở `POST /api/session/guest`, `POST /api/estimates`,
  PATCH, commit, share. `ubg_auth` chỉ phát ở `POST /api/auth/login`.
- `deriveTrip` (`bff/src/trip/derive.ts`) **ghi đè `guestType`**: không phiên / guest → `retail`,
  agent → `agent`, instructor → `instructor`. Chỉ staff được giữ giá trị trong payload. Nó cũng tính
  lại `bookedDaysAhead`. Vì vậy extractor cứ ghi `guestType` đọc được (khoá phải có mặt), nhưng
  **không được dựa vào nó để đổi giá**.
- Giá theo vai nào là do Odoo quyết qua key. `response.role` là vai Odoo đã dùng. Đã đăng nhập mà
  Odoo vẫn tính như guest (tài khoản chưa verify) thì `pendingVerification: true`.

**Danh tính dịch vụ cho kênh AI: chưa có.** Hôm nay BFF chỉ biết hai loại phiên cookie ở trên.
Không có service key, vai `bot`, hay header nào cho một tiến trình máy. Hai hướng, **chưa ai chọn**:

| Hướng | Cách chạy | Cần gì |
|---|---|---|
| (a) Bot tạo nháp guest | Bot giữ một cookie jar `ubg_sid` cho mỗi cuộc hội thoại, `POST /api/estimates` → `commit` → `share`, rồi gửi người dùng `/quote/:token`. Link `/trip/:id` vô dụng với người dùng: chủ là cookie của bot, nên trình duyệt của họ nhận 404 | Chạy được với code hôm nay. Giá luôn là giá guest. Nháp thuộc cookie của bot, không thuộc khách |
| (b) Key / vai riêng cho kênh AI | Odoo cấp key, BFF thêm route hoặc cơ chế xác thực máy-với-máy và ghi `scenario.source = 'ai'` | Phillip cấp key + mình viết route. Chưa có plan |

## 5. Endpoint BFF cho kênh AI

Chung cho mọi route: sai chủ và không tồn tại cùng trả **404 `{error:'not found'}`**, không có 403.
Lỗi từ Odoo đi qua `app.onError` (`bff/src/app.ts`): breaker mở → **503**, timeout (8 s) → **504**,
Odoo 5xx → **502**, Odoo 4xx → **cùng mã** (ví dụ 401 khi thiếu key guest, 422 khi vượt trần engine).
Cả bốn trường hợp có body `{error}` **không có `reason`**. Chuỗi `error` là tiếng Việt, dành cho
người đọc. Bot rẽ nhánh theo mã HTTP, `code`, `reason`, `fields`.

| Method + path | Làm gì | Body gửi | 2xx trả về (khoá) | Lỗi riêng | Odoo |
|---|---|---|---|---|---|
| `POST /api/session/guest` | Lấy cookie `ubg_sid` (có rồi thì giữ) | — | 200 `{role, session:true}` | — | 0 |
| `GET /api/me` | Đang là ai | — | 200 `{role, session, name?, login?}` | — | 0 |
| `POST /api/estimates` | Tạo nháp và báo giá lần đầu | `{trip, ui?}` | **201** `{id, seq:0, role, pendingVerification, model, retailModel, issues, computedAt, sample}` + Set-Cookie nếu chưa có | 422 xem dưới | 1 |
| `GET /api/estimates/:id` | Mở lại nháp | — | 200 `{id, status, label, workingTrip, workingUi, working:{model, retailModel, key, role, sample, computedAt}\|null, latest:{seq, model, retailModel, computedAt, sample}\|null}` | 404 (cả khi không có cookie) | 0 |
| `PATCH /api/estimates/:id` | Tính lại trip đã sửa. `save:true` ghi nháp, `save:false` chỉ xem | `{trip, ui?, save}`, **trip đầy đủ**, không gửi diff | 200 `{id, role, pendingVerification, model, retailModel, issues, computedAt, sample, saved}` | 404; 422 `{error, fields:['save']}`; 422 như POST | 1 |
| `POST /api/estimates/:id/commit` | Đóng băng một phiên bản (revision + snapshot) từ `workingTrip` **đã lưu**, không lấy từ body | — | 200 `{id, seq, snapshotId, role, pendingVerification, computedAt}` | 404 | 0 nếu model đã lưu khớp trip, không thì 1 |
| `GET /api/estimates/:id/revisions/:seq` | Đọc lại một phiên bản | — | 200 `{seq, trip, snapshot:{model, computedAt, sample}\|null}` | 404 (`seq` rác cũng 404) | 0 |
| `POST /api/estimates/:id/share` | Phát link báo giá | — | 200 `{url:'/quote/<token>', expiresAt}`. `url` là đường dẫn tương đối, bot tự ghép origin | 404; **409** `{error:'save first', reason:'no-snapshot'}` | 0 |
| `GET /api/share/:token` | Đọc báo giá công khai (trang `/quote/:token`) | — | 200 `{scenarioId? (chỉ chủ), seq, trip, model, retailModel, computedAt, sample, currency, label:null}` | 404; 404 `{…, reason:'no-snapshot'}`; **410** `{error:'link expired'}`; **401** `{error:'login required', reason:'login'}` (link của tài khoản) | 0 |
| `GET /api/rates` | Bảng giá (`RatesResponse` nguyên văn) | — | 200 `{roomRates, diveTiers, mealRate, courseRates, transport, terms, roomNames}` | lỗi Odoo | 1, cache 60 s |
| `GET /api/rooms?check_in&check_out` | Phòng và phòng trống (`RoomsResponse`) | — | 200 `{ok, rooms, available, check_in, check_out}` | 422 thiếu query | 1 |
| `GET /api/boats?check_in&check_out` | Thuyền (`{boats:[{id,name,cap}]}`, kiểu khai cục bộ `bff/src/odoo/boats-types.ts`) | — | 200 `{boats}` | 422 khi chỉ có một trong hai query | 1, cache 60 s |
| `GET /api/settings` | Settings công khai | — | 200 `{display_currency, share_token_ttl_days}` | — | 0 |
| `GET /api/health` | BFF sống + chế độ | — | 200 `{ok:true, mode:'fixture'\|'odoo'}` | — | 0 |

**422 của POST/PATCH có bốn hình** (`checkTrip`):

| Nguyên nhân | Body |
|---|---|
| Body không phải JSON | `{error}` |
| Sai hình dạng zod (enum lạ, vượt trần, `null` cho enum) | `{error:'Trip không hợp lệ', fields:['guests[0].courses', …]}` |
| Thiếu field ★ | `{error:'Trip thiếu trường ảnh hưởng giá: …', fields:['diveFrom', 'guests[1].roomId', …]}` |
| Luật app `error` | `{error:'Chuyến không hợp lệ', code, fields, issues:[{code, fields, level}]}`. `code` là lỗi đầu tiên, `issues` gồm cả `warn` |

**KHÔNG dùng từ kênh AI**

| Cái gì | Vì sao |
|---|---|
| `/v1/*` của Odoo gọi thẳng | Lộ key, bỏ qua `fillTrip`/redact/sane. CLAUDE.md §5 |
| `POST /api/estimates/:id/submit`, `GET …/submission` | Tạo folio thật. Chỉ chủ đã đăng nhập bấm tay (F07). Live mode còn đóng: 503 `reason:'closed'` khi thiếu `ODOO_SUBMIT_ENABLED=1` |
| `GET /api/estimates?scope=all`, `GET /api/settings/all`, `PUT /api/settings/:key` | Chỉ cho staff. Non-staff gửi `scope=all` thì bị bỏ qua |
| Odoo `pricelists`, `rates/manifest`, `PATCH /v1/estimate/rates` | Công cụ staff trong Odoo UI. CLAUDE.md §5 |
| `/api/auth/*` bằng tài khoản người thật | Không có tài khoản bot (mục 4). Mật khẩu người dùng không đi qua bot |

## 6. `EstimateModel` — báo giá bot được đọc

Spec Odoo khai mọi khoá của `EstimateModel` là optional, phần lớn kiểu `map<any>`. Hình dạng chi tiết
dưới đây lấy từ fixture thật (`compute.retail-couple.json`, `compute.agent-group.json`), không phải
từ schema.

| Field | Nghĩa | Ai thấy |
|---|---|---|
| `kpis.revenue` | **Tổng báo giá** — con số UI in to | mọi vai |
| `kpis.nights`, `kpis.guests` | Số đêm, số khách do Odoo đếm. UI không đếm lại từ trip | mọi vai |
| `kpis.rpgn`, `kpis.discounts` | Doanh thu mỗi khách-đêm, tổng giảm | mọi vai |
| `kpis.cost` / `profit` / `margin` | Giá vốn, lãi, biên | **chỉ staff**. Vai khác nhận `null` |
| `quotes[]` | Một khối cho mỗi khách: `{g (guest echo), isFoc, lines[], gross, total, discountTotal}` | mọi vai |
| `quotes[].lines[]` | `{cat, label, sub, gross, discs[{name, amt}], net}`. UI hiện `label`, `sub` (lời giải thích của Odoo, hiện nguyên văn) và `net` | mọi vai |
| `catRev` | Doanh thu theo hạng mục `{room, meals, dive, course, transport, gear, extras}` | mọi vai |
| `catCost`, `costs`, `cost` | Chi phí | **chỉ staff**. Vai khác nhận `null` |
| `warnings[]` | Việc Odoo nêu còn dở, dạng `{level:'warn'\|'error', text}`, ví dụ "no boat picked yet for Ana" | mọi vai |
| `diveDates`, `stayDates` | Ngày lặn, ngày ở (`YYYY-MM-DD[]`) | mọi vai |
| `dayPlans[]` | **Mảng** `{date, divers[]}`, không phải map theo ngày (spec §16.2) | mọi vai |
| `vanRuns[]` | Lượt xe `{date, dir:'arrival'\|…, key, pax[], vans[], vanCount, rev, focRev}` | mọi vai. UI không in `rev`/`focRev` cho guest/agent |
| `covers` | Suất ăn theo ngày `{YYYY-MM-DD: n}` | mọi vai |
| `gwin` | Kỳ ở từng khách `{gId: {a, dep, n, dates[]}}` | mọi vai |
| `roomNames`, `roomAvailability` | Toàn bộ tên phòng / tên phòng **còn trống** theo loại | mọi vai |
| `foc` | `{ok, per, bracket, entitled, marked, stay{…}, dive{…}}` — suất miễn phí được hưởng và đã gán | mọi vai |
| `retailModel` (response BFF) | `EstimateModel` giá lẻ để so sánh, có khi Odoo trả `retail_model` (agent/staff). Trên link: người xem guest luôn nhận `null` | tài khoản |

Redact chạy ở server (`bff/src/model/redact.ts`, `redactForRole`): mọi vai trừ staff bị **đặt
`null`** (không xoá khoá) ở `catCost`, `costs`, `cost`, `kpis.cost`, `kpis.profit`, `kpis.margin`.
Chạy hai lần: lúc lưu, theo vai Odoo của chủ; và lúc mở link, theo vai người xem.

`issues[]` của POST/PATCH gồm hai loại phần tử, đọc theo `code`:
hậu kiểm `{code, text}` (mục 3) và cảnh báo luật app `{code, level:'warn', fields}` (không có `text`).
`model.warnings` là cảnh báo của Odoo, một danh sách khác.

**Không tính tiền ở phía bot.** Tổng lấy `kpis.revenue`, từng khách lấy `quotes[].total`, từng dòng lấy
`lines[].net`. Không cộng, không trừ, không quy đổi. `currency` / `display_currency` **chỉ là nhãn**:
số luôn là PHP như Odoo trả (Q-003). Bot nhắc giá thì kèm `computedAt`. Có `sample:true` thì phải
nói rõ "sample data, not a live quote".

## 7. Fixture mode: dev không cần Odoo

`bff/.env.local` (git-ignore, không commit): `FIXTURE_MODE=1` + `SESSION_SECRET` (≥ 32 ký tự). Không có
`DATABASE_URL` thì store chạy trong RAM, restart là mất hết. `npm run dev -w bff` chạy API ở
`:8787`. `npm run dev:app -w bff` chạy app + API ở `:5173`. `GET /api/health` trả `mode:'fixture'`.

Gateway fixture (`bff/src/odoo/fixture.ts`) trả **response thật đã chụp** ngày 17/09/2026, chọn file theo
hình dạng trip:

| Điều kiện (xét theo thứ tự) | File trả về |
|---|---|
| Phiên đăng nhập vai ≠ guest | `compute.agent-group.json` |
| `pickCompute`: có người lặn mà thiếu cửa sổ lặn | `compute.missing-divewindow.json` (qua BFF không tới được vì `fillTrip` chặn trước) |
| `pickCompute`: `guestType === 'agent'` | `agent-group` (khách ẩn danh không tới được vì `deriveTrip` đã ép `retail`) |
| `pickCompute`: có khách mang `courses` | `compute.courses.json` |
| còn lại | `compute.retail-couple.json` |

Tài khoản QA (tổng hợp, domain `example.test`, `bff/src/auth/fixture-auth.ts`): `qa-guest@example.test`,
`qa-agent@example.test`, `qa-staff@example.test`, mật khẩu `fixture-pass`.

Hai giới hạn của fixture:

1. **Model cố định theo hình dạng trip.** Số, tên, ngày là của ngày chụp, không khớp trip bạn gửi.
   Vì vậy hậu kiểm hay kêu `dive-dates-outside-window` (spec §14.3). Mọi response và snapshot mang
   `sample:true`. File chụp ở vai `guest`, nên phiên agent luôn thấy `pendingVerification:true`.
2. **Thuyền rỗng:** `GET /api/boats` → `{boats:[]}` (chưa có bản chụp, B-018). Submit fixture chỉ là
   hình dạng spec `{success:true, folio_id:null, order_ids:null}`, không phải bản chụp (B-033).

## 8. Câu hỏi mở và việc chờ

| Mục | Chạm tới bot thế nào | Trạng thái |
|---|---|---|
| Danh tính dịch vụ cho kênh AI | Không có thì bot chỉ đi được hướng (a), mục 4 | chưa có. Anthony chọn hướng |
| Bảng `extraction` (spec §5: `raw_text` + `fields` jsonb + trạng thái + evidence + model + prompt_version + token + ms) | Nơi lưu kết quả extractor | chưa có migration |
| `scenario.source` (`form`\|`ai`\|`whatsapp`), `revision.author` (`human`\|`ai`) | Cột đã có trong migration, nhưng store luôn ghi `form` / `human`. Không route nào nhận giá trị khác | chưa có đường ghi |
| `POST /api/extract` (spec §6) và kiểu `ExtractResult` / trạng thái từng field | Hợp đồng giữa `bff` và `ai/` | chưa có. `ai/src/index.ts` mới export `Trip` |
| B-002: `bff` gọi extractor thế nào (import hay HTTP, ngôn ngữ, chạy ở đâu) | Quyết định kiến trúc của P5. Spec §12 ghi "import" | parked, Anthony |
| Q-001: `raw_text` giữ bao lâu | TTL tin nhắn gốc. Setting `raw_text_ttl_days` = 30 (tạm) | chờ khách |
| Q-004: khách ẩn danh gửi đặt chỗ | Tạm chốt: không. Bot không mở đường đặt chỗ | tạm chốt, khách xác nhận sau |
| Q-005: link là bản mới nhất hay bản đã gửi | Hôm nay: bản Save mới nhất. Bot Save thêm là người cầm link cũ thấy giá mới | chờ khách |
| Q-013: liên hệ trên đặt chỗ là agent hay khách | Bot không thu liên hệ cho submit | chờ khách |
| Q-014: người nhận link có tự đặt được không | Hôm nay: không, chỉ chủ báo giá gửi được | chờ khách |
| Q-015: gửi email / WhatsApp xác nhận sau đặt chỗ | Bot **không** hứa gửi xác nhận | chờ khách, B-037 |
| Q-008..Q-012 | Luật hợp lệ ở mục 3 có thể đổi | chờ khách |
| Phía Odoo còn nợ | Key vai staff (spec §10, cost còn `null`), `commission` cho agent (B-012), bản chụp `boats` (B-018), bản chụp `submit` thật (B-033), `rates_version`, `/v1/auth/*` và `/v1/estimate/boats` chưa có trong spec đã pin | chờ |

## 9. Liên kết

- Spec: [`2026-09-18-uibaogia-wizard-design.md`](../superpowers/specs/2026-09-18-uibaogia-wizard-design.md)
  §2 (ranh giới `ai/`), §4 (khi nào gọi compute; debounce chỉ còn áp dụng cho P5), §5 (store,
  `extraction`), §6–7 (cổng, vai), §13 (luật giảm tải Odoo), §15 (auth), §16.8 (validation, vai theo
  phiên), §16.9 (đặt chỗ).
- Flows: [F00](../flows/F00-fixture-mode.md) fixture · [F01](../flows/F01-quote-flow.md) báo giá →
  link · [F03](../flows/F03-auth.md) phiên/vai · [F04](../flows/F04-share-gate.md) link gated ·
  [F05](../flows/F05-flow-a-result.md) Result / Update price · [F07](../flows/F07-booking.md) đặt chỗ.
- Hợp đồng: `contracts/src/trip.zod.ts`, `contracts/src/index.ts`, `contracts/odoo/estimate-api.v1.json`
  (+ `SOURCE.md`), `contracts/odoo/examples/` (+ `README.md`, `requests/`).
- BFF: `bff/src/trip/{fill,validate,derive,to-odoo}.ts`, `bff/src/routes/{estimates,share,session,submit}.ts`,
  `bff/src/model/{sane,redact}.ts`, `bff/src/auth/{owner,credential,cookies}.ts`, `bff/src/odoo/fixture.ts`.
- Runbook: [`smoke-test-p1-p4.md`](../runbooks/smoke-test-p1-p4.md), [`qa-accounts.md`](../runbooks/qa-accounts.md).
- Roadmap P5, backlog B-002 / B-012 / B-018 / B-033, `customer-questions.md`.

### Cách gửi request thử bằng curl trong fixture mode

```bash
npm run dev -w bff    # bff/.env.local: FIXTURE_MODE=1, SESSION_SECRET; API ở http://localhost:8787
curl -s -c jar.txt -b jar.txt -X POST http://localhost:8787/api/session/guest
curl -s -c jar.txt -b jar.txt -H 'content-type: application/json' \
  -d @contracts/odoo/examples/requests/compute.req.1.json http://localhost:8787/api/estimates   # 201 {id, model, issues, sample:true}
curl -s -b jar.txt http://localhost:8787/api/estimates/<id>   # <id> lấy từ response trên; không có jar là 404
```
