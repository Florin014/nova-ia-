// NOVA AI - Main Application

const STATE = {
  token: localStorage.getItem('nova-token'),
  user: null,
  messages: [],
  debateMode: false,
  autoReflect: false,
  autoTTS: false,
  pyodideReady: false,
  pyodide: null,
  isStreaming: false,
  files: [],
  currentChatId: null,
  chats: {},
  settings: {
    cryptoPass: '',
    remoteHost: '',
    geminiKey: '',
    provider: 'ollama',
  },
  availableModels: [],
  remoteModels: [],
  selectedModel: null,
};

let recognition = null;
let isListening = false;

// ==================== API HELPERS ====================

async function apiFetch(url, options = {}) {
  const headers = {
    ...options.headers,
    'Authorization': STATE.token ? `Bearer ${STATE.token}` : undefined,
  };
  return fetch(url, { ...options, headers });
}

// ==================== AUTH & CAPTCHA = :D ====================

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = isPassword
    ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"/></svg>'
    : '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
}

function toggleAuth(showLogin) {
  document.getElementById('auth-login-view').classList.toggle('hidden', !showLogin);
  document.getElementById('auth-register-view').classList.toggle('hidden', showLogin);
  if (!showLogin) loadCaptcha();
}

async function loadCaptcha() {
  try {
    const r = await apiFetch('/api/captcha/task');
    const task = await r.json();
    document.getElementById('captcha-task-id').value = task.id;
    document.getElementById('captcha-task-content').textContent = task.content;
    
    const optsDiv = document.getElementById('captcha-options');
    optsDiv.innerHTML = '';
    task.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'px-3 py-2 rounded-lg text-xs border border-zinc-800 text-zinc-400 hover:border-zinc-600 transition';
      btn.textContent = opt;
      btn.onclick = () => selectCaptchaOption(btn, opt);
      optsDiv.appendChild(btn);
      if (i === 0) selectCaptchaOption(btn, opt);
    });
  } catch {}
}

function selectCaptchaOption(btn, opt) {
  document.querySelectorAll('#captcha-options button').forEach(b => b.classList.remove('bg-white', 'text-black', 'border-white'));
  btn.classList.add('bg-white', 'text-black', 'border-white');
  document.getElementById('captcha-selected-answer').value = opt;
}

async function register() {
  const username = document.getElementById('reg-username').value;
  const password = document.getElementById('reg-password').value;
  const captchaId = parseInt(document.getElementById('captcha-task-id').value);
  const captchaAnswer = document.getElementById('captcha-selected-answer').value;

  if (!username || !password || !captchaAnswer) return alert('Veuillez remplir tous les champs et le captcha');

  try {
    const r = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, captchaId, captchaAnswer })
    });
    const res = await r.json();
    if (res.error) return alert(res.error);
    alert('Compte créé ! Connectez-vous.');
    toggleAuth(true);
  } catch (err) { alert(err.message); }
}

async function login() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  if (!username || !password) return;

  try {
    const r = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const res = await r.json();
    if (res.error) return alert(res.error);

    STATE.token = res.token;
    STATE.user = res.username;
    localStorage.setItem('nova-token', res.token);
    document.getElementById('auth-overlay').classList.add('hidden');
    // Refresh things
    await checkAuth();
  } catch (err) { alert(err.message); }
}

async function checkAuth() {
  try {
    const r = await apiFetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    if (!r.ok) {
      logout();
      return;
    }
    const user = await r.json();
    STATE.user = user.username;
    document.getElementById('auth-overlay').classList.add('hidden');
    document.getElementById('status-badge').textContent = `Connecté: ${user.username}`;
  } catch { logout(); }
}

function logout() {
  STATE.token = null;
  STATE.user = null;
  localStorage.removeItem('nova-token');
  document.getElementById('auth-overlay').classList.remove('hidden');
  loadCaptcha();
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  if (!STATE.token) {
    document.getElementById('auth-overlay').classList.remove('hidden');
    loadCaptcha();
  } else {
    await checkAuth();
  }

  await loadSettings();
  await CryptoUtils.init(STATE.settings.cryptoPass || 'nova-ai-default-key-2024');
  await loadChats();
  initPyodide();
  initVoice();
  refreshModelList();

  STATE.debateMode = localStorage.getItem('nova-debate') === 'true';
  STATE.autoReflect = localStorage.getItem('nova-reflect') === 'true';
  STATE.autoTTS = localStorage.getItem('nova-tts') === 'true';
  updateDebateButton();
  updateReflectButton();
  updateTTSButton();

  const saved = localStorage.getItem('nova-settings');
  if (saved) {
    try { STATE.settings = { ...STATE.settings, ...JSON.parse(saved) }; } catch {}
  }

  if (STATE.settings.remoteHost) {
    document.getElementById('status-badge').textContent = 'Remote';
    document.getElementById('status-badge').style.background = 'rgba(255, 193, 7, 0.2)';
    document.getElementById('status-badge').style.color = '#ffd43b';
  }
});

// ==================== TAB SWITCHING ====================

function switchTab(name) {
  document.querySelectorAll('.tab-view').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  if (name === 'dashboard') refreshStats();
  if (name === 'rag') refreshRAGFiles();
  if (name === 'memory') loadMemory();
  if (name === 'graph') loadGraph();
  document.getElementById('prompt-input')?.focus();
}

// ==================== VOICE (Speech Recognition) ====================

function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    document.getElementById('voice-btn').style.opacity = '0.3';
    document.getElementById('voice-btn').title = 'Voice non supportée';
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'fr-FR';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    document.getElementById('prompt-input').value = text;
    document.getElementById('voice-btn').classList.remove('blink');
    document.getElementById('voice-btn').style.color = '';
    isListening = false;
    sendMessage();
  };

  recognition.onerror = () => {
    document.getElementById('voice-btn').classList.remove('blink');
    document.getElementById('voice-btn').style.color = '#f44336';
    setTimeout(() => { document.getElementById('voice-btn').style.color = ''; }, 2000);
    isListening = false;
  };

  recognition.onend = () => {
    document.getElementById('voice-btn').classList.remove('blink');
    document.getElementById('voice-btn').style.color = '';
    isListening = false;
  };
}

function toggleVoice() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
    document.getElementById('voice-btn').classList.remove('blink');
    isListening = false;
    return;
  }
  try {
    recognition.start();
    isListening = true;
    document.getElementById('voice-btn').style.color = '#4caf50';
    document.getElementById('voice-btn').classList.add('blink');
  } catch {}
}

// ==================== TEXT-TO-SPEECH ====================

function speak(text) {
  if (!STATE.autoTTS) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, '').slice(0, 500));
  utterance.lang = 'fr-FR';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

function toggleTTS() {
  STATE.autoTTS = !STATE.autoTTS;
  localStorage.setItem('nova-tts', STATE.autoTTS);
  updateTTSButton();
}

function updateTTSButton() {
  const btn = document.getElementById('tts-btn');
  btn.style.borderColor = STATE.autoTTS ? '#4caf50' : '';
  btn.style.color = STATE.autoTTS ? '#4caf50' : '';
}

// ==================== PYODIDE (Python Sandbox) ====================

async function initPyodide() {
  try {
    document.getElementById('pyodide-btn').textContent = 'Pyodide: Loading...';
    STATE.pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/' });
    STATE.pyodideReady = true;
    document.getElementById('pyodide-btn').textContent = 'Python';
    document.getElementById('pyodide-btn').style.color = '#4caf50';
  } catch (err) {
    console.error('[NOVA] Pyodide failed:', err);
    document.getElementById('pyodide-btn').textContent = 'Python:Err';
    document.getElementById('pyodide-btn').style.color = '#f44336';
  }
}

