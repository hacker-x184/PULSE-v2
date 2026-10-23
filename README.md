# Intelligent Project Management & Team Contribution Analysis Platform

A production-grade B2B SaaS platform for engineering project management, sprint deliverable tracking, transparent team contribution analysis, and rule-based project risk diagnostics.

---

## 1. Project Architecture & Folder Structure

```
├── backend/                       # Standalone Python FastAPI Backend
│   ├── database.py                # SQLAlchemy SQLite connection & session maker
│   ├── models.py                  # SQLAlchemy ORM models with constraints & relationships
│   ├── schemas.py                 # Pydantic v2 validation & response schemas
│   ├── main.py                    # FastAPI application, CORS, and Swagger UI setup
│   ├── seed.py                    # Database seeder with realistic test data
│   ├── test_backend.py            # Automated unit tests for risk and contribution logic
│   ├── requirements.txt           # Python backend dependencies
│   ├── routers/                   # Modular FastAPI REST API routers
│   │   ├── projects.py            # Project CRUD operations
│   │   ├── tasks.py               # Task CRUD, filters, sorting, foreign key checks
│   │   ├── team.py                # Team member CRUD, workload and safety checks
│   │   ├── dashboard.py           # Dashboard metrics & analytics
│   │   ├── reports.py             # Compliance reports & RFC 4180 CSV export
│   │   ├── github.py              # GitHub REST API repository sync
│   │   └── ai.py                  # Grounded AI query endpoint
│   └── services/                  # Core domain logic
│       ├── contribution_calculator.py # Transparent contribution & weighted scores
│       ├── risk_engine.py         # Transparent, rule-based risk evaluation
│       ├── github_service.py      # GitHub integration & member mapping
│       └── ai_service.py          # Grounded AI assistant context preparation
├── src/                           # Frontend React + TypeScript Application
│   ├── api/
│   │   └── client.ts              # Typed REST client with error handling
│   ├── types/
│   │   └── index.ts               # Core domain interfaces
│   ├── utils/
│   │   ├── contribution.ts        # Pure contribution formulas
│   │   ├── contribution.test.ts   # Node unit tests (100% pass)
│   │   ├── risk.ts                # Rule-based risk invariants
│   │   ├── risk.test.ts           # Node unit tests (100% pass)
│   │   ├── csv.ts                 # Safe CSV formatter with formula sanitization
│   │   └── csv.test.ts            # Node unit tests (100% pass)
│   ├── components/
│   │   ├── layout/                # TopBar (Top Bar Contract) & Sidebar
│   │   ├── dashboard/             # Executive Overview & Recharts workload
│   │   ├── projects/              # Projects Portfolio & CRUD modals
│   │   ├── tasks/                 # Kanban Board & Tabular view with filters
│   │   ├── team/                  # Team roster & capacity management
│   │   ├── contributions/         # Transparent contribution analysis
│   │   ├── risks/                 # Rule-based risk diagnostic cards
│   │   ├── reports/               # Multi-tab reports & CSV downloads
│   │   ├── settings/              # GitHub sync & local setup instructions
│   │   ├── common/                # Accessible Modals & ConfirmDialogs
│   │   └── ai/                    # Grounded AI Assistant slide-over drawer
│   ├── App.tsx                    # Root component with state & navigation
│   ├── main.tsx                   # React 19 entry point
│   └── index.css                  # Tailwind CSS styling with Plus Jakarta Sans
├── server.ts                      # Unified dev server (Express + SQLite + Vite)
├── package.json                   # Frontend and Node dependencies
├── metadata.json                  # Application metadata
└── .env.example                   # Environment configuration template
```

---

## 2. Running the Application

### Option A: Unified Dev Server (Interactive Live Preview)
The application includes a unified server in `server.ts` that serves the React frontend and provides matching REST API endpoints backed by a persistent SQLite database (`platform_database.sqlite`).

```bash
# 1. Install Node dependencies
npm install

# 2. Run pure logic unit tests
npx tsx --test src/utils/*.test.ts

# 3. Start development server on port 3000
npm run dev
```

