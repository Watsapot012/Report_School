# ระบบแจ้งซ่อมอุปกรณ์โรงเรียน (Equipment Repair System)

เว็บแอปพลิเคชันระบบแจ้งซ่อมอุปกรณ์และบริหารจัดการงานซ่อมบำรุงภายในโรงเรียน พัฒนาด้วย **Python (Flask)**, **SQLite** และยึดตามหลักการ **Object-Oriented Programming (OOP) & OOAD** อย่างเคร่งครัด

---

## 1. คุณสมบัติเด่นของระบบ

1. **Dashboard สรุปภาพรวม:** แสดงจำนวนงานทั้งหมด, งานรอดำเนินการ, งานกำลังซ่อม, งานซ่อมเสร็จ และยอดงบประมาณค่าซ่อมบำรุง
2. **ระบบแจ้งซ่อมออนไลน์:** กรอกข้อมูลผู้แจ้ง, อาคาร, ห้อง, ประเภทอุปกรณ์ที่ชำรุด และระดับความเร่งด่วน
3. **ออกเลขที่ใบแจ้งซ่อมอัตโนมัติ:** รูปแบบ `RP-YYYYMM-XXX` (เช่น `RP-202610-001`) โดยใช้ `datetime` และ `str.zfill()`
4. **State Machine & OOP Encapsulation:** ควบคุมการเปลี่ยนสถานะผ่าน Method ภายในคลาส `RepairRequest` เพื่อป้องกันการเปลี่ยนสถานะผิดลำดับ
   - **PENDING (รอดำเนินการ)** ➜ มอบหมายงาน (`assign_to`) ➜ **ACCEPTED (รับงานแล้ว)**
   - **ACCEPTED (รับงานแล้ว)** ➜ เริ่มซ่อม (`start_repair`) ➜ **IN_PROGRESS (กำลังซ่อม)**
   - **IN_PROGRESS (กำลังซ่อม)** ➜ บันทึกผลและปิดงาน (`complete_repair`) ➜ **COMPLETED (ซ่อมเสร็จสิ้น)**
   - *กฎข้อบังคับ:* ห้ามเริ่มซ่อมก่อนรับงาน และห้ามปิดงานที่เสร็จแล้วซ้ำ
5. **ความปลอดภัยของฐานข้อมูล:** ใช้ Parameterized Queries (`?` placeholders) เพื่อป้องกัน SQL Injection 100%
6. **การแจ้งเตือนและการตอบสนอง:** ใช้งาน Bootstrap 5 และ SweetAlert2 ในการยืนยันการดำเนินงานสำคัญ
7. **พิมพ์เอกสารส่งมอบงาน:** พิมพ์ใบสั่งงานและรายงานผลการซ่อม (Print / PDF) ได้ทันที

---

## 2. โครงสร้างโปรเจกต์ (Project Structure)

```text
repair_system/
├── app.py                  # ไฟล์หลักของเว็บแอปพลิเคชัน Flask (Routes & Handlers)
├── models.py               # Class RepairRequest, Enum RequestStatus, ProblemType, UrgencyLevel
├── services.py             # Class RepairService (Business Logic, เลขแจ้งซ่อมอัตโนมัติ)
├── database.py             # Class DatabaseManager (จัดการ SQLite, Schema, Parameterized Queries)
├── requirements.txt        # รายการ Dependencies ของ Python
├── README.md               # คู่มือการติดตั้งและคำอธิบายระบบ
├── templates/              # Jinja2 HTML Templates
│   ├── base.html           # Layout หลัก, Sidebar, Navbar
│   ├── dashboard.html      # หน้าสรุปภาพรวมแดชบอร์ด
│   ├── repairs.html        # หน้ารายการแจ้งซ่อม ค้นหา และตัวกรอง
│   ├── repair_form.html    # ฟอร์มสร้างใบแจ้งซ่อมใหม่
│   ├── repair_detail.html  # หน้ารายละเอียดงานและปุ่มเปลี่ยนสถานะ
│   ├── repair_print.html   # หน้าพิมพ์เอกสารใบส่งมอบงาน
│   ├── 404.html            # หน้าแจ้งเตือนไม่พบหน้า
│   └── 500.html            # หน้าแจ้งเตือนข้อผิดพลาดระบบ
├── static/                 # Static Assets
│   ├── css/
│   │   └── style.css       # โทนสีน้ำเงิน ขาว เทา และดีไซน์ Responsive
│   └── js/
│       └── main.js         # SweetAlert2 & ควบคุมการทำงาน UI
└── instance/
    └── repairs.db          # ฐานข้อมูล SQLite (สร้างอัตโนมัติเมื่อรันครั้งแรก)
```

---

