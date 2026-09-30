# TechNext Edge & Casa Quotation Architecture Guide

Tài liệu hướng dẫn kiến trúc chuẩn dành cho nhóm phát triển (4 thành viên và mở rộng) trên hệ thống **TechNext Edge** và cầu nối với **tn-casa-quotation-estimator**.

---

## 1. Bản đồ Phụ thuộc Gói (Package Dependency DAG)

Hệ thống được thiết kế theo mô hình **Hexagonal / Clean Architecture**, phân tầng nghiêm ngặt với luồng phụ thuộc một chiều (unidirectional dependency rule):

```
┌────────────────────────────────────────────────────────┐
│                   @casa/contracts                      │
│     (Domain Entities, Zod Schemas, Handoff Types)      │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                       @casa/ai                         │
│     (Domain Logic, Extractor, Intents, Synthesis)      │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                   @casa/quotation                      │
│     (Local Pricing Mirror, Rules, Rate Card In-Memory) │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                       @casa/bff                        │
│    (Hono HTTP Controllers, Store Repositories, Views)  │
└────────────────────────────────────────────────────────┘
```

> **Nguyên tắc ranh giới bất di bất dịch:**
> - `contracts` không bao giờ import từ `ai`, `quotation`, hay `bff`.
> - `ai` không bao giờ import từ `quotation` hay `bff`.
> - `quotation` không bao giờ import từ `bff`.
> - Chạy `npm run check:boundaries` trong CI để đảm bảo không ai vô tình phá vỡ ranh giới này.

---

## 2. Tổ chức Module trong BFF (@casa/bff)

Để tránh hiện tượng **"God-Files"** (file hàng nghìn dòng) và triệt tiêu xung đột mã nguồn (**merge conflicts**) khi 4 lập trình viên cùng làm việc, BFF được chia tách thành 4 lớp rõ ràng:

### A. Routes (`bff/src/routes/`) - Controller Layer
Chỉ làm nhiệm vụ nhận HTTP request, parse body, kiểm tra quyền truy cập (guards), gọi services/stores, và trả về HTTP response:
- `auth.ts`: Đăng nhập, đăng xuất demo staff/admin.
- `admin.ts`: Cấu hình AI Provider động, test provider.
- `health.ts`: Liveness & readiness probes (`/v1/health`, `/healthz`).
- `pages.ts`: Trang chủ và tài nguyên tĩnh.
- `extractor.ts`: API trích xuất ý định hội thoại (`/v1/extract`, `/v1/converse`).
- `handoff.ts`: Quản lý danh sách thread cần người trực (`/handoff/*`).
- `whatsapp.ts`: Webhook Meta WhatsApp Cloud API (`/v1/channels/whatsapp/*`).
- `quotes.ts`: Web Studio, Hono Editor, đồng bộ báo giá Odoo, duyệt và phát hành link (`/quotes/*`, `/v1/quotes/*`, `/q/:slug`).

### B. Services (`bff/src/services/`) - Application / Domain Use Cases
Chứa nghiệp vụ độc lập với giao thức HTTP:
- `whatsappTurnService.ts`: Vòng lặp xử lý tin nhắn inbound, phone lock, phát hiện đổi ý định, gọi extractor, và gửi phản hồi.
- `quotationService.ts`: Tạo preview tính giá, lọc trường chỉnh sửa, kiểm tra trạng thái đóng băng chia sẻ (`alreadySharedRefusal`), chuẩn hóa model sang record.
- `estimatorClient.ts` / `estimatorPort.ts`: Adapter giao tiếp với Booking Engine BFF upstream (qua HTTP hoặc Simulated in-memory).
- `whatsapp.ts`: Adapter gửi nhận tin qua Meta API.

### C. Stores (`bff/src/stores/`) - Persistence / Repository Layer
Chỉ làm nhiệm vụ lưu trữ, truy vấn dữ liệu từ bộ nhớ hoặc Redis:
- `quotationStore.ts`: Lưu trữ bản thảo báo giá (Quotation Drafts), tìm kiếm, phân trang, lọc trùng lặp. **Không chứa mã render HTML**.
- `conversationStore.ts`: Lưu trữ lịch sử hội thoại WhatsApp, distributed lock theo số điện thoại, danh sách threads bị hoãn (paused).
- `settingsStore.ts`: Lưu trữ cấu hình AI runtime trong KV.

### D. Views (`bff/src/views/`) - Presenter / Template Layer
Tập trung toàn bộ HTML/CSS/JS template giao diện phục vụ server-side rendering:
- `quotationEditorPage.ts`: Giao diện Reservation Studio & Hono Editor.
- `handoffInboxPage.ts`: Giao diện danh sách cuộc trò chuyện cần hỗ trợ.
- `guestQuotationCopy.ts`: Trang copy báo giá dự phòng cho khách.
- `opsPage.ts`: Trang Ops Sheet phục vụ vận hành resort.
- `theme.ts`: Bảng màu CSS tokens.

### E. Bootstrap Orchestrator (`bff/src/app.ts`)
Chỉ làm nhiệm vụ kết nối và gắn các router vào ứng dụng Hono. Dung lượng duy trì **dưới 200 dòng**.

---

## 3. Quy chuẩn Clean Code cho Nhóm 4+ Lập trình viên

1. **Giới hạn độ dài file (File Length Limit):**
   - Không tạo file vượt quá **400 dòng**. Nếu một file có dấu hiệu phình to, hãy bóc tách helper functions ra `services/` hoặc chia nhỏ router.
2. **Quy tắc Single Responsibility (SRP):**
   - Không trộn lẫn HTML template bên trong file xử lý dữ liệu store.
   - Không viết logic tính toán giá hoặc trích xuất AI bên trong route handlers.
3. **Quy trình Git & Đồng bộ Upstream:**
   - Khi phát triển tính năng cho Edge Extractor: làm việc trên repo `technext-edge`.
   - Chạy `npm run verify` trước khi commit (yêu cầu 100% boundary check, typecheck và tests đều pass).
   - Khi cần chuyển giao gói `ai/` cho repo chính `tn-casa-quotation-estimator`:
     - Chạy script kiểm tra `node tools/ops/sync-ai-to-upstream.mjs`.
     - Commit lên nhánh `feat/ai-upgrade-hexagonal` trong repo chính.
     - Đảm bảo toàn bộ 1.265 tests của upstream tiếp tục pass 100% trước khi mở Pull Request.
