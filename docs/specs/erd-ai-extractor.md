# ERD cho AI Extractor — Trip và nơi nó được lưu

Trạng thái: 2026-10-08 · nguồn: `contracts/src/trip.zod.ts`, `bff/src/trip/meals.ts` (extras), `supabase/migrations/*`.
Đọc cùng `docs/integration/schema.md` (luật hợp lệ, endpoint, `EstimateModel`).

Extractor đọc tin nhắn (WhatsApp, email, chat) và trả **một `Trip` + `extras`**. Nó không đọc DB, không gọi
Odoo, không tính giá, không đặt chỗ. Hình A là thứ extractor phải điền. Hình B chỉ để hiểu Trip đi đâu sau đó.

## A. Thứ extractor điền — `Trip` và các phần con

```mermaid
erDiagram
    TRIP ||--o{ ROOM : "rooms[] (max 30)"
    TRIP ||--o{ GUEST : "guests[] (max 40)"
    ROOM ||--o{ GUEST : "guest.roomId = room.id"
    GUEST ||--o{ DAY_PLAN : "days{YYYY-MM-DD} — chỉ khi diver"
    GUEST ||--o{ COURSE : "courses[] (max 5)"
    TRIP ||--o| TRIP_EXTRAS : "app-only, không gửi compute"
    TRIP_EXTRAS ||--o{ GUEST_EXTRAS : "guests{guest.id}"
    GUEST ||--o| GUEST_EXTRAS : "cùng guest.id"
    DAY_PLAN }o--o| BOAT : "boatId (staff chọn)"
    TRIP ||--o{ CUSTOM_ITEM : "items[] (staff)"
    CUSTOM_ITEM }o--o{ GUEST : "gids[]"

    TRIP {
        string label "tên chuyến, tuỳ chọn"
        enum guestType "retail|agent|instructor — KHÔNG trích, phiên quyết"
        enum transportType "none|roundtrip|oneway — bắt buộc"
        date checkIn "YYYY-MM-DD — bắt buộc"
        date checkOut "YYYY-MM-DD — bắt buộc"
        date diveFrom "bắt buộc khi có người lặn"
        date diveTo "bắt buộc khi có người lặn"
        int bookedDaysAhead "KHÔNG trích, server tính"
    }
    ROOM {
        string id "r1, r2..."
        enum type "standard|deluxe|suite"
        string name "tên phòng thật, tuỳ chọn"
    }
    GUEST {
        string id "g1, g2..."
        string name "mặc định 'Guest n'"
        bool diver "mặc định TRUE — người không lặn phải ghi false"
        bool meals "full board"
        bool transport "ngồi xe đưa đón"
        bool foc "KHÔNG trích, Odoo/staff"
        string roomId "bắt buộc, trỏ ROOM.id"
        date arrive "đến muộn, trong kỳ ở"
        date depart "về sớm, trong kỳ ở"
        string comment "max 500"
    }
    DAY_PLAN {
        date day "khoá, trong [diveFrom, diveTo]"
        bool dive "lặn ngày đó"
        bool third "lặn thứ 3"
        bool night "lặn đêm"
        string boatId "KHÔNG trích"
    }
    COURSE {
        enum code "dsd|refresher|ow|aow|rescue"
    }
    TRIP_EXTRAS {
        enum transferDirection "arrival|departure — chỉ khi oneway"
    }
    GUEST_EXTRAS {
        enum diet "none|vegetarian|vegan|pescatarian|halal|no_pork|gluten_free|other"
        string dietNote "max 200"
        string allergies "max 200 — dữ liệu sức khoẻ"
        map meals "{YYYY-MM-DD: {b,l,d}} — tuỳ chọn"
    }
    BOAT {
        string id "từ GET /api/boats"
    }
    CUSTOM_ITEM {
        string name "phụ thu — KHÔNG trích, staff thêm"
        number price "KHÔNG trích"
    }
```

**Đọc hình:**
- `TRIP_EXTRAS` / `GUEST_EXTRAS` là dữ liệu chỉ của app (`scenario.extras`), không đi vào `compute`. Chúng chỉ tới Odoo
  lúc đặt chỗ: `transferDirection` thành `Trip.transferDirection`, `diet` + `dietNote` và `allergies` thành
  `Guest.diet` / `Guest.allergies`.
- Odoo không có trường cho bữa sáng/trưa/tối (`GUEST_EXTRAS.meals`). Bếp đếm suất theo ngày. Extractor chỉ cần
  `GUEST.meals` (full board hay không).

### Extractor trích gì, bỏ gì

