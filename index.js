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
  try { await axios.get(`${RENDER_URL}/ping`); console.log('ping ok'); }
  catch (e) { console.log('ping failed'); }
}, 14 * 60 * 1000);

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

const KEYWORD_MAP = [
  { triggers: ['จอ 37', '37"', '37นิ้ว', '37 นิ้ว'], searchIn: ['LFD', '37'] },
  { triggers: ['จอ 40', '40"', '40นิ้ว', '40 นิ้ว'], searchIn: ['LFD', '40'] },
  { triggers: ['จอ 43', '43"', '43นิ้ว', '43 นิ้ว'], searchIn: ['LFD', '43'] },
  { triggers: ['จอ 46', '46"', '46นิ้ว', '46 นิ้ว'], searchIn: ['LFD', '46'] },
  { triggers: ['จอ 55', '55"', '55นิ้ว', '55 นิ้ว'], searchIn: ['LFD', '55'] },
  { triggers: ['จอ hkc', 'hkc'], searchIn: ['LFD HKC'] },
  { triggers: ['จอ samsung', 'samsung', 'ซัมซุง'], searchIn: ['LFD Samsung'] },
  { triggers: ['จอ'], searchIn: ['LFD'] },
  { triggers: ['player', 'media player', 'เพลเยอร์'], searchIn: ['Player'] },
  { triggers: ['cb ', 'เบรกเกอร์'], searchIn: ['CB '] },
  { triggers: ['rcbo'], searchIn: ['RCBO'] },
  { triggers: ['ปลั๊ก', 'plug'], searchIn: ['ปลั๊ก', 'Plug'] },
  { triggers: ['ลำโพง', 'speaker'], searchIn: ['ลำโพง'] },
  { triggers: ['โครง', 'ขาเหล็ก'], searchIn: ['โครงสร้าง', 'ขาเหล็ก'] },
  { triggers: ['ไขควง'], searchIn: ['ไขควง'] },
  { triggers: ['คัตเตอร์'], searchIn: ['คัตเตอร์'] },
  { triggers: ['บันได'], searchIn: ['บันได'] },
  { triggers: ['ไฟฉาย'], searchIn: ['ไฟฉาย'] },
  { triggers: ['ผ้า', 'ไมโครไฟเบอร์', 'ชามัวร์'], searchIn: ['ผ้า'] },
  { triggers: ['ซิลิโคน'], searchIn: ['ซิลิโคน'] },
  { triggers: ['เทป'], searchIn: ['เทป'] },
  { triggers: ['ฟิล์ม'], searchIn: ['ฟิล์ม'] },
  { triggers: ['น้ำยา'], searchIn: ['น้ำยา'] },
  { triggers: ['ป้าย', 'ไวนิล'], searchIn: ['ป้ายไวนิล'] },
  { triggers: ['logo', 'โลโก้'], searchIn: ['Logo'] },
];

async function getInventory() {
  const encodedSheet = encodeURIComponent(SHEET_NAME);
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
  const response = await axios.get(url);
  const lines = response.data.split('\n');

  const headers = parseCSVLine(lines[0]);
  let COL_ITEM = -1, COL_PROJECT = -1, COL_STATUS = -1;
  let COL_QTY = -1, COL_UNIT = -1, COL_LOCATION = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (h.includes('รายการ') && COL_ITEM === -1) COL_ITEM = i;
    if (h === 'project' && COL_PROJECT === -1) COL_PROJECT = i;
    if (h === 'status' && COL_STATUS === -1) COL_STATUS = i;
    if (h === 'qty' && COL_QTY === -1) COL_QTY = i;
    if (h.includes('unit') && h.includes('ไทย') && COL_UNIT === -1) COL_UNIT = i;
    if (h === 'location name' && COL_LOCATION === -1) COL_LOCATION = i;
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

    if (!item || item === 'รายการ') continue;
    if (status !== 'ดี') continue;
    if (!location.includes('Warehouse')) continue;
    if (qty <= 0) continue;

    let proj = 'อื่นๆ';
    if (project.includes('7') || project.toLowerCase().includes('eleven')) proj = '7-Eleven';
    else if (project.toLowerCase().includes('airport') || project.toLowerCase().includes('air')) proj = 'Airport';

    const clean = item.replace(/_7-11/g,'').replace(/_Air/g,'').replace(/\\/g,'').trim();
    if (!summary[proj]) summary[proj] = {};
    if (!summary[proj][clean]) summary[proj][clean] = { qty: 0, unit: unit || 'ชิ้น' };
    summary[proj][clean].qty += qty;
    if (unit) summary[proj][clean].unit = unit;
  }

  console.log(`Projects found: ${Object.keys(summary)}`);
  return summary;
}

function smartSearch(summary, userMessage) {
  const msgLower = userMessage.toLowerCase();
  let searchTerms = [];

  for (const mapping of KEYWORD_MAP) {
    const matched = mapping.triggers.some(t => msgLower.includes(t.toLowerCase()));
    if (matched) { searchTerms = mapping.searchIn; break; }
  }

  if (searchTerms.length === 0) {
    const stopwords = ['เหลือ','เท่าไหร่','มีไหม','มีเท่าไหร่','มี','ของ','ใน','คลัง','โกดัง','ครับ','ค่ะ'];
    let cleaned = msgLower;
    stopwords.forEach(sw => cleaned = cleaned.replace(new RegExp(sw, 'g'), ' '));
    searchTerms = cleaned.split(/\s+/).filter(k => k.length >= 2);
  }

  console.log('Search terms:', searchTerms);

  const results = {};
  for (const [proj, items] of Object.entries(summary)) {
    for (const [name, d] of Object.entries(items)) {
      const nameLower = name.toLowerCase();
      const matched = searchTerms.every(term => nameLower.includes(term.toLowerCase()));
      if (matched) {
        if (!results[proj]) results[proj] = [];
        results[proj].push({ name, qty: d.qty, unit: d.unit });
      }
    }
  }
  return results;
}

function formatReply(userMessage, results) {
  // ถ้าไม่เจอ
  if (Object.keys(results).length === 0) {
    return `ไม่พบ "${userMessage}" ในคลังครับ\n\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏`;
  }

  // ตอบตรงๆ โดยไม่ผ่าน AI — เร็ว แม่นยำ ฟรี
  let reply = `📦 สินค้าพร้อมใช้ใน Warehouse:\n`;
  for (const [proj, items] of Object.entries(results)) {
    reply += `\n🏷 Project: ${proj}\n`;
    for (const item of items) {
      // ทำชื่อสวยขึ้น
      const name = item.name
        .replace(/LFD /g, '')
        .replace(/"/g, '"')
        .trim();
      reply += `• ${name}: ${item.qty} ${item.unit}\n`;
    }
  }

  // รวมยอดถ้ามีหลาย project
  const allItems = Object.values(results).flat();
  if (allItems.length > 1 && Object.keys(results).length > 1) {
    const total = allItems.reduce((sum, i) => sum + i.qty, 0);
    reply += `\n📊 รวมทั้งหมด: ${total} ${allItems[0].unit}`;
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
      const results = smartSearch(summary, userMessage);
      console.log('Found:', Object.keys(results));
      const reply = formatReply(userMessage, results);
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
