# Bộ giả lập estimator/Odoo — vận hành và đường ra thật

**Quyết định (lead, 26/09/2026):** *"trước khi có key từ Phillip cứ dựng giả lập, vì khi nào đảm
bảo mới giao ra key được."* Key Odoo chỉ được giao khi mọi thứ đã chắc, nên toàn bộ luồng phải
chạy được **không cần một credential Odoo nào**, và hôm có key thì đổi cấu hình, không sửa code.

## Một cổng, hai đầu

`bff/src/estimatorPort.ts` là cổng duy nhất tới engine giá/đặt chỗ:

| `ESTIMATOR_MODE` | Đầu nào | File |
|---|---|---|
| không đặt, hoặc `simulated` (**mặc định**) | Máy tính giá chạy trong tiến trình | `bff/src/simulatedEstimator.ts` |
| `remote` | BFF của khách (rồi tới Odoo) | `bff/src/estimatorClient.ts` |

Mặc định là `simulated`, và đó là chủ ý: một deployment quên đặt biến môi trường **không** được
phép vô tình gọi vào một host có Odoo mà không có credential. Muốn dùng engine thật là một hành
động có ý thức.

## Vì sao bộ giả lập đáng tin để demo

Nó **trả đúng shape của khách** (`contracts/odoo/examples/compute.*.json`): `quotes[]` từng khách
với `lines[]`, `catRev`, `kpis.revenue`, `presence`, `covers`, `dayPlans`, `gwin`. Không phải một
shape tự chế. Studio và trang khách đọc đúng field của hợp đồng thật ngay từ bây giờ, nên khi
Odoo thật vào thì chỉ đổi nơi ra số, không đổi cách hiển thị.

Và nó **tái tạo chính xác bản ghi đã chụp**: cặp đôi trong `compute.retail-couple.json` ra đúng
₱31,200 — phòng ₱15,200 / ăn ₱6,000 / lặn ₱10,000, `rpgn` 7,800, `covers` giống, cảnh báo
"Sat, Nov 21: no boat picked yet for Ana." giống. Đó là test hợp đồng
(`ai/test/simulatedEstimator.test.ts`), và là thứ khiến giá local đủ tin để demo:
đó là **số học của khách**, không phải của mình.

Các luật đã cài (nguồn: `rates.ts`, field guide + compute đã chụp):
- phòng: giá **mỗi đêm mỗi phòng** theo số người ở đêm đó, rồi chia cho số người cùng phòng;
- lặn: mỗi diver mỗi ngày, theo bậc của **số diver ra biển ngày đó**;
- ăn: mỗi người mỗi ngày, **không bao giờ** giảm theo vai;
- chiết khấu đối tác: **30% chỉ trên phòng**.

## Khi có key thì đổi gì

Không sửa code. Đặt:

```
ESTIMATOR_MODE=remote
ESTIMATOR_BASE_URL=https://<bff-của-khách>
```

và phía khách bật `FIXTURE_MODE=0` + key Odoo. Sau đó:

1. Xác nhận `GET /v1/quotes/estimator-status` trả `mode: "odoo"` (badge trong studio hết "fixture").
2. Nhãn `sample` / banner "SAMPLE DATA" tự tắt khi engine trả `sample: false`.
3. `POST /v1/quotes/:id/submit` chuyển sang gọi `POST /api/estimates/:id/submit` thật — nhưng chỉ
   khi quotation có `estimatorId` + `estimatorSeq`; thiếu thì route trả `not_configured` thay vì
   đoán. Đây là việc còn lại khi có key: lưu scenario id của họ vào draft.

## Bất biến an toàn (giữ nguyên ở cả hai chế độ)

- Không giữ credential Odoo ở đâu trong repo này; không gọi thẳng `/v1/*` của Odoo.
- **Không bao giờ** đặt `ODOO_SUBMIT_ENABLED=1` trong `.env.local` (mặc định tắt).
- Bộ giả lập luôn gắn `sample: true` + `mode: "fixture"`. Một giá giả bị trình bày như giá thật là
  thất bại duy nhất mà cả cổng này tồn tại để chặn.
- Đặt chỗ giả **không tạo folio nào**: trả `{success: true, folio_id: null, order_ids: null}` —
  đúng shape fixture tối thiểu theo spec, và trang Booking hiện "Folio number pending".

## Cái gì KHÔNG được giả lập

- **Giá thật và folio thật.** Số ở đây là giá local xấp xỉ từ rate card chụp 17/09; `rates.ts`
  đã ghi rõ nó sẽ lệch ngay khi Phillip đổi giá.
- **Cost / profit / margin.** Cả hai chế độ đều để `null` — cost chỉ có với staff key thật.

## Câu trả lời được lưu trên quotation

`ai/src/pricing.ts` (`normalizePricing`) đọc câu trả lời của engine thành dạng
trang vẽ được, và `POST /v1/quotes/:id/sync-estimate` **lưu nó vào draft** (`quotation.pricing`)
chứ không chỉ hiển thị. Hai lý do:

1. Một quotation mở lúc nào cũng phải nghĩa như nhau. Giá tính theo thời điểm mở trang thì không
   còn là báo giá.
2. Thẻ từng khách, Ops Sheet và bảng so sánh Agent View đều đọc từ bản ghi đó — nên chúng không
   thể lệch nhau, và không thể lệch với tổng tiền phía trên.

`normalizePricing` đọc **phòng thủ** có chủ ý: fixture của khách trả `warnings` dạng object khi chỉ
có một cảnh báo (mảng mới là dạng tổng quát), `catRev` có bộ key mở, và một response hoàn toàn có
thể không có `quotes`. Trường thiếu ở lại **null**, không bao giờ thành 0 — số 0 trên báo giá đọc
thành "miễn phí".

## Ba trang đọc từ cùng một câu trả lời

| Trang | Đường dẫn | Có tiền? |
|---|---|---|
| Studio (staff/agent/guest) | `/quotes/:id` | Có — thẻ từng khách, tổng, và bảng retail-vs-net khi engine trả `retail_model` |
| Ops Sheet (in được S) | `/quotes/:id/ops` | **Không một đồng nào** — Front desk · Housekeeping · Dive centre · Kitchen · Transfers, mỗi ngày một tờ |
| Trang khách | `/q/:slug` | Có — bản khách nhìn, kèm trạng thái đặt chỗ |

Studio gắn `data-role` theo phiên đăng nhập: vai `guest` **không** thấy các thanh thao tác của staff
(định giá, gửi đặt chỗ, gửi WhatsApp) — trước đây vai chỉ đổi một dòng chữ.