function togglePyodide() {
  if (!STATE.pyodideReady) { addSystemMessage('Pyodide is loading or failed to load.'); return; }
  const input = document.getElementById('prompt-input');
  if (input.value.startsWith('>>> ')) {
    input.value = input.value.slice(4);
    document.getElementById('pyodide-btn').style.borderColor = '';
  } else {
    input.value = '>>> ' + input.value;
    document.getElementById('pyodide-btn').style.borderColor = '#4caf50';
  }
  input.focus();
}

async function runPython(code) {
  if (!STATE.pyodideReady) return 'Pyodide is not ready.';
  try {
    STATE.pyodide.setStdout({ batched: (text) => { addStreamContent('system', text); } });
    const result = await STATE.pyodide.runPythonAsync(code);
    return result === undefined ? 'Code executed successfully.' : String(result);
  } catch (err) {
    return `Python Error: ${err.message}`;
  }
}

// ==================== MESSAGE HANDLING ====================

async function sendMessage() {
  const input = document.getElementById('prompt-input');
  const text = input.value.trim();
  if (!text || STATE.isStreaming) return;

  if (text.startsWith('>>> ')) {
    const code = text.slice(4);
    input.value = '';
    addMessage('user', text);
    const pythonMsg = addMessage('assistant', '');
    const result = await runPython(code);
    pythonMsg.innerHTML = `<pre class="text-sm text-green-400">${escapeHtml(result)}</pre>`;
    pythonMsg.classList.add('fade-in');
    saveState();
    return;
  }

  input.value = '';
  addMessage('user', text);

  if (STATE.files.length > 0) {
    for (const file of STATE.files) {
      addMessage('system', `[Attached: ${file.name} (${file.size} bytes)]\n\`\`\`\n${file.content.slice(0, 2000)}${file.content.length > 2000 ? '\n... [truncated]' : ''}\n\`\`\``);
    }
    STATE.files = [];
    updateFilePreview();
  }

  const assistantMsg = addMessage('assistant', '');
  STATE.isStreaming = true;
  document.getElementById('send-btn').style.opacity = '0.5';

  try {
    if (text.startsWith('/search ')) {
      await streamSearch(assistantMsg, text.slice(8));
    } else if (STATE.debateMode) {
      await streamDebate(assistantMsg, text);
    } else {
      await streamChat(assistantMsg, text);
    }
  } catch (err) {
    assistantMsg.innerHTML = `<span class="text-red-400">Error: ${escapeHtml(err.message)}</span>`;
  }

  STATE.isStreaming = false;
  document.getElementById('send-btn').style.opacity = '1';
  saveState();
}

// ==================== SEARCH & SUMMARIZE ====================

async function streamSearch(assistantMsg, query) {
  let full = `<div class="text-xs text-zinc-500 mb-2">🔍 Recherche : ${escapeHtml(query)}</div>`;
  assistantMsg.innerHTML = full;
  document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;

  try {
    // Step 1: Search
    const searchRes = await apiFetch('/api/web-search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    });
    const reader = searchRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let results = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (const line of buf.split('\n')) {
        buf = ''; const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(t.slice(6));
          if (d.type === 'results') results = d.data || [];
        } catch {}
      }
    }

    if (!results.length) {
      assistantMsg.innerHTML = full + '<div class="text-zinc-500 text-sm">Aucun résultat trouvé.</div>';
      STATE.messages.push({ role: 'user', content: `/search ${query}` });
      STATE.messages.push({ role: 'assistant', content: 'Aucun résultat trouvé.' });
      return;
    }

    full += `<div class="text-xs text-zinc-500 mb-2">${results.length} résultats · Récupération du contenu...</div>`;
    assistantMsg.innerHTML = full;
    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;

    // Step 2: Fetch top 3 results
    let combinedContent = '';
    const topUrls = results.slice(0, 3);

    for (const r of topUrls) {
      try {
        const fetchRes = await apiFetch('/api/fetch-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: r.url }),
        });
        const fr = fetchRes.body.getReader();
        const fd = new TextDecoder();
        let fb = '';
        while (true) {
          const { done, value } = await fr.read();
          if (done) break;
          fb += fd.decode(value, { stream: true });
          for (const fl of fb.split('\n')) {
            fb = ''; const ft = fl.trim();
            if (!ft || !ft.startsWith('data: ')) continue;
            try {
              const fj = JSON.parse(ft.slice(6));
              if (fj.type === 'done' && fj.content) {
                combinedContent += `\n\n## Source: ${r.title}\n${fj.content.slice(0, 2000)}`;
              }
            } catch {}
          }
        }
      } catch {}
    }

    // Step 3: Summarize with AI
    full += '<div class="text-xs text-zinc-500 mb-2 blink">Résumé en cours...</div>';
    assistantMsg.innerHTML = full;

    const chatRes = await apiFetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Tu es un assistant de recherche. Résume ces informations de façon claire et structurée. Cite les sources. Réponds en français.' },
          { role: 'user', content: `Recherche: ${query}\n\nContenu trouvé:\n${combinedContent.slice(0, 6000)}\n\nFais un résumé avec les points clés et les sources.` },
        ],
        reflect: false,
        provider: STATE.settings.provider || 'ollama',
        groqKey: STATE.settings.groqKey || undefined,
        geminiKey: STATE.settings.geminiKey || undefined,
      }),
    });

    const cr = chatRes.body.getReader();
    const cd = new TextDecoder();
    let cb = '';
    let summary = '';

    while (true) {
      const { done, value } = await cr.read();
      if (done) break;
      cb += cd.decode(value, { stream: true });
      for (const cl of cb.split('\n')) {
        cb = ''; const ct = cl.trim();
        if (!ct || !ct.startsWith('data: ')) continue;
        try {
          const cj = JSON.parse(ct.slice(6));
          if (cj.type === 'chunk') summary += cj.content;
          if (cj.type === 'done') {
            assistantMsg.innerHTML = formatContent(`🔍 **Recherche : ${query}**\n\n${summary}\n\n---\n*Sources: ${topUrls.map(r => r.title).join(', ')}*`, 'assistant');
          }
        } catch {}
      }
    }

    STATE.messages.push({ role: 'user', content: `/search ${query}` });
    STATE.messages.push({ role: 'assistant', content: summary });
  } catch (err) {
    assistantMsg.innerHTML += `<div class="text-red-400 text-sm mt-2">${escapeHtml(err.message)}</div>`;
  }
}

// ==================== MAIN CHAT STREAM ====================

