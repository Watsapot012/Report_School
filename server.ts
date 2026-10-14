import express, { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PYTHON_PORT = 5001;
const __dirname = path.resolve();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'static')));

// Global state for Python backend proxy
let pythonProcess: ChildProcess | null = null;
let pythonIsReady = false;

// Attempt to start Python Flask process if python3 is available
function initPythonBackend() {
  try {
    const pythonCmd = 'python3';
    const pyEnv = { ...process.env, PORT: String(PYTHON_PORT) };
    
    pythonProcess = spawn(pythonCmd, ['app.py'], {
      cwd: __dirname,
      env: pyEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    pythonProcess.stdout?.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Running on') || msg.includes('5001')) {
        pythonIsReady = true;
      }
    });

    pythonProcess.stderr?.on('data', (data) => {
      const err = data.toString();
      if (err.includes('Running on') || err.includes('5001')) {
        pythonIsReady = true;
      }
    });

    pythonProcess.on('error', () => {
      pythonIsReady = false;
      pythonProcess = null;
    });

    pythonProcess.on('exit', () => {
      pythonIsReady = false;
      pythonProcess = null;
    });

    // Check after 1.5s
    setTimeout(() => {
      checkPythonHealth();
    }, 1500);
  } catch {
    pythonIsReady = false;
    pythonProcess = null;
  }
}

function checkPythonHealth() {
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: PYTHON_PORT,
      path: '/api/stats',
      method: 'GET',
      timeout: 1000,
    },
    (res) => {
      if (res.statusCode === 200) {
        pythonIsReady = true;
      }
    }
  );
  req.on('error', () => {
    pythonIsReady = false;
  });
  req.end();
}

