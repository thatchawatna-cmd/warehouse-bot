const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1ug-1X3TFwNXeobmcfoohRqqudTcuyYfiagxhoWtPJLg';
const SHEET_NAME = process.env.SHEET_NAME || 'Warehouse Airport&7-11 media';
const RENDER_URL = process.env.RENDER_URL || 'https://warehouse-bot-wdp3.onrender.com';

// Keep-alive ทุก 14 นาที
setInterval(async () => {
  try { await axios.get(`${RENDER_URL}/ping`); }
  catch (e) {}
}, 14 * 60 * 1000);

// Category ที่ไม่ต้องตอบ
const EXCLUDED_CATEGORIES = [
  'อุปกรณ์และเครื่องใช้สำนักงาน',
  'อุปกรณ์วัสดุสำนักงานใช้ไป',
  'อุปกรณ์วัสดุสิ้นเปลืองใช้ไป',
];

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  result.push(current.trim());
  return result;
}

async function getInventory() {
  const encodedSheet = encodeURIComponent(SHEET_NAME);
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
  const response = await axios.get(url);
  const lines = response.data.split('\n');

  const headers = parseCSVLine(lines[0]);
  let COL_ITEM = -1, COL_PROJECT = -1, COL_STATUS = -1;
  let COL_QTY = -1, COL_UNIT = -1, COL_LOCATION = -1, COL_CATEGORY = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (h.includes('รายการ') && COL_ITEM === -1) COL_ITEM = i;
    if (h === 'project' && COL_PROJECT === -1) COL_PROJECT = i;
    if (h === 'status' && COL_STATUS === -1) COL_STATUS = i;
    if (h === 'qty' && COL_QTY === -1) COL_QTY = i;
    if (h.includes('unit') && h.includes('ไทย') && COL_UNIT === -1) COL_UNIT = i;
    if (h === 'location name' && COL_LOCATION === -1) COL_LOCATION = i;
    if (h.includes('ประเภทของสินทรัพย์') && COL_CATEGORY === -1) COL_CATEGORY = i;
  }

  if (COL_ITEM === -1) COL_ITEM = 2;
  if (COL_PROJECT === -1) COL_PROJECT = 4;
  if (COL_STATUS === -1) COL_STATUS = 16;
  if (COL_QTY === -1) COL_QTY = 24;
  if (COL_UNIT === -1) COL_UNIT = 26;
  if (COL_LOCATION === -1) COL_LOCATION = 31;

  const summary = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i]);
    const maxCol = Math.max(COL_ITEM, COL_STATUS, COL_QTY, COL_LOCATION);
    if (cols.length < maxCol + 1) continue;

    const item     = cols[COL_ITEM] || '';
    const project  = cols[COL_PROJECT] || '';
    const status   = cols[COL_STATUS] || '';
    const qty      = parseInt(cols[COL_QTY]) || 0;
    const unit     = cols[COL_UNIT] || '';
    const location = cols[COL_LOCATION] || '';
    const category = COL_CATEGORY >= 0 ? (cols[COL_CATEGORY] || '') : '';

    if (!item || item === 'รายการ') continue;
    if (status !== 'ดี') continue;
    if (!location.includes('Warehouse')) continue;
    if (qty <= 0) continue;

    // ข้ามหมวดที่ไม่ต้องตอบ
    if (EXCLUDED_CATEGORIES.some(ex => category.includes(ex) || item.includes(ex))) continue;

    let proj = 'อื่นๆ';
    if (project.includes('7') || project.toLowerCase().includes('eleven')) proj = '7-Eleven';
    else if (project.toLowerCase().includes('airport') || project.toLowerCase().includes('air')) proj = 'Airport';

    const clean = item.replace(/_7-11/g,'').replace(/_Air/g,'').replace(/\\/g,'').trim();
    if (!summary[proj]) summary[proj] = {};
    if (!summary[proj][clean]) summary[proj][clean] = { qty: 0, unit: unit || 'ชิ้น' };
    summary[proj][clean].qty += qty;
    if (unit) summary[proj][clean].unit = unit;
  }
  return summary;
}

// สร้าง inventory text สั้นๆ สำหรับส่ง AI
function buildInventoryText(summary) {
  let text = '';
  for (const [proj, items] of Object.entries(summary)) {
    text += `[${proj}] `;
    text += Object.entries(items).map(([name, d]) => `${name}:${d.qty}${d.unit}`).join(', ');
    text += '\n';
  }
  return text;
}

async function askGroq(userMessage, inventoryText) {
  const prompt = `คุณคือ AI ผู้ช่วยตอบข้อมูล Warehouse Inventory ของ Plan B Media

ข้อมูลสินค้าพร้อมใช้ใน Warehouse (สภาพดี):
${inventoryText}

คำถาม: "${userMessage}"

กฎการตอบ:
1. ค้นหารายการที่เกี่ยวข้องกับคำถามจากข้อมูลที่ให้
2. ตอบสั้น กระชับ ภาษาไทย เป็นกันเอง
3. แสดงแยกตาม Project (7-Eleven / Airport)
4. ถ้าถามว่ามีอะไรบ้าง ให้แสดงรายการทั้งหมดที่เกี่ยวข้อง
5. ถ้าถามจำนวนทั้งหมด ให้รวมยอดทุก Project
6. ห้ามตอบหรือแสดงข้อมูลเกี่ยวกับ อุปกรณ์สำนักงาน หรือวัสดุสิ้นเปลืองสำนักงาน
7. ถ้าหาไม่เจอในข้อมูล ให้ตอบว่า "ไม่พบในคลังครับ รอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏"`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400
    },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
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
      const inventoryText = buildInventoryText(summary);
      console.log('Inventory built, sending to Groq...');
      const reply = await askGroq(userMessage, inventoryText);
      await replyToLine(replyToken, reply);
    } catch (err) {
      const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
      console.log('ERROR:', errMsg);
      await replyToLine(replyToken, 'ขออภัยครับ เกิดข้อผิดพลาด\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏').catch(() => {});
    }
  }
});

app.get('/', (req, res) => res.send('LINE Warehouse Bot is running ✅'));
app.get('/ping', (req, res) => res.send('pong'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
