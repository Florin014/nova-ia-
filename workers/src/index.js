import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { stream } from 'hono/streaming'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const app = new Hono()
app.use('/*', cors())

app.onError((err, c) => c.json({ error: err.message }, 500))

async function parseBody(c) {
  const text = await c.req.text()
  return JSON.parse(text)
}

async function kvGet(c, key, fallback) {
  try { const v = await c.env.NOVA_KV.get(key, 'json'); return v !== null ? v : fallback }
  catch { return fallback }
}

async function kvPut(c, key, val) {
  try { await c.env.NOVA_KV.put(key, JSON.stringify(val)) } catch {}
}

// ==================== AUTH ====================

app.post('/api/auth/register', async (c) => {
  const { username, password } = await parseBody(c)
  if (!username || !password) return c.json({ error: 'username and password required' }, 400)
  let users = await kvGet(c, 'users', [])
  if (users.find(u => u.username === username)) return c.json({ error: 'user already exists' }, 400)
  const hashedPassword = await bcrypt.hash(password, 10)
  users.push({ username, password: hashedPassword })
  await kvPut(c, 'users', users)
  return c.json({ status: 'ok' })
})

app.post('/api/auth/login', async (c) => {
  const { username, password } = await parseBody(c)
  let users = await kvGet(c, 'users', [])
  const user = users.find(u => u.username === username)
  if (!user) return c.json({ error: 'invalid credentials' }, 400)
  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return c.json({ error: 'invalid credentials' }, 400)
  const token = jwt.sign({ username }, c.env.JWT_SECRET || 'nova-secret-key-123', { expiresIn: '24h' })
  return c.json({ token, username })
})

app.get('/api/auth/me', async (c) => {
  const auth = c.req.header('Authorization')
  const token = auth?.split(' ')[1]
  if (!token) return c.json({ error: 'token required' }, 401)
  try {
    const user = jwt.verify(token, c.env.JWT_SECRET || 'nova-secret-key-123')
    return c.json({ username: user.username })
  } catch {
    return c.json({ error: 'invalid token' }, 403)
  }
})

// ==================== CAPTCHA ====================

const captchaTasks = [
  { id: 1, type: 'math', content: 'Combien font 2 + 2 ?', options: ['3', '4', '5', '6'], answer: '4' },
  { id: 2, type: 'math', content: 'Combien font 10 × 3 ?', options: ['20', '30', '40', '13'], answer: '30' },
  { id: 3, type: 'math', content: 'Combien font 15 - 7 ?', options: ['6', '7', '8', '9'], answer: '8' },
  { id: 4, type: 'math', content: 'Combien font 12 ÷ 4 ?', options: ['2', '3', '4', '6'], answer: '3' },
  { id: 5, type: 'football', content: 'Quel pays a gagné la Coupe du Monde 2018 ?', options: ['Brésil', 'France', 'Allemagne', 'Argentine'], answer: 'France' },
  { id: 6, type: 'football', content: 'Combien de joueurs dans une équipe de foot ?', options: ['9', '10', '11', '12'], answer: '11' },
  { id: 7, type: 'football', content: "Qui a gagné le Ballon d'Or 2023 ?", options: ['Messi', 'Haaland', 'Mbappé', 'Ronaldo'], answer: 'Messi' },
]

app.get('/api/captcha/task', (c) => {
  const task = captchaTasks[Math.floor(Math.random() * captchaTasks.length)]
  const { answer, ...publicTask } = task
  return c.json(publicTask)
})

// ==================== CHAT ====================

function tokenize(text) {
  return text.toLowerCase().split(/[^a-z0-9àâçéèêëîïôûùüÿœæ]+/).filter(Boolean)
}

