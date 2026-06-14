# NOVA AI — Guide Complet pour Gemini CLI / Claude Code

> ⚠️ **Règle :** Ce fichier et `PROJET.md` sont mis à jour à chaque ajout de feature.  
> Si l'IA détecte une feature qui n'est pas listée ici, elle doit signaler l'incohérence.

Créé par **Florin Marcu**. Projet personnel d'écosystème IA local-first, modulaire, multi-agent.

## Architecture

Monolithique full-stack JS :
- **Backend** : Express.js, port 3000, SSE streaming
- **Frontend** : Vanilla JS + TailwindCSS (CDN), pas de framework
- **IA** : Ollama (local, qwen2.5-coder:1.5b / nova1) ou Gemini API (gratuit)
- **Stockage** : IndexedDB (chats chiffrés AES-256-GCM) + nova_data.json (mémoire/graphe)
- **GPU** : NVIDIA MX130 (2GB VRAM) — modèle 1.5B max en local

## Arborescence

```
C:\Users\flori\nova\
├── CLAUDE.md                    ← Ce fichier
├── README.md                    ← Setup instructions
├── backend\
│   ├── .env                     # GEMINI_API_KEY, PORT=3000
│   ├── Modelfile                # Modèle "nova1" basé sur qwen2.5-coder:1.5b
│   ├── package.json             # express, cors, dotenv, pdf-parse, mammoth, xlsx, uuid
│   ├── nova_data.json           # Persistance : memory {}, graph {}, agentTasks []
│   ├── server.js                # ~1073 lignes, tous les endpoints
│   └── public\
│       ├── index.html           # UI : sidebar 11 onglets, dark theme
│       ├── app.js               # ~1553 lignes, toute la logique frontend
│       ├── crypto-utils.js      # AES-256-GCM (PBKDF2, 600k iterations)
│       └── sw.js                # Service Worker (cache, offline, background tasks)
└── finetuning\
    ├── README.md                # Instructions fine-tuning
    ├── data_template.json       # 8 exemples instruct-output
    ├── fine_tune_unsloth.ipynb  # Colab : LoRA fine-tuning → GGUF
    └── colab_gpu_server.ipynb   # Colab : serveur Ollama GPU via tunnel
```