Visit `http://localhost:3000` in your browser.

---

### Option B: Standalone Python FastAPI Backend
You can run the FastAPI backend independently using Python 3.10+:

```bash
# 1. Navigate to backend directory
cd backend

# 2. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Seed the database with realistic demo projects and tasks
python seed.py

# 5. Run automated backend tests
python test_backend.py

# 6. Launch the FastAPI server
uvicorn main:app --reload --port 8000
```

- **Interactive API Documentation (Swagger UI)**: `http://localhost:8000/docs`
- **ReDoc Documentation**: `http://localhost:8000/redoc`

---

## 3. Core Feature Walkthrough

### 1. Dashboard
- **Real-Time KPIs**: Total projects, deliverables count, overall completion rate, pending tasks, and overdue tasks.
- **Team Workload Chart**: Recharts stacked bar chart displaying completed, pending, and overdue tasks per team member.
- **Project Risk Overview**: Summarizes calculated risk levels (Low, Medium, High) for each active initiative.
- **Upcoming Deadlines & Recent Activity**: Chronological log of approaching milestones and recent status transitions.

### 2. Project Portfolio Management
- **Full CRUD**: Create, edit, inspect, and delete projects.
- **Member Assignment**: Associate multiple team members with each project.
- **Progress Tracking**: Automatic progress bar calculation from child tasks.
- **Search & Filters**: Filter projects by lifecycle status (Planning, Active, In Review, Completed, On Hold).

### 3. Task Management (Dual View: Kanban & Table)
- **Kanban Board**: Drag/move deliverables across standard lifecycle lanes (`To Do`, `In Progress`, `In Review`, `Done`).
- **Tabular Data View**: High-density table with sorting by due date, priority, or creation date.
- **Visual Overdue Signaling**: Explicit badges for deliverables past due date.
- **Foreign Key Validation**: Prevents invalid project or assignee references.

### 4. Team Management & Workload Safety
- **Roster Management**: Manage members with name, email, role, and GitHub username.
- **Duplicate Email Prevention**: Backend and frontend enforcement prevents duplicate email creation.
- **Safe Removal Invariant**: Prevents removing any member who currently has active, incomplete tasks.

### 5. Transparent Contribution Analysis
- **Evidence-Based Calculation**: Derived strictly from verified database records.
- **Priority-Weighted Score**: Factors in task complexity (High = 3x, Medium = 2x, Low = 1x).
- **No Hallucinated Scores**: Missing external signals (such as GitHub) are explicitly reported as *Unavailable* rather than penalizing members with zero.

### 6. Rule-Based Project Risk Engine
- **Deterministic Rules**: Evaluates projects based on:
  1. Overdue high-priority tasks (Major risk factor).
  2. Timeline compression (Project deadline within 7 days with < 50% completion).
  3. Deliverables due in the next 72 hours.
  4. Unassigned critical items.
- **Actionable Next Steps**: Generates clear, specific executive actions for each detected factor.

### 7. Reports & Safe CSV Export
- **Report Types**: Progress report, Overdue deliverables report, Team contribution report, and Risk audit report.
- **RFC 4180 CSV Export**: Generates compliant CSV files with quotation escaping and protection against spreadsheet formula injection (`=`, `+`, `-`, `@`).

### 8. Optional Grounded AI Assistant
- **Strict Grounding**: Uses `@google/genai` (Gemini 2.5 Flash) on the server, conditioned strictly on real database records.
- **Honest Graceful Fallback**: If `GEMINI_API_KEY` is not present, returns clear configuration guidance rather than fake or invented statistics.

---

## 4. Known Limitations & Future Roadmap
- **Real-Time WebSockets**: Currently uses fast optimistic updates and REST polling; multi-user live cursors can be added in subsequent milestones.
- **Direct GitHub Webhooks**: Currently supports REST API synchronization; automatic webhook ingestion for real-time push events is planned for v2.
- **Gantt Chart Dependencies**: Task dependencies are rule-checked; visual SVG Gantt dependency arrows are planned for v1.1.