async function streamChat(assistantMsg, userMessage) {
  const messages = [
    ...STATE.messages.filter(m => m.role !== 'system').slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: userMessage }
  ];

  const response = await apiFetch('/api/chat', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${STATE.token}`
    },
    body: JSON.stringify({ 
      messages, 
      model: STATE.selectedModel || undefined, 
      reflect: STATE.autoReflect, 
      host: STATE.settings.remoteHost || undefined, 
      provider: STATE.settings.provider || 'ollama', 
      groqKey: STATE.settings.groqKey || undefined, 
      geminiKey: STATE.settings.geminiKey || undefined,
      xaiKey: STATE.settings.xaiKey || undefined
    }),
  });

  if (!response.ok) throw new Error(`Server error: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let currentContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        switch (data.type) {
          case 'meta':
            document.getElementById('model-indicator').textContent = `Mode: ${data.mode}`;
            document.getElementById('mode-indicator').textContent = data.vague ? '❓ Questions...' : (data.rag ? '📚 RAG+Chat' : 'Chat');
            const ragBadge = document.getElementById('rag-badge');
            if (data.rag) { ragBadge.classList.remove('hidden'); } else { ragBadge.classList.add('hidden'); }
            break;
          case 'chunk':
            currentContent += data.content;
            renderStreamingContent(assistantMsg, currentContent);
            break;
          case 'tool':
            currentContent += `\n\n<span class="text-xs text-blue-500">[Exécution outil...]</span>\n\n`;
            renderStreamingContent(assistantMsg, currentContent);
            break;
          case 'reflect':
            currentContent += '\n\n<span class="text-yellow-600 text-xs">[Auto-réflexion...]</span>\n\n';
            renderStreamingContent(assistantMsg, currentContent);
            break;
          case 'done':
            fullContent = data.content;
            renderStreamingContent(assistantMsg, fullContent);
            document.getElementById('tokens-indicator').textContent = `Time: ${(data.elapsed / 1000).toFixed(1)}s`;
            if (data.halluReport) {
              addSystemMessage(`[Détection Hallucination]\n${data.halluReport}`);
            }
            if (STATE.autoTTS) speak(fullContent);
            break;
          case 'error':
            throw new Error(data.content);
        }
      } catch (e) { if (e.message.startsWith('Server')) throw e; }
    }
  }

  STATE.messages.push({ role: 'user', content: userMessage });
  STATE.messages.push({ role: 'assistant', content: fullContent || currentContent });
}

// ==================== EXPORT CONVERSATION ====================

async function exportChat(format) {
  if (!STATE.messages.length) { addSystemMessage('[Export] Aucun message à exporter.'); return; }

  const text = STATE.messages
    .filter(m => m.content)
    .map(m => `${m.role === 'user' ? '👤 Vous' : '🤖 NOVA'}:\n${m.content}`)
    .join('\n\n---\n\n');

  if (format === 'clipboard') {
    try {
      await navigator.clipboard.writeText(text);
      addSystemMessage('[Export] Conversation copiée dans le presse-papier !');
    } catch { addSystemMessage('[Export] Erreur copie.'); }
    return;
  }

  const title = STATE.chats[STATE.currentChatId]?.title || 'NOVA_Conversation';
  const filename = `${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}_${Date.now()}`;

  if (format === 'markdown') {
    const md = `# NOVA AI - Conversation\n\n${text}`;
    downloadFile(md, `${filename}.md`, 'text/markdown');
  } else if (format === 'json') {
    const json = JSON.stringify(STATE.messages.filter(m => m.content), null, 2);
    downloadFile(json, `${filename}.json`, 'application/json');
  } else if (format === 'txt') {
    downloadFile(text, `${filename}.txt`, 'text/plain');
  }

  addSystemMessage(`[Export] Conversation exportée (${format})`);
}

function toggleExportMenu() {
  const menu = document.getElementById('export-dropdown');
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    setTimeout(() => { menu.classList.add('hidden'); }, 3000);
  }
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function streamDebate(assistantMsg, prompt) {
  const response = await apiFetch('/api/debate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model: STATE.selectedModel || undefined, host: STATE.settings.remoteHost || undefined, provider: STATE.settings.provider || 'ollama' }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        switch (data.type) {
          case 'persona':
            fullContent += `\n\n### ${data.name}\n\n`;
            renderStreamingContent(assistantMsg, fullContent);
            break;
          case 'persona_done':
            fullContent += `${data.content}\n\n---\n`;
            renderStreamingContent(assistantMsg, fullContent);
            break;
          case 'synthesizing':
            fullContent += '\n\n### Synthèse\n\n';
            renderStreamingContent(assistantMsg, fullContent);
            break;
          case 'synthesis':
            fullContent += data.content;
            renderStreamingContent(assistantMsg, fullContent);
            break;
          case 'done':
            fullContent = data.content;
            renderStreamingContent(assistantMsg, fullContent);
            break;
        }
      } catch {}
    }
  }

  STATE.messages.push({ role: 'user', content: prompt });
  STATE.messages.push({ role: 'assistant', content: fullContent });
}

// ==================== TREE OF THOUGHTS ====================

async function runToT() {
  const input = document.getElementById('tot-input');
  const prompt = input.value.trim();
  if (!prompt) return;

  const resultsDiv = document.getElementById('tot-results');
  resultsDiv.innerHTML = '<div class="text-center py-8 text-zinc-500"><span class="blink">Exploration en cours...</span></div>';

  try {
    const response = await apiFetch('/api/tot', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ 
        prompt, 
        provider: STATE.settings.provider || 'ollama',
        groqKey: STATE.settings.groqKey || undefined,
        geminiKey: STATE.settings.geminiKey || undefined,
        xaiKey: STATE.settings.xaiKey || undefined
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let thoughts = [];
    let synthesis = '';

    resultsDiv.innerHTML = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          switch (data.type) {
            case 'thoughts':
              thoughts = data.data || [];
              resultsDiv.innerHTML = '<div class="text-zinc-500 text-sm mb-4">Branches explorées :</div>';
              for (const t of thoughts) {
                const cls = t.score >= 7 ? 'high' : t.score >= 4 ? 'medium' : 'low';
                const label = t.score >= 7 ? 'Haute' : t.score >= 4 ? 'Moyenne' : 'Basse';
                resultsDiv.innerHTML += `
                  <div class="tot-branch ${cls} mb-3">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-xs font-medium text-zinc-400">Branche ${t.branch}</span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full" style="background:rgba(255,255,255,0.05);color:${cls === 'high' ? '#4caf50' : cls === 'medium' ? '#ffa726' : '#f44336'}">${label} (${t.score}/10)</span>
                    </div>
                    <div class="text-xs text-zinc-400 leading-relaxed">${formatContent(t.text.slice(0, 400), 'assistant')}</div>
                  </div>`;
              }
              break;
            case 'synthesis':
              synthesis += data.content;
              const synEl = resultsDiv.querySelector('#tot-synthesis') || (() => {
                const el = document.createElement('div');
                el.id = 'tot-synthesis';
                el.className = 'mt-4 pt-4 border-t border-zinc-800';
                el.innerHTML = '<div class="text-sm font-medium text-white mb-2">Synthèse Finale</div><div class="text-sm text-zinc-300 leading-relaxed"></div>';
                resultsDiv.appendChild(el);
                return el.querySelector('div:last-child');
              })();
              synEl.innerHTML = formatContent(synthesis, 'assistant');
              break;
            case 'done':
              input.value = '';
              if (STATE.autoTTS) speak(synthesis);
              break;
          }
        } catch {}
      }
    }
  } catch (err) {
    resultsDiv.innerHTML = `<div class="text-red-400 text-sm">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ==================== RAG / KNOWLEDGE BASE ====================

async function handleRAGUpload(event) {
  const files = event.target.files;
  if (!files.length) return;

  for (const file of files) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target.result;
      const name = file.name;

      try {
        const r = await apiFetch('/api/knowledge/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content: content.slice(0, 100000) }),
        });
        const d = await r.json();
        addSystemMessage(`[RAG] Ajouté: ${name}`);
        refreshRAGFiles();
      } catch (err) {
        addSystemMessage(`[RAG] Erreur: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }
  event.target.value = '';
}

async function refreshRAGFiles() {
  try {
    const r = await apiFetch('/api/knowledge');
    const files = await r.json();
    const div = document.getElementById('rag-files');
    if (files.length === 0) {
      div.textContent = 'Aucun fichier indexé.';
      return;
    }
    div.innerHTML = files.map(f => `
      <div class="rk flex items-center justify-between text-xs mb-1">
        <span class="text-zinc-400">${escapeHtml(f.name)}</span>
        <span class="text-zinc-600">${(f.size / 1024).toFixed(1)} KB</span>
      </div>`).join('');
  } catch {}
}

