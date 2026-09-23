import fs from 'node:fs';

const template = fs.readFileSync('docs/extractor-pod-showcase.html', 'utf8');

// We need to customize:
// 1. Page Title
// 2. Section 1 header & panels
// 3. Section 2 header & JS data (PHASES, NODES, EDGES)

// Let's create the customized content
let html = template;

// 1. Page Title
html = html.replace(
  '<title>Extractor Pod Pipeline Showcase — TechNext</title>',
  '<title>Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng WhatsApp — Casa Escondida</title>'
);

// 2. Section 1 Kicker, Header, Lede
const oldHeader = `        <section class="section" id="overview">
            <span class="kicker">TechNext · Casa Escondida Extractor Pod</span>
            <h1>Extractor Pod <span class="thin">— black-box overview</span></h1>
            <p class="lede">One AI reading per turn, wrapped in deterministic code that re-checks every number and
                date before it can reach a quotation. A guest's WhatsApp message goes in on the left; a structured
                booking and a safe reply come out on the right. Section 2 opens the box, node by node.</p>`;

const newHeader = `        <section class="section" id="overview">
            <span class="kicker">TechNext · Casa Escondida · Trợ Lý Đặt Phòng WhatsApp</span>
            <h1>Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng <span class="thin">— Dành Cho Lead</span></h1>
            <p class="lede">Bot đọc tin nhắn khách bằng ngôn ngữ tự nhiên (Anh · Việt · Trung), rút ra thông tin đặt phòng, hỏi nốt phần thiếu, rồi bàn giao cho nhân viên chốt giá. Odoo vẫn giữ giá, hoá đơn và phòng — phần này chỉ đứng ngoài, nói chuyện với khách. Dưới đây là tình hình thật và việc cần làm tiếp (23/09/2026 · không cần đọc code).</p>`;

html = html.replace(oldHeader, newHeader);

// 3. Overview Panel 1, 2, 3
// Find the content inside <div class="overview"> ... </div> before Section 2
const oldOverviewRegex = /<div class="overview">[\s\S]*?<\/div>\s*<\/section>\s*<!-- =* SECTION 2/;

