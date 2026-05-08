const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1ug-1X3TFwNXeobmcfoohRqqudTcuyYfiagxhoWtPJLg';
const SHEET_NAME = process.env.SHEET_NAME || 'Warehouse Airport&7-11 media';
const RENDER_URL = process.env.RENDER_URL || 'https://warehouse-bot-wdp3.onrender.com';

setInterval(async () => {
  try { await axios.get(`${RENDER_URL}/ping`); } catch (e) {}
}, 14 * 60 * 1000);

const EXCLUDED_KEYWORDS = [
  'อุปกรณ์และเครื่องใช้สำนักงาน','อุปกรณ์วัสดุสำนักงานใช้ไป',
  'อุปกรณ์วัสดุสิ้นเปลืองใช้ไป','วัสดุสิ้นเปลือง','เครื่องใช้สำนักงาน',
];
const GREETINGS    = ['สวัสดี','หวัดดี','hello','hi','ดีจ้า','ดีครับ','ดีค่ะ','เฮ้','hey'];
const THANKS       = ['ขอบคุณ','ขอบใจ','thanks','thank you','thx','ขอบคุณมาก'];
const HELP         = ['ช่วยอะไรได้บ้าง','ทำอะไรได้บ้าง','ใช้งานยังไง','help','วิธีใช้'];
const OUT_OF_SCOPE = ['ราคา','price','ค่าใช้จ่าย','กินอะไร','อากาศ','ข่าว','weather','เที่ยว'];
const SUMMARY_KEYWORDS = [
  'sku','สเค','กี่ sku','กี่รายการ','มีกี่ชนิด','มีกี่ประเภท',
  'ของในโกดังทั้งหมด','สินค้าทั้งหมด','inventory ทั้งหมด',
  'ทั้งหมดกี่','มีทั้งหมด','รวมทั้งหมด','มีอะไรทั้งหมด'
];

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

async function getSheetData() {
  const encodedSheet = encodeURIComponent(SHEET_NAME);
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
  const response = await axios.get(url);
  const lines = response.data.split('\n');
  const headers = parseCSVLine(lines[0]);

  let COL_ITEM=-1, COL_PROJECT=-1, COL_STATUS=-1;
  let COL_QTY=-1, COL_UNIT=-1, COL_LOCATION=-1, COL_TYPE=-1;

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

  const cols = { COL_ITEM, COL_PROJECT, COL_STATUS, COL_QTY, COL_UNIT, COL_LOCATION, COL_TYPE };
  return { lines, cols };
}

