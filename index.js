const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1ug-1X3TFwNXeobmcfoohRqqudTcuyYfiagxhoWtPJLg';
const SHEET_NAME = process.env.SHEET_NAME || 'Warehouse Airport&7-11 media';
const RENDER_URL = process.env.RENDER_URL || 'https://warehouse-bot-wdp3.onrender.com';

// ============================================================
// KEEP-ALIVE
// ============================================================
setInterval(async () => {
  try { await axios.get(`${RENDER_URL}/ping`); } catch (e) {}
}, 14 * 60 * 1000);

// ============================================================
// CONSTANTS
// ============================================================
const EXCLUDED_KEYWORDS = [
  'อุปกรณ์และเครื่องใช้สำนักงาน','อุปกรณ์วัสดุสำนักงานใช้ไป',
  'อุปกรณ์วัสดุสิ้นเปลืองใช้ไป','วัสดุสิ้นเปลือง','เครื่องใช้สำนักงาน',
];

const GREETINGS    = ['สวัสดี','หวัดดี','hello','hi','ดีจ้า','ดีครับ','ดีค่ะ','เฮ้','hey','ดีนะ','ดีด้วย'];
const THANKS       = ['ขอบคุณ','ขอบใจ','thanks','thank you','thx','ขอบคุณมาก','ขอบใจมาก','โอเค ขอบคุณ'];
const HELP         = ['ช่วยอะไรได้บ้าง','ทำอะไรได้บ้าง','ใช้งานยังไง','help','วิธีใช้','ถามอะไรได้บ้าง'];
const OUT_OF_SCOPE = ['ราคา','price','ค่าใช้จ่าย','กินอะไร','อากาศ','ข่าว','weather','เที่ยว','หวย','ดูดวง'];
const SUMMARY_KEYWORDS = [
  'sku','กี่ sku','กี่รายการ','มีกี่ชนิด','มีกี่ประเภท',
  'ของในโกดังทั้งหมด','สินค้าทั้งหมด','ทั้งหมดกี่','มีทั้งหมด','รวมทั้งหมด',
  'มีอะไรบ้างทั้งหมด','สรุปสินค้า'
];

// Stopwords — ตัดออกก่อน search
const STOPWORDS = [
  'มีเท่าไหร่','เท่าไหร่','มีไหม','เหลือไหม','เหลือเท่าไหร่','มีของ',
  'เหลือ','มี','ของ','ใน','คลัง','โกดัง','ครับ','ค่ะ','นะ','warehouse',
  'อยู่','ตอนนี้','ล่าสุด','บ้าง','หน่อย','ด้วย','เลย'
];