async function searchRAG() {
  const q = document.getElementById('rag-search').value.trim();
  if (!q) return;

  const div = document.getElementById('rag-search-results');
  div.innerHTML = '<div class="text-zinc-500 text-sm">Recherche...</div>';

  try {
    const r = await fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}`);
    const data = await r.json();
    if (!data.results?.length) {
      div.innerHTML = '<div class="text-zinc-600 text-sm">Aucun résultat.</div>';
      return;
    }
    div.innerHTML = data.results.map(r => `
      <div class="rk">
        <div class="text-xs text-zinc-400 font-medium">${escapeHtml(r.name)}</div>
        <div class="text-xs text-zinc-600 mt-1">${escapeHtml(r.content.slice(0, 300))}</div>
        <div class="text-[10px] text-zinc-700 mt-1">Score: ${r.score}</div>
      </div>`).join('');
  } catch (err) {
    div.innerHTML = `<div class="text-red-400 text-sm">${err.message}</div>`;
  }
}

async function clearRAG() {
  if (!confirm('Effacer toute la base de connaissances ?')) return;
  try {
    await apiFetch('/api/knowledge', { method: 'DELETE' });
    refreshRAGFiles();
    document.getElementById('rag-search-results').innerHTML = '';
    addSystemMessage('[RAG] Base effacée.');
  } catch {}
}

// ==================== AUTO-SCAFFOLDING ====================

async function runScaffold() {
  const input = document.getElementById('scaffold-input');
  const description = input.value.trim();
  if (!description) return;

  const resultsDiv = document.getElementById('scaffold-results');
  resultsDiv.innerHTML = '<div class="text-center py-8 text-zinc-500"><span class="blink">Génération de l\'architecture...</span></div>';

  try {
    const response = await apiFetch('/api/scaffold', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ 
        prompt, 
        provider: STATE.settings.provider || 'ollama',
        groqKey: STATE.settings.groqKey || undefined,
        geminiKey: STATE.settings.geminiKey || undefined,
        xaiKey: STATE.settings.xaiKey || undefined
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    resultsDiv.innerHTML = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          switch (data.type) {
            case 'chunk':
              full += data.content;
              resultsDiv.innerHTML = formatContent(full, 'assistant');
              break;
            case 'done':
              full = data.content;
              resultsDiv.innerHTML = formatContent(full, 'assistant');
              input.value = '';
              if (STATE.autoTTS) speak(full.slice(0, 300));
              break;
          }
        } catch {}
      }
    }
  } catch (err) {
    resultsDiv.innerHTML = `<div class="text-red-400 text-sm">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ==================== DASHBOARD / STATS ====================

async function refreshStats() {
  try {
    const r = await apiFetch('/api/stats');
    const s = await r.json();
    document.getElementById('stat-calls').textContent = s.totalCalls || 0;
    document.getElementById('stat-avgtime').textContent = `${s.avgTime || 0}ms`;
    document.getElementById('stat-tokens').textContent = s.totalTokens ? Math.round(s.totalTokens) : 0;
    document.getElementById('stat-rag').textContent = s.knowledgeSize || 0;

    const modesDiv = document.getElementById('stat-modes');
    if (s.callsByMode && Object.keys(s.callsByMode).length) {
      modesDiv.innerHTML = Object.entries(s.callsByMode).map(([k, v]) => `<div class="flex justify-between py-0.5"><span>${k}</span><span class="text-zinc-400">${v}</span></div>`).join('');
    } else { modesDiv.textContent = 'Aucune donnée.'; }

    const provDiv = document.getElementById('stat-providers');
    if (s.callsByProvider && Object.keys(s.callsByProvider).length) {
      provDiv.innerHTML = Object.entries(s.callsByProvider).map(([k, v]) => `<div class="flex justify-between py-0.5"><span>${k}</span><span class="text-zinc-400">${v}</span></div>`).join('');
    } else { provDiv.textContent = 'Aucune donnée.'; }

    try {
      const mr = await apiFetch('/api/info');
      const mi = await mr.json();
      const modelsDiv = document.getElementById('stat-models');
      if (mi.ollama?.models?.length) {
        modelsDiv.innerHTML = mi.ollama.models.map(m => `<div class="text-zinc-400 py-0.5">${m}</div>`).join('');
      } else {
        modelsDiv.textContent = 'Aucun modèle trouvé.';
      }
    } catch {}
  } catch {}
}

// ==================== UI HELPERS ====================

function addMessage(role, content) {
  const messagesDiv = document.getElementById('messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'} fade-in`;

  const bubble = document.createElement('div');
  bubble.className = `max-w-[80%] rounded-2xl px-4 py-3 msg-${role}`;

  if (content) {
    bubble.innerHTML = formatContent(content, role);
  } else {
    bubble.innerHTML = '<div class="flex gap-1"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
  }

  msgDiv.appendChild(bubble);
  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  return bubble;
}

function addSystemMessage(content) {
  return addMessage('system', content);
}

function addStreamContent(role, content) {
  const messagesDiv = document.getElementById('messages');
  const last = messagesDiv.lastElementChild;
  if (last) {
    const bubble = last.querySelector('div:first-child') || last;
    if (bubble.classList.contains(`msg-${role}`)) {
      bubble.innerHTML = formatContent(content, role);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      return;
    }
  }
  addMessage(role, content);
}

function renderStreamingContent(element, content) {
  element.innerHTML = formatContent(content, 'assistant');
  document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
}

function formatContent(content, role) {
  if (!content) return '';

  let html = content;

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<div class="code-block"><div class="text-xs text-zinc-500 px-4 pt-2">${lang || 'code'}</div><pre><code class="text-sm">${escapeHtml(code.trim())}</code></pre></div>`;
  });

  html = html.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded text-xs" style="background:rgba(255,255,255,0.08);">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\n\n/g, '</p><p class="mb-2">');
  html = html.replace(/\n/g, '<br>');

  return `<p class="mb-2">${html}</p>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function handleKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

// ==================== FILE HANDLING ====================

async function handleFileUpload(event) {
  const files = event.target.files;
  if (!files.length) return;

  for (const file of files) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      let content = e.target.result;
      if (file.name.endsWith('.pdf')) {
        content = '[PDF file uploaded. PDF parsing requires backend processing.]';
      }
      STATE.files.push({ name: file.name, size: file.size, content: content.slice(0, 50000) });
      updateFilePreview();
    };

    if (file.name.endsWith('.pdf')) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  }
  event.target.value = '';
}

function updateFilePreview() {
  const preview = document.getElementById('file-preview');
  const name = document.getElementById('file-name');
  const size = document.getElementById('file-size');

  if (STATE.files.length === 0) { preview.classList.add('hidden'); return; }

  preview.classList.remove('hidden');
  const totalSize = STATE.files.reduce((acc, f) => acc + f.size, 0);
  name.textContent = `${STATE.files.length} file(s)`;
  size.textContent = `${(totalSize / 1024).toFixed(1)} KB`;
}

function clearFiles() { STATE.files = []; updateFilePreview(); }

// ==================== SETTINGS ====================

function setProvider(name) {
  STATE.settings.provider = name;
  const btns = ['ollama', 'gemini', 'groq', 'xai'];
  btns.forEach(b => {
    const el = document.getElementById(`prov-${b}`);
    if (el) {
      el.style.background = name === b ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
      el.style.color = name === b ? '#fff' : 'gray';
    }
  });

  document.getElementById('gemini-key-section').classList.toggle('hidden', name !== 'gemini');
  document.getElementById('groq-key-section').classList.toggle('hidden', name !== 'groq');
  document.getElementById('xai-key-section').classList.toggle('hidden', name !== 'xai');
  
  const labels = { ollama: 'Local', gemini: 'Gemini', groq: 'Groq ⚡', xai: 'Grok' };
  document.getElementById('provider-label').textContent = labels[name] || 'Local';
}

async function testRemoteHost() {
  const host = document.getElementById('settings-remote-host').value.trim();
  const status = document.getElementById('remote-status');
  if (!host) { status.textContent = 'Enter a URL'; return; }
  try {
    status.textContent = 'Testing...';
    status.style.color = '#aaa';
    const r = await fetch(`/api/models?host=${encodeURIComponent(host)}`);
    const d = await r.json();
    if (d.models?.length) { status.textContent = `Connected! Models: ${d.models.join(', ')}`; status.style.color = '#4caf50'; }
    else { status.textContent = 'Connected but no models found'; status.style.color = '#ffa726'; }
  } catch (err) { status.textContent = `Failed: ${err.message}`; status.style.color = '#f44336'; }
}

async function refreshModelList() {
  try {
    const r = await apiFetch('/api/info');
    const d = await r.json();
    STATE.availableModels = d.ollama?.models || [];
    const allModels = STATE.availableModels;
    const container = document.getElementById('models-list');
    if (container) {
      container.innerHTML = allModels.length
        ? allModels.map(m => `<div class="flex items-center justify-between py-1 px-2 rounded" style="background:rgba(255,255,255,0.03)"><span class="text-xs text-zinc-400">${m}</span><span class="text-xs" onclick="selectModel('${m.replace('🌐 ', '')}')" style="cursor:pointer;color:#4c6ef5">Select</span></div>`).join('')
        : '<div class="text-xs text-zinc-600">No models installed.</div>';
    }
  } catch {}
}

function selectModel(name) {
  document.getElementById('selected-model').textContent = name;
  STATE.selectedModel = name;
  closeSettings();
  addSystemMessage(`Model switched to: ${name}`);
}

function openSettings() {
  refreshModelList();
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('settings-remote-host').value = STATE.settings.remoteHost || '';
  document.getElementById('settings-gemini-key').value = STATE.settings.geminiKey || '';
  document.getElementById('settings-groq-key').value = STATE.settings.groqKey || '';
  document.getElementById('settings-xai-key').value = STATE.settings.xaiKey || '';
  document.getElementById('remote-status').textContent = '';
  setProvider(STATE.settings.provider || 'ollama');
}

function closeSettings() { document.getElementById('settings-modal').classList.add('hidden'); }

function saveSettings() {
  STATE.settings.remoteHost = document.getElementById('settings-remote-host').value.trim();
  STATE.settings.geminiKey = document.getElementById('settings-gemini-key').value.trim();
  STATE.settings.groqKey = document.getElementById('settings-groq-key').value.trim();
  STATE.settings.xaiKey = document.getElementById('settings-xai-key').value.trim();
  localStorage.setItem('nova-settings', JSON.stringify(STATE.settings));

  if (STATE.settings.remoteHost) {
    document.getElementById('status-badge').textContent = 'Remote';
    document.getElementById('status-badge').style.background = 'rgba(255, 193, 7, 0.2)';
    document.getElementById('status-badge').style.color = '#ffd43b';
  } else {
    document.getElementById('status-badge').textContent = STATE.user ? `Connecté: ${STATE.user}` : 'Ready';
    document.getElementById('status-badge').style.background = '';
    document.getElementById('status-badge').style.color = '';
  }

  closeSettings();
  addSystemMessage('Settings saved.');
}

async function loadSettings() {
  const saved = localStorage.getItem('nova-settings');
  if (saved) { try { STATE.settings = { ...STATE.settings, ...JSON.parse(saved) }; } catch {} }
}

function toggleDebate() {
  STATE.debateMode = !STATE.debateMode;
  localStorage.setItem('nova-debate', STATE.debateMode);
  updateDebateButton();
  addSystemMessage(STATE.debateMode ? 'Debate mode ON (3 agents)' : 'Debate mode OFF');
}

function toggleReflection() {
  STATE.autoReflect = !STATE.autoReflect;
  localStorage.setItem('nova-reflect', STATE.autoReflect);
  updateReflectButton();
  addSystemMessage(STATE.autoReflect ? 'Self-reflection ON' : 'Self-reflection OFF');
}

function updateDebateButton() {
  const btn = document.getElementById('debate-btn');
  btn.style.borderColor = STATE.debateMode ? '#805ad5' : '';
  btn.style.color = STATE.debateMode ? '#805ad5' : '';
}

function updateReflectButton() {
  const btn = document.getElementById('reflect-btn');
  btn.style.borderColor = STATE.autoReflect ? '#ffc107' : '';
  btn.style.color = STATE.autoReflect ? '#ffc107' : '';
}

// ==================== PERSISTENCE (IndexedDB + Crypto) ====================

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('NovaAI', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveState() {
  try {
    const db = await openDB();
    const tx = db.transaction('chats', 'readwrite');
    const store = tx.objectStore('chats');
    const chatData = { id: STATE.currentChatId || CryptoUtils.generateId(), messages: STATE.messages, updatedAt: Date.now(), title: STATE.messages.find(m => m.role === 'user')?.content?.slice(0, 50) || 'New Chat' };
    if (!STATE.currentChatId) STATE.currentChatId = chatData.id;
    const encrypted = await CryptoUtils.encrypt(JSON.stringify(chatData));
    store.put({ id: chatData.id, data: encrypted, updatedAt: chatData.updatedAt, title: chatData.title });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    STATE.chats[chatData.id] = { title: chatData.title, updatedAt: chatData.updatedAt };
    renderChatHistory();
  } catch (err) { console.error('[NOVA] Save failed:', err); }
}

async function loadChats() {
  try {
    const db = await openDB();
    const tx = db.transaction('chats', 'readonly');
    const store = tx.objectStore('chats');
    const all = await new Promise((resolve, reject) => { const req = store.getAll(); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
    for (const entry of all) STATE.chats[entry.id] = { title: entry.title, updatedAt: entry.updatedAt };
    renderChatHistory();
    if (all.length > 0) {
      const sorted = all.sort((a, b) => b.updatedAt - a.updatedAt);
      const latest = sorted[0];
      const decrypted = await CryptoUtils.decrypt(latest.data);
      const chat = JSON.parse(decrypted);
      STATE.currentChatId = chat.id;
      STATE.messages = chat.messages;
      renderAllMessages();
    }
  } catch (err) { console.error('[NOVA] Load failed:', err); }
}

async function loadChat(id) {
  try {
    const db = await openDB();
    const tx = db.transaction('chats', 'readonly');
    const store = tx.objectStore('chats');
    const entry = await new Promise((resolve, reject) => { const req = store.get(id); req.onsuccess = () => resolve(req.result); req.onerror = reject; });
    if (entry) {
      const decrypted = await CryptoUtils.decrypt(entry.data);
      const chat = JSON.parse(decrypted);
      STATE.currentChatId = chat.id;
      STATE.messages = chat.messages;
      renderAllMessages();
    }
  } catch (err) { console.error('[NOVA] Load chat failed:', err); }
}

function newChat() {
  STATE.messages = [];
  STATE.currentChatId = null;
  renderAllMessages();
  document.getElementById('prompt-input').value = '';
  document.getElementById('prompt-input').focus();
}

function deleteChat(id, event) {
  event.stopPropagation();
  if (!confirm('Delete this chat?')) return;
  openDB().then(db => { const tx = db.transaction('chats', 'readwrite'); tx.objectStore('chats').delete(id); return new Promise(resolve => { tx.oncomplete = resolve; }); }).then(() => {
    delete STATE.chats[id];
    if (STATE.currentChatId === id) newChat();
    renderChatHistory();
  });
}

function renderAllMessages() {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  if (STATE.messages.length === 0) {
    container.innerHTML = `
      <div class="flex justify-center pt-8">
        <div class="text-center max-w-md">
          <h1 class="text-3xl font-light tracking-tight text-white">NOVA</h1>
          <p class="text-zinc-500 text-sm mt-2">Assistant IA · Local & Privé</p>
          <p class="text-zinc-600 text-xs mt-0.5">Créé par Florin Marcu</p>
          <div class="flex flex-wrap items-center justify-center gap-2 mt-6 text-[11px]">
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Ollama ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Gemini ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">AES-256 ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Pyodide ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Multi-Agent ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Self-Réflexion ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Tree-of-Thoughts ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Voix ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Hyper-RAG ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Auto-Scaffold ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Dashboard ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">TTS ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Web ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Questions ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Mémoire ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Graphe ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Vision ✓</span>
            <span class="px-3 py-1 rounded-full border border-zinc-800 text-zinc-500">Agent ✓</span>
          </div>
        </div>
      </div>`;
    return;
  }
  for (const msg of STATE.messages) { if (msg.content) addMessage(msg.role, msg.content); }
}

function renderChatHistory() {
  const container = document.getElementById('chat-history');
  container.innerHTML = '';
  const sorted = Object.entries(STATE.chats).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  for (const [id, chat] of sorted) {
    const div = document.createElement('div');
    div.className = `p-2 rounded-lg text-xs cursor-pointer transition flex items-center gap-1 ${STATE.currentChatId === id ? 'bg-white/10' : 'hover:bg-white/5'}`;
    div.innerHTML = `<span class="flex-1 truncate text-zinc-500">${escapeHtml(chat.title || 'Chat')}</span><button class="text-zinc-700 hover:text-red-400 transition px-1" onclick="deleteChat('${id}', event)">✕</button>`;
    div.onclick = () => loadChat(id);
    container.appendChild(div);
  }
}

// ==================== WEB FETCH / NAVIGATE ====================

async function fetchWebUrl() {
  const url = document.getElementById('web-url').value.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    document.getElementById('web-url').value = 'https://' + url;
  }

  const fullUrl = document.getElementById('web-url').value;
  const resultsDiv = document.getElementById('web-results');
  const summarize = document.getElementById('web-summarize').checked;

  resultsDiv.innerHTML = '<div class="text-center py-8 text-zinc-500"><span class="blink">Récupération de la page...</span></div>';

  try {
    const response = await apiFetch('/api/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pageText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(trimmed.slice(6));
          switch (data.type) {
            case 'done':
              pageText = data.content;
              resultsDiv.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                  <div class="text-sm font-medium text-white truncate">${escapeHtml(fullUrl)}</div>
                  <button onclick="openWebUrl()" class="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-white transition">Ouvrir dans le navigateur</button>
                </div>
                <div class="text-xs text-zinc-600 mb-3">${pageText.length} caractères récupérés</div>
                <div class="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap" style="font-size:12px;">${escapeHtml(pageText.slice(0, 5000))}${pageText.length > 5000 ? '\n\n...' : ''}</div>`;

              if (summarize && pageText.length > 200) {
                resultsDiv.innerHTML += '<div class="mt-4 pt-4 border-t border-zinc-800"><div class="text-xs text-zinc-500 mb-2 blink">Résumé en cours...</div></div>';
                // Ask AI to summarize
                const chatResponse = await apiFetch('/api/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messages: [
                      { role: 'system', content: 'Tu es un assistant qui résume le contenu web. Sois concis, va à l\'essentiel. Réponds en français.' },
                      { role: 'user', content: `Résume cette page web en 5-10 points clés:\n\n${pageText.slice(0, 4000)}` }
                    ],
                    reflect: false,
                    provider: STATE.settings.provider || 'ollama',
                    groqKey: STATE.settings.groqKey || undefined,
                    geminiKey: STATE.settings.geminiKey || undefined,
                  }),
                });

                const cr = chatResponse.body.getReader();
                const cd = new TextDecoder();
                let cb = '';
                let summary = '';

                while (true) {
                  const { done: cdDone, value: cdVal } = await cr.read();
                  if (cdDone) break;
                  cb += cd.decode(cdVal, { stream: true });
                  for (const cl of cb.split('\n')) {
                    cb = '';
                    const ct = cl.trim();
                    if (!ct || !ct.startsWith('data: ')) continue;
                    try {
                      const cj = JSON.parse(ct.slice(6));
                      if (cj.type === 'chunk') summary += cj.content;
                      if (cj.type === 'done') {
                        const summaryEl = resultsDiv.querySelector('.mt-4');
                        if (summaryEl) {
                          summaryEl.innerHTML = `<div class="text-xs text-zinc-500 mb-2">📝 Résumé</div><div class="text-sm text-zinc-300 leading-relaxed">${formatContent(summary, 'assistant')}</div>`;
                        }
                      }
                    } catch {}
                  }
                }
              }
              break;
            case 'error':
              resultsDiv.innerHTML = `<div class="text-red-400 text-sm">${escapeHtml(data.content)}</div>`;
              break;
          }
        } catch {}
      }
    }
  } catch (err) {
    resultsDiv.innerHTML = `<div class="text-red-400 text-sm">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ==================== WEB SEARCH ====================

async function searchWeb() {
  const query = document.getElementById('web-url').value.trim();
  if (!query) return;

  const resultsDiv = document.getElementById('web-results');
  resultsDiv.innerHTML = '<div class="text-center py-8 text-zinc-500"><span class="blink">Recherche en cours...</span></div>';

  try {
    const response = await apiFetch('/api/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let html = `<div class="text-sm font-medium text-white mb-3">🔍 ${escapeHtml(query)}</div>`;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (const line of buf.split('\n')) {
        buf = '';
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(t.slice(6));
          if (d.type === 'results' && d.data?.length) {
            html += '<div class="space-y-3">';
            for (const r of d.data) {
              html += `<div class="rk">
                <a href="${escapeHtml(r.url)}" target="_blank" class="text-xs text-blue-400 hover:underline font-medium">${escapeHtml(r.title)}</a>
                <div class="text-xs text-zinc-600 mt-0.5">${escapeHtml(r.snippet)}</div>
                <div class="text-[10px] text-zinc-700 mt-0.5">${escapeHtml(r.url.slice(0, 80))}</div>
              </div>`;
            }
            html += '</div>';
            resultsDiv.innerHTML = html;
          }
          if (d.type === 'done' && !d.data?.length) {
            html += '<div class="text-sm text-zinc-500">Aucun résultat.</div>';
            resultsDiv.innerHTML = html;
          }
        } catch {}
      }
    }
  } catch (err) {
    resultsDiv.innerHTML = `<div class="text-red-400 text-sm">${escapeHtml(err.message)}</div>`;
  }
}

// ==================== DRAG & DROP FILE UPLOAD ====================

async function handleDragDrop(event) {
  event.preventDefault();
  const files = event.dataTransfer.files;
  if (!files.length) return;

  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      addSystemMessage(`[Fichier] ${file.name} trop volumineux (max 10MB)`);
      continue;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1] || e.target.result;

      addSystemMessage(`[Fichier] Parsing de ${file.name}...`);
      try {
        const r = await apiFetch('/api/parse-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, content: base64, mime: file.type }),
        });
        const d = await r.json();
        if (d.text) {
          STATE.files.push({ name: file.name, size: file.size, content: d.text });
          updateFilePreview();
          addSystemMessage(`[Fichier] ${file.name} parsé (${d.fullLength || d.text.length} caractères)`);
        }
      } catch (err) {
        addSystemMessage(`[Fichier] Erreur: ${err.message}`);
      }
    };

    if (file.name.match(/\.(pdf|docx|xlsx|xls|txt|md|js|py|html|css|json|csv)$/i)) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  }
}

async function openWebUrl() {
  const url = document.getElementById('web-url').value.trim();
  if (!url) return;
  const fullUrl = url.startsWith('http') ? url : 'https://' + url;

  try {
    const r = await apiFetch('/api/web-nav', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl }),
    });
    const d = await r.json();
    const resultsDiv = document.getElementById('web-results');
    resultsDiv.innerHTML = `<div class="text-sm text-zinc-400">${escapeHtml(d.message)}</div>
      <div class="mt-2"><a href="${escapeHtml(fullUrl)}" target="_blank" class="text-xs text-blue-400 hover:underline">${escapeHtml(fullUrl)}</a></div>`;
  } catch (err) {
    // Fallback: just open in new tab
    window.open(fullUrl, '_blank');
  }
}

// ==================== LONG-TERM MEMORY ====================

async function loadMemory() {
  try {
    const r = await apiFetch('/api/memory');
    const m = await r.json();
    const div = document.getElementById('memory-content');
    div.innerHTML = `
      <div class="space-y-3">
        <div><label class="text-xs text-zinc-500 block mb-1">Nom</label><input id="mem-nom" class="modal-input w-full" value="${escapeHtml(m.nom || '')}" placeholder="Ton nom"></div>
        <div><label class="text-xs text-zinc-500 block mb-1">Technologies (séparées par virgule)</label><input id="mem-tech" class="modal-input w-full" value="${escapeHtml((m.technologies || []).join(', '))}" placeholder="Python, JavaScript, React..."></div>
        <div><label class="text-xs text-zinc-500 block mb-1">Projets (séparés par virgule)</label><input id="mem-projets" class="modal-input w-full" value="${escapeHtml((m.projets || []).join(', '))}" placeholder="NOVA, site web..."></div>
        <div><label class="text-xs text-zinc-500 block mb-1">Préférences</label><textarea id="mem-prefs" rows="2" class="modal-input w-full" placeholder="Préférences de code, style, etc.">${escapeHtml(m.preferences || '')}</textarea></div>
        <div><label class="text-xs text-zinc-500 block mb-1">Contexte</label><textarea id="mem-context" rows="2" class="modal-input w-full" placeholder="Contexte général">${escapeHtml(m.contexte || '')}</textarea></div>
      </div>`;
    return m;
  } catch (err) {
    document.getElementById('memory-content').innerHTML = `<div class="text-red-400 text-sm">Erreur: ${err.message}</div>`;
  }
}

async function saveMemory() {
  const nom = document.getElementById('mem-nom')?.value?.trim() || '';
  const tech = (document.getElementById('mem-tech')?.value?.trim() || '').split(',').map(t => t.trim()).filter(Boolean);
  const projets = (document.getElementById('mem-projets')?.value?.trim() || '').split(',').map(p => p.trim()).filter(Boolean);
  const preferences = document.getElementById('mem-prefs')?.value?.trim() || '';
  const contexte = document.getElementById('mem-context')?.value?.trim() || '';

  try {
    const r = await apiFetch('/api/memory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom, technologies: tech, projets, preferences, contexte }),
    });
    const d = await r.json();
    addSystemMessage('[Mémoire] Enregistrée !');
  } catch (err) {
    addSystemMessage(`[Mémoire] Erreur: ${err.message}`);
  }
}

async function extractMemoryFromChat() {
  const conversation = STATE.messages.map(m => `${m.role}: ${m.content}`).join('\n').slice(0, 3000);
  addSystemMessage('[Mémoire] Extraction en cours...');
  try {
    const r = await apiFetch('/api/memory/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation }),
    });
    const d = await r.json();
    if (d.extracted) {
      addSystemMessage(`[Mémoire] Extraite: ${JSON.stringify(d.extracted)}`);
      loadMemory();
    } else {
      addSystemMessage('[Mémoire] Aucune nouvelle info trouvée.');
    }
  } catch (err) {
    addSystemMessage(`[Mémoire] Erreur: ${err.message}`);
  }
}

// ==================== KNOWLEDGE GRAPH ====================

async function loadGraph() {
  try {
    const r = await apiFetch('/api/graph');
    const g = await r.json();
    const div = document.getElementById('graph-content');
    if (!g.nodes?.length) {
      div.innerHTML = '<div class="text-center py-8 text-zinc-500 text-sm">Aucune donnée. Utilise "Extraire" depuis le chat.</div>';
      return;
    }
    let html = `<div class="text-xs text-zinc-600 mb-3">${g.nodes.length} entités · ${g.edges.length} relations</div><div class="flex flex-wrap gap-2 mb-4">`;
    for (const n of g.nodes) {
      html += `<span class="px-3 py-1.5 rounded-full text-xs border border-zinc-700 text-zinc-400 bg-zinc-900">${escapeHtml(n.label)}</span>`;
    }
    html += '</div>';
    if (g.edges.length) {
      html += '<div class="text-xs text-zinc-600 mb-2">Relations:</div>';
      for (const e of g.edges) {
        html += `<div class="text-xs text-zinc-500 py-1">${escapeHtml(e.source)} <span class="text-zinc-600">→ (${escapeHtml(e.label)}) →</span> ${escapeHtml(e.target)}</div>`;
      }
    }
    div.innerHTML = html;
  } catch (err) {
    document.getElementById('graph-content').innerHTML = `<div class="text-red-400 text-sm">${err.message}</div>`;
  }
}

async function extractGraphFromChat() {
  const text = STATE.messages.map(m => `${m.role}: ${m.content}`).join('\n').slice(0, 3000);
  if (text.length < 50) { addSystemMessage('[Graphe] Pas assez de contenu.'); return; }
  addSystemMessage('[Graphe] Extraction en cours...');
  try {
    const r = await apiFetch('/api/graph/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const d = await r.json();
    addSystemMessage(`[Graphe] ${d.entities?.length || 0} entités, ${d.relations?.length || 0} relations extraites.`);
    if (d.nodeCount) switchTab('graph');
    loadGraph();
  } catch (err) {
    addSystemMessage(`[Graphe] Erreur: ${err.message}`);
  }
}

async function clearGraph() {
  if (!confirm('Effacer le graphe ?')) return;
  try {
    await apiFetch('/api/graph/clear', { method: 'POST' });
    loadGraph();
    addSystemMessage('[Graphe] Effacé.');
  } catch {}
}

// ==================== VISION ====================

async function analyzeVision() {
  const fileInput = document.getElementById('vision-file');
  const file = fileInput.files[0];
  if (!file) { addSystemMessage('[Vision] Sélectionne une image.'); return; }

  const prompt = document.getElementById('vision-prompt').value.trim() || 'Décris cette image en détail.';
  const resultsDiv = document.getElementById('vision-results');
  resultsDiv.innerHTML = '<div class="text-center py-8 text-zinc-500"><span class="blink">Analyse en cours...</span></div>';

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;

    try {
      const response = await apiFetch('/api/vision', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${STATE.token}`
        },
        body: JSON.stringify({ 
          image: base64, 
          prompt,
          provider: STATE.settings.provider || 'ollama',
          geminiKey: STATE.settings.geminiKey || undefined,
          xaiKey: STATE.settings.xaiKey || undefined
        }),
      });

      const rdr = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';

      resultsDiv.innerHTML = `<div class="mb-3"><img src="${escapeHtml(base64)}" class="max-h-48 rounded-lg border border-zinc-800"></div><div class="text-sm text-zinc-300 leading-relaxed"></div>`;

      while (true) {
        const { done, value } = await rdr.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (const line of buf.split('\n')) {
          buf = '';
          const t = line.trim();
          if (!t || !t.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(t.slice(6));
            if (d.type === 'chunk') {
              full += d.content;
              const textEl = resultsDiv.querySelector('.text-sm');
              if (textEl) textEl.innerHTML = formatContent(full, 'assistant');
            }
            if (d.type === 'done') {
              const textEl = resultsDiv.querySelector('.text-sm');
              if (textEl) textEl.innerHTML = formatContent(full || d.content, 'assistant');
            }
            if (d.type === 'error') {
              resultsDiv.innerHTML += `<div class="text-red-400 text-sm mt-2">${escapeHtml(d.content)}</div>`;
            }
          } catch {}
        }
      }
    } catch (err) {
      resultsDiv.innerHTML += `<div class="text-red-400 text-sm mt-2">${escapeHtml(err.message)}</div>`;
    }
  };
  reader.readAsDataURL(file);
}

