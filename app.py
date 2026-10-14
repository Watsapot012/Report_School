import os
import sys

# เพิ่มไดเรกทอรี lib และพาธปัจจุบันลงใน sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
lib_path = os.path.join(BASE_DIR, "lib")
if os.path.exists(lib_path) and lib_path not in sys.path:
    sys.path.insert(0, lib_path)
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    flash,
    jsonify,
    abort
)
from database import DatabaseManager
from models import (
    ProblemType,
    RequestStatus,
    UrgencyLevel,
    PROBLEM_LABELS,
    PROBLEM_ICONS,
    STATUS_LABELS,
    URGENCY_LABELS
)
from services import RepairService

# สร้างอินสแตนซ์ของ Flask
app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.environ.get("SECRET_KEY", "repair-system-secret-key-2026")

# กำหนดพาธฐานข้อมูล SQLite
db_path = os.path.join(BASE_DIR, "instance", "repairs.db")
db_manager = DatabaseManager(db_path=db_path)
repair_service = RepairService(db_manager=db_manager)


# กำหนด Context Processor เพื่อส่งข้อมูล Enum และ Labels ไปยังทุก Template
@app.context_processor
def inject_globals():
    return {
        "RequestStatus": RequestStatus,
        "ProblemType": ProblemType,
        "UrgencyLevel": UrgencyLevel,
        "PROBLEM_LABELS": PROBLEM_LABELS,
        "PROBLEM_ICONS": PROBLEM_ICONS,
        "STATUS_LABELS": STATUS_LABELS,
        "URGENCY_LABELS": URGENCY_LABELS,
        "now_year": 2026
    }


# Template Filters
@app.template_filter("currency")
def currency_filter(val):
    try:
        return f"{float(val):,.2f}"
    except (ValueError, TypeError):
        return "0.00"


@app.template_filter("format_date")
def format_date_filter(val):
    if not val:
        return "-"
    try:
        # หากอยู่ในรูป YYYY-MM-DD HH:MM:SS ให้แสดงวันที่และเวลา
        return str(val)
    except Exception:
        return str(val)


# --- Routes ---

@app.route("/")
def dashboard():
    """หน้า Dashboard สรุปจำนวนงานและแสดงรายการล่าสุด"""
    stats = repair_service.get_dashboard_stats()
    return render_template("dashboard.html", stats=stats, active_page="dashboard")


@app.route("/repairs")
def repairs_list():
    """หน้ารายการแจ้งซ่อมทั้งหมด รองรับการค้นหาและกรองสถานะ"""
    status_filter = request.args.get("status", "ALL")
    problem_filter = request.args.get("problem_type", "ALL")
    search_query = request.args.get("q", "").strip()

    repairs = repair_service.get_all_requests(
        status=status_filter,
        problem_type=problem_filter,
        search=search_query
    )

    return render_template(
        "repairs.html",
        repairs=repairs,
        current_status=status_filter,
        current_problem=problem_filter,
        search_query=search_query,
        active_page="repairs"
    )


@app.route("/repairs/new", methods=["GET", "POST"])
def new_repair():
    """หน้าฟอร์มสร้างใบแจ้งซ่อมใหม่"""
    if request.method == "POST":
        try:
            form_data = {
                "user_id": request.form.get("user_id"),
                "building": request.form.get("building"),
                "room": request.form.get("room"),
                "problem_type": request.form.get("problem_type"),
                "urgency": request.form.get("urgency"),
                "description": request.form.get("description"),
            }
            new_request = repair_service.create_request(form_data)
            flash(f"แจ้งซ่อมสำเร็จ! รหัสใบแจ้งซ่อมคือ {new_request.request_no}", "success")
            return redirect(url_for("repair_detail", repair_id=new_request.id))
        except ValueError as e:
            flash(str(e), "danger")
            return render_template("repair_form.html", form_data=request.form, active_page="new_repair")
        except Exception as e:
            flash(f"เกิดข้อผิดพลาดในการบันทึกข้อมูล: {str(e)}", "danger")
            return render_template("repair_form.html", form_data=request.form, active_page="new_repair")

    return render_template("repair_form.html", form_data={}, active_page="new_repair")


