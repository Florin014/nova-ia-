#!/usr/bin/env node
const readline = require('readline');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const XAI_KEY = process.env.XAI_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const LOCAL_OLLAMA = 'http://localhost:11434';

process.stdout.write('\x1b[36m');
console.log(`
╔══════════════════════════════════╗
║     NOVA AI — Gemini CLI v1.0   ║
║     Créé par Florin Marcu        ║
╚══════════════════════════════════╝
`);
process.stdout.write('\x1b[0m');

const args = process.argv.slice(2);
const providerFlag = args.find(a => a.startsWith('--provider='))?.split('=')[1] || 'gemini';
const modelFlag = args.find(a => a.startsWith('--model='))?.split('=')[1];
const oneShot = args.find(a => a === '--oneshot' || a === '-1');
const help = args.find(a => a === '--help' || a === '-h');

if (help) {
  console.log(`
Usage:
  node cli.js                          Mode interactif (REPL)
  node cli.js "<question>"             Mode one-shot rapide
  node cli.js --provider=ollama        Utiliser Ollama
  node cli.js --provider=groq          Utiliser Groq
  node cli.js --provider=gemini        Utiliser Gemini (défaut)
  node cli.js --provider=xai           Utiliser xAI (Grok)
  node cli.js --model=qwen2.5-coder    Choisir un modèle
  node cli.js --oneshot <question>     Mode one-shot
  node cli.js --help                   Cette aide
`);
  process.exit(0);
}

async function* streamOllama(messages, model = 'nova1') {
  const body = JSON.stringify({
    model: modelFlag || model,
    messages,
    stream: true,
    options: { temperature: 0.5, top_p: 0.9, num_predict: 8192 },
  });
  const r = await fetch(`${LOCAL_OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!r.ok) throw new Error(`Ollama error: ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split('\n')) {
      buf = '';
      const t = line.trim();
      if (!t) continue;
      try { const j = JSON.parse(t); if (j.message?.content) yield j.message.content; if (j.done) return; }
      catch {}
    }
  }
}

