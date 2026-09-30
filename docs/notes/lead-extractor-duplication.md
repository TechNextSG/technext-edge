# Cần Lead quyết: hai bản extractor song song

*30/09/2026 — từ đợt đối chiếu với repo nguồn `tn-casa-quotation-estimator`.*

**Vấn đề.** Nhánh `ds/ai-room-type-required` bên repo nguồn (chưa merge) port extractor của mình
(`technext-edge`) vào thư mục `ai/` của họ, kèm `POST /api/extract` và `verifyGuestFacingText`. Nếu nhánh
đó được merge, sẽ có **hai extractor** cùng làm một việc, sửa độc lập.

**Vì sao đáng lo.** `POST /api/extract` của họ bỏ qua hai thứ mình đã làm:

- luật chia phòng theo sức chứa (`buildBffTrip` bên mình; nếu thiếu thì PATCH bị 422 `room-over-capacity`);
- `retailFor` (chỉ agent/staff thấy giá so sánh).

**Bối cảnh.** Buổi họp 28/09: Sky muốn khách đặt qua WhatsApp + AI chatbot, trang khách ẩn danh có thể bị bỏ.
P5 đang ghi "parked, owner Nhật".

**Không phá gì hôm nay.** Chỉ là rủi ro lệch dần.

**Cần quyết:**

1. Bản nào là gốc — `technext-edge` hay `ai/` bên họ?
2. P5 có mở lại không, và ai giữ?
3. Nếu giữ bản của mình: nhờ họ không merge `/api/extract` song song, hoặc chỉ gọi sang mình.

Mình đang theo dõi bằng `npm run upstream:check`; sẽ báo lại nếu nhánh đó merge.

## F10 — đề xuất đường bàn giao (30/09)

`toInquiryLead(trip)` trong extractor của mình đã chuẩn bị dữ liệu theo shape `InquiryLead` của họ (F10). Mình **không** gọi
`POST /v1/inquiry/submit`: luật của khách là không gọi Odoo trực tiếp, và route BFF của họ cho việc này chưa có. Nếu Lead chọn
hướng "bot chuyển ca chưa đủ điều kiện sang nhân viên qua inquiry", đây là chỗ nối. Cần họ mở route và chốt shape (đang
"chờ Phillip", B-043).
