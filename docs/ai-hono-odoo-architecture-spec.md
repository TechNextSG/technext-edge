# AI → Hono BFF (Submit / Compute / Studio) → Odoo ERP (via GAIS)
## Architecture Specification, API Contracts, Auth & Trade-Off Analysis

> **Status:** Live on Production (`https://technext-edge-casa-bff.vercel.app`)  
> **App Surfaces (100% English):** `/quotes` · `/q/sky-oct10-group` · `/test-console` · `/flow`  
> **Reports & Briefings (Bilingual `[ EN | VI ]`):** `/plan` · `/status` · `/scenarios` · `/benchmark`

---

## 1. End-to-End 3-Tier Pipeline Overview

```
[WhatsApp / Web Guest]
       │
       ▼ (1) Natural-language multi-turn intake (Pass 1 Trip + Pass 2 Guest Manifest + Split-Day Dives)
[AI Layer: Gemini 3.1 Flash-Lite]
       │
       ├─► Tool Call: `submit_quotation_to_hono`
       ▼ (2) Hop 1: AI -> Hono BFF (`POST /v1/quotes/submit` & `POST /v1/quotes/compute`)
[Hono BFF & Reservation Quotation Studio (`/quotes/:id`)]
       │  • Deterministic pricing calculation (Rooms, Split-Day Dives, Meals, Transfers, 30% Partner Discount)
       │  • Editable Quotation Link (`/q/:slug`) + Editable Line-Item Table (`lineItems[]`)
       │  • Staff / Hono clicks "✅ Hono Confirm & Send Back to AI" (`POST /v1/quotes/:id/confirm`)
       │
       ├──► (3A) Hop 2: Hono -> AI / WhatsApp (`POST /v1/quotes/:id/send-whatsapp`)
       │         Sends verified Grand Total + Shareable Quotation Link (`/q/sky-oct10-group`) to guest
       │
       └──► (3B) Hop 3: Hono -> Odoo ERP via GAIS (`POST /v1/quotes/:id/sync-odoo` -> Odoo `/api/v1/casa/quotations`)
                 Upserts `sale.order` + `sale.order.line` with HMAC-SHA256 (`X-GAIS-Signature`) & `Idempotency-Key`
```

---

## 2. Architectural Trade-Off Analysis (`AI -> Hono -> Odoo`)

### Trade-Off 1: Why Stage & Edit on Hono Instead of AI Writing Directly to Odoo?
| Dimension | Option A: `AI ──(Direct Tool)──> Odoo ERP` | Option B (Chosen): `AI ──> Hono (Submit/Compute/Edit) ──> Odoo` |
| :--- | :--- | :--- |
| **ERP Data Hygiene** | ❌ **High Risk of Dirty `sale.order` Drafts**: Every guest tweak ("change from 10 to 8 divers", "half dive 2 days, half 3 days") creates or mutates unverified ERP records. | ✅ **100% Clean ERP State**: Hono acts as a stateful staging buffer (`/quotes/:id`). Only confirmed quotes (`status = confirmed_by_hono`) sync to Odoo `sale.order`. |
| **WhatsApp 20s SLA** | ❌ **Timeout Prone**: Calling LLM (3–5s) + Odoo XML-RPC/REST (2–6s) + PDF rendering inside a single WhatsApp webhook easily exceeds Meta's 20s limit. | ✅ **Sub-200ms Tool Execution**: Hono `submit` + `compute` runs in `<50ms` in-process/edge, returning an instant shareable link (`/q/:slug`) well within the 20s SLA. |
| **Split-Day & Partner Pricing** | ❌ **Hard to Override in Odoo**: Custom non-standard arrangements (e.g., 4 divers × 3 days + 4 divers × 2 days + 30% resort partner discount) require complex Odoo pricelist rules. | ✅ **Instant Editable Table on Hono**: Staff can edit any cell (`Qty`, `Multiplier`, `Unit Price`, `Discount %`, `+ Add Row`) on `/quotes` and push exact `price_unit` overrides to Odoo `sale.order.line`. |
| **Trade-Off Cost (Downside)** | Simpler single-hop wiring if no human review is needed. | **Dual-State Sync**: Requires an `Idempotency-Key` (`<quoteId>-confirmed`) so edits on Hono deterministically upsert the corresponding Odoo `sale.order` without creating duplicates. |