// ==================== AUTONOMOUS AGENT ====================

async function runAgent() {
  const input = document.getElementById('agent-input');
  const goal = input.value.trim();
  if (!goal) return;

  const resultsDiv = document.getElementById('agent-results');
  resultsDiv.innerHTML = '<div class="text-center py-8 text-zinc-500"><span class="blink">Initialisation de l\'agent...</span></div>';

  try {
    const response = await apiFetch('/api/agent', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ 
        description, 
        provider: STATE.settings.provider || 'ollama',
        groqKey: STATE.settings.groqKey || undefined,
        geminiKey: STATE.settings.geminiKey || undefined,
        xaiKey: STATE.settings.xaiKey || undefined
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let html = `<div class="mb-3"><div class="text-sm font-medium text-white">🎯 ${escapeHtml(goal)}</div></div>`;

    resultsDiv.innerHTML = html;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (const line of buf.split('\n')) {
        buf = '';
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(t.slice(6));
          switch (d.type) {
            case 'phase':
              html += `<div class="mt-3 pt-3 border-t border-zinc-800"><div class="text-xs text-zinc-500">${escapeHtml(d.content)}</div></div>`;
              resultsDiv.innerHTML = html;
              break;
            case 'plan':
              html += `<div class="text-sm text-zinc-300 leading-relaxed">`;
              if (!html.includes('plan-started')) {
                html = html.replace('<div class="text-sm text-zinc-300 leading-relaxed">', '<div class="text-sm text-zinc-300 leading-relaxed plan-started">');
              }
              resultsDiv.innerHTML = html + formatContent(d.content, 'assistant');
              break;
            case 'step':
              html += `<div class="flex items-center gap-2 mt-3 text-sm text-zinc-400">
                <span class="w-5 h-5 rounded-full border border-zinc-600 flex items-center justify-center text-[10px]">${d.index + 1}</span>
                <span>${escapeHtml(d.step)}</span>
              </div>`;
              resultsDiv.innerHTML = html;
              break;
            case 'exec':
              const lastStep = resultsDiv.querySelector('.flex:last-child');
              if (lastStep) {
                let resDiv = lastStep.nextElementSibling;
                if (!resDiv || !resDiv.classList.contains('step-result')) {
                  resDiv = document.createElement('div');
                  resDiv.className = 'step-result text-sm text-zinc-400 ml-7 mt-1 leading-relaxed';
                  lastStep.after(resDiv);
                }
                resDiv.innerHTML += d.content;
                resultsDiv.scrollTop = resultsDiv.scrollHeight;
              }
              break;
            case 'synthesis':
              html += `<div class="mt-4 pt-3 border-t border-zinc-800"><div class="text-xs text-zinc-500 mb-2">Synthèse finale</div><div class="text-sm text-zinc-300 leading-relaxed"></div></div>`;
              resultsDiv.innerHTML = html;
              break;
            case 'done':
              input.value = '';
              const synEl = resultsDiv.querySelector('.border-t .text-sm');
              if (synEl) synEl.innerHTML = formatContent(d.content, 'assistant');
              if (!synEl) resultsDiv.innerHTML += `<div class="text-sm text-zinc-300 mt-2">${formatContent(d.content, 'assistant')}</div>`;
              break;
            case 'error':
              html += `<div class="text-red-400 text-sm mt-2">${escapeHtml(d.content)}</div>`;
              resultsDiv.innerHTML = html;
              break;
          }
        } catch {}
      }
    }
  } catch (err) {
    resultsDiv.innerHTML += `<div class="text-red-400 text-sm mt-2">${escapeHtml(err.message)}</div>`;
  }
}