## 3. สถาปัตยกรรม OOP ที่นำมาใช้

### Class 1: `RepairRequest` (ใน `models.py`)
- **Attributes:** `id`, `request_no`, `user_id`, `building`, `room`, `problem_type`, `description`, `urgency`, `status`, `assigned_to`, `due_date`, `cost`, `result`, `created_at`, `updated_at`
- **Method `assign_to(technician_name, due_date)`:**
  - ตรวจสอบสถานะก่อนเปลี่ยน โดยต้องอยู่ในสถานะ `PENDING` เท่านั้น
  - เปลี่ยนสถานะเป็น `ACCEPTED`
- **Method `start_repair()`:**
  - ตรวจสอบเงื่อนไข **"ห้ามเริ่มซ่อมก่อนรับงาน"** (ต้องเป็น `ACCEPTED` ก่อน)
  - เปลี่ยนสถานะเป็น `IN_PROGRESS`
- **Method `complete_repair(result, cost)`:**
  - ตรวจสอบเงื่อนไข **"ห้ามทำงานที่เสร็จแล้วซ้ำ"**
  - บันทึกผลการซ่อมและค่าใช้จ่าย เปลี่ยนสถานะเป็น `COMPLETED`

### Class 2: `RepairService` (ใน `services.py`)
- รับผิดชอบการสร้างใบแจ้งซ่อมใหม่
- Method `generate_request_no()`: คำนวณปีเดือนปัจจุบันและใช้ `str.zfill(3)` ออกเลข `RP-YYYYMM-XXX`
- เชื่อมต่อกับอ็อบเจกต์ `RepairRequest` และบันทึกลง SQLite
- ให้บริการดึงข้อมูล, กรองสถานะ, ค้นหาคำ และคำนวณสถิติแดชบอร์ด

### Class 3: `DatabaseManager` (ใน `database.py`)
- จัดการ SQLite Connection แบบมี context manager ปิดการเชื่อมต่ออย่างถูกต้อง
- เปิดใช้งาน `PRAGMA foreign_keys = ON;`
- จัดเตรียมฟังก์ชัน `execute_query()`, `fetch_one()`, `fetch_all()`, `insert()`, `update()` โดยใช้ Parameterized Queries ทั้งหมดเพื่อป้องกัน SQL Injection

---

## 4. วิธีการติดตั้งและรันบนเครื่องคอมพิวเตอร์ (Windows / macOS / Linux)

### ความต้องการของระบบ:
- Python 3.10 ขึ้นไป
- Web Browser ทันสมัย (Chrome, Edge, Firefox, Safari)

### ขั้นตอนการรันบน Windows:

1. **เปิด Command Prompt หรือ PowerShell** แล้วไปยังโฟลเดอร์ของโปรเจกต์:
   ```bash
   cd repair_system
   ```

2. **(แนะนำ) สร้างและเปิดใช้งาน Virtual Environment:**
   ```bash
   python -m venv venv
   venv\Scripts\activate
   ```

3. **ติดตั้ง Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **เปิดใช้งานเซิร์ฟเวอร์:**
   ```bash
   python app.py
   ```

5. **เข้าใช้งานผ่านเว็บเบราว์เซอร์:**
   เปิดเบราว์เซอร์แล้วไปที่: `http://localhost:3000` (หรือ `http://127.0.0.1:3000`)

---

## 5. การทดสอบระบบ

1. เข้าหน้าแรก จะเห็นแดชบอร์ดสรุปงานทั้งหมดและงานตัวอย่างที่ระบบสร้างให้อัตโนมัติ
2. คลิกปุ่ม **"แจ้งซ่อมใหม่"** กรอกข้อมูล แล้วกดยืนยัน ระบบจะสร้างเลขใบแจ้งซ่อมอัตโนมัติ เช่น `RP-202610-005`
3. ในหน้ารายละเอียดใบแจ้งซ่อม:
   - ทดสอบกด **"รับงานและมอบหมายช่าง"** ระบุชื่อช่าง ➜ สถานะจะกลายเป็น "รับงานแล้ว" (ACCEPTED)
   - ทดสอบกด **"เริ่มดำเนินการซ่อม"** พร้อมยืนยันผ่าน SweetAlert2 ➜ สถานะจะกลายเป็น "กำลังซ่อม" (IN_PROGRESS)
   - ทดสอบกด **"บันทึกผลซ่อมและปิดงาน"** ระบุผลการซ่อมและค่าใช้จ่าย ➜ สถานะจะกลายเป็น "ซ่อมเสร็จสิ้น" (COMPLETED)
   - ทดสอบกด **"พิมพ์ใบสั่งงาน"** จะได้เอกสารรายงานผลและใบส่งมอบงานพร้อมพิมพ์
