# Phân tích repo khách `tn-casa-quotation-estimator` — 30/09/2026

Phạm vi: `docs/` (product, ledgers, flows, integration), gói `ai/` nhánh `ds/`, và `bff/` + `contracts/` trên ba nhánh
`origin/main`, `origin/Stage1_Estimator_Tools` (5fe2806), `origin/ds/ai-room-type-required` (17209ea). Chỉ đọc, không sửa repo khách.

**Nguồn.** Ba lượt đọc chạy song song. Mình đã tự kiểm lại các điểm sau bằng code/chạy thật: luật sức chứa, `TripIssueCode`,
route `/api/extract` (chạy thử hai tin nhắn), hợp đồng không đổi từ `4c48918`. Phần còn lại (đặc biệt biên bản họp, Q-xxx, so sánh
từng file `ai/`) là kết quả đọc của lượt đọc, **chưa được mình kiểm lại từng dòng**. Chỗ nào là suy luận có ghi *(suy luận)*.

## 1. Bức tranh chung

| | Nhánh | Ghi chú |
|---|---|---|
| `main` | 3d64eab | không có staff/notes/certs/extract; share chưa có `not_owner` |
| `Stage1_Estimator_Tools` | 5fe2806 | nhánh làm việc thật; bản deploy `dac70e6` là tổ tiên của nó |
| `ds/ai-room-type-required` | 17209ea | tách từ Stage1 ở `aab7731`; hơn Stage1 6 commit, kém 8. **Chỉ nhánh này có F08 và `/api/extract`** |

Hợp đồng `contracts/src/trip.zod.ts` và `estimate-api.v1.json` **không đổi** từ `4c48918` trên cả ba nhánh (chỉ thêm vai
`instructor`). `validate.ts` giống hệt giữa Stage1 và `ds/`.

## 2. Hướng đi của khách cho kênh AI

- **F08** (`docs/flows/F08-ai-channel.md`, chỉ có trên `ds/`) mô tả **hai** thứ và tự mâu thuẫn:
  - Hướng A: bot → `POST /api/extract` → nếu sạch (không issue **và** `readyForAutoQuote`) thì tự `commitRevision(…,'ai')` + tạo
    share token, trả `/quote/<token>`; nếu không thì lưu nháp, `quoteUrl:null`, `requiresStaffReview:true`.
  - Kênh WhatsApp hiện tại của mình **không** gọi `/api/extract`: trích xuất → nháp → nhân viên duyệt và Publish trong studio →
    `commit` + `share`. F08 ghi rõ link luôn do người phát hành. Sơ đồ trong cùng file vẫn vẽ bot tự phát link.
- **Q-018** (Anthony, 26/09): "không có bước nhân viên duyệt báo giá". Mâu thuẫn với bước duyệt trong studio; bước duyệt của mình
  đúng với F08 nhưng không đúng với Q-018. Cần Lead/Anthony chốt.
- **Họp 28/09** (`meeting-2026-09-28.html`, chỉ Stage1): công cụ dành cho nhân viên và agent; khách đặt qua "WhatsApp + AI chatbot"
  (D1, Sky). "Khởi động AI service" nằm trong việc tiếp theo. Câu hỏi "trang ẩn danh và link công khai có bỏ không" **chưa được
  trả lời** ("hỏi lại #1"). Q-002 (22/09) vẫn ghi: link khách lẻ công khai, link agent cần đăng nhập.
- **Trạng thái P5 không nhất quán giữa các nhánh:** roadmap `main`/Stage1 ghi "gác", `ds/` ghi "code xong 25/09". B-002 (bot gọi
  extractor thế nào) vẫn "gác" dù `ds/` đã import trực tiếp. `docs/integration/schema.md` trên `ds/` đã cũ (còn ghi `/api/extract`
  và `scenario.source` là "chưa có").
- **Không có danh tính dịch vụ cho bot.** BFF chỉ tin cookie. Hai lựa chọn "chưa ai chọn": (a) bot giữ cookie `ubg_sid` của khách
  cho mỗi hội thoại (chạy được, giá khách, khách 404 ở `/trip/:id`, chỉ `/quote/:token` mở được); (b) key/role riêng từ Odoo
  (Phillip phải cấp, chưa có kế hoạch). `scenario.source` (`form|ai|whatsapp`) và `revision.author` (`human|ai`) là cột có sẵn,
  `ds/` đã ghi `'ai'` cho revision.

