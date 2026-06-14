import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { stream } from 'hono/streaming'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { FRONTEND_HTML } from './frontend.js'

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

const PERSONAS = {
  optimist: { name: 'Optimiste', system: "Tu es un expert optimiste et créatif. Tu vois les opportunités, les forces, les possibilités." },
  critic: { name: 'Critique', system: "Tu es un expert critique et rigoureux. Tu identifies les failles, les risques, les incohérences." },
  synthesizer: { name: 'Synthétiseur', system: "Tu es un expert synthétiseur. Tu fusionnes les perspectives opposées en une réponse équilibrée." },
}

function authenticate(c) {
  const auth = c.req.header('Authorization')
  const token = auth?.split(' ')[1]
  if (!token) return { error: c.json({ error: 'token required' }, 401) }
  try { return { user: jwt.verify(token, c.env.JWT_SECRET || 'nova-secret-key-123') } }
  catch { return { error: c.json({ error: 'invalid token' }, 403) } }
}

// ==================== AI STREAMING ====================

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
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.5, maxOutputTokens: 8192 } }),
  })
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

async function* streamAI(messages, provider, apiKeys) {
  if (provider === 'xai' && apiKeys.xai) { for await (const c of streamXAI(messages, apiKeys.xai)) yield c }
  else if (provider === 'groq' && apiKeys.groq) { for await (const c of streamGroq(messages, apiKeys.groq)) yield c }
  else if (provider === 'gemini' && apiKeys.gemini) { for await (const c of streamGemini(messages, apiKeys.gemini)) yield c }
  else throw new Error(`Provider ${provider} not configured`)
}

async function fullAI(messages, provider, apiKeys) {
  let r = ''
  for await (const c of streamAI(messages, provider, apiKeys)) r += c
  return r
}

// ==================== AUTH ====================

app.post('/api/auth/register', async (c) => {
  const { username, password } = await parseBody(c)
  if (!username || !password) return c.json({ error: 'username and password required' }, 400)
  let users = await kvGet(c, 'users', [])
  if (users.find(u => u.username === username)) return c.json({ error: 'user already exists' }, 400)
  users.push({ username, password: await bcrypt.hash(password, 10) })
  await kvPut(c, 'users', users)
  return c.json({ status: 'ok' })
})

app.post('/api/auth/login', async (c) => {
  const { username, password } = await parseBody(c)
  let users = await kvGet(c, 'users', [])
  const user = users.find(u => u.username === username)
  if (!user || !(await bcrypt.compare(password, user.password))) return c.json({ error: 'invalid credentials' }, 400)
  const token = jwt.sign({ username }, c.env.JWT_SECRET || 'nova-secret-key-123', { expiresIn: '24h' })
  return c.json({ token, username })
})