// ==================== TERMINAL ====================

async function runTerminalCommand() {
  const input = document.getElementById('terminal-input');
  const output = document.getElementById('terminal-output');
  const command = input.value.trim();
  if (!command) return;

  const cmdDiv = document.createElement('div');
  cmdDiv.className = 'mt-4 text-white font-bold';
  cmdDiv.textContent = `$ ${command}`;
  output.appendChild(cmdDiv);

  input.value = '';
  output.scrollTop = output.scrollHeight;

  try {
    const response = await apiFetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(t.slice(6));
          if (d.type === 'output') {
            const pre = document.createElement('span');
            pre.textContent = d.content;
            output.appendChild(pre);
          } else if (d.type === 'error') {
            const pre = document.createElement('span');
            pre.className = 'text-red-500';
            pre.textContent = d.content;
            output.appendChild(pre);
          } else if (d.type === 'done') {
            const status = document.createElement('div');
            status.className = 'text-zinc-600 text-xs mt-1';
            status.textContent = `[Processus terminé avec le code ${d.code}]`;
            output.appendChild(status);
          }
          output.scrollTop = output.scrollHeight;
        } catch {}
      }
    }
  } catch (err) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'text-red-500 mt-1';
    errorDiv.textContent = `Erreur: ${err.message}`;
    output.appendChild(errorDiv);
  }
}