## 3. Luật khách đã chốt hoặc còn mở (bot phải theo)

| Chủ đề | Trạng thái |
|---|---|
| Sức chứa phòng (Q-019) | pending; standard 2 / deluxe 4 / suite 4 (đọc từ `rates.roomRates`); không kê giường phụ (đề xuất, chưa chốt). POST chia phòng, PATCH/commit 422 |
| Phòng trống (Q-011) | chỉ cảnh báo |
| Cửa sổ lặn (Q-008, Q-010) | phải nằm trong kỳ ở, tính cả hai biên |
| Ngày quá khứ (Q-012) | check-in quá khứ bị chặn (giờ Manila); staff được miễn. Bot đóng vai khách nên bị chặn |
| Số đêm tối thiểu (Q-009) | 1 đêm, không day-use |
| Giá agent | `guestType` bị ép theo vai phiên, bỏ qua payload (trừ staff). Hoa hồng agent ~30% đã trừ sẵn trong giá agent, biên đặt ở Odoo (D4, D5, D8). Q-020 (khách của agent thấy gì) và Q-006 (agent chưa xác minh) chưa trả lời |
| Loại phòng | `ds/` bắt buộc hỏi loại phòng trước handoff (mặc định `standard` từng báo thấp 3.600 peso/đêm cho deluxe). Loại phòng chọn: agent chọn loại, staff chọn phòng cụ thể (D9, T02) |
| Bot không được hứa xác nhận (Q-015), không thu thông tin liên hệ để submit (Q-013), không báo giá dính `issues` | đã chốt/tạm |
| Cọc, hạn hiệu lực báo giá | không tìm thấy quy tắc trên hai nhánh; email xác nhận là câu hỏi mở (Odoo gửi từ folio là *gợi ý*, chưa chốt) |

## 4. BFF của khách (tóm tắt)

- **Vai và phiên:** guest/agent/instructor/staff; vai lấy từ hàng phiên đã ký (nạp từ Odoo lúc đăng nhập), không từ payload. Bản nháp
  không thuộc bạn trả 404, không phải 403. Staff ghi được mọi trip, Odoo nhận key staff.
- **Share token:** 32 byte ngẫu nhiên, chỉ lưu hash. Link chủ guest công khai; link chủ agent/staff yêu cầu đăng nhập và người xem phải
  là chủ hoặc staff (403 `not_owner`, chỉ có trên Stage1 và `ds/`, chưa lên bản deploy `dac70e6`).
- **Lưu trữ:** không có `DATABASE_URL` thì store trong RAM. Khi lambda recycle mất **tất cả** bản nháp, revision, snapshot, share
  token, phiên đăng nhập. README của họ nói thẳng điều này. Nháp sống 90 ngày nhưng `expireDrafts` **không có ai gọi theo lịch**
  *(suy luận từ việc không thấy nơi gọi)*. Link chia sẻ mặc định không hết hạn.
- **Deploy:** Vercel, Root Directory `bff`, Node, `maxDuration 15`. Fixture: `FIXTURE_MODE=1` + `SESSION_SECRET`. Live cần
  `ODOO_BASE_URL`, `ODOO_KEY_*`; submit mặc định đóng (503 `closed`) trừ khi `ODOO_SUBMIT_ENABLED=1`; production live bắt buộc Supabase.
- **Fixture trả số đã chụp**, không tính từ input (giá, tên, ngày trên thẻ giá là của bản chụp). Một commit `ds/` cảnh báo "fixture demo
  trap".

## 5. Gói `ai/` của khách so với extractor của mình

- `ai/` là bản **port** của extractor của mình (`ef315b5`, 25/09), phẳng, không có tầng, không có định giá/`quotationTool`/`tripDiff`.
  Phần lõi (`extract`, `normalize`, `questions`, `dates`, `counts`, `intent`, `naturalness`, hai provider) cùng dòng, khác biệt nhỏ.