// Alias Map — คำที่ user พิมพ์ → keyword ที่ใช้ search ใน sheet
const ALIAS_MAP = [
  // จอ
  { aliases: ['จอ','monitor','screen','display','lfd'], searchFor: 'lfd' },
  { aliases: ['จอ 37','37"','37 นิ้ว','37นิ้ว'], searchFor: ['lfd','37'] },
  { aliases: ['จอ 40','40"','40 นิ้ว','40นิ้ว'], searchFor: ['lfd','40'] },
  { aliases: ['จอ 43','43"','43 นิ้ว','43นิ้ว'], searchFor: ['lfd','43'] },
  { aliases: ['จอ 46','46"','46 นิ้ว','46นิ้ว'], searchFor: ['lfd','46'] },
  { aliases: ['จอ 55','55"','55 นิ้ว','55นิ้ว'], searchFor: ['lfd','55'] },
  { aliases: ['hkc','จอ hkc'], searchFor: ['lfd','hkc'] },
  { aliases: ['samsung','ซัมซุง','จอ samsung'], searchFor: ['lfd','samsung'] },
  // Timer
  { aliases: ['timer','ไทเมอร์','ไทม์เมอร์','time relay','เวลา'], searchFor: 'timer' },
  // Magnetic
  { aliases: ['magnetic','แมกเนติก','แมก','contactor'], searchFor: 'magnetic' },
  // CB
  { aliases: ['cb','เบรกเกอร์','circuit breaker','เซอร์กิต'], searchFor: 'cb ' },
  // RCBO
  { aliases: ['rcbo','rcd','กันดูด'], searchFor: 'rcbo' },
  // Bracket / โครงสร้าง
  { aliases: ['bracket','ขาจอ','ขาแขวน','โครง','rack','แร็ค','ขาเหล็ก'], searchFor: ['โครงสร้าง','bracket','ขาเหล็ก'] },
  // ลำโพง
  { aliases: ['ลำโพง','speaker','audio','เสียง'], searchFor: 'ลำโพง' },
  // Media Player
  { aliases: ['player','media player','เพลเยอร์','เครื่องเล่น'], searchFor: 'player' },
  // ปลั๊ก
  { aliases: ['ปลั๊ก','plug','รางปลั๊ก','ราง'], searchFor: 'ปลั๊ก' },
  // ผ้า
  { aliases: ['ผ้า','ไมโครไฟเบอร์','microfiber','ชามัวร์','ผ้าเช็ด'], searchFor: 'ผ้า' },
  // น้ำยา
  { aliases: ['น้ำยา','spray','สเปรย์','sc100'], searchFor: 'น้ำยา' },
  // ซิลิโคน
  { aliases: ['ซิลิโคน','silicone'], searchFor: 'ซิลิโคน' },
  // เทป
  { aliases: ['เทป','tape'], searchFor: 'เทป' },
  // ฟิล์ม
  { aliases: ['ฟิล์ม','film'], searchFor: 'ฟิล์ม' },
  // ไขควง
  { aliases: ['ไขควง','screwdriver'], searchFor: 'ไขควง' },
  // คัตเตอร์
  { aliases: ['คัตเตอร์','cutter'], searchFor: 'คัตเตอร์' },
  // บันได
  { aliases: ['บันได','ladder'], searchFor: 'บันได' },
  // ไฟฉาย
  { aliases: ['ไฟฉาย','flashlight','torch'], searchFor: 'ไฟฉาย' },
  // คีม
  { aliases: ['คีม','plier'], searchFor: 'คีม' },
  // กล่องเครื่องมือ
  { aliases: ['กล่องเครื่องมือ','toolbox'], searchFor: 'กล่องเครื่องมือ' },
  // ป้าย
  { aliases: ['ป้าย','ไวนิล','vinyl','banner'], searchFor: 'ป้ายไวนิล' },
  // Logo
  { aliases: ['logo','โลโก้'], searchFor: 'logo' },
  // ถุงขยะ
  { aliases: ['ถุงขยะ','ถุงดำ'], searchFor: 'ถุงขยะ' },
];

// ============================================================
// EMOJI HELPERS
// ============================================================
function getItemEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes('lfd') || n.includes('จอ')) return '📺';
  if (n.includes('ลำโพง') || n.includes('speaker')) return '🔊';
  if (n.includes('player') || n.includes('media')) return '🎬';
  if (n.includes('magnetic') || n.includes('timer') || n.includes('cb ') || n.includes('rcbo') || n.includes('ปลั๊ก') || n.includes('plug') || n.includes('ไฟฟ้า')) return '🔌';
  if (n.includes('ไขควง') || n.includes('คีม') || n.includes('คัตเตอร์') || n.includes('บันได') || n.includes('ไฟฉาย') || n.includes('เครื่องมือ')) return '🔧';
  if (n.includes('ผ้า') || n.includes('น้ำยา') || n.includes('ซิลิโคน') || n.includes('เทป') || n.includes('ฟิล์ม')) return '🧴';
  if (n.includes('โครงสร้าง') || n.includes('ขาเหล็ก') || n.includes('bracket') || n.includes('rack')) return '🔩';
  if (n.includes('ป้าย') || n.includes('ไวนิล') || n.includes('logo')) return '🪧';
  return '📦';
}

function getProjEmoji(proj) {
  if (proj === '7-Eleven') return '🏪';
  if (proj === 'Airport') return '✈️';
  return '🏭';
}