@app.route("/repairs/<int:repair_id>")
def repair_detail(repair_id: int):
    """หน้ารายละเอียดใบแจ้งซ่อม"""
    repair = repair_service.get_request_by_id(repair_id)
    if not repair:
        flash("ไม่พบข้อมูลใบแจ้งซ่อมที่ต้องการ", "warning")
        return redirect(url_for("repairs_list"))

    return render_template("repair_detail.html", repair=repair, active_page="repairs")


@app.route("/repairs/<int:repair_id>/assign", methods=["POST"])
def assign_repair(repair_id: int):
    """มอบหมายงานและเปลี่ยนสถานะเป็น ACCEPTED ผ่าน Method assign_to ของ RepairRequest"""
    technician = request.form.get("technician_name", "").strip()
    due_date = request.form.get("due_date", "").strip() or None

    try:
        repair = repair_service.assign_request(repair_id, technician, due_date)
        flash(f"รับงานซ่อมและมอบหมายให้ '{repair.assigned_to}' เรียบร้อยแล้ว", "success")
    except ValueError as e:
        flash(str(e), "danger")
    except Exception as e:
        flash(f"เกิดข้อผิดพลาด: {str(e)}", "danger")

    return redirect(url_for("repair_detail", repair_id=repair_id))


@app.route("/repairs/<int:repair_id>/start", methods=["POST"])
def start_repair(repair_id: int):
    """เริ่มดำเนินการซ่อมและเปลี่ยนสถานะเป็น IN_PROGRESS ผ่าน Method start_repair"""
    try:
        repair_service.start_repair(repair_id)
        flash("เริ่มดำเนินการซ่อมอุปกรณ์เรียบร้อยแล้ว (สถานะ: กำลังซ่อม)", "info")
    except ValueError as e:
        flash(str(e), "danger")
    except Exception as e:
        flash(f"เกิดข้อผิดพลาด: {str(e)}", "danger")

    return redirect(url_for("repair_detail", repair_id=repair_id))


@app.route("/repairs/<int:repair_id>/complete", methods=["POST"])
def complete_repair(repair_id: int):
    """บันทึกผลการซ่อม ค่าใช้จ่าย และปิดงานเป็น COMPLETED ผ่าน Method complete_repair"""
    result = request.form.get("result", "").strip()
    cost_raw = request.form.get("cost", "0").strip()

    try:
        cost = float(cost_raw) if cost_raw else 0.0
    except ValueError:
        cost = 0.0

    try:
        repair = repair_service.complete_repair(repair_id, result, cost)
        flash(f"บันทึกผลการซ่อมและปิดงานเรียบร้อยแล้ว ค่าใช้จ่าย: {repair.cost:,.2f} บาท", "success")
    except ValueError as e:
        flash(str(e), "danger")
    except Exception as e:
        flash(f"เกิดข้อผิดพลาด: {str(e)}", "danger")

    return redirect(url_for("repair_detail", repair_id=repair_id))


@app.route("/repairs/<int:repair_id>/print")
def print_repair(repair_id: int):
    """หน้าพิมพ์ใบส่งมอบงานและรายงานการซ่อม"""
    repair = repair_service.get_request_by_id(repair_id)
    if not repair:
        abort(404)
    return render_template("repair_print.html", repair=repair)


@app.route("/api/stats")
def api_stats():
    """API ดึงข้อมูลสรุป Dashboard ในรูปแบบ JSON"""
    stats = repair_service.get_dashboard_stats()
    return jsonify({
        "total": stats["total"],
        "pending": stats["pending"],
        "accepted": stats["accepted"],
        "in_progress": stats["in_progress"],
        "completed": stats["completed"],
        "total_cost": stats["total_cost"],
        "urgent_count": stats["urgent_count"]
    })


@app.route("/health")
def health_check():
    return "OK", 200


@app.errorhandler(404)
def page_not_found(e):
    return render_template("404.html"), 404


@app.errorhandler(500)
def server_error(e):
    return render_template("500.html"), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    # ปิด reloader เพื่อป้องกันการ fork ซ้ำใน container dev server
    app.run(host="0.0.0.0", port=port, debug=False)