| Nhóm | Trường | Ghi chú |
|---|---|---|
| **Trích** | `checkIn`, `checkOut`, `diveFrom`, `diveTo` | Ngày tuyệt đối `YYYY-MM-DD`. "Tháng 11", "cuối tuần sau" → để trống + hỏi lại, không đoán |
| **Trích** | số khách, tên, ai lặn (`diver`), khoá học (`courses`) | Không rõ ai lặn → hỏi. Mặc định `diver: true` là cái bẫy |
| **Trích** | số phòng, loại phòng (`ROOM.type`), ai ở phòng nào (`roomId`) | Không nói gì → một phòng `r1` standard cho cả nhóm (như form) |
| **Trích** | `transportType`, `TRIP_EXTRAS.transferDirection` | "Đón ở sân bay" một chiều → `oneway` + `arrival` |
| **Trích** | `meals`, `GUEST_EXTRAS.diet/dietNote/allergies`, `arrive/depart`, `comment` | Dị ứng là dữ liệu sức khoẻ: không lặp lại trong log |
| **Không trích** | `guestType`, `bookedDaysAhead`, `foc`, `boatId`, `items`, `vanMeta`, `dmByDay`, giá | Phiên, server, Odoo hoặc staff quyết. Bot không bao giờ tự nói giá |
| **Không trích** | tên/email/điện thoại người đặt (`contact`) | Chỉ hỏi ở bước đặt chỗ, do người bấm tay |

Mỗi trường trả kèm một trạng thái: `given` (khách nói rõ) · `inferred` (suy ra) · `default` · `missing`.
Trường bắt buộc mà `missing` thì bot hỏi lại trước khi gọi BFF.

## B. Trip đi đâu sau khi extractor trả về

```mermaid
erDiagram
    USER_SESSION ||--o{ SCENARIO : "owner_ref (logic, không FK)"
    SCENARIO ||--o{ REVISION : "seq 1..n, mỗi lần Save"
    REVISION ||--|| SNAPSHOT : "giá Odoo đóng băng"
    SCENARIO ||--o{ SHARE_TOKEN : "link /quote/:token"
    SCENARIO ||--o{ SUBMISSION : "gửi đặt chỗ"
    SUBMISSION }o--|| SNAPSHOT : "đúng bản đã gửi"
    SCENARIO ||--o{ GUEST_DOCUMENT : "chứng chỉ lặn theo guest_id"
    SCENARIO ||--o| INQUIRY_LINK : "tạo từ yêu cầu web"
    SCENARIO ||--o{ SCENARIO_NOTE : "ghi chú quầy"

    USER_SESSION {
        text id PK
        enum role "guest|agent|instructor|staff"
        text odoo_login
    }
    SCENARIO {
        uuid id PK
        enum owner_role "guest|agent|instructor|staff"
        text owner_ref
        enum source "form|ai|whatsapp — hiện BFF luôn ghi form"
        enum status "draft|submitted|expired|archived"
        text label
        jsonb working_trip "TRIP đang sửa"
        jsonb extras "TRIP_EXTRAS + GUEST_EXTRAS"
    }
    REVISION {
        uuid id PK
        uuid scenario_id FK
        int seq
        jsonb trip "TRIP đã Save"
        enum author "human|ai — hiện route luôn ghi human"
    }
    SNAPSHOT {
        uuid id PK
        uuid revision_id FK
        jsonb model "EstimateModel từ Odoo"
        jsonb retail_model "giá lẻ, cho agent/instructor"
        enum role
        bool sample
    }
    SHARE_TOKEN {
        text token_hash PK "sha256, không lưu token gốc"
        uuid scenario_id FK
        timestamptz expires_at
        timestamptz revoked_at
    }
    SUBMISSION {
        uuid id PK
        uuid scenario_id FK
        uuid snapshot_id FK
        enum state "pending|confirmed|failed|unknown"
        jsonb contact "PII"
        int folio_id "folio Odoo"
    }
    GUEST_DOCUMENT {
        uuid id PK
        uuid scenario_id FK
        text guest_id "= GUEST.id"
        text guest_name
        enum status "uploaded|on_file"
    }
    INQUIRY_LINK {
        bigint lead_id PK "crm.lead Odoo"
        uuid scenario_id FK
    }
    SCENARIO_NOTE {
        uuid scenario_id FK
        enum desk "frontdesk|dive|kitchen"
        text body
    }
```

**Đọc hình:**
- Extractor gọi `POST /api/estimates` với `{trip, extras?}`. Ở bước tạo, `extras` **chỉ nhận `transferDirection`**
  (khoá khác → 422). Ăn kiêng / dị ứng / bữa ăn gửi sau bằng `PATCH /api/estimates/:id/extras`.
- BFF tạo `SCENARIO`, gọi Odoo `compute`, trả `model` + link.
- **Chưa dựng:** cột `source` (`ai` / `whatsapp`) và `revision.author = 'ai'` đã có trong DB, nhưng route hiện luôn ghi
  `form` / `human`. Kênh AI cần BFF nhận biết người gọi là bot rồi ghi đúng (`schema.md` mục 8).
- `GUEST.id` là khoá nối Trip với `GUEST_DOCUMENT` và `scenario.extras.guests`. Extractor đặt `g1..gn` và giữ ổn định
  giữa các lần sửa; đổi id là mất chứng chỉ và ghi chú ăn uống của khách đó.
- Bảng `app_setting` và `rate_hit` (cấu hình, chống spam) không liên quan tới extractor nên không vẽ.
