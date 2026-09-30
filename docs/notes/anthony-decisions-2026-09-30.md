# Cần Anthony chốt — kênh AI nối với tool báo giá của khách

*30/09/2026. Gửi kèm bản đánh giá khả thi (3 cách nối; đề xuất: cách 1 bây giờ, đích là F10).*

**Hiện trạng một câu:** bot đã nối được ở mức API với `tn-casa-quotation-estimator` (Stage1@5fe2806) và chạy trọn chuỗi
trích xuất → nháp → nhân viên duyệt → `commit` + `share` → link khách, trên fixture. Muốn nối vào **quy trình nghiệp vụ** của
khách thì còn chờ các quyết định dưới đây.

Mỗi mục: câu hỏi · vì sao cần · đề xuất của mình · chặn cái gì. Xếp theo mức chặn, mục 1–4 là gốc.

| # | Cần chốt | Vì sao cần | Đề xuất của mình | Nếu chưa chốt thì chặn gì |
|---|---|---|---|---|
| 1 | **Chính sách dữ liệu:** tin nhắn khách thật có được đi qua DeepSeek/Gemini không? README của khách ghi chỉ Anthropic + Odoo | Hôm nay tin khách thật đi qua Gemini, rồi DeepSeek khi dự phòng | Nếu không được: dùng Anthropic cho dữ liệu thật, DeepSeek chỉ cho dữ liệu giả. Dashboard `/admin/ai` đổi được ngay, không deploy | Mọi bước nối sâu hơn, và PR #2 |
| 2 | **Production của tool khách:** `uibaogia` + Supabase + deploy-readiness (B-016, B-027, B-006). Hạn khi nào? | Fixture giữ share token trong RAM, link có thể 404 bất kỳ lúc nào | Một ngày cụ thể; mình chạy lại e2e ngay khi có | Chuyển khỏi fixture |
| 3 | **Danh tính cho kênh AI** (schema §4: hướng a "cookie guest của bot" hay b "service key + route") | Hiện BFF chỉ tin cookie; bot là khách ẩn danh nên nháp của nó thuộc về cookie của bot | Hướng (b): service key cho kênh WhatsApp, BFF ghi `scenario.source = 'whatsapp'` | Staff không phân biệt được nháp của bot trong tool khách |
| 4 | **`scenario.source` / `revision.author`:** mở kiểu `'form'` thành `form\|ai\|whatsapp` (`bff/src/store/types.ts:23`) | Cột có sẵn nhưng kiểu đang hẹp | Mở kiểu, ghi từ route AI | Như mục 3 |
| 5 | **Luồng F10 inquiry cho bot:** route BFF nhận inquiry từ kênh ngoài, và `/api/staff/inquiries` (chờ Phillip, B-043) | Bot cần một đường chuyển ca chưa đủ điều kiện sang nhân viên mà không gọi Odoo trực tiếp | Bot gửi `InquiryLead` (bên mình đã có `toInquiryLead`), staff bấm "Create trip" | Đích tích hợp dài hạn |
| 6 | **Báo ngược cho bot khi staff tạo link** (webhook hoặc nút WhatsApp ở D11) | Hôm nay người của mình bấm Publish trong studio mình; nếu bỏ studio, bot không biết link đã có | Webhook `share.created {scenarioId, url}` về bot, bot gửi WhatsApp | Bỏ được studio của mình |
| 7 | **Bước duyệt:** ca khách lẻ sạch có tự phát link (F08 Hướng A) không? Q-018 nói "không có bước duyệt", F08 nói người luôn phát link | Hai tài liệu của khách mâu thuẫn | Giữ người duyệt tới khi đã chạy Odoo thật một thời gian | Tốc độ trả link |
| 8 | **PR #2** (`ds/ai-room-type-required`, port extractor của mình vào `ai/`): merge, sửa, hay đóng? | Hai bản extractor song song; bản của họ không chia phòng theo sức chứa, không có cổng đại lý | Đóng hoặc tạm giữ nếu chọn F10. Nếu giữ: sửa policy LLM, env schema, auth và rate limit cho `/api/extract`, URL gateway ghi cứng | Hai bản extractor song song |
| 9 | **C-1 lên bản deploy:** `dac70e6` và `main` cho người đã đăng nhập bất kỳ mở link của agent | Share gate 403 `not_owner` chỉ có trên Stage1, chưa lên bản deploy | Deploy Stage1 mới | Lộ giá net |
| 10 | **Q-020:** agent share link cho khách của họ đang là ngõ cụt | Link của agent yêu cầu đăng nhập nên khách của agent không mở được | Link chỉ xem cho khách của agent, giống R7 | Luồng agent |
| 11 | **D1 (Sky):** bỏ luồng khách ẩn danh trong tool? Biên bản 28/09 ghi "hỏi lại #1" | Quyết định này đổi phương án danh tính bot và bước bàn giao `/quote/:token` | Chốt theo D1; khách đi qua WhatsApp | Phạm vi tool khách |
| 12 | **Tiền cọc / chính sách đặt chỗ** (Q-015, B-037): có câu nào hiển thị cho khách không? | Tool khách không nêu tiền cọc; bên mình đã bỏ phần này | Chờ câu chuẩn từ Casa | Nội dung trang khách |
| 13 | **Ghim lại spec Odoo** (vẫn ghim 16/09; `boats`, `/v1/auth`, `api-key` đang dùng type tự viết) | Rủi ro lệch hợp đồng không bị test bắt | Ghim spec mới, cho test đỏ có chủ đích rồi sửa | Rủi ro lệch hợp đồng |
| 14 | **Model AI khi bàn giao:** ai giữ key, ai trả tiền, được dùng provider nào | Đổi model hiện phải vào Vercel sửa env rồi deploy | Khách tự giữ key và đổi qua dashboard (Việc 2) | Bàn giao |

## Ghi chú cho người đọc

- Mục 1 và 14 gắn với nhau: dashboard `/admin/ai` đổi được provider/model/key mà không deploy lại, nên quyết định ở mục 1 áp dụng
  được ngay mà không cần sửa code.
- Mục 3–6 là một gói: chọn hướng (b) ở mục 3 thì mục 4 là việc kèm theo, mục 6 là điều kiện để bỏ studio của mình.
- Mục 7 và 11 do cùng một câu hỏi về vai trò con người trong luồng; nên hỏi Sky và Anthony cùng lúc.
- Cái gì mình đã làm khớp với hệ thống của khách và đã lên production: `docs/specs/06-p5-bff-schema-contract.md` §8b.
- Phân tích chi tiết hai repo: `docs/notes/upstream-analysis-2026-09-30.md`.
