const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1ug-1X3TFwNXeobmcfoohRqqudTcuyYfiagxhoWtPJLg';
const SHEET_NAME = process.env.SHEET_NAME || 'Warehouse Airport&7-11 media';

async function getInventory() {
  const encodedSheet = encodeURIComponent(SHEET_NAME);
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
  const response = await axios.get(url);
  const lines = response.data.split('\n');

  // Column index (0-based จาก CSV):
  // col2=รายการ, col16=Status, col24=QTY, col26=Unit(ไทย), col31=Location Name
  const COL_ITEM     = 2;
  const COL_STATUS   = 16;
  const COL_QTY      = 24;
  const COL_UNIT     = 26;
  const COL_LOCATION = 31;

  const summary = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 32) continue;

    const item     = cols[COL_ITEM];
    const status   = cols[COL_STATUS];
    const qtyRaw   = cols[COL_QTY];
    const unit     = cols[COL_UNIT];
    const location = cols[COL_LOCATION];

    if (!item || item === 'รายการ') continue;
    if (status !== 'ดี') continue;
    if (location !== 'Warehouse Ramintra') continue;

    const qty = parseInt(qtyRaw) || 0;
    if (qty <= 0) continue; // QTY=0 หมายถึงหมดแล้ว ไม่นับ

    const cleanItem = item.replace(/_7-11/g, '').replace(/_Air/g, '').trim();
    if (!summary[cleanItem]) summary[cleanItem] = { qty: 0, unit: unit || 'ชิ้น' };
    summary[cleanItem].qty += qty;
    if (unit) summary[cleanItem].unit = unit;
  }

  if (Object.keys(summary).length === 0) return 'ไม่พบข้อมูลใน Warehouse';
  return Object.entries(summary)
    .map(([name, d]) => `- ${name}: ${d.qty} ${d.unit}`)
    .join('\n');
}

async function askGroq(userMessage, inventoryText) {
  const prompt = `คุณคือ AI ผู้ช่วยตอบข้อมูล Warehouse Inventory ของ Plan B Media

กฎการตอบ:
- ข้อมูลด้านล่างคือสินค้า "สภาพดี + อยู่ใน Warehouse Ramintra" ที่มี QTY > 0 เท่านั้น
- ตอบจำนวนตามข้อมูลที่ให้มาเท่านั้น ห้ามเดา
- ตอบสั้น กระชับ ภาษาไทย
- ถ้าถามสินค้าที่ไม่มีในคลัง ให้บอกว่า "ขณะนี้ไม่มีในคลังครับ"
- ถ้าถามรวมหลายรายการ (เช่น จอ 37") ให้รวมยอดให้ด้วย

ข้อมูล Inventory พร้อมใช้ปัจจุบัน:
${inventoryText}

คำถาม: ${userMessage}`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data.choices[0].message.content;
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
      const reply = await askGroq(userMessage, inventoryText);
      console.log('Groq replied OK');
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
