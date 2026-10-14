import os
import sqlite3
from typing import Any, List, Optional, Tuple


class DatabaseManager:
    """
    Class 3: DatabaseManager
    รับผิดชอบการเชื่อมต่อ SQLite, สร้างตารางอัตโนมัติ,
    ดำเนินการ Query ด้วย Parameterized Queries เพื่อป้องกัน SQL Injection
    และจัดการปิดการเชื่อมต่ออย่างถูกต้อง
    """
    def __init__(self, db_path: str = "instance/repairs.db"):
        self.db_path = db_path
        # สร้างโฟลเดอร์สำหรับฐานข้อมูลอัตโนมัติถ้ายังไม่มี
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
            
        self.init_db()

    def get_connection(self) -> sqlite3.Connection:
        """เปิดการเชื่อมต่อ SQLite พร้อมเปิดใช้งาน Foreign Key Constraints และ Row Factory"""
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def init_db(self) -> None:
        """สร้างตารางฐานข้อมูลและดัชนีอัตโนมัติหากยังไม่มี"""
        create_table_sql = """
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
        """
        create_indexes = [
            "CREATE INDEX IF NOT EXISTS idx_repairs_status ON repairs(status);",
            "CREATE INDEX IF NOT EXISTS idx_repairs_request_no ON repairs(request_no);",
            "CREATE INDEX IF NOT EXISTS idx_repairs_problem_type ON repairs(problem_type);",
            "CREATE INDEX IF NOT EXISTS idx_repairs_created_at ON repairs(created_at);"
        ]

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(create_table_sql)
            for idx_sql in create_indexes:
                cursor.execute(idx_sql)
            conn.commit()

        self.seed_initial_data()

    def seed_initial_data(self) -> None:
        """เพิ่มข้อมูลตัวอย่างเบื้องต้นสำหรับทดสอบระบบ (เฉพาะเมื่อตารางยังว่างอยู่)"""
        count_row = self.fetch_one("SELECT COUNT(*) as count FROM repairs;")
        if count_row and count_row["count"] == 0:
            sample_data = [
                {
                    "request_no": "RP-202610-001",
                    "user_id": "ครูสมชาย วิจิตรศิลป์ (หมวดศิลปะ)",
                    "building": "อาคาร 2 (อาคารมัธยมต้น)",
                    "room": "ห้องศิลปะ 214",
                    "problem_type": "ELECTRICAL",
                    "description": "หลอดไฟฟลูออเรสเซนต์กะพริบและมีเสียงดัง 2 ดวง ทำให้แสงสว่างไม่พอในการเรียนการสอน",
                    "urgency": "NORMAL",
                    "status": "COMPLETED",
                    "assigned_to": "ช่างประเสริฐ ช่างไฟฟ้าประจำโรงเรียน",
                    "due_date": "2026-10-12",
                    "cost": 350.0,
                    "result": "เปลี่ยนหลอด LED T8 พร้อมสตาร์ทเตอร์ใหม่ 2 ชุด ใช้งานได้สว่างปกติ",
                    "created_at": "2026-10-10 08:30:00",
                    "updated_at": "2026-10-12 14:15:00"
                },
                {
                    "request_no": "RP-202610-002",
                    "user_id": "ครูวราภรณ์ สุขใจ (หมวดคอมพิวเตอร์)",
                    "building": "อาคาร 4 (ศูนย์คอมพิวเตอร์และสารสนเทศ)",
                    "room": "ห้องปฏิบัติการคอมพิวเตอร์ 401",
                    "problem_type": "AIRCON",
                    "description": "เครื่องปรับอากาศ Daikin ขนาด 24,000 BTU มีน้ำหยดลงบนโต๊ะเครื่องคอมพิวเตอร์เครื่องที่ 12",
                    "urgency": "URGENT",
                    "status": "IN_PROGRESS",
                    "assigned_to": "ช่างมนัส (ช่างระบบปรับอากาศ)",
                    "due_date": "2026-10-15",
                    "cost": 0.0,
                    "result": None,
                    "created_at": "2026-10-13 09:15:00",
                    "updated_at": "2026-10-13 11:00:00"
                },
                {
                    "request_no": "RP-202610-003",
                    "user_id": "อาจารย์สุรศักดิ์ นักวิทย์ (หมวดวิทยาศาสตร์)",
                    "building": "อาคาร 3 (ศูนย์วิทยาศาสตร์และเทคโนโลยี)",
                    "room": "ห้องทดลองเคมี 302",
                    "problem_type": "FURNITURE",
                    "description": "เก้าอี้ห้องปฏิบัติการขาหลุดและโต๊ะวางสารเคมีโครงสร้างโยกคลอน เสี่ยงเกิดอุบัติเหตุ",
                    "urgency": "EMERGENCY",
                    "status": "ACCEPTED",
                    "assigned_to": "ช่างบุญมี (ช่างเทคนิคงานไม้/โลหะ)",
                    "due_date": "2026-10-14",
                    "cost": 0.0,
                    "result": None,
                    "created_at": "2026-10-14 07:45:00",
                    "updated_at": "2026-10-14 08:30:00"
                },
                {
                    "request_no": "RP-202610-004",
                    "user_id": "เจ้าหน้าที่วรรณา มั่งมี (ฝ่ายธุรการ)",
                    "building": "อาคาร 1 (อาคารอำนวยการ)",
                    "room": "ห้องสำนักงานธุรการ 105",
                    "problem_type": "COMPUTER",
                    "description": "เครื่องพิมพ์ HP LaserJet พิมพ์งานแล้วกระดาษติดบ่อยครั้ง และมีเส้นดำพาดกลางหน้าเอกสาร",
                    "urgency": "NORMAL",
                    "status": "PENDING",
                    "assigned_to": None,
                    "due_date": None,
                    "cost": 0.0,
                    "result": None,
                    "created_at": "2026-10-14 08:50:00",
                    "updated_at": "2026-10-14 08:50:00"
                }
            ]
            for item in sample_data:
                self.insert("repairs", item)

    def execute_query(self, sql: str, params: Tuple[Any, ...] = ()) -> int:
        """ประมวลผลคำสั่ง SQL (INSERT, UPDATE, DELETE) พร้อม Parameterized Queries"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            conn.commit()
            return cursor.rowcount

    def fetch_one(self, sql: str, params: Tuple[Any, ...] = ()) -> Optional[sqlite3.Row]:
        """ดึงข้อมูล 1 แถวแบบ Parameterized Queries"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            return cursor.fetchone()

    def fetch_all(self, sql: str, params: Tuple[Any, ...] = ()) -> List[sqlite3.Row]:
        """ดึงข้อมูลทั้งหมดแบบ Parameterized Queries"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            return cursor.fetchall()

    def insert(self, table: str, data: dict) -> int:
        """บันทึกข้อมูลแบบ Parameterized Queries และส่งกลับ lastrowid"""
        columns = list(data.keys())
        placeholders = ["?"] * len(columns)
        values = tuple(data[col] for col in columns)

        sql = f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(placeholders)});"
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, values)
            conn.commit()
            return cursor.lastrowid

    def update(self, table: str, data: dict, where_clause: str, where_params: Tuple[Any, ...] = ()) -> int:
        """แก้ไขข้อมูลแบบ Parameterized Queries"""
        set_parts = [f"{col} = ?" for col in data.keys()]
        values = tuple(data.values()) + where_params

        sql = f"UPDATE {table} SET {', '.join(set_parts)} WHERE {where_clause};"
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, values)
            conn.commit()
            return cursor.rowcount
