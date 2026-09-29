# Chạy tay thật: WhatsApp thật → bot → studio → link khách

Dành cho người **tự bấm tay** trên production, không dùng script. Mỗi lần chạy hết ~5 phút, và
điện thoại của bạn sẽ nhận tin thật.

> **Điều phải biết trước:** deployment engine mà production đang trỏ vào là bản **fixture** của khách
> (`tn-casa-estimator-fixture.vercel.app`). Bản đó giữ scenario + share token trong **bộ nhớ của một
> instance serverless**, nên link có thể 404 bất cứ lúc nào — publish **không** còn từ chối vì lý do đó,
> nó kiểm link rồi gửi **bản sao của mình** (`/q/<slug>`) nếu link khách không mở, và studio ghi rõ lý do.
> Cùng lý do đó, một record tạo từ lúc trước có thể **mất scenario**: mọi lệnh theo scenario (sửa chuyến,
> commit, share) trả 404. Cả hai đường đều **tự tính lại trong cùng session** rồi đi tiếp — xem bảng sự cố
> ở mục 4. Số đo: `docs/upstream-note-bff-vercel-deploy.md`. Vì vậy **bước 5 dưới đây phải mở link ngay**,
> và câu nói thật khi demo nằm ở cuối file.
>
> Mỗi lần **Send the message** đều kiểm link trước khi gửi: nếu link khách đã chết thì tin gửi đi là
> **bản sao của mình** (`/q/<slug>`) và record ghi lại lý do. Đo hôm 2026-09-28: link gửi lúc 16:18 đã
> 404 khi kiểm lại vài giờ sau; gửi lại một lần là khách nhận link của mình, mở được ngay.

---

## 0. Chuẩn bị (2 phút)

1. **Số điện thoại của bạn phải nằm trong danh sách test của Meta app.** Số đang dùng được:
   `84359386414`. Nếu chưa có, vào Meta App → WhatsApp → API Setup → *To* → thêm số.
2. **Lấy key staff** để mở studio. Từ 2026-09-28 key này là `STAFF_ACCESS_KEY` (không còn là
   `WHATSAPP_VERIFY_TOKEN` — key đó Meta cũng biết, và đã lộ trong chat nên production đã đổi; token cũ
   giờ trả **401**). Key nằm trong `.env.local`:

   ```powershell
   cd E:\technext-edge
   (Get-Content .env.local | Where-Object { $_ -match '^STAFF_ACCESS_KEY=' }) -replace '^STAFF_ACCESS_KEY=','' -replace '"',''
   ```

   Rồi mở **`https://technext-edge-casa-bff.vercel.app/login`** và **dán key vào ô mật khẩu**.
   > Đừng mở studio bằng `?token=...` trên URL nữa. URL nằm trong lịch sử trình duyệt, trong ảnh chụp
   > màn hình khi demo và trong mọi lần share tab — còn form đăng nhập thì đổi lấy cookie `HttpOnly`
   > (8 giờ) và key không rời khỏi trang. Các script thì vẫn dùng `?token=`/`x-verify-token` bình thường.

   **Hai secret khác nhau, đừng lẫn** (từ 2026-09-28): `STAFF_ACCESS_KEY` mở studio và mọi route
   `/v1/quotes/*`. Các route của **kênh** (`/v1/channels/whatsapp/threads/...`) vẫn dùng
   `WHATSAPP_VERIFY_TOKEN` — vì Meta cũng là người gọi chúng. Đo trên production: key staff vào route
   kênh → **401**; token WhatsApp vào → 200.
3. **Tab thứ hai (tuỳ chọn)** — chỉ cần khi muốn cho lead thấy *tiền đổi theo dữ liệu*: mở
   `https://technext-edge-casa-bff-sim.vercel.app/login` rồi dán **cùng key** đó (tab sim chạy engine
   giả lập **có tính lại**: 7.600 → 11.200/đêm khi đổi sang deluxe). Tab production thì **không** đổi số,
   vì fixture trả lại bản chụp — nói thẳng điều đó khi demo.
