import fs from 'node:fs';

const template = fs.readFileSync('docs/extractor-pod-showcase.html', 'utf8');

// Title
let html = template.replace(
  '<title>Extractor Pod Pipeline Showcase — TechNext</title>',
  '<title>Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng WhatsApp — Casa Escondida</title>'
);

// 1. Extra CSS for Bilingual Support, Sticky Nav, Visual Dialogue Bubbles, and Non-Tech Explanations
const extraCSS = `
        /* ============ BILINGUAL TOGGLE & NAV ============ */
        .plan-nav {
            position: sticky;
            top: 16px;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255, 255, 255, 0.94);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid var(--line);
            border-radius: 99px;
            padding: 8px 18px;
            margin-bottom: 28px;
            box-shadow: 0 4px 20px rgba(42, 33, 27, 0.08);
            gap: 16px;
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
            white-space: nowrap;
        }
        .plan-nav .brand-dot {
            width: 8px;
            height: 8px;
            border-radius: 99px;
            background: var(--claude);
            animation: blip 2.4s ease-in-out infinite;
        }
        .plan-nav .links {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
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

        .lang-switcher {
            display: inline-flex;
            border: 1px solid var(--line);
            border-radius: 99px;
            overflow: hidden;
            background: var(--bg2);
            padding: 2px;
        }
        .lang-btn {
            border: 0;
            background: transparent;
            color: var(--muted);
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 12px;
            border-radius: 99px;
            cursor: pointer;
            transition: all 0.18s ease;
            line-height: 1.2;
        }
        .lang-btn.active {
            background: var(--accent);
            color: #fff;
            box-shadow: 0 2px 6px rgba(139, 94, 52, 0.25);
        }

        /* ============ SECTION 2 · EXECUTIVE PLAN FOR LEAD ============ */
        .plan-doc {
            display: flex;
            flex-direction: column;
            gap: 36px;
            margin-top: 10px;
        }
        .mental-model-card {
            background: linear-gradient(135deg, #FFFFFF 0%, var(--bg2) 100%);
            border: 1.5px solid var(--line);
            border-radius: 18px;
            padding: 28px 32px;
            box-shadow: var(--shadow);
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .mental-model-card h3 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 22px;
            margin: 0;
            color: var(--accent);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .mental-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-top: 10px;
        }
        @media (max-width: 990px) {
            .mental-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 600px) {
            .mental-grid { grid-template-columns: 1fr; }
        }
        .mental-item {
            background: #fff;
            border: 1px solid var(--line-soft);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .mental-item .role {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--muted);
        }
        .mental-item .duty {
            font-weight: 700;
            font-size: 14.5px;
            color: var(--ink);
        }
        .mental-item .expl {
            font-size: 12.5px;
            color: var(--muted);
            line-height: 1.45;
        }

        /* 3 Root causes with chat dialogue comparisons */
        .causes-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 22px;
        }
        @media (max-width: 960px) {
            .causes-grid { grid-template-columns: 1fr; }
        }
        .cause-card {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 24px;
            box-shadow: var(--shadow);
            display: flex;
            flex-direction: column;
            gap: 12px;
            position: relative;
        }
        .cause-card.urgent {
            border: 2px solid #F0B8B8;
            box-shadow: 0 4px 20px rgba(192, 24, 47, 0.08);
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
            font-size: 20px;
            margin: 0;
            color: var(--ink);
            line-height: 1.25;
        }
        .status-pill {
            align-self: flex-start;
            font-size: 10.5px;
            font-weight: 700;
            padding: 3px 9px;
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

        /* Dialog bubbles */
        .chat-compare {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 6px;
            font-size: 12.5px;
        }
        .chat-bubble {
            padding: 10px 14px;
            border-radius: 10px;
            line-height: 1.45;
        }
        .chat-bubble.bad {
            background: #FFF5F5;
            border-left: 3px solid #C0182F;
            color: #7A1722;
        }
        .chat-bubble.good {
            background: var(--tool-soft);
            border-left: 3px solid var(--tool);
            color: #215328;
        }

        /* Measurement table */
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

        /* 2-column actions */
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

        /* Lead callout */
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
        .lead-actions-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        @media (max-width: 768px) {
            .lead-actions-grid { grid-template-columns: 1fr; }
        }

        /* Safeguards box */
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

// 2. Anchors
const mainPageAnchor = '<main class="page">';
const detailSectionAnchor = '<section class="section" id="detail">';

const mainIdx = html.indexOf(mainPageAnchor);
const detailIdx = html.indexOf(detailSectionAnchor);

if (mainIdx === -1 || detailIdx === -1) {
  throw new Error(`Anchor not found! mainIdx: ${mainIdx}, detailIdx: ${detailIdx}`);
}

const beforeMain = html.slice(0, mainIdx + mainPageAnchor.length);
const afterDetail = html.slice(detailIdx);

// 3. Middle content with bilingual support (data-vi and data-en)
const middleContent = `

        <!-- STICKY TOP NAV WITH BILINGUAL SWITCHER -->
        <nav class="plan-nav">
            <div class="brand">
                <span class="brand-dot"></span>
                <span data-vi="Casa Escondida · Trợ Lý Đặt Phòng" data-en="Casa Escondida · Booking Assistant">Casa Escondida · Trợ Lý Đặt Phòng</span>
            </div>
            <div class="links">
                <a href="#overview" data-vi="1. Tổng Quan &amp; Số Liệu" data-en="1. Overview &amp; Metrics">1. Tổng Quan &amp; Số Liệu</a>
                <a href="#plan-detail" class="active" data-vi="2. Kế Hoạch Cho Lead (Chi Tiết)" data-en="2. Executive Plan for Lead">2. Kế Hoạch Cho Lead (Chi Tiết)</a>
                <a href="#detail" data-vi="3. Sơ Đồ Luồng Neuro-Symbolic" data-en="3. Neuro-Symbolic Pipeline">3. Sơ Đồ Luồng Neuro-Symbolic</a>
            </div>
            <div class="lang-switcher" aria-label="Language selection">
                <button type="button" class="lang-btn active" data-lang="vi">VI</button>
                <button type="button" class="lang-btn" data-lang="en">EN</button>
            </div>
        </nav>

        <!-- ============================================================
       SECTION 1 · TỔNG QUAN BLACK-BOX (VĨ MÔ 30.000 FEET)
       ============================================================ -->
        <section class="section" id="overview">
            <span class="kicker" data-vi="TechNext · Casa Escondida · Trợ Lý Đặt Phòng WhatsApp" data-en="TechNext · Casa Escondida · WhatsApp Booking Assistant">TechNext · Casa Escondida · Trợ Lý Đặt Phòng WhatsApp</span>
            <h1 data-vi="Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng &lt;span class=&quot;thin&quot;&gt;— Dành Cho Lead&lt;/span&gt;" data-en="Booking Assistant Upgrade Plan &lt;span class=&quot;thin&quot;&gt;— For Tech Lead&lt;/span&gt;">Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng <span class="thin">— Dành Cho Lead</span></h1>
            <p class="lede" data-vi="Bot đọc tin nhắn khách bằng ngôn ngữ tự nhiên (Anh · Việt · Trung), rút ra thông tin đặt phòng, hỏi nốt phần thiếu, rồi bàn giao cho nhân viên chốt giá. Odoo vẫn giữ giá, hoá đơn và phòng — phần này chỉ đứng ngoài, nói chuyện với khách. Dưới đây là tình hình thật và việc cần làm tiếp (23/09/2026 · không cần đọc code)." data-en="The bot reads natural WhatsApp messages (English · Vietnamese · Chinese), extracts booking parameters, clarifies missing items, and hands off to human staff for pricing. Odoo ERP retains prices, rooms, and invoices — this system acts as the front concierge. Here is the unvarnished reality and execution roadmap (23/09/2026 · no code required).">Bot đọc tin nhắn khách bằng ngôn ngữ tự nhiên (Anh · Việt · Trung), rút ra thông tin đặt phòng, hỏi nốt phần thiếu, rồi bàn giao cho nhân viên chốt giá. Odoo vẫn giữ giá, hoá đơn và phòng — phần này chỉ đứng ngoài, nói chuyện với khách. Dưới đây là tình hình thật và việc cần làm tiếp (23/09/2026 · không cần đọc code).</p>

            <div class="overview">

                <!-- PANEL 1: INPUTS · ĐANG Ở ĐÂU -->
                <div class="panel">
                    <div class="panel-title"><span class="dot"></span><span data-vi="Inputs · Đang ở đâu" data-en="Inputs · Current State">Inputs · Đang ở đâu</span></div>
                    <h2 data-vi="Hiện trạng thật 4 mảng hệ thống" data-en="Unvarnished State of 4 Modules">Hiện trạng thật 4 mảng hệ thống</h2>
                    <p class="sub" data-vi="Trạng thái vận hành thực tế — nhìn thẳng sự thật, không làm đẹp số." data-en="Production reality — transparent engineering, no inflated metrics.">Trạng thái vận hành thực tế — nhìn thẳng sự thật, không làm đẹp số.</p>
                    <ul class="input-list">
                        <li>
                            <span class="glyph" aria-hidden="true" style="background:var(--tool-soft);color:var(--tool);">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </span>
                            <div>
                                <div class="lbl" style="display:flex;justify-content:space-between;align-items:center;">
                                    <span data-vi="Đọc hiểu tin nhắn khách" data-en="Guest Message Comprehension">Đọc hiểu tin nhắn khách</span>
                                    <span style="font-size:10px;text-transform:uppercase;color:var(--tool);font-weight:700;background:var(--tool-soft);padding:1px 6px;border-radius:4px;" data-vi="Ổn" data-en="Solid">Ổn</span>
                                </div>
                                <div class="desc" data-vi="Tự do Anh · Việt · Trung, kể cả 'thứ 7 tuần sau'. Khi không chắc thì hỏi lại chứ không đoán. Đã kiểm tra nghiêm và đang sạch." data-en="Free-form EN · VI · ZH, including relative dates like 'next Saturday'. Never guesses when uncertain. Clean and strictly verified.">Tự do Anh · Việt · Trung, kể cả 'thứ 7 tuần sau'. Khi không chắc thì hỏi lại chứ không đoán. Đã kiểm tra nghiêm và đang sạch.</div>
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
                                    <span data-vi="Cách nói chuyện" data-en="Conversational Tone">Cách nói chuyện</span>
                                    <span style="font-size:10px;text-transform:uppercase;color:var(--accent);font-weight:700;background:var(--accent-soft);padding:1px 6px;border-radius:4px;" data-vi="Cần thước đo" data-en="Needs Metric">Cần thước đo</span>
                                </div>
                                <div class="desc" data-vi="Đã bỏ mẫu cứng, cho AI viết giọng lễ tân trên dữ liệu kiểm chứng. Đúng hướng nhưng chưa có cách chấm điểm xem có thật sự tự nhiên hơn không." data-en="Replaced rigid templates with 5-star concierge voice on verified facts. Right direction, but lacks an objective score for naturalness.">Đã bỏ mẫu cứng, cho AI viết giọng lễ tân trên dữ liệu kiểm chứng. Đúng hướng nhưng chưa có cách chấm điểm xem có thật sự tự nhiên hơn không.</div>
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
                                    <span data-vi="Quy trình lên production" data-en="Production Deployment">Quy trình lên production</span>
                                    <span style="font-size:10px;text-transform:uppercase;color:#C0182F;font-weight:700;background:#FCEBEB;padding:1px 6px;border-radius:4px;" data-vi="Sửa ngay" data-en="Fix Now">Sửa ngay</span>
                                </div>
                                <div class="desc" data-vi="Bản sửa lỗi tính tiền gói lặn xong từ hôm qua nhưng production chưa có — đẩy code lên kho chung chưa tự sync máy chủ thật." data-en="Diving package pricing fix passed testing yesterday but is not live on production — pushing to repo lacks automatic production sync.">Bản sửa lỗi tính tiền gói lặn xong từ hôm qua nhưng production chưa có — đẩy code lên kho chung chưa tự sync máy chủ thật.</div>
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
                                    <span data-vi="Tính giá &amp; xuất báo giá" data-en="Pricing &amp; Quotation">Tính giá &amp; xuất báo giá</span>
                                    <span style="font-size:10px;text-transform:uppercase;color:var(--trigger);font-weight:700;background:var(--trigger-soft);padding:1px 6px;border-radius:4px;" data-vi="Chờ người" data-en="Blocked">Chờ người</span>
                                </div>
                                <div class="desc" data-vi="Cấu trúc dữ liệu Odoo chưa chốt, nên cố ý chưa viết dòng code nào nối Odoo để tránh rủi ro đập đi xây lại." data-en="Odoo data contract is not finalized by Phillip. Intentionally not coded yet to avoid costly rework.">Cấu trúc dữ liệu Odoo chưa chốt, nên cố ý chưa viết dòng code nào nối Odoo để tránh rủi ro đập đi xây lại.</div>
                            </div>
                        </li>
                    </ul>
                    <span class="arrow right" aria-hidden="true">→</span>
                </div>

                <!-- PANEL 2: CENTER BLACK-BOX · BỘ ĐẾM & BÓC TÁCH NGUYÊN NHÂN -->
                <div class="panel blackbox">
                    <div class="panel-title"><span class="dot"></span><span data-vi="Thực trạng &amp; Bóc tách nguyên nhân" data-en="Reality &amp; Root Cause Analysis">Thực trạng &amp; Bóc tách nguyên nhân</span></div>
                    <h2 data-vi="Đo rất kỹ không bịa — Chưa từng đo tự nhiên" data-en="Strict Zero-Hallucination — Zero Naturalness Metrics">Đo rất kỹ không bịa — Chưa từng đo tự nhiên</h2>
                    <p class="sub" data-vi="Lead nhận xét bot 'cứng' — bản chất là 3 nguyên nhân riêng biệt cần 3 cách xử lý khác nhau." data-en="Lead feedback on bot rigidity boils down to 3 distinct causes requiring 3 different remedies.">Lead nhận xét bot 'cứng' — bản chất là 3 nguyên nhân riêng biệt cần 3 cách xử lý khác nhau.</p>

                    <div class="counters">
                        <div class="counter">
                            <div class="num" data-count="0">0</div>
                            <div class="lbl" data-vi="% Bịa Dữ Liệu (Factual)" data-en="% Hallucination Rate">% Bịa Dữ Liệu (Factual)</div>
                            <div class="sub" data-vi="Đo trên 30 kịch bản ngặt nghèo" data-en="Benchmarked across 30 strict cases">Đo trên 30 kịch bản ngặt nghèo</div>
                        </div>
                        <div class="counter">
                            <div class="num" data-count="230">0</div>
                            <div class="lbl" data-vi="Bài Test Xanh 100%" data-en="Green Tests 100%">Bài Test Xanh 100%</div>
                            <div class="sub" data-vi="Regression suite tự động mỗi commit" data-en="Automated regression suite">Regression suite tự động mỗi commit</div>
                        </div>
                        <div class="counter">
                            <div class="num" data-count="3">0</div>
                            <div class="lbl" data-vi="Nguyên Nhân 'Cứng'" data-en="Rigidity Causes">Nguyên Nhân 'Cứng'</div>
                            <div class="sub" data-vi="Dùng từ · Hỏi sai chỗ · Khuôn ô" data-en="Phrasing · Wrong question · Slots">Dùng từ · Hỏi sai chỗ · Khuôn ô</div>
                        </div>
                        <div class="counter">
                            <div class="num" data-count="2">0</div>
                            <div class="lbl" data-vi="Việc Cần Lead Hỗ Trợ" data-en="Lead Action Items">Việc Cần Lead Hỗ Trợ</div>
                            <div class="sub" data-vi="Thúc schema Odoo &amp; Xin 30 tin thật" data-en="Unblock Odoo &amp; 30 real transcripts">Thúc schema Odoo &amp; Xin 30 tin thật</div>
                        </div>
                    </div>

                    <p class="box-sum" data-vi="&lt;b&gt;Bóc tách 3 nguyên nhân:&lt;/b&gt; (1) &lt;i&gt;Dùng từ:&lt;/i&gt; Đã sửa bằng giọng lễ tân. (2) &lt;i&gt;Hỏi lại thứ khách vừa nói:&lt;/i&gt; Chưa sửa — câu chữ mượt không cứu được, phải sửa ở chỗ &lt;b&gt;quyết định hỏi gì&lt;/b&gt;. (3) &lt;i&gt;Khuôn dữ liệu:&lt;/i&gt; Ý khách phong phú hơn ô trống — chấp nhận chuyển nhân viên đọc phần phức tạp. &lt;b&gt;Chưa ai chấm điểm tự nhiên lần nào:&lt;/b&gt; Cần 30 tin nhắn thật từ Eloa để dựng thước đo." data-en="&lt;b&gt;3 Causes Unpacked:&lt;/b&gt; (1) &lt;i&gt;Phrasing:&lt;/i&gt; Fixed with concierge voice. (2) &lt;i&gt;Re-asking what was stated:&lt;/i&gt; Not fixed — smooth wording cannot save this; fix lies in &lt;b&gt;question decision logic&lt;/b&gt;. (3) &lt;i&gt;Slots vs nuances:&lt;/i&gt; Hand off complex edge cases to human staff. &lt;b&gt;Never measured naturalness:&lt;/b&gt; Requires 30 real transcripts from Eloa."><b>Bóc tách 3 nguyên nhân:</b> (1) <i>Dùng từ:</i> Đã sửa bằng giọng lễ tân. (2) <i>Hỏi lại thứ khách vừa nói:</i> Chưa sửa — câu chữ mượt không cứu được, phải sửa ở chỗ <b>quyết định hỏi gì</b>. (3) <i>Khuôn dữ liệu:</i> Ý khách phong phú hơn ô trống — chấp nhận chuyển nhân viên đọc phần phức tạp. <b>Chưa ai chấm điểm tự nhiên lần nào:</b> Cần 30 tin nhắn thật từ Eloa để dựng thước đo.</p>

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
                    <div class="panel-title"><span class="dot"></span><span data-vi="Outputs · Tóm tắt hành động" data-en="Outputs · Action Summary">Outputs · Tóm tắt hành động</span></div>
                    <h2 data-vi="Lộ trình ưu tiên phân định rõ ràng" data-en="Prioritized Action Roadmap">Lộ trình ưu tiên phân định rõ ràng</h2>
                    <p class="sub" data-vi="Chi tiết xem toàn văn phần 2 ngay bên dưới." data-en="Read Section 2 below for the complete executive breakdown.">Chi tiết xem toàn văn phần 2 ngay bên dưới.</p>
                    <div class="out-list">
                        <div class="out-card" style="border-left:3px solid var(--tool);">
                            <div class="head">
                                <span class="tag" style="background:var(--tool-soft);color:var(--tool);" data-vi="Làm ngay — không chờ ai" data-en="Immediate — No blockers">Làm ngay — không chờ ai</span>
                                <span class="ext">4 tasks</span>
                            </div>
                            <div class="desc" data-vi="&lt;b&gt;1.&lt;/b&gt; Đưa bản sửa tính tiền lên prod &amp; rà soát hotfix.&lt;br&gt;&lt;b&gt;2.&lt;/b&gt; Thêm lớp đối chiếu con số/ngày trong câu AI.&lt;br&gt;&lt;b&gt;3.&lt;/b&gt; Sửa hỏi lại thứ khách vừa nói (đẩy nhân viên).&lt;br&gt;&lt;b&gt;4.&lt;/b&gt; Quét 2 lỗi tính tiền còn lại (đại lý giảm 30%)." data-en="&lt;b&gt;1.&lt;/b&gt; Deploy pricing fix to prod &amp; audit hotfixes.&lt;br&gt;&lt;b&gt;2.&lt;/b&gt; Add number/date verification guardrail on AI reply.&lt;br&gt;&lt;b&gt;3.&lt;/b&gt; Stop re-asking answered details (hand off to staff).&lt;br&gt;&lt;b&gt;4.&lt;/b&gt; Fix 2 remaining pricing assumptions (agent discount 30%).">
                                <b>1.</b> Đưa bản sửa tính tiền lên prod &amp; rà soát hotfix.<br>
                                <b>2.</b> Thêm lớp đối chiếu con số/ngày trong câu AI.<br>
                                <b>3.</b> Sửa hỏi lại thứ khách vừa nói (đẩy nhân viên).<br>
                                <b>4.</b> Quét 2 lỗi tính tiền còn lại (đại lý giảm 30%).
                            </div>
                        </div>

                        <div class="out-card" style="border-left:3px solid var(--accent);">
                            <div class="head">
                                <span class="tag" style="background:var(--accent-soft);color:var(--accent);" data-vi="Chờ đầu vào từ người khác" data-en="Blocked on Stakeholders">Chờ đầu vào từ người khác</span>
                                <span class="ext">4 blockers</span>
                            </div>
                            <div class="desc" data-vi="&lt;b&gt;1. Phillip:&lt;/b&gt; Chốt cấu trúc dữ liệu Odoo.&lt;br&gt;&lt;b&gt;2. Eloa:&lt;/b&gt; Cung cấp 30 tin nhắn khách thật.&lt;br&gt;&lt;b&gt;3. Anthony:&lt;/b&gt; Duyệt ký đóng biên bản tầng trả lời.&lt;br&gt;&lt;b&gt;4. Jett / Eloa:&lt;/b&gt; Xác nhận 4 giá trị mặc định resort." data-en="&lt;b&gt;1. Phillip:&lt;/b&gt; Finalize Odoo schema contract.&lt;br&gt;&lt;b&gt;2. Eloa:&lt;/b&gt; Supply 30 anonymized real transcripts.&lt;br&gt;&lt;b&gt;3. Anthony:&lt;/b&gt; Sign off ADR on reply architecture.&lt;br&gt;&lt;b&gt;4. Jett / Eloa:&lt;/b&gt; Confirm 4 resort default parameters.">
                                <b>1. Phillip:</b> Chốt cấu trúc dữ liệu Odoo.<br>
                                <b>2. Eloa:</b> Cung cấp 30 tin nhắn khách thật.<br>
                                <b>3. Anthony:</b> Duyệt ký đóng biên bản tầng trả lời.<br>
                                <b>4. Jett / Eloa:</b> Xác nhận 4 giá trị mặc định resort.
                            </div>
                        </div>

                        <div class="out-card" style="border-left:3px solid var(--claude);">
                            <div class="head">
                                <span class="tag" style="background:var(--claude-soft);color:var(--claude);" data-vi="Cần Lead giúp đúng 2 việc" data-en="Lead Action Items">Cần Lead giúp đúng 2 việc</span>
                                <span class="ext">lead action</span>
                            </div>
                            <div class="desc" data-vi="&lt;b&gt;1. Thúc Phillip chốt cấu trúc Odoo&lt;/b&gt; sớm nhất.&lt;br&gt;&lt;b&gt;2. Xin Eloa 30 tin nhắn khách thật&lt;/b&gt; để đo giọng văn." data-en="&lt;b&gt;1. Unblock Phillip on Odoo schema&lt;/b&gt; for quotations.&lt;br&gt;&lt;b&gt;2. Request 30 real transcripts from Eloa&lt;/b&gt; for tone scoring.">
                                <b>1. Thúc Phillip chốt cấu trúc Odoo</b> sớm nhất.<br>
                                <b>2. Xin Eloa 30 tin nhắn khách thật</b> để đo giọng văn.
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </section>

        <!-- ============================================================
       SECTION 2 · TOÀN VĂN KẾ HOẠCH CHO LEAD (NON-TECHNICAL & CHI TIẾT)
       ============================================================ -->
        <section class="section" id="plan-detail">
            <span class="kicker" data-vi="Chi Tiết Bản Kế Hoạch Cho Lead · Không Cần Đọc Code" data-en="Executive Plan · No Code Knowledge Required">Chi Tiết Bản Kế Hoạch Cho Lead · Không Cần Đọc Code</span>
            <h1 data-vi="Hiểu Đúng Thực Trạng &amp; Kế Hoạch Nâng Cấp &lt;span class=&quot;thin&quot;&gt;— Trợ Lý Đặt Phòng&lt;/span&gt;" data-en="Plain-Language Breakdown &amp; Action Plan &lt;span class=&quot;thin&quot;&gt;— Booking Assistant&lt;/span&gt;">Hiểu Đúng Thực Trạng &amp; Kế Hoạch Nâng Cấp <span class="thin">— Trợ Lý Đặt Phòng</span></h1>
            <p class="lede" data-vi="Dành riêng cho Lead và các cấp quản lý: Giải thích cặn kẽ nguyên lý hoạt động bằng ngôn ngữ đời thường, phân tích vì sao bot bị chê 'cứng', và vạch rõ những việc team tự làm được vs những việc đang cần Lead hỗ trợ can thiệp." data-en="Tailored for Tech Lead and stakeholders: Plain-language operational model, root-cause analysis of bot rigidity, and an actionable roadmap separating engineering tasks from external dependencies.">Dành riêng cho Lead và các cấp quản lý: Giải thích cặn kẽ nguyên lý hoạt động bằng ngôn ngữ đời thường, phân tích vì sao bot bị chê 'cứng', và vạch rõ những việc team tự làm được vs những việc đang cần Lead hỗ trợ can thiệp.</p>

            <div class="plan-doc">

                <!-- 0. MENTAL MODEL CHO NGƯỜI KHÔNG ĐỌC CODE -->
                <div class="mental-model-card">
                    <h3 data-vi="Mô hình hoạt động thực tế: 'Người Lễ Tân Đứng Cửa Khách Sạn'" data-en="Operational Mental Model: 'The 5-Star Hotel Front Concierge'">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <span data-vi="Mô hình hoạt động thực tế: 'Người Lễ Tân Đứng Cửa Khách Sạn'" data-en="Operational Mental Model: 'The 5-Star Hotel Front Concierge'">Mô hình hoạt động thực tế: 'Người Lễ Tân Đứng Cửa Khách Sạn'</span>
                    </h3>
                    <p style="margin:0;color:var(--muted);font-size:14.5px;line-height:1.55;" data-vi="Để hiểu rõ hệ thống mà không cần nhìn vào dòng code nào, hãy hình dung trợ lý AI này chính là một &lt;b&gt;Nhân viên Lễ tân đứng ở sảnh Casa Escondida&lt;/b&gt;:" data-en="To understand the system without looking at code, picture this AI assistant as a &lt;b&gt;Front Concierge standing in the resort lobby&lt;/b&gt;:">Để hiểu rõ hệ thống mà không cần nhìn vào dòng code nào, hãy hình dung trợ lý AI này chính là một <b>Nhân viên Lễ tân đứng ở sảnh Casa Escondida</b>:</p>

                    <div class="mental-grid">
                        <div class="mental-item">
                            <span class="role" style="color:var(--tool);" data-vi="1. Đón tiếp &amp; Lắng nghe" data-en="1. Greeting &amp; Listening">1. Đón tiếp &amp; Lắng nghe</span>
                            <span class="duty" data-vi="Tiếp chuyện đa ngôn ngữ" data-en="Multi-lingual Hospitality">Tiếp chuyện đa ngôn ngữ</span>
                            <span class="expl" data-vi="Khách nói tiếng Anh, Việt hay Trung, viết tắt hay nói 'thứ 7 tuần sau' đều hiểu chính xác như một nhân viên thật." data-en="Understands English, Vietnamese, or Chinese, slang or relative dates ('next Saturday') just like a human concierge.">Khách nói tiếng Anh, Việt hay Trung, viết tắt hay nói 'thứ 7 tuần sau' đều hiểu chính xác như một nhân viên thật.</span>
                        </div>
                        <div class="mental-item">
                            <span class="role" style="color:var(--accent);" data-vi="2. Hỏi thăm lịch trình" data-en="2. Collecting Details">2. Hỏi thăm lịch trình</span>
                            <span class="duty" data-vi="Hỏi nốt thông tin thiếu" data-en="Clarifying Missing Info">Hỏi nốt thông tin thiếu</span>
                            <span class="expl" data-vi="Ghi nhận số khách, ngày đến/đi, nhu cầu lặn biển. Chỉ hỏi những gì chưa biết, tuyệt đối không làm phiền khách." data-en="Records guest counts, check-in/out, and dive window. Inquires only about missing essentials politely.">Ghi nhận số khách, ngày đến/đi, nhu cầu lặn biển. Chỉ hỏi những gì chưa biết, tuyệt đối không làm phiền khách.</span>
                        </div>
                        <div class="mental-item" style="border:1.5px solid #F0C4B8;background:#FFF9F6;">
                            <span class="role" style="color:var(--claude-2);" data-vi="3. Giới hạn quyền hạn" data-en="3. Authority Boundaries">3. Giới hạn quyền hạn</span>
                            <span class="duty" style="color:var(--claude-2);" data-vi="Cấm tự ý chốt giá / phòng" data-en="Zero Pricing Authority">Cấm tự ý chốt giá / phòng</span>
                            <span class="expl" data-vi="Lễ tân AI &lt;b&gt;không được tự bịa giá, không được hứa bừa còn phòng&lt;/b&gt;. Mọi con số đều được kiểm chứng chặt chẽ." data-en="AI concierge &lt;b&gt;never invents rates or promises room availability&lt;/b&gt;. Enforced by strict code guardrails.">Lễ tân AI <b>không được tự bịa giá, không được hứa bừa còn phòng</b>. Mọi con số đều được kiểm chứng chặt chẽ.</span>
                        </div>
                        <div class="mental-item">
                            <span class="role" style="color:var(--trigger);" data-vi="4. Bàn giao Odoo" data-en="4. ERP Hand-off">4. Bàn giao Odoo</span>
                            <span class="duty" data-vi="Chuyển phiếu cho nhân viên" data-en="Staff &amp; ERP Booking">Chuyển phiếu cho nhân viên</span>
                            <span class="expl" data-vi="Đưa phiếu thông tin cho nhân viên resort và hệ thống Odoo để kiểm tra kho phòng và gửi hóa đơn chính thức." data-en="Hands verified enquiry summary to human staff and Odoo ERP to verify inventory and issue official invoices.">Đưa phiếu thông tin cho nhân viên resort và hệ thống Odoo để kiểm tra kho phòng và gửi hóa đơn chính thức.</span>
                        </div>
                    </div>
                </div>

                <!-- 1. BÓC TÁCH 3 NGUYÊN NHÂN "CỨNG" -->
                <div class="plan-header-block">
                    <h2 data-vi="Vấn đề Lead nêu: Bot nói chuyện thiếu tự nhiên" data-en="Lead Feedback: The Bot Sounds Too Rigid &amp; Mechanical">Vấn đề Lead nêu: Bot nói chuyện thiếu tự nhiên</h2>
                    <p style="margin:0;color:var(--muted);font-size:15px;line-height:1.5;" data-vi="Gọi chung là 'cứng', nhưng thật ra là &lt;b&gt;ba nguyên nhân hoàn toàn khác nhau&lt;/b&gt; cần &lt;b&gt;ba cách chữa khác nhau&lt;/b&gt;. Gộp chung lại chính là lý do vì sao trước đây sửa mãi mà không thấy khá hơn." data-en="Referred to broadly as 'rigid', but in reality it stems from &lt;b&gt;three distinct root causes&lt;/b&gt; requiring &lt;b&gt;three different remedies&lt;/b&gt;. Conflating them was the reason past attempts showed little visible improvement.">Gọi chung là 'cứng', nhưng thật ra là <b>ba nguyên nhân hoàn toàn khác nhau</b> cần <b>ba cách chữa khác nhau</b>. Gộp chung lại chính là lý do vì sao trước đây sửa mãi mà không thấy khá hơn.</p>
                </div>

                <div class="causes-grid">
                    <!-- Nguyên nhân 1 -->
                    <div class="cause-card">
                        <div class="cause-num" data-vi="Nguyên nhân 1 · Cách dùng từ" data-en="Cause 1 · Wording &amp; Phrasing">Nguyên nhân 1 · Cách dùng từ</div>
                        <h3 data-vi="Câu chữ khô như máy đọc" data-en="Robotic, Scripted Phrasing">Câu chữ khô như máy đọc</h3>
                        <span class="status-pill fixed" data-vi="Đã sửa tuần này" data-en="Resolved This Week">Đã sửa tuần này</span>
                        <p style="margin:0;color:var(--muted);font-size:13.5px;line-height:1.45;" data-vi="Trước đây câu trả lời là mẫu câu dập sẵn, khách đọc vào có cảm giác như đang nhắn tin với tổng đài trả lời tự động." data-en="Previously replies used fixed boilerplate templates. Guests felt like chatting with an automated IVR robot.">Trước đây câu trả lời là mẫu câu dập sẵn, khách đọc vào có cảm giác như đang nhắn tin với tổng đài trả lời tự động.</p>
                        
                        <div class="chat-compare">
                            <div class="chat-bubble bad" data-vi="&lt;b&gt;❌ Trước đây:&lt;/b&gt; 'Quý khách vui lòng cung cấp số lượng khách và ngày nhận phòng để được tư vấn.'" data-en="&lt;b&gt;❌ Before:&lt;/b&gt; 'Customer please provide guest count and check-in date for booking assistance.'">
                                <b>❌ Trước đây:</b> "Quý khách vui lòng cung cấp số lượng khách và ngày nhận phòng để được tư vấn."
                            </div>
                            <div class="chat-bubble good" data-vi="&lt;b&gt;✅ Đã sửa:&lt;/b&gt; 'Dạ em chào anh Marcus! Rất vui được hỗ trợ gia đình mình chuẩn bị cho chuyến nghỉ dưỡng tại Anilao sắp tới...'" data-en="&lt;b&gt;✅ Now:&lt;/b&gt; 'Warm greetings Marcus! Delighted to assist your family planning your relaxing getaway to Anilao...'">
                                <b>✅ Đã sửa:</b> "Dạ em chào anh Marcus! Rất vui được hỗ trợ gia đình mình chuẩn bị cho chuyến nghỉ dưỡng tại Anilao sắp tới..."
                            </div>
                        </div>
                    </div>

                    <!-- Nguyên nhân 2 -->
                    <div class="cause-card urgent">
                        <div class="cause-num" style="color:#C0182F;" data-vi="Nguyên nhân 2 · Hỏi sai chỗ (Tệ nhất)" data-en="Cause 2 · Bad Targeting (Worst)">Nguyên nhân 2 · Hỏi sai chỗ (Tệ nhất)</div>
                        <h3 style="color:#A01427;" data-vi="Hỏi lại thứ khách vừa nói" data-en="Re-asking What Was Just Said">Hỏi lại thứ khách vừa nói</h3>
                        <span class="status-pill pending" data-vi="Chưa sửa — Trọng tâm tuần này" data-en="Unfixed — Core Sprint Focus">Chưa sửa — Trọng tâm tuần này</span>
                        <p style="margin:0;color:var(--muted);font-size:13.5px;line-height:1.45;" data-vi="Khách viết câu rất tự nhiên: &lt;i&gt;'Nhà mình 6 người, ngày đầu 1 bạn lặn thử, ngày 2 có 5 người lặn cả ngày'&lt;/i&gt;. Máy không quy được về 1 con số nên coi như chưa biết và &lt;b&gt;hỏi lại&lt;/b&gt;!" data-en="Guest writes naturally: &lt;i&gt;'Group of 6, on day 1 one person dives, on day 2 five people dive all day'&lt;/i&gt;. The system fails to collapse this into one integer, so it treats it as blank and &lt;b&gt;re-asks&lt;/b&gt;!">Khách viết câu rất tự nhiên: <i>'Nhà mình 6 người, ngày đầu 1 bạn lặn thử, ngày 2 có 5 người lặn cả ngày'</i>. Máy không quy được về 1 con số nên coi như chưa biết và <b>hỏi lại</b>!</p>
                        
                        <div class="chat-compare">
                            <div class="chat-bubble bad" data-vi="&lt;b&gt;❌ Bệnh cũ:&lt;/b&gt; Máy hỏi: 'Dạ cho em hỏi đoàn mình có bao nhiêu người đi lặn ạ?' &lt;br&gt;&amp;rarr; &lt;i&gt;Khách bực mình: 'Ủa tôi vừa nói rõ ở trên rồi mà?!'&lt;/i&gt;" data-en="&lt;b&gt;❌ Current Bug:&lt;/b&gt; Bot asks: 'How many people in your group are diving?' &lt;br&gt;&amp;rarr; &lt;i&gt;Guest gets annoyed: 'I literally just told you above!'&lt;/i&gt;">
                                <b>❌ Bệnh cũ:</b> Máy hỏi: "Dạ cho em hỏi đoàn mình có bao nhiêu người đi lặn ạ?" <br>&rarr; <i>Khách bực mình: "Ủa tôi vừa nói rõ ở trên rồi mà?!"</i>
                            </div>
                            <div class="chat-bubble good" data-vi="&lt;b&gt;✅ Cách sửa:&lt;/b&gt; CẤM HỎI LẠI! Ghi nguyên văn câu của khách vào ô 'Ghi chú đặc biệt', hỏi sang chuyện khác (như giờ đón), rồi chuyển nhân viên thật đọc!" data-en="&lt;b&gt;✅ The Remedy:&lt;/b&gt; NEVER RE-ASK! Save the verbatim note into 'Special Requests', move to another topic (e.g. transfers), and let human staff arrange the schedule!">
                                <b>✅ Cách sửa:</b> CẤM HỎI LẠI! Ghi nguyên văn câu của khách vào ô 'Ghi chú đặc biệt', hỏi sang chuyện khác (như giờ đón), rồi chuyển nhân viên thật đọc!
                            </div>
                        </div>
                    </div>

                    <!-- Nguyên nhân 3 -->
                    <div class="cause-card">
                        <div class="cause-num" data-vi="Nguyên nhân 3 · Khuôn dữ liệu" data-en="Cause 3 · Fixed Data Slots">Nguyên nhân 3 · Khuôn dữ liệu</div>
                        <h3 data-vi="Ý khách phong phú hơn ô trống" data-en="Human Nuances vs Empty Form Slots">Ý khách phong phú hơn ô trống</h3>
                        <span class="status-pill partial" data-vi="Đã đỡ một phần" data-en="Partially Mitigated">Đã đỡ một phần</span>
                        <p style="margin:0;color:var(--muted);font-size:13.5px;line-height:1.45;" data-vi="Khách có muôn vàn nhu cầu: ăn chay, mang theo cún cưng, xin phòng tầng trệt cho người già... Phần mềm không thể đẻ ra hàng trăm ô trống cho mọi sở thích." data-en="Guests have countless personal needs: vegetarian food, pet policy, ground floor room for seniors... Software cannot create hundreds of rigid slots for every human nuance.">Khách có muôn vàn nhu cầu: ăn chay, mang theo cún cưng, xin phòng tầng trệt cho người già... Phần mềm không thể đẻ ra hàng trăm ô trống cho mọi sở thích.</p>
                        
                        <div style="padding:10px 12px;background:var(--bg);border-radius:8px;font-size:12.5px;color:var(--ink-soft);border:1px solid var(--line-soft);" data-vi="&lt;b&gt;Giải pháp chuẩn mực:&lt;/b&gt; Những ô cơ bản (ngày, số người) thì máy tự thu thập. Mọi yêu cầu phức tạp còn lại thì giữ nguyên lời khách để nhân viên chăm sóc riêng." data-en="&lt;b&gt;Standard Solution:&lt;/b&gt; Routine parameters (dates, guests) are captured by code. All rich personalized nuances are preserved verbatim for human concierge follow-up.">
                            <b>Giải pháp chuẩn mực:</b> Những ô cơ bản (ngày, số người) thì máy tự thu thập. Mọi yêu cầu phức tạp còn lại thì giữ nguyên lời khách để nhân viên chăm sóc riêng.
                        </div>
                    </div>
                </div>

                <!-- 2. THƯỚC ĐO: VÌ SAO CỨ CỨNG MÃI -->
                <div class="measure-box">
                    <h3 style="font-family:'Playfair Display',serif;font-size:20px;margin:0 0 6px;" data-vi="Vì sao nó cứ cứng mãi: Mình chưa từng đo cái đó!" data-en="Why Does It Stay Rigid? Because We Never Measured Tone!">Vì sao nó cứ cứng mãi: Mình chưa từng đo cái đó!</h3>
                    <p style="margin:0 0 14px;color:var(--muted);font-size:14px;" data-vi="Trong quản trị: &lt;b&gt;'Cái gì được đo thì cái đó mới được cải thiện'&lt;/b&gt;. Dự án suốt thời gian qua đo rất kỹ xem AI có 'bịa đặt thông tin' không — kết quả đạt &lt;b&gt;0% bịa&lt;/b&gt; (cực kỳ xuất sắc). Nhưng bot nói chuyện có 'duyên' không thì &lt;b&gt;chưa từng được chấm điểm lần nào&lt;/b&gt;!" data-en="In engineering management: &lt;b&gt;'What gets measured gets improved'&lt;/b&gt;. We rigorously measured factual fabrication — achieving &lt;b&gt;0% hallucination&lt;/b&gt; (flawless). But conversational charm and question targeting have &lt;b&gt;never been scored a single time&lt;/b&gt;!">Trong quản trị: <b>'Cái gì được đo thì cái đó mới được cải thiện'</b>. Dự án suốt thời gian qua đo rất kỹ xem AI có 'bịa đặt thông tin' không — kết quả đạt <b>0% bịa</b> (cực kỳ xuất sắc). Nhưng bot nói chuyện có 'duyên' không thì <b>chưa từng được chấm điểm lần nào</b>!</p>

                    <table class="measure-table">
                        <thead>
                            <tr>
                                <th style="width:25%;" data-vi="Hạng Mục Đánh Giá" data-en="Evaluation Domain">Hạng Mục Đánh Giá</th>
                                <th style="width:20%;" data-vi="Điểm Số Hiện Tại" data-en="Current Score">Điểm Số Hiện Tại</th>
                                <th style="width:55%;" data-vi="Bản Chất &amp; Cách Cải Thiện" data-en="Reality &amp; Action Plan">Bản Chất &amp; Cách Cải Thiện</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="font-weight:700;color:var(--tool);" data-vi="Đo rất kỹ (An toàn)" data-en="Strictly Measured (Safety)">Đo rất kỹ (An toàn)</td>
                                <td><span style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:var(--tool);">0%</span></td>
                                <td data-vi="Bịa dữ liệu · trích dẫn sai · sai ngày · sai số khách. (Chấm tự động mỗi lần lưu code &amp;rarr; &lt;b&gt;Làm rất tốt và an toàn&lt;/b&gt;)." data-en="Data hallucination · incorrect quotes · wrong dates · mistaken guest count. (Checked on every git commit &amp;rarr; &lt;b&gt;Reliable &amp; safe&lt;/b&gt;).">Bịa dữ liệu · trích dẫn sai · sai ngày · sai số khách. (Chấm tự động mỗi lần lưu code &rarr; <b>Làm rất tốt và an toàn</b>).</td>
                            </tr>
                            <tr>
                                <td style="font-weight:700;color:#C0182F;" data-vi="Chưa hề đo (Trải nghiệm)" data-en="Unmeasured (Experience)">Chưa hề đo (Trải nghiệm)</td>
                                <td><span style="font-family:'JetBrains Mono';font-size:16px;font-weight:700;color:#C0182F;">Chưa có</span></td>
                                <td data-vi="Hỏi thừa · hỏi lại thứ khách đã nói · độ ấm áp · cảm giác của khách. (Báo cáo ghi rõ: &lt;code&gt;needs human pass&lt;/code&gt; &amp;rarr; &lt;b&gt;Cần 30 tin nhắn thật từ Eloa để làm thước đo&lt;/b&gt;)." data-en="Redundant questions · re-asking stated facts · warmth · guest sentiment. (Report logs: &lt;code&gt;needs human pass&lt;/code&gt; &amp;rarr; &lt;b&gt;Needs 30 real transcripts from Eloa to establish benchmarks&lt;/b&gt;).">Hỏi thừa · hỏi lại thứ khách đã nói · độ ấm áp · cảm giác của khách. (Báo cáo ghi rõ: <code>needs human pass</code> &rarr; <b>Cần 30 tin nhắn thật từ Eloa để làm thước đo</b>).</td>
                            </tr>
                        </tbody>
                    </table>
                    <p style="margin:12px 0 0;font-size:13px;color:var(--muted);font-style:italic;" data-vi="* Kết luận của team: Phần 'không bịa' tốt vì được chấm điểm mỗi ngày; phần 'nói chuyện duyên' bị chê vì chưa ai chấm điểm nó lần nào — chứ không phải vì nó khó làm hơn!" data-en="* Team takeaway: Zero-hallucination succeeds because it is graded daily; conversational charm lagged because it was never scored — not because it is inherently harder!">
                        * Kết luận của team: Phần 'không bịa' tốt vì được chấm điểm mỗi ngày; phần 'nói chuyện duyên' bị chê vì chưa ai chấm điểm nó lần nào — chứ không phải vì nó khó làm hơn!
                    </p>
                </div>

                <!-- 3. HAI CỘT HÀNH ĐỘNG: LÀM NGAY VS CHỜ NGƯỜI -->
                <div class="plan-two-col">

                    <!-- Cột 1: Làm ngay -->
                    <div class="action-card" style="border-top:4px solid var(--tool);">
                        <h3>
                            <span style="width:10px;height:10px;border-radius:99px;background:var(--tool);display:inline-block;"></span>
                            <span data-vi="Làm ngay — Team tự làm không chờ ai" data-en="Immediate — Engineering Self-Driven">Làm ngay — Team tự làm không chờ ai</span>
                        </h3>
                        <p style="margin:0;font-size:13px;color:var(--muted);" data-vi="Đội ngũ kỹ thuật chủ động triển khai dứt điểm ngay trong tuần này:" data-en="Engineering team takes full ownership to execute this week:">Đội ngũ kỹ thuật chủ động triển khai dứt điểm ngay trong tuần này:</p>

                        <div class="task-list">
                            <div class="task-row">
                                <div class="head">
                                    <span data-vi="1. Đưa bản sửa lỗi tính tiền lên máy chủ thật" data-en="1. Deploy Pricing Hotfix to Live Production">1. Đưa bản sửa lỗi tính tiền lên máy chủ thật</span>
                                    <span class="badge-owner" style="background:#FCEBEB;color:#C0182F;">URGENT</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);" data-vi="Đã xong và test kỹ từ hôm qua nhưng chưa live do thiếu auto-sync CI/CD. Đưa lên ngay và rà soát các bản sửa kẹt." data-en="Completed and verified yesterday but stuck due to lack of auto-sync CI/CD. Deploying immediately and auditing pipeline.">Đã xong và test kỹ từ hôm qua nhưng chưa live do thiếu auto-sync CI/CD. Đưa lên ngay và rà soát các bản sửa kẹt.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span data-vi="2. Thêm 'Bộ lọc an toàn' cho câu AI viết" data-en="2. Add Verification Guardrail on AI Sentences">2. Thêm 'Bộ lọc an toàn' cho câu AI viết</span>
                                    <span class="badge-owner" style="background:var(--tool-soft);color:var(--tool);">CODE CHECK</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);" data-vi="Lập trình đối chiếu mọi con số và ngày tháng trong câu AI viết với dữ liệu gốc; nếu thấy lệch số là lập tức quay về mẫu an toàn." data-en="Programmatic sanity check cross-referencing all numbers and dates in the AI response against verified facts; roll back on mismatch.">Lập trình đối chiếu mọi con số và ngày tháng trong câu AI viết với dữ liệu gốc; nếu thấy lệch số là lập tức quay về mẫu an toàn.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span data-vi="3. Sửa dứt điểm tật 'Hỏi lại thứ khách vừa nói'" data-en="3. Fix 'Re-asking Stated Info' (Cause 2)">3. Sửa dứt điểm tật 'Hỏi lại thứ khách vừa nói'</span>
                                    <span class="badge-owner" style="background:var(--accent-soft);color:var(--accent);">LOGIC FIX</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);" data-vi="Khi khách nói lịch lặn phức tạp không quy về một con số được, lập trình cho máy ghi vào 'Ghi chú đặc biệt' và chuyển nhân viên đọc thay vì hỏi lại." data-en="When guests describe complex schedules that don't fit a single integer, record in 'Special Notes' and alert staff instead of re-asking.">Khi khách nói lịch lặn phức tạp không quy về một con số được, lập trình cho máy ghi vào 'Ghi chú đặc biệt' và chuyển nhân viên đọc thay vì hỏi lại.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span data-vi="4. Quét nốt 2 lỗi tính tiền còn lại" data-en="4. Audit 2 Remaining Pricing Assumptions">4. Quét nốt 2 lỗi tính tiền còn lại</span>
                                    <span class="badge-owner" style="background:var(--bg2);color:var(--accent);">PRICING</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);" data-vi="Hai thông tin ảnh hưởng trực tiếp tới giá đang bị hệ thống tự phỏng đoán thay vì hỏi — đặc biệt là loại khách (đại lý được giảm giá 30%)." data-en="Two parameters directly affecting prices are currently guessed instead of confirmed — notably agency guests (entitled to 30% discount).">Hai thông tin ảnh hưởng trực tiếp tới giá đang bị hệ thống tự phỏng đoán thay vì hỏi — đặc biệt là loại khách (đại lý được giảm giá 30%).</div>
                            </div>
                        </div>
                    </div>

                    <!-- Cột 2: Chờ đầu vào -->
                    <div class="action-card" style="border-top:4px solid var(--accent);">
                        <h3>
                            <span style="width:10px;height:10px;border-radius:99px;background:var(--accent);display:inline-block;"></span>
                            <span data-vi="Chờ đầu vào từ người khác (Đang bị nghẽn)" data-en="Blocked on Stakeholders (Waiting)">Chờ đầu vào từ người khác (Đang bị nghẽn)</span>
                        </h3>
                        <p style="margin:0;font-size:13px;color:var(--muted);" data-vi="Những mắt xích phụ thuộc bên ngoài đang chặn bước tiến của team:" data-en="External dependencies currently blocking engineering progress:">Những mắt xích phụ thuộc bên ngoài đang chặn bước tiến của team:</p>

                        <div class="task-list">
                            <div class="task-row">
                                <div class="head">
                                    <span data-vi="1. Chốt cấu trúc dữ liệu Odoo" data-en="1. Finalize Odoo Data Contract">1. Chốt cấu trúc dữ liệu Odoo</span>
                                    <span class="badge-owner">PHILLIP</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);" data-vi="Chặn toàn bộ hướng tính giá, xuất báo giá và link báo giá gửi khách. Đây là mắt xích quan trọng nhất cần tháo gỡ." data-en="Blocks all quotation generation, pricing pipelines, and guest quotation links. Earliest and most critical bottleneck.">Chặn toàn bộ hướng tính giá, xuất báo giá và link báo giá gửi khách. Đây là mắt xích quan trọng nhất cần tháo gỡ.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span data-vi="2. 30 tin nhắn khách thật (ẩn danh)" data-en="2. 30 Anonymized Real Transcripts">2. 30 tin nhắn khách thật (ẩn danh)</span>
                                    <span class="badge-owner">ELOA</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);" data-vi="Có mẫu tin nhắn thật mới dựng được 'thang chấm điểm tự nhiên' — thứ duy nhất chứng minh được bot đã hết cứng hay chưa." data-en="Essential to build the benchmark judge for naturalness — proving objectively whether tone upgrades actually worked.">Có mẫu tin nhắn thật mới dựng được 'thang chấm điểm tự nhiên' — thứ duy nhất chứng minh được bot đã hết cứng hay chưa.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span data-vi="3. Duyệt biên bản tầng trả lời" data-en="3. Sign Off Architecture Decision Record">3. Duyệt biên bản tầng trả lời</span>
                                    <span class="badge-owner">ANTHONY</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);" data-vi="Biên bản quyết định kiến trúc cũ vẫn đang chờ ký trong khi code đã đi tiếp. Cần ký đóng lại để tránh hiểu nhầm." data-en="Decision record is pending formal signature while code has moved forward. Needs formal closure to align all teams.">Biên bản quyết định kiến trúc cũ vẫn đang chờ ký trong khi code đã đi tiếp. Cần ký đóng lại để tránh hiểu nhầm.</div>
                            </div>

                            <div class="task-row">
                                <div class="head">
                                    <span data-vi="4. Bốn giá trị mặc định của resort" data-en="4. Four Resort Default Parameters">4. Bốn giá trị mặc định của resort</span>
                                    <span class="badge-owner">JETT / ELOA</span>
                                </div>
                                <div style="font-size:13px;color:var(--muted);" data-vi="Giờ check-in, chính sách em bé... hiện đang là số phỏng đoán. Đoán sai thì sau này bot báo giá sai." data-en="Check-in hours, infant policies are currently assumptions. If wrong, quotations will silently deviate.">Giờ check-in, chính sách em bé... hiện đang là số phỏng đoán. Đoán sai thì sau này bot báo giá sai.</div>
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
                        <span data-vi="Cần Lead giúp đúng hai việc (Nút thắt quyết định)" data-en="Two Critical Actions Needed From Tech Lead">Cần Lead giúp đúng hai việc (Nút thắt quyết định)</span>
                    </h3>
                    <div class="lead-actions-grid">
                        <div style="background:#FFF;padding:20px 22px;border-radius:14px;border:1px solid rgba(217,119,87,.25);box-shadow:0 2px 8px rgba(0,0,0,.03);">
                            <div style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--claude);font-weight:700;margin-bottom:6px;" data-vi="Hành động 1 · Mở khóa tính năng báo giá" data-en="Action 1 · Unblock Quotation Engine">Hành động 1 · Mở khóa tính năng báo giá</div>
                            <div style="font-weight:700;font-size:16px;color:var(--ink);margin-bottom:8px;" data-vi="Thúc Phillip chốt cấu trúc dữ liệu Odoo" data-en="Unblock Phillip on Odoo Schema Specification">Thúc Phillip chốt cấu trúc dữ liệu Odoo</div>
                            <div style="font-size:13.5px;color:var(--muted);line-height:1.5;" data-vi="Mọi thứ liên quan tới báo giá phòng và gói lặn — kể cả link báo giá gửi khách theo chuẩn quốc tế — đang nằm chờ đúng mắt xích này, hoàn toàn không phải chờ đội kỹ thuật." data-en="All quotation and pricing logic — including standardized guest quote links — is blocked on this single contract, not on engineering capacity.">Mọi thứ liên quan tới báo giá phòng và gói lặn — kể cả link báo giá gửi khách theo chuẩn quốc tế — đang nằm chờ đúng mắt xích này, hoàn toàn không phải chờ đội kỹ thuật.</div>
                        </div>

                        <div style="background:#FFF;padding:20px 22px;border-radius:14px;border:1px solid rgba(217,119,87,.25);box-shadow:0 2px 8px rgba(0,0,0,.03);">
                            <div style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--claude);font-weight:700;margin-bottom:6px;" data-vi="Hành động 2 · Dữ liệu để chấm điểm tự nhiên" data-en="Action 2 · Enable Objective Tone Scoring">Hành động 2 · Dữ liệu để chấm điểm tự nhiên</div>
                            <div style="font-weight:700;font-size:16px;color:var(--ink);margin-bottom:8px;" data-vi="Xin Eloa 30 tin nhắn khách thật (đã ẩn danh)" data-en="Obtain 30 Anonymized Real Transcripts from Eloa">Xin Eloa 30 tin nhắn khách thật (đã ẩn danh)</div>
                            <div style="font-size:13.5px;color:var(--muted);line-height:1.5;" data-vi="Không có tin nhắn thật của khách thì việc 'làm cho bot nói chuyện duyên hơn' mãi mãi chỉ là cảm tính — sửa xong không ai chứng minh được bằng số liệu là đã khá hơn hay chưa." data-en="Without authentic customer transcripts, making the bot 'sound natural' remains subjective guesswork. Real data gives us an indisputable quality score.">Không có tin nhắn thật của khách thì việc 'làm cho bot nói chuyện duyên hơn' mãi mãi chỉ là cảm tính — sửa xong không ai chứng minh được bằng số liệu là đã khá hơn hay chưa.</div>
                        </div>
                    </div>
                </div>

                <!-- 5. HAI VIỆC CỐ Ý CHƯA LÀM -->
                <div class="safeguard-box">
                    <h4 data-vi="Hai việc đội ngũ CỐ Ý CHƯA LÀM (Để bảo vệ ngân sách &amp; an toàn dự án)" data-en="Two Things We Deliberately Withheld (To Protect Budget &amp; Factual Safety)">Hai việc đội ngũ CỐ Ý CHƯA LÀM (Để bảo vệ ngân sách &amp; an toàn dự án)</h4>
                    <div style="display:flex;flex-direction:column;gap:12px;font-size:13.5px;color:var(--ink-soft);line-height:1.55;">
                        <div data-vi="&lt;b&gt;Một · Chưa xây bước tính giá và xuất báo giá:&lt;/b&gt; Cấu trúc dữ liệu Odoo chưa được Phillip chốt. Xây trước lúc này giống như xây nhà khi chưa có bản vẽ móng — chắc chắn tuần sau phải đập đi làm lại lãng phí nguồn lực." data-en="&lt;b&gt;One · Withholding Odoo Pricing Automation:&lt;/b&gt; Odoo contract is not finalized. Coding it now is like painting walls before the foundation is laid — guaranteed waste of engineering hours when schemas shift.">
                            <b>Một · Chưa xây bước tính giá và xuất báo giá:</b> Cấu trúc dữ liệu Odoo chưa được Phillip chốt. Xây trước lúc này giống như xây nhà khi chưa có bản vẽ móng — chắc chắn tuần sau phải đập đi làm lại lãng phí nguồn lực.
                        </div>
                        <div data-vi="&lt;b&gt;Hai · Chưa gộp bước đọc tin nhắn và viết câu trả lời vào 1 lượt gọi AI:&lt;/b&gt; Làm gộp thì tiết kiệm được một ít chi phí API, nhưng sẽ làm mất đi 'bộ lọc an toàn'. Bộ lọc này tuần vừa rồi đã ngăn chặn 2 lần AI suýt bịa thông tin cho khách!" data-en="&lt;b&gt;Two · Refusing to merge Extraction and Reply into a Single Model Call:&lt;/b&gt; Merging saves slight API cost, but removes the deterministic fact-checking firewall. That exact firewall intercepted 2 critical hallucinations this week!">
                            <b>Hai · Chưa gộp bước đọc tin nhắn và viết câu trả lời vào 1 lượt gọi AI:</b> Làm gộp thì tiết kiệm được một ít chi phí API, nhưng sẽ làm mất đi 'bộ lọc an toàn'. Bộ lọc này tuần vừa rồi đã ngăn chặn 2 lần AI suýt bịa thông tin cho khách!
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

