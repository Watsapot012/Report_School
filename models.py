from enum import Enum
from typing import Optional
from datetime import datetime
import sqlite3


class RequestStatus(str, Enum):
    """สถานะของใบแจ้งซ่อม"""
    PENDING = "PENDING"          # รอดำเนินการ / รอรับงาน
    ACCEPTED = "ACCEPTED"        # รับงานแล้ว / มอบหมายช่างแล้ว
    IN_PROGRESS = "IN_PROGRESS"  # กำลังดำเนินการซ่อม
    COMPLETED = "COMPLETED"      # ซ่อมเสร็จสิ้น / ปิดงาน


class ProblemType(str, Enum):
    """ประเภทปัญหาของอุปกรณ์"""
    ELECTRICAL = "ELECTRICAL"    # ระบบไฟฟ้าและแสงสว่าง
    FURNITURE = "FURNITURE"      # โต๊ะ เก้าอี้ และเฟอร์นิเจอร์
    COMPUTER = "COMPUTER"        # คอมพิวเตอร์และอุปกรณ์ไอที
    AIRCON = "AIRCON"            # เครื่องปรับอากาศและพัดลม
    OTHER = "OTHER"              # อื่นๆ


class UrgencyLevel(str, Enum):
    """ระดับความเร่งด่วน"""
    NORMAL = "NORMAL"            # ปกติ
    URGENT = "URGENT"            # ด่วน
    EMERGENCY = "EMERGENCY"      # ด่วนที่สุด


# ข้อความภาษาไทยสำหรับ Enum ต่างๆ
STATUS_LABELS = {
    RequestStatus.PENDING.value: "รอดำเนินการ",
    RequestStatus.ACCEPTED.value: "รับงานแล้ว",
    RequestStatus.IN_PROGRESS.value: "กำลังซ่อม",
    RequestStatus.COMPLETED.value: "ซ่อมเสร็จสิ้น",
}

STATUS_BADGES = {
    RequestStatus.PENDING.value: "badge-status-pending",
    RequestStatus.ACCEPTED.value: "badge-status-accepted",
    RequestStatus.IN_PROGRESS.value: "badge-status-in-progress",
    RequestStatus.COMPLETED.value: "badge-status-completed",
}

PROBLEM_LABELS = {
    ProblemType.ELECTRICAL.value: "ระบบไฟฟ้าและแสงสว่าง",
    ProblemType.FURNITURE.value: "โต๊ะ เก้าอี้ และเฟอร์นิเจอร์",
    ProblemType.COMPUTER.value: "คอมพิวเตอร์และอุปกรณ์ต่อพ่วง",
    ProblemType.AIRCON.value: "เครื่องปรับอากาศและพัดลม",
    ProblemType.OTHER.value: "อื่นๆ",
}

PROBLEM_ICONS = {
    ProblemType.ELECTRICAL.value: "bi-lightning-charge",
    ProblemType.FURNITURE.value: "bi-box-seam",
    ProblemType.COMPUTER.value: "bi-laptop",
    ProblemType.AIRCON.value: "bi-wind",
    ProblemType.OTHER.value: "bi-wrench",
}

URGENCY_LABELS = {
    UrgencyLevel.NORMAL.value: "ปกติ",
    UrgencyLevel.URGENT.value: "ด่วน",
    UrgencyLevel.EMERGENCY.value: "ด่วนที่สุด",
}

URGENCY_BADGES = {
    UrgencyLevel.NORMAL.value: "badge-urgency-normal",
    UrgencyLevel.URGENT.value: "badge-urgency-urgent",
    UrgencyLevel.EMERGENCY.value: "badge-urgency-emergency",
}


