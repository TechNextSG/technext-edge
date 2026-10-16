# Cần Lead Duy Chốt — technext-edge

> **Thời gian đọc:** 3 phút | **Mục tiêu:** Chốt blocker kỹ thuật và quyết định kiến trúc trước khi bàn giao.

---

## ⚡ Hành động ngay (P0 — Chặn T6 Benchmark)

Cần Duy cấp **1 API key** để chạy bộ đo T6 (44 ca synthetic, ~3 phút chạy):

- [ ] **Cung cấp DeepSeek API key** (hoặc Anthropic Claude API key):
  - **Vì sao:** Gemini Free Tier bị nghẽn quota 20 req/ngày (cooldown 17h); hiện không có key DeepSeek/Anthropic hợp lệ trong `.env.local`.
  - **Chặn:** T6 eval không thể đo so sánh độ chính xác trước/sau của Prompt Kernel mới.
  - **Hành động của Duy:** Gửi key qua kênh nội bộ an toàn (không commit vào repo).

---

## 1. Quyết định vận hành & Handoff (ADR-010)

*Trích xuất từ [ADR-010](../adr/ADR-010-staff-handoff.md). Thời gian chốt: ~5 phút.*

| # | Vấn đề cần chốt | Hiện trạng & Đề xuất | Nếu chưa chốt thì chặn gì |
|---|---|---|---|
| 1.1 | **Số WhatsApp lên Production** | Hiện dùng test number (chỉ gửi được số verified).<br>**Đề xuất:** Dùng số thật qua Meta Coexistence hoặc đăng ký số Cloud API riêng. | Chưa thể test thật với khách và nhân viên lễ tân |
| 1.2 | **Kênh nhận thông báo Handoff** | Hiện bot chỉ pause ngầm, nhân viên không biết.<br>**Đề xuất:** Gửi WhatsApp template hoặc Telegram alert đến lễ tân trực ca. | Khách bị bỏ rơi khi bot chuyển giao cho người |
| 1.3 | **Nơi nhân viên trả lời khách** | `/handoff` hiện chưa có ô soạn tin (compose box).<br>**Đề xuất:** (A) Soạn tin trực tiếp tại `/handoff` hay (B) Trả lời qua WhatsApp Business App (Coexistence)? | Chưa thể đóng luồng CSKH 2 chiều |
| 1.4 | **Giờ trực & ngân sách template** | Lễ tân mở đến 21:00 (Manila time). Ngoài 24h Meta tính phí utility template.<br>**Đề xuất:** Duy duyệt khung giờ queue alert sáng hôm sau và ngân sách tin nhắn. | Rủi ro phát sinh chi phí Meta ngoài ý muốn |

---

## 2. Chính sách dữ liệu & Mô hình AI (ADR-011, D-129)

*Trích xuất từ [ADR-011](../adr/ADR-011-separate-ai-service.md) và [Quyết định Anthony](../notes/anthony-decisions-2026-09-30.md). Thời gian chốt: ~3 phút.*

| 2.1 | **Chính sách dữ liệu khách thật (Rule D-129)** | **Kỹ thuật:** AI service đã hỗ trợ fallback linh hoạt 100% qua `/admin/ai`. Bạn có thể tự bật cờ `ALLOW_NON_ANTHROPIC_IN_PRODUCTION=true` trên Vercel của `technext-edge`.<br>**Vấn đề:** Khách sạn Casa và Anthony từng cam kết dữ liệu khách chỉ đi qua Anthropic (Q-038).<br>**Cần Duy chốt:** Xác nhận về mặt chính sách (với Anthony/Resort) cho phép bạn bật cờ này để dùng Gemini/DeepSeek làm fallback cho khách thật. | Nếu không được duyệt chính sách, bạn bắt buộc phải chờ key Anthropic có bản quyền thương mại |
| 2.2 | **Quản lý AI Key khi bàn giao** | Hiện cấu hình qua biến môi trường hoặc `/admin/ai`.<br>**Đề xuất:** Bàn giao khách tự giữ key và thanh toán qua dashboard `/admin/ai`. | Kế hoạch bàn giao tài khoản và bảo mật |
| 2.3 | **Bước duyệt báo giá (Approval Gate)** | Ca khách sạch FIT: Tự gửi link khách ngay (F08) hay bắt buộc nhân viên bấm duyệt trên Estimator Trips?<br>**Đề xuất:** Giữ nhân viên duyệt trong giai đoạn đầu. | Tốc độ phản hồi khách WhatsApp |

---

