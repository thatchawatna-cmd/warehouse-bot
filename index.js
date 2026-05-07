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

  const COL_ITEM = 2, COL_STATUS = 16, COL_QTY = 24, COL_UNIT = 26, COL_LOCATION = 31;
  const summary = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 32) continue;
    const item = cols[COL_ITEM];
    const status = cols[COL_STATUS];
    const qty = parseInt(cols[COL_QTY]) || 0;
    const unit = cols[COL_UNIT];
    const location = cols[COL_LOCATION];

    if (!item || item === 'รายการ') continue;
    if (status !== 'ดี') continue;
    if (location !== 'Warehouse Ramintra') continue;
    if (qty <= 0) continue;

    const clean = item.replace(/_7-11/g,'').replace(/_Air/g,'').replace(/\\/g,'').trim();
    if (!summary[clean]) summary[clean] = { qty: 0, unit: unit || 'ชิ้น' };
    summary[clean].qty += qty;
    if (unit) summary[clean].unit = unit;
  }
  return summary;
}

// ค้นหาด้วย keywords จากคำถาม
function searchInventory(summary, userMessage) {
  const msg = userMessage.toLowerCase()
    .replace(/เหลือ|เท่าไหร่|มีไหม|มีเท่าไหร่|มี|ของ|ใน|คลัง|โกดัง/g, ' ')
    .trim();

  // แยก keywords
  const keywords = msg.split(/\s+/).filter(k => k.length >= 1);

  const results = [];
  for (const [name, d] of Object.entries(summary)) {
    const nameLower = name.toLowerCase();
    // ถ้า keyword ใดๆ ตรงกับชื่อสินค้า
    const matched = keywords.some(kw => nameLower.includes(kw));
    if (matched) results.push(`${name}: ${d.qty} ${d.unit}`);
  }
  return results;
}

async function askGroq(userMessage, results) {
  let answer;

  if (results.length === 0) {
    answer = 'ขณะนี้ไม่มีในคลังครับ';
  } else if (results.length <= 5) {
    // ถ้าน้อยกว่า 5 รายการ ตอบตรงๆ เลยไม่ต้องผ่าน AI
    answer = `📦 สินค้าพร้อมใช้ใน Warehouse:\n${results.map(r => `• ${r}`).join('\n')}`;
  } else {
    // ถ้าเยอะให้ Groq สรุป แต่ส่งแค่ 20 รายการแรก
    const inventoryText = results.slice(0, 20).join(', ');
    const prompt = `สินค้าพร้อมใช้: ${inventoryText}\nคำถาม: ${userMessage}\nตอบสั้นๆ ภาษาไทย บอกชื่อและจำนวน`;

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], max_tokens: 200 },
      { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    answer = response.data.choices[0].message.content;
  }
  return answer;
}

async function replyToLine(replyToken, text) {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    { replyToken, messages: [{ type: 'text', text }] },
    { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  console.log('LINE reply status: 200');
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    console.log('User asked:', userMessage);
    try {
      const summary = await getInventory();
      const results = searchInventory(summary, userMessage);
      console.log('Found:', results.length, 'items');
      const reply = await askGroq(userMessage, results);
      await replyToLine(replyToken, reply);
    } catch (err) {
      const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
      console.log('ERROR:', errMsg);
      await replyToLine(replyToken, 'ขออภัยครับ เกิดข้อผิดพลาด').catch(() => {});
    }
  }
});

app.get('/', (req, res) => res.send('LINE Warehouse Bot is running ✅'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
