---
name: pipeline-showcase
description: Build a self-contained, single-file HTML presentation page for a multi-stage AI/automation pipeline (orchestrator → staged subagents → client deliverables), in the warm-editorial "n8n-style" visual identity (cream/brown palette with Claude-orange accent, Playfair Display + Plus Jakarta Sans + JetBrains Mono typography, 3-panel black-box overview with animated counters, and interactive animated SVG node-graph with path tracing and A4 landscape PDF print support). Use when the user asks for a presentation/one-pager/deck-alternative explaining an agentic pipeline, workflow, or multi-agent system to Tech Leads, stakeholders, or clients.
license: MIT
metadata:
  version: "1.0"
  reference: "docs/extractor-pod-showcase.html"
---

# Pipeline Showcase

Create an executive, single-file HTML presentation page that visually explains any complex AI pipeline or multi-agent automation workflow. 

It replicates the warm-editorial, high-craft presentation standard seen in [docs/extractor-pod-showcase.html](file:///e:/technext-edge/docs/extractor-pod-showcase.html):
* **Section 1: 3-Panel Black-Box Overview** (Inputs → Dark Summary Box with Animated Counters → Outputs & Deliverables).
* **Section 2: Interactive SVG Node Graph** (Phases Columns, Color-coded Trigger/Agent/Tool/Skill/Deliverable nodes, Animated Flowing Edges, Hover Path Highlighting, Detail Tooltips).
* **Deck & PDF Print Ready**: Dual-purpose design that automatically paginates into two clean landscape slides when printed (`@page { size: A4 landscape }`).

---

## 1. When to Use This Skill vs. Alternatives

| Skill | Best Used For | Output Style |
| :--- | :--- | :--- |
| **`pipeline-showcase`** *(This skill)* | **Executive Presentations, Client Briefings, Tech Lead Walkthroughs** for multi-step AI agent pipelines. Explains *"what goes in, what happens inside, what comes out"* with high visual impact. | Warm editorial (cream/brown/Claude-orange), Playfair Display serif headings, animated counters, interactive SVG node-graph. |
| **`technext-status-report`** | **QA/QC Audits, Sprint Status Reports, Engineering Inventories**. | 2-column corporate dashboard, interactive checkboxes with progress bar, KPI grid, bilingual toggle (EN/VI). |
| **`archify`** | **System Architecture & Cloud/Network Topology**. | Orthogonal component maps, security trust boundaries, strict schema validation. |

---

## 2. Page Anatomy & Core Design System

### A. Color Tokens (`:root`)
* **Backgrounds**: `--bg: #FAF7F2`, `--bg2: #F3ECDF`, `--card: #FFFFFF`
* **Typography**: `--ink: #2A211B`, `--muted: #7A6A5E`
* **Accents**: `--accent: #8B5E34` (coffee brown), `--claude: #D97757` (Claude terracotta orange)
* **Semantic Node Colors**:
  * `trigger`: Blue-grey (`#7A8CA6`) — Human or inbound system event
  * `agent`: Terracotta orange (`#D97757`) — LLM reasoning or model call
  * `tool`: Forest green (`#4B7F52`) — Deterministic code, validation, or DB call
  * `skill`: Warm tan (`#B08968`) — Stage logic, templates, or instructions
  * `deliverable`: Rust red (`#A65E3F`) — Verified output artifact or gate result

### B. Typography Stack
* **Headings**: `'Playfair Display', Georgia, serif` (Editorial, commanding, human)
* **Body / UI**: `'Plus Jakarta Sans', system-ui, sans-serif` (Crisp, modern readability)
* **Code / Numbers / Metrics**: `'JetBrains Mono', monospace` (Engineering precision)

---

## 3. Section-by-Section Structure

### Section 1: The 3-Panel Black-Box Overview (`#overview`)
Explains the pipeline at the 30,000-foot level:
1. **Left Panel (`Inputs`)**:
   - What the pipeline consumes before any AI execution begins.
   - List of 4–7 input items with custom glyphs and one-line descriptions.
2. **Center Panel (`Black-Box Summary` - `.blackbox`)**:
   - Dark radial gradient container (`#2A211B` to `#3A2E24`).
   - **4 Animated Counters** (`data-count="X"`): Counts up automatically when scrolled into view (e.g. fields count, model calls per turn, test count, success rate).
   - Crisp technical summary paragraph (`.box-sum`).
   - Model pills strip (`.agent-pill`) displaying model engines (Claude, DeepSeek, Gemini).
3. **Right Panel (`Outputs`)**:
   - Client-facing deliverables produced by the pipeline.
   - Cards with color-coded side rails, tags, and file extensions (`.json`, `whatsapp`, `[]`).
4. **Causality Flow**:
   - Bouncing directional arrows (`.arrow.right`) visually connect Panel 1 → 2 → 3.

### Section 2: Inside the Workflow Node-Graph (`#detail`)
Opens the black box into a visual flow:
1. **Vertical Phase Columns (`PHASES`)**:
   - Numbered stage headers (`.phase-num`, `.phase-name`) and bottom summary captions (`.phase-caption`).
2. **Color-Coded Nodes (`NODES`)**:
   - Display icon, title, kind tag, description, and optional model chip.
   - Agent nodes feature an animated light shimmer on their left rail (`railShimmer`).
3. **Interactive Features**:
   - **Spotlight Background**: Subtle mouse-tracking radial highlight.
   - **Path Highlighting**: Hovering any node dims unrelated elements (`.node-fade`, `.edge-fade`) and accelerates/thickens the active causal path (`.edge-highlight`).
   - **Rich Detail Cards**: Agent nodes open structured tooltips on hover displaying `Purpose`, `Tools`, `Upstream`, `Downstream`, and `On-failure` fallback.
4. **Legend**:
   - Visual key at the bottom mapping the 5 node types.

---

## 4. How to Generate a New Showcase Page

### Step 1: Copy the Template
Copy `template.html` from this skill directory to your target destination (e.g. `docs/<pipeline-name>-showcase.html`):

```bash
cp .agents/skills/pipeline-showcase/template.html docs/my-pipeline-showcase.html
```

### Step 2: Populate Section 1 (HTML Body)
Search for `<!-- EDIT:` markers in the HTML:
1. Update `<title>`, header kicker, `<h1>`, and `.lede`.
2. Edit Panel 1 (`.input-list`): Provide 4–6 input `<li>` items.
3. Edit Panel 2 (`.counters` & `.box-sum`): Set `data-count` values and summary text.
4. Edit Panel 3 (`.out-list`): Provide 2–4 output `.out-card` items.

### Step 3: Configure Section 2 Data (JavaScript Arrays)
Locate the `EDIT: Data` block inside `<script>`:

```javascript
// 1. Columns (Phases)
var PHASES = [
  { id: 0, title: 'Intake', caption: '<b>Out:</b> Verified message appended to transcript.' },
  { id: 1, title: 'Extract', caption: '<b>Out:</b> Raw field claims from parallel passes.' },
  { id: 2, title: 'Verify', caption: '<b>Out:</b> Normalized facts passing code validation.' },
  { id: 3, title: 'Reply', caption: '<b>Out:</b> Grounded hospitality response.' }
];

// 2. Nodes
var NODES = [
  { 
    id: 'guest', 
    phase: 0, row: 0, 
    kind: 'trigger', 
    title: 'Guest', 
    kindTag: 'Trigger', 
    desc: 'Inbound message from WhatsApp.', 
    icon: 'user' 
  },
  { 
    id: 'extractor', 
    phase: 1, row: 0, 
    kind: 'agent', 
    title: 'Extraction Agent', 
    kindTag: 'Model call', 
    desc: 'Proposes structured schema.', 
    icon: 'claude', 
    model: 'deepseek-flash',
    detail: {
      purpose: 'Extract all trip parameters.',
      tools: 'Structured tool calling',
      upstream: 'Normalised transcript',
      downstream: 'Raw field claims',
      failure: 'Automatic fallback to deterministic template.'
    }
  },
  { 
    id: 'validator', 
    phase: 2, row: 0, 
    kind: 'tool', 
    title: 'Code Validator', 
    kindTag: 'Tool · deterministic', 
    desc: 'Verifies dates and numbers against code rules.', 
    icon: 'shield' 
  },
  { 
    id: 'reply', 
    phase: 3, row: 0, 
    kind: 'deliverable', 
    title: 'Final Reply', 
    kindTag: 'Deliverable', 
    desc: '5-star concierge message sent to guest.', 
    icon: 'media' 
  }
];

// 3. Edges (Directional arrows)
var EDGES = [
  ['guest', 'extractor'],
  ['extractor', 'validator'],
  ['validator', 'reply']
];
```

### Step 4: Verification & Delivery
1. Open the HTML file directly in any modern browser.
2. Verify:
   - Animated counters fire on scroll.
   - Hovering nodes highlights active upstream/downstream paths.
   - Agent tooltips appear without viewport overflow.
3. Test Print/PDF:
   - Press `Ctrl+P` (or `Cmd+P`) and choose **Landscape**.
   - Confirm Section 1 fits Page 1, Section 2 fits Page 2 with zero clipping.
