/**
 * JavaScript: ระบบแจ้งซ่อมอุปกรณ์ (Equipment Repair System)
 * จัดการการตอบสนองของ UI, Sidebar บนมือถือ และ SweetAlert2
 */

document.addEventListener("DOMContentLoaded", function () {
    // 1. Sidebar Toggle สำหรับหน้าจอมือถือและแท็บเล็ต
    const sidebar = document.getElementById("appSidebar");
    const toggleBtn = document.getElementById("sidebarToggleBtn");
    const closeBtn = document.getElementById("sidebarCloseBtn");
    const backdrop = document.getElementById("sidebarBackdrop");

    function openSidebar() {
        if (sidebar && backdrop) {
            sidebar.classList.add("show");
            backdrop.classList.add("show");
        }
    }

    function closeSidebar() {
        if (sidebar && backdrop) {
            sidebar.classList.remove("show");
            backdrop.classList.remove("show");
        }
    }

    if (toggleBtn) {
        toggleBtn.addEventListener("click", openSidebar);
    }
    if (closeBtn) {
        closeBtn.addEventListener("click", closeSidebar);
    }
    if (backdrop) {
        backdrop.addEventListener("click", closeSidebar);
    }

    // 2. SweetAlert2 ยืนยันการเริ่มซ่อม (Action 2: Start Repair)
    const btnStartRepair = document.getElementById("btnStartRepair");
    const startRepairForm = document.getElementById("startRepairForm");

    if (btnStartRepair && startRepairForm) {
        btnStartRepair.addEventListener("click", function (e) {
            e.preventDefault();
            Swal.fire({
                title: "ยืนยันเริ่มดำเนินการซ่อม?",
                text: "สถานะจะถูกเปลี่ยนเป็น 'กำลังซ่อม' (IN_PROGRESS) ตามหลัก State Transition ของ RepairRequest",
                icon: "question",
                showCancelButton: true,
                confirmButtonColor: "#2563eb",
                cancelButtonColor: "#64748b",
                confirmButtonText: "ใช่, เริ่มดำเนินการซ่อม",
                cancelButtonText: "ยกเลิก"
            }).then((result) => {
                if (result.isConfirmed) {
                    startRepairForm.submit();
                }
            });
        });
    }

    // 3. SweetAlert2 ยืนยันการปิดงานซ่อม (Action 3: Complete Repair)
    const completeForm = document.getElementById("completeForm");
    const btnSubmitComplete = document.getElementById("btnSubmitComplete");

    if (completeForm && btnSubmitComplete) {
        btnSubmitComplete.addEventListener("click", function (e) {
            const resultInput = document.getElementById("result");
            const costInput = document.getElementById("cost");

            if (!resultInput || !resultInput.value.trim()) {
                Swal.fire({
                    title: "กรุณาระบุผลการซ่อม",
                    text: "ต้องระบุรายละเอียดผลการซ่อมหรืออะไหล่ที่เปลี่ยนก่อนปิดงาน",
                    icon: "warning",
                    confirmButtonText: "ตกลง",
                    confirmButtonColor: "#2563eb"
                });
                return;
            }

            const costVal = parseFloat(costInput.value);
            if (isNaN(costVal) || costVal < 0) {
                Swal.fire({
                    title: "ค่าใช้จ่ายไม่ถูกต้อง",
                    text: "ค่าใช้จ่ายต้องเป็นตัวเลขและไม่ติดลบ (หากไม่มีค่าใช้จ่ายให้ใส่ 0)",
                    icon: "warning",
                    confirmButtonText: "ตกลง",
                    confirmButtonColor: "#2563eb"
                });
                return;
            }

            e.preventDefault();
            Swal.fire({
                title: "ยืนยันบันทึกผลและปิดงาน?",
                html: `คุณกำลังจะปิดงานใบแจ้งซ่อมนี้<br><small class='text-muted'>(เมื่อปิดงานแล้วตามกฎ OOP จะไม่สามารถแก้ไขย้อนกลับได้)</small>`,
                icon: "warning",
                showCancelButton: true,
                confirmButtonColor: "#16a34a",
                cancelButtonColor: "#64748b",
                confirmButtonText: "ยืนยันปิดงานซ่อม",
                cancelButtonText: "ตรวจสอบอีกครั้ง"
            }).then((modalResult) => {
                if (modalResult.isConfirmed) {
                    completeForm.submit();
                }
            });
        });
    }

    // 4. Form Validation & Feedback สำหรับหน้าแจ้งซ่อมใหม่ (New Repair Form)
    const newRepairForm = document.getElementById("newRepairForm");
    const btnSubmitRepair = document.getElementById("btnSubmitRepair");

    if (newRepairForm && btnSubmitRepair) {
        newRepairForm.addEventListener("submit", function (e) {
            const userId = document.getElementById("user_id")?.value.trim();
            const building = document.getElementById("building")?.value.trim();
            const room = document.getElementById("room")?.value.trim();
            const description = document.getElementById("description")?.value.trim();

            if (!userId || !building || !room || !description) {
                e.preventDefault();
                Swal.fire({
                    title: "ข้อมูลไม่ครบถ้วน",
                    text: "กรุณากรอกข้อมูลในช่องที่มีเครื่องหมายดอกจัน (*) ให้ครบทุกช่อง",
                    icon: "error",
                    confirmButtonText: "ตกลง",
                    confirmButtonColor: "#2563eb"
                });
                return false;
            }

            btnSubmitRepair.disabled = true;
            btnSubmitRepair.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>กำลังบันทึกข้อมูล...`;
        });
    }
});