const newOverview = `<div class="overview">

                <!-- PANEL 1: INPUTS · ĐANG Ở ĐÂU -->
                <div class="panel">
                    <div class="panel-title"><span class="dot"></span>Inputs · Đang ở đâu</div>
                    <h2>Hiện trạng thật 4 mảng hệ thống</h2>
                    <p class="sub">Trạng thái vận hành thực tế — nhìn thẳng sự thật, không làm đẹp số.</p>
                    <ul class="input-list">
                        <li>
                            <span class="glyph" aria-hidden="true" style="background:var(--tool-soft);color:var(--tool);">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </span>
                            <div>
                                <div class="lbl" style="display:flex;justify-content:space-between;align-items:center;">
                                    <span>Đọc hiểu tin nhắn khách</span>
                                    <span style="font-size:10px;text-transform:uppercase;color:var(--tool);font-weight:700;background:var(--tool-soft);padding:1px 6px;border-radius:4px;">Ổn</span>
                                </div>
                                <div class="desc">Tự do Anh · Việt · Trung, kể cả "thứ 7 tuần sau". Khi không chắc thì hỏi lại chứ không đoán. Đã kiểm tra nghiêm và đang sạch.</div>
                            </div>
                        </li>
                        <li>
                            <span class="glyph" aria-hidden="true" style="background:var(--accent-soft);color:var(--accent);">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="12" y1="8" x2="12" y2="12"></line>
                                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                </svg>
                            </span>
                            <div>
                                <div class="lbl" style="display:flex;justify-content:space-between;align-items:center;">
                                    <span>Cách nói chuyện</span>
                                    <span style="font-size:10px;text-transform:uppercase;color:var(--accent);font-weight:700;background:var(--accent-soft);padding:1px 6px;border-radius:4px;">Cần thước đo</span>
                                </div>
                                <div class="desc">Đã bỏ mẫu cứng, cho AI viết giọng lễ tân trên dữ liệu kiểm chứng. Đúng hướng nhưng chưa có cách chấm điểm xem có thật sự tự nhiên hơn không.</div>
                            </div>
                        </li>
                        <li>
                            <span class="glyph" aria-hidden="true" style="background:#FCEBEB;color:#C0182F;">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
                                    <line x1="12" y1="8" x2="12" y2="12"></line>
                                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                </svg>
                            </span>
                            <div>
                                <div class="lbl" style="display:flex;justify-content:space-between;align-items:center;">
                                    <span>Quy trình lên production</span>
                                    <span style="font-size:10px;text-transform:uppercase;color:#C0182F;font-weight:700;background:#FCEBEB;padding:1px 6px;border-radius:4px;">Sửa ngay</span>
                                </div>
                                <div class="desc">Bản sửa lỗi tính tiền gói lặn xong từ hôm qua nhưng production chưa có — đẩy code lên kho chung chưa tự sync máy chủ thật.</div>
                            </div>
                        </li>
                        <li>
                            <span class="glyph" aria-hidden="true" style="background:var(--trigger-soft);color:var(--trigger);">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </span>
                            <div>
                                <div class="lbl" style="display:flex;justify-content:space-between;align-items:center;">
                                    <span>Tính giá & xuất báo giá</span>
                                    <span style="font-size:10px;text-transform:uppercase;color:var(--trigger);font-weight:700;background:var(--trigger-soft);padding:1px 6px;border-radius:4px;">Chờ người</span>
                                </div>
                                <div class="desc">Cấu trúc dữ liệu Odoo chưa chốt, nên cố ý chưa viết dòng code nào nối Odoo để tránh rủi ro đập đi xây lại.</div>
                            </div>
                        </li>
                    </ul>
                    <span class="arrow right" aria-hidden="true">→</span>
                </div>

                <!-- PANEL 2: CENTER BLACK-BOX · BỘ ĐẾM & BÓC TÁCH NGUYÊN NHÂN -->
                <div class="panel blackbox">
                    <div class="panel-title"><span class="dot"></span>Thực trạng & Bóc tách nguyên nhân</div>
                    <h2>Đo rất kỹ không bịa — Chưa từng đo tự nhiên</h2>
                    <p class="sub">Lead nhận xét bot "cứng" — bản chất là 3 nguyên nhân riêng biệt cần 3 cách xử lý khác nhau.</p>

                    <div class="counters">
                        <div class="counter">
                            <div class="num" data-count="0">0</div>
                            <div class="lbl">% Bịa Dữ Liệu (Factual)</div>
                            <div class="sub">Đo trên 30 kịch bản ngặt nghèo</div>
                        </div>
                        <div class="counter">
                            <div class="num" data-count="230">0</div>
                            <div class="lbl">Bài Test Xanh 100%</div>
                            <div class="sub">Regression suite tự động mỗi commit</div>
                        </div>
                        <div class="counter">
                            <div class="num" data-count="3">0</div>
                            <div class="lbl">Nguyên Nhân "Cứng"</div>
                            <div class="sub">Dùng từ · Hỏi sai chỗ · Khuôn ô</div>
                        </div>
                        <div class="counter">
                            <div class="num" data-count="2">0</div>
                            <div class="lbl">Việc Cần Lead Hỗ Trợ</div>
                            <div class="sub">Thúc schema Odoo & Xin 30 tin thật</div>
                        </div>
                    </div>

                    <p class="box-sum"><b>Bóc tách 3 nguyên nhân:</b> (1) <i>Dùng từ:</i> Đã sửa bằng giọng lễ tân. (2) <i>Hỏi lại thứ khách vừa nói:</i> Chưa sửa — câu chữ mượt không cứu được, phải sửa ở chỗ <b>quyết định hỏi gì</b>. (3) <i>Khuôn dữ liệu:</i> Ý khách phong phú hơn ô trống — chấp nhận chuyển nhân viên đọc phần phức tạp. <b>Chưa ai chấm điểm tự nhiên lần nào:</b> Cần 30 tin nhắn thật từ Eloa để dựng thước đo.</p>

                    <div class="models">
                        <span class="agent-pill">Gemini 3.1 Flash-Lite</span>
                        <span class="agent-pill">DeepSeek V3</span>
                        <span class="agent-pill">Code-Verified Facts</span>
                        <span class="agent-pill">Concierge Voice Engine</span>
                    </div>

                    <span class="arrow right" aria-hidden="true">→</span>
                </div>

                <!-- PANEL 3: OUTPUTS · KẾ HOẠCH HÀNH ĐỘNG -->
                <div class="panel">
                    <div class="panel-title"><span class="dot"></span>Outputs · Kế hoạch hành động</div>
                    <h2>Lộ trình ưu tiên phân định rõ ràng</h2>
                    <p class="sub">Tách bạch việc team tự chủ làm ngay và mắt xích phụ thuộc bên ngoài.</p>
                    <div class="out-list">
                        <div class="out-card" style="border-left:3px solid var(--tool);">
                            <div class="head">
                                <span class="tag" style="background:var(--tool-soft);color:var(--tool);">Làm ngay — không chờ ai</span>
                                <span class="ext">4 tasks</span>
                            </div>
                            <div class="desc">
                                <b>1.</b> Đưa bản sửa tính tiền lên prod & rà soát hotfix tồn.<br>
                                <b>2.</b> Thêm lớp đối chiếu con số/ngày trong câu AI viết với dữ liệu gốc.<br>
                                <b>3.</b> Sửa Nguyên nhân 2: Khách nói phức tạp thì ghi nhận & chuyển nhân viên.<br>
                                <b>4.</b> Quét 2 lỗi tính tiền còn lại (đặc biệt loại khách đại lý giảm 30%).
                            </div>
                        </div>

                        <div class="out-card" style="border-left:3px solid var(--accent);">
                            <div class="head">
                                <span class="tag" style="background:var(--accent-soft);color:var(--accent);">Chờ đầu vào từ người khác</span>
                                <span class="ext">4 blockers</span>
                            </div>
                            <div class="desc">
                                <b>1. Phillip:</b> Chốt cấu trúc dữ liệu (chặn toàn bộ luồng báo giá Odoo).<br>
                                <b>2. Eloa:</b> 30 tin nhắn khách thật để làm thước đo chất lượng giọng.<br>
                                <b>3. Anthony:</b> Duyệt ký đóng biên bản tầng trả lời.<br>
                                <b>4. Jett / Eloa:</b> Xác nhận 4 giá trị mặc định của resort.
                            </div>
                        </div>

                        <div class="out-card" style="border-left:3px solid var(--claude);">
                            <div class="head">
                                <span class="tag" style="background:var(--claude-soft);color:var(--claude);">Cần Lead giúp đúng 2 việc</span>
                                <span class="ext">urgent</span>
                            </div>
                            <div class="desc">
                                <b>1. Thúc Phillip chốt cấu trúc dữ liệu Odoo</b> để mở khóa báo giá.<br>
                                <b>2. Xin Eloa 30 tin nhắn khách thật</b> (đã che tên) để đo độ tự nhiên.
                            </div>
                        </div>

                        <div class="out-card" style="border-left:3px solid var(--muted);">
                            <div class="head">
                                <span class="tag" style="background:var(--bg2);color:var(--muted);">Cố ý chưa làm (bảo vệ dự án)</span>
                                <span class="ext">safeguards</span>
                            </div>
                            <div class="desc">
                                <b>• Chưa nối Odoo:</b> Cấu trúc chưa chốt, xây trước chắc chắn phải đập đi.<br>
                                <b>• Không gộp đọc & viết lời:</b> Tách riêng 2 bước để giữ lớp kiểm tra factual (tuần này đã chặn 2 lỗi bịa thông tin).
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </section>

        <!-- ============================================================
       SECTION 2`;

