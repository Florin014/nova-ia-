const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// File parsers (optional - graceful fallback if not installed)
let pdfParse, mammoth, XLSX;
try { pdfParse = require('pdf-parse'); } catch { pdfParse = null; }
try { mammoth = require('mammoth'); } catch { mammoth = null; }
try { XLSX = require('xlsx'); } catch { XLSX = null; }

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nova-secret-key-123';
const LOCAL_OLLAMA = 'http://localhost:11434';
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_AVAILABLE = GEMINI_KEY && GEMINI_KEY !== 'votre_cle_gemini_ici';
const XAI_KEY = process.env.XAI_API_KEY;
const XAI_AVAILABLE = XAI_KEY && XAI_KEY.startsWith('xai-');
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_AVAILABLE = GROQ_KEY && GROQ_KEY.length > 10;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== PERSISTENT STORAGE ====================
const DATA_FILE = path.join(__dirname, 'nova_data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  return { 
    memory: {}, 
    graph: { nodes: [], edges: [] }, 
    agentTasks: [], 
    users: [], 
    captchaTasks: [
      { id: 1, type: 'math', content: "Combien font 2 + 2 ?", options: ['3', '4', '5', '6'], answer: '4' },
      { id: 2, type: 'math', content: "Combien font 10 × 3 ?", options: ['20', '30', '40', '13'], answer: '30' },
      { id: 3, type: 'math', content: "Combien font 15 - 7 ?", options: ['6', '7', '8', '9'], answer: '8' },
      { id: 4, type: 'math', content: "Combien font 12 ÷ 4 ?", options: ['2', '3', '4', '6'], answer: '3' },
      { id: 5, type: 'football', content: "Quel pays a gagné la Coupe du Monde 2018 ?", options: ['Brésil', 'France', 'Allemagne', 'Argentine'], answer: 'France' },
      { id: 6, type: 'football', content: "Combien de joueurs dans une équipe de foot ?", options: ['9', '10', '11', '12'], answer: '11' },
      { id: 7, type: 'football', content: "Qui a gagné le Ballon d'Or 2023 ?", options: ['Messi', 'Haaland', 'Mbappé', 'Ronaldo'], answer: 'Messi' },
      { id: 8, type: 'grammar', content: 'Complète : "Je ___ aller à l\'école"', options: ['vais', 'va', 'vas', 'aller'], answer: 'vais' },
      { id: 9, type: 'grammar', content: 'Complète : "Elles ___ belles"', options: ['son', 'sont', 'ont', 'est'], answer: 'sont' },
      { id: 10, type: 'grammar', content: 'Complète : "Il ___ 10 ans"', options: ['a', 'as', 'est', 'à'], answer: 'a' },
      { id: 11, type: 'sentiment', content: "Quel temps fait-il aujourd'hui ?", options: ['Beau', 'Pluie', 'Neige', 'Aucun'], answer: 'Aucun' },
      { id: 12, type: 'math', content: "Combien font 7 × 8 ?", options: ['42', '48', '56', '64'], answer: '56' },
    ],
    captchaResponses: []
  };
}

function saveData() {
  try { 
    const data = { 
      memory, 
      graph: { nodes: graphNodes, edges: graphEdges }, 
      agentTasks, 
      users,
      captchaTasks,
      captchaResponses
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); 
  } catch {}
}

let persistent = loadData();
let memory = persistent.memory || {};
let graphNodes = persistent.graph?.nodes || [];
let graphEdges = persistent.graph?.edges || [];
let agentTasks = persistent.agentTasks || [];
let users = persistent.users || [];
let captchaTasks = persistent.captchaTasks || [];
let captchaResponses = persistent.captchaResponses || [];

// ==================== AUTH MIDDLEWARE ====================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'invalid token' });
    req.user = user;
    next();
  });
}

// ==================== AUTH ENDPOINTS ====================
app.post('/api/auth/register', async (req, res) => {
  const { username, password, captchaId, captchaAnswer } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  // Simple captcha verification (training mode: we accept any answer but we log it)
  const task = captchaTasks.find(t => t.id === captchaId);
  if (task) {
    captchaResponses.push({ userId: username, taskId: captchaId, answer: captchaAnswer, timestamp: Date.now() });
    saveData();
  }

  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'user already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  users.push({ username, password: hashedPassword });
  saveData();

  res.json({ status: 'ok' });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: 'invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'invalid credentials' });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: user.username });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ username: req.user.username });
});

// ==================== CAPTCHA ENDPOINTS ====================
app.get('/api/captcha/task', (req, res) => {
  if (!captchaTasks.length) {
    captchaTasks = [
      { id: 1, type: 'math', content: "Combien font 2 + 2 ?", options: ['3', '4', '5', '6'], answer: '4' },
      { id: 2, type: 'math', content: "Combien font 10 × 3 ?", options: ['20', '30', '40', '13'], answer: '30' },
      { id: 3, type: 'math', content: "Combien font 15 - 7 ?", options: ['6', '7', '8', '9'], answer: '8' },
      { id: 4, type: 'football', content: "Quel pays a gagné la Coupe du Monde 2018 ?", options: ['Brésil', 'France', 'Allemagne', 'Argentine'], answer: 'France' },
      { id: 5, type: 'football', content: "Combien de joueurs dans une équipe de foot ?", options: ['9', '10', '11', '12'], answer: '11' },
      { id: 6, type: 'grammar', content: 'Complète : "Je ___ aller à l\'école"', options: ['vais', 'va', 'vas', 'aller'], answer: 'vais' },
      { id: 7, type: 'grammar', content: 'Complète : "Elles ___ belles"', options: ['son', 'sont', 'ont', 'est'], answer: 'sont' },
      { id: 8, type: 'math', content: "Combien font 7 × 8 ?", options: ['42', '48', '56', '64'], answer: '56' },
    ];
    saveData();
  }
  const randomTask = captchaTasks[Math.floor(Math.random() * captchaTasks.length)];
  const { answer, ...publicTask } = randomTask;
  res.json(publicTask);
});

