import fs from 'node:fs';

const template = fs.readFileSync('docs/extractor-pod-showcase.html', 'utf8');

// Use string slicing around rock-solid anchors

// 1. Page Title
let html = template.replace(
  '<title>Extractor Pod Pipeline Showcase — TechNext</title>',
  '<title>Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng WhatsApp — Casa Escondida</title>'
);

// 2. Extra CSS for Section 2 (Plan Details) and Sticky Nav
const extraCSS = `
        /* ============ STICKY NAV ============ */
        .plan-nav {
            position: sticky;
            top: 16px;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid var(--line);
            border-radius: 99px;
            padding: 8px 18px;
            margin-bottom: 28px;
            box-shadow: 0 4px 20px rgba(42, 33, 27, 0.08);
        }
        .plan-nav .brand {
            font-size: 12px;
            font-weight: 700;
            letter-spacing: .08em;
            text-transform: uppercase;
            color: var(--accent);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .plan-nav .brand-dot {
            width: 8px;
            height: 8px;
            border-radius: 99px;
            background: var(--claude);
        }
        .plan-nav .links {
            display: flex;
            gap: 12px;
        }
        .plan-nav a {
            text-decoration: none;
            color: var(--muted);
            font-size: 12.5px;
            font-weight: 600;
            padding: 5px 14px;
            border-radius: 99px;
            transition: all 0.2s ease;
        }
        .plan-nav a:hover {
            color: var(--ink);
            background: var(--bg2);
        }
        .plan-nav a.active {
            color: #fff;
            background: var(--accent);
        }

        /* ============ SECTION 2 · EXECUTIVE PLAN ============ */
        .plan-doc {
            display: flex;
            flex-direction: column;
            gap: 32px;
            margin-top: 10px;
        }
        .plan-header-block {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 26px 30px;
            box-shadow: var(--shadow);
        }
        .plan-header-block h2 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 26px;
            margin: 0 0 10px;
            color: var(--ink);
        }

        .causes-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }
        @media (max-width: 960px) {
            .causes-grid { grid-template-columns: 1fr; }
        }
        .cause-card {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 22px;
            box-shadow: var(--shadow);
            display: flex;
            flex-direction: column;
            gap: 10px;
            position: relative;
        }
        .cause-card .cause-num {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .15em;
            text-transform: uppercase;
            color: var(--muted);
        }
        .cause-card h3 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 19px;
            margin: 0;
            color: var(--ink);
            line-height: 1.3;
        }
        .cause-card .status-pill {
            align-self: flex-start;
            font-size: 10.5px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 6px;
            text-transform: uppercase;
            letter-spacing: .06em;
        }
        .status-pill.fixed {
            background: var(--tool-soft);
            color: var(--tool);
        }
        .status-pill.pending {
            background: #FCEBEB;
            color: #C0182F;
        }
        .status-pill.partial {
            background: var(--accent-soft);
            color: var(--accent);
        }

        .measure-box {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 26px 30px;
            box-shadow: var(--shadow);
        }
        .measure-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 14px;
        }
        .measure-table th, .measure-table td {
            padding: 14px 18px;
            text-align: left;
            border-bottom: 1px solid var(--line-soft);
            font-size: 14px;
        }
        .measure-table th {
            background: var(--bg2);
            font-size: 11.5px;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--accent);
            font-weight: 700;
        }

        .plan-two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
        }
        @media (max-width: 960px) {
            .plan-two-col { grid-template-columns: 1fr; }
        }
        .action-card {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 26px 28px;
            box-shadow: var(--shadow);
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .action-card h3 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 21px;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .task-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .task-row {
            padding: 14px 16px;
            background: var(--bg);
            border: 1px solid var(--line-soft);
            border-radius: 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .task-row .head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 700;
            color: var(--ink);
            font-size: 14px;
        }
        .task-row .badge-owner {
            font-family: 'JetBrains Mono', monospace;
            font-size: 10.5px;
            padding: 2px 7px;
            border-radius: 4px;
            background: var(--bg2);
            color: var(--accent);
            font-weight: 600;
        }

        .lead-callout {
            background: linear-gradient(135deg, var(--claude-soft) 0%, #FFFFFF 100%);
            border: 2px solid var(--claude);
            border-radius: 16px;
            padding: 28px 32px;
            box-shadow: var(--shadow-agent);
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .lead-callout h3 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 22px;
            margin: 0;
            color: var(--claude-2);
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .safeguard-box {
            background: var(--bg);
            border: 1px dashed var(--muted);
            border-radius: 16px;
            padding: 24px 28px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .safeguard-box h4 {
            font-size: 13px;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--muted);
            margin: 0;
            font-weight: 700;
        }
`;