4. **Reset cho lần chạy sạch** (xoá hội thoại + đóng báo giá đang mở của số đó) — dùng token **kênh**:

   ```powershell
   $w = (Get-Content .env.local | Where-Object { $_ -match '^WHATSAPP_VERIFY_TOKEN=' }) -replace '^WHATSAPP_VERIFY_TOKEN=','' -replace '"',''
   Invoke-RestMethod -Method Post -Uri "https://technext-edge-casa-bff.vercel.app/v1/channels/whatsapp/threads/84359386414/reset" -Headers @{ 'x-verify-token' = $w }
   ```

   > Reset **đóng** báo giá đang mở của số đó (nó chuyển sang tab *Archived*). Record đã publish thì
   > không bị đóng. Nên chạy reset **trước** mỗi lần test, không phải giữa chừng.

---

## 1. Kịch bản A — luồng đầy đủ (khách lẻ, có lặn)

Nhắn **từ WhatsApp của bạn** tới số resort (số test `+1 555-150-6595`), đúng hai tin sau.

### Tin 1 — cố tình thiếu loại phòng (mọi thứ khác đã có, kể cả tên)

> Hi, I'm Ana Reyes. 2 guests, 1 room, 2 nights from 2026-11-20 to 2026-11-22. Full board please. No airport transfer. 1 diver, diving on 2026-11-21.

**Phải thấy trên điện thoại:** bot đọc lại ngày/khách/ăn/lặn, và hỏi **đúng một câu**, nguyên văn:
*"Would you like a standard, deluxe, or suite room?"* — không hỏi lại ngày, không hỏi lại số khách, không
hỏi tên (đã có trong câu trên).
**Không được có:** link, giá, chữ "confirmed".
> Nếu bot hỏi thêm field nào khác: nghĩa là nó chưa đọc được field đó từ câu trên — trả lời nốt rồi đi
> tiếp. Đó là model đọc văn bản, không phải lỗi luồng.

### Tin 2 — trả lời loại phòng

> Deluxe please

**Phải thấy:** tóm tắt có dòng room **Deluxe**, câu *"nothing is booked yet"* và *"our team is preparing your quotation"*.
**Vẫn không được có:** link hay giá.

### Trong studio (tab 1)

Mở báo giá mới nhất của Ana trong sidebar (mã dạng `QT-1120-ANA-…`). Trạng thái lúc này:
**Needs review**, màn 1, `Rooms: r1:deluxe`.

> Queue sau lần dọn 2026-09-28 còn **hai dòng**: `QT-1120-ANAR-F4A4C2DC` (chạy trọn luồng hôm nay, có
> bản sửa của nhân viên trên record, link khách đã gửi **và** `mirrorUrl` nên mở được trang khách của
> mình ở `/q/<slug>`) và seed `QT-1010-SKY` (`Needs review`, để tab *Action Needed* có việc). Record của
> lần chạy này là record **mới nhất** cùng số điện thoại, và là record duy nhất ở trạng thái `Needs
> review` có `r1:deluxe` do chính bạn vừa tạo.

| Bước | Bấm | Phải thấy |
|---|---|---|
| 1 | **Save & get price** (thanh dưới) | vài giây → màn 2 · badge `Priced — needs approval` · **Engine total ₱31.200** · badge engine `Sample engine (captured prices) — not a real quote` |
| 2 | **Continue to approve →** | màn 3 · `Step 3 · Approve` · preview lời nhắn |
| 3 | **Approve quotation** | tự sang màn 4 · `Approved — not sent yet` · nút "Create link & send" **mờ** vì chưa tick |
| 4 | tick **I have checked this sample price** | hai nút sáng lên |
| 5 | **Create link & send** | `Sent to guest` + ô link có URL `…/quote/<token>` — hoặc link `/q/<slug>` của mình nếu link khách không mở được, kèm câu giải thích |

> **Cái tick đó áp cho TỪNG hành động publish, không phải một lần cho cả phiên.** Bấm **Create link only**
> xong trang tự tải lại và ô tick **trắng lại** — muốn bấm **Send the message** thì tick lại. Đây là chủ ý
> (mỗi lần đưa giá sample ra ngoài là một lần tự chịu), nhưng nếu không biết thì rất dễ tưởng nút hỏng.

> Nếu bạn bấm **Create link only** (không gửi), badge phải là **`Link ready — not sent`** và nút chính
> đổi thành **Send the message** — không còn nói "đã gửi khách" khi thực ra chưa gửi. Đây là lỗi tìm
> thấy trên production 2026-09-28 và đã sửa.

