# Kịch bản live demo (~8 phút)

> **Trạng thái: chưa diễn tập đủ 8 phút.** Từng bước đã chạy được riêng lẻ (xem `docs/guides/manual-test-production.md`
> §1 và bảng "Đã kiểm live" ở `docs/guides/whatsapp-manual-test.md`), nhưng bản ghép này chưa ai chạy một mạch từ đầu
> đến cuối. Diễn tập **một lần** trước buổi thật, và bấm giờ.

Nguyên tắc của kịch bản này: **đi đúng một đường đã chạy được, nói trước giới hạn thay vì bị hỏi ngược.**
Điều gì chưa làm được thì nói là chưa làm được — không né, không giả vờ.

---

## Trước buổi demo

**Chuẩn bị dữ liệu (làm 15–20 phút trước, không làm lúc khán giả đã ngồi):**

1. Điện thoại nằm trong danh sách test của Meta (số đang dùng: `84359386414`, xem runbook §0.1).
2. Đăng nhập studio ở `/login` (`https://technext-edge-casa-bff.vercel.app/login`), dán key vào ô mật khẩu.
   **Không** mở studio bằng `?token=` trên URL — URL ở lại trong lịch sử và trong ảnh chụp màn hình chiếu lên.
3. **Làm ấm và kiểm quota:** nhắn `hi` từ điện thoại, chờ bot trả lời (nếu im hoặc báo "something went wrong on
   our side" thì là Gemini 429 — đợi ~1 phút, thử lại). Rồi **reset** bằng route ở runbook §0.4.
4. **Chạy trọn một lượt kịch bản A** (Tin 1 → Tin 2 → studio → Publish) và **giữ lại bản đã publish làm dự phòng.**
   Ghi mã báo giá (`QT-1120-ANA-…`) và link `/q/<slug>` của nó ra giấy. Reset (§0.4) **không** đóng bản đã publish.
5. Reset lần cuối, để lượt demo thật bắt đầu từ thread sạch.
6. Mở sẵn hai cửa sổ: **Production** (`technext-edge-casa-bff.vercel.app`) và **Preview**
   (`technext-edge-casa-bff-sim.vercel.app`, đăng nhập cùng key). **Đừng mở báo giá đang demo ở cửa sổ Preview**
   (xem "Không làm").

---

## Diễn biến

| Giờ | Màn hình | Làm | Nói |
|---|---|---|---|
| 0:00–0:45 | — | Nêu vấn đề | Khách nhắn tự nhiên, thiếu thông tin, viết lộn xộn; lễ tân mất thời gian đọc, hỏi lại và gõ lại vào hệ thống |
| 0:45–2:30 | Điện thoại (WhatsApp) | **Tin 1**, đúng nguyên văn: `Hi, I'm Ana Reyes. 2 guests, 1 room, 2 nights from 2026-11-20 to 2026-11-22. Full board please. No airport transfer. 1 diver, diving on 2026-11-21.` — chờ bot — rồi **Tin 2**: `Deluxe please` | Bot đọc lại, chỉ hỏi **đúng một câu** còn thiếu (loại phòng), không hỏi lại thứ khách đã nói, không báo giá, không hứa gì. Cuối cùng nói rõ *"nothing is booked yet"* |
| 2:30–4:30 | Studio (Production) | Mở báo giá mới nhất của Ana (`QT-1120-ANA-…`). Xem màn 1: `Rooms: r1:deluxe`. Bấm **Save & get price** → màn 2: **Engine total ₱31.200** → **Continue to approve →** → **Approve quotation** | Nhân viên không gõ tiền — mọi con số do engine của resort trả về; nhân viên chỉ kiểm và sửa **dữ kiện** (phòng, ai lặn ngày nào). Duyệt là duyệt cho **một chuyến cụ thể**: sửa lại thì mất duyệt |
| 4:30–5:30 | Studio, màn 4 | tick **I have checked this sample price** → **Create link & send** — **bấm MỘT lần, rồi chờ** | Link chỉ đi ra khi có người duyệt. Giá đang là **sample** — nhãn ghi rõ |
| 5:30–6:45 | Điện thoại → trang khách | Tin thứ ba từ resort có link. **Mở ngay**, đọc trang cùng khán giả | Xem "Nói thật" bên dưới — đây là chỗ hay bị hỏi nhất |
| 6:45–8:00 | Cửa sổ Preview | Mở **`QT-1010-SKY`** (bản seed, không publish được), đổi phòng `standard` → `deluxe`, **Save & get price** | Đây là cảnh **tiền chạy theo dữ liệu**: mỗi phòng 2 người mỗi đêm từ **7.600 lên 11.200**. Cửa sổ Production thì trả lại bản chụp nên số đứng yên — hai cửa sổ chứng minh hai việc khác nhau |

---

## Nói thật — nói chủ động, đừng đợi bị hỏi

1. **Giá là sample ở cả hai cửa sổ.** Đọc theo nhãn trên trang. Con số thật chỉ có khi Odoo của resort được nối.
2. **Trang khách thường là bản sao của mình, không phải app của khách.** App demo phía khách làm mất link sau vài
   giờ; khi đó hệ thống tự kiểm, gửi bản sao **cùng dữ liệu** ở `/q/<slug>`, và studio nói rõ vì sao. Khi nối Odoo
   thật, link sẽ là của app khách và bền.
3. **Thẻ per-guest ghi "Standard A" dù đã đặt deluxe.** Đây là bản chụp của fixture phía khách (nó không tính giá,
   chọn bản chụp theo hình dạng chuyến). Phòng deluxe đi đúng trong dữ liệu gửi sang; nối Odoo thật thì dòng đó là
   Deluxe, cộng **₱3.600 mỗi phòng mỗi đêm** — xem bảng giá của chính resort.
4. **Bot không báo giá, không hứa.** Không có số tiền, không có "confirmed", không hứa giữ phòng, không hứa gửi xác
   nhận. Nếu model lỡ viết vậy, câu đó bị chặn và thay bằng bản do code dựng.

---

## Không làm trong demo

Mỗi mục là một lỗi **đã biết, chưa sửa** (chi tiết và `file:dòng` ở runbook §2b). Tránh bằng cách đi đúng kịch bản:

- **Nhắn thêm bất cứ gì vào WhatsApp sau khi đã nhận link** — kể cả "thanks!". Nó sinh một báo giá mới trùng, và
  bot lại nói "đang chuẩn bị báo giá". (C1.7)
- **Bấm đúp "Create link & send".** Bấm một lần và chờ. (C2.8)
- **Mở báo giá đang demo ở cửa sổ Preview.** Hai cửa sổ dùng chung một kho dữ liệu; tính lại ở đó bằng bộ giả lập
  sẽ đè giá của engine thật và bỏ duyệt. Cảnh Preview chỉ dùng `QT-1010-SKY`.
- **Bấm Publish trên `QT-1010-SKY`** — bị từ chối (đúng thiết kế), nhưng đừng để khán giả thấy lỗi mà không giải
  thích được. Cũng đừng sửa bản seed rồi để nguyên: nó giữ nguyên chỗ sửa cho tới khi đổi phiên bản seed.
- **Viết ngày `dd/mm/yyyy`** trong tin mẫu — luôn dùng `2026-11-20` như trên (C1.8).
- **Gửi ảnh hoặc voice** trong lúc demo — bot sẽ im lặng (C1.6).
- **Ghi nhận tiền cọc, huỷ báo giá, đổi ngày ở ô thông tin liên hệ** (C2.7, C2.10, C2.11).
- **Nhắc chữ "agency"/"agent" trong tin mẫu** — bot nhận ra đại lý và mời họ tự đăng nhập; bản nháp bị giữ cho nhân
  viên và Publish/Send bị chặn (409 `partner_needs_own_login`). Không còn giảm giá 30%, nhưng khán giả sẽ thấy lỗi
  chặn mà không có link — chỉ dùng khi có chủ đích để trình bày đúng luồng đại lý.
- **Đọc lệnh có khoá lên màn hình chiếu.** Khoá đi bằng header, không nằm trên URL, và không dán vào chat.

---

## Nếu có sự cố giữa buổi

| Hiện tượng | Làm gì |
|---|---|
| Bot im, hoặc trả lời *"something went wrong on our side"* | Gemini 429 (15 request/phút). Đợi ~1 phút rồi nhắn lại. Nếu vẫn không được: chuyển sang bản dự phòng bên dưới |
| **Create link & send** báo lỗi | Đúng thiết kế: lỗi là lỗi, không giả vờ thành công, báo giá vẫn sửa được. Đọc câu báo lỗi cho khán giả, bấm lại một lần |
| Trang khách hiện *"This quote link is not valid or has expired"* | Fixture phía khách mất token. Bấm **Send the message** một lần nữa: hệ thống kiểm link, chuyển sang bản sao của mình và gửi link mở được |
| Tin không tới điện thoại, webhook báo `failed:1` | Meta từ chối (`#131030`: số chưa có trong danh sách test). Thêm số vào *To* trong Meta App |
| Studio báo *"the engine no longer had this quotation, so it was priced again…"* | Không phải lỗi — đọc câu đó rồi đi tiếp |

**Bản dự phòng:** nếu live hỏng ở bước nào, mở **bản đã publish từ lượt diễn tập** (mã và link `/q/<slug>` đã ghi
ở bước chuẩn bị 4) để cho xem phần còn lại. **Nói rõ đó là bản chạy trước buổi demo, không phải live** — không
giả là chạy thật.

---

## Nếu bị hỏi ngược

Trả lời đúng sự thật. Những điều dưới đây **chưa** làm được, và đang nằm trong danh sách việc:

| Câu hỏi | Trả lời thật |
|---|---|
| "Khách gửi voice note hay ảnh chụp màn hình thì sao?" | Hiện bot **chưa đọc** và cũng **không trả lời** — im lặng. Đây là việc phải làm trước khi mở cho khách thật |
| "Khách đổi ý sau khi đã nhận link?" | Hiện tạo một báo giá mới, link cũ vẫn sống ở giá cũ và chưa có thông báo cho khách. Đang trong danh sách việc |
| "Khách viết tiếng Nhật, Hàn, Tagalog?" | Hiện hỗ trợ tiếng Anh và tiếng Trung. Bộ nhận diện chỉ tìm chữ Hán, nên câu tiếng Nhật có chữ Hán (gần như mọi câu) bị trả lời bằng tiếng Trung; các tiếng khác trả bằng tiếng Anh |
| "Hai nhân viên cùng sửa một báo giá?" | Chưa có khoá — người lưu sau đè người lưu trước, không cảnh báo |
| "Đại lý (agent) thì báo giá thế nào?" | Bot nhận ra và mời họ tự đăng nhập trên app báo giá của khách để thấy giá đại lý — đúng luồng thủ công. Đường dẫn đăng nhập đó **chưa được kiểm với app thật** |
| "Khách trả tiền cọc thế nào?" | Chưa làm trong sản phẩm này. Điều khoản cọc là của resort; sẽ lấy từ engine khi Odoo được nối, không do bot tự nêu |
| "Giá này có đúng không?" | Là **sample**. Đúng/sai chỉ kiểm được khi có Odoo thật — nên trang ghi nhãn sample thay vì trình bày như báo giá thật |

---

## Sau buổi demo

- Đóng báo giá demo khỏi hàng đợi (runbook §5, khoá đi bằng header).
- Ghi vào bảng "Đã kiểm live" của `docs/guides/whatsapp-manual-test.md`: ngày, ca nào chạy được, ca nào không, và câu
  nguyên văn bot trả nếu có gì bất thường.
- Nếu đã sửa bản seed `QT-1010-SKY` ở cửa sổ Preview, ghi lại để biết nó đang lệch bản gốc.