// 4. Update Section 3 Header
const oldSec2Header = `        <section class="section" id="detail">
            <span class="kicker">Section 2 · Node graph</span>
            <h1>Inside the workflow <span class="thin">— stage by stage</span></h1>
            <p class="lede">Five phases, left to right, for one guest message. Everything orange is a model call;
                everything green is code that checks the model's work. Hover a node (screen) or read the callout
                (print) for its full detail card.</p>`;

const newSec2Header = `        <section class="section" id="detail">
            <span class="kicker" data-vi="Luồng Xử Lý Chi Tiết · Kiến Trúc Lai Neuro-Symbolic" data-en="Inside The Workflow · Hybrid Neuro-Symbolic Pipeline">Luồng Xử Lý Chi Tiết · Kiến Trúc Lai Neuro-Symbolic</span>
            <h1 data-vi="Sơ Đồ Luồng Xử Lý &amp; Ranh Giới Trách Nhiệm &lt;span class=&quot;thin&quot;&gt;— Từng Bước Một&lt;/span&gt;" data-en="System Flow &amp; Trust Boundaries &lt;span class=&quot;thin&quot;&gt;— Step by Step&lt;/span&gt;">Sơ Đồ Luồng Xử Lý &amp; Ranh Giới Trách Nhiệm <span class="thin">— Từng Bước Một</span></h1>
            <p class="lede" data-vi="Mô tả chi tiết luồng dữ liệu từ lúc khách nhắn tin WhatsApp đến khi bàn giao nhân viên chốt giá Odoo. Rê chuột vào từng node để làm sáng luồng liên quan; rê vào node Agent để xem chi tiết nghiệp vụ." data-en="Complete data trace from incoming WhatsApp webhook to human concierge and Odoo ERP handoff. Hover any node to highlight causal paths; hover agent nodes for architectural contracts.">Mô tả chi tiết luồng dữ liệu từ lúc khách nhắn tin WhatsApp đến khi bàn giao nhân viên chốt giá Odoo. Rê chuột vào từng node để làm sáng luồng liên quan; rê vào node Agent để xem chi tiết nghiệp vụ.</p>`;

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