// Proxy middleware to Python Flask when available
app.use((req: Request, res: Response, next: NextFunction) => {
  if (pythonIsReady) {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: PYTHON_PORT,
      path: req.originalUrl,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${PYTHON_PORT}`,
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', () => {
      pythonIsReady = false;
      next();
    });

    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const body = typeof req.body === 'object' ? new URLSearchParams(req.body).toString() : '';
      if (body) {
        proxyReq.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
        proxyReq.write(body);
      }
      proxyReq.end();
    } else {
      proxyReq.end();
    }
  } else {
    next();
  }
});

// --- Fallback Native Express Handlers (for Cloud Run Node runtime environments) ---
const dbDir = path.join(__dirname, 'instance');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'repairs.db');
const db = new DatabaseSync(dbPath);

// Initialize DB schema
db.exec(`
  CREATE TABLE IF NOT EXISTS repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_no TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    building TEXT NOT NULL,
    room TEXT NOT NULL,
    problem_type TEXT NOT NULL,
    description TEXT NOT NULL,
    urgency TEXT NOT NULL DEFAULT 'NORMAL',
    status TEXT NOT NULL DEFAULT 'PENDING',
    assigned_to TEXT,
    due_date TEXT,
    cost REAL DEFAULT 0.0,
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_repairs_status ON repairs(status);
  CREATE INDEX IF NOT EXISTS idx_repairs_request_no ON repairs(request_no);
  CREATE INDEX IF NOT EXISTS idx_repairs_problem_type ON repairs(problem_type);
  CREATE INDEX IF NOT EXISTS idx_repairs_created_at ON repairs(created_at);
`);

// Seed sample data if empty
const countRow = db.prepare('SELECT COUNT(*) as count FROM repairs;').get() as { count: number };
if (countRow && countRow.count === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO repairs (request_no, user_id, building, room, problem_type, description, urgency, status, assigned_to, due_date, cost, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);
  insertStmt.run(
    'RP-202610-001', 'ครูสมชาย วิจิตรศิลป์ (หมวดศิลปะ)', 'อาคาร 2 (อาคารมัธยมต้น)', 'ห้องศิลปะ 214',
    'ELECTRICAL', 'หลอดไฟฟลูออเรสเซนต์กะพริบและมีเสียงดัง 2 ดวง', 'NORMAL', 'COMPLETED',
    'ช่างประเสริฐ ช่างไฟฟ้าประจำโรงเรียน', '2026-10-12', 350.0, 'เปลี่ยนหลอด LED T8 พร้อมสตาร์ทเตอร์ใหม่ 2 ชุด ใช้งานได้สว่างปกติ',
    '2026-10-10 08:30:00', '2026-10-12 14:15:00'
  );
  insertStmt.run(
    'RP-202610-002', 'ครูวราภรณ์ สุขใจ (หมวดคอมพิวเตอร์)', 'อาคาร 4 (ศูนย์คอมพิวเตอร์และสารสนเทศ)', 'ห้องปฏิบัติการคอมพิวเตอร์ 401',
    'AIRCON', 'เครื่องปรับอากาศ Daikin มีน้ำหยดลงบนโต๊ะคอมพิวเตอร์เครื่องที่ 12', 'URGENT', 'IN_PROGRESS',
    'ช่างมนัส (ช่างระบบปรับอากาศ)', '2026-10-15', 0.0, null,
    '2026-10-13 09:15:00', '2026-10-13 11:00:00'
  );
  insertStmt.run(
    'RP-202610-003', 'อาจารย์สุรศักดิ์ นักวิทย์ (หมวดวิทยาศาสตร์)', 'อาคาร 3 (ศูนย์วิทยาศาสตร์และเทคโนโลยี)', 'ห้องทดลองเคมี 302',
    'FURNITURE', 'เก้าอี้ห้องปฏิบัติการขาหลุดและโต๊ะวางสารเคมีโครงสร้างโยกคลอน', 'EMERGENCY', 'ACCEPTED',
    'ช่างบุญมี (ช่างเทคนิคงานไม้/โลหะ)', '2026-10-14', 0.0, null,
    '2026-10-14 07:45:00', '2026-10-14 08:30:00'
  );
  insertStmt.run(
    'RP-202610-004', 'เจ้าหน้าที่วรรณา มั่งมี (ฝ่ายธุรการ)', 'อาคาร 1 (อาคารอำนวยการ)', 'ห้องสำนักงานธุรการ 105',
    'COMPUTER', 'เครื่องพิมพ์ HP LaserJet พิมพ์งานแล้วกระดาษติดบ่อยครั้งและมีเส้นดำพาดกลางหน้า', 'NORMAL', 'PENDING',
    null, null, 0.0, null,
    '2026-10-14 08:50:00', '2026-10-14 08:50:00'
  );
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  ACCEPTED: 'รับงานแล้ว',
  IN_PROGRESS: 'กำลังซ่อม',
  COMPLETED: 'ซ่อมเสร็จสิ้น',
};

const STATUS_BADGES: Record<string, string> = {
  PENDING: 'badge-status-pending',
  ACCEPTED: 'badge-status-accepted',
  IN_PROGRESS: 'badge-status-in-progress',
  COMPLETED: 'badge-status-completed',
};

const PROBLEM_LABELS: Record<string, string> = {
  ELECTRICAL: 'ระบบไฟฟ้าและแสงสว่าง',
  FURNITURE: 'โต๊ะ เก้าอี้ และเฟอร์นิเจอร์',
  COMPUTER: 'คอมพิวเตอร์และอุปกรณ์ต่อพ่วง',
  AIRCON: 'เครื่องปรับอากาศและพัดลม',
  OTHER: 'อื่นๆ',
};

const PROBLEM_ICONS: Record<string, string> = {
  ELECTRICAL: 'bi-lightning-charge',
  FURNITURE: 'bi-box-seam',
  COMPUTER: 'bi-laptop',
  AIRCON: 'bi-wind',
  OTHER: 'bi-wrench',
};

const URGENCY_LABELS: Record<string, string> = {
  NORMAL: 'ปกติ',
  URGENT: 'ด่วน',
  EMERGENCY: 'ด่วนที่สุด',
};

const URGENCY_BADGES: Record<string, string> = {
  NORMAL: 'badge-urgency-normal',
  URGENT: 'badge-urgency-urgent',
  EMERGENCY: 'badge-urgency-emergency',
};

function renderLayout(title: string, bodyContent: string, activePage = 'dashboard') {
  return `<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - ระบบงานแจ้งซ่อม</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&family=Sarabun:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css">
    <link rel="stylesheet" href="/static/css/style.css">
</head>
<body class="bg-light">
<div class="app-wrapper">
    <aside class="app-sidebar" id="appSidebar">
        <div class="sidebar-brand">
            <div class="brand-icon"><i class="bi bi-tools text-primary"></i></div>
            <div class="brand-text">
                <h5 class="mb-0 text-white fw-bold">ระบบแจ้งซ่อม</h5>
                <small class="text-secondary">ฝ่ายอาคารและสถานที่</small>
            </div>
            <button class="btn btn-sm btn-link text-white d-lg-none ms-auto" id="sidebarCloseBtn">
                <i class="bi bi-x-lg"></i>
            </button>
        </div>
        <div class="sidebar-user px-3 py-3 border-bottom border-secondary border-opacity-25">
            <div class="d-flex align-items-center gap-2">
                <div class="avatar bg-primary text-white rounded-circle d-flex align-items-center justify-content-center" style="width: 38px; height: 38px;">
                    <i class="bi bi-person-fill"></i>
                </div>
                <div>
                    <div class="fw-semibold text-white small">เจ้าหน้าที่ประจำโรงเรียน</div>
                    <div class="text-secondary extra-small"><i class="bi bi-shield-check text-success"></i> ระบบเปิดใช้งาน</div>
                </div>
            </div>
        </div>
        <nav class="sidebar-nav">
            <div class="nav-section-title">เมนูหลัก</div>
            <ul class="nav flex-column">
                <li class="nav-item">
                    <a class="nav-link ${activePage === 'dashboard' ? 'active' : ''}" href="/">
                        <i class="bi bi-grid-1x2-fill"></i>
                        <span>แดชบอร์ดภาพรวม</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link ${activePage === 'repairs' ? 'active' : ''}" href="/repairs">
                        <i class="bi bi-card-checklist"></i>
                        <span>รายการแจ้งซ่อมทั้งหมด</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link ${activePage === 'new_repair' ? 'active' : ''}" href="/repairs/new">
                        <i class="bi bi-plus-circle-fill text-info"></i>
                        <span>แจ้งซ่อมใหม่</span>
                    </a>
                </li>
            </ul>
            <div class="nav-section-title mt-4">กรองตามสถานะงาน</div>
            <ul class="nav flex-column status-shortcut-nav">
                <li class="nav-item">
                    <a class="nav-link" href="/repairs?status=PENDING">
                        <span class="status-dot bg-warning"></span>
                        <span>รอดำเนินการ</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" href="/repairs?status=ACCEPTED">
                        <span class="status-dot bg-info"></span>
                        <span>รับงานแล้ว</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" href="/repairs?status=IN_PROGRESS">
                        <span class="status-dot bg-primary"></span>
                        <span>กำลังซ่อม</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" href="/repairs?status=COMPLETED">
                        <span class="status-dot bg-success"></span>
                        <span>ซ่อมเสร็จสิ้น</span>
                    </a>
                </li>
            </ul>
        </nav>
        <div class="sidebar-footer">
            <div class="oop-badge-box">
                <div class="d-flex align-items-center gap-2 mb-1">
                    <i class="bi bi-cpu-fill text-info"></i>
                    <span class="fw-semibold text-white small">Python &amp; OOP Model</span>
                </div>
                <div class="text-secondary extra-small">
                    RepairRequest • RepairService • DatabaseManager
                </div>
            </div>
        </div>
    </aside>
    <div class="app-main">
        <header class="app-header shadow-sm bg-white sticky-top">
            <div class="container-fluid px-3 px-lg-4 d-flex align-items-center justify-content-between h-100">
                <div class="d-flex align-items-center gap-3">
                    <button class="btn btn-outline-secondary btn-sm d-lg-none" id="sidebarToggleBtn">
                        <i class="bi bi-list fs-5"></i>
                    </button>
                    <div class="d-none d-sm-block">
                        <span class="text-muted extra-small">ระบบจัดการอุปกรณ์และงานซ่อมบำรุงโรงเรียน</span>
                        <h6 class="mb-0 fw-bold text-dark">ระบบแจ้งซ่อมอุปกรณ์ (Equipment Repair System)</h6>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <a href="/repairs/new" class="btn btn-primary btn-sm rounded-pill px-3 shadow-sm d-flex align-items-center gap-1">
                        <i class="bi bi-plus-lg"></i>
                        <span class="fw-medium">แจ้งซ่อมใหม่</span>
                    </a>
                </div>
            </div>
        </header>
        <main class="container-fluid px-3 px-lg-4 py-3">
            ${bodyContent}
        </main>
        <footer class="app-footer text-center py-3 text-muted small border-top bg-white mt-auto">
            <div class="container-fluid">
                <span>ระบบแจ้งซ่อมอุปกรณ์โรงเรียน © 2026 พัฒนาด้วย Python Flask, SQLite และสถาปัตยกรรม OOP</span>
            </div>
        </footer>
    </div>
</div>
<div class="sidebar-backdrop" id="sidebarBackdrop"></div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
<script src="/static/js/main.js"></script>
</body>
</html>`;
}

// Fallback GET /
app.get('/', (_req: Request, res: Response) => {
  const allRows = db.prepare('SELECT * FROM repairs ORDER BY id DESC;').all() as any[];
  const pending = allRows.filter((r) => r.status === 'PENDING').length;
  const accepted = allRows.filter((r) => r.status === 'ACCEPTED').length;
  const in_progress = allRows.filter((r) => r.status === 'IN_PROGRESS').length;
  const completed = allRows.filter((r) => r.status === 'COMPLETED').length;
  const total = allRows.length;
  const total_cost = allRows.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
  const urgent_count = allRows.filter((r) => ['URGENT', 'EMERGENCY'].includes(r.urgency) && r.status !== 'COMPLETED').length;
  const recent = allRows.slice(0, 6);

  const rowsHtml = recent
    .map(
      (r) => `
    <tr>
      <td class="ps-3 ps-lg-4">
        <a href="/repairs/${r.id}" class="fw-bold text-decoration-none text-primary">${r.request_no}</a>
        <div class="text-muted extra-small">${r.created_at}</div>
      </td>
      <td>
        <div class="fw-semibold text-dark">${r.building}</div>
        <div class="text-muted small"><i class="bi bi-geo-alt me-1"></i>${r.room}</div>
      </td>
      <td>
        <span class="badge bg-light text-dark border">
          <i class="bi ${PROBLEM_ICONS[r.problem_type] || 'bi-wrench'} me-1 text-primary"></i>
          ${PROBLEM_LABELS[r.problem_type] || r.problem_type}
        </span>
      </td>
      <td><div class="small fw-medium text-dark">${r.user_id}</div></td>
      <td><span class="badge ${URGENCY_BADGES[r.urgency] || 'badge-urgency-normal'}">${URGENCY_LABELS[r.urgency] || r.urgency}</span></td>
      <td><span class="badge ${STATUS_BADGES[r.status] || 'badge-status-pending'}">${STATUS_LABELS[r.status] || r.status}</span></td>
      <td class="text-end pe-3 pe-lg-4">
        <a href="/repairs/${r.id}" class="btn btn-sm btn-outline-secondary"><i class="bi bi-eye me-1"></i> รายละเอียด</a>
      </td>
    </tr>`
    )
    .join('');

  const content = `
    <div class="dashboard-header mb-4 d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
            <h4 class="fw-bold mb-1 text-dark">แดชบอร์ดภาพรวมงานซ่อมบำรุง</h4>
            <p class="text-muted mb-0 small">ติดตามสถานะและสรุปผลการดำเนินงานแจ้งซ่อมอุปกรณ์ทั้งหมดภายในโรงเรียน</p>
        </div>
        <div class="d-flex align-items-center gap-2">
            <a href="/repairs" class="btn btn-outline-secondary btn-sm"><i class="bi bi-list-ul me-1"></i> ดูรายการทั้งหมด</a>
            <a href="/repairs/new" class="btn btn-primary btn-sm shadow-sm"><i class="bi bi-plus-lg me-1"></i> สร้างใบแจ้งซ่อมใหม่</a>
        </div>
    </div>
    <div class="row g-3 mb-4">
        <div class="col-12 col-sm-6 col-xl-3">
            <div class="card stat-card card-total h-100 border-0 shadow-sm">
                <div class="card-body p-3 p-lg-4">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="text-muted small fw-medium">งานแจ้งซ่อมทั้งหมด</span>
                        <div class="stat-icon bg-primary bg-opacity-10 text-primary"><i class="bi bi-collection-fill"></i></div>
                    </div>
                    <h2 class="fw-bold mb-1 text-dark">${total}</h2>
                    <div class="d-flex align-items-center text-muted extra-small">
                        <span class="text-success fw-semibold me-1"><i class="bi bi-arrow-up-right"></i> ทุกรายการ</span>
                        <span>บันทึกในฐานข้อมูล</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-12 col-sm-6 col-xl-3">
            <div class="card stat-card card-pending h-100 border-0 shadow-sm">
                <div class="card-body p-3 p-lg-4">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="text-muted small fw-medium">งานรอดำเนินการ</span>
                        <div class="stat-icon bg-warning bg-opacity-15 text-warning-emphasis"><i class="bi bi-hourglass-split"></i></div>
                    </div>
                    <h2 class="fw-bold mb-1 text-warning-emphasis">${pending}</h2>
                    <div class="d-flex align-items-center text-muted extra-small">
                        <span class="badge bg-warning text-dark me-1">PENDING</span>
                        <span>รอเจ้าหน้าที่รับงาน</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-12 col-sm-6 col-xl-3">
            <div class="card stat-card card-in-progress h-100 border-0 shadow-sm">
                <div class="card-body p-3 p-lg-4">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="text-muted small fw-medium">งานกำลังซ่อม</span>
                        <div class="stat-icon bg-info bg-opacity-15 text-info"><i class="bi bi-gear-fill"></i></div>
                    </div>
                    <h2 class="fw-bold mb-1 text-info">${in_progress}</h2>
                    <div class="d-flex align-items-center text-muted extra-small">
                        <span class="badge bg-info text-dark me-1">IN_PROGRESS</span>
                        <span>รวมรับงานแล้ว ${accepted} งาน</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-12 col-sm-6 col-xl-3">
            <div class="card stat-card card-completed h-100 border-0 shadow-sm">
                <div class="card-body p-3 p-lg-4">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="text-muted small fw-medium">งานซ่อมเสร็จสิ้น</span>
                        <div class="stat-icon bg-success bg-opacity-10 text-success"><i class="bi bi-check2-circle"></i></div>
                    </div>
                    <h2 class="fw-bold mb-1 text-success">${completed}</h2>
                    <div class="d-flex align-items-center text-muted extra-small">
                        <span class="badge bg-success me-1">COMPLETED</span>
                        <span>ปิดงานเรียบร้อยแล้ว</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div class="row g-3 mb-4">
        <div class="col-12 col-lg-8">
            <div class="card border-0 shadow-sm bg-primary text-white p-4 h-100 rounded-3 position-relative overflow-hidden">
                <div class="d-flex align-items-center gap-2 mb-2">
                    <span class="badge bg-white text-primary fw-bold">ฝ่ายอาคารสถานที่และซ่อมบำรุง</span>
                    ${urgent_count > 0 ? `<span class="badge bg-danger text-white"><i class="bi bi-fire me-1"></i> มีงานด่วน ${urgent_count} รายการ</span>` : ''}
                </div>
                <h4 class="fw-bold mb-2">พบอุปกรณ์หรือสิ่งอำนวยความสะดวกชำรุดเสียหาย?</h4>
                <p class="mb-3 text-white-50 small pe-lg-5">แจ้งซ่อมได้ทันทีผ่านระบบออนไลน์ พร้อมระบุอาคาร ห้อง และอาการชำรุด เพื่อให้ทีมช่างเข้าตรวจสอบและแก้ไขปัญหาได้อย่างรวดเร็ว</p>
                <div class="d-flex flex-wrap gap-2">
                    <a href="/repairs/new" class="btn btn-light text-primary fw-semibold shadow-sm px-4"><i class="bi bi-plus-circle-fill me-1"></i> แจ้งซ่อมอุปกรณ์ทันที</a>
                    <a href="/repairs" class="btn btn-outline-light px-3"><i class="bi bi-search me-1"></i> ค้นหาใบแจ้งซ่อม</a>
                </div>
            </div>
        </div>
        <div class="col-12 col-lg-4">
            <div class="card border-0 shadow-sm h-100 bg-white p-4">
                <h6 class="fw-bold text-dark mb-3">งบประมาณค่าซ่อมบำรุง</h6>
                <div class="p-3 bg-light rounded-3 mb-3 text-center">
                    <span class="text-muted extra-small d-block mb-1">ค่าใช้จ่ายงานซ่อมที่ปิดงานแล้ว</span>
                    <h3 class="fw-bold text-primary mb-0">${total_cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })} <span class="fs-6 fw-normal text-muted">บาท</span></h3>
                </div>
                <div class="small text-muted border-top pt-2">
                    <div class="d-flex justify-content-between py-1"><span>งานรอรับงาน:</span><strong class="text-warning-emphasis">${pending} งาน</strong></div>
                    <div class="d-flex justify-content-between py-1"><span>งานรับงานแล้ว:</span><strong class="text-info">${accepted} งาน</strong></div>
                    <div class="d-flex justify-content-between py-1"><span>งานกำลังซ่อม:</span><strong class="text-primary">${in_progress} งาน</strong></div>
                </div>
            </div>
        </div>
    </div>
    <div class="card border-0 shadow-sm bg-white mb-4">
        <div class="card-header bg-white border-bottom py-3 px-4 d-flex align-items-center justify-content-between">
            <h6 class="fw-bold text-dark mb-0"><i class="bi bi-clock-history text-primary me-2"></i>รายการแจ้งซ่อมล่าสุด</h6>
            <a href="/repairs" class="btn btn-sm btn-outline-primary">ดูทั้งหมด (${total})</a>
        </div>
        <div class="card-body p-0">
            <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                    <thead class="table-light text-secondary small">
                        <tr>
                            <th class="ps-3 ps-lg-4" style="width: 150px;">เลขที่ใบแจ้ง</th>
                            <th>สถานที่ / ห้อง</th>
                            <th>ประเภทปัญหา</th>
                            <th>ผู้แจ้งซ่อม</th>
                            <th>ความเร่งด่วน</th>
                            <th>สถานะ</th>
                            <th class="text-end pe-3 pe-lg-4">จัดการ</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>
    </div>`;

  res.send(renderLayout('แดชบอร์ดภาพรวม', content, 'dashboard'));
});

// Fallback GET /repairs
app.get('/repairs', (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'ALL';
  const problem_type = (req.query.problem_type as string) || 'ALL';
  const q = (req.query.q as string) || '';

  let sql = 'SELECT * FROM repairs WHERE 1=1';
  const params: any[] = [];
  if (status && status !== 'ALL') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (problem_type && problem_type !== 'ALL') {
    sql += ' AND problem_type = ?';
    params.push(problem_type);
  }
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    sql += ' AND (request_no LIKE ? OR description LIKE ? OR building LIKE ? OR room LIKE ? OR user_id LIKE ?)';
    params.push(term, term, term, term, term);
  }
  sql += ' ORDER BY id DESC;';

  const rows = db.prepare(sql).all(...params) as any[];

  const rowsHtml = rows
    .map(
      (r) => `
    <tr>
      <td class="ps-3 ps-lg-4">
        <a href="/repairs/${r.id}" class="fw-bold text-decoration-none text-primary font-monospace">${r.request_no}</a>
        <div class="text-muted extra-small">${r.created_at}</div>
      </td>
      <td>
        <div class="fw-semibold text-dark">${r.building}</div>
        <div class="text-muted small"><i class="bi bi-geo-alt me-1"></i>${r.room}</div>
      </td>
      <td>
        <span class="badge bg-light text-dark border me-1">
          <i class="bi ${PROBLEM_ICONS[r.problem_type] || 'bi-wrench'} me-1 text-primary"></i>
          ${PROBLEM_LABELS[r.problem_type] || r.problem_type}
        </span>
        <div class="text-secondary small mt-1 text-truncate" style="max-width: 280px;">${r.description}</div>
      </td>
      <td><div class="small fw-medium text-dark">${r.user_id}</div></td>
      <td><span class="badge ${URGENCY_BADGES[r.urgency] || 'badge-urgency-normal'}">${URGENCY_LABELS[r.urgency] || r.urgency}</span></td>
      <td>
        ${r.assigned_to ? `<div class="small fw-semibold text-dark"><i class="bi bi-person-badge text-primary me-1"></i>${r.assigned_to}</div>` : '<span class="text-muted extra-small">- ยังไม่มอบหมาย -</span>'}
      </td>
      <td><span class="badge ${STATUS_BADGES[r.status] || 'badge-status-pending'}">${STATUS_LABELS[r.status] || r.status}</span></td>
      <td class="text-end pe-3 pe-lg-4">
        <a href="/repairs/${r.id}" class="btn btn-sm btn-outline-primary"><i class="bi bi-box-arrow-up-right me-1"></i> ดูงาน</a>
      </td>
    </tr>`
    )
    .join('');

  const content = `
    <div class="mb-4 d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
            <h4 class="fw-bold mb-1 text-dark">รายการแจ้งซ่อมอุปกรณ์</h4>
            <p class="text-muted mb-0 small">ค้นหา ติดตาม และบริหารจัดการใบแจ้งซ่อมอุปกรณ์ทั้งหมด</p>
        </div>
        <a href="/repairs/new" class="btn btn-primary btn-sm shadow-sm"><i class="bi bi-plus-lg me-1"></i> แจ้งซ่อมใหม่</a>
    </div>
    <div class="card border-0 shadow-sm bg-white mb-4 p-3 p-lg-4">
        <form method="GET" action="/repairs">
            <div class="row g-2 align-items-center">
                <div class="col-12 col-md-5">
                    <input type="text" name="q" class="form-control bg-light" placeholder="ค้นหาเลขที่ใบแจ้ง, รายละเอียด, อาคาร, ห้อง..." value="${q}">
                </div>
                <div class="col-6 col-md-3">
                    <select name="status" class="form-select bg-light" onchange="this.form.submit()">
                        <option value="ALL" ${status === 'ALL' ? 'selected' : ''}>สถานะทั้งหมด</option>
                        <option value="PENDING" ${status === 'PENDING' ? 'selected' : ''}>รอดำเนินการ</option>
                        <option value="ACCEPTED" ${status === 'ACCEPTED' ? 'selected' : ''}>รับงานแล้ว</option>
                        <option value="IN_PROGRESS" ${status === 'IN_PROGRESS' ? 'selected' : ''}>กำลังซ่อม</option>
                        <option value="COMPLETED" ${status === 'COMPLETED' ? 'selected' : ''}>ซ่อมเสร็จสิ้น</option>
                    </select>
                </div>
                <div class="col-6 col-md-3">
                    <select name="problem_type" class="form-select bg-light" onchange="this.form.submit()">
                        <option value="ALL" ${problem_type === 'ALL' ? 'selected' : ''}>ทุกประเภทปัญหา</option>
                        <option value="ELECTRICAL" ${problem_type === 'ELECTRICAL' ? 'selected' : ''}>ระบบไฟฟ้าและแสงสว่าง</option>
                        <option value="FURNITURE" ${problem_type === 'FURNITURE' ? 'selected' : ''}>โต๊ะ เก้าอี้ และเฟอร์นิเจอร์</option>
                        <option value="COMPUTER" ${problem_type === 'COMPUTER' ? 'selected' : ''}>คอมพิวเตอร์และอุปกรณ์ต่อพ่วง</option>
                        <option value="AIRCON" ${problem_type === 'AIRCON' ? 'selected' : ''}>เครื่องปรับอากาศและพัดลม</option>
                        <option value="OTHER" ${problem_type === 'OTHER' ? 'selected' : ''}>อื่นๆ</option>
                    </select>
                </div>
                <div class="col-12 col-md-1">
                    <button type="submit" class="btn btn-primary w-100"><i class="bi bi-funnel-fill"></i></button>
                </div>
            </div>
        </form>
    </div>
    <div class="card border-0 shadow-sm bg-white">
        <div class="card-header bg-white py-3 px-4 d-flex justify-content-between align-items-center border-bottom">
            <h6 class="fw-bold mb-0 text-dark">ผลการค้นหา (${rows.length} รายการ)</h6>
        </div>
        <div class="card-body p-0">
            <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                    <thead class="table-light text-secondary small">
                        <tr>
                            <th class="ps-3 ps-lg-4">เลขที่ใบแจ้ง</th>
                            <th>สถานที่</th>
                            <th>ประเภทปัญหา / รายละเอียด</th>
                            <th>ผู้แจ้งซ่อม</th>
                            <th>ความเร่งด่วน</th>
                            <th>ช่างผู้รับผิดชอบ</th>
                            <th>สถานะ</th>
                            <th class="text-end pe-3 pe-lg-4">จัดการ</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>
    </div>`;

  res.send(renderLayout('รายการแจ้งซ่อมทั้งหมด', content, 'repairs'));
});

// Fallback GET /repairs/new
app.get('/repairs/new', (_req: Request, res: Response) => {
  const content = `
    <div class="row justify-content-center">
        <div class="col-12 col-lg-8 col-xl-7">
            <div class="card border-0 shadow-sm bg-white">
                <div class="card-header bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center">
                    <div>
                        <h5 class="fw-bold mb-1 text-dark"><i class="bi bi-file-earmark-plus-fill text-primary me-2"></i>แบบฟอร์มแจ้งซ่อมอุปกรณ์</h5>
                        <p class="text-muted small mb-0">ระบบจะออกรหัสใบแจ้งซ่อมอัตโนมัติในรูปแบบ RP-YYYYMM-XXX</p>
                    </div>
                    <a href="/repairs" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left me-1"></i> ย้อนกลับ</a>
                </div>
                <div class="card-body p-4">
                    <form method="POST" action="/repairs/new" id="newRepairForm">
                        <div class="mb-4">
                            <label class="form-label fw-semibold text-dark">ชื่อผู้แจ้งซ่อม / รหัสเจ้าหน้าที่ <span class="text-danger">*</span></label>
                            <input type="text" class="form-control" name="user_id" id="user_id" placeholder="เช่น ครูสมชาย ใจดี, เจ้าหน้าที่ฝ่ายพัสดุ" required>
                        </div>
                        <div class="row g-3 mb-4">
                            <div class="col-12 col-md-6">
                                <label class="form-label fw-semibold text-dark">อาคาร / สถานที่ <span class="text-danger">*</span></label>
                                <input type="text" class="form-control" name="building" id="building" placeholder="เช่น อาคาร 1, อาคาร 4" required>
                            </div>
                            <div class="col-12 col-md-6">
                                <label class="form-label fw-semibold text-dark">ห้อง / จุดที่พบปัญหา <span class="text-danger">*</span></label>
                                <input type="text" class="form-control" name="room" id="room" placeholder="เช่น ห้อง 401, ห้องพักครู" required>
                            </div>
                        </div>
                        <div class="row g-3 mb-4">
                            <div class="col-12 col-md-6">
                                <label class="form-label fw-semibold text-dark">ประเภทของปัญหา <span class="text-danger">*</span></label>
                                <select class="form-select" name="problem_type" id="problem_type">
                                    <option value="ELECTRICAL">ระบบไฟฟ้าและแสงสว่าง</option>
                                    <option value="FURNITURE">โต๊ะ เก้าอี้ และเฟอร์นิเจอร์</option>
                                    <option value="COMPUTER">คอมพิวเตอร์และอุปกรณ์ต่อพ่วง</option>
                                    <option value="AIRCON">เครื่องปรับอากาศและพัดลม</option>
                                    <option value="OTHER">อื่นๆ</option>
                                </select>
                            </div>
                            <div class="col-12 col-md-6">
                                <label class="form-label fw-semibold text-dark">ระดับความเร่งด่วน <span class="text-danger">*</span></label>
                                <select class="form-select" name="urgency" id="urgency">
                                    <option value="NORMAL">ปกติ</option>
                                    <option value="URGENT">ด่วน</option>
                                    <option value="EMERGENCY">ด่วนที่สุด</option>
                                </select>
                            </div>
                        </div>
                        <div class="mb-4">
                            <label class="form-label fw-semibold text-dark">รายละเอียดปัญหา <span class="text-danger">*</span></label>
                            <textarea class="form-control" name="description" id="description" rows="4" placeholder="ระบุอาการชำรุดอย่างละเอียด..." required></textarea>
                        </div>
                        <div class="d-flex justify-content-end gap-2 pt-2 border-top">
                            <a href="/repairs" class="btn btn-light px-4">ยกเลิก</a>
                            <button type="submit" class="btn btn-primary px-4" id="btnSubmitRepair"><i class="bi bi-send-fill me-1"></i> ยืนยันบันทึกใบแจ้งซ่อม</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>`;

  res.send(renderLayout('สร้างใบแจ้งซ่อมใหม่', content, 'new_repair'));
});

// Fallback POST /repairs/new
app.post('/repairs/new', (req: Request, res: Response) => {
  const { user_id, building, room, problem_type, urgency, description } = req.body;
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `RP-${year}${month}-`;

  const lastRow = db.prepare('SELECT request_no FROM repairs WHERE request_no LIKE ? ORDER BY request_no DESC LIMIT 1;').get(`${prefix}%`) as any;
  let nextSeq = 1;
  if (lastRow && lastRow.request_no) {
    const parts = lastRow.request_no.split('-');
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(seq)) nextSeq = seq + 1;
  }
  const request_no = `${prefix}${String(nextSeq).padStart(3, '0')}`;
  const nowStr = now.toISOString().replace('T', ' ').substring(0, 19);

  const insertStmt = db.prepare(`
    INSERT INTO repairs (request_no, user_id, building, room, problem_type, description, urgency, status, assigned_to, due_date, cost, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', null, null, 0.0, null, ?, ?);
  `);
  const result = insertStmt.run(request_no, user_id, building, room, problem_type, description, urgency, nowStr, nowStr);
  res.redirect(`/repairs/${result.lastInsertRowid}`);
});

// Fallback GET /repairs/:id
app.get('/repairs/:id', (req: Request, res: Response) => {
  const repair = db.prepare('SELECT * FROM repairs WHERE id = ?;').get(req.params.id) as any;
  if (!repair) {
    res.redirect('/repairs');
    return;
  }

  const content = `
    <div class="mb-4 d-flex justify-content-between align-items-center">
        <div class="d-flex align-items-center gap-3">
            <a href="/repairs" class="btn btn-outline-secondary btn-sm"><i class="bi bi-arrow-left"></i></a>
            <div>
                <h4 class="fw-bold mb-0 text-dark font-monospace">${repair.request_no}</h4>
                <span class="badge ${STATUS_BADGES[repair.status] || 'badge-status-pending'}">${STATUS_LABELS[repair.status] || repair.status}</span>
                <span class="badge ${URGENCY_BADGES[repair.urgency] || 'badge-urgency-normal'}">${URGENCY_LABELS[repair.urgency] || repair.urgency}</span>
            </div>
        </div>
        <div class="d-flex gap-2">
            <a href="/repairs/${repair.id}/print" target="_blank" class="btn btn-outline-dark btn-sm"><i class="bi bi-printer me-1"></i> พิมพ์เอกสาร</a>
            <a href="/repairs/new" class="btn btn-primary btn-sm"><i class="bi bi-plus-lg me-1"></i> แจ้งซ่อมใหม่</a>
        </div>
    </div>
    <div class="card border-0 shadow-sm bg-white mb-4 p-4">
        <h6 class="fw-bold text-dark mb-4"><i class="bi bi-bezier2 text-primary me-2"></i>ขั้นตอนการดำเนินงาน (State Machine: RepairRequest)</h6>
        <div class="stepper-wrapper">
            <div class="stepper-item ${['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(repair.status) ? 'completed' : ''} ${repair.status === 'PENDING' ? 'active' : ''}">
                <div class="step-counter">${['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(repair.status) ? '<i class="bi bi-check-lg"></i>' : '1'}</div>
                <div class="step-name fw-bold">1. รอดำเนินการ</div>
            </div>
            <div class="stepper-item ${['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(repair.status) ? 'completed' : ''} ${repair.status === 'ACCEPTED' ? 'active' : ''}">
                <div class="step-counter">${['IN_PROGRESS', 'COMPLETED'].includes(repair.status) ? '<i class="bi bi-check-lg"></i>' : '2'}</div>
                <div class="step-name fw-bold">2. รับงานแล้ว</div>
            </div>
            <div class="stepper-item ${['IN_PROGRESS', 'COMPLETED'].includes(repair.status) ? 'completed' : ''} ${repair.status === 'IN_PROGRESS' ? 'active' : ''}">
                <div class="step-counter">${repair.status === 'COMPLETED' ? '<i class="bi bi-check-lg"></i>' : '3'}</div>
                <div class="step-name fw-bold">3. กำลังซ่อม</div>
            </div>
            <div class="stepper-item ${repair.status === 'COMPLETED' ? 'completed active' : ''}">
                <div class="step-counter">${repair.status === 'COMPLETED' ? '<i class="bi bi-check-lg"></i>' : '4'}</div>
                <div class="step-name fw-bold">4. ซ่อมเสร็จสิ้น</div>
            </div>
        </div>
    </div>
    <div class="row g-4">
        <div class="col-12 col-lg-8">
            <div class="card border-0 shadow-sm bg-white mb-4 p-4">
                <h6 class="fw-bold mb-3 text-dark"><i class="bi bi-info-circle-fill text-primary me-2"></i>ข้อมูลการแจ้งซ่อม</h6>
                <div class="row g-3 mb-3">
                    <div class="col-sm-6"><label class="text-muted extra-small">ผู้แจ้งซ่อม</label><div class="fw-semibold">${repair.user_id}</div></div>
                    <div class="col-sm-6"><label class="text-muted extra-small">สถานที่</label><div class="fw-semibold">${repair.building} (${repair.room})</div></div>
                    <div class="col-sm-6"><label class="text-muted extra-small">ประเภทอุปกรณ์</label><div class="fw-semibold">${PROBLEM_LABELS[repair.problem_type] || repair.problem_type}</div></div>
                    <div class="col-sm-6"><label class="text-muted extra-small">ความเร่งด่วน</label><div class="fw-semibold">${URGENCY_LABELS[repair.urgency] || repair.urgency}</div></div>
                </div>
                <div class="p-3 bg-light rounded-3 mb-3">${repair.description}</div>
                ${repair.result ? `<div class="p-3 bg-light rounded-3 border-start border-4 border-success mt-3"><h6 class="fw-bold text-success">ผลการซ่อมแซม:</h6><p class="mb-1">${repair.result}</p><strong>ค่าใช้จ่าย:</strong> ${(Number(repair.cost) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</div>` : ''}
            </div>
        </div>
        <div class="col-12 col-lg-4">
            <div class="card border-0 shadow-sm bg-white p-4">
                <h6 class="fw-bold mb-3 text-dark"><i class="bi bi-sliders text-primary me-2"></i>การจัดการสถานะงาน (OOP Actions)</h6>
                <div class="p-3 bg-light rounded text-center mb-3">
                    <span class="badge ${STATUS_BADGES[repair.status] || 'badge-status-pending'} fs-6">${STATUS_LABELS[repair.status] || repair.status}</span>
                </div>
                <div class="d-grid gap-2">
                    ${repair.status === 'PENDING' ? `
                    <form method="POST" action="/repairs/${repair.id}/assign">
                        <div class="mb-2"><input type="text" name="technician_name" class="form-control form-control-sm" placeholder="ระบุชื่อช่างผู้ดูแล" required></div>
                        <div class="mb-2"><input type="date" name="due_date" class="form-control form-control-sm"></div>
                        <button type="submit" class="btn btn-warning text-dark btn-sm w-100 fw-bold">1. รับงานและมอบหมายช่าง</button>
                    </form>` : ''}
                    ${repair.status === 'ACCEPTED' ? `
                    <form method="POST" action="/repairs/${repair.id}/start" id="startRepairForm">
                        <button type="button" class="btn btn-primary btn-sm w-100 fw-bold" id="btnStartRepair">2. เริ่มดำเนินการซ่อม</button>
                    </form>` : ''}
                    ${repair.status === 'IN_PROGRESS' ? `
                    <form method="POST" action="/repairs/${repair.id}/complete" id="completeForm">
                        <div class="mb-2"><textarea name="result" id="result" class="form-control form-control-sm" rows="3" placeholder="ระบุผลการซ่อมแซม..." required></textarea></div>
                        <div class="mb-2"><input type="number" step="0.25" min="0" name="cost" id="cost" class="form-control form-control-sm" placeholder="ค่าใช้จ่าย (บาท)" value="0.00" required></div>
                        <button type="button" class="btn btn-success btn-sm w-100 fw-bold" id="btnSubmitComplete">3. บันทึกผลซ่อมและปิดงาน</button>
                    </form>` : ''}
                    ${repair.status === 'COMPLETED' ? `
                    <div class="alert alert-success small text-center mb-0"><i class="bi bi-check-circle-fill me-1"></i> ซ่อมเสร็จสมบูรณ์แล้ว (ห้ามทำงานซ้ำ)</div>
                    ` : ''}
                </div>
            </div>
        </div>
    </div>`;

  res.send(renderLayout(`ใบแจ้งซ่อม ${repair.request_no}`, content, 'repairs'));
});

// Fallback POST /repairs/:id/assign
app.post('/repairs/:id/assign', (req: Request, res: Response) => {
  const { technician_name, due_date } = req.body;
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`UPDATE repairs SET assigned_to = ?, due_date = ?, status = 'ACCEPTED', updated_at = ? WHERE id = ? AND status = 'PENDING';`)
    .run(technician_name, due_date || null, nowStr, req.params.id);
  res.redirect(`/repairs/${req.params.id}`);
});

// Fallback POST /repairs/:id/start
app.post('/repairs/:id/start', (req: Request, res: Response) => {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`UPDATE repairs SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ? AND status = 'ACCEPTED';`)
    .run(nowStr, req.params.id);
  res.redirect(`/repairs/${req.params.id}`);
});

// Fallback POST /repairs/:id/complete
app.post('/repairs/:id/complete', (req: Request, res: Response) => {
  const { result, cost } = req.body;
  const costVal = parseFloat(cost) || 0.0;
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`UPDATE repairs SET result = ?, cost = ?, status = 'COMPLETED', updated_at = ? WHERE id = ? AND status = 'IN_PROGRESS';`)
    .run(result, costVal, nowStr, req.params.id);
  res.redirect(`/repairs/${req.params.id}`);
});

// Fallback GET /repairs/:id/print
app.get('/repairs/:id/print', (req: Request, res: Response) => {
  const repair = db.prepare('SELECT * FROM repairs WHERE id = ?;').get(req.params.id) as any;
  if (!repair) {
    res.status(404).send('Not Found');
    return;
  }
  res.send(`<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <title>ใบส่งมอบงานซ่อมบำรุง - ${repair.request_no}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>body { font-family: 'Sarabun', sans-serif; background: #fff; padding: 40px; } @media print { .no-print { display: none; } }</style>
</head>
<body>
    <div class="text-center pb-3 border-bottom mb-4">
        <h4 class="fw-bold mb-1">โรงเรียนตัวอย่าง / สถาบันการศึกษา</h4>
        <h6 class="text-primary mb-0">ใบแจ้งซ่อมและรายงานผลการซ่อมบำรุงอุปกรณ์ (Work Order)</h6>
    </div>
    <div class="d-flex justify-content-between mb-4">
        <div><strong>เลขที่ใบแจ้งซ่อม:</strong> ${repair.request_no}</div>
        <div><strong>วันที่แจ้ง:</strong> ${repair.created_at}</div>
    </div>
    <table class="table table-bordered mb-4">
        <tr><th style="width: 30%;">ผู้แจ้งซ่อม</th><td>${repair.user_id}</td></tr>
        <tr><th>สถานที่</th><td>${repair.building} (${repair.room})</td></tr>
        <tr><th>ประเภทอุปกรณ์</th><td>${PROBLEM_LABELS[repair.problem_type] || repair.problem_type}</td></tr>
        <tr><th>อาการชำรุด</th><td>${repair.description}</td></tr>
        <tr><th>ช่างผู้รับผิดชอบ</th><td>${repair.assigned_to || '-'}</td></tr>
        <tr><th>ผลการซ่อม</th><td>${repair.result || 'อยู่ระหว่างดำเนินการ'}</td></tr>
        <tr><th>ค่าใช้จ่ายรวม</th><td>${(Number(repair.cost) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</td></tr>
    </table>
    <div class="text-center no-print">
        <button onclick="window.print()" class="btn btn-primary">พิมพ์เอกสารนี้</button>
    </div>
</body>
</html>`);
});

// Fallback GET /api/stats
app.get('/api/stats', (_req: Request, res: Response) => {
  const allRows = db.prepare('SELECT status, cost, urgency FROM repairs;').all() as any[];
  const pending = allRows.filter((r) => r.status === 'PENDING').length;
  const accepted = allRows.filter((r) => r.status === 'ACCEPTED').length;
  const in_progress = allRows.filter((r) => r.status === 'IN_PROGRESS').length;
  const completed = allRows.filter((r) => r.status === 'COMPLETED').length;
  const total = allRows.length;
  const total_cost = allRows.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
  const urgent_count = allRows.filter((r) => ['URGENT', 'EMERGENCY'].includes(r.urgency) && r.status !== 'COMPLETED').length;

  res.json({
    total,
    pending,
    accepted,
    in_progress,
    completed,
    total_cost,
    urgent_count,
  });
});

// Health check endpoint for Cloud Run
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('OK');
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  initPythonBackend();
});