app.post('/api/captcha/submit', (req, res) => {
  const { taskId, answer, username } = req.body;
  captchaResponses.push({ userId: username || 'anonymous', taskId, answer, timestamp: Date.now() });
  saveData();
  res.json({ status: 'ok' });
});

// ==================== KNOWLEDGE BASE (Hyper-RAG in-memory) ====================
const knowledgeBase = [];

function tokenize(text) {
  return text.toLowerCase().split(/[^a-z0-9àâçéèêëîïôûùüÿœæ]+/).filter(Boolean);
}

function buildIndex() {
  for (const entry of knowledgeBase) {
    if (!entry.tokens) entry.tokens = tokenize(entry.content);
    if (!entry.terms) {
      entry.terms = {};
      for (const t of entry.tokens) {
        entry.terms[t] = (entry.terms[t] || 0) + 1;
      }
    }
  }
}

function searchRAG(query, topK = 5) {
  buildIndex();
  const qTokens = tokenize(query);
  const scores = [];

  for (const entry of knowledgeBase) {
    let score = 0;
    for (const qt of qTokens) {
      if (entry.terms[qt]) score += entry.terms[qt];
    }
    if (score > 0) scores.push({ score, content: entry.content, name: entry.name });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

// ==================== AGENT DEFINITIONS ====================
const PERSONAS = {
  optimist: { name: 'Optimiste', system: "Tu es un expert optimiste et créatif. Tu vois les opportunités, les forces, les possibilités. Tu es visionnaire et enthousiaste." },
  critic: { name: 'Critique', system: "Tu es un expert critique et rigoureux. Tu identifies les failles, les risques, les incohérences logiques. Tu es exigeant et précis." },
  synthesizer: { name: 'Synthétiseur', system: "Tu es un expert synthétiseur. Tu fusionnes les perspectives opposées en une réponse équilibrée, pragmatique et actionable." },
  coder: { name: 'Codeur', system: "Tu es un expert en génie logiciel. Tu écris du code propre, testé et commenté. Tu suis les meilleures pratiques." },
  architect: { name: 'Architecte', system: "Tu es un architecte logiciel senior. Tu conçois des architectures complètes, évolutives et maintenables. Tu génères des structures de projet." },
};

// ==================== OLLAMA STREAM ====================
async function* streamOllama(messages, model = 'nova1', options = {}) {
  const host = options.host || LOCAL_OLLAMA;
  const body = JSON.stringify({
    model: options.modelOverride || model,
    messages,
    stream: true,
    options: { temperature: options.temperature ?? 0.5, top_p: 0.9, num_predict: options.maxTokens ?? 8192 },
  });
  const r = await fetch(`${host}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
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

// ==================== GEMINI STREAM ====================
async function* streamGemini(messages, options = {}) {
  const apiKey = options.geminiKey || GEMINI_KEY;
  const sysMsg = messages.find(m => m.role === 'system');
  const system = sysMsg ? sysMsg.content : '';
  const chat = messages.filter(m => m.role !== 'system');
  const contents = [];
  for (const m of chat) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  if (system) { contents.unshift({ role: 'user', parts: [{ text: `[Instructions: ${system}]\nUnderstood.` }] }); contents.splice(1, 0, { role: 'model', parts: [{ text: 'Understood.' }] }); }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { temperature: options.temperature ?? 0.5, maxOutputTokens: 8192 }, safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }] }) });
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

// ==================== GROQ STREAM (gratuit, rapide, puissant) ====================
const GROQ_MODEL = 'llama3-70b-8192';

async function* streamGroq(messages, options = {}) {
  const apiKey = options.groqKey || GROQ_KEY;
  const sysMsg = messages.find(m => m.role === 'system');
  const system = sysMsg ? sysMsg.content : '';
  const chat = messages.filter(m => m.role !== 'system');

  const groqMessages = [];
  if (system) groqMessages.push({ role: 'system', content: system });
  for (const m of chat) groqMessages.push({ role: m.role, content: m.content });

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const body = JSON.stringify({
    model: options.modelOverride || GROQ_MODEL,
    messages: groqMessages,
    stream: true,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.maxTokens ?? 8192,
    top_p: 0.9,
  });

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Groq error ${r.status}: ${errText.slice(0, 200)}`);
  }

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
      try {
        const j = JSON.parse(t.slice(6));
        const content = j.choices?.[0]?.delta?.content || '';
        if (content) yield content;
      } catch {}
    }
  }
}

// ==================== XAI (GROK) STREAM ====================
async function* streamXAI(messages, options = {}) {
  const apiKey = options.xaiKey || XAI_KEY;
  const sysMsg = messages.find(m => m.role === 'system');
  const system = sysMsg ? sysMsg.content : '';
  const chat = messages.filter(m => m.role !== 'system');

  const xaiMessages = [];
  if (system) xaiMessages.push({ role: 'system', content: system });
  for (const m of chat) xaiMessages.push({ role: m.role, content: m.content });

  const url = 'https://api.x.ai/v1/chat/completions';
  const body = JSON.stringify({
    model: options.modelOverride || 'grok-2-latest',
    messages: xaiMessages,
    stream: true,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.maxTokens ?? 8192,
  });

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`xAI error ${r.status}: ${errText.slice(0, 200)}`);
  }

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
      try {
        const j = JSON.parse(t.slice(6));
        const content = j.choices?.[0]?.delta?.content || '';
        if (content) yield content;
      } catch {}
    }
  }
}

// ==================== STREAM HELPER ====================
async function* streamResponse(messages, options = {}) {
  const provider = options.provider || 'ollama';
  if (provider === 'xai' && (XAI_AVAILABLE || options.xaiKey)) {
    for await (const c of streamXAI(messages, options)) yield c;
  } else if (provider === 'groq' && (GROQ_AVAILABLE || options.groqKey)) {
    for await (const c of streamGroq(messages, options)) yield c;
  } else if (provider === 'gemini' && (GEMINI_AVAILABLE || options.geminiKey)) {
    for await (const c of streamGemini(messages, options)) yield c;
  } else {
    for await (const c of streamOllama(messages, 'nova1', options)) yield c;
  }
}