// ดึงข้อมูลสำหรับตอบคำถามสินค้า — Status=ดี + QTY>0 เท่านั้น
async function getInventoryGood() {
  const { lines, cols } = await getSheetData();
  const { COL_ITEM, COL_PROJECT, COL_STATUS, COL_QTY, COL_UNIT, COL_LOCATION, COL_TYPE } = cols;

  const summary = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVLine(lines[i]);
    if (row.length < Math.max(COL_ITEM,COL_STATUS,COL_QTY,COL_LOCATION)+1) continue;

    const item     = row[COL_ITEM]||'';
    const project  = row[COL_PROJECT]||'';
    const status   = row[COL_STATUS]||'';
    const qty      = parseInt(row[COL_QTY])||0;
    const unit     = row[COL_UNIT]||'';
    const location = row[COL_LOCATION]||'';
    const type     = COL_TYPE>=0?(row[COL_TYPE]||''):'';

    if (!item||item==='รายการ') continue;
    if (status!=='ดี') continue;                    // เฉพาะ ดี
    if (!location.includes('Warehouse')) continue;
    if (qty<=0) continue;                           // เฉพาะ QTY > 0
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

// ดึงข้อมูลสำหรับ SKU Summary — ดี+เสีย รวมกัน นับ unique SKU
async function getInventoryAll() {
  const { lines, cols } = await getSheetData();
  const { COL_ITEM, COL_PROJECT, COL_STATUS, COL_QTY, COL_UNIT, COL_LOCATION, COL_TYPE } = cols;

  // summary[proj][item] = { totalQty, goodQty, unit }
  const summary = {};

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCSVLine(lines[i]);
    if (row.length < Math.max(COL_ITEM,COL_STATUS,COL_QTY,COL_LOCATION)+1) continue;

    const item     = row[COL_ITEM]||'';
    const project  = row[COL_PROJECT]||'';
    const status   = row[COL_STATUS]||'';
    const qty      = parseInt(row[COL_QTY])||0;
    const unit     = row[COL_UNIT]||'';
    const location = row[COL_LOCATION]||'';
    const type     = COL_TYPE>=0?(row[COL_TYPE]||''):'';

    if (!item||item==='รายการ') continue;
    if (!location.includes('Warehouse')) continue;  // เฉพาะ Warehouse
    // ไม่ filter Status — รวมทั้ง ดี และ เสีย
    if (EXCLUDED_KEYWORDS.some(kw=>type.includes(kw)||item.includes(kw))) continue;

    let proj='อื่นๆ';
    if (project.includes('7')||project.toLowerCase().includes('eleven')) proj='7-Eleven';
    else if (project.toLowerCase().includes('airport')||project.toLowerCase().includes('air')) proj='Airport';

    const clean=item.replace(/_7-11/g,'').replace(/_Air/g,'').replace(/\\/g,'').trim();
    if (!summary[proj]) summary[proj]={};
    if (!summary[proj][clean]) summary[proj][clean]={totalQty:0, goodQty:0, unit:unit||'ชิ้น'};
    summary[proj][clean].totalQty += qty;
    if (status==='ดี') summary[proj][clean].goodQty += qty;
    if (unit) summary[proj][clean].unit=unit;
  }
  return summary;
}

function buildSummaryReport(summary) {
  let totalSKU=0, totalQty=0, totalGoodQty=0;
  let report = 'สรุปสินค้าใน Warehouse Ramintra\n';
  report += '─────────────────────\n';

  for (const [proj, items] of Object.entries(summary)) {
    const projSKU  = Object.keys(items).length;
    const projQty  = Object.values(items).reduce((s,d)=>s+d.totalQty,0);
    const projGood = Object.values(items).reduce((s,d)=>s+d.goodQty,0);
    totalSKU  += projSKU;
    totalQty  += projQty;
    totalGoodQty += projGood;

    report += `Project: ${proj}\n`;
    report += `  SKU: ${projSKU.toLocaleString()} รายการ\n`;
    report += `  จำนวนทั้งหมด: ${projQty.toLocaleString()} ชิ้น\n`;
    report += `  พร้อมใช้ (ดี): ${projGood.toLocaleString()} ชิ้น\n\n`;
  }

  report += '─────────────────────\n';
  report += 'รวมทั้งหมด\n';
  report += `  SKU: ${totalSKU.toLocaleString()} รายการ\n`;
  report += `  จำนวนทั้งหมด: ${totalQty.toLocaleString()} ชิ้น\n`;
  report += `  พร้อมใช้ (ดี): ${totalGoodQty.toLocaleString()} ชิ้น`;
  return report;
}

function buildInventoryText(summary) {
  let text='';
  for (const [proj,items] of Object.entries(summary)) {
    text+=`[${proj}]\n`;
    for (const [name,d] of Object.entries(items)) {
      text+=`${name}: ${d.qty} ${d.unit}\n`;
    }
    text+='\n';
  }
  return text;
}

function classifyMessage(msg) {
  const m=msg.toLowerCase().trim();
  if (/^\d+$/.test(m)) return 'number_only';
  if (GREETINGS.some(g=>m.includes(g))) return 'greeting';
  if (THANKS.some(t=>m.includes(t))) return 'thanks';
  if (HELP.some(h=>m.includes(h))) return 'help';
  if (OUT_OF_SCOPE.some(o=>m.includes(o))) return 'out_of_scope';
  if (SUMMARY_KEYWORDS.some(k=>m.includes(k))) return 'summary';
  return 'inventory_query';
}