## Endpoints API (server.js)

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/chat` | POST (SSE) | Chat principal : mode detection, RAG, vague detection, réflexion, tool-use, hallucination check |
| `/api/debate` | POST (SSE) | Débat multi-agent : Optimiste → Critique → Synthétiseur |
| `/api/tot` | POST (SSE) | Tree-of-Thoughts : 3 branches, auto-évaluation, synthèse |
| `/api/scaffold` | POST (SSE) | Auto-Scaffolding : architecture projet complète |
| `/api/test-code` | POST (SSE) | Tests unitaires automatiques |
| `/api/vision` | POST (SSE) | Analyse d'image (Gemini Vision ou LLaVA) |
| `/api/agent` | POST (SSE) | Agent autonome : Plan → Execute → Synthesis |
| `/api/fetch-url` | POST (SSE) | Fetch page web → texte nettoyé |
| `/api/web-search` | POST (SSE) | Recherche DuckDuckGo (8 résultats) |
| `/api/web-nav` | POST | Ouvre URL dans le navigateur par défaut |
| `/api/parse-file` | POST | Parse PDF/DOCX/XLSX/TXT (base64) |
| `/api/knowledge/add` | POST | Ajout document RAG |
| `/api/knowledge/search` | GET | Recherche RAG |
| `/api/knowledge` | GET/DELETE | Liste/Supprime documents RAG |
| `/api/memory` | GET/PUT | CRUD mémoire long-terme |
| `/api/memory/extract` | POST | Extraction mémoire depuis conversation |
| `/api/graph` | GET | Graphe de connaissances (nodes + edges) |
| `/api/graph/extract` | POST | Extraction entités/relations |
| `/api/graph/clear` | POST | Efface le graphe |
| `/api/stats` | GET | Statistiques d'utilisation |
| `/api/info` | GET | Infos système (modèles, features) |
| `/api/agent/tasks` | GET/DELETE | Tâches agent |
| `/api/terminal` | POST (SSE) | Exécute commande système |
| `/api/auth/register` | POST | Création de compte + Captcha |
| `/api/auth/login` | POST | Connexion (JWT) |
| `/api/captcha/task` | GET | Tâche d'étiquetage IA aléatoire |
| `/api/captcha/submit` | POST | Enregistre réponse captcha (entraînement) |

## Features Implémentées (toutes fonctionnelles)

### Chat & Communication
- ✅ Chat SSE streaming (Ollama + Gemini)
- ✅ Mode Detection (symbolic, code, creative, analysis, probabilistic, general)
- ✅ Vague Detection → pose 2-3 questions si demande imprécise
- ✅ Auto-Reflection (auto-correction après réponse)
- ✅ Hallucination Detector (vérifie contre sources RAG)
- ✅ Voice Input (Web Speech API, français)
- ✅ Text-to-Speech (SpeechSynthesis)

### Raisonnement Avancé
- ✅ Tree-of-Thoughts (3 branches parallèles, auto-évaluation, synthèse)
- ✅ Multi-Agent Debate (Optimiste, Critique, Synthétiseur)
- ✅ Autonomous Agent (goal → plan → execute steps → synthesis)
- ✅ Tool-Use System : 4 outils (search, url, read_file, python)

### Mémoire & Connaissances
- ✅ Hyper-RAG (base documentaire TF, recherche plein texte)
- ✅ Long-Term Memory (nom, technos, projets, préférences → injecté dans chaque chat)
- ✅ Knowledge Graph (extraction entités + relations, visualisation)
- ✅ File Parsing (PDF, DOCX, XLSX, TXT)

### Web & Navigation
- ✅ Web Fetch (récupère contenu page → texte)
- ✅ Web Search (DuckDuckGo scraping, sans clé API)
- ✅ Web Nav (ouvre URL dans le navigateur système)
- ✅ Drag & Drop (glisser fichiers dans le chat)

### Sécurité & Privacy
- ✅ AES-256-GCM (Web Crypto API, PBKDF2 600k iterations)
- ✅ IndexedDB chiffré pour historique
- ✅ Local-first (Ollama par défaut, données jamais envoyées)
- ✅ Authentification multi-utilisateur (Bcrypt + JWT)
- ✅ Captcha d'entraînement (Collecte de données pour futur fine-tuning)

### Productivité
- ✅ Auto-Scaffolding (génération architecture projet complète)
- ✅ Auto Unit Tests (génération tests pour code)
- ✅ Python Sandbox (Pyodide dans le navigateur)
- ✅ Dashboard / Stats (appels, temps, tokens, modes, providers)
- ✅ `/search <query>` — recherche web + résumé automatique dans le chat
- ✅ Terminal Intégré (exécution de commandes système via SSE)

### Vision & Multimodal
- ✅ Vision (Gemini Vision API ou LLaVA local)

### Divers
- ✅ Service Worker (cache offline, background tasks)
- ✅ Model Fine-tuning (Unsloth LoRA → GGUF, via Colab)
- ✅ Remote GPU (Colab → Ollama tunnel)
- ✅ Settings (provider Ollama/Gemini, sélection modèle)

## Détails Techniques Clés

### Chat Endpoint Flow (`/api/chat`)
1. Build memory context from `nova_data.json`
2. Enrich with RAG search results
3. Detect vague → if vague + first message → ask questions
4. Detect mode → adjust temperature
5. Stream response via SSE
6. Post-process : auto-reflection, tool-use, hallucination detection

### Personas (Multi-Agent)
- **Optimiste** : créatif, visionnaire, voit les opportunités (temp 0.7)
- **Critique** : logique, sceptique, identifie les failles (temp 0.7)
- **Synthétiseur** : équilibré, pragmatique, fusionne (temp 0.4)
- **Codeur** : clean code, best practices (non utilisé dans débat)
- **Architecte** : architecture logicielle senior (utilisé dans scaffold)

### Modèle Nova1
- Base : `qwen2.5-coder:1.5b`
- Temperature : 0.7, top_p : 0.95
- System prompt : poser questions si vague, structure Analyse→Réponse→Résumé, coder en français
- Toujours dire "créé par Florin Marcu"

### Providers
| Provider | Connexion | Modèle | Statut |
|---|---|---|---|---|
| Ollama | localhost:11434 | nova1 (default), qwen2.5-coder:1.5b, 3b | ✅ |
| Groq | API gratuite (console.groq.com) | llama3-70b-8192, mixtral-8x7b-32768 | ✅ |
| Gemini | API (gratuite) | gemini-2.0-flash | ✅ |
| xAI | API Key | grok-2-latest | ✅ |

### Tool-Use (dans réponses du modèle)
Le modèle peut générer :
- `[TOOL:search] query` → recherche DuckDuckGo
- `[TOOL:url] https://...` → fetch page web
- `[TOOL:read_file] path` → lit fichier projet
- `[TOOL:python] code` → Python (via frontend)

## Templates Conventions

### Nouvel Endpoint
```js
app.post('/api/nouveau', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    // SSE streaming avec write()
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});
```

### Nouvel Onglet
1. Ajouter `<div class="sidebar-item" data-tab="..." onclick="switchTab('...')">` dans la sidebar
2. Ajouter `<div id="tab-..." class="tab-view flex-col flex-1 min-w-0">` dans le HTML
3. Ajouter les fonctions dans `app.js`
4. Ajouter `window.maFonction = maFonction;` dans les exports

## Limitations Connues
- GPU MX130 2GB → modèles locaux limités à 1.5B-3B
- DuckDuckGo peut bloquer les requêtes automatisées
- PDF/DOCX/XLSX parsing via npm (fallback silencieux si non installé)
- Gemini nécessite clé API (gratuite sur aistudio.google.com)

## Commandes Rapides
```bash
cd C:\Users\flori\nova\backend
node server.js          # Démarrer le serveur (port 3000)
node --watch server.js  # Mode dev avec auto-reload
ollama list             # Voir les modèles disponibles
```
