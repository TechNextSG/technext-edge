# TechNext Edge — kiến trúc

Tài liệu cho nhóm phát triển trên **technext-edge** và cầu nối với **tn-casa-quotation-estimator** (repo của team, gọi là *team estimator*; nó là bản gốc, repo này chỉ mô phỏng phía studio).

---

## 1. Ba gói, một chiều phụ thuộc

```
┌────────────────────────────────────────────────────────┐
│                   @casa/contracts                      │
│   Hợp đồng Odoo của team estimator: kiểu OpenAPI,      │
│   client có kiểu, fixtures. Bản sao nguyên văn.        │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                       @casa/ai                         │
│   Trip schema, extract, intent, synthesis, converse,   │
│   odooHandoff (Trip -> BffTrip). Bản sao nguyên văn.   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                       @casa/bff                        │
│   Ứng dụng Hono: studio, kênh WhatsApp, miền báo giá   │
│   (quote/), lưu trữ (store/), trang (views/).          │
└────────────────────────────────────────────────────────┘
```

> **Ranh giới bất di bất dịch** (`npm run check:boundaries`, nằm trong `npm run verify`):
> - Một gói chỉ import gói bên trái nó; `contracts` không import ai hay bff, `ai` không import bff.
> - Giữa các gói chỉ import barrel `<gói>/src/index.ts`, không import file bên trong.
> - Import giữ đường dẫn tương đối (`../../ai/src/index.ts`), không dùng `@casa/*`: symlink workspace đã không phân giải được trong bundle Vercel.

### `ai/` và `contracts/` là bản sao, không phải mã của repo này

Hai thư mục này **giống từng byte** repo team (bỏ qua kiểu xuống dòng). Sửa chúng ở repo team (một PR bên đó), rồi chép về.
`npm run mirror:check` so sánh với bản checkout của team (`TEAM_REPO`) và báo mọi file khác, thiếu hay thừa. Mốc ghim,
quy tắc và cách cập nhật nằm ở [notes/upstream-provenance.md](notes/upstream-provenance.md). Hệ quả: zod 4, đuôi `.ts` trong
import, `tsconfig.base.json` của team; `bff/` vẫn biên dịch với `tsconfig.bff.json` (các tuỳ chọn cũ, lỏng hơn).

`npm run upstream:check` là nửa còn lại: liệt kê commit mới bên team chạm các đường dẫn ảnh hưởng chatbot.

---

## 2. Tổ chức trong BFF (`bff/src/`)

Mỗi thư mục trả lời một câu hỏi; `bff/test/layers.test.ts` giữ các quy tắc dưới đây.

| Thư mục | Trả lời | Được import |
|---|---|---|
| `env.ts` | Biến môi trường nào tồn tại, tên gì. **Chỗ duy nhất đọc `process.env`.** | — |
| `auth/` | Ai đang đăng nhập: `keys` (khoá staff/admin, `sameSecret`), `session` (cookie ký HMAC), `rate-limit`, `guards` (`staffSession`, `adminGuard`…), `secretBox`. | `env` |
| `store/` | Dữ liệu nằm ở đâu: `kv.ts` (một client KV), kho báo giá, hội thoại, cài đặt AI. | `env`, `quote`, `auth` (chỉ `secretBox`) |
| `quote/` | Báo giá là gì: bản nháp đã tính giá, bảng giá, hạn hiệu lực, diff chuyến, inquiry lead. Thuần, không I/O. | `env` |
| `estimator/` | Ai tính giá: client gọi estimator thật, `simulated.ts` mô phỏng, `refusalCopy.ts` đổi mã lỗi thành câu cho staff. | `env`, `quote`, `store` |
| `channels/whatsapp/` | Kênh WhatsApp: gọi Meta (`meta.ts`), vòng lặp tin nhắn theo số điện thoại (`turn.ts`). | `env`, `quote`, `store`, `estimator`, `auth` |
| `ai/` | Provider AI dùng chung cả tiến trình (`providerHolder.ts`) và `providerFor`. | `env`, `store` |
| `routes/` | HTTP: mỗi file là một sub-app Hono (`xxxRoutes(deps)`); `quotes/` gồm bảy sub-app và `service.ts`. | tất cả bên dưới |
| `views/` | HTML/CSS/JS render phía server. | `env`, quote, auth (kiểu) |
| `app.ts` | Lắp ráp: dựng dependency, middleware, rồi `app.route()` từng nhóm. Khoảng 100 dòng. | tất cả |

Quy tắc đã được test giữ (`bff/test/layers.test.ts`): `process.env` chỉ ở `env.ts`; `auth/` và `quote/` chỉ import `env`; `store/` chỉ import `env`, `quote`, `auth`;
`views/` chỉ `import type` từ `store/`.
`auth/`, `routes/`; `quote/` chỉ import `env`.

### Routes (`routes/`)
`auth.ts` (đăng nhập demo), `admin.ts` (cấu hình AI động, `/admin/ai`), `health.ts`, `extractor.ts` (`/v1/extract`, `/v1/converse`),
`handoff.ts` (hộp thư cần người), `whatsapp.ts` (webhook Meta), `pages.ts` (`/` → studio; `/test`, `/console` chỉ staff),
và `quotes/` — bảy module nhỏ: `pages` (studio), `guestPage` (`/q/:slug`), `list`, `record` (đọc/sửa/duyệt/huỷ/dọn),
`pricing` (compute, sync, sửa chuyến), `publish` (tạo link, gửi WhatsApp), `booking` (submit). Thứ tự đăng ký trong
`quotes/index.ts` là một phần của hợp đồng: `GET /v1/quotes/estimator-status` phải đứng trước `GET /v1/quotes/:id`.

### Views (`views/`)
`quotationEditorPage.ts` là điểm vào 27 dòng; trang studio gồm `editor/model.ts` (suy ra trạng thái, bước, nhắc theo dõi),
`editor/markup.ts` (HTML), `editor/styles.ts` (CSS), `editor/client.ts` (script trình duyệt). Văn bản được chuyển nguyên
văn, và `bff/test/views/editorSnapshot.test.ts` giữ 12 trạng thái của trang từng byte một — đổi một ký tự CSS hay script là đỏ.
Còn lại: `handoffPage`, `guestQuotationCopy`, `opsPage`, `loginPage`, `adminAiPage`, `emptyStudio`, `testPage`, `theme`.

### Trạng thái và dữ liệu mẫu
Studio không còn tự tạo bản ghi mẫu `QT-1010-SKY` khi khởi động; studio rỗng hiện một câu nói rõ cái gì sẽ lấp đầy nó.
Test cần bản ghi mẫu dựng nó trong `bff/test/helpers/sampleQuotation.ts`.

---

## 3. Quy chuẩn

1. **Độ dài file:** tránh file quá ~400 dòng; nếu phình ra, tách theo câu hỏi nó trả lời (như `views/editor/`, `routes/quotes/`).
2. **Một trách nhiệm:** không trộn HTML vào store; không viết tính giá hay trích xuất AI trong route handler.
3. **Môi trường:** thêm biến mới = thêm một dòng vào `env.ts`; truyền `Env` cho hàm cần nó (mặc định `loadEnv()`).
4. **Trước khi commit:** `npm run verify` (ranh giới + typecheck + toàn bộ test) phải xanh. Đụng tới `ai/` hoặc `contracts/`: sửa ở repo team,
   chép về, chạy `npm run mirror:check`.
5. **Trước khi sửa thứ tính giá:** `npm run upstream:check`; xử lý xong thì cập nhật mốc trong `notes/upstream-provenance.md`.