async function fullResponse(messages, options = {}) {
  let r = '';
  for await (const c of streamResponse(messages, options)) r += c;
  return r;
}

// ==================== VAGUE DETECTION + QUESTION ASKER ====================
const VAGUE_PATTERNS = [
  /^.{0,25}$/,
  /aide.?moi|j'ai besoin|je veux|je dois|je cherche|j'aimerais/i,
  /cr(é|e)er.*(app|site|projet|syst(è|e)me|bot|api|logiciel|plateforme)/i,
  /fais.*(tout|entier|complet|int(é|e)gral)/i,
  /explique.*(complet|entier|tout)/i,
  /par.*(où|ou).*commencer|comment.*d(é|e)buter/i,
  /c'est.*(complexe|compliqu(é|e)|dur|difficile)/i,
  /je.*rien.*comprendre|trop.*(compliqu(é|e)|dur)/i,
  /g(é|e)n(è|e)re.*(app|site|projet|api)/i,
  /besoin.*aide|besoin.*conseil/i,
  /quoi.*penser|que.*faire.*(pour|si)/i,
];

const GREETINGS = ['salut', 'bonjour', 'bonsoir', 'hello', 'hi', 'hey', 'coucou', 'cc', 'yo', 'bjr', 'slt', 'quoi de neuf', 'ça va', 'ca va', 'hello'];

function detectVague(prompt) {
  const lower = prompt.toLowerCase().trim();
  if (GREETINGS.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ',') || lower.startsWith(g + '!'))) return false;
  if (prompt.length < 25) return true;
  let vagueScore = 0;
  for (const p of VAGUE_PATTERNS) { if (p.test(lower)) vagueScore++; }
  return vagueScore >= 1;
}

function buildClarificationPrompt(prompt) {
  return `L'utilisateur a fait une demande qui manque de précision.

Sa demande: "${prompt}"

RÈGLE ABSOLUE : Tu NE dois PAS répondre à sa demande directement. Tu dois d'abord poser des questions.

Avant de pouvoir l'aider efficacement, tu as besoin de plus de détails. Pose 2-3 questions précises pour clarifier :
1. Quel est le contexte exact ?
2. Quels sont les contraintes ou préférences ?
3. Quel niveau de détail est attendu ?

Sois amical mais direct. Commence par "J'ai quelques questions avant de pouvoir t'aider..."`;
}

// ==================== MODE DETECTION ====================
function detectMode(prompt) {
  if (/math|equation|proof|logic|algebra|calculus|raisonnement|déduire|théorème|symbole/i.test(prompt)) return 'symbolic';
  if (/code|function|class|implément|bug|debug|python|javascript|typescript|algorithme|programmation/i.test(prompt)) return 'code';
  if (/write|story|poem|creative|créatif|histoire|poème|design|brainstorm|imaginer/i.test(prompt)) return 'creative';
  if (/analyze|compare|evaluate|explain|summarize|analyse|comparer|évaluer|expliquer|résumer|architecture|design pattern/i.test(prompt)) return 'analysis';
  if (/predict|forecast|probability|risk|chance|likely|tendance|probabilité|prévision|estimation/i.test(prompt)) return 'probabilistic';
  return 'general';
}

// ==================== TREE OF THOUGHTS ====================
async function treeOfThoughts(prompt, options = {}) {
  const branches = options.branches || 3;
  const depth = options.depth || 2;
  const results = [];

  for (let b = 0; b < branches; b++) {
    const branchMessages = [
      { role: 'system', content: `Tu es l'explorateur de pensée #${b + 1}. Explore la question sous un angle unique et différent des autres. Sois original.` },
      { role: 'user', content: prompt },
    ];

    let branchText = '';
    for await (const c of streamResponse(branchMessages, { ...options, temperature: 0.9 })) branchText += c;

    // Self-evaluation
    const evalMessages = [
      { role: 'system', content: 'Évalue cette réponse de 0 à 10 sur : cohérence, pertinence, utilité. Réponds UNIQUEMENT avec un nombre.' },
      { role: 'user', content: `Question: ${prompt}\nRéponse: ${branchText}` },
    ];
    let scoreText = '';
    for await (const c of streamResponse(evalMessages, { ...options, temperature: 0.1, maxTokens: 10 })) scoreText += c;
    const score = parseInt(scoreText) || 5;

    results.push({ branch: b + 1, score, text: branchText });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ==================== AUTO UNIT TESTING ====================
async function autoUnitTest(code, language = 'python') {
  const prompt = [
    { role: 'system', content: `Tu es un expert en tests ${language}. Génère des tests unitaires complets pour le code fourni. Inclus des edge cases. Réponds UNIQUEMENT avec le code de test.` },
    { role: 'user', content: code },
  ];
  let tests = '';
  for await (const c of streamResponse(prompt, { temperature: 0.2 })) tests += c;
  return tests;
}

// ==================== HALLUCINATION DETECTOR ====================
async function detectHallucination(response, context) {
  const prompt = [
    { role: 'system', content: `Analyse cette réponse point par point. Pour chaque affirmation, indique si elle est: SUPPORTED (supportée par le contexte), UNSUPPORTED (non supportée), CONTRADICTED (contredite). Format: phrase|STATUS` },
    { role: 'user', content: `Contexte: ${context}\n\nRéponse: ${response}` },
  ];
  let analysis = '';
  for await (const c of streamResponse(prompt, { temperature: 0.1 })) analysis += c;
  return analysis;
}

// ==================== TOOL-USE SYSTEM ====================

const TOOLS = {
  search: {
    desc: 'Rechercher sur le web',
    async execute(query) {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const html = await r.text();
        const results = [];
        const regex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = regex.exec(html)) !== null && results.length < 5) {
          results.push({ url: match[1], title: match[2].replace(/<[^>]+>/g, '').trim(), snippet: match[3].replace(/<[^>]+>/g, '').trim() });
        }
        if (!results.length) return 'Aucun résultat trouvé.';
        return results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n${r.snippet}`).join('\n\n');
      } catch (e) { return `Erreur de recherche: ${e.message}`; }
    },
  },
  url: {
    desc: 'Lire le contenu d\'une page web',
    async execute(url) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(10000),
        });
        const html = await r.text();
        const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
        return text || 'Page vide ou inaccessible.';
      } catch (e) { return `Erreur: ${e.message}`; }
    },
  },
  read_file: {
    desc: 'Lire un fichier dans le dossier backend',
    async execute(filepath) {
      try {
        const safePath = path.join(__dirname, '..', filepath.replace(/\.\./g, ''));
        if (!fs.existsSync(safePath)) return `Fichier introuvable: ${filepath}`;
        const content = fs.readFileSync(safePath, 'utf8').slice(0, 3000);
        return `\`\`\`\n${content}\n\`\`\``;
      } catch (e) { return `Erreur: ${e.message}`; }
    },
  },
  python: {
    desc: 'Exécuter du code Python (via Pyodide sur le frontend)',
    async execute(code) { return `Pour exécuter ce code Python, utilise >>> ${code} dans le chat.`; },
  },
};

