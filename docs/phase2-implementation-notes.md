# Nhật Ký Kỹ Thuật (Engineering Log) — Phase 2: Bộ Chấm Điểm Độ Tự Nhiên, Adapter Bàn Giao Odoo & ADR-007

**Ngày thực hiện:** 23/09/2026  
**Người thực hiện:** `aidev1-technext`  
**Mục tiêu:** Chủ động hoàn thiện toàn bộ hạ tầng kỹ thuật của **Phase 2** trước khi nhận dữ liệu từ Phillip và Eloa, bao gồm:
1. Bộ chấm điểm độ tự nhiên & không hỏi lặp khách quan (`scoreReplyNaturalness`).
2. Bộ chuyển đổi dữ liệu bàn giao & báo giá Odoo (`buildOdooHandoffPayload`).
3. Văn bản quyết định kiến trúc chính thức `ADR-007` để Lead (Sky / Anthony) ký duyệt khóa thiết kế.

---

## 1. Bảng Tóm Tắt Các Hạng Mục Đã Xây Dựng Trong Phase 2

| STT | Hạng mục Phase 2 | Mô tả kỹ thuật & Giá trị mang lại | File triển khai |
| :---: | :--- | :--- | :--- |
| **1** | **Bộ chấm điểm Độ Tự Nhiên (`scoreReplyNaturalness`)** | Chấm điểm tự động trên thang **0 – 100 điểm** dựa trên 4 trọng số khách quan:<br>• **35% `noReAskScore`**: Không hỏi lặp lại `divers`/`diveFrom`/`diveTo` khi đã có `diveNotes`.<br>• **25% `nuanceAckScore`**: Có phản hồi xác nhận đúng chi tiết `diveNotes` & `specialRequests` của khách.<br>• **25% `factGateScore`**: Vượt qua bộ lọc `verifySynthesizedReply` (0% bịa giá, 0% sai số đêm/phòng).<br>• **15% `conciergeWarmthScore`**: Có lời chào/cảm ơn ấm áp và bố cục tóm tắt rõ ràng.<br>$\rightarrow$ **Sẵn sàng 100%:** Ngay khi Eloa gửi 30 tin nhắn thật, chỉ cần chạy hàm này là xuất báo cáo điểm số tức thì. | [`packages/extractor/src/naturalness.ts`](file:///e:/technext-edge/packages/extractor/src/naturalness.ts) |
| **2** | **Bộ đóng gói & phân luồng bàn giao Odoo (`buildOdooHandoffPayload`)** | Chuyển hóa đối tượng `Trip` đã xác thực thành gói `OdooHandoffEnvelope` chia làm 3 chế độ rõ ràng:<br>• `incomplete_enquiry`: Đang hỏi thêm thông tin trên WhatsApp.<br>• `auto_estimate_ready`: Khách lẻ (`retail`) có đủ số nguyên chuẩn $\rightarrow$ Sẵn sàng gọi thẳng API báo giá Odoo ngay khi Phillip mở cổng.<br>• `manual_staff_review`: Khách đại lý/giáo viên (`agent`/`instructor` cần chiết khấu 30%) hoặc lịch lặn lẻ ngày (`diveNotes`) $\rightarrow$ Tự động đính kèm `manualReviewReasons` & `staffAlerts` cho nhân viên chốt giá. | [`packages/extractor/src/odooHandoff.ts`](file:///e:/technext-edge/packages/extractor/src/odooHandoff.ts) |
| **3** | **Biên bản kiến trúc `ADR-007` (`ADR-007-neuro-symbolic-synthesis.md`)** | Tài liệu hóa chính thức kiến trúc Hybrid AI 2 tầng (Neuro Synthesis + Symbolic Fact Gate + `NEVER RE-ASK` + `DIVE_CLAUSE_AFTER_NOUN`) tiếp nối `ADR-005a` và `ADR-006`, sẵn sàng để Sky và Anthony ký duyệt (`Sign-off`). | [`docs/adr/ADR-007-neuro-symbolic-synthesis.md`](file:///e:/technext-edge/docs/adr/ADR-007-neuro-symbolic-synthesis.md) |

---

## 2. Kết Quả Kiểm Thử Tự Động (Unit Tests & Typecheck)

- **Lệnh chạy:** `npm run verify` (`tsc --noEmit` + `vitest run`)
- **Kết quả:** **16/16 Test Files Passed — 235/235 Unit Tests Passed (100% Xanh)**.
- **Các bài test mới bổ sung tại [`packages/extractor/test/questions.test.ts`](file:///e:/technext-edge/packages/extractor/test/questions.test.ts#L599-L675):**
  1. `Phase 2 Naturalness Scorer: awards 100/100 to warm non-redundant replies and penalizes re-asking`
  2. `Phase 2 Odoo Handoff Adapter: distinguishes auto_estimate_ready vs manual_staff_review`