html = html.replace(oldOverviewRegex, newOverview);

// 4. Section 2 Header
const oldSec2Header = `        <section class="section" id="detail">
            <span class="kicker">Inside the workflow · complete pipeline</span>
            <h1>Every node, every contract <span class="thin">— no hidden steps</span></h1>
            <p class="lede">From WhatsApp webhook to verified state to concierge reply. Green = deterministic code
                and data stores; terracotta = AI model calls; blue-grey = external triggers; tan = workflow skills;
                rust = deliverables. Hover any node to trace its active path; hover an agent node for its design
                contract.</p>`;

const newSec2Header = `        <section class="section" id="detail">
            <span class="kicker">Luồng Xử Lý Chi Tiết · Kiến Trúc Lai Neuro-Symbolic</span>
            <h1>Sơ Đồ Luồng Xử Lý & Ranh Giới Trách Nhiệm <span class="thin">— Từng Bước Một</span></h1>
            <p class="lede">Mô tả chi tiết luồng dữ liệu từ lúc khách nhắn tin WhatsApp đến khi bàn giao nhân viên chốt giá Odoo. Giải quyết triệt để 3 nguyên nhân "cứng", bổ sung lớp kiểm tra chéo số liệu và phân định rõ ranh giới bàn giao nhân viên. Rê chuột vào từng node để làm sáng luồng liên quan; rê vào node Agent để xem chi tiết nghiệp vụ.</p>`;