async function executeToolCall(text) {
  const toolRegex = /\[TOOL:(\w+)\]([\s\S]*?)(?=\[TOOL:|$)/gi;
  let result = text;
  let match;

  while ((match = toolRegex.exec(text)) !== null) {
    const toolName = match[1].toLowerCase();
    const toolInput = match[2].trim();
    const tool = TOOLS[toolName];
    if (tool) {
      const toolResult = await tool.execute(toolInput);
      result = result.replace(match[0], `\n\n🛠️ **Outil: ${toolName}**\n\`${toolInput}\`\n\n**Résultat:**\n${toolResult}\n\n`);
    }
  }

  return result;
}

// ==================== CHAT ENDPOINT ====================
app.post('/api/chat', authenticateToken, async (req, res) => {
  const { messages, model, reflect = false, host, provider = 'ollama' } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'Messages required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const mode = detectMode(messages[messages.length - 1].content);
  const start = Date.now();

  // Add NOVA's core behavior instructions
  // Build memory context
  let memoryContext = '';
  if (memory.nom || memory.technologies?.length || memory.projets?.length || memory.preferences || memory.contexte) {
    memoryContext = `\nMémoire de l'utilisateur:\n`;
    if (memory.nom) memoryContext += `- Nom: ${memory.nom}\n`;
    if (memory.technologies?.length) memoryContext += `- Technologies: ${memory.technologies.join(', ')}\n`;
    if (memory.projets?.length) memoryContext += `- Projets: ${memory.projets.join(', ')}\n`;
    if (memory.preferences) memoryContext += `- Préférences: ${memory.preferences}\n`;
    if (memory.contexte) memoryContext += `- Contexte: ${memory.contexte}\n`;
  }

  const SYSTEM_BEHAVIOR = `Tu es NOVA, assistant IA créé par Florin Marcu.${memoryContext}
RÈGLES DE COMPORTEMENT :
1. Si l'utilisateur fait une demande VAGUE ou IMPRÉCISE, tu DOIS poser 2-3 questions pour clarifier avant de répondre.
2. Si la demande est claire et précise, réponds directement.
3. Tu es en français. Sois amical, concis et utile.

OUTILS DISPONIBLES (utilise-les quand nécessaire) :
- [TOOL:search] ta recherche → Cherche sur le web
- [TOOL:url] https://... → Lit le contenu d'une page web
- [TOOL:read_file] chemin/relatif → Lit un fichier du projet
- [TOOL:python] code → Exécute du Python

Exemple: Si on te demande "cherche le prix de la RTX 5090", réponds:
[TOOL:search] prix RTX 5090
Puis utilise le résultat pour répondre.`;

  // RAG context enrichment
  const lastMsg = messages[messages.length - 1].content;
  const ragResults = searchRAG(lastMsg);
  let enrichedMessages = [
    { role: 'system', content: SYSTEM_BEHAVIOR },
    ...messages.filter(m => m.role !== 'system'),
  ];
  const extraOpts = {};
  if (req.body.groqKey) extraOpts.groqKey = req.body.groqKey;
  if (req.body.geminiKey) extraOpts.geminiKey = req.body.geminiKey;

  if (ragResults.length > 0) {
    const ragContext = ragResults.map(r => `[${r.name}]: ${r.content.slice(0, 500)}`).join('\n\n');
    enrichedMessages = [
      { role: 'system', content: `${SYSTEM_BEHAVIOR}\n\nContexte disponible:\n${ragContext}\n\nUtilise ce contexte si pertinent pour répondre.` },
      ...messages.filter(m => m.role !== 'system'),
    ];
  }

  // Vague detection → ask clarifying questions first
  const vague = detectVague(lastMsg);

  try {
    let full = '';
    res.write(`data: ${JSON.stringify({ type: 'meta', mode, provider, rag: ragResults.length > 0, vague })}\n\n`);

    // Only ask questions on the first user message in conversation
    const isFirstMessage = enrichedMessages.filter(m => m.role === 'user').length <= 1;
    if (vague && isFirstMessage) {
      const clarifMessages = [
        { role: 'system', content: 'Tu es NOVA, assistant IA créé par Florin Marcu. Tu es CONÇU pour poser des questions précises quand une demande manque de détails. C\'est ta fonctionnalité principale. Tu dois absolument POSER 2-3 QUESTIONS avant de répondre.' },
        { role: 'user', content: buildClarificationPrompt(lastMsg) },
      ];
      for await (const c of streamResponse(clarifMessages, { provider, ...extraOpts, temperature: 0.7, maxTokens: 512 })) {
        full += c;
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: c })}\n\n`);
      }
      // Fallback if model didn't generate questions
      if (full.length < 100) {
        const defaultQuestions = `\n\n1. Quel est le contexte exact de ton projet ?\n2. Quelles sont les technologies que tu préfères ou connais déjà ?\n3. Quel niveau de détail attends-tu ?`;
        full += defaultQuestions;
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: defaultQuestions })}\n\n`);
      }
      const elapsed = Date.now() - start;
      res.write(`data: ${JSON.stringify({ type: 'done', content: full, elapsed, mode, vague: true, tokens: full.length / 4 })}\n\n`);
      res.end();
      return;
    }

    for await (const c of streamResponse(enrichedMessages, { provider, ...extraOpts, temperature: mode === 'creative' ? 0.8 : 0.4 })) {
      full += c;
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: c })}\n\n`);
    }

    // Auto-reflection
    if (reflect && full.length > 50) {
      res.write(`data: ${JSON.stringify({ type: 'reflect', content: 'Auto-réflexion...' })}\n\n`);
      const refMsg = [{ role: 'system', content: 'Vérifie cette réponse. Si elle contient des erreurs, omissions ou imprécisions, corrige-la. Sinon, réponds "OK".' }, { role: 'user', content: `Question: ${lastMsg}\nRéponse: ${full}` }];
      let corrected = '';
      for await (const c of streamResponse(refMsg, { provider, ...extraOpts, temperature: 0.1 })) corrected += c;
      const t = corrected.trim();
      if (t !== 'OK' && !t.startsWith('OK')) full = `[Auto-corrigé]\n\n${corrected}`;
    }

    // Tool-use execution
    let toolUsed = false;
    if (full.includes('[TOOL:')) {
      res.write(`data: ${JSON.stringify({ type: 'tool', content: 'Exécution des outils...' })}\n\n`);
      full = await executeToolCall(full);
      toolUsed = true;
    }

    // Hallucination detection
    let halluReport = '';
    if (ragResults.length > 0 && full.length > 100) {
      halluReport = await detectHallucination(full, ragResults.map(r => r.content).join('\n'));
    }

    const elapsed = Date.now() - start;
    const tokensEst = full.length / 4;
    trackCall(mode, provider, tokensEst, elapsed);
    res.write(`data: ${JSON.stringify({ type: 'done', content: full, elapsed, mode, tokens: tokensEst, halluReport, toolUsed })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});

