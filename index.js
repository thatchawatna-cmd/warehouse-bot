const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1ug-1X3TFwNXeobmcfoohRqqudTcuyYfiagxhoWtPJLg';
const SHEET_NAME = process.env.SHEET_NAME || 'Warehouse Airport&7-11 media';

// Keyword mapping — จอ = LFD, ลำโพง = ลำโพง, ฯลฯ
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
  { triggers: ['cb ', 'เบรกเกอร์', 'เซอร์กิต'], searchIn: ['CB '] },
  { triggers: ['rcbo'], searchIn: ['RCBO'] },
  { triggers: ['timer', 'ไทม์เมอร์'], searchIn: ['Timer'] },
  { triggers: ['ปลั๊ก', 'plug', 'รางปลั๊ก'], searchIn: ['ปลั๊ก', 'Plug', 'รางปลั๊ก'] },
  { triggers: ['ลำโพง', 'speaker'], searchIn: ['ลำโพง'] },
  { triggers: ['usb', 'ชาร์จ'], searchIn: ['USB'] },
  { triggers: ['โครง', 'แร็ค', 'rack', 'ขาเหล็ก'], searchIn: ['โครงสร้าง', 'ขาเหล็ก'] },
  { triggers: ['magnetic', 'แมกเนติก'], searchIn: ['Magnetic'] },
  { triggers: ['ไขควง'], searchIn: ['ไขควง'] },
  { triggers: ['คัตเตอร์'], searchIn: ['คัตเตอร์'] },
  { triggers: ['คลิปแอมป์'], searchIn: ['คลิปแอมป์'] },
  { triggers: ['บันได'], searchIn: ['บันได'] },
  { triggers: ['ไฟฉาย'], searchIn: ['ไฟฉาย'] },
  { triggers: ['คีม'], searchIn: ['คีม'] },
  { triggers: ['ผ้า', 'ไมโครไฟเบอร์', 'ชามัวร์'], searchIn: ['ผ้า'] },
  { triggers: ['ซิลิโคน'], searchIn: ['ซิลิโคน'] },
  { triggers: ['เทป', 'tape'], searchIn: ['เทป'] },
  { triggers: ['ฟิล์ม'], searchIn: ['ฟิล์ม'] },
  { triggers: ['ถุงขยะ', 'ถุงดำ'], searchIn: ['ถุงขยะ'] },
  { triggers: ['น้ำยา'], searchIn: ['น้ำยา'] },
  { triggers: ['ป้าย', 'ไวนิล', 'banner'], searchIn: ['ป้ายไวนิล'] },
  { triggers: ['กล่องเครื่องมือ'], searchIn: ['กล่องเครื่องมือ'] },
  { triggers: ['logo', 'โลโก้'], searchIn: ['Logo'] },
];

async function getInventory() {
  const encodedSheet = encodeURIComponent(SHEET_NAME);
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
  const response = await axios.get(url);
  const lines = response.data.split('\n');

  const COL_ITEM = 2, COL_PROJECT = 4, COL_STATUS = 16;
  const COL_QTY = 24, COL_UNIT = 26, COL_LOCATION = 31;

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

    let proj = 'อื่นๆ';
    if (project.includes('7') || project.toLowerCase().includes('eleven') || project.includes('7-11')) proj = '7-Eleven';
    else if (project.toLowerCase().includes('airport') || project.toLowerCase().includes('air')) proj = 'Airport';

    const clean = item.replace(/_7-11/g,'').replace(/_Air/g,'').replace(/\\/g,'').trim();
    if (!summary[proj]) summary[proj] = {};
    if (!summary[proj][clean]) summary[proj][clean] = { qty: 0, unit: unit || 'ชิ้น' };
    summary[proj][clean].qty += qty;
    if (unit) summary[proj][clean].unit = unit;
  }
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
    const stopwords = ['เหลือ','เท่าไหร่','มีไหม','มีเท่าไหร่','มี','ของ','ใน','คลัง','โกดัง','ครับ','ค่ะ','warehouse'];
    let cleaned = msgLower;
    stopwords.forEach(sw => cleaned = cleaned.replace(new RegExp(sw, 'g'), ' '));
    searchTerms = cleaned.split(/\s+/).filter(k => k.length >= 2);
  }

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

async function askGemini(userMessage, results) {
  // ถ้าไม่เจอเลย ตอบทันที
  if (Object.keys(results).length === 0) {
    return `ไม่พบ "${userMessage}" ในคลังครับ\n\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏`;
  }

  // สร้าง inventory text สั้นๆ
  let inventoryText = '';
  for (const [proj, items] of Object.entries(results)) {
    inventoryText += `Project ${proj}:\n`;
    items.forEach(i => { inventoryText += `- ${i.name}: ${i.qty} ${i.unit}\n`; });
  }

  const prompt = `คุณคือ AI ผู้ช่วยตอบข้อมูล Warehouse Inventory ของ Plan B Media
ข้อมูลที่ค้นพบจาก Warehouse:
${inventoryText}
คำถาม: "${userMessage}"

กฎ:
- ตอบสั้น กระชับ ภาษาไทย เป็นกันเอง
- แสดงผลแยกตาม Project
- ระบุชื่อสินค้าและจำนวนที่ชัดเจน
- ห้ามเดาหรือแต่งข้อมูลที่ไม่มีในข้อมูลที่ให้มา`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }] }
  );
  return response.data.candidates[0].content.parts[0].text;
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
      const reply = await askGemini(userMessage, results);
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
