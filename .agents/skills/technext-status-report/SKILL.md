---
name: technext-status-report
description: Standard Corporate Status & Inventory Report generator for TechNext projects. Use this skill whenever the user asks to generate a project status report, progress briefing, technical review, QA/QC summary, or pod status in the standardized TechNext corporate HTML format (based on the 2-column layout with sidebar, bilingual language toggle EN/VI, interactive checkpoints, progress bar, key-value grid, and color-coded tags).
---

# TechNext Corporate Status & Technical Report Standard

This skill defines the official, corporate-wide standard for generating interactive status, inventory, and briefing reports across all TechNext projects.

It enforces the exact visual architecture, design tokens, responsive layout, and interactive features established in `E:/technext-qa-qc-workflow/docs/biz-card-qa-qc-status_Nhat.html`.

---

## 1. When to Use This Skill
Activate this skill whenever the user asks for:
- A project status report (Báo cáo trạng thái / tiến độ dự án).
- A pod/team technical briefing for Tech Lead or stakeholders.
- A QA/QC automation inventory or test execution summary.
- Any export of project health, test results, blockers, and architecture decisions in HTML.

---

## 2. Mandatory Architectural Standard

Every generated report **MUST** adhere to the following structure:

### Layout (2-Column Responsive)
- **Left Sticky Sidebar (`.sidebar` - 270px width, 100vh):**
  - **Brand & Metadata (`.sb-brand`, `.sb-meta`):** Project title, Owner, and Sprint / Version.
  - **Language Switcher (`.seg`):** Two toggle buttons: `TIẾNG VIỆT` and `ENGLISH` (controls `body[data-lang="vi|en"]`).
  - **Interactive Progress Box (`.prog-box`):**
    - Dynamic text `#progCount` displaying `X/Y (Z%)` verified items.
    - Animated progress bar `.prog-fill` with width transitioning.
    - Reset button `.btn-reset` to uncheck all items.
  - **Table of Contents Navigation (`.nav`):** Section links with smooth scrolling to `#summary`, `#tasks`, `#stack`, `#benchmarks`, `#bugs`, `#checklist`.
- **Right Main Content (`.main`):**
  - Max width `1080px`, centered with generous padding.

### Visual Styling & Theme Tokens
```css
:root {
  --ink: #162033;
  --muted: #647084;
  --blue: #0d4f5f;
  --teal: #0f766e;
  --cyan: #155e75;
  --coral: #e85d75;
  --gold: #f59e0b;
  --violet: #6d5dfc;
  --line: #d8e2ea;
  --panel: #f7fafc;
  --paper: #fff;
  --green: #059669;
  --green-bg: #ecfdf5;
  --red: #dc2626;
  --red-bg: #fef2f2;
  --amber: #b45309;
  --amber-bg: #fffbeb;
  --shadow: 0 18px 50px rgba(15, 23, 42, 0.12);
}
```

### Hero Header Banner (`.head`)
- Gradient background: `linear-gradient(155deg, #0d4f5f 0%, #155e75 45%, #0f766e 100%)`.
- Status Tags container (`.tags`):
  - Green badges: `.tag.ok` (e.g., `UNIT TESTS: 25/25 PASS`, `CLOSED TASKS: 6/6`).
  - Warning badges: `.tag.warn` (e.g., `CẦN LEAD: ANTHROPIC KEY`).
- Large heading (`h1`), bilingual description paragraph (`p`).
- 4-column Meta Grid (`.meta-grid`) with:
  1. Owner / Phụ trách
  2. Git Branch / Nhánh Git
  3. Scope / Phạm vi Kỹ thuật
  4. Sprint / Tiến độ

### Content Sections (`.sec`)
1. **Section 1: Project/Pod Nature & Architecture:**
   - Key-Value grid (`.kv`) with 230px label and 1fr value.
   - Core quality gates or pipeline stages table (`.tw > table`).
2. **Section 2: Completed Capabilities / Deliverables:**
   - Table with columns: Module/Task, Description, Status (`.badge.pass`), Verification Evidence.
3. **Section 3: Specialized Tech Stack:**
   - Table detailing Layer, Technology, Justification, and Proven Impact.
4. **Section 4: Technical Benchmarks / Metrics:**
   - Comparison table with metrics, candidates, targets, and conclusions.
   - Architectural decision callouts (`.callout`).
5. **Section 5: Real Bugs Caught & Fixed:**
   - Callout boxes (`.callout.danger` for Critical/Major, `.callout` for Medium/Minor).
6. **Section 6: Interactive Checkpoints & Lead Decisions:**
   - Checkbox container (`.ck`) with group counter (`.cnt[data-g="..."]`).
   - Group A: Completed & Promoted Capabilities (pre-checked).
   - Group B: Blockers Requiring Lead Decision (unchecked).
   - Each checkpoint row (`.ckrow`) contains a checkbox, bold title (`.t`), and subtitle (`.d`).

---

## 3. Bilingual Support Rules (i18n)
All text content within headings, tables, callouts, and checkpoints **MUST** be provided in both Vietnamese and English using span tags:
```html
<span class="vi">Nội dung tiếng Việt</span>
<span class="en">English content</span>
```
Switching is handled via CSS:
```css
body[data-lang="vi"] .en { display: none; }
body[data-lang="en"] .vi { display: none; }
```
The selected language must be persisted in `localStorage` under a unique key for the project.

---

## 4. Checkpoints Persistence & Calculation
The JavaScript must include:
1. `localStorage` syncing for all checkbox states.
2. Dynamic calculation of `#progCount` (`X/Y (Z%)`) and `#progFill` bar width.
3. Group-level counting (`.cnt[data-g="groupName"]`).
4. A functional `#btnReset` button.

---

## 5. Standard Workflow for Agents

When requested to generate or update a report:
1. **Gather Facts:** Read codebase files, test logs, git status, ADRs, and blockers to ensure 100% factual accuracy.
2. **Populate Standard Template:** Use the template structure from `resources/template.html` (or referenced from this skill).
3. **Save Output File:** Write to `docs/<project-name>-status.html` (e.g., `docs/extractor-pod-status.html`).
4. **Provide Access Link:** Always provide a clickable file link (e.g., `file:///path/to/report.html`) and instructions to launch via PowerShell (`Start-Process`).