---

## 3. Endpoints & API Contracts

### 3.1. Hop 1 — `AI -> Hono BFF` (Submit & Compute)

| Method & Path | Purpose | Caller | Latency |
| :--- | :--- | :--- | :--- |
| `POST /v1/quotes/compute` | Stateless deterministic pricing calculation (`Trip` or `lineItems[]` -> itemized totals + GAIS preview) | AI Tool / Hono Studio | `< 25 ms` |
| `POST /v1/quotes/submit` | Creates & persists an editable `HonoQuotationDraft` + generates `/q/:slug` customer URL | Gemini Tool (`submit_quotation_to_hono`) | `< 35 ms` |
| `PUT /v1/quotes/:id` | Updates editable `quotationUrl` and/or `lineItems[]` table and recalculates totals | Hono Studio UI (`/quotes`) | `< 20 ms` |
| `POST /v1/quotes/:id/confirm` | Locks `status = confirmed_by_hono`, signs the Odoo GAIS envelope, and synthesizes the AI confirmation reply | Hono Studio UI / Webhook | `~ 800 ms` |

#### Request Contract (`POST /v1/quotes/submit` & `POST /v1/quotes/compute`)
```json
{
  "phone": "84359386414",
  "discountPercent": 30,
  "trip": {
    "guestName": "Sir Sky",
    "checkIn": "2026-10-10",
    "checkOut": "2026-10-14",
    "nights": 4,
    "guests": 10,
    "divers": 8,
    "rooms": 5,
    "roomType": "deluxe",
    "meals": "full-board",
    "diveNotes": "4 divers dive 3 days, 4 divers dive 2 days; 2 non-divers"
  }
}
```

---

### 3.2. Hop 2 — `Hono BFF -> Odoo ERP` (via GAIS Gateway)

- **Local Trigger Endpoint on Hono**: `POST /v1/quotes/:id/sync-odoo` (also executed automatically inside `POST /v1/quotes/:id/confirm`)
- **Upstream Target Endpoint on Odoo / GAIS**: `POST https://erp.casaescondida.ph/api/v1/casa/quotations`

#### Outbound Odoo `sale.order` Contract (`gaisContract.payload`)
```json
{
  "model": "sale.order",
  "action": "upsert_quotation",
  "external_ref": "QT-1010-SKY",
  "quotation_url": "https://technext-edge-casa-bff.vercel.app/q/sky-oct10-group",
  "partner": {
    "name": "Sir Sky",
    "phone": "84359386414",
    "category_tag": "Resort Partner / B2B"
  },
  "stay_window": {
    "x_casa_checkin": "2026-10-10",
    "x_casa_checkout": "2026-10-14",
    "x_casa_nights": 4,
    "x_casa_guests_total": 10,
    "x_casa_divers": 8,
    "x_casa_non_divers": 2
  },
  "x_casa_split_dive_manifest": "4 divers dive 3 days, 4 divers dive 2 days (2 non-divers)",
  "pricelist_currency": "PHP",
  "discount_percent": 30,
  "amounts": {
    "subtotal": 286100,
    "discount_amount": 85830,
    "amount_total": 200270
  },
  "order_line": [
    {
      "sequence": 10,
      "product_category": "accommodation",
      "name": "Deluxe Oceanfront Twin/Double Room (10 guests / 5 rooms)",
      "product_uom_qty": 20,
      "x_casa_qty": 5,
      "x_casa_unit": "rooms",
      "x_casa_multiplier": 4,
      "price_unit": 4800,
      "discount": 30,
      "price_subtotal": 96000
    }
  ]
}
```

---

### 3.3. Security & Authentication (`Auth GAIS`)

Every boundary in the pipeline enforces cryptographic verification and idempotency:

1. **Meta WhatsApp → Hono BFF (`POST /v1/channels/whatsapp/webhook`)**:
   - **Header**: `X-Hub-Signature-256: sha256=<hmac_sha256(raw_body, WHATSAPP_APP_SECRET)>`
   - **Idempotency**: `store.claimMessage(wamid)` + `store.withPhoneLock(phone)` prevents duplicate webhook retries from triggering parallel AI calls.