## 3. Hạ tầng Cơ sở Dữ liệu Supabase / Postgres (Thay thế KV)

*Trích xuất từ [ERD AI Channel Postgres](../specs/erd-ai-channel-postgres.md) và DDL [`docs/specs/db/20261009000000_ai_channel.sql`](../specs/db/20261009000000_ai_channel.sql). Thời gian chốt: ~3 phút.*

**Hiện trạng:** `tn-casa-quotation-estimator` đã lưu dữ liệu trên Supabase (`scenario`, `revision`, `app_setting`). `technext-edge` hiện **chưa có DB**, vẫn chạy bằng in-memory / Upstash Redis KV (`store/conversationStore.ts`, `settingsStore.ts`).

| # | Vấn đề cần chốt | Các lựa chọn & Đề xuất | Nếu chưa chốt thì chặn gì |
|---|---|---|---|
| 3.1 | **Mô hình Database cho Edge** | **PA 1 (Đề xuất):** Dùng chung Supabase instance với Estimator, chạy DDL `20261009000000_ai_channel.sql` để tạo các bảng `wa_*`, `ai_*`.<br>**PA 2:** Cấp 1 Supabase project riêng cho Edge (độc lập hoàn toàn theo ADR-011).<br>**PA 3:** Tạm giữ Upstash Redis cho Edge, chỉ Estimator lưu Supabase. | Chưa thể bỏ Upstash Redis và port mã nguồn lưu trữ sang Postgres |
| 3.2 | **Cấp biến môi trường kết nối** | Nếu chọn PA 1 hoặc PA 2, Duy cấp:<br>- `DATABASE_URL` (Transaction Pooler port 6543) hoặc<br>- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Chặn viết migration runner và adapter Postgres trong `bff/src/store/` |
| 3.3 | **Phê duyệt file DDL `ai_channel.sql`** | Đã viết sẵn DDL chuẩn PostgreSQL 17 + RLS (`wa_conversation`, `wa_message`, `wa_handoff`, `ai_enquiry`) kèm test tự động `ai_channel.test.sql`.<br>**Đề xuất:** Duy review và duyệt chạy migration. | Rủi ro xung đột schema hoặc migrate lỗi trên production |

---

## 4. Tích hợp liên dịch vụ với Estimator (tn-casa)

*Trích xuất từ [ADR-011](../adr/ADR-011-separate-ai-service.md). Thời gian chốt: ~2 phút.*

- [ ] **4.1 Thống nhất Service Key (`ESTIMATOR_SERVICE_KEY`)**:
  - Dùng để `technext-edge` gọi sang Estimator API (`POST /api/estimates`) thay vì cookie ẩn danh.
- [ ] **4.2 Định dạng Webhook Approval (`ESTIMATOR_WEBHOOK_SECRET`)**:
  - Xác nhận payload HMAC SHA-256 từ `tn-casa` khi staff bấm "Save & Share" để bot bắn WhatsApp link cho khách.
- [ ] **4.3 Mở rộng enum `scenario.source`**:
  - Estimator cần chấp nhận giá trị `'whatsapp'` bên cạnh `'form'`.

---

## 5. Kế hoạch Merge & Dọn dẹp Repo

*Trích xuất từ [Cleanup Plan](../specs/2026-10-15-cleanup-plan.md). Thời gian chốt: ~2 phút.*

- [ ] **5.1 Kế hoạch merge `feat/provider-kernel`**:
  - Sau khi xong T6 eval + T7 rules (`AGENTS.md`) + T8 changelog: Merge thẳng vào `main` hay tạo Pull Request để Duy review?
- [ ] **5.2 Xác nhận sao lưu trước khi dọn dẹp (C5)**:
  - Dự kiến xóa các video demo cũ (~200MB) và docs archive.
  - Cần Duy xác nhận đã backup nội bộ trước khi thực thi C5 trên nhánh `chore/cleanup`.

---

## 📌 Tóm tắt 4 việc Duy cần chốt:

1. **Gửi 1 DeepSeek API key** để thông dòng T6 benchmark.
2. **Chốt mô hình DB Supabase:** Dùng chung DB với Estimator (chạy file DDL có sẵn) hay cấp riêng project Supabase mới cho Edge?
3. **Chọn hướng Handoff:** Soạn tin trên web `/handoff` hay dùng app WhatsApp Business (Coexistence).
4. **Duyệt cờ Fallback Production (D-129):** Bật `ALLOW_NON_ANTHROPIC_IN_PRODUCTION=true` để cơ chế Fallback tự do kích hoạt Gemini/DeepSeek khi Anthropic gặp sự cố.

