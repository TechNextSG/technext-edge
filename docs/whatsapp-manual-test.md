# Kịch bản test tay trên WhatsApp

Trang để kiểm chứng: `https://technext-edge-casa-bff.vercel.app`
Staff key: **lấy từ Vercel env `WHATSAPP_VERIFY_TOKEN`** (Production). Không dán vào file này, không dán vào chat, không chụp màn hình kèm.

| Cần mở | Ở đâu |
|---|---|
| Hộp thư chờ người | `/handoff` |
| Studio báo giá | `/quotes` |
| Trang khách | link `/q/<slug>` trong tin nhắn bot gửi |

## Chuẩn bị — đọc trước, nếu không sẽ test "không thấy gì"

1. **Số nhận là `+1 555-150-6595`.** Nhắn từ điện thoại của bạn tới số này.
2. **Số của bạn phải nằm trong danh sách test của Meta** (App Dashboard → WhatsApp → API Setup →
   "To" → Manage phone number list). Nếu không, bot **vẫn xử lý** nhưng tin trả về sẽ không tới —
   mình đã đo được đúng ca này: lượt đó trả `failed: 1, replied: 0`, và thread vẫn được park nên
   `/handoff` vẫn thấy. Đây là lỗi gửi phía Meta, không phải lỗi logic.
3. **Giữa các kịch bản, gõ `reset`** để xoá thread. (Từ khoá nhận: `reset`, `start over`,
   `restart`, `重置`, `重新开始`.)
4. Meta chỉ cho trả tin tự do trong **24h** kể từ tin cuối của khách. Test trong phiên là thoải mái.
5. Gửi **từng tin một, chờ trả lời** rồi mới gửi tin kế. Nhiều tin trong cùng một gói webhook thì
   được gộp thành một lượt; nhiều gói khác nhau thì mỗi gói một lượt (có thể nhận 2 tin trả lời).

---

## KB1 — Chốt đủ trong một lượt (đường hạnh phúc)

**Gửi (copy nguyên):**
> Hi, I'm Miguel. We are 4 guests and we need 1 room. Check in on 2026-11-20 and check out on 2026-11-22, so 2 nights. Full board please. No airport transfer. All 4 of us will dive on 2026-11-21.

**Mong đợi:** tóm tắt đầy đủ + link `/q/<slug>`. Đã đo được trên production: lượt này trả
`done=true, replyKind=summary`, sinh `QT-…-MIGU-…`.

Không được thấy: câu hỏi nào nữa (nhất là không hỏi lại "how many of you will be diving" — câu
"All 4 of us will dive" là ca `DIVERS_CLAUSE`).

**Kiểm chứng:** mở link khách → không có ghi chú nội bộ, không có nút sửa. Mở `/quotes` → bấm
**Price with the Estimator BFF** → hiện **thẻ từng khách** + nhãn `SAMPLE DATA`. (Đã đo: 4 khách,
1 phòng, 2 đêm, full board, 4 diver → tổng **₱41,600**.)

---

## KB2 — Thiếu ngày (hai lượt)

**Lượt 1:** `Hi, 4 of us, full board, we want to dive.`
**Mong đợi:** bot hỏi **ngày check-in** và **số đêm** (và các trường còn thiếu khác).

**Lượt 2:** `Oct 17 to Oct 20, so 3 nights, name is Miguel.`
**Mong đợi:** không hỏi lại số đêm (đã suy ra từ khoảng ngày), đi tới tóm tắt.

---

## KB3 — Lịch lặn lẻ ngày (NEVER RE-ASK)

**Gửi:** `We are 6 guests staying 3 nights from 2026-12-01 in 3 rooms, full board, no transfer. Diving: 1 person dives day 1, 5 people dive both days. Name is Ana.`

**Mong đợi:** bot **KHÔNG** hỏi lại "How many of you will be diving?" — thay vào đó có dòng
**Custom Dive Schedule** nói rằng lịch lẻ ngày đã được chuyển cho nhân viên tính tay.

Nếu thấy bot hỏi lại số người lặn → đây là bug, ghi lại nguyên văn tin nhắn.

---

## KB4 — Khách đổi số đã chốt (đọc lại một lần)

**Lượt 1:** `we are 5 of us`
**Lượt 2:** `sorry, actually 3 of us`
**Mong đợi ở lượt 2:** có câu **"Just to check — … 5 guests → 3 guests …"**.
**Lượt 3:** `yes that's right`
**Mong đợi:** **không** nhắc lại nữa (chỉ đọc lại một lần).

---

## KB5 — Điểm dừng: nói mãi không chốt

