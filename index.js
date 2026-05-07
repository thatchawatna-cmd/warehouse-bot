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

  const COL_ITEM = 2, COL_PROJECT = 4, COL_STATUS = 16;
  const COL_QTY = 24, COL_UNIT = 26, COL_LOCATION = 31;

  // summary[project][item] = { qty, unit }
  const summary = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 32) continue;
    const item     = cols[COL_ITEM];
    const project  = cols[COL_PROJECT];
    const status   = cols[COL_STATUS];
    const qty      = parseInt(cols[COL_QTY]) || 0;
    const unit     = cols[COL_UNIT];
    const location = cols[COL_LOCATION];

    if (!item || item === 'รายการ') continue;
    if (status !== 'ดี') continue;
    if (location !== 'Warehouse Ramintra') continue;
    if (qty <= 0) continue;

    // normalize project name
    let proj = 'อื่นๆ';
    if (project.includes('7') || project.includes('Eleven') || project.toLowerCase().includes('7-11')) proj = '7-Eleven';
    else if (project.toLowerCase().includes('airport') || project.toLowerCase().includes('air')) proj = 'Airport';

    // clean item name
    const clean = item.replace(/_7-11/g,'').replace(/_Air/g,'').replace(/\\/g,'').trim();

    if (!summary[proj]) summary[proj] = {};
    if (!summary[proj][clean]) summary[proj][clean] = { qty: 0, unit: unit || 'ชิ้น' };
    summary[proj][clean].qty += qty;
    if (unit) summary[proj][clean].unit = unit;
  }
  return summary;
}

// Fuzzy search — ตรวจสอบว่า keyword ใน query ตรงกับชื่อสินค้าไหม
function fuzzyMatch(name, query) {
  const nameLower = name.toLowerCase();
  const queryLower = query.toLowerCase();

  // ตัดคำทั่วไปออก
  const stopwords = ['เหลือ','เท่าไหร่','มีไหม','มีเท่าไหร่','มี','ของ','ใน','คลัง','โกดัง','warehouse','อยู่','เท่า','ไหร่','ครับ','ค่ะ'];
  let cleaned = queryLower;
  stopwords.forEach(sw => cleaned = cleaned.replace(new RegExp(sw, 'g'), ' '));

  const keywords = cleaned.split(/\s+/).filter(k => k.length >= 2);
  return keywords.some(kw => nameLower.includes(kw));
}

function searchInventory(summary, userMessage) {
  const results = {}; // { project: [{name, qty, unit}] }

  for (const [proj, items] of Object.entries(summary)) {
    for (const [name, d] of Object.entries(items)) {
      if (fuzzyMatch(name, userMessage)) {
        if (!results[proj]) results[proj] = [];
        results[proj].push({ name, qty: d.qty, unit: d.unit });
      }
    }
  }
  return results;
}

function formatReply(results, userMessage) {
  const projects = Object.keys(results);
  if (projects.length === 0) {
    return `ไม่พบรายการที่ตรงกับ "${userMessage}" ในคลังครับ\n\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏`;
  }

  let reply = `📦 สินค้าพร้อมใช้ใน Warehouse:\n`;
  for (const proj of projects) {
    reply += `\n🏷 Project: ${proj}\n`;
    for (const item of results[proj]) {
      reply += `• ${item.name}: ${item.qty} ${item.unit}\n`;
    }
  }
  return reply.trim();
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
      console.log('Found projects:', Object.keys(results));
      const reply = formatReply(results, userMessage);
      await replyToLine(replyToken, reply);
    } catch (err) {
      const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
      console.log('ERROR:', errMsg);
      await replyToLine(replyToken, 'ขออภัยครับ เกิดข้อผิดพลาด\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏').catch(() => {});
    }
  }
});

app.get('/', (req, res) => res.send('LINE Warehouse Bot is running ✅'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