class RepairRequest:
    """
    Class 1: RepairRequest
    ตามหลักการ OOP (Encapsulation) รับผิดชอบเก็บข้อมูลใบแจ้งซ่อม
    และควบคุมการเปลี่ยนสถานะตาม Business Logic อย่างถูกต้อง
    """
    def __init__(
        self,
        id: Optional[int] = None,
        request_no: str = "",
        user_id: str = "",
        building: str = "",
        room: str = "",
        problem_type: str = ProblemType.OTHER.value,
        description: str = "",
        urgency: str = UrgencyLevel.NORMAL.value,
        status: str = RequestStatus.PENDING.value,
        assigned_to: Optional[str] = None,
        due_date: Optional[str] = None,
        cost: float = 0.0,
        result: Optional[str] = None,
        created_at: Optional[str] = None,
        updated_at: Optional[str] = None
    ):
        self.id = id
        self.request_no = request_no
        self.user_id = user_id
        self.building = building
        self.room = room
        self.problem_type = problem_type
        self.description = description
        self.urgency = urgency
        self.status = status
        self.assigned_to = assigned_to
        self.due_date = due_date
        self.cost = float(cost) if cost is not None else 0.0
        self.result = result
        self.created_at = created_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.updated_at = updated_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def assign_to(self, technician_name: str, due_date: Optional[str] = None) -> None:
        """
        มอบหมายงานให้ช่างและเปลี่ยนสถานะเป็น ACCEPTED
        เงื่อนไข:
        - ห้ามมอบหมายงานที่ซ่อมเสร็จแล้ว
        - ต้องอยู่ในสถานะ PENDING เท่านั้นจึงจะรับงานได้
        """
        if self.status == RequestStatus.COMPLETED.value:
            raise ValueError("ไม่สามารถมอบหมายงานที่ซ่อมเสร็จสิ้นแล้วได้")
        if self.status != RequestStatus.PENDING.value:
            raise ValueError(f"ไม่สามารถรับงานได้ในขณะนี้เนื่องจากสถานะปัจจุบันคือ '{self.status_label}' (ต้องเป็น 'รอดำเนินการ')")
        
        technician = technician_name.strip() if technician_name else ""
        if not technician:
            raise ValueError("กรุณาระบุชื่อช่างหรือผู้รับผิดชอบงาน")
            
        self.assigned_to = technician
        self.due_date = due_date.strip() if due_date else None
        self.status = RequestStatus.ACCEPTED.value
        self.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def start_repair(self) -> None:
        """
        เริ่มดำเนินการซ่อมและเปลี่ยนสถานะเป็น IN_PROGRESS
        เงื่อนไข:
        - 'ห้ามเริ่มซ่อมก่อนรับงาน' (ต้องอยู่ในสถานะ ACCEPTED)
        - 'ห้ามทำงานที่เสร็จแล้วซ้ำ'
        """
        if self.status == RequestStatus.COMPLETED.value:
            raise ValueError("งานนี้ซ่อมเสร็จสิ้นไปแล้ว ไม่สามารถเริ่มซ่อมซ้ำได้")
        if self.status == RequestStatus.PENDING.value:
            raise ValueError("ห้ามเริ่มซ่อมก่อนรับงาน! กรุณากดรับงานและมอบหมายช่างก่อนเริ่มดำเนินการ")
        if self.status != RequestStatus.ACCEPTED.value:
            raise ValueError(f"ไม่สามารถเริ่มซ่อมได้ในสถานะ '{self.status_label}'")

        self.status = RequestStatus.IN_PROGRESS.value
        self.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def complete_repair(self, result: str, cost: float = 0.0) -> None:
        """
        บันทึกผลการซ่อม ค่าใช้จ่าย และปิดงานเป็น COMPLETED
        เงื่อนไข:
        - 'ห้ามทำงานที่เสร็จแล้วซ้ำ'
        - งานต้องอยู่ในสถานะ IN_PROGRESS (กำลังซ่อม) เท่านั้น
        """
        if self.status == RequestStatus.COMPLETED.value:
            raise ValueError("งานนี้บันทึกซ่อมเสร็จสิ้นแล้ว ไม่สามารถปิดงานซ้ำได้")
        if self.status != RequestStatus.IN_PROGRESS.value:
            raise ValueError("ไม่สามารถปิดงานได้ งานต้องเริ่มดำเนินการซ่อม (สถานะ 'กำลังซ่อม') ก่อนปิดงาน")
        
        result_text = result.strip() if result else ""
        if not result_text:
            raise ValueError("กรุณาระบุรายละเอียดหรือผลการซ่อม")
            
        try:
            cost_val = float(cost)
            if cost_val < 0:
                raise ValueError("ค่าใช้จ่ายต้องไม่ติดลบ")
        except (ValueError, TypeError):
            raise ValueError("ค่าใช้จ่ายต้องเป็นตัวเลขที่ถูกต้อง")

        self.result = result_text
        self.cost = cost_val
        self.status = RequestStatus.COMPLETED.value
        self.updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    @property
    def status_label(self) -> str:
        return STATUS_LABELS.get(self.status, self.status)

    @property
    def status_badge_class(self) -> str:
        return STATUS_BADGES.get(self.status, "badge bg-secondary")

    @property
    def problem_type_label(self) -> str:
        return PROBLEM_LABELS.get(self.problem_type, self.problem_type)

    @property
    def problem_type_icon(self) -> str:
        return PROBLEM_ICONS.get(self.problem_type, "bi-wrench")

    @property
    def urgency_label(self) -> str:
        return URGENCY_LABELS.get(self.urgency, self.urgency)

    @property
    def urgency_badge_class(self) -> str:
        return URGENCY_BADGES.get(self.urgency, "badge bg-secondary")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "request_no": self.request_no,
            "user_id": self.user_id,
            "building": self.building,
            "room": self.room,
            "problem_type": self.problem_type,
            "problem_type_label": self.problem_type_label,
            "problem_type_icon": self.problem_type_icon,
            "description": self.description,
            "urgency": self.urgency,
            "urgency_label": self.urgency_label,
            "urgency_badge_class": self.urgency_badge_class,
            "status": self.status,
            "status_label": self.status_label,
            "status_badge_class": self.status_badge_class,
            "assigned_to": self.assigned_to or "-",
            "due_date": self.due_date or "-",
            "cost": self.cost,
            "result": self.result or "-",
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "RepairRequest":
        """Factory method สร้าง RepairRequest จากแถวข้อมูล SQLite"""
        return cls(
            id=row["id"],
            request_no=row["request_no"],
            user_id=row["user_id"],
            building=row["building"],
            room=row["room"],
            problem_type=row["problem_type"],
            description=row["description"],
            urgency=row["urgency"],
            status=row["status"],
            assigned_to=row["assigned_to"],
            due_date=row["due_date"],
            cost=row["cost"] or 0.0,
            result=row["result"],
            created_at=row["created_at"],
            updated_at=row["updated_at"]
        )