**Gửi lần lượt 4 tin, mỗi tin chờ trả lời:**
`hmm` → `not sure yet` → `still thinking` → `maybe later`

**Mong đợi:** tới tin thứ 4, bot **dừng hỏi** và báo đã chuyển cho người, **kèm danh sách còn thiếu**
(dạng "still needed: your check-in date and how many guests").

**Kiểm chứng:** `/handoff` → dòng đó hiện lý do **"Stuck — same questions open"**, có cột *Still
needed* và *Their last message*. Bấm **Take it back to the bot** để trả thread về cho bot.

---

## KB6 — Huỷ / hoàn tiền (chuyển người ngay)

**Gửi:** `Please cancel my booking for next week`

**Mong đợi:** bot **không hỏi ngày check-in**, chỉ trả câu "A member of the Casa team is handling
your enquiry now…". `/handoff` → lý do **"Cancellation / complaint"**.

Thử thêm: `cancelling`, `I want a refund`, `this is a complaint`.

---

## KB7 — Không phải câu hỏi đặt phòng

**Gửi:** `hey what is the wifi password?`

**Mong đợi:** một câu nói rõ số này dùng cho **yêu cầu đặt phòng mới**, đã chuyển cho team.
`/handoff` → lý do **"Not a booking enquiry"**.

Đối chứng (phải là booking bình thường, **không** bị từ chối): `do you have a room for two on
Saturday?` và `can we dive without staying overnight?`.

---

## KB8 — Đòi người thật, và không lặp câu giữ chỗ

**Gửi:** `Can I talk to a human please?`
**Rồi gửi liền:** `hello?` và `ok`

**Mong đợi:** chỉ **một** tin giữ chỗ ("A member of the Casa team…"). Hai tin sau **không** nhận
thêm câu đó nữa (cửa sổ nhắc lại 10 phút) và **không** gọi model.
Sau ~10 phút, gửi `any news?` → được nhắc lại một lần.

---

## KB9 — Tiếng Trung

**Gửi:** `我想找人工客服`
**Mong đợi:** câu giữ chỗ **bằng tiếng Trung** ("Casa 团队正在处理您的咨询…").

**Gửi tiếp:** `我们4个人，11月20日入住，住2晚，全餐，不需要接送，我的名字是 Miguel。`
**Mong đợi:** tóm tắt bằng tiếng Trung + link khách.

---

## KB10 — Reset

**Gửi:** `reset`
**Mong đợi:** lời chào mới, thread sạch (các câu hỏi bắt đầu lại từ đầu).

---

## Sau khi chat: kiểm ở studio

1. `/quotes` → mở quotation vừa sinh.
2. **Price with the Estimator BFF** → thẻ **Per guest**, nhãn `SAMPLE DATA`, khối *From the booking
   engine* (cảnh báo "no boat picked yet for…").
3. **Send reservation** → điền tên/email → **"Reservation sent"**, **"Folio number pending"**,
   **"Sample — no folio was created"**. Bấm lại → **409** (chỉ một đặt chỗ sống mỗi báo giá).
4. **Ops Sheet (no prices)** → mỗi ngày một tờ, 5 khối, **không có một đồng nào**. Bấm Print.
5. Mở link khách → banner "Reservation sent" + "latest version of your quotation".

## Nếu có gì sai, gửi mình những thứ này
- Nguyên văn tin bạn gửi và **nguyên văn tin bot trả**.
- Ảnh `/handoff` (nếu thread bị park) — nó ghi lý do dừng và còn thiếu gì.
- Thời điểm gửi (giờ VN) để mình tra log của lượt đó.

## Tra nhanh trạng thái thread bằng API (không cần chat)

Đặt token vào biến môi trường của shell, đừng gõ thẳng vào lệnh (nó sẽ nằm lại trong lịch sử shell):

```bash
export CASA_TOKEN="$(vercel env pull --environment=production --yes >/dev/null && grep WHATSAPP_VERIFY_TOKEN .env.local | cut -d= -f2- | tr -d '\"')"

# các thread đang chờ người
curl -H "x-verify-token: $CASA_TOKEN" \
  https://technext-edge-casa-bff.vercel.app/v1/channels/whatsapp/threads

# trả một thread về cho bot
curl -X POST -H "x-verify-token: $CASA_TOKEN" \
  https://technext-edge-casa-bff.vercel.app/v1/channels/whatsapp/threads/<so_dien_thoai>/resume

# xoá hẳn một thread
curl -X POST -H "x-verify-token: $CASA_TOKEN" \
  https://technext-edge-casa-bff.vercel.app/v1/channels/whatsapp/threads/<so_dien_thoai>/reset
```