app.get('/api/auth/me', (c) => {
  const { user, error } = authenticate(c)
  if (error) return error
  return c.json({ username: user.username })
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

app.post('/api/chat', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

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
RÈGLES : Réponds en français. Sois amical, concis et utile.
OUTILS : [TOOL:search] recherche → Cherche sur le web | [TOOL:url] https://... → Lit une page`

  const enriched = [{ role: 'system', content: SYSTEM_BEHAVIOR }, ...messages.filter(m => m.role !== 'system')]

  return stream(c, async (s) => {
    let full = ''
    s.write(`data: ${JSON.stringify({ type: 'meta', mode, provider })}\n\n`)
    try {
      for await (const chunk of streamAI(enriched, provider, apiKeys)) {
        full += chunk
        s.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`)
      }
      const elapsed = Date.now() - start
      const tokensEst = Math.round(full.length / 4)
      let stats = await kvGet(c, 'stats', { totalCalls: 0, totalTokens: 0, totalTime: 0 })
      stats.totalCalls++; stats.totalTokens += tokensEst; stats.totalTime += elapsed
      await kvPut(c, 'stats', stats)
      s.write(`data: ${JSON.stringify({ type: 'done', content: full, elapsed, mode, tokens: tokensEst })}\n\n`)
    } catch (err) {
      s.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`)
    }
  })
})

// ==================== TREE OF THOUGHTS ====================

app.post('/api/tot', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { prompt, provider = 'gemini' } = await parseBody(c)
  if (!prompt) return c.json({ error: 'prompt required' }, 400)

  const apiKeys = { gemini: c.env.GEMINI_API_KEY, groq: c.env.GROQ_API_KEY, xai: c.env.XAI_API_KEY }

  return stream(c, async (s) => {
    try {
      const thoughts = []
      for (let b = 0; b < 3; b++) {
        let text = ''
        for await (const chunk of streamAI([{ role: 'system', content: `Explorer la question sous un angle #${b + 1}` }, { role: 'user', content: prompt }], provider, apiKeys)) {
          text += chunk
        }
        const scoreText = await fullAI([{ role: 'system', content: 'Évalue de 0 à 10. Réponds UNIQUEMENT avec un nombre.' }, { role: 'user', content: `Question: ${prompt}\nRéponse: ${text}` }], provider, apiKeys)
        thoughts.push({ branch: b + 1, score: parseInt(scoreText) || 5, text })
      }
      thoughts.sort((a, b) => b.score - a.score)
      s.write(`data: ${JSON.stringify({ type: 'thoughts', data: thoughts })}\n\n`)
      let synthesis = ''
      for await (const chunk of streamAI([{ role: 'system', content: PERSONAS.synthesizer.system }, { role: 'user', content: `Question: ${prompt}\nMeilleures réponses:\n1: ${thoughts[0].text}\n2: ${thoughts[1]?.text || ''}\nSynthétise.` }], provider, apiKeys)) {
        synthesis += chunk
        s.write(`data: ${JSON.stringify({ type: 'synthesis', content: chunk })}\n\n`)
      }
      s.write(`data: ${JSON.stringify({ type: 'done', content: synthesis, thoughts })}\n\n`)
    } catch (err) { s.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`) }
  })
})

// ==================== DEBATE ====================

app.post('/api/debate', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { prompt, provider = 'gemini' } = await parseBody(c)
  if (!prompt) return c.json({ error: 'prompt required' }, 400)

  const apiKeys = { gemini: c.env.GEMINI_API_KEY, groq: c.env.GROQ_API_KEY, xai: c.env.XAI_API_KEY }

  return stream(c, async (s) => {
    try {
      const responses = {}
      for (const type of ['optimist', 'critic', 'synthesizer']) {
        const persona = PERSONAS[type]
        s.write(`data: ${JSON.stringify({ type: 'persona', name: persona.name })}\n\n`)
        let r = ''
        for await (const chunk of streamAI([{ role: 'system', content: persona.system }, { role: 'user', content: `Analyse: ${prompt}` }], provider, apiKeys)) {
          r += chunk
        }
        responses[type] = r
        s.write(`data: ${JSON.stringify({ type: 'persona_done', name: persona.name, content: r })}\n\n`)
      }
      s.write(`data: ${JSON.stringify({ type: 'synthesizing', content: 'Synthèse...' })}\n\n`)
      let syn = ''
      for await (const chunk of streamAI([{ role: 'system', content: PERSONAS.synthesizer.system }, { role: 'user', content: Object.entries(responses).map(([k, v]) => `${PERSONAS[k]?.name || k}: ${v}`).join('\n\n') + '\n\nProduis une réponse finale équilibrée.' }], provider, apiKeys)) {
        syn += chunk
        s.write(`data: ${JSON.stringify({ type: 'synthesis', content: chunk })}\n\n`)
      }
      s.write(`data: ${JSON.stringify({ type: 'done', content: syn, debate: responses })}\n\n`)
    } catch (err) { s.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`) }
  })
})

// ==================== SCAFFOLD ====================