**Trên điện thoại:** tin nhắn thứ ba từ resort, chứa **link báo giá**. Kiểm tra: tin đó **không có giá**
của mình, có nhãn "Sample prices", và câu *"nothing is booked yet"*.

### Mở link — làm NGAY, đừng để lâu

Mở link trên điện thoại (hoặc dán vào tab 3 của máy tính). Có **hai trang có thể hiện**, tuỳ link khách
nhận là của họ hay bản sao của mình — cả hai đều là cùng một revision đã đóng băng:

**A. Link của app khách** (`…/quote/<token>`, khi link còn sống):

- banner *"Sample data — prices are captured examples, not live quotes"*
- **Your quote · Version 1**
- **TOTAL ₱31.200** và itinerary có ngày lặn
- thẻ *Per guest* với phòng "Standard A" và Full board

**B. Bản sao của mình** (`…/q/<slug>`, khi link khách đã chết — đây là trường hợp hay gặp nhất vì fixture
mất token sau vài giờ):

- banner *"Sample data — these prices are examples from our booking engine while it is being set up"*
- **Hello <tên khách>, here is your quotation** — đúng **một** lời chào
- **₱31.200 · Total, from the resort's booking engine**
- hai thẻ per-guest (Ana ₱20.600 · Ben ₱10.600)
- khối *Booking & Deposit Policy*: chỉ **3 dòng** — 50% không hoàn lại, số còn lại trước ngày đi 1 tháng,
  và hạn hiệu lực giờ Manila
- **được kiểm là KHÔNG có**: hộp "giữ phòng 72 giờ", đồng hồ đếm ngược, phép chia 50% tiền cọc/số còn lại,
  ô chọn tiền tệ (USD/EUR/VND)

> Thẻ per-guest ghi **"Standard A"** dù mình đặt deluxe: đó là **bản chụp** của fixture, không phải lỗi
> phía mình — gateway của khách chạy `fillTrip` (thiếu field là 422) nhưng **không tính giá**, nó chọn một
> bản chụp theo *hình dạng* chuyến đi (đây chính là điều phải nói thật với lead). Phòng **deluxe** mà studio
> gửi đi thì kiểm được ở payload: `GET /v1/quotes/<ID>` → `bffTrip.rooms[0].type`.

> ⚠️ Nếu hiện *"This quote link is not valid or has expired"*: đó là **bản fixture của khách mất dữ liệu**,
> không phải lỗi luồng. Bấm **Send the message** một lần nữa — route tự kiểm link, đặt `mirrorUrl` và gửi
> bản sao của mình; khách nhận link mở được ngay. Ghi lại thời điểm gặp để báo khách.

---

## 2. Kịch bản B — ba bẫy phải tự kiểm

> **Thứ tự quan trọng:** làm **B1b trước khi bấm Publish**. Một báo giá đã publish thì không được tái sử
> dụng nữa, nên khách nhắn tiếp sẽ mở **record MỚI** (đúng thiết kế: báo giá đã gửi không sửa được) — khi
> đó không còn gì để kiểm "bản sửa có sống sót không", và queue có thêm một dòng.

### B1b. Sửa của nhân viên phải sống sót (bẫy A1 — đã sửa 2026-09-28)

**Làm ở màn 1, trước khi Approve/Publish.** Sửa một chi tiết **khách không hề nói** (ví dụ chuyển ô **D**
ngày lặn từ người này sang người kia trong lưới *Rooms & diving*), rồi bấm **Save & get price**.
Kiểm ngay trong studio: trip phải giữ **đúng bản sửa** (nếu bị trả về bản cũ thì đó là lỗi cũ đã sửa hôm
2026-09-28 — báo ngay), và bảng *AI reading check* phải đếm thêm một correction.

Rồi Approve, và **trước khi Publish** nhắn từ điện thoại một câu **không nói lại** chi tiết đó:

> One more thing: our flight lands at 4pm, everything else is as we said

**Phải thấy:** bản sửa của bạn **vẫn còn** (`Ben: dive 22/11`, `Ana: no dive`), badge **vẫn
`Sent to guest`/`Approved`** theo trạng thái thật, và một dòng cảnh báo dạng *"the guest's latest
message would change priced facts you corrected … The corrected trip and its price were kept"*. Nếu
thay vào đó bản sửa bị đảo lại và mất duyệt kèm câu đổ lỗi cho khách — đó là lỗi cũ, báo ngay.
(Đo trước khi sửa: đúng y hệt như vậy, trên `QT-1121-ANA-46717280`.)

