const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1ug-1X3TFwNXeobmcfoohRqqudTcuyYfiagxhoWtPJLg';
const SHEET_NAME = process.env.SHEET_NAME || 'Warehouse Airport&7-11 media';

async function getInventory() {
  const encodedSheet = encodeURIComponent(SHEET_NAME);
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
  const response = await axios.get(url);
  const lines = response.data.split('\n');

  const COL_ITEM   = 2;
  const COL_STATUS = 16;
  const COL_INOUT  = 20;
  const COL_UNIT   = 26;

  const summary = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 27) continue;
    const item   = cols[COL_ITEM];
    const status = cols[COL_STATUS];
    const inout  = cols[COL_INOUT];
    const unit   = cols[COL_UNIT];
    if (!item || item === 'รายการ') continue;
    if (status !== 'ดี' || inout !== 'In') continue;
    const cleanItem = item.replace(/_7-11/g, '').replace(/_Air/g, '').trim();
    if (!summary[cleanItem]) summary[cleanItem] = { count: 0, unit: unit || 'ชิ้น' };
    summary[cleanItem].count += 1;
    if (unit) summary[cleanItem].unit = unit;
  }

  if (Object.keys(summary).length === 0) return 'ไม่พบข้อมูล Inventory';
  return Object.entries(summary)
    .map(([name, d]) => `- ${name}: ${d.count} ${d.unit}`)
    .join('\n');
}

async function askGemini(userMessage, inventoryText) {
  const prompt = `คุณคือ AI ผู้ช่วยตอบข้อมูล Warehouse Inventory ของ Plan B Media

กฎการตอบ:
- ตอบเฉพาะอุปกรณ์ที่ "พร้อมใช้งาน" (สภาพดี อยู่ใน Warehouse) เท่านั้น
- ไม่ต้องพูดถึงของเสียหรือ Out
- ตอบสั้น กระชับ ภาษาไทย
- ถ้าถามสินค้าที่ไม่มีในคลัง ให้บอกว่า "ขณะนี้ไม่มีในคลังครับ"
- ถ้าถามรวมหลายรายการ (เช่น จอ 37") ให้รวมยอดให้ด้วย

ข้อมูล Inventory พร้อมใช้ปัจจุบัน:
${inventoryText}

คำถาม: ${userMessage}`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }] }
  );
  return response.data.candidates[0].content.parts[0].text;
}

async function replyToLine(replyToken, text) {
  const res = await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    { replyToken, messages: [{ type: 'text', text }] },
    { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  console.log('LINE reply status:', res.status);
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;
    const userMessage = event.message.text;
    const replyToken  = event.replyToken;
    console.log('User asked:', userMessage);
    try {
      const inventoryText = await getInventory();
      console.log('Inventory fetched OK');
      const reply = await askGemini(userMessage, inventoryText);
      console.log('Gemini replied OK');
      await replyToLine(replyToken, reply);
    } catch (err) {
      const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
      console.log('ERROR:', errMsg);
      await replyToLine(replyToken, 'ขออภัยครับ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง').catch(() => {});
    }
  }
});

app.get('/', (req, res) => res.send('LINE Warehouse Bot is running ✅'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
