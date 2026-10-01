# Todo — trước demo và trước khi port sang team estimator

Lập 2026-10-01, sau commit `7b6c316` (đã push). Đánh dấu `[x]` khi xong.

## A. Kiểm cấu trúc technext-edge (làm lại trước demo)

Kết quả lần kiểm 2026-10-01: tất cả xanh.

- [x] `npm run verify`: ranh giới (contracts <- ai <- bff), typecheck, test (contracts 47, ai 350, bff 602)
- [x] `npm run mirror:check`: `ai/` và `contracts/` giống từng byte repo team (28 + 61 file)
- [x] `process.env` chỉ còn trong `bff/src/env.ts` (có test giữ)
- [x] Không còn tham chiếu Anthropic trong code, cấu hình, `.env.example`
- [ ] `npm run upstream:check`: đọc commit mới bên team trước khi demo
- [ ] `vercel build` local còn chạy được sau lần sửa cuối (lần gần nhất: ok)
- [x] Trang `docs/notes/structure-compare.html` đã commit (cập nhật theo cây thư mục mới)

## B. Deploy và kiểm tay (bạn làm)

- [x] `vercel deploy --yes` (preview, commit `ba5dcc1`, READY); [ ] `vercel alias set <url> <alias -sim>`
- [ ] Kiểm commit của bản deploy: `vercel api /v13/deployments/<url>` -> `meta.githubCommitSha` = `7b6c316` hoặc mới hơn
- [ ] `GET /` -> 302 `/quotes`; `/quotes`, `/test`, `/console` chưa đăng nhập -> `/login`; `/docs` -> 404
- [ ] `/quotes` mở được khi store rỗng (trang "No enquiries yet")
- [ ] Đặt `ADMIN_ACCESS_KEY` và `SETTINGS_ENCRYPTION_KEY` trên Vercel, rồi mở `/admin/ai`
- [ ] Gửi một tin WhatsApp thử, xem bundle chạy được (zod 4, import `.ts`, rewrite catch-all)
- [ ] Chạy `npx tsx bff/scripts/capacity-e2e.ts sim` và `remote`
- [ ] Kịch bản test A/B/C trên bản `-sim`
- [ ] Xoá tay bản ghi `QT-1010-SKY` cũ trong Upstash (studio không còn tạo, nhưng nó được bảo vệ khỏi dọn dẹp)

## C. Repo team (PR #5)

- [ ] Push nhánh: `cd /e/casa-ai-fix && git push origin feat/ai-layered-fix` (commit `6f5eab0`: bỏ Anthropic)
- [ ] Sửa dòng README team "Anthropic + Odoo" cho khớp flexible model
- [ ] Đánh số lại flow kênh AI: F08 ở `main` là hồ sơ đại lý -> dùng F11; đổi Q-021, D-064, L-044 trùng mã
- [ ] `git merge origin/main` vào nhánh PR, giải xung đột: ledgers, `bff/.env.example`, `scripts/suites.json`
- [ ] Đóng PR #2 và #4 của nhánh cũ
- [ ] Hỏi Anthony: Q-021 (tin khách thật đi qua model nào), có bật `EXTRACT_ENABLED` không
- [ ] Sau merge: đổi `AI_REF` trong `tools/ops/mirror-check.mjs` sang `origin/main`, cập nhật mốc trong `docs/notes/upstream-provenance.md`

## D. Phần plan chưa làm

- [x] Tách `auth/` thành `keys`, `session`, `rate-limit`, `guards`; `staffSession`/`adminGuard` ra khỏi `app.ts` (đợt 1)
- [x] Route thành sub-app `Hono` (`app.route()`); tách `estimator/`, `channels/whatsapp/`, `ai/`
- [x] Gom `money` (hai hàm khác nhau có chủ đích) và helper script editor; `api/index.ts` export `PATCH`, `DELETE`
- [x] Gom `bff/test/` theo thư mục nguồn
- [x] Xoá `tools/scratch/`; media `public/` sang `docs/site/media/` (đợt 1). `tools/live-eval/` ở lại: `ai/` là bản sao của team, thêm thư mục vào sẽ làm lệch mirror
- [ ] Cần duyệt riêng (đổi hành vi): đổi cookie `casa_gais_session` -> `casa_staff_session` (đọc cả tên cũ 8 giờ); `/test` chưa đăng nhập trả 401 thay vì 302

## D2. Đợt 2 (ngoài `bff/`)

- [x] `tsconfig.studio.json` -> `tsconfig.bff.json`, có ghi chú; CI nêu đúng 3 workspace; `.claude/` vào `.gitignore`
- [x] Xoá ví dụ mẫu archify `example-trace-*`; `docs/demo/` -> `docs/archive/demo-2026-09/`; ghi chú phase1/2 và `lead-extractor-duplication` vào `docs/archive/notes/`; `anthony-decisions` bỏ chính sách Anthropic
- [x] `secretBox` sang `bff/src/crypto/`; `deps.ts` cho `app.ts` (78 dòng)
- [ ] Hỏi Lead: video 17 MB trong git (bỏ, LFS hay để nguyên); tách file lớn trong `ai/` (làm ở repo team); tách `views/editor/client.ts`, `estimator/simulated.ts`, `estimator/client.ts`

## E. Port sang team (xem `port-to-team-repo.md`)

- [ ] Kênh WhatsApp -> `bff/src/channels/whatsapp/`, store hội thoại Redis -> Postgres (migration trong `supabase/`)
- [ ] Handoff inbox
- [ ] Dashboard AI (chỉ nếu Anthony muốn)
- [ ] `toInquiryLead` -> `bff/src/inquiry/` (chờ B-043 từ Phillip)
- [ ] Nâng độ chặt TypeScript của `bff/` lên khuôn team; đổi import tương đối sang `@casa/*` nếu Vercel bundle chịu được
- [ ] Không port: studio, `quote/`, `simulatedEstimator`, ops sheet, `/q/:slug`, đăng nhập demo

## F. Ghi nhớ

- Dependabot báo 15 lỗ hổng (5 critical) trên `main` sau lần push; chưa rõ có từ trước hay do lockfile mới dựng lại. Xem https://github.com/TechNextSG/technext-edge/security/dependabot
- Vercel build in ra cảnh báo type (`ProcessEnv` với `AiEnv`, import không dùng) nhưng không chặn build.
- Sơ đồ `docs/diagrams/repo-structure.html` đã qua `deliver`, chưa chạy `visual-check`.