// ==================== TREE OF THOUGHTS ENDPOINT ====================
app.post('/api/tot', authenticateToken, async (req, res) => {
  const { prompt, provider } = req.body;
  const extraOpts = {};
  if (req.body.groqKey) extraOpts.groqKey = req.body.groqKey;
  if (req.body.geminiKey) extraOpts.geminiKey = req.body.geminiKey;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const totStart = Date.now();

  try {
    const thoughts = await treeOfThoughts(prompt, { provider, ...extraOpts, branches: 3, depth: 2 });

    res.write(`data: ${JSON.stringify({ type: 'thoughts', data: thoughts })}\n\n`);

    // Synthesis of best thoughts
    const best = thoughts.slice(0, 2);
    const synMsg = [
      { role: 'system', content: PERSONAS.synthesizer.system },
      { role: 'user', content: `Question: ${prompt}\n\nMeilleures réponses:\n1: ${best[0].text}\n2: ${best[1]?.text || ''}\n\nSynthétise la meilleure réponse finale.` },
    ];

    let syn = '';
    for await (const c of streamResponse(synMsg, { provider, ...extraOpts, temperature: 0.4 })) {
      syn += c;
      res.write(`data: ${JSON.stringify({ type: 'synthesis', content: c })}\n\n`);
    }

    const totElapsed = Date.now() - totStart;
    trackCall('tot', provider, syn.length / 4, totElapsed);
    res.write(`data: ${JSON.stringify({ type: 'done', content: syn, thoughts })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});

// ==================== AUTO UNIT TEST ENDPOINT ====================
app.post('/api/test-code', authenticateToken, async (req, res) => {
  const { code, language = 'python', provider } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    res.write(`data: ${JSON.stringify({ type: 'generating', content: 'Génération des tests...' })}\n\n`);
    const tests = await autoUnitTest(code, language);
    res.write(`data: ${JSON.stringify({ type: 'tests', content: tests })}\n\n`);

    // Try to run via Pyodide (if python)
    if (language === 'python') {
      res.write(`data: ${JSON.stringify({ type: 'running', content: 'Exécution des tests...' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'run_result', content: 'Prêt. Execute >>> dans le chat avec le code de test.' })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done', content: tests })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});

// ==================== KNOWLEDGE BASE (RAG) ENDPOINT ====================
app.post('/api/knowledge/add', authenticateToken, (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  knowledgeBase.push({ name, content, addedAt: Date.now() });
  buildIndex();
  res.json({ status: 'ok', total: knowledgeBase.length });
});

app.get('/api/knowledge/search', authenticateToken, (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ results: knowledgeBase.map(k => ({ name: k.name, content: k.content.slice(0, 200) })) });
  const results = searchRAG(q);
  res.json({ results });
});

app.get('/api/knowledge', authenticateToken, (req, res) => {
  res.json(knowledgeBase.map(k => ({ name: k.name, size: k.content.length, addedAt: k.addedAt })));
});

app.delete('/api/knowledge', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (name) {
    const idx = knowledgeBase.findIndex(k => k.name === name);
    if (idx >= 0) knowledgeBase.splice(idx, 1);
  } else {
    knowledgeBase.length = 0;
  }
  res.json({ status: 'ok', total: knowledgeBase.length });
});

// ==================== MULTI-AGENT DEBATE ====================
app.post('/api/debate', authenticateToken, async (req, res) => {
  const { prompt, provider, types = ['optimist', 'critic', 'synthesizer'] } = req.body;
  const extraOpts = {};
  if (req.body.groqKey) extraOpts.groqKey = req.body.groqKey;
  if (req.body.geminiKey) extraOpts.geminiKey = req.body.geminiKey;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const debStart = Date.now();
  const responses = {};

  for (const type of types) {
    const persona = PERSONAS[type];
    if (!persona) continue;

    res.write(`data: ${JSON.stringify({ type: 'persona', name: persona.name })}\n\n`);
    let r = '';
    const msgs = [{ role: 'system', content: persona.system }, { role: 'user', content: `Analyse: ${prompt}` }];
    for await (const c of streamResponse(msgs, { provider, ...extraOpts, temperature: 0.7 })) r += c;
    responses[type] = r;
    res.write(`data: ${JSON.stringify({ type: 'persona_done', name: persona.name, content: r })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ type: 'synthesizing', content: 'Synthèse...' })}\n\n`);

  const synMsgs = [
    { role: 'system', content: PERSONAS.synthesizer.system },
    { role: 'user', content: Object.entries(responses).map(([k, v]) => `${PERSONAS[k]?.name || k}: ${v}`).join('\n\n') + '\n\nProduis une réponse finale équilibrée.' },
  ];

  let s = '';
  for await (const c of streamResponse(synMsgs, { provider, ...extraOpts, temperature: 0.4 })) {
    s += c;
    res.write(`data: ${JSON.stringify({ type: 'synthesis', content: c })}\n\n`);
  }

  const debElapsed = Date.now() - debStart;
  trackCall('debate', provider, s.length / 4, debElapsed);
  res.write(`data: ${JSON.stringify({ type: 'done', content: s, debate: responses })}\n\n`);
  res.end();
});

// ==================== AUTO-SCAFFOLDING ====================
app.post('/api/scaffold', authenticateToken, async (req, res) => {
  const { description, language = 'python', provider } = req.body;
  const extraOpts = {};
  if (req.body.groqKey) extraOpts.groqKey = req.body.groqKey;
  if (req.body.geminiKey) extraOpts.geminiKey = req.body.geminiKey;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const msgs = [
    { role: 'system', content: `Tu es un architecte logiciel. Génère une structure de projet ${language} complète : arborescence, fichiers principaux avec code, config. Format: d'abord l'arborescence, puis chaque fichier avec son chemin.` },
    { role: 'user', content: description },
  ];

  try {
    let full = '';
    res.write(`data: ${JSON.stringify({ type: 'meta', content: 'Génération de l\'architecture...' })}\n\n`);
    for await (const c of streamResponse(msgs, { provider, ...extraOpts, temperature: 0.3 })) {
      full += c;
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: c })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done', content: full })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});

// ==================== SYMBOLIC SOLVER (SymPy via Pyodide) ====================
app.post('/api/solve-math', authenticateToken, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { expression } = req.body;
  res.write(`data: ${JSON.stringify({ type: 'info', content: 'Pour utiliser SymPy, tape >>> dans le chat:\n>>> from sympy import *; x = symbols(\"x\"); solve(..., x)' })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'done', content: 'SymPy est disponible via Pyodide (>>> commande)', expression })}\n\n`);
  res.end();
});

// ==================== WEB FETCH / NAVIGATE ====================

app.post('/api/fetch-url', authenticateToken, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timer);

    const html = await r.text();

    // Strip HTML tags to get text content
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000);

    res.write(`data: ${JSON.stringify({ type: 'content', url, text: text.slice(0, 500), fullLength: text.length })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', content: text, url })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: `Erreur: ${err.message}` })}\n\n`);
    res.end();
  }
});