html = html.replace(oldSec2Header, newSec2Header);

// 5. Update PHASES, NODES, EDGES in <script>
const oldDataRegex = /\/\/ One entry per vertical phase column, left to right\.[\s\S]*?var EDGES = \[[\s\S]*?\];/;

const newData = `// One entry per vertical phase column, left to right.
            var PHASES = [
                { id: 0, title: 'Tiếp Nhận (Intake)', caption: '<b>Trạng thái: Ổn</b> · Đọc hiểu tự do Anh · Việt · Trung; khử trùng lặp và khóa theo số điện thoại.' },
                { id: 1, title: 'Trích Xuất (Extract)', caption: '<b>Trạng thái: 230 tests</b> · 1 pass chính trích 18 trường + 3 passes độc lập lặn/khách/ngày.' },
                { id: 2, title: 'Kiểm Định (Verify)', caption: '<b>Sửa Nguyên nhân 2:</b> Khách nói phức tạp không thành số &rarr; ghi chú + chuyển nhân viên.' },
                { id: 3, title: 'Soạn Lời (Reply)', caption: '<b>Sửa Nguyên nhân 1:</b> AI viết giọng lễ tân 5 sao + code đối chiếu số/ngày trước khi gửi.' },
                { id: 4, title: 'Bàn Giao & ERP', caption: '<b>Chờ Phillip:</b> Nhân viên chốt giá; Odoo giữ phòng & hoá đơn (cố ý chưa nối code).' }
            ];

            var NODES = [
                // ---- Phase 0 · Intake ----
                { id: 'guest', phase: 0, row: 0, kind: 'trigger', title: 'Khách WhatsApp', kindTag: 'Trigger · Ngôn ngữ tự do', desc: 'Gửi tin nhắn bằng tiếng Anh, Việt hoặc Trung ("thứ 7 tuần sau", lặn lẻ người...).', icon: 'user' },
                { id: 'bff', phase: 0, row: 1, kind: 'tool', title: 'Casa BFF Webhook', kindTag: 'Tool · Hono Edge', desc: 'Xác thực chữ ký Meta HMAC, tiếp nhận tin nhắn và điều hướng webhook.', icon: 'browser' },
                { id: 'store', phase: 0, row: 2, kind: 'tool', title: 'Conversation Store', kindTag: 'Tool · Memory/Redis', desc: 'Lưu toàn bộ transcript lịch sử trò chuyện theo từng số điện thoại; chống race condition.', icon: 'json' },

                // ---- Phase 1 · Extract ----
                { id: 'converse', phase: 1, row: 0, kind: 'skill', title: 'converse() Orchestrator', kindTag: 'Skill · Lõi điều phối', desc: 'Gửi toàn bộ transcript mỗi lượt — không lưu state phân mảnh để tránh trôi lệch dữ liệu.', icon: 'clipboard' },
                { id: 'main-call', phase: 1, row: 1, kind: 'agent', title: 'Main Extraction Pass', kindTag: 'Model call · 18 trường', desc: 'Đọc transcript 1 lượt và đề xuất toàn bộ 18 trường Trip kèm trích dẫn verbatim.', icon: 'claude', model: 'deepseek-flash', detail: { purpose: 'Đọc transcript một lượt và trích xuất tất cả 18 trường thông tin đặt phòng.', tools: 'Structured tool-calling (DeepSeek) / responseSchema (Gemini)', upstream: 'Transcript lịch sử + Manila timezone + Trip JSON schema', downstream: 'Tập dữ liệu thô (chưa được tin cậy hoàn toàn)', failure: 'Thử lại 1 lần nếu JSON lỗi, báo 422 nếu tiếp tục thất bại.' } },
                { id: 'isolated', phase: 1, row: 2, kind: 'agent', title: '3 Isolated Passes', kindTag: 'Model call · Lưới an toàn', desc: 'Chạy song song đọc riêng: số khách · ngày check-in · lịch lặn.', icon: 'claude', model: 'gemini', detail: { purpose: 'Lưới an toàn bắt các trường bị sót khi pass chính xử lý cùng lúc 18 trường.', tools: 'extractGuests / extractCheckIn / extractDiveWindow', upstream: 'Cùng bản transcript được gửi đồng thời', downstream: 'Bổ sung vào ô trống — tuyệt đối không ghi đè câu trả lời rõ ràng', failure: 'Lỗi được bỏ qua âm thầm, không làm hỏng lượt trò chuyện.' } },
                { id: 'provider', phase: 1, row: 3, kind: 'tool', title: 'Provider Seam', kindTag: 'Tool · Chuyển mạch', desc: 'DeepSeek Flash chính, Gemini 3.1 Flash-Lite dự phòng; failover tự động và trong suốt.', icon: 'orchestrator' },

                // ---- Phase 2 · Verify ----
                { id: 'postprocess', phase: 2, row: 0, kind: 'skill', title: 'postProcess() Engine', kindTag: 'Skill · Logic kiểm định', desc: 'Nơi dừng tin tưởng AI — code tất định nắm toàn quyền quyết định sự thật.', icon: 'shield' },
                { id: 'dates-counts', phase: 2, row: 1, kind: 'tool', title: 'Date & Count Validator', kindTag: 'Tool · Chuẩn hóa code', desc: 'Chuẩn hóa ngày sang ISO Manila time; kiểm tra số khách không mâu thuẫn lời nói.', icon: 'terminal' },
                { id: 'unmapped-gate', phase: 2, row: 2, kind: 'tool', title: 'Sửa Nguyên Nhân 2 & 3', kindTag: 'Tool · Quyết định hỏi', desc: 'Ý khách phức tạp (lặn lẻ ngày/người) &rarr; giữ nguyên văn vào notes + chuyển nhân viên, cấm hỏi lại.', icon: 'check_x' },
                { id: 'evidence', phase: 2, row: 3, kind: 'tool', title: 'Verbatim Evidence Gate', kindTag: 'Tool · 0% Bịa dữ liệu', desc: 'Xóa sạch mọi khẳng định không có trích lục nguyên văn trong tin nhắn của khách.', icon: 'cursor' },

                // ---- Phase 3 · Reply ----
                { id: 'questions', phase: 3, row: 0, kind: 'skill', title: 'generateQuestions()', kindTag: 'Skill · Quyết định hỏi', desc: 'Chỉ hỏi những trường bắt buộc thật sự còn thiếu, theo thứ tự lễ tân chuyên nghiệp.', icon: 'doc_sparkle' },
                { id: 'synthesis', phase: 3, row: 1, kind: 'agent', title: 'Concierge Voice AI', kindTag: 'Model call · Sửa Nguyên nhân 1', desc: 'Viết câu bằng giọng lễ tân 5 sao ấm áp trên dữ liệu đã kiểm chứng.', icon: 'claude', model: 'gemini', detail: { purpose: 'Tạo lời đáp tự nhiên, ân cần chuẩn khách sạn quốc tế, cấm tự bịa giá hoặc chốt phòng.', tools: 'provider.generateText() với prompt Concierge Voice', upstream: 'Tập dữ liệu Verified Facts từ code + các câu hỏi còn thiếu', downstream: 'Câu phản hồi dự thảo gửi khách', failure: 'Lỗi hoặc timeout tự động quay về mẫu câu an toàn dựng sẵn.' } },
                { id: 'sanity-check', phase: 3, row: 2, kind: 'tool', title: 'AI Sanity Cross-Check', kindTag: 'Tool · Làm ngay tuần này', desc: 'Đối chiếu mọi con số và ngày trong câu AI viết với dữ liệu gốc; lệch là rollback về template an toàn.', icon: 'shield' },
                { id: 'reply-out', phase: 3, row: 3, kind: 'deliverable', title: 'Tin Nhắn WhatsApp', kindTag: 'Deliverable · Gửi khách', desc: 'Chào hỏi ân cần · hỏi đúng trọng tâm · tóm tắt minh bạch bằng ngôn ngữ của khách.', icon: 'media' },

                // ---- Phase 4 · Hand-off & Odoo ----
                { id: 'eval-judge', phase: 4, row: 0, kind: 'skill', title: 'Thước Đo Độ Tự Nhiên', kindTag: 'Skill · Chờ Eloa', desc: 'Bộ chấm điểm chất lượng giọng văn và độ trúng của câu hỏi (cần 30 tin nhắn thật từ Eloa).', icon: 'clipboard' },
                { id: 'human-handoff', phase: 4, row: 1, kind: 'deliverable', title: 'Bàn Giao Nhân Viên Thật', kindTag: 'Deliverable · Hand-off', desc: 'Lễ tân tiếp nhận: tư vấn trường hợp đặc biệt, đối soát lịch lặn và chốt giá cuối.', icon: 'pdf' },
                { id: 'odoo-erp', phase: 4, row: 2, kind: 'deliverable', title: 'Odoo ERP & Báo Giá', kindTag: 'Deliverable · Cố ý chờ Phillip', desc: 'Giữ giá, hoá đơn và phòng. Cố ý chưa viết code nối cho đến khi Phillip chốt cấu trúc dữ liệu.', icon: 'json' }
            ];

            var EDGES = [
                ['guest', 'bff'], ['bff', 'store'],
                ['store', 'converse'],
                ['converse', 'main-call'], ['converse', 'isolated'],
                ['main-call', 'provider'], ['isolated', 'provider'],
                ['provider', 'postprocess'],
                ['postprocess', 'dates-counts'], ['dates-counts', 'unmapped-gate'], ['unmapped-gate', 'evidence'],
                ['evidence', 'questions'],
                ['questions', 'synthesis'],
                ['synthesis', 'sanity-check'],
                ['sanity-check', 'reply-out'],
                ['reply-out', 'human-handoff'],
                ['human-handoff', 'odoo-erp'],
                ['questions', 'eval-judge']
            ];`;

html = html.replace(oldDataRegex, newData);

fs.writeFileSync('docs/casa-escondida-plan-showcase.html', html, 'utf8');
fs.writeFileSync('public/casa-escondida-plan-showcase.html', html, 'utf8');
console.log('Successfully generated docs/casa-escondida-plan-showcase.html and synced to public/!');
