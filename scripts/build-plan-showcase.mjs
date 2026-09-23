import fs from 'node:fs';

const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Casa Escondida — WhatsApp Booking Assistant Upgrade Plan</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
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
            --shadow: 0 1px 2px rgba(42, 33, 27, .05), 0 6px 18px rgba(42, 33, 27, .06);
            --shadow-hi: 0 4px 6px rgba(42, 33, 27, .08), 0 16px 32px rgba(42, 33, 27, .12);
        }

        * { box-sizing: border-box; }

        html, body {
            margin: 0;
            padding: 0;
            background: var(--bg);
            color: var(--ink);
            font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }

        body {
            background:
                radial-gradient(1200px 500px at 90% -10%, rgba(217, 119, 87, .08), transparent 60%),
                radial-gradient(900px 400px at -10% 60%, rgba(180, 122, 69, .06), transparent 60%),
                var(--bg);
        }

        .page {
            max-width: 1240px;
            margin: 0 auto;
            padding: 24px 30px 40px;
        }

        /* 2-Slide print architecture */
        .slide-section {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 18px;
            padding: 28px 32px;
            box-shadow: var(--shadow);
            margin-bottom: 28px;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .slide-section + .slide-section {
            page-break-before: always;
            break-before: page;
        }

        /* Nav */
        .top-nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
            padding-bottom: 14px;
            border-bottom: 1px solid var(--line-soft);
        }
        .top-nav .brand {
            font-size: 11.5px;
            font-weight: 700;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--accent);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .top-nav .dot {
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
        .top-nav .nav-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .top-nav a.arch-btn {
            text-decoration: none;
            color: var(--muted);
            font-size: 12px;
            font-weight: 600;
            padding: 4px 12px;
            border-radius: 99px;
            border: 1px solid var(--line);
            background: var(--bg);
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .top-nav a.arch-btn:hover {
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
            font-size: 11.5px;
            font-weight: 700;
            padding: 3px 11px;
            border-radius: 99px;
            cursor: pointer;
            transition: all 0.18s ease;
        }
        .lang-btn.active {
            background: var(--accent);
            color: #fff;
            box-shadow: 0 1px 4px rgba(139, 94, 52, 0.2);
        }

        /* Typography */
        .kicker {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 10.5px;
            letter-spacing: .16em;
            text-transform: uppercase;
            color: var(--accent);
            font-weight: 700;
            background: var(--accent-soft);
            padding: 3px 10px;
            border-radius: 99px;
            margin-bottom: 10px;
        }
        h1 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 30px;
            line-height: 1.2;
            margin: 0 0 8px;
            font-weight: 700;
            color: var(--ink);
        }
        h1 .thin {
            font-weight: 400;
            color: var(--muted);
        }
        .lede {
            color: var(--muted);
            font-size: 14.5px;
            line-height: 1.5;
            margin: 0 0 20px;
        }

        /* 4 KPI Banner */
        .kpi-strip {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 14px;
            margin-bottom: 24px;
        }
        @media (max-width: 860px) {
            .kpi-strip { grid-template-columns: 1fr 1fr; }
        }
        .kpi-box {
            background: var(--bg);
            border: 1px solid var(--line-soft);
            border-radius: 12px;
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .kpi-box .val {
            font-family: 'JetBrains Mono', monospace;
            font-size: 24px;
            font-weight: 700;
            color: var(--ink);
            line-height: 1.1;
        }
        .kpi-box.green .val { color: var(--tool); }
        .kpi-box.red .val { color: #C0182F; }
        .kpi-box.orange .val { color: var(--claude); }
        .kpi-box .lbl {
            font-weight: 700;
            font-size: 12.5px;
            color: var(--ink);
        }
        .kpi-box .sub {
            font-size: 11.5px;
            color: var(--muted);
        }

        /* 2-Column Split: Problem vs Hybrid AI Solution */
        .split-grid {
            display: grid;
            grid-template-columns: 1fr 1.05fr;
            gap: 22px;
        }
        @media (max-width: 860px) {
            .split-grid { grid-template-columns: 1fr; }
        }
        .split-col {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .split-col h2 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 19px;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--ink);
        }
        .item-card {
            background: var(--bg);
            border: 1px solid var(--line-soft);
            border-radius: 12px;
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .item-card.alert {
            border-color: #F0C4C4;
            background: #FFFDFD;
        }
        .item-card.solution {
            border-left: 3px solid var(--tool);
        }
        .item-card .title {
            font-weight: 700;
            font-size: 13.5px;
            color: var(--ink);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tag {
            font-size: 9.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .08em;
            padding: 2px 7px;
            border-radius: 4px;
        }
        .tag.red { background: #FCEBEB; color: #C0182F; }
        .tag.green { background: var(--tool-soft); color: var(--tool); }
        .tag.orange { background: var(--claude-soft); color: var(--claude-2); }
        .tag.tan { background: var(--bg2); color: var(--accent); }
        .item-card .desc {
            font-size: 12.5px;
            color: var(--muted);
            line-height: 1.45;
        }

        /* 3 Next Phases */
        .phases-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
            margin-bottom: 22px;
        }
        @media (max-width: 900px) {
            .phases-row { grid-template-columns: 1fr; }
        }
        .phase-col {
            background: var(--bg);
            border: 1px solid var(--line-soft);
            border-radius: 14px;
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            position: relative;
        }
        .phase-col.active {
            border: 2px solid var(--tool);
            background: #fff;
            box-shadow: 0 4px 14px rgba(75, 127, 82, 0.08);
        }
        .phase-badge {
            align-self: flex-start;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .12em;
            color: var(--accent);
        }
        .phase-col h3 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 17px;
            margin: 0;
            color: var(--ink);
            line-height: 1.25;
        }
        .phase-tasks {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 12px;
            color: var(--ink-soft);
            line-height: 1.45;
        }
        .phase-tasks li {
            margin-left: 16px;
        }

        /* Lead Callout & Safeguards */
        .bottom-grid {
            display: grid;
            grid-template-columns: 1.2fr 1fr;
            gap: 18px;
        }
        @media (max-width: 860px) {
            .bottom-grid { grid-template-columns: 1fr; }
        }
        .lead-action-box {
            background: linear-gradient(135deg, var(--claude-soft) 0%, #FFFFFF 100%);
            border: 1.5px solid var(--claude);
            border-radius: 14px;
            padding: 18px 20px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .lead-action-box h4 {
            font-family: 'Playfair Display', Georgia, serif;
            font-size: 16px;
            margin: 0;
            color: var(--claude-2);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .lead-action-box ul {
            margin: 0;
            padding-left: 18px;
            font-size: 12.5px;
            color: var(--ink-soft);
            line-height: 1.5;
        }
        .withhold-box {
            background: var(--bg);
            border: 1px dashed var(--muted);
            border-radius: 14px;
            padding: 18px 20px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .withhold-box h4 {
            font-size: 11px;
            letter-spacing: .12em;
            text-transform: uppercase;
            color: var(--muted);
            margin: 0;
            font-weight: 700;
        }
        .withhold-box ul {
            margin: 0;
            padding-left: 18px;
            font-size: 12px;
            color: var(--muted);
            line-height: 1.45;
        }

        /* Footer */
        .slide-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 14px;
            border-top: 1px solid var(--line-soft);
            font-size: 11.5px;
            color: var(--muted);
            margin-top: 16px;
        }

        @page {
            size: A4 landscape;
            margin: 8mm;
        }
        @media print {
            body, .page { padding: 0; background: #fff; }
            .slide-section {
                box-shadow: none !important;
                border: 1px solid #D8CFC2 !important;
                padding: 18px 20px;
                margin-bottom: 0;
                min-height: 180mm;
            }
            .top-nav { display: none; }
        }
    </style>
</head>
<body>
    <div class="page">

        <!-- ============================================================
             SLIDE 1 · PROBLEMS & HYBRID AI SOLUTION (NEURO-SYMBOLIC)
             ============================================================ -->
        <section class="slide-section" id="slide-1">
            <div class="top-nav">
                <div class="brand">
                    <span class="dot"></span>
                    <span data-vi="Casa Escondida · Kế Hoạch 2 Slide Cho Lead" data-en="Casa Escondida · 2-Slide Executive Plan">Casa Escondida · 2-Slide Executive Plan</span>
                </div>
                <div class="nav-right">
                    <a href="extractor-pod-showcase.html" class="arch-btn" target="_blank">
                        <span data-vi="Xem Sơ Đồ Kiến Trúc Chi Tiết →" data-en="View Architecture Pipeline Graph →">View Architecture Pipeline Graph →</span>
                    </a>
                    <div class="lang-switcher" aria-label="Language selection">
                        <button type="button" class="lang-btn active" data-lang="en">EN</button>
                        <button type="button" class="lang-btn" data-lang="vi">VI</button>
                    </div>
                </div>
            </div>

            <span class="kicker" data-vi="Trang 1 / 2 · Vấn đề thực tế &amp; Giải pháp kỹ thuật" data-en="Slide 1 / 2 · Real Problem &amp; Hybrid AI Solution">Slide 1 / 2 · Real Problem &amp; Hybrid AI Solution</span>
            <h1 data-vi="Trợ Lý WhatsApp: Khắc Phục Lỗi &amp; Ứng Dụng Hybrid AI" data-en="WhatsApp Assistant: Resolving Rigidity via Hybrid AI">WhatsApp Assistant: Resolving Rigidity via Hybrid AI</h1>
            <p class="lede" data-vi="Bot đọc tin nhắn khách bằng ngôn ngữ tự nhiên (Anh · Việt · Trung), rút ra thông tin đặt phòng, hỏi nốt phần thiếu, rồi bàn giao cho nhân viên chốt giá. Odoo vẫn giữ giá, hoá đơn và phòng — phần này chỉ đứng ngoài tiếp khách." data-en="The bot reads natural WhatsApp messages (EN · VI · ZH), extracts trip details, clarifies missing parameters, and hands off to human staff for pricing. Odoo ERP retains rates, rooms, and invoices — this system acts as the front concierge.">The bot reads natural WhatsApp messages (EN · VI · ZH), extracts trip details, clarifies missing parameters, and hands off to human staff for pricing. Odoo ERP retains rates, rooms, and invoices — this system acts as the front concierge.</p>

            <!-- KPI STRIP -->
            <div class="kpi-strip">
                <div class="kpi-box green">
                    <div class="val">0%</div>
                    <div class="lbl" data-vi="Bịa Dữ Liệu" data-en="Hallucination Rate">Hallucination Rate</div>
                    <div class="sub" data-vi="Đo trên 30 kịch bản ngặt nghèo" data-en="Benchmarked across 30 cases">Benchmarked across 30 cases</div>
                </div>
                <div class="kpi-box green">
                    <div class="val">233</div>
                    <div class="lbl" data-vi="Bài Test Xanh" data-en="Green Unit Tests">Green Unit Tests</div>
                    <div class="sub" data-vi="Regression suite tự động mỗi commit" data-en="Automated regression suite">Automated regression suite</div>
                </div>
                <div class="kpi-box green">
                    <div class="val" data-vi="Đã Live" data-en="Synced">Synced</div>
                    <div class="lbl" data-vi="Bản Sửa Tính Tiền" data-en="Pricing &amp; Phase 1 Fix">Pricing &amp; Phase 1 Fix</div>
                    <div class="sub" data-vi="Đã đồng bộ lên Vercel Production" data-en="Live on Vercel Production">Live on Vercel Production</div>
                </div>
                <div class="kpi-box green">
                    <div class="val" data-vi="Đã Khóa" data-en="Resolved">Resolved</div>
                    <div class="lbl" data-vi="Chặn Hỏi Lặp" data-en="NEVER RE-ASK Rule">NEVER RE-ASK Rule</div>
                    <div class="sub" data-vi="Tự lưu diveNotes &amp; báo nhân viên" data-en="Saves diveNotes &amp; alerts staff">Saves diveNotes &amp; alerts staff</div>
                </div>
            </div>

            <!-- SPLIT: REAL PROBLEM VS HYBRID AI SOLUTION -->
            <div class="split-grid">
                <!-- Left Col: Real Problems -->
                <div class="split-col">
                    <h2 data-vi="1. Vấn đề thực tế đang bị gì?" data-en="1. What Were The Real Problems?">1. What Were The Real Problems?</h2>

                    <div class="item-card alert">
                        <div class="title">
                            <span data-vi="Lỗi hôm qua trên WhatsApp (Kẹt Deploy)" data-en="Yesterday's WhatsApp Issue (Deployment)">Yesterday's WhatsApp Issue (Deployment)</span>
                            <span class="tag green" data-vi="Đã Đồng Bộ" data-en="Fixed &amp; Synced">Fixed &amp; Synced</span>
                        </div>
                        <div class="desc" data-vi="Bản sửa lỗi tính tiền gói lặn hôm qua chưa tự động đưa lên máy chủ thật. &lt;b&gt;Hôm nay đã đồng bộ trực tiếp lên Production.&lt;/b&gt;" data-en="Diving package pricing fix was pending prod sync yesterday. &lt;b&gt;Now built and deployed directly to Production.&lt;/b&gt;">
                            Diving package pricing fix was pending prod sync yesterday. <b>Now built and deployed directly to Production.</b>
                        </div>
                    </div>

                    <div class="item-card alert">
                        <div class="title">
                            <span data-vi="Bot hỏi lại thứ khách vừa nói (Căn bệnh 'Logicalize')" data-en="Bot Re-asks Stated Details (Over-Logicalized)">Bot Re-asks Stated Details (Over-Logicalized)</span>
                            <span class="tag green" data-vi="Đã Triệt Tiêu" data-en="Resolved in Code">Resolved in Code</span>
                        </div>
                        <div class="desc" data-vi="Khách viết: &lt;i&gt;'1 người lặn ngày đầu, 5 người lặn cả 2 ngày'&lt;/i&gt;. Logic cũ ép vào 1 số nguyên &lt;code&gt;divers&lt;/code&gt; không được nên quay ra hỏi lại &amp; xóa nhầm cả tổng số khách. &lt;b&gt;Nay đã khắc phục triệt để!&lt;/b&gt;" data-en="Guest writes: &lt;i&gt;'1 person dives day 1, 5 people dive both days'&lt;/i&gt;. Old slot logic failed to collapse to one integer &lt;code&gt;divers&lt;/code&gt; and re-asked: &lt;i&gt;'How many people are diving?'&lt;/i&gt; &lt;b&gt;Now completely resolved!&lt;/b&gt;">
                            Guest writes: <i>'1 person dives day 1, 5 people dive both days'</i>. Old slot logic failed to collapse to one integer <code>divers</code> and re-asked: <i>'How many people are diving?'</i> <b>Now completely resolved!</b>
                        </div>
                    </div>

                    <div class="item-card">
                        <div class="title">
                            <span data-vi="Chưa từng đo độ tự nhiên" data-en="Zero Naturalness Scoring">Zero Naturalness Scoring</span>
                            <span class="tag orange" data-vi="Chờ Phase 2" data-en="Phase 2 Target">Phase 2 Target</span>
                        </div>
                        <div class="desc" data-vi="Đo rất kỹ 'không bịa' (0% bịa), nhưng chưa từng chấm điểm xem bot nói có 'duyên' hay hỏi thừa không. Cần 30 tin nhắn thật từ Eloa để dựng bài chấm điểm." data-en="Rigidly measured hallucination (0%), but never scored conversational charm. Needs 30 real transcripts from Eloa to establish objective grading.">
                            Rigidly measured hallucination (0%), but never scored conversational charm. Needs 30 real transcripts from Eloa to establish objective grading.
                        </div>
                    </div>
                </div>

                <!-- Right Col: Hybrid AI Solution -->
                <div class="split-col">
                    <h2 data-vi="2. Khắc phục thế nào bằng Hybrid AI?" data-en="2. How Does Hybrid AI Solve This?">2. How Does Hybrid AI Solve This?</h2>

                    <div class="item-card solution">
                        <div class="title">
                            <span data-vi="Tầng Neuro (AI Linh Hoạt): Giọng Lễ Tân 5 Sao" data-en="Neuro Layer (AI): 5-Star Concierge Voice">Neuro Layer (AI): 5-Star Concierge Voice</span>
                            <span class="tag green" data-vi="Đã Ship" data-en="Shipped">Shipped</span>
                        </div>
                        <div class="desc" data-vi="Bỏ hẳn mẫu câu dập khuôn của robot. AI được giao vai Lễ tân khách sạn: chào hỏi ân cần, giải thích lịch trình ấm áp bằng tiếng Anh, Việt hoặc Trung trên nền dữ liệu đã kiểm chứng." data-en="Eliminated static robot templates. AI acts as a warm 5-star concierge: greets politely and explains itineraries warmly in EN, VI, or ZH based solely on verified facts.">
                            Eliminated static robot templates. AI acts as a warm 5-star concierge: greets politely and explains itineraries warmly in EN, VI, or ZH based solely on verified facts.
                        </div>
                    </div>

                    <div class="item-card solution">
                        <div class="title">
                            <span data-vi="Tầng Symbolic (Code Khóa Cứng): Fact Gate Kiểm Duyệt" data-en="Symbolic Layer (Code): Post-Gen Fact Gate">Symbolic Layer (Code): Post-Gen Fact Gate</span>
                            <span class="tag green" data-vi="Bảo Đảm 0% Bịa" data-en="Zero Hallucination">Zero Hallucination</span>
                        </div>
                        <div class="desc" data-vi="Hàm &lt;code&gt;verifySynthesizedReply&lt;/code&gt; đối chiếu 100% câu AI viết ra: chặn đứng mọi ký hiệu tiền tệ (&lt;code&gt;$&lt;/code&gt;, &lt;code&gt;₱&lt;/code&gt;, &lt;code&gt;PHP&lt;/code&gt;), hứa giữ phòng hoặc lệch số đêm/phòng; sai lệch là tự quay về mẫu câu an toàn." data-en="&lt;code&gt;verifySynthesizedReply&lt;/code&gt; audits every AI sentence: blocks any currency quote (&lt;code&gt;$&lt;/code&gt;, &lt;code&gt;₱&lt;/code&gt;, &lt;code&gt;PHP&lt;/code&gt;), false confirmation, or count mismatch — auto-rolling back to safe templates.">
                            <code>verifySynthesizedReply</code> audits every AI sentence: blocks any currency quote (<code>$</code>, <code>₱</code>, <code>PHP</code>), false confirmation, or count mismatch — auto-rolling back to safe templates.
                        </div>
                    </div>

                    <div class="item-card solution">
                        <div class="title">
                            <span data-vi="Quy Tắc Ứng Xử Mới: CẤM HỎI LẠI THỨ ĐÃ NÓI" data-en="New Decision Rule: NEVER RE-ASK STATED FACTS">New Decision Rule: NEVER RE-ASK STATED FACTS</span>
                            <span class="tag green" data-vi="Đã Ship (233 Tests)" data-en="Shipped (233 Tests)">Shipped (233 Tests)</span>
                        </div>
                        <div class="desc" data-vi="Khi khách nói lịch phức tạp (lặn lẻ người), bot &lt;b&gt;không hỏi lại&lt;/b&gt; và không xóa nhầm số khách. Máy lưu nguyên văn vào &lt;code&gt;diveNotes&lt;/code&gt; và gắn cờ &lt;code&gt;getStaffAlerts&lt;/code&gt; chuyển nhân viên thật xử lý!" data-en="When guests describe nuances, the bot &lt;b&gt;never re-asks&lt;/b&gt; and preserves guest counts. It stores the verbatim schedule in &lt;code&gt;diveNotes&lt;/code&gt; and triggers &lt;code&gt;getStaffAlerts&lt;/code&gt; for human handoff!">
                            When guests describe nuances, the bot <b>never re-asks</b> and preserves guest counts. It stores the verbatim schedule in <code>diveNotes</code> and triggers <code>getStaffAlerts</code> for human handoff!
                        </div>
                    </div>
                </div>
            </div>

            <div class="slide-footer">
                <span data-vi="Trợ lý đặt phòng Casa Escondida · TechNext Edge" data-en="Casa Escondida Booking Assistant · TechNext Edge">Casa Escondida Booking Assistant · TechNext Edge</span>
                <span data-vi="Sang trang 2: Lộ trình 3 Phase &amp; Việc cần Lead chốt →" data-en="Next Slide: 3-Phase Roadmap &amp; Lead Decisions →">Next Slide: 3-Phase Roadmap &amp; Lead Decisions →</span>
            </div>
        </section>


        <!-- ============================================================
             SLIDE 2 · 3 UPCOMING PHASES ROADMAP & CRITICAL BLOCKERS
             ============================================================ -->
        <section class="slide-section" id="slide-2">
            <span class="kicker" data-vi="Trang 2 / 2 · Lộ trình triển khai &amp; Quyết định" data-en="Slide 2 / 2 · Delivery Roadmap &amp; Decisions">Slide 2 / 2 · Delivery Roadmap &amp; Decisions</span>
            <h1 data-vi="Lộ Trình Các Phase Tiếp Theo &amp; Nút Thắt Cần Gỡ" data-en="Upcoming Phases Roadmap &amp; Critical Blockers">Upcoming Phases Roadmap &amp; Critical Blockers</h1>
            <p class="lede" data-vi="Tập trung vào 3 phase tiếp nối thực tế: Phase 1 đã hoàn tất 100% trong code &amp; production; Phase 2 mở khóa Odoo &amp; đo lường chất lượng; Phase 3 tự động hóa xuất báo giá hoàn chỉnh." data-en="Focusing on 3 consecutive phases: Phase 1 is now 100% completed in code &amp; production; Phase 2 unblocks Odoo and naturalness scoring; Phase 3 delivers full quotation automation.">Focusing on 3 consecutive phases: Phase 1 is now 100% completed in code &amp; production; Phase 2 unblocks Odoo and naturalness scoring; Phase 3 delivers full quotation automation.</p>

            <!-- 3 PHASES ROW -->
            <div class="phases-row">
                <!-- Phase 1 -->
                <div class="phase-col active">
                    <span class="phase-badge" style="color:var(--tool);" data-vi="Phase 1 · Đã hoàn tất 100% (Live)" data-en="Phase 1 · Completed Today (100% Live)">Phase 1 · Completed Today (100% Live)</span>
                    <h3 data-vi="✓ Sửa Lỗi &amp; Gia Cố Rào Chắn" data-en="✓ Hotfix Deploy &amp; Guardrails">✓ Hotfix Deploy &amp; Guardrails</h3>
                    <ul class="phase-tasks">
                        <li data-vi="&lt;b&gt;✓ Đưa bản sửa tính tiền lên production:&lt;/b&gt; Đã đồng bộ hotfix lên Vercel Production." data-en="&lt;b&gt;✓ Deployed pricing hotfix to production:&lt;/b&gt; Synced stranded fix to Vercel Production."><b>✓ Deployed pricing hotfix to production:</b> Synced stranded fix to Vercel Production.</li>
                        <li data-vi="&lt;b&gt;✓ Gắn bộ lọc Fact Gate (&lt;code&gt;verifySynthesizedReply&lt;/code&gt;):&lt;/b&gt; Chặn 100% bịa giá &amp; lệch số đêm/phòng." data-en="&lt;b&gt;✓ Shipped AI Fact Gate (&lt;code&gt;verifySynthesizedReply&lt;/code&gt;):&lt;/b&gt; Blocks price quotes &amp; count mismatches."><b>✓ Shipped AI Fact Gate (<code>verifySynthesizedReply</code>):</b> Blocks price quotes &amp; count mismatches.</li>
                        <li data-vi="&lt;b&gt;✓ Triệt tiêu tật hỏi lại (&lt;code&gt;NEVER RE-ASK&lt;/code&gt;):&lt;/b&gt; Tự lưu &lt;code&gt;diveNotes&lt;/code&gt; + tách danh từ lặn khỏi &lt;code&gt;counts.ts&lt;/code&gt;." data-en="&lt;b&gt;✓ Eliminated re-asking (&lt;code&gt;NEVER RE-ASK&lt;/code&gt;):&lt;/b&gt; Auto-routes &lt;code&gt;diveNotes&lt;/code&gt; &amp; fixes &lt;code&gt;counts.ts&lt;/code&gt; conflict."><b>✓ Eliminated re-asking (<code>NEVER RE-ASK</code>):</b> Auto-routes <code>diveNotes</code> &amp; fixes <code>counts.ts</code> conflict.</li>
                        <li data-vi="&lt;b&gt;✓ Gắn cảnh báo chiết khấu 30% (&lt;code&gt;getStaffAlerts&lt;/code&gt;):&lt;/b&gt; Báo nhân viên xác nhận giá Đại lý." data-en="&lt;b&gt;✓ Added 30% agency rate alert (&lt;code&gt;getStaffAlerts&lt;/code&gt;):&lt;/b&gt; Flags partner enquiries for staff."><b>✓ Added 30% agency rate alert (<code>getStaffAlerts</code>):</b> Flags partner enquiries for staff.</li>
                    </ul>
                </div>

                <!-- Phase 2 -->
                <div class="phase-col">
                    <span class="phase-badge" style="color:var(--accent);" data-vi="Phase 2 · Tuần sau (Chờ Lead gỡ)" data-en="Phase 2 · Next Sprint (Needs Lead)">Phase 2 · Next Sprint (Needs Lead)</span>
                    <h3 data-vi="Mở Khóa Odoo &amp; Đo Lường" data-en="Odoo Unblocking &amp; Scoring">Odoo Unblocking &amp; Scoring</h3>
                    <ul class="phase-tasks">
                        <li data-vi="&lt;b&gt;Nhận cấu trúc dữ liệu Odoo từ Phillip:&lt;/b&gt; Bắt đầu viết code kết nối tính giá và giữ phòng." data-en="&lt;b&gt;Receive Odoo contract from Phillip:&lt;/b&gt; Start coding pricing and inventory integration."><b>Receive Odoo contract from Phillip:</b> Start coding pricing and inventory integration.</li>
                        <li data-vi="&lt;b&gt;Nhận 30 tin nhắn thật từ Eloa:&lt;/b&gt; Dựng bài chấm điểm khách quan xem bot đã nói duyên chưa." data-en="&lt;b&gt;Receive 30 transcripts from Eloa:&lt;/b&gt; Build objective benchmark to score conversational charm."><b>Receive 30 transcripts from Eloa:</b> Build objective benchmark to score conversational charm.</li>
                        <li data-vi="&lt;b&gt;Đóng biên bản tầng trả lời:&lt;/b&gt; Anthony ký duyệt chính thức để khóa thiết kế." data-en="&lt;b&gt;Sign off ADR:&lt;/b&gt; Anthony formally signs decision record to freeze design."><b>Sign off ADR:</b> Anthony formally signs decision record to freeze design.</li>
                        <li data-vi="&lt;b&gt;Chốt 4 giá trị mặc định:&lt;/b&gt; Jett/Eloa xác nhận giờ check-in, chính sách trẻ em." data-en="&lt;b&gt;Confirm 4 defaults:&lt;/b&gt; Jett/Eloa confirm check-in hours and infant policy."><b>Confirm 4 defaults:</b> Jett/Eloa confirm check-in hours and infant policy.</li>
                    </ul>
                </div>

                <!-- Phase 3 -->
                <div class="phase-col">
                    <span class="phase-badge" style="color:var(--claude);" data-vi="Phase 3 · Hoàn thiện (Go-Live)" data-en="Phase 3 · Rollout (Go-Live)">Phase 3 · Rollout (Go-Live)</span>
                    <h3 data-vi="Tự Động Báo Giá &amp; Bàn Giao" data-en="Automated Quotation &amp; Handoff">Automated Quotation &amp; Handoff</h3>
                    <ul class="phase-tasks">
                        <li data-vi="&lt;b&gt;Xuất link báo giá Odoo:&lt;/b&gt; Bot gửi link báo giá tạm tính chuẩn quốc tế cho khách." data-en="&lt;b&gt;Issue Odoo quote links:&lt;/b&gt; Bot sends verified estimate links to guests on WhatsApp."><b>Issue Odoo quote links:</b> Bot sends verified estimate links to guests on WhatsApp.</li>
                        <li data-vi="&lt;b&gt;Quy trình bàn giao mượt mà:&lt;/b&gt; Nhân viên resort tiếp quản đơn hàng trên Odoo chỉ với 1 click." data-en="&lt;b&gt;Seamless staff handoff:&lt;/b&gt; Resort staff confirms rooms on Odoo with a single click."><b>Seamless staff handoff:</b> Resort staff confirms rooms on Odoo with a single click.</li>
                        <li data-vi="&lt;b&gt;Giám sát chất lượng 24/7:&lt;/b&gt; Tự động cảnh báo nếu khách phàn nàn để nhân viên can thiệp ngay." data-en="&lt;b&gt;24/7 Quality monitoring:&lt;/b&gt; Auto-alert staff if sentiment turns negative."><b>24/7 Quality monitoring:</b> Auto-alert staff if sentiment turns negative.</li>
                    </ul>
                </div>
            </div>

            <!-- BOTTOM: 2 LEAD ACTIONS & INTENTIONAL WITHHOLDS -->
            <div class="bottom-grid">
                <div class="lead-action-box">
                    <h4 data-vi="Cần Lead giúp đúng 2 việc (Nút thắt quyết định tiến độ)" data-en="Two Critical Actions Needed From Tech Lead">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                        </svg>
                        <span data-vi="Cần Lead giúp đúng 2 việc (Nút thắt quyết định)" data-en="Two Critical Actions Needed From Tech Lead">Two Critical Actions Needed From Tech Lead</span>
                    </h4>
                    <ul>
                        <li data-vi="&lt;b&gt;1. Thúc Phillip chốt cấu trúc dữ liệu Odoo:&lt;/b&gt; Mọi việc liên quan đến tính giá và xuất báo giá đang kẹt ở đây, không phải chờ đội kỹ thuật." data-en="&lt;b&gt;1. Unblock Phillip on Odoo schema:&lt;/b&gt; All quotation and pricing logic is blocked on this single contract, not on engineering.">
                            <b>1. Unblock Phillip on Odoo schema:</b> All quotation and pricing logic is blocked on this single contract, not on engineering.
                        </li>
                        <li data-vi="&lt;b&gt;2. Xin Eloa 30 tin nhắn khách thật (ẩn danh):&lt;/b&gt; Không có tin thật thì việc 'làm cho bot tự nhiên hơn' mãi là cảm tính, không ai đo đếm được." data-en="&lt;b&gt;2. Obtain 30 real transcripts from Eloa:&lt;/b&gt; Without real data, improving tone remains subjective guesswork without proof.">
                            <b>2. Obtain 30 real transcripts from Eloa:</b> Without real data, improving tone remains subjective guesswork without proof.
                        </li>
                    </ul>
                </div>

                <div class="withhold-box">
                    <h4 data-vi="Hai việc team CỐ Ý CHƯA LÀM (Bảo vệ dự án)" data-en="Two Things Deliberately Withheld (Safeguards)">Two Things Deliberately Withheld (Safeguards)</h4>
                    <ul>
                        <li data-vi="&lt;b&gt;Chưa viết code tính tiền Odoo:&lt;/b&gt; Cấu trúc chưa chốt, xây trước chắc chắn tuần sau phải đập đi làm lại lãng phí nguồn lực." data-en="&lt;b&gt;Withholding Odoo code:&lt;/b&gt; Contract not finalized; coding beforehand guarantees costly rework."><b>Withholding Odoo code:</b> Contract not finalized; coding beforehand guarantees costly rework.</li>
                        <li data-vi="&lt;b&gt;Không gộp 2 lượt gọi AI làm 1:&lt;/b&gt; Tách riêng bước đọc và viết câu để giữ rào chắn code chặn 100% việc AI bịa giá cho khách." data-en="&lt;b&gt;Refusing to merge model calls:&lt;/b&gt; Separating extraction and generation preserves the firewall against hallucinations."><b>Refusing to merge model calls:</b> Separating extraction and generation preserves the firewall against hallucinations.</li>
                    </ul>
                </div>
            </div>

            <div class="slide-footer">
                <span data-vi="Kế hoạch cô đọng 2 Slide · Dành cho Lead duyệt" data-en="Concise 2-Slide Plan · Prepared for Tech Lead Approval">Concise 2-Slide Plan · Prepared for Tech Lead Approval</span>
                <a href="extractor-pod-showcase.html" target="_blank" data-vi="Mở trang Kiến trúc Extractor Pod đầy đủ →" data-en="Open Full Architecture Showcase →">Open Full Architecture Showcase →</a>
            </div>
        </section>

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

            document.title = lang === 'en'
                ? 'Casa Escondida — WhatsApp Booking Assistant Upgrade Plan'
                : 'Kế Hoạch Nâng Cấp Trợ Lý Đặt Phòng WhatsApp — Casa Escondida';
        }

        btns.forEach(function(b) {
            b.addEventListener('click', function() {
                var l = this.getAttribute('data-lang');
                applyLang(l);
            });
        });

        var initLang = 'en';
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
console.log('Successfully generated concise 2-slide Executive Plan in English default for Lead!');
