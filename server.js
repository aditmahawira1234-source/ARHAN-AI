require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_BODY = 20_000;
const MAX_CONTEXT_MESSAGES = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });
function readHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(data.messages) ? data.messages : [];
  } catch { return []; }
}
function writeHistory(messages) {
  const temp = HISTORY_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({ messages }, null, 2), { mode: 0o600 });
  fs.renameSync(temp, HISTORY_FILE);
}
let messages = readHistory();

function send(res, status, data, type='application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'X-Content-Type-Options':'nosniff'});
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function readBody(req) {
  return new Promise((resolve,reject) => {
    let body=''; req.on('data', chunk => { body += chunk; if(body.length > MAX_BODY){reject(new Error('অনুরোধটি অনেক বড়'));req.destroy();} });
    req.on('end',()=>{try{resolve(JSON.parse(body || '{}'));}catch{reject(new Error('সঠিক JSON পাঠাও'));}});
    req.on('error',reject);
  });
}
async function askModel(history) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY সেট করা হয়নি। .env ফাইলে API key যোগ করো।');
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const context = history.slice(-MAX_CONTEXT_MESSAGES).map(m => ({role:m.role, content:m.content}));
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      messages:[
        {role:'system',content:'তুমি ARHAN-AI—একজন সহায়ক, ভদ্র ও নিরাপদ বাংলা AI সহকারী। ব্যবহারকারী বাংলায় লিখলে সহজ বাংলায় উত্তর দাও। কথোপকথনের আগের বার্তাগুলো প্রাসঙ্গিক হলে ব্যবহার করো। তুমি কেবল পাঠানো কথোপকথনের অংশ দেখতে পাও; সংরক্ষিত সব ইতিহাস নিজে থেকে জানো না।'},
        ...context
      ],
      temperature:0.7
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `AI API error (${response.status})`);
  return result.choices?.[0]?.message?.content?.trim() || 'এই মুহূর্তে উত্তর পাওয়া যায়নি।';
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/history') return send(res,200,{messages});
  if (req.method === 'DELETE' && url.pathname === '/api/history') {
    messages=[]; writeHistory(messages); return send(res,200,{ok:true});
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = await readBody(req);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > 6000) return send(res,400,{error:'১–৬০০০ অক্ষরের একটি বার্তা লিখো।'});
      messages.push({role:'user',content:message,at:new Date().toISOString()});
      const reply = await askModel(messages);
      messages.push({role:'assistant',content:reply,at:new Date().toISOString()});
      writeHistory(messages);
      return send(res,200,{reply});
    } catch(err) {
      // Failed model requests should not leave an unanswered user message in persistent history.
      if (messages.length && messages[messages.length-1].role === 'user') messages.pop();
      return send(res,500,{error:err.message || 'সার্ভারে সমস্যা হয়েছে।'});
    }
  }
  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(path.join(__dirname,'index.html'));
    return send(res,200,html.toString(),'text/html; charset=utf-8');
  }
  return send(res,404,{error:'পৃষ্ঠা পাওয়া যায়নি'});
});
server.listen(PORT,()=>console.log(`ARHAN-AI চলছে: http://localhost:${PORT}`));
