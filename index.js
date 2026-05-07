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
    if (qty <= 0) continue;

    // ย่อชื่อ: ตัด _7-11, _Air ออก และตัด prefix ซ้ำๆ
    const cleanItem = item
      .replace(/_7-11/g, '').replace(/_Air/g, '')
      .replace(/\\_7-11/g, '').replace(/\\_Air/g, '')
      .trim();

    if (!summary[cleanItem]) summary[cleanItem] = { qty: 0, unit: unit || 'ชิ้น' };
    summary[cleanItem].qty += qty;
    if (unit) summary[cleanItem].unit = unit;
  }

  // แปลงเป็น text สั้นๆ เช่น "LFD HKC 37":5จอ, LFD Samsung 40":12จอ"
  return Object.entries(summary)
    .map(([name, d]) => `${name}:${d.qty}${d.unit}`)
    .join(', ');
}

async function askGroq(userMessage, inventoryText) {
  const prompt = `คุณคือ AI ช่วยตอบ Warehouse Inventory ของ Plan B Media
ข้อมูลด้านล่างคือสินค้าพร้อมใช้ (ดี + อยู่ใน Warehouse + QTY>0):
${inventoryText}

คำถาม: "${userMessage}"

วิธีตอบ:
- ค้นหารายการที่เกี่ยวข้องกับคำถาม เช่น ถามว่า "จอ 37" ให้หาทุกรายการที่มีคำว่า 37 และเป็นจอ
- ตอบสั้นๆ ภาษาไทย บอกชื่อย่อและจำนวน
- ถ้าถามหลายรายการให้ตอบทีละรายการ
- ถ้าไม่มีในคลังบอกว่า "ไม่มีในคลังครับ"`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200
    },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
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
      console.log('Inventory:', inventoryText.substring(0, 200));
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