app.post('/api/scaffold', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { prompt, provider = 'gemini' } = await parseBody(c)
  if (!prompt) return c.json({ error: 'prompt required' }, 400)

  const apiKeys = { gemini: c.env.GEMINI_API_KEY, groq: c.env.GROQ_API_KEY, xai: c.env.XAI_API_KEY }

  return stream(c, async (s) => {
    try {
      let full = ''
      for await (const chunk of streamAI([
        { role: 'system', content: 'Tu es un architecte logiciel. Génère une structure de projet complète : arborescence, fichiers principaux avec code, config.' },
        { role: 'user', content: prompt },
      ], provider, apiKeys)) {
        full += chunk
        s.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`)
      }
      s.write(`data: ${JSON.stringify({ type: 'done', content: full })}\n\n`)
    } catch (err) { s.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`) }
  })
})

// ==================== VISION ====================

app.post('/api/vision', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { image, prompt } = await parseBody(c)
  if (!image) return c.json({ error: 'image required' }, 400)

  const apiKey = c.env.GEMINI_API_KEY
  if (!apiKey) return c.json({ error: 'Gemini API key required for vision' }, 400)

  const userPrompt = prompt || 'Décris cette image en détail.'

  return stream(c, async (s) => {
    try {
      s.write(`data: ${JSON.stringify({ type: 'meta', content: 'Analyse via Gemini Vision...' })}\n\n`)
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inline_data: { mime_type: 'image/jpeg', data: image.replace(/^data:image\/\w+;base64,/, '') } },
            { text: userPrompt },
          ]}],
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        }),
      })
      const d = await r.json()
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || 'Aucune analyse disponible.'
      s.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`)
      s.write(`data: ${JSON.stringify({ type: 'done', content: text })}\n\n`)
    } catch (err) { s.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`) }
  })
})

// ==================== AGENT ====================

app.post('/api/agent', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { prompt, provider = 'gemini' } = await parseBody(c)
  if (!prompt) return c.json({ error: 'prompt required' }, 400)

  const apiKeys = { gemini: c.env.GEMINI_API_KEY, groq: c.env.GROQ_API_KEY, xai: c.env.XAI_API_KEY }

  return stream(c, async (s) => {
    try {
      s.write(`data: ${JSON.stringify({ type: 'phase', content: 'Planification...' })}\n\n`)
      const plan = await fullAI([{ role: 'system', content: 'Tu es un agent autonome. Décompose cet objectif en étapes claires et actionnables.' }, { role: 'user', content: prompt }], provider, apiKeys)
      s.write(`data: ${JSON.stringify({ type: 'plan', content: plan })}\n\n`)

      const steps = plan.split('\n').filter(l => l.match(/^\d+[\.\)]/)).slice(0, 5)
      for (let i = 0; i < steps.length; i++) {
        s.write(`data: ${JSON.stringify({ type: 'step', index: i, step: steps[i] })}\n\n`)
        const result = await fullAI([{ role: 'system', content: 'Exécute cette étape du plan.' }, { role: 'user', content: `Plan: ${prompt}\nÉtape: ${steps[i]}` }], provider, apiKeys)
        s.write(`data: ${JSON.stringify({ type: 'exec', content: result })}\n\n`)
      }

      s.write(`data: ${JSON.stringify({ type: 'synthesis', content: 'Synthèse...' })}\n\n`)
      const summary = await fullAI([{ role: 'system', content: 'Résume les résultats de chaque étape en une conclusion cohérente.' }, { role: 'user', content: `Objectif: ${prompt}\nÉtapes réalisées:\n${steps.join('\n')}` }], provider, apiKeys)
      s.write(`data: ${JSON.stringify({ type: 'done', content: summary })}\n\n`)
    } catch (err) { s.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`) }
  })
})

// ==================== WEB SEARCH ====================

app.post('/api/web-search', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { query } = await parseBody(c)
  if (!query) return c.json({ error: 'query required' }, 400)

  return stream(c, async (s) => {
    try {
      const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const html = await r.text()
      const results = []
      const regex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
      let match
      while ((match = regex.exec(html)) !== null && results.length < 8) {
        results.push({ url: match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0], title: match[2].replace(/<[^>]+>/g, '').trim(), snippet: match[3].replace(/<[^>]+>/g, '').trim() })
      }
      s.write(`data: ${JSON.stringify({ type: 'results', data: results })}\n\n`)
      s.write(`data: ${JSON.stringify({ type: 'done', query, count: results.length })}\n\n`)
    } catch (err) { s.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`) }
  })
})