function detectMode(prompt) {
  if (/math|equation|proof|logic|calculus|raisonnement/i.test(prompt)) return 'symbolic'
  if (/code|function|class|bug|debug|python|javascript|algorithme/i.test(prompt)) return 'code'
  if (/write|story|poem|creative|créatif|histoire|poème|design|brainstorm/i.test(prompt)) return 'creative'
  if (/analyze|compare|evaluate|analyse|comparer|évaluer|expliquer|résumer/i.test(prompt)) return 'analysis'
  if (/predict|forecast|probability|risk|tendance|probabilité|prévision/i.test(prompt)) return 'probabilistic'
  return 'general'
}

async function* streamGemini(messages, apiKey) {
  const sysMsg = messages.find(m => m.role === 'system')
  const system = sysMsg ? sysMsg.content : ''
  const chat = messages.filter(m => m.role !== 'system')
  const contents = []
  for (const m of chat) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })
  if (system) {
    contents.unshift({ role: 'user', parts: [{ text: `[Instructions: ${system}]\nUnderstood.` }] })
    contents.splice(1, 0, { role: 'model', parts: [{ text: 'Understood.' }] })
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { temperature: 0.5, maxOutputTokens: 8192 } }) })
  if (!r.ok) throw new Error(`Gemini error: ${r.status}`)
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    for (const line of buf.split('\n')) {
      buf = ''
      const t = line.trim()
      if (!t || !t.startsWith('data: ')) continue
      try { const j = JSON.parse(t.slice(6)); const text = j.candidates?.[0]?.content?.parts?.[0]?.text || ''; if (text) yield text } catch {}
    }
  }
}

async function* streamGroq(messages, apiKey) {
  const sysMsg = messages.find(m => m.role === 'system')
  const system = sysMsg ? sysMsg.content : ''
  const chat = messages.filter(m => m.role !== 'system')
  const groqMessages = []
  if (system) groqMessages.push({ role: 'system', content: system })
  for (const m of chat) groqMessages.push({ role: m.role, content: m.content })
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'llama3-70b-8192', messages: groqMessages, stream: true, temperature: 0.5, max_tokens: 8192 }),
  })
  if (!r.ok) throw new Error(`Groq error: ${r.status}`)
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    for (const line of buf.split('\n')) {
      buf = ''
      const t = line.trim()
      if (!t || t === 'data: [DONE]') continue
      if (!t.startsWith('data: ')) continue
      try { const j = JSON.parse(t.slice(6)); const c = j.choices?.[0]?.delta?.content || ''; if (c) yield c } catch {}
    }
  }
}

async function* streamXAI(messages, apiKey) {
  const sysMsg = messages.find(m => m.role === 'system')
  const system = sysMsg ? sysMsg.content : ''
  const chat = messages.filter(m => m.role !== 'system')
  const xaiMessages = []
  if (system) xaiMessages.push({ role: 'system', content: system })
  for (const m of chat) xaiMessages.push({ role: m.role, content: m.content })
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'grok-2-latest', messages: xaiMessages, stream: true, temperature: 0.5, max_tokens: 8192 }),
  })
  if (!r.ok) throw new Error(`xAI error: ${r.status}`)
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    for (const line of buf.split('\n')) {
      buf = ''
      const t = line.trim()
      if (!t || t === 'data: [DONE]') continue
      if (!t.startsWith('data: ')) continue
      try { const j = JSON.parse(t.slice(6)); const c = j.choices?.[0]?.delta?.content || ''; if (c) yield c } catch {}
    }
  }
}

async function* streamResponse(messages, provider, apiKeys) {
  if (provider === 'xai' && apiKeys.xai) {
    for await (const c of streamXAI(messages, apiKeys.xai)) yield c
  } else if (provider === 'groq' && apiKeys.groq) {
    for await (const c of streamGroq(messages, apiKeys.groq)) yield c
  } else if (provider === 'gemini' && apiKeys.gemini) {
    for await (const c of streamGemini(messages, apiKeys.gemini)) yield c
  } else {
    throw new Error(`Provider ${provider} not configured`)
  }
}

