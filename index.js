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
const THANKS       = ['ขอบคุณ','ขอบใจ','thanks','thank you','thx'];
const HELP         = ['ช่วยอะไรได้บ้าง','ทำอะไรได้บ้าง','ใช้งานยังไง','help','วิธีใช้'];
const OUT_OF_SCOPE = ['ราคา','price','ค่าใช้จ่าย','กินอะไร','อากาศ','ข่าว','weather','เที่ยว'];
const SUMMARY_KEYWORDS = [
  'sku','กี่ sku','กี่รายการ','มีกี่ชนิด','มีกี่ประเภท',
  'ของในโกดังทั้งหมด','สินค้าทั้งหมด','ทั้งหมดกี่','มีทั้งหมด','รวมทั้งหมด'
];

// Emoji mapping ตามประเภทสินค้า
function getItemEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes('lfd') || n.includes('จอ') || n.includes('monitor') || n.includes('screen')) return '📺';
  if (n.includes('ลำโพง') || n.includes('speaker') || n.includes('audio')) return '🔊';
  if (n.includes('player') || n.includes('media')) return '🎬';
  if (n.includes('cb ') || n.includes('rcbo') || n.includes('ไฟฟ้า') || n.includes('plug') || n.includes('ปลั๊ก') || n.includes('timer') || n.includes('circuit')) return '🔌';
  if (n.includes('ไขควง') || n.includes('คีม') || n.includes('คัตเตอร์') || n.includes('บันได') || n.includes('ไฟฉาย') || n.includes('เครื่องมือ')) return '🔧';
  if (n.includes('ผ้า') || n.includes('ไมโคร') || n.includes('ชามัวร์') || n.includes('น้ำยา') || n.includes('ซิลิโคน') || n.includes('เทป') || n.includes('ฟิล์ม')) return '🧴';
  if (n.includes('โครงสร้าง') || n.includes('ขาเหล็ก') || n.includes('bracket') || n.includes('rack')) return '🔩';
  if (n.includes('ป้าย') || n.includes('ไวนิล') || n.includes('logo')) return '🪧';
  return '📦';
}

function getProjEmoji(proj) {
  if (proj === '7-Eleven') return '🏪';
  if (proj === 'Airport') return '✈️';
  return '🏭';
}

function getHeaderEmoji(userMessage) {
  const m = userMessage.toLowerCase();
  if (m.includes('จอ') || m.includes('lfd') || m.includes('monitor')) return '📺';
  if (m.includes('ลำโพง') || m.includes('speaker')) return '🔊';
  if (m.includes('player')) return '🎬';
  if (m.includes('ไฟฟ้า') || m.includes('cb') || m.includes('rcbo') || m.includes('ปลั๊ก')) return '🔌';
  if (m.includes('เครื่องมือ') || m.includes('ไขควง') || m.includes('คีม')) return '🔧';
  if (m.includes('ผ้า') || m.includes('ไมโคร') || m.includes('น้ำยา')) return '🧴';
  if (m.includes('โครง') || m.includes('ขาเหล็ก')) return '🔩';
  return '📦';
}

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

// ดึง inventory ทั้งหมด (ดีเท่านั้น)
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

// ดึง inventory รวมทั้ง ดี+เสีย สำหรับ summary
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

// ค้นหาและกรองเฉพาะรายการที่เกี่ยวข้อง
function searchInventory(summary, userMessage) {
  const msgLower = userMessage.toLowerCase()
    .replace(/เหลือ|เท่าไหร่|มีไหม|มีเท่าไหร่|ของ|ใน|คลัง|โกดัง|ครับ|ค่ะ|warehouse/g, ' ')
    .trim();

  // แยก keyword ที่มีความหมาย
  const keywords = msgLower.split(/\s+/).filter(k => k.length >= 2);

  const results = {};
  for (const [proj, items] of Object.entries(summary)) {
    for (const [name, d] of Object.entries(items)) {
      const nameLower = name.toLowerCase();
      const matched = keywords.some(kw => nameLower.includes(kw));
      if (matched) {
        if (!results[proj]) results[proj] = [];
        results[proj].push({ name, qty: d.qty, unit: d.unit });
      }
    }
  }
  return results;
}