async function askGroq(userMessage, inventoryText) {
  const prompt = `คุณคือระบบ Warehouse Inventory Bot ของ Plan B Media

ข้อมูลสินค้าพร้อมใช้ (สภาพดี, QTY > 0) ใน Warehouse:
${inventoryText}

คำถาม: ${userMessage}

กฎ:
- ตอบภาษาไทยธรรมชาติ สั้น กระชับ เป็นกันเอง
- ห้ามใช้ ** หรือ markdown ใดๆ
- ตอบตรงๆ ไม่ต้องมีประโยคนำ
- แสดงผลแยกตาม Project
- ถ้าถามจำนวนทั้งหมด ให้รวมยอดทุก Project
- ถ้าพิมพ์ผิดเล็กน้อยให้เข้าใจได้
- ถ้าไม่พบ ตอบว่า "ไม่พบในคลังครับ รอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ"
- ห้ามตอบข้อมูลราคา หรืออุปกรณ์สำนักงาน`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3
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
    if (event.type !== 'message') continue;
    const replyToken = event.replyToken;

    if (event.message.type !== 'text') {
      await replyToLine(replyToken, 'ขออภัยครับ รองรับเฉพาะข้อความเท่านั้น\nลองพิมพ์ถามได้เลยครับ เช่น "จอ 37 มีเท่าไหร่"').catch(()=>{});
      continue;
    }

    const userMessage = event.message.text.trim();
    if (!userMessage) continue;
    console.log('User asked:', userMessage);

    const msgType = classifyMessage(userMessage);

    if (msgType === 'greeting') {
      await replyToLine(replyToken, 'สวัสดีครับ 👋\nผมคือระบบตรวจสอบสินค้าใน Warehouse Ramintra ครับ\n\nพิมพ์ถามได้เลยครับ เช่น\n- "จอ 37 มีเท่าไหร่"\n- "มีจออะไรบ้าง"\n- "สินค้าทั้งหมดมีกี่ SKU"').catch(()=>{});
      continue;
    }
    if (msgType === 'thanks') {
      await replyToLine(replyToken, 'ยินดีครับ 😊 มีอะไรอยากถามเพิ่มเติมได้เลยนะครับ').catch(()=>{});
      continue;
    }
    if (msgType === 'help') {
      await replyToLine(replyToken, 'ผมช่วยตรวจสอบสินค้าใน Warehouse ได้ครับ 📦\n\nตัวอย่างคำถาม:\n- จอ 46 มีเท่าไหร่\n- มีจออะไรบ้าง\n- ลำโพงเหลือกี่ตัว\n- สินค้าทั้งหมดมีกี่ SKU\n- ของในโกดังทั้งหมดกี่ชิ้น').catch(()=>{});
      continue;
    }
    if (msgType === 'out_of_scope') {
      await replyToLine(replyToken, 'ขออภัยครับ ผมตอบได้เฉพาะข้อมูลสินค้าใน Warehouse เท่านั้นครับ 😊').catch(()=>{});
      continue;
    }

    try {
      // SKU Summary — ดึงข้อมูลรวมทั้ง ดี+เสีย
      if (msgType === 'summary') {
        const summaryAll = await getInventoryAll();
        const report = buildSummaryReport(summaryAll);
        await replyToLine(replyToken, report);
        continue;
      }

      // ตัวเลขอย่างเดียว → ถามจอ
      let finalMessage = userMessage;
      if (msgType === 'number_only') {
        finalMessage = `จอ ${userMessage} นิ้ว มีเท่าไหร่`;
      }

      // ตอบคำถามสินค้า — เฉพาะ ดี + QTY > 0
      const summaryGood = await getInventoryGood();
      const inventoryText = buildInventoryText(summaryGood);
      const reply = await askGroq(finalMessage, inventoryText);
      await replyToLine(replyToken, reply);

    } catch (err) {
      const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
      console.log('ERROR:', errMsg);
      await replyToLine(replyToken, 'ขออภัยครับ เกิดข้อผิดพลาด\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ').catch(()=>{});
    }
  }
});

app.get('/', (req, res) => res.send('LINE Warehouse Bot is running ✅'));
app.get('/ping', (req, res) => res.send('pong'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
