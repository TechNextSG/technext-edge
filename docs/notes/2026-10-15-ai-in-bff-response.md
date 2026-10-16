# Trả lời Nhật: AI chạy chung với BFF (15/10/2026)

Trả lời file `2026-10-15-needs-from-duy.md`. Người quyết: Anthony.

## TL;DR

- **AI chạy chung với BFF:** cùng repo `tn-casa-quotation-estimator`, cùng project Vercel, cùng một DB. BFF gọi AI bằng **hàm** (`import … from '@casa/ai'`), không gọi qua HTTP.
- `technext-edge` chỉ còn là bản demo, không lên Production. **ADR-011 hết hiệu lực**, thay bằng plan `docs/superpowers/plans/2026-10-13-whatsapp-channel.md` (PR #38).
- Ranh giới giữa hai bên giữ bằng code và test, không cần tách mạng: `ai/` không gọi Odoo, không đọc DB, không tạo link.
- Vì vậy các mục 3, 4.1, 4.2 của file (DB riêng cho Edge, service key, webhook HMAC) **không cần làm**.
- Cho dùng DeepSeek / Gemini làm dự phòng với khách thật. Bắt buộc dùng **key trả phí**.

## 1. Hai bên nối với nhau thế nào

```
 Khách WhatsApp ==> Meta ==> BFF  POST /api/wa/...  (webhook, kiểm chữ ký Meta)  --+
 Staff dán tin nhắn ======> BFF  POST /api/extract                                --+
                                                                                     |
                                                                                     v
                         @casa/ai  extract(text, ctx) -> ExtractResult
                         (hàm thuần: không Odoo, không DB, không tạo link; key provider truyền vào)
                                                                                     |
                                                                                     v
                         BFF  createDraftEstimate -> Odoo compute -> DB
                         (scenario.source = 'whatsapp' | 'ai', revision.author = 'ai')
                                                                                     |
                                                                                     v
                         Staff xem nháp trong Trips -> Save -> gửi link cho khách
```

Hình trên: AI chỉ biến chữ thành `ExtractResult`. Mọi việc còn lại (gọi Odoo, ghi DB, tạo link) là của BFF. Staff vẫn là người gửi link cho khách.

### Cửa Inquiry (form "Book now" trên website Casa)

Form trên website **không gửi vào app mình**. Form gửi thẳng vào Odoo, rồi BFF tự đi lấy về:

```
 Khách ==> website "Book now" ==> Odoo  POST /v1/inquiry/submit  (đã có) -> CRM lead
 BFF   ==> Odoo  GET /v1/inquiry, GET /v1/inquiry/{id}  (đã có từ 29/09) -> tab Inquiries (F10)
 Staff bấm Create trip -> BFF: extract(lời nhắn của khách) [gọi hàm] -> createDraftEstimate -> Odoo compute
 BFF   ==> Odoo  POST /v1/inquiry/{id}/quoted  (đánh dấu đã báo giá)
```

Như vậy Inquiry chỉ là thêm một **cửa vào BFF**, cùng hàng với form, ô dán tin nhắn và WhatsApp. AI vẫn nằm sau BFF và được gọi bằng hàm.

App chỉ phải mở một API HTTP mới khi có hệ thống bên ngoài **đẩy** dữ liệu vào. Ví dụ: Odoo gửi webhook khi có lead mới, hoặc một website không chạy trên Odoo. Lúc đó API ấy là một route của BFF, có kiểm chữ ký và giới hạn số lần gọi giống webhook WhatsApp. Nó vẫn không phải API của AI.

## 2. Luật ranh giới (thay cho việc tách service)

1. `ai/` không import gì từ `bff/` và không gọi client Odoo. Test `ai/test/boundaries.test.ts` phải tiếp tục chặn việc này.
2. `ai/` không đọc DB và không tự đọc `process.env`. Key và cấu hình provider do BFF truyền vào.
3. Kiểu dữ liệu dùng chung (`Trip`, `ExtractResult`) đặt ở `contracts/` hoặc export từ `@casa/ai`. Không chép tay sang chỗ khác.
4. Mỗi lần gọi LLM có timeout dưới giới hạn 60 s của Vercel. Khi AI lỗi:
   - route trả lỗi rõ ràng, để staff nhập tay;
   - không làm hỏng route khác;
   - không ghi nội dung tin nhắn khách vào log.
5. Bot không tự gửi giá hay link cho khách. Staff duyệt trước (mục 2.3 của file).

## 3. Vì sao chạy chung

| Lý do | Cụ thể |
|---|---|
| Ít thứ phải vận hành | Không cần DB thứ hai, service key, webhook HMAC, CORS hay một lần deploy thứ hai |
| Một DB, một nơi đăng nhập | Theo luật hiện có: một DB `postgres`; phiên đăng nhập và vai lấy từ BFF |
| Code đã đi hướng này | PR #15 (`/api/extract` gọi `@casa/ai`), #31 (`source`), #38 (plan WhatsApp), #40–#44 (W1–W5) |
| Nhanh hơn | Không thêm một lượt gọi mạng giữa AI và BFF |
| Phase 1 nhỏ | Chỉ nhân viên nội bộ dùng; chưa có tải nào buộc phải tách |

## 4. Cái giá và cách giảm

| Cái giá | Cách giảm |
|---|---|
| Sửa prompt là phải deploy cả app; deploy Staging cần lệnh của Anthony | Gom các thay đổi prompt lại, deploy một lần. Nếu phải đổi prompt nhiều lần một ngày thì tính lại |
| Thời gian gọi AI tính vào giới hạn 60 s của Vercel | Đặt timeout khoảng 45 s. Webhook WhatsApp trả 200 cho Meta ngay, xử lý sau |
| File server gộp to thêm (hiện 822 KB) | Gọi provider bằng `fetch`, không cài SDK nặng. Đo `npm run build:vercel -w bff` trước khi mở PR |
| Lỗi trong AI có thể làm hỏng cả function | Bắt lỗi ngay chỗ BFF gọi `@casa/ai`, có test cho trường hợp provider lỗi hoặc quá giờ |

## 5. Khi nào tách thành service riêng

Chỉ tách khi gặp một trong ba trường hợp:
- cần Python (ví dụ LangGraph bản Python cho advisory agent, ADR-009);
- có việc chạy quá 60 s hoặc chạy nền lâu;
- một nhóm khác cần deploy AI theo nhịp riêng.

Tách lúc đó không phải viết lại: BFF đã gọi AI qua một cửa duy nhất (`@casa/ai`). Chỉ cần thay cửa đó bằng một lệnh gọi HTTP, kiểu dữ liệu giữ nguyên.

## 6. Trả lời từng mục của `needs-from-duy`

| Mục | Trả lời |
|---|---|
| P0. Key DeepSeek cho bộ đo T6 | Anthony gửi riêng qua kênh nội bộ, có hạn mức chi. Không commit |
| 1.1–1.4. Handoff (số WhatsApp thật, báo lễ tân, chỗ trả lời khách, giờ trực / phí Meta) | **Để sau.** Phase 1 chỉ nhân viên nội bộ; khách nhắn WhatsApp là bản V4. Đây là chính sách của Casa: tới lúc làm thì ghi vào `docs/ledgers/customer-questions.md` |
| 2.1. Dùng DeepSeek / Gemini làm dự phòng với khách thật | **Đồng ý** (Anthony 15/10). Dùng key trả phí, không dùng Gemini bản free. README dòng 108 đã sửa |
| 2.2. Ai giữ key AI khi bàn giao | Để sau, tính cùng câu hỏi ai trả phí hạ tầng |
| 2.3. Staff duyệt trước khi gửi khách | **Giữ**, đã có trong plan 13/10 |
| 3.1–3.3. DB cho Edge | **Không cần.** Bảng `wa_*` nằm trong DB của Estimator (PR #41) |
| 4.1, 4.2. `ESTIMATOR_SERVICE_KEY`, webhook HMAC | **Không cần**, vì gọi bằng hàm |
| 4.3. `scenario.source = 'whatsapp'` | Đã có (PR #31) |
| 5.1. Merge `feat/provider-kernel` | Mở PR để Anthony review, không merge thẳng |
| 5.2. Xoá video demo cũ | Chờ Anthony xác nhận đã backup |

## 7. Việc Nhật làm tiếp

1. Thêm dòng đầu ADR-011: `Status: superseded 15/10/2026 by tn-casa docs/superpowers/plans/2026-10-13-whatsapp-channel.md`. Sau đó push nhánh lên GitHub.
2. Sửa PR #30 và plan 13/10 (mục 2, 4) theo quyết định 2.1.
3. Chạy bộ đo T6 bằng key DeepSeek; dán kết quả vào PR.
4. Nếu đang port code từ `technext-edge` sang (prompt kernel, provider), port vào `ai/` của repo này và giữ đúng các luật ở mục 2.