// ==================== WEB FETCH ====================

app.post('/api/fetch-url', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { url } = await parseBody(c)
  if (!url) return c.json({ error: 'URL required' }, 400)

  return stream(c, async (s) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } })
      const html = await r.text()
      const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000)
      s.write(`data: ${JSON.stringify({ type: 'done', content: text, url })}\n\n`)
    } catch (err) { s.write(`data: ${JSON.stringify({ type: 'error', content: `Erreur: ${err.message}` })}\n\n`) }
  })
})

// ==================== KNOWLEDGE BASE ====================

app.post('/api/knowledge/add', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { name, content } = await parseBody(c)
  if (!name || !content) return c.json({ error: 'name and content required' }, 400)
  let kb = await kvGet(c, 'knowledge', [])
  kb.push({ name, content, addedAt: Date.now() })
  await kvPut(c, 'knowledge', kb)
  return c.json({ status: 'ok', total: kb.length })
})

app.get('/api/knowledge', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  let kb = await kvGet(c, 'knowledge', [])
  return c.json(kb.map(k => ({ name: k.name, size: k.content.length, addedAt: k.addedAt })))
})

app.delete('/api/knowledge', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { name } = await parseBody(c).catch(() => ({}))
  let kb = await kvGet(c, 'knowledge', [])
  if (name) { kb = kb.filter(k => k.name !== name) } else { kb = [] }
  await kvPut(c, 'knowledge', kb)
  return c.json({ status: 'ok', total: kb.length })
})

app.get('/api/knowledge/search', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

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
  const { user, error } = authenticate(c)
  if (error) return error
  return c.json(await kvGet(c, 'memory', {}))
})

app.put('/api/memory', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const updates = await parseBody(c)
  let memory = await kvGet(c, 'memory', {})
  Object.assign(memory, updates)
  await kvPut(c, 'memory', memory)
  return c.json({ status: 'ok', memory })
})

app.post('/api/memory/extract', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { conversation } = await parseBody(c)
  if (!conversation) return c.json({ error: 'conversation required' }, 400)

  const apiKeys = { gemini: c.env.GEMINI_API_KEY, groq: c.env.GROQ_API_KEY, xai: c.env.XAI_API_KEY }
  const provider = 'gemini'
  try {
    const text = await fullAI([
      { role: 'system', content: 'Extrais les informations personnelles de cette conversation. Format JSON: {"nom":"","technologies":[],"projets":[],"preferences":"","contexte":""}' },
      { role: 'user', content: conversation.slice(0, 3000) },
    ], provider, apiKeys)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0])
      let memory = await kvGet(c, 'memory', {})
      if (extracted.nom) memory.nom = extracted.nom
      if (extracted.technologies?.length) memory.technologies = [...new Set([...(memory.technologies || []), ...extracted.technologies])]
      if (extracted.projets?.length) memory.projets = [...new Set([...(memory.projets || []), ...extracted.projets])]
      if (extracted.preferences) memory.preferences = extracted.preferences
      if (extracted.contexte) memory.contexte = extracted.contexte
      await kvPut(c, 'memory', memory)
      return c.json({ status: 'ok', extracted, memory })
    }
    return c.json({ status: 'ok', extracted: null })
  } catch (err) { return c.json({ error: err.message }, 500) }
})

