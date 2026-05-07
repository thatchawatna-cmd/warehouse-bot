# 🚀 Setup Guide — LINE Warehouse Bot

## ภาพรวม
LINE OA → Webhook → Node.js Server (Railway) → Google Sheets + Claude AI → ตอบกลับ

---

## STEP 1 — สร้าง LINE OA + เปิด Messaging API

1. ไปที่ https://manager.line.biz → สร้าง Official Account ใหม่
2. ไปที่ **Settings → Messaging API → Enable Messaging API**
3. จด **Channel Access Token** (กด Issue)
4. จด **Channel Secret**
5. ตั้ง **Auto-reply messages → OFF**
6. ตั้ง **Greeting messages → OFF** (optional)

---

## STEP 2 — สร้าง Google Service Account

1. ไปที่ https://console.cloud.google.com
2. สร้าง Project ใหม่ หรือใช้อันที่มีอยู่
3. ไปที่ **APIs & Services → Enable APIs** → เปิด **Google Sheets API**
4. ไปที่ **APIs & Services → Credentials → Create Credentials → Service Account**
5. ตั้งชื่อ เช่น `warehouse-bot` → Create
6. คลิก Service Account ที่สร้าง → **Keys → Add Key → JSON** → Download
7. เปิดไฟล์ JSON ที่ download มา → **copy เนื้อหาทั้งหมด** (จะใช้ใน Railway)
8. **Share Google Sheet** ให้ email ของ Service Account (ดูใน JSON field: `client_email`)
   - ไปที่ Google Sheet → Share → paste client_email → Viewer

---

## STEP 3 — Deploy บน Railway

1. ไปที่ https://railway.app → Sign up / Login (ใช้ GitHub)
2. **New Project → Deploy from GitHub repo**
   - ถ้ายังไม่มี repo: อัพโหลดไฟล์ทั้งหมดใน folder นี้ขึ้น GitHub ก่อน
3. ไปที่ **Variables** → เพิ่ม Environment Variables:

```
LINE_CHANNEL_ACCESS_TOKEN  =  (จาก LINE Developer Console)
ANTHROPIC_API_KEY          =  (จาก console.anthropic.com)
GOOGLE_SHEET_ID            =  1ug-1X3TFwNXeobmcfoohRqqudTcuyYfiagxhoWtPJLg
SHEET_NAME                 =  Warehouse Airport&7-11 media
GOOGLE_SERVICE_ACCOUNT_JSON = (วาง JSON ทั้งก้อนจาก Step 2)
```

4. Railway จะ Deploy อัตโนมัติ → รอ ~2 นาที
5. ไปที่ **Settings → Domains → Generate Domain** → copy URL เช่น `https://line-warehouse-bot.up.railway.app`

---

## STEP 4 — ตั้ง Webhook URL ใน LINE

1. กลับไป LINE Developer Console
2. ไปที่ **Messaging API → Webhook URL**
3. ใส่: `https://your-railway-url.up.railway.app/webhook`
4. กด **Verify** → ต้องขึ้น Success ✅
5. เปิด **Use Webhook → ON**

---

## STEP 5 — ทดสอบ

เพิ่มเพื่อน LINE OA แล้วพิมพ์ทดสอบ:
- "จอ 37 มีเท่าไหร่"
- "จอใหญ่มีไหม"
- "อุปกรณ์ทั้งหมดมีอะไรบ้าง"

---

## ค่าใช้จ่าย

| Service | ค่าใช้จ่าย |
|---|---|
| LINE OA | ฟรี |
| Railway | ฟรี (500 ชั่วโมง/เดือน) |
| Google Sheets API | ฟรี |
| Claude API | ~$0.001 ต่อการถาม 1 ครั้ง |