app.post('/api/web-nav', authenticateToken, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    // Open in user's default browser
    require('child_process').execSync(`start "" "${url}"`, { timeout: 3000 });
    res.json({ status: 'ok', url, message: `Ouvert dans le navigateur: ${url}` });
  } catch (err) {
    res.json({ status: 'error', message: err.message });
  }
});

// ==================== FILE PARSER (PDF/DOCX/XLSX/TXT) ====================

app.post('/api/parse-file', authenticateToken, async (req, res) => {
  const { name, content, mime } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });

  try {
    const ext = path.extname(name).toLowerCase();
    const buffer = Buffer.from(content, 'base64');
    let text = '';

    if (ext === '.pdf') {
      if (!pdfParse) return res.json({ text: '[PDF parser non installé]' });
      const d = await pdfParse(buffer);
      text = d.text;
    } else if (ext === '.docx') {
      if (!mammoth) return res.json({ text: '[DOCX parser non installé]' });
      const d = await mammoth.extractRawText({ buffer });
      text = d.value;
    } else if (ext === '.xlsx' || ext === '.xls') {
      if (!XLSX) return res.json({ text: '[XLSX parser non installé]' });
      const wb = XLSX.read(buffer, { type: 'buffer' });
      text = wb.SheetNames.map(sn => {
        const sheet = wb.Sheets[sn];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return `[${sn}]\n${csv}`;
      }).join('\n\n');
    } else {
      text = buffer.toString('utf8');
    }

    const truncated = text.slice(0, 50000);
    res.json({ text: truncated, fullLength: text.length, name });
  } catch (err) {
    res.json({ text: `[Erreur de parsing: ${err.message}]`, name });
  }
});

// ==================== WEB SEARCH (DuckDuckGo) ====================

app.post('/api/web-search', authenticateToken, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Use DuckDuckGo HTML interface (no API key needed)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
    });
    const html = await r.text();

    // Extract result snippets
    const results = [];
    const regex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 8) {
      results.push({
        url: match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0],
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        snippet: match[3].replace(/<[^>]+>/g, '').trim(),
      });
    }

    // Fallback: simpler extraction
    if (results.length === 0) {
      const altRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = altRegex.exec(html)) !== null && results.length < 8) {
        const snippetMatch = html.slice(match.index).match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
        results.push({
          url: match[1],
          title: match[2].replace(/<[^>]+>/g, '').trim(),
          snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '',
        });
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'results', data: results })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', query, count: results.length })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});