// Format คำตอบสวยงาม (ไม่ผ่าน Groq — ตอบตรงเลย)
function formatInventoryReply(userMessage, results) {
  if (Object.keys(results).length === 0) return null; // ไม่เจอ

  const headerEmoji = getHeaderEmoji(userMessage);

  // หาชื่อสั้นๆ จาก keyword
  const msgLower = userMessage.toLowerCase()
    .replace(/เหลือ|เท่าไหร่|มีไหม|มีเท่าไหร่|มีของ|มี|ของ|ใน|คลัง|โกดัง|ครับ|ค่ะ/g, '')
    .trim();

  let reply = `${headerEmoji} ${msgLower}\n`;

  let grandTotal = 0;
  let grandUnit = '';

  for (const [proj, items] of Object.entries(results)) {
    const projEmoji = getProjEmoji(proj);
    reply += `\n${projEmoji} ${proj}\n`;

    let projTotal = 0;
    for (const item of items) {
      const itemEmoji = getItemEmoji(item.name);
      // ตัดชื่อให้สั้นลง
      const shortName = item.name
        .replace(/LFD /g, '').replace(/"/g, '"').trim();
      reply += `${itemEmoji} ${shortName}: ${item.qty} ${item.unit}\n`;
      projTotal += item.qty;
      grandTotal += item.qty;
      if (!grandUnit && item.unit) grandUnit = item.unit;
    }

    // ถ้ามีหลายรายการใน project ให้แสดง subtotal
    if (items.length > 1) {
      reply += `   รวม ${proj}: ${projTotal} ${grandUnit}\n`;
    }
  }

  // Grand total ถ้ามีหลาย project
  if (Object.keys(results).length > 1) {
    reply += `\n📊 รวมทั้งหมด: ${grandTotal} ${grandUnit}`;
  } else if (Object.values(results)[0].length > 1) {
    reply += `\n📊 รวมทั้งหมด: ${grandTotal} ${grandUnit}`;
  }

  return reply.trim();
}

// ส่ง Groq เฉพาะเมื่อหา keyword ไม่เจอ หรือคำถามซับซ้อน
async function askGroqWithFilteredData(userMessage, filteredResults) {
  // สร้าง inventory text จากที่กรองแล้ว
  let inventoryText = '';
  for (const [proj, items] of Object.entries(filteredResults)) {
    inventoryText += `[${proj}]\n`;
    items.forEach(i => { inventoryText += `${i.name}: ${i.qty} ${i.unit}\n`; });
    inventoryText += '\n';
  }

  const prompt = `คุณคือ Warehouse Inventory Bot ของ Plan B Media

สินค้าที่พบ (สภาพดี, อยู่ใน Warehouse):
${inventoryText}

คำถาม: "${userMessage}"

ตอบตามรูปแบบนี้เสมอ (ห้ามเปลี่ยน format):
[emoji หัวข้อ] [ชื่อสินค้าที่ถาม]

[emoji project] [ชื่อ Project]
[emoji item] [ชื่อสินค้า]: [จำนวน] [หน่วย]

📊 รวมทั้งหมด: [จำนวน] [หน่วย]

กฎ:
- emoji project: 7-Eleven=🏪, Airport=✈️, อื่นๆ=🏭
- emoji item: จอ=📺, ลำโพง=🔊, ไฟฟ้า=🔌, เครื่องมือ=🔧, ผ้า/วัสดุ=🧴, โครงสร้าง=🔩, อื่นๆ=📦
- ห้ามใช้ ** หรือ markdown
- ตอบสั้น กระชับ ภาษาไทย`;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.2
    },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return response.data.choices[0].message.content;
}