function handleTerminalKey(e) {
  if (e.key === 'Enter') runTerminalCommand();
}

// Make functions globally accessible
window.sendMessage = sendMessage;
window.newChat = newChat;
window.handleKeyDown = handleKeyDown;
window.autoResize = autoResize;
window.toggleDebate = toggleDebate;
window.toggleReflection = toggleReflection;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.togglePyodide = togglePyodide;
window.handleFileUpload = handleFileUpload;
window.clearFiles = clearFiles;
window.deleteChat = deleteChat;
window.loadChat = loadChat;
window.selectModel = selectModel;
window.refreshModelList = refreshModelList;
window.testRemoteHost = testRemoteHost;
window.setProvider = setProvider;
window.switchTab = switchTab;
window.toggleVoice = toggleVoice;
window.toggleTTS = toggleTTS;
window.runToT = runToT;
window.handleRAGUpload = handleRAGUpload;
window.searchRAG = searchRAG;
window.clearRAG = clearRAG;
window.refreshRAGFiles = refreshRAGFiles;
window.runScaffold = runScaffold;
window.refreshStats = refreshStats;
window.fetchWebUrl = fetchWebUrl;
window.openWebUrl = openWebUrl;
window.searchWeb = searchWeb;
window.handleDragDrop = handleDragDrop;
window.loadMemory = loadMemory;
window.saveMemory = saveMemory;
window.extractMemoryFromChat = extractMemoryFromChat;
window.loadGraph = loadGraph;
window.extractGraphFromChat = extractGraphFromChat;
window.clearGraph = clearGraph;
window.analyzeVision = analyzeVision;
window.runAgent = runAgent;
window.runTerminalCommand = runTerminalCommand;
window.handleTerminalKey = handleTerminalKey;
window.login = login;
window.register = register;
window.toggleAuth = toggleAuth;
window.logout = logout;
window.exportChat = exportChat;
window.toggleExportMenu = toggleExportMenu;
window.togglePassword = togglePassword;