async function* streamGemini(messages) {
  const apiKey = GEMINI_KEY;
  if (!apiKey || apiKey === 'votre_cle_gemini_ici') throw new Error('Gemini API key not configured in backend/.env');
  const sysMsg = messages.find(m => m.role === 'system');
  const system = sysMsg ? sysMsg.content : '';
  const chat = messages.filter(m => m.role !== 'system');
  const contents = [];
  for (const m of chat) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  if (system) { contents.unshift({ role: 'user', parts: [{ text: `[Instructions: ${system}]\nUnderstood.` }] }); contents.splice(1, 0, { role: 'model', parts: [{ text: 'Understood.' }] }); }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelFlag || 'gemini-2.0-flash'}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { temperature: 0.5, maxOutputTokens: 8192 }, safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }] }) });
  if (!r.ok) throw new Error(`Gemini error: ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split('\n')) { buf = ''; const t = line.trim(); if (!t || !t.startsWith('data: ')) continue; try { const j = JSON.parse(t.slice(6)); const text = j.candidates?.[0]?.content?.parts?.[0]?.text || ''; if (text) yield text; } catch {} }
  }
}

async function* streamGroq(messages) {
  const apiKey = GROQ_KEY;
  if (!apiKey || apiKey === 'votre_cle_groq_ici') throw new Error('Groq API key not configured');
  const sysMsg = messages.find(m => m.role === 'system');
  const system = sysMsg ? sysMsg.content : '';
  const chat = messages.filter(m => m.role !== 'system');
  const groqMessages = [];
  if (system) groqMessages.push({ role: 'system', content: system });
  for (const m of chat) groqMessages.push({ role: m.role, content: m.content });
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelFlag || 'llama3-70b-8192', messages: groqMessages, stream: true, temperature: 0.5, max_tokens: 8192, top_p: 0.9 }),
  });
  if (!r.ok) { const errText = await r.text().catch(() => ''); throw new Error(`Groq error ${r.status}: ${errText.slice(0, 200)}`); }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split('\n')) {
      buf = '';
      const t = line.trim();
      if (!t || t === 'data: [DONE]') continue;
      if (!t.startsWith('data: ')) continue;
      try { const j = JSON.parse(t.slice(6)); const content = j.choices?.[0]?.delta?.content || ''; if (content) yield content; }
      catch {}
    }
  }
}

async function* streamXAI(messages) {
  const apiKey = XAI_KEY;
  if (!apiKey || !apiKey.startsWith('xai-')) throw new Error('xAI API key not configured');
  const sysMsg = messages.find(m => m.role === 'system');
  const system = sysMsg ? sysMsg.content : '';
  const chat = messages.filter(m => m.role !== 'system');
  const xaiMessages = [];
  if (system) xaiMessages.push({ role: 'system', content: system });
  for (const m of chat) xaiMessages.push({ role: m.role, content: m.content });
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelFlag || 'grok-2-latest', messages: xaiMessages, stream: true, temperature: 0.5, max_tokens: 8192 }),
  });
  if (!r.ok) { const errText = await r.text().catch(() => ''); throw new Error(`xAI error ${r.status}: ${errText.slice(0, 200)}`); }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split('\n')) {
      buf = '';
      const t = line.trim();
      if (!t || t === 'data: [DONE]') continue;
      if (!t.startsWith('data: ')) continue;
      try { const j = JSON.parse(t.slice(6)); const content = j.choices?.[0]?.delta?.content || ''; if (content) yield content; }
      catch {}
    }
  }
}

async function* streamResponse(messages) {
  const provider = providerFlag;
  if (provider === 'xai') { for await (const c of streamXAI(messages)) yield c; }
  else if (provider === 'groq') { for await (const c of streamGroq(messages)) yield c; }
  else if (provider === 'gemini') { for await (const c of streamGemini(messages)) yield c; }
  else { for await (const c of streamOllama(messages)) yield c; }
}

function detectMode(prompt) {
  if (/math|equation|proof|logic|calculus|raisonnement/i.test(prompt)) return 'symbolic';
  if (/code|function|class|bug|debug|python|javascript|algorithme/i.test(prompt)) return 'code';
  if (/write|story|poem|creative|créatif|histoire|poème|design|brainstorm/i.test(prompt)) return 'creative';
  if (/analyze|compare|evaluate|analyse|comparer|évaluer|expliquer|résumer|architecture/i.test(prompt)) return 'analysis';
  if (/predict|forecast|probability|risk|tendance|probabilité|prévision/i.test(prompt)) return 'probabilistic';
  return 'general';
}

const VAGUE_PATTERNS = [
  /^.{0,25}$/, /aide.?moi|j'ai besoin|je veux|je cherche/i,
  /cr(é|e)er.*(app|site|projet|api)/i, /fais.*(tout|entier|complet)/i,
  /explique.*(complet|entier|tout)/i, /par.*(où|ou).*commencer/i,
];

function detectVague(prompt) {
  const lower = prompt.toLowerCase().trim();
  const GREETINGS = ['salut', 'bonjour', 'bonsoir', 'hello', 'hi', 'hey', 'coucou', 'cc', 'yo', 'bjr', 'slt'];
  if (GREETINGS.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ','))) return false;
  if (prompt.length < 25) return true;
  return VAGUE_PATTERNS.some(p => p.test(lower));
}

const SYSTEM_PROMPT = `Tu es NOVA, assistant IA créé par Florin Marcu. Réponds en français. Sois amical, concis et utile. Structure tes réponses : Analyse → Réponse → Résumé.`;

async function chat(messages) {
  const lastMsg = messages[messages.length - 1].content;
  const mode = detectMode(lastMsg);
  const vague = detectVague(lastMsg);
  const isFirst = messages.filter(m => m.role === 'user').length <= 1;

  process.stdout.write(`\x1b[90m[Mode: ${mode}]${vague && isFirst ? ' [Questions...]' : ''}\x1b[0m\n`);

  if (vague && isFirst) {
    process.stdout.write("\n\x1b[33mJ'ai quelques questions avant de pouvoir t'aider...\x1b[0m\n");
    process.stdout.write('\x1b[33m1. Quel est le contexte exact ?\x1b[0m\n');
    process.stdout.write('\x1b[33m2. Quelles sont les technologies que tu préfères ?\x1b[0m\n');
    process.stdout.write('\x1b[33m3. Quel niveau de détail attends-tu ?\x1b[0m\n\n');
    return;
  }

  process.stdout.write('\n\x1b[36mNOVA › \x1b[0m');
  let full = '';
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  for await (const c of streamResponse(msgs)) {
    full += c;
    process.stdout.write(c);
  }
  process.stdout.write('\n\n');
}

if (oneShot || args.length > 0 && !args[0].startsWith('--')) {
  const prompt = oneShot ? (() => { const idx = args.indexOf('--oneshot') >= 0 ? args.indexOf('--oneshot') : args.indexOf('-1'); return args.slice(idx + 1).join(' '); })() : args.join(' ');
  if (prompt) {
    chat([{ role: 'user', content: prompt }]).then(() => process.exit(0)).catch(err => {
      process.stdout.write(`\x1b[31mError: ${err.message}\x1b[0m\n`);
      process.exit(1);
    });
  } else {
    startRepl();
  }
} else {
  startRepl();
}

function startRepl() {
  const history = [];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[36mNOVA> \x1b[0m',
  });

  console.log(`Provider: \x1b[33m${providerFlag}\x1b[0m | Model: \x1b[33m${modelFlag || 'default'}\x1b[0m`);
  console.log('Tape \x1b[33m/help\x1b[0m pour les commandes, \x1b[33mCtrl+C\x1b[0m pour quitter.\n');

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === '/exit' || input === '/quit') { rl.close(); return; }
    if (input === '/clear') { console.clear(); rl.prompt(); return; }
    if (input === '/help') {
      console.log(`
Commandes:
  /exit, /quit       Quitter
  /clear             Effacer l'écran
  /help              Cette aide
  /provider <name>   Changer de provider (ollama, gemini, groq, xai)
  /model <name>      Changer de modèle
  /history           Voir l'historique
  /save <file>       Sauvegarder la conversation
  >>> <code>         Exécuter du Python
      `);
      rl.prompt();
      return;
    }

    if (input.startsWith('/provider ')) {
      const newProv = input.slice(10).trim();
      if (['ollama', 'gemini', 'groq', 'xai'].includes(newProv)) {
        process.env.PROVIDER = newProv;
        console.log(`\x1b[33mProvider changé: ${newProv}\x1b[0m`);
      } else {
        console.log(`\x1b[31mProvider invalide. Options: ollama, gemini, groq, xai\x1b[0m`);
      }
      rl.prompt();
      return;
    }

    if (input.startsWith('/model ')) {
      const newModel = input.slice(7).trim();
      process.env.MODEL = newModel;
      console.log(`\x1b[33mModèle changé: ${newModel}\x1b[0m`);
      rl.prompt();
      return;
    }

    if (input === '/history') {
      if (history.length === 0) { console.log('Aucun message.'); rl.prompt(); return; }
      history.forEach((m, i) => {
        const prefix = m.role === 'user' ? '\x1b[32mVous\x1b[0m' : '\x1b[36mNOVA\x1b[0m';
        console.log(`${prefix}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`);
      });
      rl.prompt();
      return;
    }

    if (input.startsWith('/save ')) {
      const filepath = input.slice(6).trim();
      try {
        const content = history.map(m => `${m.role === 'user' ? 'Vous' : 'NOVA'}: ${m.content}`).join('\n\n---\n\n');
        fs.writeFileSync(filepath, content, 'utf8');
        console.log(`\x1b[32mConversation sauvegardée: ${filepath}\x1b[0m`);
      } catch (err) {
        console.log(`\x1b[31mErreur: ${err.message}\x1b[0m`);
      }
      rl.prompt();
      return;
    }

    history.push({ role: 'user', content: input });
    try {
      await chat(history.filter(m => m.role === 'user' || m.role === 'assistant'));
      history.push({ role: 'assistant', content: '...' });
    } catch (err) {
      process.stdout.write(`\x1b[31mErreur: ${err.message}\x1b[0m\n`);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n\x1b[36mÀ bientôt ! — NOVA AI\x1b[0m');
    process.exit(0);
  });
}