function getHeaderEmoji(searchTerms) {
  const s = searchTerms.join(' ').toLowerCase();
  if (s.includes('lfd') || s.includes('จอ')) return '📺';
  if (s.includes('ลำโพง')) return '🔊';
  if (s.includes('player')) return '🎬';
  if (s.includes('timer') || s.includes('magnetic') || s.includes('cb') || s.includes('rcbo') || s.includes('ปลั๊ก')) return '🔌';
  if (s.includes('ไขควง') || s.includes('คัตเตอร์') || s.includes('บันได')) return '🔧';
  if (s.includes('ผ้า') || s.includes('น้ำยา')) return '🧴';
  if (s.includes('โครงสร้าง') || s.includes('bracket')) return '🔩';
  return '📦';
}

// ============================================================
// CSV PARSER
// ============================================================
function parseCSVLine(line) {
  const result = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  result.push(current.trim());
  return result;
}

// ============================================================
// SHEET DATA
// ============================================================
async function getSheetData() {
  const encodedSheet = encodeURIComponent(SHEET_NAME);
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
  const response = await axios.get(url);
  const lines = response.data.split('\n');
  const headers = parseCSVLine(lines[0]);

  let COL_ITEM=-1,COL_PROJECT=-1,COL_STATUS=-1,COL_QTY=-1,COL_UNIT=-1,COL_LOCATION=-1,COL_TYPE=-1;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (h.includes('รายการ') && COL_ITEM===-1) COL_ITEM=i;
    if (h==='project' && COL_PROJECT===-1) COL_PROJECT=i;
    if (h==='status' && COL_STATUS===-1) COL_STATUS=i;
    if (h==='qty' && COL_QTY===-1) COL_QTY=i;
    if (h.includes('unit')&&h.includes('ไทย')&&COL_UNIT===-1) COL_UNIT=i;
    if (h==='location name' && COL_LOCATION===-1) COL_LOCATION=i;
    if (h.includes('ประเภทของสินทรัพย์')&&COL_TYPE===-1) COL_TYPE=i;
  }
  if (COL_ITEM===-1) COL_ITEM=2;
  if (COL_PROJECT===-1) COL_PROJECT=4;
  if (COL_STATUS===-1) COL_STATUS=16;
  if (COL_QTY===-1) COL_QTY=24;
  if (COL_UNIT===-1) COL_UNIT=26;
  if (COL_LOCATION===-1) COL_LOCATION=31;

  return { lines, cols: { COL_ITEM,COL_PROJECT,COL_STATUS,COL_QTY,COL_UNIT,COL_LOCATION,COL_TYPE } };
}

async function getInventoryGood() {
  const { lines, cols } = await getSheetData();
  const { COL_ITEM,COL_PROJECT,COL_STATUS,COL_QTY,COL_UNIT,COL_LOCATION,COL_TYPE } = cols;
  const summary = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVLine(lines[i]);
    if (row.length < Math.max(COL_ITEM,COL_STATUS,COL_QTY,COL_LOCATION)+1) continue;
    const item=row[COL_ITEM]||'', project=row[COL_PROJECT]||'', status=row[COL_STATUS]||'';
    const qty=parseInt(row[COL_QTY])||0, unit=row[COL_UNIT]||'', location=row[COL_LOCATION]||'';
    const type=COL_TYPE>=0?(row[COL_TYPE]||''):'';
    if (!item||item==='รายการ') continue;
    if (status!=='ดี') continue;
    if (!location.includes('Warehouse')) continue;
    if (qty<=0) continue;
    if (EXCLUDED_KEYWORDS.some(kw=>type.includes(kw)||item.includes(kw))) continue;
    let proj='อื่นๆ';
    if (project.includes('7')||project.toLowerCase().includes('eleven')) proj='7-Eleven';
    else if (project.toLowerCase().includes('airport')||project.toLowerCase().includes('air')) proj='Airport';
    const clean=item.replace(/_7-11/g,'').replace(/_Air/g,'').replace(/\\/g,'').trim();
    if (!summary[proj]) summary[proj]={};
    if (!summary[proj][clean]) summary[proj][clean]={qty:0,unit:unit||'ชิ้น'};
    summary[proj][clean].qty+=qty;
    if (unit) summary[proj][clean].unit=unit;
  }
  return summary;
}