### B1. Khách đổi số lượng giữa chừng (trong cùng một enquiry, **trước** khi publish)

Sau khi đã Approve ở kịch bản A (và đã làm B1b), nhắn tiếp từ điện thoại:

> Sorry, there are 4 of us

**Phải thấy trong studio** (tải lại trang): **giữ nguyên mã báo giá**, nhưng
`status` về `Priced — needs approval`, **mất duyệt**, có dòng cảnh báo *"The guest changed the trip
after it was priced…"*. Bấm Approve lại mới gửi được. Đây là điều cố ý: duyệt là duyệt cho **một
chuyến cụ thể**.

### B2. Reset là hết một enquiry

Nhắn tiếp:

> reset

**Phải thấy:** lời chào mới. Và trong studio: báo giá cũ **đã đóng** (tab *Archived*, ghi chú "Closed
when the guest restarted the conversation"). Nhắn một enquiry mới → **mã báo giá mới**, tên mới, không
`pricing`, không duyệt — **không** thừa hưởng gì của enquiry trước. (Đây là lỗi đã sửa: hôm trước một
báo giá đã duyệt còn hiện tên khách của enquiry sau.)

### B3. Nhân viên đổi chuyến

Trong studio màn 1: đổi một phòng sang `suite`, bấm **Save & get price**. Phải thấy giá được tính lại
**trên cùng một scenario** (nếu fixture đã quên scenario thì câu thông báo nói rõ là tính lại từ đầu) và
duyệt bị huỷ. Ở tab production **số không đổi** (fixture trả bản chụp) — nói thẳng; muốn thấy số đổi thì
làm ở tab sim.

---

## 2b. Đường sai — khi khách và nhân viên không đi đúng đường chuẩn

Khách và nhân viên không lúc nào cũng làm đúng kịch bản A. Mục này thử những gì xảy ra khi họ làm sai,
đổi ý, bấm hai lần, hoặc khi một thứ phía sau chết. Mỗi ca ghi **làm gì → phải thấy gì**, và một
trong hai dấu:

- ✅ đã đúng — chạy thấy khác thì là lỗi mới, báo ngay;
- ⚠️ **lỗi đã biết, chưa sửa** — ghi ở đây để bạn không bất ngờ khi gặp, kèm `file:dòng`. Đây cũng là
  danh sách việc còn lại trước khi mở cho khách thật. Ca ⚠️ **không chặn demo** miễn là kịch bản demo
  (`docs/live-demo-script.md`) không đi qua nó.

Đo ngày 2026-09-29 bằng cách đọc code + test, **chưa** chạy từng ca trên production. Chạy xong ca nào,
ghi kết quả và ngày vào bảng ở cuối mục 2b.

> `reset` (cả từ khoá nhắn WhatsApp lẫn route ở §0.4) là công cụ test của dev, không phải tính năng cho
> khách. Chạy nó **trước** mỗi ca như §0.4 là đúng; đừng chạy **giữa chừng** một ca, vì nó đóng báo giá
> đang mở — chính thứ bạn đang thử.

### C1. Phía khách (WhatsApp)

| # | Làm | Phải thấy |
|---|---|---|
| C1.1 | Hỏi thẳng `how much?` rồi `can we get a discount?` | ✅ bot không tự nêu giá, nói đội ngũ sẽ gửi báo giá. ⚠️ lớp chặn giá chỉ bắt `$` `₱` PHP USD cạnh một số — lọt `P3,500`, `11,200 a night`, `10% off` (`synthesis.ts:91-92`). **Đọc kỹ từng chữ** câu trả lời |
| C1.2 | Nhắn 3 tin liên tiếp rất nhanh | ✅ trả lời lần lượt, chỉ **một** báo giá trong studio |
| C1.3 | `I want to cancel my booking`, rồi `this is a complaint`, rồi `what is the wifi password?` | ✅ bot dừng, nói đã chuyển người; `/handoff` ghi đúng lý do (*Cancellation / complaint*, *Not a booking enquiry*). ⚠️ một tin **có URL** hoặc chữ `parking` / `restaurant` / `directions` cũng bị chuyển người, rồi bot im cho tới khi nhân viên bấm resume (`intent.ts:40-72`) |
| C1.4 | Nói mãi không chốt: `hmm` → `not sure yet` → `still thinking` → `maybe later` | ✅ sau 3 lượt cùng câu hỏi treo, bot dừng hỏi và chuyển người kèm danh sách còn thiếu (*Stuck — same questions open*) |
| C1.5 | Cho lịch lặn nằm ngoài kỳ ở (ở 20–22/11, nói lặn 25/11) | ✅ bot hỏi lại, kèm khoảng ngày ở |
| C1.6 | Gửi **ảnh**, rồi **voice note**, rồi sticker | ⚠️ **im lặng hoàn toàn**: webhook trả 200, không trả lời, không chuyển người, nhân viên không thấy dấu vết nào (`whatsapp.ts:269-292`). Khách Philippines hay gửi voice/ảnh chụp màn hình — đây là lỗi thật, không phải chuyện hiếm |
| C1.7 | **Sau khi đã nhận link**, nhắn `actually we are 3 now` — hoặc chỉ `thanks!` | ⚠️ tạo thêm **một báo giá mới trùng**; link cũ vẫn sống ở giá cũ; khách lại nghe *"preparing your quotation"*, không ai nói link cũ đã hết giá trị; studio có thêm một dòng không liên kết với bản đã publish (`quotationStore.ts:366-369`, `app.ts:838-842`). Tin nhân viên gửi từ studio **không** được ghi vào lịch sử bot, nên bot không biết có báo giá đã đi |
| C1.8 | Viết ngày kiểu tháng/ngày của Philippines: `10/12/2026`; rồi `October 10, 2027`; rồi một ngày đầy đủ đã qua như `01/09/2026`; rồi check-out **trước** check-in | ⚠️ có năm thì luôn đọc **ngày trước** (`10/12` thành 10 tháng 12); tên tháng đi kèm năm thì bỏ năm; ngày đầy đủ đã qua vẫn được nhận; khoảng ngược không tính được đêm nên bị tính mặc định 2 đêm mà enquiry vẫn coi là đủ (`dates.ts:128-176`, `quotationTool.ts:334`). **Đọc dòng tóm tắt bot đọc lại** — khách cũng chỉ có dòng đó để bắt lỗi |
| C1.9 | Mở link sau khi nhân viên huỷ; mở link **chưa publish**; mở một link bịa | ⚠️ trang "đã huỷ" không có số hay nút liên hệ; trang "đang chuẩn bị" có nút `wa.me/?text=` **không số** và còn hiện nút *Staff sign-in* cho khách; link bịa ra JSON thô `{"error":"not_found"}` (`app.ts:1330, 1357-1563`) |
| C1.10 | Nhắn bằng tiếng Nhật, rồi tiếng Hàn | ⚠️ tiếng Nhật được trả lời bằng **tiếng Trung** (bộ dò chỉ tìm chữ Hán); tiếng Hàn/Tagalog trả bằng tiếng Anh và ngày không đọc được nên bị hỏi lại đến khi dừng (`normalize.ts:72-84`, `dates.ts`) |
| C1.11 | Từ một số **không phải số test**, nhắn đúng `start over` hoặc `restart` | ⚠️ xoá thread và **đóng báo giá đang mở, kể cả bản nhân viên đã duyệt**, và gỡ thread khỏi `/handoff`; sau đó `/confirm` còn "hồi sinh" được bản đã đóng (`app.ts:241, 345-369`). Hướng sửa: chỉ nhận `reset` ở số nằm trong danh sách dev |

### C2. Phía nhân viên (studio)

| # | Làm | Phải thấy |
|---|---|---|
| C2.1 | Ở tab Preview, trỏ engine sai (hoặc rút mạng), bấm **Get price** | ✅ báo lỗi, bản ghi vẫn sửa được và bấm lại được. ⚠️ chữ vẫn là mã thô `timeout` / `unreachable` / `unexpected`; engine trả 409 hiện *"answered HTTP 409 without saying why"* |
| C2.2 | Gửi cho số không có mã nước (`0359…`) | ✅ *"Add the country code — 63 …, 84 …"*, không gửi gì |
| C2.3 | Gửi cho số hợp lệ nhưng chưa có trong danh sách test Meta | ✅ *"This number isn't on the WhatsApp test list yet…"*; badge **không** đổi sang `Sent to guest` |
| C2.4 | Sửa chuyến **sau khi đã Approve** | ✅ tự bỏ duyệt, phải Approve lại |
| C2.5 | Sửa bất cứ gì **sau khi đã Publish** | ✅ bị từ chối, báo trang đã đóng băng |
| C2.6 | Mở `QT-1010-SKY` rồi bấm Publish | ✅ từ chối `seeded_fixture`, có câu giải thích |
| C2.7 | Đổi **ngày nhận/trả phòng** ở ô thông tin liên hệ rồi Approve | ⚠️ ngày mới đi ra WhatsApp và trang khách **cùng giá của ngày cũ**; duyệt vẫn giữ vì đường lưu liên hệ không đụng vào chuyến đã tính giá (`app.ts:282, 1812`) |
| C2.8 | **Bấm đúp** *Create link & send* | ⚠️ nút của bước 4 chỉ bị khoá sau khi lệnh publish chạy xong, nên click thứ hai bắt đầu một publish nữa: có thể có 2 bản đóng băng phía khách và **2 tin nhắn** (`quotationStore.ts:2709-2712`, `app.ts:2414`). **Bấm một lần và chờ** |
| C2.9 | Mở **cùng một báo giá ở hai tab**, sửa ở cả hai, lưu lần lượt | ⚠️ tab lưu sau đè tab trước, không cảnh báo; bấm Approve ở tab cũ có thể duyệt một giá mà tab kia mới tính |
| C2.10 | **Huỷ** một báo giá đã publish; rồi thử bấm *Save & get price* trên một báo giá chưa publish đã huỷ | ⚠️ link phía app khách **vẫn sống và đặt được** (chỉ trang `/q/` của mình trả 410); bản chưa publish đã huỷ bị **hồi sinh** vì Save/Approve không kiểm trạng thái huỷ |
| C2.11 | Ghi nhận tiền cọc với số `0`, hoặc trên báo giá đã huỷ / chưa từng gửi | ⚠️ nhận hết, còn báo *"Reservation confirmed"* dù chưa có folio nào (`app.ts:1946-1977`) |
| C2.12 | Để phiên đăng nhập hết hạn (8 giờ) giữa lúc đang sửa chuyến | ⚠️ không chuyển trang, không nhắc lưu; đăng nhập lại là mất phần chưa lưu. Có lỗi máy chủ 500/504 thì màn hình hiện dòng phân tích JSON thô thay vì câu tiếng Anh |

### C3. Phía hệ thống — chỉ đọc, **đừng phá thử trên production**

- **Redis lỗi một lần** làm hỏng mọi route báo giá của instance đó tới khi nó khởi động lại, vì lời hứa
  "khởi tạo" bị từ chối được lưu lại mãi (`quotationStore.ts:120-121`), và các lệnh Redis không có giới hạn
  thời gian.
- **`WHATSAPP_APP_SECRET` sai** → mọi tin vào bị trả 401 mà **không một dòng log** (`app.ts:551-555`); Meta
  thử lại rồi có thể tắt webhook. Không có cảnh báo nào.
- **Token Meta hết hạn (mã 190) lúc trả lời khách** → khách nhận im lặng: thread không bị park, không có
  câu xin lỗi, không vào `/handoff`; chỉ có một dòng `console.error` (`app.ts:950-988`).
- **Gửi sau 24 giờ**: lỗi 131047 đồng bộ được giải thích rõ, nhưng không có đường gửi bằng template, và nếu
  Meta báo lỗi muộn qua webhook trạng thái thì webhook bỏ qua — studio vẫn ghi `Sent to guest`.

### Bảng kết quả mục 2b (điền khi chạy)

| Ca | Ngày | Kết quả | Ghi chú |
|---|---|---|---|
| | | | |

**Chặn demo nếu:** C1.1 có con số tiền hoặc lời giảm giá; trang khách hiện lời hứa giữ phòng, tiền cọc tự
chia hoặc ô đổi tiền tệ; hoặc kịch bản A không ra được một link mở được. Các ca ⚠️ khác **không** chặn
demo nếu bạn không đi qua chúng.

---

## 3. Những câu phải nói thật khi demo

1. **Bot không báo giá, không gửi link.** Giá chỉ tới tay khách sau khi **một người** duyệt và gửi.
2. **Giá là của engine, không phải của mình.** Con số ₱31.200 là câu trả lời của engine; sửa chuyến thì
   payload + bản đóng băng đổi, còn fixture thì trả lại bản chụp nên số có thể đứng yên.
3. **Link do app của quý khách phát hành.** Và: *bản demo đó chưa có database nên link chỉ sống khi
   request rơi đúng instance; bản thật chạy Odoo thì bền.* Khi link đó không mở, khách nhận **bản sao
   cùng revision trên trang của mình** (`/q/<slug>`), studio nói rõ vì sao — không có chuyện gửi link
   chết mà báo thành công.
4. **Bot không tự bịa.** Nếu model viết câu sai (giá, chữ "confirmed", loại phòng khác), câu đó bị chặn
   và thay bằng bản do code dựng.

Kịch bản demo đầy đủ theo phút, kèm những gì **không** được làm và câu trả lời thật khi bị hỏi ngược:
`docs/live-demo-script.md`.

---

## 4. Sự cố thường gặp

| Hiện tượng | Nghĩa | Làm gì |
|---|---|---|
| Trang khách "not valid or has expired" | Fixture của khách mất token | Bấm **Send the message** một lần nữa: route kiểm link, thấy chết thì đặt `mirrorUrl` và gửi **bản sao của mình** — khách nhận link mở được ngay. Ô link trong studio đổi sang `/q/<slug>` |
| Ô link trong studio là `/q/<slug>` chứ không phải `…/quote/<token>` | Lần gửi đó link của khách đã chết, nên khách được gửi bản sao cùng revision | Không phải lỗi; studio ghi lý do ngay dưới ô link. Muốn khách đọc app của họ thì phải publish lại lúc link còn sống |
| Studio: badge `Link ready — not sent` | Đã tạo link nhưng **chưa** gửi tin cho khách | Bấm **Send the message** — badge chỉ đổi sang `Sent to guest` sau khi gửi thật |
| Studio: *"this price did not come from the booking engine…"* | Record có giá sample nhưng chưa có scenario | Vào **màn 2 → Get price**, rồi Approve lại |
| Studio: *"the engine no longer had this quotation, so it was priced again from the trip on screen"* | Fixture đã quên scenario của record (bộ nhớ một instance), nên **Save & get price** tự tạo scenario mới trong cùng session | Không phải lỗi — đọc câu đó rồi đi tiếp. Bản đóng băng cũ không còn, nên **Version** trên link khách bắt đầu lại từ 1 |
| Studio: *"Saved the guest details, but not the trip: unexpected not found"* | Cùng nguyên nhân trên, nhưng bản deploy **trước** 2026-09-28 (chưa có đường tự tạo lại) | Bấm **Save & get price** lần nữa — bản hiện tại tự tính lại; nếu vẫn lỗi thì ghi lại thời điểm |
| Bot im lặng, hoặc trả lời *"something went wrong on our side"* | Gemini free tier 429 (15 req/phút) | Đợi ~1 phút rồi nhắn lại |
| Tin không tới điện thoại, webhook trả `failed:1` | Meta từ chối (`#131030` = số chưa có trong danh sách test) | Thêm số vào *To* trong Meta App |
| Muốn chạy lại từ đầu | — | Mục 0.4 (reset) rồi bắt đầu lại từ tin 1 |

---

## 5. Sau khi test xong

Xoá dữ liệu test khỏi queue để buổi demo sạch:

```powershell
# đóng báo giá test (giữ record, chỉ rời khỏi queue đang làm việc)
$t = (Get-Content .env.local | Where-Object { $_ -match '^STAFF_ACCESS_KEY=' }) -replace '^STAFF_ACCESS_KEY=','' -replace '"',''
Invoke-RestMethod -Method Post -Uri "https://technext-edge-casa-bff.vercel.app/v1/quotes/<QUOTE_ID>/cancel" -Headers @{ "x-verify-token" = $t }
```

Khoá đi trong **header**, không nằm trên URL — URL ở lại trong lịch sử trình duyệt, log máy chủ và ảnh
chụp màn hình. Cũng vì vậy, đừng dán lệnh này vào chat.

Báo giá đã publish thì **không sửa được nữa** (link khách đang giữ) — muốn demo lại từ đầu thì tạo
enquiry mới, đừng cố sửa bản đã gửi.