app.post('/api/chat', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.split(' ')[1]) return c.json({ error: 'token required' }, 401)
  try { jwt.verify(auth.split(' ')[1], c.env.JWT_SECRET || 'nova-secret-key-123') } catch { return c.json({ error: 'invalid token' }, 403) }

  const { messages, provider = 'gemini' } = await parseBody(c)
  if (!messages?.length) return c.json({ error: 'Messages required' }, 400)

  const mode = detectMode(messages[messages.length - 1].content)
  const start = Date.now()
  const apiKeys = { gemini: c.env.GEMINI_API_KEY, groq: c.env.GROQ_API_KEY, xai: c.env.XAI_API_KEY }

  let memory = await kvGet(c, 'memory', {})
  let memoryContext = ''
  if (memory.nom) memoryContext += `\nMémoire: Nom: ${memory.nom}`
  if (memory.technologies?.length) memoryContext += `\nTechnologies: ${memory.technologies.join(', ')}`

  const SYSTEM_BEHAVIOR = `Tu es NOVA, assistant IA créé par Florin Marcu.${memoryContext}
RÈGLES DE COMPORTEMENT : Réponds en français. Sois amical, concis et utile.`

  const enriched = [{ role: 'system', content: SYSTEM_BEHAVIOR }, ...messages.filter(m => m.role !== 'system')]

  return stream(c, async (stream) => {
    let full = ''
    stream.write(JSON.stringify({ type: 'meta', mode, provider }) + '\n')
    try {
      for await (const chunk of streamResponse(enriched, provider, apiKeys)) {
        full += chunk
        stream.write(JSON.stringify({ type: 'chunk', content: chunk }) + '\n')
      }
      const elapsed = Date.now() - start
      const tokensEst = Math.round(full.length / 4)
      let stats = await kvGet(c, 'stats', { totalCalls: 0, totalTokens: 0, totalTime: 0 })
      stats.totalCalls++
      stats.totalTokens += tokensEst
      stats.totalTime += elapsed
      await kvPut(c, 'stats', stats)
      stream.write(JSON.stringify({ type: 'done', content: full, elapsed, mode, tokens: tokensEst }) + '\n')
    } catch (err) {
      stream.write(JSON.stringify({ type: 'error', content: err.message }) + '\n')
    }
  })
})

// ==================== WEB SEARCH ====================

app.post('/api/web-search', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.split(' ')[1]) return c.json({ error: 'token required' }, 401)
  try { jwt.verify(auth.split(' ')[1], c.env.JWT_SECRET || 'nova-secret-key-123') } catch { return c.json({ error: 'invalid token' }, 403) }

  const { query } = await parseBody(c)
  if (!query) return c.json({ error: 'query required' }, 400)

  return stream(c, async (stream) => {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const html = await r.text()
      const results = []
      const regex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
      let match
      while ((match = regex.exec(html)) !== null && results.length < 8) {
        results.push({
          url: match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0],
          title: match[2].replace(/<[^>]+>/g, '').trim(),
          snippet: match[3].replace(/<[^>]+>/g, '').trim(),
        })
      }
      stream.write(JSON.stringify({ type: 'results', data: results }) + '\n')
      stream.write(JSON.stringify({ type: 'done', query, count: results.length }) + '\n')
    } catch (err) {
      stream.write(JSON.stringify({ type: 'error', content: err.message }) + '\n')
    }
  })
})

// ==================== WEB FETCH ====================

app.post('/api/fetch-url', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.split(' ')[1]) return c.json({ error: 'token required' }, 401)
  try { jwt.verify(auth.split(' ')[1], c.env.JWT_SECRET || 'nova-secret-key-123') } catch { return c.json({ error: 'invalid token' }, 403) }

  const { url } = await parseBody(c)
  if (!url) return c.json({ error: 'URL required' }, 400)

  return stream(c, async (stream) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } })
      const html = await r.text()
      const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000)
      stream.write(JSON.stringify({ type: 'done', content: text, url }) + '\n')
    } catch (err) { stream.write(JSON.stringify({ type: 'error', content: `Erreur: ${err.message}` }) + '\n') }
  })
})