async function getInventoryAll() {
  const { lines, cols } = await getSheetData();
  const { COL_ITEM,COL_PROJECT,COL_STATUS,COL_QTY,COL_UNIT,COL_LOCATION,COL_TYPE } = cols;
  const summary = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVLine(lines[i]);
    if (row.length < Math.max(COL_ITEM,COL_STATUS,COL_QTY,COL_LOCATION)+1) continue;
    const item=row[COL_ITEM]||'', project=row[COL_PROJECT]||'', status=row[COL_STATUS]||'';
    const qty=parseInt(row[COL_QTY])||0, unit=row[COL_UNIT]||'', location=row[COL_LOCATION]||'';
    const type=COL_TYPE>=0?(row[COL_TYPE]||''):'';
    if (!item||item==='รายการ') continue;
    if (!location.includes('Warehouse')) continue;
    if (EXCLUDED_KEYWORDS.some(kw=>type.includes(kw)||item.includes(kw))) continue;
    let proj='อื่นๆ';
    if (project.includes('7')||project.toLowerCase().includes('eleven')) proj='7-Eleven';
    else if (project.toLowerCase().includes('airport')||project.toLowerCase().includes('air')) proj='Airport';
    const clean=item.replace(/_7-11/g,'').replace(/_Air/g,'').replace(/\\/g,'').trim();
    if (!summary[proj]) summary[proj]={};
    if (!summary[proj][clean]) summary[proj][clean]={totalQty:0,goodQty:0,unit:unit||'ชิ้น'};
    summary[proj][clean].totalQty+=qty;
    if (status==='ดี') summary[proj][clean].goodQty+=qty;
    if (unit) summary[proj][clean].unit=unit;
  }
  return summary;
}

// ============================================================
// SMART SEARCH — เพิ่ม alias + stopword filter
// ============================================================
function extractSearchTerms(userMessage) {
  const msgLower = userMessage.toLowerCase();

  // ① ลอง match alias ก่อน (priority สูงสุด)
  for (const alias of ALIAS_MAP) {
    const matched = alias.aliases.some(a => msgLower.includes(a.toLowerCase()));
    if (matched) {
      const terms = Array.isArray(alias.searchFor) ? alias.searchFor : [alias.searchFor];
      return { terms, matched: true };
    }
  }

  // ② ไม่เจอ alias — ใช้ keyword จากข้อความ หลังตัด stopwords ออก
  let cleaned = msgLower;
  STOPWORDS.forEach(sw => {
    cleaned = cleaned.replace(new RegExp(sw, 'g'), ' ');
  });
  const terms = cleaned.split(/\s+/).filter(k => k.length >= 2);
  return { terms, matched: false };
}

function searchInventory(summary, userMessage) {
  const { terms } = extractSearchTerms(userMessage);
  if (terms.length === 0) return {};

  const results = {};
  for (const [proj, items] of Object.entries(summary)) {
    for (const [name, d] of Object.entries(items)) {
      const nameLower = name.toLowerCase();
      // OR match — ถ้ามี keyword ใดๆ ตรง ก็แสดง
      const matched = terms.some(term => nameLower.includes(term.toLowerCase()));
      if (matched) {
        if (!results[proj]) results[proj] = [];
        results[proj].push({ name, qty: d.qty, unit: d.unit });
      }
    }
  }
  return results;
}

