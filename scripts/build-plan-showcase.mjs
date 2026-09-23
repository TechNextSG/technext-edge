import fs from 'node:fs';

const html = `<!doctype html>
<html lang="vi">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng WhatsApp — Casa Escondida</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #FAF7F2;
            --bg2: #F3ECDF;
            --ink: #2A211B;
            --ink-soft: #4A3D33;
            --muted: #7A6A5E;
            --line: #E4DBCF;
            --line-soft: #EFE7DA;
            --accent: #8B5E34;
            --accent-soft: #F1E6D8;
            --claude: #D97757;
            --claude-2: #B94F31;
            --claude-soft: #FBEDE3;
            --tool: #4B7F52;
            --tool-soft: #E3EFE5;
            --card: #FFFFFF;
            --shadow: 0 1px 2px rgba(42, 33, 27, .05), 0 8px 24px rgba(42, 33, 27, .06);
            --shadow-hi: 0 4px 6px rgba(42, 33, 27, .08), 0 20px 40px rgba(42, 33, 27, .12);
        }

        * { box-sizing: border-box; }

        html, body {
            margin: 0;
            padding: 0;
            background: var(--bg);
            color: var(--ink);
            font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
            font-size: 15px;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }

        body {
            background:
                radial-gradient(1200px 500px at 90% -10%, rgba(217, 119, 87, .08), transparent 60%),
                radial-gradient(900px 400px at -10% 60%, rgba(180, 122, 69, .06), transparent 60%),
                var(--bg);
        }

        .page {
            max-width: 1180px;
            margin: 0 auto;
            padding: 32px 30px 80px;
        }

        /* Sticky Navigation */
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
            margin-bottom: 32px;
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
        @keyframes blip {
            0%, 100% { opacity: .5; transform: scale(.9); }
            50% { opacity: 1; transform: scale(1.15); }
        }
        .plan-nav .nav-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .plan-nav a.arch-link {
            text-decoration: none;
            color: var(--muted);
            font-size: 12.5px;
            font-weight: 600;
            padding: 5px 14px;
            border-radius: 99px;
            border: 1px solid var(--line);
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .plan-nav a.arch-link:hover {
            color: var(--accent);
            border-color: var(--accent);
            background: var(--bg2);
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

        /* Header */
        .kicker {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            letter-spacing: .2em;
            text-transform: uppercase;
            color: var(--accent);
            font-weight: 700;
            background: var(--accent-soft);
            border: 1px solid #E5D3B7;
            padding: 5px 12px;
            border-radius: 99px;
            margin-bottom: 12px;
        }
        h1 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 38px;
            line-height: 1.18;
            margin: 0 0 14px;
            font-weight: 700;
            letter-spacing: -.01em;
            color: var(--ink);
        }
        h1 .thin {
            font-weight: 400;
            color: var(--muted);
        }
        .lede {
            color: var(--muted);
            font-size: 16px;
            line-height: 1.6;
            margin: 0 0 32px;
            max-width: 920px;
        }

        /* 4 KPI Banner Cards */
        .kpi-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 36px;
        }
        @media (max-width: 900px) {
            .kpi-row { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 540px) {
            .kpi-row { grid-template-columns: 1fr; }
        }
        .kpi-card {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 18px 20px;
            box-shadow: var(--shadow);
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .kpi-card .num {
            font-family: 'JetBrains Mono', monospace;
            font-size: 28px;
            font-weight: 700;
            color: var(--ink);
            line-height: 1.1;
        }
        .kpi-card.green .num { color: var(--tool); }
        .kpi-card.orange .num { color: var(--claude); }
        .kpi-card.red .num { color: #C0182F; }
        .kpi-card .lbl {
            font-weight: 700;
            font-size: 13.5px;
            color: var(--ink);
            margin-top: 2px;
        }
        .kpi-card .desc {
            font-size: 12px;
            color: var(--muted);
            line-height: 1.4;
        }

        /* Main sections */
        .doc-section {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 18px;
            padding: 32px 36px;
            box-shadow: var(--shadow);
            margin-bottom: 30px;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        .doc-section h2 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 24px;
            margin: 0;
            color: var(--ink);
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .doc-section h2::after {
            content: "";
            flex: 1;
            height: 1px;
            background: var(--line-soft);
        }
        .doc-section p.sec-desc {
            margin: -8px 0 0;
            color: var(--muted);
            font-size: 14.5px;
        }

        /* 4 modules grid */
        .modules-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 18px;
        }
        @media (max-width: 800px) {
            .modules-grid { grid-template-columns: 1fr; }
        }
        .module-item {
            background: var(--bg);
            border: 1px solid var(--line-soft);
            border-radius: 12px;
            padding: 18px 20px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .module-item .top {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .module-item .title {
            font-weight: 700;
            font-size: 15px;
            color: var(--ink);
        }
        .badge {
            font-size: 10.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .06em;
            padding: 2px 8px;
            border-radius: 6px;
        }
        .badge.solid { background: var(--tool-soft); color: var(--tool); }
        .badge.metric { background: var(--accent-soft); color: var(--accent); }
        .badge.urgent { background: #FCEBEB; color: #C0182F; }
        .badge.blocked { background: #E7ECF3; color: #506584; }
        .module-item .text {
            font-size: 13.5px;
            color: var(--muted);
            line-height: 1.5;
        }

        /* Mental model */
        .concierge-model {
            background: linear-gradient(135deg, #FFF 0%, var(--bg2) 100%);
            border: 1px solid #E3D7C5;
            border-radius: 14px;
            padding: 22px 24px;
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .concierge-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 14px;
        }
        @media (max-width: 900px) {
            .concierge-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 520px) {
            .concierge-grid { grid-template-columns: 1fr; }
        }
        .concierge-box {
            background: #fff;
            border: 1px solid var(--line-soft);
            border-radius: 10px;
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .concierge-box .step {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--muted);
        }
        .concierge-box .name {
            font-weight: 700;
            font-size: 14px;
            color: var(--ink);
        }
        .concierge-box .desc {
            font-size: 12px;
            color: var(--muted);
            line-height: 1.45;
        }

        /* 3 causes */
        .causes-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }
        @media (max-width: 960px) {
            .causes-grid { grid-template-columns: 1fr; }
        }
        .cause-card {
            background: var(--bg);
            border: 1px solid var(--line-soft);
            border-radius: 14px;
            padding: 22px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .cause-card.alert {
            border: 2px solid #F0B8B8;
            background: #FFFDFC;
        }
        .cause-card .c-num {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .12em;
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
        .chat-bubble {
            padding: 10px 14px;
            border-radius: 10px;
            font-size: 12.5px;
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

        /* Measure table */
        .measure-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        .measure-table th, .measure-table td {
            padding: 14px 18px;
            text-align: left;
            border-bottom: 1px solid var(--line-soft);
            font-size: 14px;
        }
        .measure-table th {
            background: var(--bg2);
            font-size: 11px;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--accent);
            font-weight: 700;
        }

        /* 2-col action plan */
        .actions-2col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
        }
        @media (max-width: 900px) {
            .actions-2col { grid-template-columns: 1fr; }
        }
        .action-column {
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .action-column h3 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 20px;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .task-card {
            background: var(--bg);
            border: 1px solid var(--line-soft);
            border-radius: 12px;
            padding: 16px 18px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .task-card .top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 700;
            font-size: 14px;
            color: var(--ink);
        }
        .task-card .owner {
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 4px;
            background: var(--bg2);
            color: var(--accent);
            font-weight: 700;
        }
        .task-card .desc {
            font-size: 13px;
            color: var(--muted);
            line-height: 1.45;
        }

        /* Lead Callout */
        .lead-urgent-box {
            background: linear-gradient(135deg, var(--claude-soft) 0%, #FFFFFF 100%);
            border: 2px solid var(--claude);
            border-radius: 18px;
            padding: 28px 32px;
            box-shadow: 0 4px 24px rgba(217, 119, 87, 0.15);
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin-bottom: 30px;
        }
        .lead-urgent-box h3 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 22px;
            margin: 0;
            color: var(--claude-2);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .lead-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 18px;
        }
        @media (max-width: 768px) {
            .lead-grid { grid-template-columns: 1fr; }
        }
        .lead-item {
            background: #fff;
            padding: 18px 20px;
            border-radius: 12px;
            border: 1px solid rgba(217, 119, 87, 0.25);
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .lead-item .tag {
            font-size: 11px;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--claude);
            font-weight: 700;
        }
        .lead-item .name {
            font-weight: 700;
            font-size: 15.5px;
            color: var(--ink);
        }
        .lead-item .text {
            font-size: 13px;
            color: var(--muted);
            line-height: 1.48;
        }

        /* Safeguard Box */
        .withhold-box {
            background: var(--bg);
            border: 1px dashed var(--muted);
            border-radius: 16px;
            padding: 24px 28px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 40px;
        }
        .withhold-box h4 {
            font-size: 12.5px;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--muted);
            margin: 0;
            font-weight: 700;
        }
        .withhold-box .text {
            font-size: 13.5px;
            color: var(--ink-soft);
            line-height: 1.55;
        }

        /* Footer */
        footer {
            border-top: 1px solid var(--line);
            padding-top: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 14px;
            font-size: 13px;
            color: var(--muted);
        }
        footer a {
            color: var(--accent);
            font-weight: 600;
            text-decoration: none;
        }
        footer a:hover {
            text-decoration: underline;
        }

        @media print {
            .plan-nav, .lang-switcher { display: none; }
            .doc-section, .kpi-card, .lead-urgent-box {
                box-shadow: none !important;
                border-color: #D8CFC2 !important;
                break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="page">

        <!-- STICKY TOP NAV -->
        <nav class="plan-nav">
            <div class="brand">
                <span class="brand-dot"></span>
                <span data-vi="Casa Escondida · Kế Hoạch Trợ Lý WhatsApp" data-en="Casa Escondida · WhatsApp Assistant Plan">Casa Escondida · Kế Hoạch Trợ Lý WhatsApp</span>
            </div>
            <div class="nav-right">
                <a href="extractor-pod-showcase.html" class="arch-link" target="_blank">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                        <polyline points="2 17 12 22 22 17"></polyline>
                        <polyline points="2 12 12 17 22 12"></polyline>
                    </svg>
                    <span data-vi="Xem Sơ Đồ Kiến Trúc →" data-en="View Architecture Graph →">Xem Sơ Đồ Kiến Trúc →</span>
                </a>
                <div class="lang-switcher" aria-label="Language selection">
                    <button type="button" class="lang-btn active" data-lang="vi">VI</button>
                    <button type="button" class="lang-btn" data-lang="en">EN</button>
                </div>
            </div>
        </nav>

        <!-- HEADER -->
        <header>
            <span class="kicker" data-vi="23/09/2026 · Dành Cho Lead — Không Cần Đọc Code" data-en="23/09/2026 · For Tech Lead — No Code Knowledge Required">23/09/2026 · Dành Cho Lead — Không Cần Đọc Code</span>
            <h1 data-vi="Kế Hoạch — Trợ Lý Đặt Phòng WhatsApp &lt;span class=&quot;thin&quot;&gt;(Casa Escondida)&lt;/span&gt;" data-en="Executive Plan — WhatsApp Booking Assistant &lt;span class=&quot;thin&quot;&gt;(Casa Escondida)&lt;/span&gt;">Kế Hoạch — Trợ Lý Đặt Phòng WhatsApp <span class="thin">(Casa Escondida)</span></h1>
            <p class="lede" data-vi="Bot đọc tin nhắn khách bằng ngôn ngữ tự nhiên (Anh · Việt · Trung), rút ra thông tin đặt phòng, hỏi nốt phần thiếu, rồi bàn giao cho nhân viên chốt giá. Odoo vẫn giữ giá, hoá đơn và phòng — phần này chỉ đứng ngoài, nói chuyện với khách. Dưới đây là tình hình thật và việc cần làm tiếp." data-en="The bot reads natural customer messages (English · Vietnamese · Chinese), extracts booking details, politely clarifies missing information, and hands off to human staff for final pricing. Odoo ERP retains prices, rooms, and invoices — this system acts as the front concierge. Here is the unvarnished reality and execution roadmap.">Bot đọc tin nhắn khách bằng ngôn ngữ tự nhiên (Anh · Việt · Trung), rút ra thông tin đặt phòng, hỏi nốt phần thiếu, rồi bàn giao cho nhân viên chốt giá. Odoo vẫn giữ giá, hoá đơn và phòng — phần này chỉ đứng ngoài, nói chuyện với khách. Dưới đây là tình hình thật và việc cần làm tiếp.</p>
        </header>

        <!-- 4 KPI CARDS -->
        <div class="kpi-row">
            <div class="kpi-card green">
                <div class="num" data-vi="Đang chạy" data-en="Live">Đang chạy</div>
                <div class="lbl" data-vi="WhatsApp Thật" data-en="Production WhatsApp">WhatsApp Thật</div>
                <div class="desc" data-vi="Khách nhắn tin là trả lời tự động 24/7" data-en="Responds to real incoming messages 24/7">Khách nhắn tin là trả lời tự động 24/7</div>
            </div>
            <div class="kpi-card green">
                <div class="num">0%</div>
                <div class="lbl" data-vi="Tỉ Lệ Bịa Dữ Liệu" data-en="Hallucination Rate">Tỉ Lệ Bịa Dữ Liệu</div>
                <div class="desc" data-vi="Đo trên 30 kịch bản kiểm thử nghiêm ngặt" data-en="Benchmarked across 30 strict cases">Đo trên 30 kịch bản kiểm thử nghiêm ngặt</div>
            </div>
            <div class="kpi-card green">
                <div class="num">230</div>
                <div class="lbl" data-vi="Bài Test Xanh 100%" data-en="Green Tests 100%">Bài Test Xanh 100%</div>
                <div class="desc" data-vi="Kiểm thử tự động chạy mỗi lần lưu code" data-en="Automated regression suite on every commit">Kiểm thử tự động chạy mỗi lần lưu code</div>
            </div>
            <div class="kpi-card red">
                <div class="num" data-vi="Chưa live" data-en="Pending">Chưa live</div>
                <div class="lbl" data-vi="Bản Sửa Tính Tiền" data-en="Pricing Fix Sync">Bản Sửa Tính Tiền</div>
                <div class="desc" data-vi="Đã xong từ hôm qua nhưng chưa lên máy chủ" data-en="Verified yesterday but waiting for deployment">Đã xong từ hôm qua nhưng chưa lên máy chủ</div>
            </div>
        </div>

        <!-- PHẦN 1: ĐANG Ở ĐÂU -->
        <section class="doc-section">
            <h2 data-vi="1. Đang ở đâu — Trạng thái thật 4 mảng của hệ thống" data-en="1. Current State — 4 Modules (Unvarnished Reality)">1. Đang ở đâu — Trạng thái thật 4 mảng của hệ thống</h2>
            <p class="sec-desc" data-vi="Nhìn thẳng vào sự thật vận hành — không làm đẹp số." data-en="Honest engineering status — no inflated metrics.">Nhìn thẳng vào sự thật vận hành — không làm đẹp số.</p>

            <div class="modules-grid">
                <div class="module-item">
                    <div class="top">
                        <span class="title" data-vi="Đọc hiểu tin nhắn khách" data-en="Guest Message Comprehension">Đọc hiểu tin nhắn khách</span>
                        <span class="badge solid" data-vi="Ổn" data-en="Solid">Ổn</span>
                    </div>
                    <div class="text" data-vi="Khách viết tự do kiểu gì cũng đọc được, kể cả 'thứ 7 tuần sau' hay tiếng Trung. Quan trọng hơn: khi không chắc, nó hỏi lại chứ không đoán. Đây là phần được kiểm tra nghiêm nhất và đang sạch." data-en="Reads free-form guest inputs effortlessly, including relative dates ('next Saturday') or Chinese. Crucially: when uncertain, it asks rather than guesses. Strictly verified and completely clean.">
                        Khách viết tự do kiểu gì cũng đọc được, kể cả 'thứ 7 tuần sau' hay tiếng Trung. Quan trọng hơn: khi không chắc, nó hỏi lại chứ không đoán. Đây là phần được kiểm tra nghiêm nhất và đang sạch.
                    </div>
                </div>

                <div class="module-item">
                    <div class="top">
                        <span class="title" data-vi="Cách nói chuyện" data-en="Conversational Tone">Cách nói chuyện</span>
                        <span class="badge metric" data-vi="Cần thước đo" data-en="Needs Metric">Cần thước đo</span>
                    </div>
                    <div class="text" data-vi="Tuần này đã bỏ mẫu câu cứng, cho AI viết bằng giọng lễ tân trên nền dữ liệu đã kiểm chứng. Đúng hướng — nhưng hiện chưa có cách nào chấm điểm xem nó thật sự tự nhiên hơn hay không." data-en="Replaced rigid boilerplate templates with a 5-star concierge voice on verified facts. Moving in the right direction — but currently lacks an objective metric to grade whether it is truly more natural.">
                        Tuần này đã bỏ mẫu câu cứng, cho AI viết bằng giọng lễ tân trên nền dữ liệu đã kiểm chứng. Đúng hướng — nhưng hiện chưa có cách nào chấm điểm xem nó thật sự tự nhiên hơn hay không.
                    </div>
                </div>

                <div class="module-item" style="border-color:#F5C6CB;">
                    <div class="top">
                        <span class="title" data-vi="Quy trình đưa code lên production" data-en="Production Deployment Pipeline">Quy trình đưa code lên production</span>
                        <span class="badge urgent" data-vi="Sửa ngay" data-en="Fix Now">Sửa ngay</span>
                    </div>
                    <div class="text" data-vi="Bản sửa lỗi tính tiền gói lặn đã hoàn tất và kiểm thử xong từ hôm qua, nhưng kiểm tra lại hôm nay thì &lt;b&gt;production vẫn chưa có&lt;/b&gt; — đẩy code lên kho chung không tự động đưa lên máy chủ thật. Nghĩa là có thể còn bản sửa khác cũng đang nằm chờ mà không ai biết." data-en="Diving package pricing fix was tested and ready yesterday, but &lt;b&gt;production still lacks it today&lt;/b&gt; — committing code does not automatically sync to the live server. Other hotfixes might also be stranded unnoticed.">
                        Bản sửa lỗi tính tiền gói lặn đã hoàn tất và kiểm thử xong từ hôm qua, nhưng kiểm tra lại hôm nay thì <b>production vẫn chưa có</b> — đẩy code lên kho chung không tự động đưa lên máy chủ thật. Nghĩa là có thể còn bản sửa khác cũng đang nằm chờ mà không ai biết.
                    </div>
                </div>

                <div class="module-item">
                    <div class="top">
                        <span class="title" data-vi="Tính giá và xuất báo giá" data-en="Pricing &amp; Quotation Generation">Tính giá và xuất báo giá</span>
                        <span class="badge blocked" data-vi="Chờ người" data-en="Blocked">Chờ người</span>
                    </div>
                    <div class="text" data-vi="Cấu trúc dữ liệu để đưa sang Odoo chưa được chốt, nên chưa có dòng code nào nối với Odoo. Xây trước khi chốt là chắc chắn phải đập đi làm lại." data-en="The data contract for Odoo has not been finalized by Phillip, so zero lines of code have been wired to Odoo. Coding before contract sign-off guarantees expensive rework.">
                        Cấu trúc dữ liệu để đưa sang Odoo chưa được chốt, nên chưa có dòng code nào nối với Odoo. Xây trước khi chốt là chắc chắn phải đập đi làm lại.
                    </div>
                </div>
            </div>
        </section>

        <!-- MÔ HÌNH LỄ TÂN 5 SAO -->
        <section class="doc-section">
            <h2 data-vi="2. Mô hình hoạt động: 'Người Lễ Tân Đứng Sảnh Khách Sạn'" data-en="2. Operational Model: 'The 5-Star Hotel Front Concierge'">2. Mô hình hoạt động: 'Người Lễ Tân Đứng Sảnh Khách Sạn'</h2>
            <p class="sec-desc" data-vi="Hiểu hệ thống một cách trực quan mà không cần thuật ngữ code phức tạp." data-en="Visualizing how the bot operates without complex technical jargon.">Hiểu hệ thống một cách trực quan mà không cần thuật ngữ code phức tạp.</p>

            <div class="concierge-model">
                <p style="margin:0;font-size:14px;color:var(--muted);line-height:1.55;" data-vi="Hãy hình dung trợ lý AI này chính là một &lt;b&gt;Nhân viên Lễ tân đón tiếp tại Casa Escondida&lt;/b&gt;:" data-en="Picture this AI assistant as a &lt;b&gt;Front Concierge in the Casa Escondida lobby&lt;/b&gt;:">
                    Hãy hình dung trợ lý AI này chính là một <b>Nhân viên Lễ tân đón tiếp tại Casa Escondida</b>:
                </p>
                <div class="concierge-grid">
                    <div class="concierge-box">
                        <span class="step" style="color:var(--tool);" data-vi="Bước 1" data-en="Step 1">Bước 1</span>
                        <span class="name" data-vi="Đón khách đa ngữ" data-en="Multi-lingual Welcome">Đón khách đa ngữ</span>
                        <span class="desc" data-vi="Khách nói tiếng Anh, Việt hay Trung đều lắng nghe và hiểu đúng ý." data-en="Greets guests naturally in English, Vietnamese, or Chinese.">Khách nói tiếng Anh, Việt hay Trung đều lắng nghe và hiểu đúng ý.</span>
                    </div>
                    <div class="concierge-box">
                        <span class="step" style="color:var(--accent);" data-vi="Bước 2" data-en="Step 2">Bước 2</span>
                        <span class="name" data-vi="Ghi phiếu đặt phòng" data-en="Taking Trip Notes">Ghi phiếu đặt phòng</span>
                        <span class="desc" data-vi="Thu thập ngày đi, số khách, gói lặn. Chỉ hỏi những gì còn thiếu." data-en="Collects dates, guests, diving info. Inquires only on missing items.">Thu thập ngày đi, số khách, gói lặn. Chỉ hỏi những gì còn thiếu.</span>
                    </div>
                    <div class="concierge-box" style="border-color:#F5C6CB;background:#FFFDFC;">
                        <span class="step" style="color:#C0182F;" data-vi="Rào chắn an toàn" data-en="Safety Guardrail">Rào chắn an toàn</span>
                        <span class="name" style="color:#C0182F;" data-vi="Cấm tự tính tiền" data-en="Zero Pricing Authority">Cấm tự tính tiền</span>
                        <span class="desc" data-vi="Không được tự ý báo giá hay hứa còn phòng; tránh đền bù thiệt hại." data-en="Strictly forbidden from quoting arbitrary rates or promising rooms.">Không được tự ý báo giá hay hứa còn phòng; tránh đền bù thiệt hại.</span>
                    </div>
                    <div class="concierge-box">
                        <span class="step" style="color:var(--accent);" data-vi="Bước 3" data-en="Step 3">Bước 3</span>
                        <span class="name" data-vi="Bàn giao Odoo" data-en="Odoo Hand-off">Bàn giao Odoo</span>
                        <span class="desc" data-vi="Chuyển phiếu cho nhân viên resort kiểm tra phòng và xuất hóa đơn." data-en="Hands verified summary to staff &amp; Odoo ERP to issue official invoice.">Chuyển phiếu cho nhân viên resort kiểm tra phòng và xuất hóa đơn.</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- PHẦN 2: BÓC TÁCH 3 NGUYÊN NHÂN "CỨNG" -->
        <section class="doc-section">
            <h2 data-vi="3. Vấn đề Lead nêu: Bot nói chuyện thiếu tự nhiên" data-en="3. Lead Feedback: Bot Sounds Rigid &amp; Mechanical">3. Vấn đề Lead nêu: Bot nói chuyện thiếu tự nhiên</h2>
            <p class="sec-desc" data-vi="Gọi chung là 'cứng', nhưng thật ra là &lt;b&gt;ba nguyên nhân khác nhau&lt;/b&gt; cần &lt;b&gt;ba cách chữa khác nhau&lt;/b&gt;. Gộp chung lại chính là lý do sửa mãi mà không thấy khá lên." data-en="Referred to as 'rigid', but in reality it stems from &lt;b&gt;three distinct root causes&lt;/b&gt; requiring &lt;b&gt;three different remedies&lt;/b&gt;. Conflating them was why it never visibly improved.">Gọi chung là 'cứng', nhưng thật ra là <b>ba nguyên nhân khác nhau</b> cần <b>ba cách chữa khác nhau</b>. Gộp chung lại chính là lý do sửa mãi mà không thấy khá lên.</p>

            <div class="causes-grid">
                <!-- Nguyên nhân 1 -->
                <div class="cause-card">
                    <span class="c-num" data-vi="Nguyên nhân 1 · Cách dùng từ" data-en="Cause 1 · Scripted Wording">Nguyên nhân 1 · Cách dùng từ</span>
                    <h3 data-vi="Câu chữ khô như máy đọc" data-en="Robotic, Scripted Phrasing">Câu chữ khô như máy đọc</h3>
                    <span class="badge solid" data-vi="Đã sửa tuần này" data-en="Resolved This Week">Đã sửa tuần này</span>
                    <div class="desc" data-vi="Trước đây mọi câu trả lời đều là mẫu câu cố định ghép sẵn — an toàn tuyệt đối nhưng đọc lên rất máy móc." data-en="Previously every reply was an assembled static template — 100% safe, but felt like talking to a robot.">Trước đây mọi câu trả lời đều là mẫu câu cố định ghép sẵn — an toàn tuyệt đối nhưng đọc lên rất máy móc.</div>
                    
                    <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">
                        <div class="chat-bubble bad" data-vi="&lt;b&gt;❌ Trước đây:&lt;/b&gt; 'Quý khách vui lòng cung cấp số lượng khách và ngày nhận phòng để được tư vấn.'" data-en="&lt;b&gt;❌ Before:&lt;/b&gt; 'Customer please provide guest count and check-in date for booking assistance.'">
                            <b>❌ Trước đây:</b> "Quý khách vui lòng cung cấp số lượng khách và ngày nhận phòng để được tư vấn."
                        </div>
                        <div class="chat-bubble good" data-vi="&lt;b&gt;✅ Đã sửa:&lt;/b&gt; AI viết lại bằng giọng lễ tân 5 sao, chỉ dùng dữ liệu đã kiểm chứng, cấm nói giá hoặc xác nhận đặt phòng; lỗi tự quay về mẫu cũ." data-en="&lt;b&gt;✅ Fixed:&lt;/b&gt; Rewritten in 5-star concierge voice on verified facts; forbidden from quoting rates; falls back to template on error.">
                            <b>✅ Đã sửa:</b> AI viết lại bằng giọng lễ tân 5 sao, chỉ dùng dữ liệu đã kiểm chứng, cấm nói giá hoặc xác nhận đặt phòng; lỗi tự quay về mẫu cũ.
                        </div>
                    </div>
                </div>

                <!-- Nguyên nhân 2 -->
                <div class="cause-card alert">
                    <span class="c-num" style="color:#C0182F;" data-vi="Nguyên nhân 2 · Hỏi sai chỗ (Tệ nhất)" data-en="Cause 2 · Wrong Targeting (Worst)">Nguyên nhân 2 · Hỏi sai chỗ (Tệ nhất)</span>
                    <h3 style="color:#C0182F;" data-vi="Hỏi lại thứ khách vừa nói" data-en="Re-asking What Was Just Stated">Hỏi lại thứ khách vừa nói</h3>
                    <span class="badge urgent" data-vi="Chưa sửa — Sửa tuần này" data-en="Unfixed — Sprint Priority">Chưa sửa — Sửa tuần này</span>
                    <div class="desc" data-vi="Khách viết câu rất người: &lt;i&gt;'Một người lặn ngày đầu, năm người lặn cả hai ngày'&lt;/i&gt;. Hệ thống không quy được về một con số nên coi như chưa biết và &lt;b&gt;hỏi lại&lt;/b&gt;. Với khách, cảm giác là &lt;i&gt;'Tôi vừa nói rồi mà!'&lt;/i&gt;." data-en="Guest writes naturally: &lt;i&gt;'One person dives day 1, five people dive both days'&lt;/i&gt;. The system cannot collapse this into a single integer, so it treats it as unknown and &lt;b&gt;re-asks&lt;/b&gt;. Guest feels: &lt;i&gt;'I literally just told you!'&lt;/i&gt;.">Khách viết câu rất người: <i>'Một người lặn ngày đầu, năm người lặn cả hai ngày'</i>. Hệ thống không quy được về một con số nên coi như chưa biết và <b>hỏi lại</b>. Với khách, cảm giác là <i>'Tôi vừa nói rồi mà!'</i>.</div>
                    
                    <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">
                        <div class="chat-bubble bad" data-vi="&lt;b&gt;❌ Bệnh cũ:&lt;/b&gt; Hỏi lại: 'Đoàn mình có bao nhiêu người đi lặn ạ?' &amp;rarr; Cực kỳ vô duyên!" data-en="&lt;b&gt;❌ The Flaw:&lt;/b&gt; Re-asking: 'How many people are diving?' &amp;rarr; Extremely irritating to guests!">
                            <b>❌ Bệnh cũ:</b> Hỏi lại: "Đoàn mình có bao nhiêu người đi lặn ạ?" &rarr; Cực kỳ vô duyên!
                        </div>
                        <div class="chat-bubble good" data-vi="&lt;b&gt;✅ Cách sửa:&lt;/b&gt; Dù AI viết hay tới đâu, hỏi lại vẫn vô duyên. &lt;b&gt;Phải sửa ở chỗ quyết định hỏi gì&lt;/b&gt;: Khi không quy được về số, ghi nhận vào ghi chú và chuyển nhân viên đọc thay vì hỏi khách!" data-en="&lt;b&gt;✅ The Remedy:&lt;/b&gt; Smooth phrasing cannot save re-asking. &lt;b&gt;Must fix question decision logic&lt;/b&gt;: Record nuances in notes and let human staff review rather than re-asking!">
                            <b>✅ Cách sửa:</b> Dù AI viết hay tới đâu, hỏi lại vẫn vô duyên. <b>Phải sửa ở chỗ quyết định hỏi gì</b>: Khi không quy được về số, ghi nhận vào ghi chú và chuyển nhân viên đọc thay vì hỏi khách!
                        </div>
                    </div>
                </div>

                <!-- Nguyên nhân 3 -->
                <div class="cause-card">
                    <span class="c-num" data-vi="Nguyên nhân 3 · Khuôn dữ liệu" data-en="Cause 3 · Rigid Form Slots">Nguyên nhân 3 · Khuôn dữ liệu</span>
                    <h3 data-vi="Ý khách phong phú hơn ô trống" data-en="Human Nuances vs Form Slots">Ý khách phong phú hơn ô trống</h3>
                    <span class="badge metric" data-vi="Đã đỡ một phần" data-en="Partially Handled">Đã đỡ một phần</span>
                    <div class="desc" data-vi="Hệ thống có sẵn các ô: ngày, số người, số phòng… Khi khách nói điều không rơi vào ô nào, nó bị làm phẳng hoặc rơi mất — như lịch lặn khác nhau theo từng người." data-en="System provides fixed slots: dates, guest count, rooms... When a guest states something that fits no slot, it gets flattened or dropped.">Hệ thống có sẵn các ô: ngày, số người, số phòng… Khi khách nói điều không rơi vào ô nào, nó bị làm phẳng hoặc rơi mất — như lịch lặn khác nhau theo từng người.</div>
                    
                    <div style="padding:10px 12px;background:#fff;border:1px solid var(--line-soft);border-radius:10px;font-size:12.5px;color:var(--ink-soft);line-height:1.45;" data-vi="&lt;b&gt;Giới hạn thật:&lt;/b&gt; Không thể thêm ô cho mọi cách nói của con người. Đã thêm ô ghi chú giữ nguyên lời khách; phần phức tạp còn lại chấp nhận chuyển cho nhân viên đọc." data-en="&lt;b&gt;Reality:&lt;/b&gt; Cannot invent slots for every human expression. Added verbatim notes; remaining complex edge cases are handed off to human staff.">
                        <b>Giới hạn thật:</b> Không thể thêm ô cho mọi cách nói của con người. Đã thêm ô ghi chú giữ nguyên lời khách; phần phức tạp còn lại chấp nhận chuyển cho nhân viên đọc.
                    </div>
                </div>
            </div>
        </section>

        <!-- PHẦN 3: NGHỊCH LÝ ĐO LƯỜNG -->
        <section class="doc-section">
            <h2 data-vi="4. Vì sao nó cứ cứng mãi: Mình chưa từng đo cái đó!" data-en="4. Why Did It Stay Rigid? We Never Measured Tone!">4. Vì sao nó cứ cứng mãi: Mình chưa từng đo cái đó!</h2>
            <p class="sec-desc" data-vi="Dự án đo rất nghiêm việc 'có bịa thông tin không' — kết quả 0%. Nhưng 'hỏi có đúng trọng tâm không, nghe có tự nhiên không' thì &lt;b&gt;chưa hề được chấm điểm lần nào&lt;/b&gt;. Báo cáo kiểm thử in ra đúng dòng này: &lt;code&gt;Question targeting : not scored — needs a human/judge pass&lt;/code&gt;." data-en="We strictly measured hallucination — achieving 0%. But question targeting and conversational naturalness have &lt;b&gt;never been scored once&lt;/b&gt;. Test suite prints: &lt;code&gt;Question targeting : not scored — needs a human/judge pass&lt;/code&gt;.">Dự án đo rất nghiêm việc 'có bịa thông tin không' — kết quả 0%. Nhưng 'hỏi có đúng trọng tâm không, nghe có tự nhiên không' thì <b>chưa hề được chấm điểm lần nào</b>. Báo cáo kiểm thử in ra đúng dòng này: <code>Question targeting : not scored — needs a human/judge pass</code>.</p>

            <table class="measure-table">
                <thead>
                    <tr>
                        <th style="width:25%;" data-vi="Hạng Mục" data-en="Domain">Hạng Mục</th>
                        <th style="width:20%;" data-vi="Điểm Số" data-en="Current Score">Điểm Số</th>
                        <th style="width:55%;" data-vi="Chi Tiết &amp; Đánh Giá Thực Tế" data-en="Reality &amp; Analysis">Chi Tiết &amp; Đánh Giá Thực Tế</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="font-weight:700;color:var(--tool);" data-vi="Đo rất kỹ" data-en="Strictly Measured">Đo rất kỹ</td>
                        <td><span style="font-family:'JetBrains Mono';font-size:18px;font-weight:700;color:var(--tool);">0%</span></td>
                        <td data-vi="Bịa dữ liệu · trích dẫn sai · sai ngày · sai số khách. (Chấm tự động mỗi lần lưu code &amp;rarr; &lt;b&gt;Làm rất tốt&lt;/b&gt;)." data-en="Hallucination · false quotes · wrong dates · wrong counts. (Automated on every commit &amp;rarr; &lt;b&gt;Flawless&lt;/b&gt;).">Bịa dữ liệu · trích dẫn sai · sai ngày · sai số khách. (Chấm tự động mỗi lần lưu code &rarr; <b>Làm rất tốt</b>).</td>
                    </tr>
                    <tr>
                        <td style="font-weight:700;color:#C0182F;" data-vi="Không đo" data-en="Unmeasured">Không đo</td>
                        <td><span style="font-family:'JetBrains Mono';font-size:18px;font-weight:700;color:#C0182F;">—</span></td>
                        <td data-vi="Hỏi thừa · hỏi lại thứ đã biết · giọng văn · cảm giác của khách. (Chưa chấm lần nào &amp;rarr; &lt;b&gt;Thước đo đó cần 30 tin nhắn khách thật, hiện đang chờ Eloa&lt;/b&gt;)." data-en="Redundant questions · re-asking known facts · tone · guest sentiment. (Never graded &amp;rarr; &lt;b&gt;Metric requires 30 real transcripts, currently waiting on Eloa&lt;/b&gt;).">Hỏi thừa · hỏi lại thứ đã biết · giọng văn · cảm giác của khách. (Chưa chấm lần nào &rarr; <b>Thước đo đó cần 30 tin nhắn khách thật, hiện đang chờ Eloa</b>).</td>
                    </tr>
                </tbody>
            </table>
            <p style="margin:6px 0 0;font-size:13.5px;color:var(--muted);font-style:italic;" data-vi="* Cái gì được đo thì được cải thiện. Phần 'không bịa' tốt vì được chấm mỗi ngày; phần 'tự nhiên' tệ vì chưa ai chấm nó lần nào — chứ không phải vì nó khó hơn." data-en="* What gets measured gets improved. Zero-hallucination excels because it is graded daily; naturalness lagged because no one graded it yet — not because it is harder.">
                * Cái gì được đo thì được cải thiện. Phần 'không bịa' tốt vì được chấm mỗi ngày; phần 'tự nhiên' tệ vì chưa ai chấm nó lần nào — chứ không phải vì nó khó hơn.
            </p>
        </section>

        <!-- PHẦN 4: KẾ HOẠCH HÀNH ĐỘNG 2 CỘT -->
        <section class="doc-section">
            <h2 data-vi="5. Kế hoạch hành động — Phân định rõ 2 luồng" data-en="5. Action Plan — Clear Two-Column Responsibility">5. Kế hoạch hành động — Phân định rõ 2 luồng</h2>
            <p class="sec-desc" data-vi="Xếp theo thứ tự ưu tiên, chia làm hai cột để thấy rõ chỗ nào team tự làm được và chỗ nào thật sự đang tắc vì chờ người khác." data-en="Sorted by priority into two columns: engineering self-driven tasks vs external blockers.">Xếp theo thứ tự ưu tiên, chia làm hai cột để thấy rõ chỗ nào team tự làm được và chỗ nào thật sự đang tắc vì chờ người khác.</p>

            <div class="actions-2col">
                <!-- Cột 1: Làm ngay -->
                <div class="action-column">
                    <h3>
                        <span style="width:10px;height:10px;border-radius:99px;background:var(--tool);display:inline-block;"></span>
                        <span data-vi="Làm ngay — Không chờ ai" data-en="Immediate — No Blockers">Làm ngay — Không chờ ai</span>
                    </h3>

                    <div class="task-card">
                        <div class="top">
                            <span data-vi="1. Đưa bản sửa lỗi tính tiền lên production" data-en="1. Deploy Pricing Hotfix to Live Production">1. Đưa bản sửa lỗi tính tiền lên production</span>
                            <span class="badge urgent">SỬA NGAY</span>
                        </div>
                        <div class="desc" data-vi="Đã xong và kiểm thử từ hôm qua nhưng chưa live. Đồng thời rà xem còn bản sửa nào khác đang kẹt tương tự." data-en="Completed and verified yesterday but not live yet. Simultaneously audit for any other stranded hotfixes.">Đã xong và kiểm thử từ hôm qua nhưng chưa live. Đồng thời rà xem còn bản sửa nào khác đang kẹt tương tự.</div>
                    </div>

                    <div class="task-card">
                        <div class="top">
                            <span data-vi="2. Thêm lớp kiểm tra cho câu AI viết" data-en="2. Add Sanity Verification Guardrail on AI Sentences">2. Thêm lớp kiểm tra cho câu AI viết</span>
                            <span class="badge solid">CODE CHECK</span>
                        </div>
                        <div class="desc" data-vi="Đối chiếu mọi con số và ngày trong câu AI vừa viết với dữ liệu đã kiểm chứng; lệch thì tự quay về mẫu câu an toàn. Hiện chỉ có lời dặn, chưa có kiểm tra." data-en="Cross-reference every number and date in AI-generated sentences against verified facts; roll back on mismatch. Currently only a prompt instruction, lacks code enforcement.">Đối chiếu mọi con số và ngày trong câu AI vừa viết với dữ liệu đã kiểm chứng; lệch thì tự quay về mẫu câu an toàn. Hiện chỉ có lời dặn, chưa có kiểm tra.</div>
                    </div>

                    <div class="task-card">
                        <div class="top">
                            <span data-vi="3. Sửa nguyên nhân 2 — Hỏi lại thứ khách đã nói" data-en="3. Fix Cause 2 — Stop Re-asking Stated Info">3. Sửa nguyên nhân 2 — Hỏi lại thứ khách đã nói</span>
                            <span class="badge metric">LOGIC FIX</span>
                        </div>
                        <div class="desc" data-vi="Khi khách đã trả lời nhưng hệ thống không quy được về con số, ghi nhận vào ghi chú và chuyển nhân viên thay vì hỏi khách lần nữa." data-en="When guest answers but system cannot collapse to an integer, record in freeform notes and notify staff rather than re-asking the guest.">Khi khách đã trả lời nhưng hệ thống không quy được về con số, ghi nhận vào ghi chú và chuyển nhân viên thay vì hỏi khách lần nữa.</div>
                    </div>

                    <div class="task-card">
                        <div class="top">
                            <span data-vi="4. Quét nốt hai lỗi tính tiền còn lại" data-en="4. Fix 2 Remaining Pricing Assumptions">4. Quét nốt hai lỗi tính tiền còn lại</span>
                            <span class="badge metric">PRICING</span>
                        </div>
                        <div class="desc" data-vi="Hai thông tin ảnh hưởng trực tiếp tới giá đang được hệ thống tự suy đoán thay vì hỏi — trong đó có loại khách (đại lý được giảm 30%)." data-en="Two parameters directly affecting prices are currently guessed instead of confirmed — notably agency guests (entitled to 30% discount).">Hai thông tin ảnh hưởng trực tiếp tới giá đang được hệ thống tự suy đoán thay vì hỏi — trong đó có loại khách (đại lý được giảm 30%).</div>
                    </div>
                </div>

                <!-- Cột 2: Chờ người -->
                <div class="action-column">
                    <h3>
                        <span style="width:10px;height:10px;border-radius:99px;background:var(--accent);display:inline-block;"></span>
                        <span data-vi="Chờ đầu vào từ người khác" data-en="Blocked on External Stakeholders">Chờ đầu vào từ người khác</span>
                    </h3>

                    <div class="task-card">
                        <div class="top">
                            <span data-vi="1. Chốt cấu trúc dữ liệu" data-en="1. Finalize Odoo Data Contract">1. Chốt cấu trúc dữ liệu</span>
                            <span class="owner">PHILLIP</span>
                        </div>
                        <div class="desc" data-vi="Chặn toàn bộ hướng tính giá, xuất báo giá và link báo giá gửi khách. Đây là mắt xích sớm nhất và quan trọng nhất." data-en="Blocks all quotation generation, pricing pipelines, and guest quotation links. Earliest and most critical bottleneck.">Chặn toàn bộ hướng tính giá, xuất báo giá và link báo giá gửi khách. Đây là mắt xích sớm nhất và quan trọng nhất.</div>
                    </div>

                    <div class="task-card">
                        <div class="top">
                            <span data-vi="2. 30 tin nhắn khách thật" data-en="2. 30 Anonymized Real Transcripts">2. 30 tin nhắn khách thật</span>
                            <span class="owner">ELOA</span>
                        </div>
                        <div class="desc" data-vi="Có nó mới dựng được thước đo cho chất lượng giọng văn — thứ quyết định việc 'làm cho tự nhiên hơn' có chứng minh được hay không." data-en="Essential to build the benchmark judge for naturalness — proving objectively whether tone upgrades actually worked.">Có nó mới dựng được thước đo cho chất lượng giọng văn — thứ quyết định việc 'làm cho tự nhiên hơn' có chứng minh được hay không.</div>
                    </div>

                    <div class="task-card">
                        <div class="top">
                            <span data-vi="3. Duyệt hướng tầng trả lời" data-en="3. Sign Off Architecture Decision Record">3. Duyệt hướng tầng trả lời</span>
                            <span class="owner">ANTHONY</span>
                        </div>
                        <div class="desc" data-vi="Biên bản quyết định cũ vẫn đang chờ ký trong khi code đã đi tiếp. Cần đóng lại để người sau không hiểu nhầm." data-en="Decision record is pending formal signature while code has moved forward. Needs formal closure to align all teams.">Biên bản quyết định cũ vẫn đang chờ ký trong khi code đã đi tiếp. Cần đóng lại để người sau không hiểu nhầm.</div>
                    </div>

                    <div class="task-card">
                        <div class="top">
                            <span data-vi="4. Bốn giá trị mặc định của resort" data-en="4. Four Resort Default Parameters">4. Bốn giá trị mặc định của resort</span>
                            <span class="owner">JETT / ELOA</span>
                        </div>
                        <div class="desc" data-vi="Hiện là số phỏng đoán. Đoán sai thì báo giá sai mà không ai nhìn ra." data-en="Check-in hours, infant policies are currently assumptions. If wrong, quotations will silently deviate.">Hiện là số phỏng đoán. Đoán sai thì báo giá sai mà không ai nhìn ra.</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- LEAD URGENT CALLOUT -->
        <div class="lead-urgent-box">
            <h3 data-vi="Cần Lead giúp đúng hai việc (Quyết định tiến độ)" data-en="Two Critical Actions Needed From Tech Lead">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
                <span data-vi="Cần Lead giúp đúng hai việc (Quyết định tiến độ)" data-en="Two Critical Actions Needed From Tech Lead">Cần Lead giúp đúng hai việc (Quyết định tiến độ)</span>
            </h3>
            <div class="lead-grid">
                <div class="lead-item">
                    <span class="tag" data-vi="Hành động 1 · Mở khóa tính giá" data-en="Action 1 · Unblock Quotation Engine">Hành động 1 · Mở khóa tính giá</span>
                    <span class="name" data-vi="Thúc Phillip chốt cấu trúc dữ liệu" data-en="Unblock Phillip on Odoo Schema Contract">Thúc Phillip chốt cấu trúc dữ liệu</span>
                    <span class="text" data-vi="Mọi thứ liên quan tới báo giá — kể cả link báo giá gửi khách theo chuẩn quốc tế — đang nằm chờ đúng mắt xích này, không phải chờ team kỹ thuật." data-en="All quotation and pricing logic — including standardized guest quote links — is blocked on this single contract, not on engineering capacity.">Mọi thứ liên quan tới báo giá — kể cả link báo giá gửi khách theo chuẩn quốc tế — đang nằm chờ đúng mắt xích này, không phải chờ team kỹ thuật.</span>
                </div>
                <div class="lead-item">
                    <span class="tag" data-vi="Hành động 2 · Dữ liệu đo lường" data-en="Action 2 · Enable Objective Tone Scoring">Hành động 2 · Dữ liệu đo lường</span>
                    <span class="name" data-vi="Xin Eloa 30 tin nhắn khách thật (đã che tên)" data-en="Obtain 30 Anonymized Real Transcripts from Eloa">Xin Eloa 30 tin nhắn khách thật (đã che tên)</span>
                    <span class="text" data-vi="Không có nó thì việc 'làm cho tự nhiên hơn' vẫn chỉ là cảm tính — sửa xong không ai chứng minh được đã khá hơn hay chưa." data-en="Without authentic customer transcripts, making the bot 'sound natural' remains subjective guesswork. Real data gives us an indisputable quality score.">Không có nó thì việc 'làm cho tự nhiên hơn' vẫn chỉ là cảm tính — sửa xong không ai chứng minh được đã khá hơn hay chưa.</span>
                </div>
            </div>
        </div>

        <!-- HAI VIỆC CỐ Ý CHƯA LÀM -->
        <div class="withhold-box">
            <h4 data-vi="Hai việc đang cố ý CHƯA làm (để tránh hiểu nhầm là bỏ sót)" data-en="Two Things Deliberately Withheld (To Avoid Misunderstanding as Omissions)">Hai việc đang cố ý CHƯA làm (để tránh hiểu nhầm là bỏ sót)</h4>
            <div class="text" data-vi="&lt;b&gt;Một · Xây bước tính giá và xuất báo giá:&lt;/b&gt; Cấu trúc dữ liệu chưa chốt, xây trước là chắc chắn phải làm lại.&lt;br&gt;&lt;b&gt;Hai · Gộp phần đọc dữ liệu và phần viết lời thoại vào một lượt gọi AI:&lt;/b&gt; Làm vậy để tiết kiệm chi phí nhưng sẽ khiến AI viết lời cho khách trước khi hệ thống kịp kiểm tra dữ liệu, mà riêng tuần này lớp kiểm tra đó đã chặn được 2 lỗi bịa thông tin!" data-en="&lt;b&gt;One · Building Pricing &amp; Quotation Step:&lt;/b&gt; Data contract is not finalized; coding before contract sign-off guarantees expensive rework.&lt;br&gt;&lt;b&gt;Two · Merging Data Extraction &amp; Reply Generation into 1 Model Call:&lt;/b&gt; Doing so saves slight API cost, but causes AI to generate replies before the system can verify facts. That exact verification layer intercepted 2 critical hallucinations this week!">
                <b>Một · Xây bước tính giá và xuất báo giá:</b> Cấu trúc dữ liệu chưa chốt, xây trước là chắc chắn phải làm lại.<br>
                <b>Hai · Gộp phần đọc dữ liệu và phần viết lời thoại vào một lượt gọi AI:</b> Làm vậy để tiết kiệm chi phí nhưng sẽ khiến AI viết lời cho khách trước khi hệ thống kịp kiểm tra dữ liệu, mà riêng tuần này lớp kiểm tra đó đã chặn được 2 lỗi bịa thông tin!
            </div>
        </div>

        <!-- FOOTER -->
        <footer>
            <div>TechNext Edge · Casa Escondida Anilao Pod</div>
            <div>
                <a href="extractor-pod-showcase.html" target="_blank" data-vi="Mở Sơ đồ Kiến trúc Extractor Pod (Section 1 &amp; 2) →" data-en="Open Extractor Pod Architecture Showcase (Sections 1 &amp; 2) →">Mở Sơ đồ Kiến trúc Extractor Pod (Section 1 &amp; 2) →</a>
            </div>
        </footer>

    </div>

    <!-- BILINGUAL SCRIPT -->
    <script>
    (function() {
        var KEY = 'casa-plan-lang';
        var btns = document.querySelectorAll('.lang-btn');
        var transEls = document.querySelectorAll('[data-vi][data-en]');

        function applyLang(lang) {
            document.documentElement.lang = lang;
            try { localStorage.setItem(KEY, lang); } catch(e) {}

            btns.forEach(function(b) {
                var active = b.getAttribute('data-lang') === lang;
                b.classList.toggle('active', active);
            });

            var attr = lang === 'en' ? 'data-en' : 'data-vi';
            transEls.forEach(function(el) {
                var v = el.getAttribute(attr);
                if (v !== null) el.innerHTML = v;
            });
        }

        btns.forEach(function(b) {
            b.addEventListener('click', function() {
                var l = this.getAttribute('data-lang');
                applyLang(l);
            });
        });

        var initLang = 'vi';
        try {
            var s = localStorage.getItem(KEY);
            if (s === 'en' || s === 'vi') initLang = s;
        } catch(e) {}
        applyLang(initLang);
    })();
    </script>
</body>
</html>
`;

fs.writeFileSync('docs/casa-escondida-plan-showcase.html', html, 'utf8');
fs.writeFileSync('public/casa-escondida-plan-showcase.html', html, 'utf8');
console.log('Successfully generated clean, dedicated Plan page without duplicated architecture graph!');
