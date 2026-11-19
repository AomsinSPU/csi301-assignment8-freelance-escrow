# เปิดเว็บ Freelance Escrow บน Sepolia
เปิด PowerShell ที่โฟลเดอร์ assignment8 แล้วรัน npm install และ npm run dev -- --port 15173 เปิด http://127.0.0.1:15173/ หน้าเว็บอ่านสัญญาจาก Sepolia แม้เปิดผ่าน localhost
ดูข้อมูลได้โดยไม่เชื่อมกระเป๋า หากจะทำรายการให้เลือก Sepolia ใน MetaMask และใช้ Sepolia ETH สำหรับค่าแก๊ส
public/sepolia.json ระบุ RPC บล็อกที่สร้างสัญญา ABI และที่อยู่ของสัญญาบน Sepolia
สัญญาปัจจุบันรองรับการระบุผู้รับงานล่วงหน้า หลัง Deploy รุ่นที่มี postJob และ acceptJob ต้องปรับที่อยู่ ABI บล็อกเริ่มต้น และตั้ง marketplace เป็น true
ตรวจหน้าเว็บแบบอ่านอย่างเดียวด้วย node test/web.cjs ขณะเว็บกำลังรันบนพอร์ต 15173