// ============================================================
// FORMAT REPLY
// ============================================================
function formatInventoryReply(userMessage, results) {
  if (Object.keys(results).length === 0) return null;

  const { terms } = extractSearchTerms(userMessage);
  const headerEmoji = getHeaderEmoji(terms);

  // หัวข้อจาก keyword หลัก
  const mainTerm = terms[0] ? terms[0].charAt(0).toUpperCase() + terms[0].slice(1) : userMessage;

  let reply = `${headerEmoji} ${mainTerm}\n`;

  let grandTotal = 0;
  let grandUnit = '';
  const projCount = Object.keys(results).length;

  for (const [proj, items] of Object.entries(results)) {
    const projEmoji = getProjEmoji(proj);
    reply += `\n${projEmoji} ${proj}\n`;

    let projTotal = 0;
    for (const item of items) {
      const itemEmoji = getItemEmoji(item.name);
      const shortName = item.name
        .replace(/LFD /gi,'').replace(/"/g,'"').replace(/\\/g,'').trim();
      reply += `${itemEmoji} ${shortName}: ${item.qty} ${item.unit}\n`;
      projTotal += item.qty;
      grandTotal += item.qty;
      if (!grandUnit && item.unit) grandUnit = item.unit;
    }
    if (items.length > 1) {
      reply += `   └ รวม ${proj}: ${projTotal} ${grandUnit}\n`;
    }
  }

  if (projCount > 1 || Object.values(results)[0].length > 1) {
    reply += `\n📊 รวมทั้งหมด: ${grandTotal} ${grandUnit}`;
  }

  return reply.trim();
}

// ============================================================
// GROQ FALLBACK (ส่งเฉพาะข้อมูลที่กรองแล้ว)
// ============================================================
async function askGroqFallback(userMessage, filteredResults) {
  let inventoryText = '';
  for (const [proj, items] of Object.entries(filteredResults)) {
    inventoryText += `[${proj}]\n`;
    items.forEach(i => { inventoryText += `${i.name}: ${i.qty} ${i.unit}\n`; });
    inventoryText += '\n';
  }

  const prompt = `คุณคือ Warehouse Inventory Bot ของ Plan B Media

สินค้าที่พบ (สภาพดี):
${inventoryText}

คำถาม: "${userMessage}"

ตอบตามรูปแบบนี้:
[emoji] [หัวข้อ]

[emoji project] [Project]
[emoji] [รายการ]: [จำนวน] [หน่วย]
   └ รวม [Project]: [รวม] [หน่วย]

📊 รวมทั้งหมด: [รวม] [หน่วย]

emoji: 7-Eleven=🏪, Airport=✈️, จอ=📺, ลำโพง=🔊, ไฟฟ้า=🔌, เครื่องมือ=🔧, ผ้า=🧴, โครง=🔩, อื่นๆ=📦
ห้ามใช้ ** หรือ markdown ตอบสั้น กระชับ ภาษาไทย`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400, temperature: 0.2
    },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}

// ============================================================
// SUMMARY REPORT
// ============================================================
function buildSummaryReport(summary) {
  let totalSKU=0, totalQty=0, totalGood=0;
  let report = '📦 สรุปสินค้าใน Warehouse Ramintra\n─────────────────────\n';
  for (const [proj, items] of Object.entries(summary)) {
    const sku=Object.keys(items).length;
    const qty=Object.values(items).reduce((s,d)=>s+d.totalQty,0);
    const good=Object.values(items).reduce((s,d)=>s+d.goodQty,0);
    totalSKU+=sku; totalQty+=qty; totalGood+=good;
    report += `\n${getProjEmoji(proj)} ${proj}\n`;
    report += `  SKU: ${sku.toLocaleString()} รายการ\n`;
    report += `  จำนวนทั้งหมด: ${qty.toLocaleString()} ชิ้น\n`;
    report += `  พร้อมใช้ (ดี): ${good.toLocaleString()} ชิ้น\n`;
  }
  report += `\n─────────────────────\n📊 รวมทั้งหมด\n`;
  report += `  SKU: ${totalSKU.toLocaleString()} รายการ\n`;
  report += `  จำนวนทั้งหมด: ${totalQty.toLocaleString()} ชิ้น\n`;
  report += `  พร้อมใช้ (ดี): ${totalGood.toLocaleString()} ชิ้น`;
  return report;
}

// ============================================================
// MESSAGE CLASSIFIER
// ============================================================
function classifyMessage(msg) {
  const m = msg.toLowerCase().trim();
  if (/^\d+$/.test(m)) return 'number_only';
  if (GREETINGS.some(g=>m.includes(g))) return 'greeting';
  if (THANKS.some(t=>m.includes(t))) return 'thanks';
  if (HELP.some(h=>m.includes(h))) return 'help';
  if (OUT_OF_SCOPE.some(o=>m.includes(o))) return 'out_of_scope';
  if (SUMMARY_KEYWORDS.some(k=>m.includes(k))) return 'summary';
  return 'inventory_query';
}