// ==================== GRAPH ====================

app.get('/api/graph', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error
  return c.json(await kvGet(c, 'graph', { nodes: [], edges: [] }))
})

app.post('/api/graph/extract', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  const { text } = await parseBody(c)
  if (!text) return c.json({ error: 'text required' }, 400)

  const apiKeys = { gemini: c.env.GEMINI_API_KEY, groq: c.env.GROQ_API_KEY, xai: c.env.XAI_API_KEY }
  const provider = 'gemini'
  try {
    const response = await fullAI([
      { role: 'system', content: 'Extrais les entités et leurs relations. Réponds UNIQUEMENT en JSON: {"entities":["..."],"relations":[{"source":"...","target":"...","label":"..."}]}' },
      { role: 'user', content: text.slice(0, 3000) },
    ], provider, apiKeys)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0])
      let graph = await kvGet(c, 'graph', { nodes: [], edges: [] })
      for (const e of (data.entities || [])) { if (!graph.nodes.find(n => n.id === e)) graph.nodes.push({ id: e, label: e, group: 'entity' }) }
      for (const rel of (data.relations || [])) graph.edges.push({ source: rel.source, target: rel.target, label: rel.label })
      await kvPut(c, 'graph', graph)
      return c.json({ status: 'ok', entities: data.entities, relations: data.relations, nodeCount: graph.nodes.length })
    }
    return c.json({ status: 'ok', entities: [], relations: [] })
  } catch (err) { return c.json({ error: err.message }, 500) }
})

app.post('/api/graph/clear', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error
  await kvPut(c, 'graph', { nodes: [], edges: [] })
  return c.json({ status: 'ok' })
})

// ==================== INFO ====================

app.get('/api/info', (c) => {
  return c.json({
    gemini: !!c.env.GEMINI_API_KEY,
    groq: !!c.env.GROQ_API_KEY,
    xai: !!c.env.XAI_API_KEY,
    workers: true,
    version: '2.0',
  })
})

// ==================== STATS ====================

app.get('/api/stats', async (c) => {
  const { user, error } = authenticate(c)
  if (error) return error

  let stats = await kvGet(c, 'stats', { totalCalls: 0, totalTokens: 0, totalTime: 0 })
  return c.json({
    totalCalls: stats.totalCalls || 0,
    totalTokens: stats.totalTokens || 0,
    totalTime: stats.totalTime || 0,
    avgTime: stats.totalCalls ? Math.round(stats.totalTime / stats.totalCalls) : 0,
    avgTokens: stats.totalCalls ? Math.round(stats.totalTokens / stats.totalCalls) : 0,
    knowledgeSize: (await kvGet(c, 'knowledge', [])).length,
  })
})

// ==================== UNSUPPORTED ENDPOINTS ====================

const unsupported = (msg) => (c) => c.json({ error: msg }, 501)

app.post('/api/terminal', async (c) => { const a = authenticate(c); if (a.error) return a.error; return c.json({ error: 'Terminal requires Node.js (child_process) — indisponible sur Workers' }, 501) })
app.post('/api/web-nav', async (c) => { const a = authenticate(c); if (a.error) return a.error; return c.json({ error: 'Navigation requires a desktop browser — indisponible sur Workers' }, 501) })
app.post('/api/parse-file', async (c) => { const a = authenticate(c); if (a.error) return a.error; return c.json({ error: 'File parsing requires Node.js filesystem — indisponible sur Workers' }, 501) })

// ==================== FRONTEND ====================

app.get('/', (c) => c.html(FRONTEND_HTML))
app.get('/index.html', (c) => c.html(FRONTEND_HTML))
app.get('/app.js', (c) => c.text('// app.js is inlined in the HTML', 200, { 'Content-Type': 'text/javascript' }))
app.get('/crypto-utils.js', (c) => c.text('// crypto-utils.js is inlined in the HTML', 200, { 'Content-Type': 'text/javascript' }))

export default app