2. **Hono Studio / Admin → Hono BFF (`/v1/quotes/*`, `/v1/channels/whatsapp/threads`)**:
   - **Header**: `x-verify-token: <WHATSAPP_VERIFY_TOKEN>` or `Authorization: Bearer <GAIS_API_KEY>`.
3. **Hono BFF → Odoo GAIS Gateway (`POST /api/v1/casa/quotations`)**:
   - **`Authorization: Bearer <GAIS_API_KEY>`**: Service-to-service API token scoped to the `casa_escondida_sales` Odoo integration user.
   - **`X-GAIS-Timestamp: <ISO-8601>`**: Replay-attack protection window (`±300s`).
   - **`X-GAIS-Signature: sha256=<hmac_sha256(timestamp + "." + idempotencyKey + "." + rawJsonBody, GAIS_HMAC_SECRET)>`**: Guarantees payload integrity so unit prices (`price_unit`) and partner discounts (`discount_percent`) cannot be tampered with in transit.
   - **`Idempotency-Key: QT-1010-SKY-confirmed`**: Guarantees that clicking **Confirm** multiple times updates the exact same Odoo `sale.order` (`external_ref = QT-1010-SKY`) rather than spawning duplicate orders.

---

## 4. Bản Tóm Tắt Tiếng Việt (Dành Cho Bạn Nắm Toàn Bộ Kiến Trúc & Trade-Off)

### 4.1. Tại sao dùng luồng `AI -> Hono (Submit/Compute/Edit) -> Odoo` thay vì cho AI gọi thẳng vào Odoo? (Trade-Offs)
1. **Chống "Rác dữ liệu" (Dirty ERP State) trong Odoo**:
   - Khi khách nhắn WhatsApp, họ đổi ý liên tục (*"từ 10 người xuống 8 người"*, *"4 người lặn 3 ngày, 4 người lặn 2 ngày"*, *"xin giảm 30% giá đối tác"*). Nếu AI gọi thẳng Odoo ở mỗi lượt chat, Odoo sẽ bị ngập hàng chục bản nháp `sale.order` sai lệch.
   - Khi đặt **Hono làm lớp đệm (Stateful Staging & Compute Buffer)**: AI gọi tool `submit_quotation_to_hono` đẩy qua Hono trước. Nhân viên mở `/quotes` sửa bảng giá, sửa link báo giá (`/q/sky-oct10-group`), bấm **Confirm** thì Hono mới đẩy **1 bản chuẩn duy nhất** sang Odoo (`sale.order`) và gửi lại cho AI báo khách.
2. **Đảm bảo SLA 20 giây của WhatsApp Webhook**:
   - Gọi Gemini (3–4s) + gọi Odoo XML-RPC/REST (3–6s) + tạo PDF ngay trong 1 lượt dễ vượt quá ngưỡng timeout `20s` của Meta (dẫn tới lỗi `turn_failed` như lúc trước).
   - Tách bước `AI -> Hono Submit/Compute` chạy nội bộ cực nhanh (`< 35ms`), trả ngay link báo giá `/q/:slug`, còn bước xác nhận/đồng bộ Odoo (`POST /v1/quotes/:id/confirm` & `/sync-odoo`) chạy bất đồng bộ khi bấm duyệt.
3. **Đánh đổi (Trade-off) cần quản lý**:
   - Vì bảng giá có thể được chỉnh sửa tay trên Hono (`/quotes`) trước khi đẩy sang Odoo, nếu không có khóa chống trùng lặp thì mỗi lần bấm Confirm sẽ đẻ ra đơn mới trên Odoo.
   - **Cách giải quyết đã cài sẵn trong code**: Hono sinh header `Idempotency-Key: QT-1010-SKY-confirmed` + mã `external_ref: "QT-1010-SKY"`, ép Odoo thực hiện `upsert_quotation` (cập nhật đè lên đúng `sale.order` đó kèm `price_unit` và `discount` đã sửa trên Hono).