// ============================================================
// LINE REPLY
// ============================================================
async function replyToLine(replyToken, text) {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    { replyToken, messages: [{ type: 'text', text }] },
    { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  console.log('LINE reply status: 200');
}

// ============================================================
// WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== 'message') continue;
    const replyToken = event.replyToken;

    if (event.message.type !== 'text') {
      await replyToLine(replyToken,
        'ขออภัยครับ รองรับเฉพาะข้อความเท่านั้น\nลองพิมพ์ถามได้เลยครับ เช่น "Timer มีเท่าไหร่"'
      ).catch(()=>{});
      continue;
    }

    const userMessage = event.message.text.trim();
    if (!userMessage) continue;
    console.log('User asked:', userMessage);

    const msgType = classifyMessage(userMessage);

    // Static responses
    if (msgType === 'greeting') {
      await replyToLine(replyToken,
        'สวัสดีครับ 👋\nผมคือระบบตรวจสอบสินค้าใน Warehouse Ramintra ครับ\n\nพิมพ์ถามได้เลย เช่น\n📺 "จอ 37 มีเท่าไหร่"\n🔌 "Timer มีเท่าไหร่"\n🔌 "Magnetic เหลือเท่าไหร่"\n🧴 "ผ้าไมโครไฟเบอร์เหลือไหม"\n📊 "สินค้าทั้งหมดมีกี่ SKU"'
      ).catch(()=>{});
      continue;
    }
    if (msgType === 'thanks') {
      await replyToLine(replyToken, 'ยินดีครับ 😊 มีอะไรอยากถามเพิ่มเติมได้เลยนะครับ').catch(()=>{});
      continue;
    }
    if (msgType === 'help') {
      await replyToLine(replyToken,
        '📦 ผมช่วยตรวจสอบสินค้าใน Warehouse ได้ครับ\n\nตัวอย่างคำถาม:\n📺 จอ 46 มีเท่าไหร่\n🔌 Timer มีเท่าไหร่\n🔌 Magnetic เหลือกี่ตัว\n🔊 ลำโพงเหลือเยอะไหม\n🧴 ผ้าไมโครไฟเบอร์มีไหม\n📊 สินค้าทั้งหมดมีกี่ SKU'
      ).catch(()=>{});
      continue;
    }
    if (msgType === 'out_of_scope') {
      await replyToLine(replyToken,
        'ขออภัยครับ ผมตอบได้เฉพาะข้อมูลสินค้าใน Warehouse เท่านั้นครับ 😊'
      ).catch(()=>{});
      continue;
    }

    try {
      // Summary report
      if (msgType === 'summary') {
        const summaryAll = await getInventoryAll();
        await replyToLine(replyToken, buildSummaryReport(summaryAll));
        continue;
      }

      // ตัวเลขอย่างเดียว → ถามจอ
      let finalMessage = userMessage;
      if (msgType === 'number_only') {
        finalMessage = `จอ ${userMessage} นิ้ว มีเท่าไหร่`;
      }

      // ดึง inventory + search
      const summaryGood = await getInventoryGood();
      const filtered = searchInventory(summaryGood, finalMessage);

      if (Object.keys(filtered).length === 0) {
        await replyToLine(replyToken,
          `🔍 ไม่พบ "${userMessage}" ในคลังครับ\n\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏`
        );
        continue;
      }

      // Format ตอบตรง — ไม่ผ่าน Groq
      const directReply = formatInventoryReply(finalMessage, filtered);
      if (directReply) {
        await replyToLine(replyToken, directReply);
        continue;
      }

      // Fallback Groq (เฉพาะกรณีพิเศษ)
      const groqReply = await askGroqFallback(finalMessage, filtered);
      await replyToLine(replyToken, groqReply);

    } catch (err) {
      const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
      console.log('ERROR:', errMsg);
      await replyToLine(replyToken,
        'ขออภัยครับ เกิดข้อผิดพลาด\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏'
      ).catch(()=>{});
    }
  }
});

app.get('/', (req, res) => res.send('LINE Warehouse Bot is running ✅'));
app.get('/ping', (req, res) => res.send('pong'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
