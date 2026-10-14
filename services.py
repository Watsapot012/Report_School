from datetime import datetime
from typing import Any, Dict, List, Optional
from database import DatabaseManager
from models import ProblemType, RepairRequest, RequestStatus, UrgencyLevel


class RepairService:
    """
    Class 2: RepairService
    รับผิดชอบ:
    - การสร้างใบแจ้งซ่อมใหม่
    - สร้างเลขใบแจ้งซ่อมอัตโนมัติรูปแบบ RP-YYYYMM-XXX โดยใช้ datetime และ str.zfill()
    - บันทึกข้อมูลลง SQLite ผ่าน DatabaseManager
    - ดึงรายการแจ้งซ่อมและค้นหาใบแจ้งซ่อม
    - ควบคุมการเปลี่ยนสถานะโดยเชื่อมโยงกับ Object ของ RepairRequest ตามหลัก OOP
    """
    def __init__(self, db_manager: DatabaseManager):
        self.db_manager = db_manager

    def generate_request_no(self) -> str:
        """
        สร้างเลขใบแจ้งซ่อมอัตโนมัติในรูปแบบ RP-YYYYMM-XXX
        เช่น RP-202610-001, RP-202610-002
        โดยใช้ datetime สำหรับปีเดือน และ str.zfill() เติมเลขศูนย์ข้างหน้า
        """
        now = datetime.now()
        prefix = now.strftime("RP-%Y%m-")  # เช่น RP-202610-

        # ค้นหาเลขที่สูงสุดในเดือนและปีปัจจุบัน
        query = "SELECT request_no FROM repairs WHERE request_no LIKE ? ORDER BY request_no DESC LIMIT 1;"
        latest_row = self.db_manager.fetch_one(query, (f"{prefix}%",))

        if latest_row and latest_row["request_no"]:
            latest_no_str = latest_row["request_no"]
            try:
                # แยกส่วนเลขลำดับหลังเครื่องหมายขีดสุดท้าย
                last_seq = int(latest_no_str.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1

        # ใช้ str.zfill() เพื่อจัดรูปแบบเลขลำดับ 3 หลัก เช่น 001, 002
        sequence_part = str(next_seq).zfill(3)
        return f"{prefix}{sequence_part}"

    def create_request(self, form_data: Dict[str, Any]) -> RepairRequest:
        """
        สร้างใบแจ้งซ่อมใหม่:
        - ตรวจสอบความถูกต้องของข้อมูล (Validation)
        - สร้างเลขใบแจ้งซ่อมอัตโนมัติ
        - สร้างอ็อบเจกต์ RepairRequest ในสถานะ PENDING
        - บันทึกลง SQLite ฐานข้อมูล
        """
        user_id = form_data.get("user_id", "").strip()
        building = form_data.get("building", "").strip()
        room = form_data.get("room", "").strip()
        problem_type = form_data.get("problem_type", ProblemType.OTHER.value).strip()
        description = form_data.get("description", "").strip()
        urgency = form_data.get("urgency", UrgencyLevel.NORMAL.value).strip()

        # ตรวจสอบความครบถ้วนของข้อมูล
        if not user_id:
            raise ValueError("กรุณาระบุชื่อผู้แจ้งซ่อมหรือรหัสเจ้าหน้าที่")
        if not building:
            raise ValueError("กรุณาระบุชื่ออาคารหรือสถานที่")
        if not room:
            raise ValueError("กรุณาระบุห้องหรือจุดที่พบปัญหา")
        if not description:
            raise ValueError("กรุณาระบุรายละเอียดปัญหาที่ต้องการให้ซ่อมแซม")

        # ตรวจสอบความถูกต้องของ Enum
        valid_problems = [pt.value for pt in ProblemType]
        if problem_type not in valid_problems:
            problem_type = ProblemType.OTHER.value

        valid_urgencies = [u.value for u in UrgencyLevel]
        if urgency not in valid_urgencies:
            urgency = UrgencyLevel.NORMAL.value

        # สร้างเลขใบแจ้งซ่อม
        request_no = self.generate_request_no()

        # สร้าง Entity RepairRequest
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        repair_request = RepairRequest(
            request_no=request_no,
            user_id=user_id,
            building=building,
            room=room,
            problem_type=problem_type,
            description=description,
            urgency=urgency,
            status=RequestStatus.PENDING.value,
            assigned_to=None,
            due_date=None,
            cost=0.0,
            result=None,
            created_at=now_str,
            updated_at=now_str
        )

        # บันทึกข้อมูลลงใน SQLite
        insert_data = {
            "request_no": repair_request.request_no,
            "user_id": repair_request.user_id,
            "building": repair_request.building,
            "room": repair_request.room,
            "problem_type": repair_request.problem_type,
            "description": repair_request.description,
            "urgency": repair_request.urgency,
            "status": repair_request.status,
            "assigned_to": repair_request.assigned_to,
            "due_date": repair_request.due_date,
            "cost": repair_request.cost,
            "result": repair_request.result,
            "created_at": repair_request.created_at,
            "updated_at": repair_request.updated_at
        }
        new_id = self.db_manager.insert("repairs", insert_data)
        repair_request.id = new_id
        return repair_request

    def get_request_by_id(self, repair_id: int) -> Optional[RepairRequest]:
        """ดึงข้อมูลใบแจ้งซ่อม 1 รายการโดยใช้ ID และแปลงเป็น RepairRequest Object"""
        row = self.db_manager.fetch_one("SELECT * FROM repairs WHERE id = ?;", (repair_id,))
        if row:
            return RepairRequest.from_row(row)
        return None

    def get_request_by_no(self, request_no: str) -> Optional[RepairRequest]:
        """ดึงข้อมูลใบแจ้งซ่อม 1 รายการโดยใช้เลขที่ใบแจ้งซ่อม"""
        row = self.db_manager.fetch_one("SELECT * FROM repairs WHERE request_no = ?;", (request_no,))
        if row:
            return RepairRequest.from_row(row)
        return None

    def get_all_requests(
        self,
        status: Optional[str] = None,
        problem_type: Optional[str] = None,
        search: Optional[str] = None
    ) -> List[RepairRequest]:
        """
        ดึงรายการแจ้งซ่อมทั้งหมด พร้อมรองรับ:
        - กรองตามสถานะ (status)
        - กรองตามประเภทปัญหา (problem_type)
        - ค้นหาจากเลขที่ใบแจ้งซ่อม หรือ รายละเอียดปัญหา หรือ สถานที่
        """
        query = "SELECT * FROM repairs WHERE 1=1"
        params: List[Any] = []

        if status and status != "ALL":
            query += " AND status = ?"
            params.append(status)

        if problem_type and problem_type != "ALL":
            query += " AND problem_type = ?"
            params.append(problem_type)

        if search and search.strip():
            term = f"%{search.strip()}%"
            query += " AND (request_no LIKE ? OR description LIKE ? OR building LIKE ? OR room LIKE ? OR user_id LIKE ?)"
            params.extend([term, term, term, term, term])

        # เรียงลำดับจากล่าสุดไปเก่าสุด
        query += " ORDER BY id DESC;"

        rows = self.db_manager.fetch_all(query, tuple(params))
        return [RepairRequest.from_row(row) for row in rows]

    def assign_request(self, repair_id: int, technician: str, due_date: Optional[str] = None) -> RepairRequest:
        """
        รับงานและมอบหมายช่าง
        - โหลดอ็อบเจกต์ RepairRequest
        - เรียกใช้งาน Method assign_to() ของอ็อบเจกต์เพื่อตรวจสอบและเปลี่ยนสถานะ (Encapsulation)
        - อัปเดตข้อมูลกลับลง SQLite
        """
        repair = self.get_request_by_id(repair_id)
        if not repair:
            raise ValueError("ไม่พบใบแจ้งซ่อมที่ระบุ")

        # เรียก method ของคลาส RepairRequest
        repair.assign_to(technician, due_date)

        # บันทึกสถานะใหม่ลงฐานข้อมูล
        update_data = {
            "assigned_to": repair.assigned_to,
            "due_date": repair.due_date,
            "status": repair.status,
            "updated_at": repair.updated_at
        }
        self.db_manager.update("repairs", update_data, "id = ?", (repair.id,))
        return repair

    def start_repair(self, repair_id: int) -> RepairRequest:
        """
        เริ่มดำเนินการซ่อม
        - โหลดอ็อบเจกต์ RepairRequest
        - เรียกใช้งาน Method start_repair() ของอ็อบเจกต์ (Encapsulation)
        - บันทึกสถานะใหม่ลงฐานข้อมูล
        """
        repair = self.get_request_by_id(repair_id)
        if not repair:
            raise ValueError("ไม่พบใบแจ้งซ่อมที่ระบุ")

        # เรียก method ของคลาส RepairRequest
        repair.start_repair()

        update_data = {
            "status": repair.status,
            "updated_at": repair.updated_at
        }
        self.db_manager.update("repairs", update_data, "id = ?", (repair.id,))
        return repair

    def complete_repair(self, repair_id: int, result: str, cost: float = 0.0) -> RepairRequest:
        """
        บันทึกผลการซ่อมและปิดงาน
        - โหลดอ็อบเจกต์ RepairRequest
        - เรียกใช้งาน Method complete_repair() ของอ็อบเจกต์ (Encapsulation)
        - บันทึกสถานะ ค่าใช้จ่าย และผลการซ่อมลงฐานข้อมูล
        """
        repair = self.get_request_by_id(repair_id)
        if not repair:
            raise ValueError("ไม่พบใบแจ้งซ่อมที่ระบุ")

        # เรียก method ของคลาส RepairRequest
        repair.complete_repair(result, cost)

        update_data = {
            "status": repair.status,
            "result": repair.result,
            "cost": repair.cost,
            "updated_at": repair.updated_at
        }
        self.db_manager.update("repairs", update_data, "id = ?", (repair.id,))
        return repair

    def get_dashboard_stats(self) -> Dict[str, Any]:
        """สรุปข้อมูลสถิติสำหรับหน้า Dashboard"""
        # จำนวนงานตามแต่ละสถานะ
        status_counts = {
            RequestStatus.PENDING.value: 0,
            RequestStatus.ACCEPTED.value: 0,
            RequestStatus.IN_PROGRESS.value: 0,
            RequestStatus.COMPLETED.value: 0,
        }

        query = "SELECT status, COUNT(*) as count FROM repairs GROUP BY status;"
        rows = self.db_manager.fetch_all(query)
        for row in rows:
            if row["status"] in status_counts:
                status_counts[row["status"]] = row["count"]

        total_repairs = sum(status_counts.values())

        # ยอดรวมค่าใช้จ่ายงานที่ซ่อมเสร็จ
        cost_row = self.db_manager.fetch_one("SELECT SUM(cost) as total_cost FROM repairs WHERE status = 'COMPLETED';")
        total_cost = cost_row["total_cost"] if cost_row and cost_row["total_cost"] else 0.0

        # จำนวนงานด่วนและด่วนที่สุดที่ยังไม่เสร็จสิ้น
        urgent_row = self.db_manager.fetch_one(
            "SELECT COUNT(*) as urgent_count FROM repairs WHERE urgency IN ('URGENT', 'EMERGENCY') AND status != 'COMPLETED';"
        )
        urgent_count = urgent_row["urgent_count"] if urgent_row else 0

        # รายการแจ้งซ่อมล่าสุด 6 รายการ
        recent_rows = self.db_manager.fetch_all("SELECT * FROM repairs ORDER BY id DESC LIMIT 6;")
        recent_repairs = [RepairRequest.from_row(r) for r in recent_rows]

        return {
            "total": total_repairs,
            "pending": status_counts[RequestStatus.PENDING.value],
            "accepted": status_counts[RequestStatus.ACCEPTED.value],
            "in_progress": status_counts[RequestStatus.IN_PROGRESS.value],
            "completed": status_counts[RequestStatus.COMPLETED.value],
            "total_cost": total_cost,
            "urgent_count": urgent_count,
            "recent_repairs": recent_repairs
        }