// ==================== KNOWLEDGE BASE ====================

app.post('/api/knowledge/add', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.split(' ')[1]) return c.json({ error: 'token required' }, 401)
  try { jwt.verify(auth.split(' ')[1], c.env.JWT_SECRET || 'nova-secret-key-123') } catch { return c.json({ error: 'invalid token' }, 403) }

  const { name, content } = await parseBody(c)
  if (!name || !content) return c.json({ error: 'name and content required' }, 400)
  let kb = await kvGet(c, 'knowledge', [])
  kb.push({ name, content, addedAt: Date.now() })
  await kvPut(c, 'knowledge', kb)
  return c.json({ status: 'ok', total: kb.length })
})

app.get('/api/knowledge/search', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.split(' ')[1]) return c.json({ error: 'token required' }, 401)
  try { jwt.verify(auth.split(' ')[1], c.env.JWT_SECRET || 'nova-secret-key-123') } catch { return c.json({ error: 'invalid token' }, 403) }

  const q = c.req.query('q')
  let kb = await kvGet(c, 'knowledge', [])
  if (!q) return c.json({ results: kb.map(k => ({ name: k.name, content: k.content.slice(0, 200) })) })
  const qTokens = tokenize(q)
  const scores = []
  for (const entry of kb) {
    const tokens = tokenize(entry.content)
    let score = 0
    for (const qt of qTokens) { if (tokens.includes(qt)) score++ }
    if (score > 0) scores.push({ score, content: entry.content, name: entry.name })
  }
  scores.sort((a, b) => b.score - a.score)
  return c.json({ results: scores.slice(0, 5) })
})

// ==================== MEMORY ====================

app.get('/api/memory', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.split(' ')[1]) return c.json({ error: 'token required' }, 401)
  try { jwt.verify(auth.split(' ')[1], c.env.JWT_SECRET || 'nova-secret-key-123') } catch { return c.json({ error: 'invalid token' }, 403) }
  return c.json(await kvGet(c, 'memory', {}))
})

app.put('/api/memory', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.split(' ')[1]) return c.json({ error: 'token required' }, 401)
  try { jwt.verify(auth.split(' ')[1], c.env.JWT_SECRET || 'nova-secret-key-123') } catch { return c.json({ error: 'invalid token' }, 403) }

  const updates = await parseBody(c)
  let memory = await kvGet(c, 'memory', {})
  Object.assign(memory, updates)
  await kvPut(c, 'memory', memory)
  return c.json({ status: 'ok', memory })
})

// ==================== STATS ====================

app.get('/api/stats', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth?.split(' ')[1]) return c.json({ error: 'token required' }, 401)
  try { jwt.verify(auth.split(' ')[1], c.env.JWT_SECRET || 'nova-secret-key-123') } catch { return c.json({ error: 'invalid token' }, 403) }

  let stats = await kvGet(c, 'stats', { totalCalls: 0, totalTokens: 0, totalTime: 0 })
  return c.json({
    ...stats,
    avgTime: stats.totalCalls ? Math.round(stats.totalTime / stats.totalCalls) : 0,
    avgTokens: stats.totalCalls ? Math.round(stats.totalTokens / stats.totalCalls) : 0,
  })
})

// ==================== HOME ====================

app.get('/', (c) => c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NOVA AI</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#0d1117;color:#c9d1d9;text-align:center}h1{color:#58a6ff}.badge{background:#21262d;border-radius:8px;padding:2rem;max-width:500px}</style></head><body><div class="badge"><h1>NOVA AI</h1><p>API opérationnelle sur Cloudflare Workers</p><p style="font-size:0.9rem;color:#8b949e">Endpoints: /api/chat, /api/auth/*, /api/web-search, /api/knowledge/*</p></div></body></html>`))

export default app