// ==================== STATS / DASHBOARD ====================
let stats = { totalCalls: 0, totalTokens: 0, totalTime: 0, callsByMode: {}, callsByProvider: {} };

function trackCall(mode, provider, tokens, time) {
  stats.totalCalls++;
  stats.totalTokens += tokens || 0;
  stats.totalTime += time || 0;
  stats.callsByMode[mode] = (stats.callsByMode[mode] || 0) + 1;
  stats.callsByProvider[provider] = (stats.callsByProvider[provider] || 0) + 1;
}

app.get('/api/stats', authenticateToken, (req, res) => {
  res.json({
    ...stats,
    avgTime: stats.totalCalls ? Math.round(stats.totalTime / stats.totalCalls) : 0,
    avgTokens: stats.totalCalls ? Math.round(stats.totalTokens / stats.totalCalls) : 0,
    knowledgeSize: knowledgeBase.length,
    memoryFields: Object.keys(memory).length,
    graphNodes: graphNodes.length,
    graphEdges: graphEdges.length,
    agentTasks: agentTasks.length,
  });
});

// ==================== LONG-TERM MEMORY ====================

app.get('/api/memory', authenticateToken, (req, res) => {
  res.json(memory);
});

app.put('/api/memory', authenticateToken, (req, res) => {
  const updates = req.body;
  Object.assign(memory, updates);
  saveData();
  res.json({ status: 'ok', memory });
});

app.post('/api/memory/extract', authenticateToken, async (req, res) => {
  const { conversation } = req.body;
  if (!conversation) return res.status(400).json({ error: 'conversation required' });

  try {
    const msgs = [
      { role: 'system', content: 'Extrais les informations personnelles de cette conversation. Format JSON:\n{"nom":"","technologies":[],"projets":[],"preferences":"","contexte":""}\nSi aucune info, réponds {}.' },
      { role: 'user', content: conversation.slice(0, 3000) },
    ];
    let r = '';
    for await (const c of streamResponse(msgs, { temperature: 0.1, maxTokens: 256 })) r += c;
    const jsonMatch = r.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      if (extracted.nom) memory.nom = extracted.nom;
      if (extracted.technologies?.length) memory.technologies = [...new Set([...(memory.technologies || []), ...extracted.technologies])];
      if (extracted.projets?.length) memory.projets = [...new Set([...(memory.projets || []), ...extracted.projets])];
      if (extracted.preferences) memory.preferences = extracted.preferences;
      if (extracted.contexte) memory.contexte = extracted.contexte;
      saveData();
      res.json({ status: 'ok', extracted, memory });
    } else {
      res.json({ status: 'ok', extracted: null, memory });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== KNOWLEDGE GRAPH ====================

app.get('/api/graph', authenticateToken, (req, res) => {
  res.json({ nodes: graphNodes, edges: graphEdges });
});

app.post('/api/graph/extract', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const msgs = [
      { role: 'system', content: 'Extrais les entités (concepts, technologies, personnes) et leurs relations de ce texte. Réponds UNIQUEMENT en JSON:\n{"entities":["...","..."],"relations":[{"source":"...","target":"...","label":"..."}]}' },
      { role: 'user', content: text.slice(0, 3000) },
    ];
    let r = '';
    for await (const c of streamResponse(msgs, { temperature: 0.1, maxTokens: 512 })) r += c;

    const jsonMatch = r.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      for (const e of (data.entities || [])) {
        if (!graphNodes.find(n => n.id === e)) graphNodes.push({ id: e, label: e, group: 'entity' });
      }
      for (const rel of (data.relations || [])) {
        graphEdges.push({ source: rel.source, target: rel.target, label: rel.label });
      }
      saveData();
      res.json({ status: 'ok', entities: data.entities, relations: data.relations, nodeCount: graphNodes.length });
    } else {
      res.json({ status: 'ok', entities: [], relations: [] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/graph/clear', authenticateToken, (req, res) => {
  graphNodes = [];
  graphEdges = [];
  saveData();
  res.json({ status: 'ok' });
});

// ==================== VISION / IMAGE ANALYSIS ====================

app.post('/api/vision', authenticateToken, async (req, res) => {
  const { image, prompt } = req.body;
  if (!image) return res.status(400).json({ error: 'image required (base64)' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const userPrompt = prompt || 'Décris cette image en détail.';

  try {
    if (GEMINI_AVAILABLE) {
      res.write(`data: ${JSON.stringify({ type: 'meta', content: 'Analyse via Gemini Vision...' })}\n\n`);
      const geminiBody = {
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: image.replace(/^data:image\/\w+;base64,/, '') } },
            { text: userPrompt },
          ],
        }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody),
      });
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || 'Aucune analyse disponible.';
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', content: text })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: 'meta', content: 'Analyse via Ollama (LLaVA)...' })}\n\n`);
      const ollamaBody = {
        model: 'llava',
        stream: true,
        messages: [
          { role: 'user', content: userPrompt, images: [image.replace(/^data:image\/\w+;base64,/, '')] },
        ],
      };
      const r = await fetch(`${LOCAL_OLLAMA}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ollamaBody),
      });
      if (!r.ok) throw new Error(`Vision: modèle llava non disponible. Installe: ollama pull llava`);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (const line of buf.split('\n')) { buf = ''; const t = line.trim(); if (!t) continue; try { const j = JSON.parse(t); if (j.message?.content) { full += j.message.content; res.write(`data: ${JSON.stringify({ type: 'chunk', content: j.message.content })}\n\n`); } if (j.done) break; } catch {} }
      }
      res.write(`data: ${JSON.stringify({ type: 'done', content: full })}\n\n`);
    }
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});

// ==================== AUTONOMOUS AGENT ====================

app.post('/api/agent', authenticateToken, async (req, res) => {
  const { goal, provider } = req.body;
  if (!goal) return res.status(400).json({ error: 'goal required' });
  const extraOpts = {};
  if (req.body.groqKey) extraOpts.groqKey = req.body.groqKey;
  if (req.body.geminiKey) extraOpts.geminiKey = req.body.geminiKey;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const agentId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const task = { id: agentId, goal, steps: [], status: 'running', createdAt: Date.now() };
  agentTasks.push(task);

  try {
    // Phase 1: Planning
    res.write(`data: ${JSON.stringify({ type: 'phase', phase: 'plan', content: 'Élaboration du plan...' })}\n\n`);
    const planMsgs = [
      { role: 'system', content: 'Tu es un agent autonome. Décompose cet objectif en 3-5 étapes claires et séquentielles. Format: chaque étape sur une ligne commençant par "- ". Sois spécifique et actionable.' },
      { role: 'user', content: goal },
    ];
    let planText = '';
    for await (const c of streamResponse(planMsgs, { provider, ...extraOpts, temperature: 0.3, maxTokens: 1024 })) {
      planText += c;
      res.write(`data: ${JSON.stringify({ type: 'plan', content: c })}\n\n`);
    }

    const steps = planText.split('\n').filter(l => l.trim().startsWith('- ')).map(l => l.replace(/^- /, '').trim()).filter(Boolean);
    if (steps.length === 0) {
      task.steps = [{ description: planText.trim(), status: 'completed', result: 'Plan généré' }];
      task.status = 'completed';
      res.write(`data: ${JSON.stringify({ type: 'done', content: planText, task: task })}\n\n`);
      res.end();
      return;
    }

    task.steps = steps.map(s => ({ description: s, status: 'pending', result: '' }));

    // Phase 2: Execution
    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i];
      step.status = 'running';
      res.write(`data: ${JSON.stringify({ type: 'step', index: i, total: task.steps.length, step: step.description })}\n\n`);

      const execMsgs = [
        { role: 'system', content: `Tu exécutes l'étape ${i + 1}/${task.steps.length}: "${step.description}". Fournis le résultat concret.` },
        { role: 'user', content: `Objectif: ${goal}\nÉtape: ${step.description}` },
      ];
      let execResult = '';
      for await (const c of streamResponse(execMsgs, { provider, ...extraOpts, temperature: 0.4, maxTokens: 2048 })) {
        execResult += c;
        res.write(`data: ${JSON.stringify({ type: 'exec', index: i, content: c })}\n\n`);
      }

      step.status = 'completed';
      step.result = execResult;
      saveData();
    }

    // Phase 3: Synthesis
    res.write(`data: ${JSON.stringify({ type: 'phase', phase: 'synthesis', content: 'Synthèse finale...' })}\n\n`);
    const synMsgs = [
      { role: 'system', content: 'Résume le travail accompli pour atteindre l\'objectif. Mets en avant les résultats clés.' },
      { role: 'user', content: `Objectif: ${goal}\nÉtapes:\n${task.steps.map((s, i) => `${i + 1}. ${s.description}\nRésultat: ${s.result.slice(0, 500)}`).join('\n\n')}` },
    ];
    let syn = '';
    for await (const c of streamResponse(synMsgs, { provider, ...extraOpts, temperature: 0.3 })) {
      syn += c;
      res.write(`data: ${JSON.stringify({ type: 'synthesis', content: c })}\n\n`);
    }

    task.status = 'completed';
    saveData();
    res.write(`data: ${JSON.stringify({ type: 'done', content: syn, task })}\n\n`);
    res.end();
  } catch (err) {
    task.status = 'error';
    saveData();
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});

app.get('/api/agent/tasks', authenticateToken, (req, res) => {
  res.json(agentTasks.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20));
});