- **Mới ở phía họ:** câu hỏi loại phòng (`dd7964c`), `verifyGuestFacingText` tách riêng (`17209ea`), `converse` trả `bffTrip`,
  `bffValidationIssues`, `handoff`, Gemini schema qua `z.toJSONSchema` (Zod v4).
- **Mình mới hơn:** sức chứa phòng (`DEFAULT_ROOM_CAPS`, `room-over-capacity`), lời mời đăng nhập cho agent và nhận ra "đặt cho
  mình", cảnh báo DSD, giờ trực quầy lễ tân, mẫu "is/are … confirmed" trong fact gate, sửa regex `deluxe` thiếu cờ `i`
  (bên họ "Deluxe please" bị bỏ qua, bot hỏi lại).
- **Khác nhau về hành vi:** `buildBffTrip` của họ mặc định 1 phòng (5 khách vẫn 1 phòng) và không có kiểm sức chứa; của mình chia theo
  sức chứa. Khách lẻ đi cùng đường ở cả hai bên, agent thì họ giữ cho nhân viên, mình mời đăng nhập.
- **`/api/extract` của họ không làm:** fact gate trên câu trả lời, mời/từ chối agent, lưu hội thoại, gửi WhatsApp, diff/sửa của nhân
  viên, hạn hiệu lực, follow-up. Mình không có `/api/extract`, `commitRevision`, `createShareToken`, `checkComputeSane`.
- Đã tự chạy thử (fixture, local): tin đủ thông tin và cửa sổ lặn rõ → `quoteUrl`, `requiresStaffReview:false`; tin agent →
  `quoteUrl:null`, `requiresStaffReview:true`. Hai tin thiếu tên khách hoặc thiếu cửa sổ lặn cũng không ra link.

## 6. Việc mình đã làm khớp (đã push/deploy)

Chia phòng theo sức chứa, giữ số phòng khách nói, 422 dịch ra tiếng Anh, simulated theo luật thật, bỏ giảm 30% theo chữ, chặn publish/send
cho agent, fact gate cho tin kèm link, `upstream:check` theo dõi cả nhánh `ds/`. Xem `docs/specs/06-p5-bff-schema-contract.md` §8b.

## 7. Rủi ro và việc cần quyết

| # | Rủi ro | Mức | Ai quyết |
|---|---|---|---|
| 1 | **Hai bản extractor song song.** Cùng một enquiry có thể qua 422 ở đường này mà không ở đường kia, giá và số phòng khác nhau | Cao | Lead |
| 2 | **Q-018 vs bước duyệt của studio.** Một tài liệu nói không có duyệt, F08 nói người luôn phát link | Trung bình | Anthony/Lead |
| 3 | **Số phận trang ẩn danh và link công khai.** Nếu bỏ, phương án (a) danh tính bot và bước bàn giao `/quote/:token` đổi | Trung bình | Sky/Anthony |
| 4 | **Không có danh tính dịch vụ cho bot** (chỉ cookie); cần chọn (a) hay (b) | Trung bình | Anthony/Phillip |
| 5 | **Store trong RAM** của bản fixture: link do họ phát chết khi lambda recycle; mình đã có đường lùi `/q/:slug` (bản sao) | Trung bình | tạm chấp nhận |
| 6 | **Q-019 và các Q khác còn "pending"**; luật mình đang theo có thể đổi | Thấp–TB | Casa |
| 7 | **Trôi phiên bản Zod/Gemini schema** giữa hai extractor | Thấp | theo dõi |
| 8 | **Tài liệu khách lệch giữa các nhánh** (roadmap, `schema.md` cũ); dễ đọc nhầm hiện trạng | Thấp | họ |

## 8. Việc gợi ý tiếp cho technext-edge

1. Gửi Lead ghi chú cập nhật (`lead-extractor-duplication.md`) với điểm 1–4 ở bảng trên.
2. Hỏi Anthony: Q-018 đúng nghĩa là gì với kênh WhatsApp (bỏ bước duyệt hay chỉ với ca sạch).
3. Giữ `upstream:check` chạy trước mọi thay đổi chạm engine giá; cập nhật ghim khi `ds/` merge.
4. Không đổi studio theo hướng A cho tới khi Lead chốt (mục 1–3).