function buildSummaryReport(summary) {
  let totalSKU=0, totalQty=0, totalGood=0;
  let report = '📦 สรุปสินค้าใน Warehouse Ramintra\n';
  report += '─────────────────────\n';
  for (const [proj, items] of Object.entries(summary)) {
    const sku=Object.keys(items).length;
    const qty=Object.values(items).reduce((s,d)=>s+d.totalQty,0);
    const good=Object.values(items).reduce((s,d)=>s+d.goodQty,0);
    totalSKU+=sku; totalQty+=qty; totalGood+=good;
    const projEmoji = getProjEmoji(proj);
    report += `\n${projEmoji} ${proj}\n`;
    report += `  SKU: ${sku.toLocaleString()} รายการ\n`;
    report += `  จำนวนทั้งหมด: ${qty.toLocaleString()} ชิ้น\n`;
    report += `  พร้อมใช้ (ดี): ${good.toLocaleString()} ชิ้น\n`;
  }
  report += '\n─────────────────────\n';
  report += `📊 รวมทั้งหมด\n`;
  report += `  SKU: ${totalSKU.toLocaleString()} รายการ\n`;
  report += `  จำนวนทั้งหมด: ${totalQty.toLocaleString()} ชิ้น\n`;
  report += `  พร้อมใช้ (ดี): ${totalGood.toLocaleString()} ชิ้น`;
  return report;
}

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
      await replyToLine(replyToken, 'สวัสดีครับ 👋\nผมคือระบบตรวจสอบสินค้าใน Warehouse Ramintra ครับ\n\nพิมพ์ถามได้เลยครับ เช่น\n📺 "จอ 37 มีเท่าไหร่"\n🧴 "ผ้าไมโครไฟเบอร์เหลือไหม"\n📊 "สินค้าทั้งหมดมีกี่ SKU"').catch(()=>{});
      continue;
    }
    if (msgType === 'thanks') {
      await replyToLine(replyToken, 'ยินดีครับ 😊 มีอะไรอยากถามเพิ่มเติมได้เลยนะครับ').catch(()=>{});
      continue;
    }
    if (msgType === 'help') {
      await replyToLine(replyToken, '📦 ผมช่วยตรวจสอบสินค้าใน Warehouse ได้ครับ\n\nตัวอย่างคำถาม:\n📺 จอ 46 มีเท่าไหร่\n🔌 CB 32A มีไหม\n🧴 ผ้าไมโครไฟเบอร์เหลือกี่ผืน\n📊 สินค้าทั้งหมดมีกี่ SKU\n🔍 ของในโกดังทั้งหมดกี่ชิ้น').catch(()=>{});
      continue;
    }
    if (msgType === 'out_of_scope') {
      await replyToLine(replyToken, 'ขออภัยครับ ผมตอบได้เฉพาะข้อมูลสินค้าใน Warehouse เท่านั้นครับ 😊').catch(()=>{});
      continue;
    }

    try {
      if (msgType === 'summary') {
        const summaryAll = await getInventoryAll();
        const report = buildSummaryReport(summaryAll);
        await replyToLine(replyToken, report);
        continue;
      }

      let finalMessage = userMessage;
      if (msgType === 'number_only') {
        finalMessage = `จอ ${userMessage} นิ้ว มีเท่าไหร่`;
      }

      // ดึง inventory และกรองเฉพาะที่เกี่ยวข้อง
      const summaryGood = await getInventoryGood();
      const filtered = searchInventory(summaryGood, finalMessage);

      if (Object.keys(filtered).length === 0) {
        // ไม่พบเลย — ตอบทันทีไม่ส่ง Groq
        await replyToLine(replyToken, `🔍 ไม่พบ "${userMessage}" ในคลังครับ\n\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏`);
        continue;
      }

      // พบรายการ — format ตอบตรงเลย ไม่ส่ง Groq
      const directReply = formatInventoryReply(finalMessage, filtered);
      if (directReply) {
        await replyToLine(replyToken, directReply);
        continue;
      }

      // fallback — ส่ง Groq เฉพาะกรณีพิเศษ
      const groqReply = await askGroqWithFilteredData(finalMessage, filtered);
      await replyToLine(replyToken, groqReply);

    } catch (err) {
      const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
      console.log('ERROR:', errMsg);
      await replyToLine(replyToken, 'ขออภัยครับ เกิดข้อผิดพลาด\nรอเจ้าหน้าที่ตรวจสอบสักครู่นะครับ 🙏').catch(()=>{});
    }
  }
});

app.get('/', (req, res) => res.send('LINE Warehouse Bot is running ✅'));
app.get('/ping', (req, res) => res.send('pong'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