app.delete('/api/agent/tasks', authenticateToken, (req, res) => {
  agentTasks = [];
  saveData();
  res.json({ status: 'ok' });
});

// ==================== TERMINAL ENDPOINT ====================
app.post('/api/terminal', authenticateToken, (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : 'bash';
  const args = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];

  const proc = spawn(shell, args);

  proc.stdout.on('data', (data) => {
    res.write(`data: ${JSON.stringify({ type: 'output', content: data.toString() })}\n\n`);
  });

  proc.stderr.on('data', (data) => {
    res.write(`data: ${JSON.stringify({ type: 'error', content: data.toString() })}\n\n`);
  });

  proc.on('close', (code) => {
    res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
    res.end();
  });

  proc.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  });
});

// ==================== INFO ENDPOINT ====================
app.get('/api/info', authenticateToken, (req, res) => {
  const models = [];
  try {
    const out = execSync('ollama list', { encoding: 'utf8', timeout: 5000 });
    const lines = out.trim().split('\n').slice(1);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) models.push(parts[0]);
    }
  } catch {}

  res.json({
    ollama: { models, available: models.length > 0 },
    gemini: { available: GEMINI_AVAILABLE },
    groq: { available: GROQ_AVAILABLE, model: GROQ_MODEL },
    features: ['chat', 'debate', 'tot', 'rag', 'voice', 'tests', 'scaffold', 'reflection', 'hallucination_detector', 'web_fetch', 'web_nav', 'vague_detection', 'memory', 'graph', 'vision', 'agent', 'file_parse', 'web_search', 'drag_drop', 'tool_use'],
  });
});

// ==================== SERVE FRONTEND ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\x1b[36m[NOVA AI] Server running on http://localhost:${PORT}`);
  console.log(`\x1b[36m[NOVA AI] Features: chat, debate, ToT, RAG, tests, scaffold, voice, reflection, web, search, questions, memory, graph, vision, agent, files, tools`);
  console.log(`\x1b[36m[NOVA AI] Gemini: ${GEMINI_AVAILABLE ? '✓' : '✗'} | Ollama: local`);
});