// 6. Append Language Switcher Script before </body>
const langScript = `
    <!-- BILINGUAL ENGINE SCRIPT -->
    <script>
    (function() {
        var STORAGE_KEY = 'casa-showcase-lang';
        var btns = document.querySelectorAll('.lang-btn');
        var translatableEls = document.querySelectorAll('[data-vi][data-en]');

        function setLanguage(lang) {
            document.documentElement.lang = lang;
            try { localStorage.setItem(STORAGE_KEY, lang); } catch(e) {}

            btns.forEach(function(btn) {
                var isActive = btn.getAttribute('data-lang') === lang;
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });

            var attr = lang === 'en' ? 'data-en' : 'data-vi';
            translatableEls.forEach(function(el) {
                var val = el.getAttribute(attr);
                if (val !== null) el.innerHTML = val;
            });
        }

        btns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var lang = this.getAttribute('data-lang');
                setLanguage(lang);
            });
        });

        // Initialize from storage or default to Vietnamese
        var currentLang = 'vi';
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved === 'en' || saved === 'vi') currentLang = saved;
        } catch(e) {}
        setLanguage(currentLang);
    })();
    </script>
`;

html = html.replace('</body>', langScript + '\n</body>');

fs.writeFileSync('docs/casa-escondida-plan-showcase.html', html, 'utf8');
fs.writeFileSync('public/casa-escondida-plan-showcase.html', html, 'utf8');
console.log('Successfully written comprehensive showcase plan with Bilingual VI/EN toggle & non-technical explanations!');