html = html.replace('    </style>', extraCSS + '\n    </style>');

// 3. Find start of <main class="page"> and replace everything up to <section class="section" id="detail">
const mainPageAnchor = '<main class="page">';
const detailSectionAnchor = '<section class="section" id="detail">';

const mainIdx = html.indexOf(mainPageAnchor);
const detailIdx = html.indexOf(detailSectionAnchor);

if (mainIdx === -1 || detailIdx === -1) {
  throw new Error(`Anchor not found! mainIdx: ${mainIdx}, detailIdx: ${detailIdx}`);
}

const beforeMain = html.slice(0, mainIdx + mainPageAnchor.length);
const afterDetail = html.slice(detailIdx);

const middleContent = `

        <!-- STICKY TOP NAV -->
        <nav class="plan-nav">
            <div class="brand">
                <span class="brand-dot"></span>
                <span>Casa Escondida · Trợ Lý Đặt Phòng</span>
            </div>
            <div class="links">
                <a href="#overview">1. Tổng Quan & Số Liệu</a>
                <a href="#plan-detail" class="active">2. Kế Hoạch Cho Lead</a>
                <a href="#detail">3. Sơ Đồ Luồng Neuro-Symbolic</a>
            </div>
        </nav>

        <!-- ============================================================
       SECTION 1 · TỔNG QUAN BLACK-BOX (VĨ MÔ 30.000 FEET)
       ============================================================ -->
        <section class="section" id="overview">
            <span class="kicker">TechNext · Casa Escondida · Trợ Lý Đặt Phòng WhatsApp</span>
            <h1>Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng <span class="thin">— Dành Cho Lead</span></h1>
            <p class="lede">Bot đọc tin nhắn khách bằng ngôn ngữ tự nhiên (Anh · Việt · Trung), rút ra thông tin đặt phòng, hỏi nốt phần thiếu, rồi bàn giao cho nhân viên chốt giá. Odoo vẫn giữ giá, hoá đơn và phòng — phần này chỉ đứng ngoài, nói chuyện với khách. Dưới đây là tình hình thật và việc cần làm tiếp (23/09/2026 · không cần đọc code).</p>

            <div class="overview">

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

                <!-- PANEL 3: OUTPUTS · TÓM TẮT HÀNH ĐỘNG -->
                <div class="panel">
                    <div class="panel-title"><span class="dot"></span>Outputs · Tóm tắt hành động</div>
                    <h2>Lộ trình ưu tiên phân định rõ ràng</h2>
                    <p class="sub">Chi tiết xem toàn văn phần 2 ngay bên dưới.</p>
                    <div class="out-list">
                        <div class="out-card" style="border-left:3px solid var(--tool);">
                            <div class="head">
                                <span class="tag" style="background:var(--tool-soft);color:var(--tool);">Làm ngay — không chờ ai</span>
                                <span class="ext">4 tasks</span>
                            </div>
                            <div class="desc">
                                <b>1.</b> Đưa bản sửa tính tiền lên prod & rà soát hotfix.<br>
                                <b>2.</b> Thêm lớp đối chiếu con số/ngày trong câu AI.<br>
                                <b>3.</b> Sửa hỏi lại thứ khách vừa nói (đẩy nhân viên).<br>
                                <b>4.</b> Quét 2 lỗi tính tiền còn lại (đại lý giảm 30%).
                            </div>
                        </div>

                        <div class="out-card" style="border-left:3px solid var(--accent);">
                            <div class="head">
                                <span class="tag" style="background:var(--accent-soft);color:var(--accent);">Chờ đầu vào từ người khác</span>
                                <span class="ext">4 blockers</span>
                            </div>
                            <div class="desc">
                                <b>1. Phillip:</b> Chốt cấu trúc dữ liệu Odoo.<br>
                                <b>2. Eloa:</b> Cung cấp 30 tin nhắn khách thật.<br>
                                <b>3. Anthony:</b> Duyệt ký đóng biên bản tầng trả lời.<br>
                                <b>4. Jett / Eloa:</b> Xác nhận 4 giá trị mặc định resort.
                            </div>
                        </div>

                        <div class="out-card" style="border-left:3px solid var(--claude);">
                            <div class="head">
                                <span class="tag" style="background:var(--claude-soft);color:var(--claude);">Cần Lead giúp đúng 2 việc</span>
                                <span class="ext">lead action</span>
                            </div>
                            <div class="desc">
                                <b>1. Thúc Phillip chốt cấu trúc Odoo</b> sớm nhất.<br>
                                <b>2. Xin Eloa 30 tin nhắn khách thật</b> để đo giọng văn.
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </section>

        <!-- ============================================================
       SECTION 2 · TOÀN VĂN KẾ HOẠCH CHO LEAD
       ============================================================ -->
        <section class="section" id="plan-detail">
            <span class="kicker">Chi Tiết Bản Kế Hoạch · Dành Cho Lead</span>
            <h1>Kế Hoạch Hành Động <span class="thin">— Bóc Tách Bản Chất &amp; Nhiệm Vụ Cụ Thể</span></h1>
            <p class="lede">Xếp theo thứ tự ưu tiên, chia làm hai cột để thấy rõ chỗ nào team tự làm được và chỗ nào thật sự đang tắc vì chờ người khác.</p>

            <div class="plan-doc">

                <!-- 1. BÓC TÁCH NGUYÊN NHÂN "CỨNG" -->
                <div class="plan-header-block">
                    <h2>Vấn đề Lead nêu: Bot nói chuyện thiếu tự nhiên</h2>
                    <p style="margin:0;color:var(--muted);font-size:15px;line-height:1.5;">Gọi chung là "cứng", nhưng thật ra là <b>ba nguyên nhân khác nhau</b> cần <b>ba cách chữa khác nhau</b>. Gộp chung lại chính là lý do sửa mãi mà không thấy khá lên.</p>
                </div>

                <div class="causes-grid">
                    <!-- Nguyên nhân 1 -->
                    <div class="cause-card">
                        <div class="cause-num">Nguyên nhân 1 · Cách dùng từ</div>
                        <h3>Câu chữ khô như máy đọc</h3>
                        <span class="status-pill fixed">Đã sửa tuần này</span>
                        <p style="margin:0;color:var(--muted);font-size:13.5px;line-height:1.45;">Trước đây mọi câu trả lời đều là mẫu câu cố định ghép sẵn — an toàn tuyệt đối nhưng đọc lên rất máy móc.</p>
                        <div style="padding:10px 12px;background:var(--bg);border-radius:8px;font-size:12.5px;color:var(--ink-soft);border:1px solid var(--line-soft);">
                            <b>Giải pháp đã làm:</b> AI viết lại bằng giọng lễ tân, chỉ được dùng dữ liệu đã kiểm chứng, cấm nói giá hoặc xác nhận đặt phòng; lỗi tự quay về mẫu cũ. Khớp đúng chuẩn quốc tế (Duve, HiJiffy).
                        </div>
                    </div>

                    <!-- Nguyên nhân 2 -->
                    <div class="cause-card" style="border:1.5px solid #F0B8B8;">
                        <div class="cause-num" style="color:#C0182F;">Nguyên nhân 2 · Hỏi sai chỗ (Tệ nhất)</div>
                        <h3 style="color:#A01427;">Hỏi lại thứ khách vừa nói</h3>
                        <span class="status-pill pending">Chưa sửa — Trọng tâm tuần này</span>
                        <p style="margin:0;color:var(--muted);font-size:13.5px;line-height:1.45;">Khách viết: <i>"Một người lặn ngày đầu, năm người lặn cả hai ngày"</i>. Hệ thống không quy được về một con số nên coi như chưa biết và <b>hỏi lại</b>. Với khách, cảm giác là <i>"Tôi vừa nói rồi mà!"</i>.</p>
                        <div style="padding:10px 12px;background:#FFF5F5;border-radius:8px;font-size:12.5px;color:#8A1220;border:1px solid #FBD0D0;">
                            <b>Giải pháp:</b> Dù AI viết hay tới đâu, hỏi lại thứ khách vừa nói vẫn vô duyên. <b>Phải sửa ở chỗ quyết định hỏi gì</b>: Ghi nhận câu nói vào ô ghi chú và chuyển nhân viên đọc thay vì hỏi lại!
                        </div>
                    </div>

                    <!-- Nguyên nhân 3 -->
                    <div class="cause-card">
                        <div class="cause-num">Nguyên nhân 3 · Khuôn dữ liệu</div>
                        <h3>Ý khách phong phú hơn ô trống</h3>
                        <span class="status-pill partial">Đã đỡ một phần</span>
                        <p style="margin:0;color:var(--muted);font-size:13.5px;line-height:1.45;">Hệ thống có sẵn các ô: ngày, số người, số phòng… Khi khách nói điều không rơi vào ô nào, nó bị làm phẳng hoặc rơi mất — như lịch lặn khác nhau theo từng người.</p>
                        <div style="padding:10px 12px;background:var(--bg);border-radius:8px;font-size:12.5px;color:var(--ink-soft);border:1px solid var(--line-soft);">
                            <b>Giới hạn thật:</b> Không thể thêm ô cho mọi cách nói của con người. Đã thêm ô ghi chú nguyên văn; phần phức tạp còn lại chấp nhận chuyển cho nhân viên đọc.
                        </div>
                    </div>
                </div>

                <!-- 2. THƯỚC ĐO: VÌ SAO CỨ CỨNG MÃI -->
                <div class="measure-box">
                    <h3 style="font-family:'Playfair Display',serif;font-size:20px;margin:0 0 6px;">Vì sao nó cứ cứng mãi: Mình chưa từng đo cái đó!</h3>
                    <p style="margin:0 0 14px;color:var(--muted);font-size:14px;">Dự án đo rất nghiêm việc "có bịa thông tin không" — kết quả 0%. Nhưng "hỏi có đúng trọng tâm không, nghe có tự nhiên không" thì <b>chưa hề được chấm điểm lần nào</b>. Báo cáo kiểm thử ghi rõ: <code>Question targeting : not scored — needs a human/judge pass</code>.</p>

                    <table class="measure-table">
                        <thead>
                            <tr>
                                <th style="width:25%;">Hạng Mục</th>
                                <th style="width:20%;">Điểm Số</th>
                                <th style="width:55%;">Chi Tiết &amp; Đánh Giá</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="font-weight:700;color:var(--tool);">Đo rất kỹ</td>
                                <td><span style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:var(--tool);">0%</span></td>
                                <td>Bịa dữ liệu · trích dẫn sai · sai ngày · sai số khách. (Chấm tự động mỗi commit &rarr; <b>Làm rất tốt</b>).</td>
                            </tr>
                            <tr>
                                <td style="font-weight:700;color:#C0182F;">Không đo</td>
                                <td><span style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:#C0182F;">—</span></td>
                                <td>Hỏi thừa · hỏi lại thứ đã biết · giọng văn · cảm giác của khách. (Chưa chấm lần nào &rarr; <b>Cần 30 tin thật từ Eloa</b>).</td>
                            </tr>
                        </tbody>
                    </table>
                    <p style="margin:12px 0 0;font-size:13px;color:var(--muted);font-style:italic;">* Cái gì được đo thì được cải thiện. Phần "không bịa" tốt vì được chấm mỗi ngày; phần "tự nhiên" tệ vì chưa ai chấm nó lần nào — chứ không phải vì nó khó hơn.</p>
                </div>

                <!-- 3. HAI CỘT HÀNH ĐỘNG: LÀM NGAY VS CHỜ NGƯỜI -->
                <div class="plan-two-col">

                    <!-- Cột 1: Làm ngay -->
                    <div class="action-card" style="border-top:4px solid var(--tool);">
                        <h3>
                            <span style="width:10px;height:10px;border-radius:99px;background:var(--tool);display:inline-block;"></span>
                            <span>Làm ngay — Không chờ ai</span>
                        </h3>
                        <p style="margin:0;font-size:13px;color:var(--muted);">Team kỹ thuật tự chủ hoàn toàn, triển khai ngay trong tuần này:</p>

                        <div class="task-list">
                            <div class="task-row">
                                <div class="head">
                                    <span>1. Đưa bản sửa lỗi tính tiền lên production</span>
                                    <span class="badge-owner" style="background:#FCEBEB;color:#C0182F;">URGENT</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);">Đã xong và kiểm thử từ hôm qua nhưng chưa live. Đồng thời thiết lập rà soát xem còn bản sửa nào khác đang kẹt tương tự.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span>2. Thêm lớp kiểm tra cho câu AI viết (Sanity Check)</span>
                                    <span class="badge-owner" style="background:var(--tool-soft);color:var(--tool);">CODE CHECK</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);">Đối chiếu mọi con số và ngày trong câu AI vừa viết với dữ liệu đã kiểm chứng; lệch thì tự quay về mẫu câu an toàn. Hiện chỉ có lời dặn trong prompt, chưa có code kiểm tra.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span>3. Sửa nguyên nhân 2 — Hỏi lại thứ khách đã nói</span>
                                    <span class="badge-owner" style="background:var(--accent-soft);color:var(--accent);">LOGIC FIX</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);">Khi khách đã trả lời nhưng hệ thống không quy được về con số (lịch lặn phức tạp), ghi nhận vào Freeform Notes và chuyển nhân viên thay vì hỏi khách lần nữa.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span>4. Quét nốt hai lỗi tính tiền còn lại</span>
                                    <span class="badge-owner" style="background:var(--bg2);color:var(--accent);">PRICING</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);">Hai thông tin ảnh hưởng trực tiếp tới giá đang được hệ thống tự suy đoán thay vì hỏi — trong đó có loại khách (đại lý được giảm 30%).</div>
                            </div>
                        </div>
                    </div>

                    <!-- Cột 2: Chờ đầu vào -->
                    <div class="action-card" style="border-top:4px solid var(--accent);">
                        <h3>
                            <span style="width:10px;height:10px;border-radius:99px;background:var(--accent);display:inline-block;"></span>
                            <span>Chờ đầu vào từ người khác</span>
                        </h3>
                        <p style="margin:0;font-size:13px;color:var(--muted);">Các mắt xích phụ thuộc đối tác bên ngoài cần gỡ nút thắt:</p>

                        <div class="task-list">
                            <div class="task-row">
                                <div class="head">
                                    <span>1. Chốt cấu trúc dữ liệu Odoo</span>
                                    <span class="badge-owner">PHILLIP</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);">Chặn toàn bộ hướng tính giá, xuất báo giá và link báo giá gửi khách. Đây là mắt xích sớm nhất và quan trọng nhất.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span>2. 30 tin nhắn khách thật</span>
                                    <span class="badge-owner">ELOA</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);">Có nó mới dựng được thước đo cho chất lượng giọng văn — thứ quyết định việc "làm cho tự nhiên hơn" có chứng minh được bằng số liệu hay không.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span>3. Duyệt hướng tầng trả lời</span>
                                    <span class="badge-owner">ANTHONY</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);">Biên bản quyết định cũ vẫn đang chờ ký trong khi code đã đi tiếp. Cần đóng lại để người sau không hiểu nhầm.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span>4. Bốn giá trị mặc định của resort</span>
                                    <span class="badge-owner">JETT / ELOA</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);">Hiện là số phỏng đoán. Đoán sai thì báo giá sai mà không ai nhìn ra.</div>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- 4. CẦN LEAD GIÚP ĐÚNG HAI VIỆC -->
                <div class="lead-callout">
                    <h3>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                        </svg>
                        <span>Cần Lead giúp đúng hai việc</span>
                    </h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                        <div style="background:#FFF;padding:18px 20px;border-radius:12px;border:1px solid rgba(217,119,87,.25);box-shadow:0 2px 8px rgba(0,0,0,.03);">
                            <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--claude);font-weight:700;margin-bottom:6px;">Hành động 1 · Block cao nhất</div>
                            <div style="font-weight:700;font-size:15.5px;color:var(--ink);margin-bottom:6px;">Thúc Phillip chốt cấu trúc dữ liệu</div>
                            <div style="font-size:13.5px;color:var(--muted);line-height:1.45;">Mọi thứ liên quan tới báo giá — kể cả link báo giá gửi khách theo chuẩn quốc tế — đang nằm chờ đúng mắt xích này, không phải chờ team kỹ thuật.</div>
                        </div>

                        <div style="background:#FFF;padding:18px 20px;border-radius:12px;border:1px solid rgba(217,119,87,.25);box-shadow:0 2px 8px rgba(0,0,0,.03);">
                            <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--claude);font-weight:700;margin-bottom:6px;">Hành động 2 · Dữ liệu đo lường</div>
                            <div style="font-weight:700;font-size:15.5px;color:var(--ink);margin-bottom:6px;">Xin Eloa 30 tin nhắn khách thật (đã che tên)</div>
                            <div style="font-size:13.5px;color:var(--muted);line-height:1.45;">Không có nó thì việc "làm cho tự nhiên hơn" vẫn chỉ là cảm tính — sửa xong không ai chứng minh được đã khá hơn hay chưa.</div>
                        </div>
                    </div>
                </div>

                <!-- 5. HAI VIỆC CỐ Ý CHƯA LÀM -->
                <div class="safeguard-box">
                    <h4>Hai việc đang cố ý CHƯA làm (để tránh hiểu nhầm là bỏ sót)</h4>
                    <div style="display:flex;flex-direction:column;gap:10px;font-size:13.5px;color:var(--ink-soft);line-height:1.5;">
                        <div>
                            <b>Một · Chưa xây bước tính giá và xuất báo giá:</b> Cấu trúc dữ liệu chưa chốt, xây trước là chắc chắn phải làm lại.
                        </div>
                        <div>
                            <b>Hai · Chưa gộp phần đọc dữ liệu và viết lời thoại vào một lượt gọi AI:</b> Làm vậy để tiết kiệm chi phí nhưng sẽ khiến AI viết lời cho khách trước khi hệ thống kịp kiểm tra dữ liệu, mà riêng tuần này lớp kiểm tra đó đã chặn được 2 lỗi bịa thông tin!
                        </div>
                    </div>
                </div>

            </div>
        </section>

        <!-- ============================================================
       SECTION 3 · WORKFLOW DETAIL (SVG NODE-GRAPH)
       ============================================================ -->
`;

html = beforeMain + middleContent + afterDetail;

// 4. Update Section 3 (Detail Node Graph) Header
const oldSec2Header = `        <section class="section" id="detail">
            <span class="kicker">Section 2 · Node graph</span>
            <h1>Inside the workflow <span class="thin">— stage by stage</span></h1>
            <p class="lede">Five phases, left to right, for one guest message. Everything orange is a model call;
                everything green is code that checks the model's work. Hover a node (screen) or read the callout
                (print) for its full detail card.</p>`;

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
console.log('Successfully written comprehensive showcase plan with Section 1, Section 2 (Plan), and Section 3 (Node graph)!');
