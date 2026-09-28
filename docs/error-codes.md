# Mã lỗi của studio — hợp đồng giữa server và trang `/quotes/:id`

Trang studio gọi 6 route ghi (`PUT /v1/quotes/:id`, `/confirm`, `/trip`, `/sync-estimate`, `/publish`,
`/send-whatsapp`) và cả 6 đều có thể **từ chối**. Từ chối không phải lỗi: mỗi mã dưới đây là một câu
trả lời cho một câu hỏi hợp lệ ("bấm Approve khi chưa có giá thì sao?").

Tài liệu này tồn tại vì hai lý do, và cả hai đều đo được:

1. **Trang phải in ra câu người đọc được.** Server trả `{ ok: false, reason: "<mã>", detail: "<câu
   tiếng Anh>" }` (một số route cũ dùng `error` thay `detail` — trang đọc `data.detail || data.error`).
   Không được để JSON/HTML thô của Meta hay của engine lọt lên màn hình: xem `refusalDetail()`
   (`estimatorClient.ts`) và `explainMetaError()` (`whatsapp.ts`).
2. **Mã phải ổn định.** Trang đổi câu chữ, server đổi câu chữ; mã thì không, nên nhánh xử lý của
   trang bám vào `reason` chứ đừng bám vào câu.

## Báo giá, duyệt, publish

| `reason` | HTTP | Route | Nghĩa | Việc phải làm |
|---|---|---|---|---|
| `not_priced` | 409 | `/confirm`, `/publish` | Báo giá chưa có giá từ engine | Bấm **Price with the Estimator BFF** trước |
| `trip_changed` | 409 | `/confirm` | Trip trong trang khác trip **đã được định giá** (`fields` = đường dẫn trường) | Price lại rồi mới Approve |
| `no_trip` | 409 | `/trip`, `/publish`, `/submit` | Record chưa có `bffTrip` (nháp từ `lineItems`) | Không sửa/gửi được; tạo báo giá từ hội thoại |
| `invalid_trip` | 422 | `/trip` | Payload không khớp `BffTrip` (`fields`) | Lỗi lập trình ở trang — không phải lỗi nhân viên |
| `trip_not_priceable` | 422 | `/trip` | Vi phạm 6 nhóm ★ của `fillTrip` (`issues`) | Sửa đúng trường được nêu |
| `already_shared` | 409 | `/trip`, `/sync-estimate`, `/publish` | Đã publish: link khách đang giữ phải bất động | Tạo báo giá mới thay vì sửa bản đã phát |
| `not_approved` | 409 | `/publish`, `/send-whatsapp` | Chưa duyệt | Bấm **Approve** |
| `not_published` | 409 | `/send-whatsapp` | Chưa có link khách | Bấm **Publish Link** trước (tin nhắn chỉ chở link) |
| `sample_not_acknowledged` | 409 | `/publish` | Giá đang là sample, chưa tick xác nhận | Tick "I have checked this sample price" ở khung **Send to the guest** (khi đó cả hai nút tạo link mới bật) |
| `already` | 409 | `/submit` | Đã có `submission` cho báo giá này | Không đặt lại (tránh folio thứ hai) |
| `wrong_place` | 409 | `/submit` | Chế độ `remote`: chỗ đặt là app của khách, không phải studio | Mở link khách |
| `phone_missing` | 400 | `/send-whatsapp` | Thiếu số | Nhập số kèm mã quốc gia |
| `phone_invalid` | 400 | `/send-whatsapp` | Số không hợp lệ (bắt đầu `0`, quá ngắn/dài) | Sửa số |
| `send_failed` | 502 | `/send-whatsapp` | Meta từ chối; câu đã được dịch từ mã của Meta | Đọc câu, xử lý theo nó (vd 131030 = số chưa có trong danh sách test) |
| `link_unverified` | 502 / 409 | `/publish`, `/send-whatsapp` | Link đã mint nhưng **không mở được** (`GET /api/share/<token>` không trả 200) | Bấm tạo link lại. Đây là lỗi phía app báo giá của khách (xem `docs/upstream-note-bff-vercel-deploy.md`: deployment fixture giữ token trong bộ nhớ **một instance**, nên link có thể 404 ngẫu nhiên) |
| `unauthorized` | 401 | mọi route ghi | Thiếu/hết phiên staff | Đăng nhập lại |
| `not_found` | 404 | mọi route theo `:id` | Không có báo giá đó | Bấm về `/quotes` |

## Mã đến từ engine (đi kèm các route ở trên)

`estimatorClient.ts` dịch câu trả lời của BFF khách thành 6 category (`EstimatorFailure`), để studio
không phải đọc `issues[]` của họ:

| `reason` | HTTP | Nghĩa |
|---|---|---|
| `not_configured` | 503 | Thiếu `ESTIMATOR_BASE_URL`, hoặc báo giá chưa có scenario id |
| `unreachable` / `timeout` | 502 | Không gọi được engine (mạng, DNS, quá hạn) |
| `rejected` | 422 | Engine từ chối payload — **lỗi của mình**, không phải của khách (`fields`) |
| `no_snapshot` | 409 | Chưa `commit` bản nào, nên không có revision để share |
| `unexpected` | 502 | Engine trả về thứ không nhận ra (kể cả trang HTML — thường là sau SSO) |
| `closed` / `busy` / `unknown` | 409 / 503 / 502 | Chỉ ở `/submit`: engine đóng, đang bận, hoặc **có thể đã tạo folio** — `unknown` thì tuyệt đối không retry mù |

## Xoá record — `POST /v1/quotes/cleanup-duplicates`

Route duy nhất trong sản phẩm **xoá** một record nghiệp vụ, nên nó có luật riêng:

- **Dry by default.** Không có `{ confirm: true }` thì không xoá gì; câu trả lời liệt kê
  `wouldRemove`, `refused`, `notFound`.
- **Hai cách chỉ định**: không tham số → luật trùng lặp (`duplicateQuotationIds`: giữ bản mới nhất
  theo số điện thoại); hoặc `{ ids: ["QT-…"] }` → xoá đúng những record được nêu (dùng cho rác không
  trùng với gì: record probe, nháp của lần test tay).
- **Ba thứ không bao giờ bị xoá**, dù có nêu tên (`deletableByCleanup`): record **đã publish** (khách
  có thể đang giữ link), record **đã được sửa** (`staffEdits` — công của một người), và **record seed**
  (`seedVersion` — thứ màn hình lạnh hiển thị). Chúng xuất hiện trong `refused`, không im lặng bỏ qua.

## Ranh giới "enquiry" (không có mã, nhưng đổi trạng thái record)

Không phải lỗi, nhưng trang cần biết vì nó đổi thứ đang hiển thị:

- Guest nhắn **`reset`** → báo giá đang mở của số đó bị **đóng** (`status: cancelled`, kèm ghi chú
  trong `staffAlerts`). Enquiry tiếp theo có record **mới** — tên, giá, duyệt, session đều không đi
  theo. Xem `closeEnquiryQuotation()` (`app.ts`) và KB11 (`docs/whatsapp-manual-test.md`).
- Trong **cùng một enquiry**, guest đổi bất cứ thứ gì giá phụ thuộc vào → giữ `quoteId`, nhưng
  `status` về `pending_hono_review`, `pricing` = `null`, `aiConfirmedReply` bị xoá, và `staffAlerts`
  ghi lý do. Xem `pricedFactsChanged()` (`tripDiff.ts`).
