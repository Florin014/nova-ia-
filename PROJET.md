# NOVA AI — Présentation Complète du Projet

> À utiliser comme contexte système pour Gemini CLI ou tout autre assistant IA.
> Copie-colle ce document avant de poser des questions sur le projet.
>
> ⚠️ **Règle :** Ce fichier et `GEMINI.md` sont mis à jour à chaque ajout de feature.
> Si l'IA détecte une feature qui n'est pas listée ici, elle doit signaler l'incohérence.

---

## Identité
- **Projet** : NOVA AI — écosystème IA personnel, local-first, modulaire, multi-agent
- **Créateur** : Florin Marcu
- **Stack** : Full-stack JS (Node.js/Express + Vanilla JS/TailwindCSS)
- **IA** : Ollama (qwen2.5-coder:1.5b / nova1) ou Gemini API (gratuit)
- **Stockage** : IndexedDB chiffré AES-256-GCM + nova_data.json (mémoire/graphe)
- **Dossier racine** : `C:\Users\flori\nova\`

---

## Arborescence

```
C:\Users\flori\nova\
├── CLAUDE.md                        ← Contexte pour Claude Code
├── PROJET.md                        ← Ce fichier (contexte pour tout IA CLI)
├── README.md                        ← Setup instructions
│
├── backend\
│   ├── .env                         # GEMINI_API_KEY, PORT=3000
│   ├── Modelfile                    # Modèle Ollama "nova1"
│   ├── package.json                 # Dépendances npm
│   ├── nova_data.json               # Persistance (mémoire, graphe, tâches)
│   ├── server.js                    ~1073 lignes — TOUS les endpoints
│   └── public\
│       ├── index.html               # UI (sidebar 11 onglets, dark theme)
│       ├── app.js                   ~1553 lignes — logique frontend
│       ├── crypto-utils.js          # AES-256-GCM (PBKDF2 600k itérations)
│       └── sw.js                    # Service Worker (offline, cache)
│
├── cli.js                           # CLI terminal (Gemini/Ollama/Groq/xAI)
├── .gitignore                       # Fichiers sensibles ignorés
└── finetuning\
    ├── README.md                    # Instructions fine-tuning
    ├── data_template.json           # 8 exemples instruct-output
    ├── fine_tune_unsloth.ipynb      # Colab : LoRA fine-tuning → GGUF
    └── colab_gpu_server.ipynb       # Colab : serveur Ollama GPU via tunnel
```

---

## API Endpoints (dans server.js)

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/chat` | POST (SSE) | Chat principal — mode detection, RAG, vague detection, réflexion, tool-use, hallucination check |
| `/api/debate` | POST (SSE) | Débat multi-agent (Optimiste, Critique, Synthétiseur) |
| `/api/tot` | POST (SSE) | Tree-of-Thoughts — 3 branches, auto-évaluation, synthèse |
| `/api/scaffold` | POST (SSE) | Auto-Scaffolding — génération architecture projet |
| `/api/test-code` | POST (SSE) | Génération de tests unitaires |
| `/api/vision` | POST (SSE) | Analyse d'image (Gemini Vision ou LLaVA) |
| `/api/agent` | POST (SSE) | Agent autonome — Plan → Execute → Synthesis |
| `/api/fetch-url` | POST (SSE) | Fetch contenu web → texte nettoyé |
| `/api/web-search` | POST (SSE) | Recherche DuckDuckGo (max 8 résultats) |
| `/api/web-nav` | POST | Ouvre URL dans le navigateur par défaut |
| `/api/parse-file` | POST | Parse PDF/DOCX/XLSX/TXT (base64) |
| `/api/knowledge/add` | POST | Ajout document à la base RAG |
| `/api/knowledge/search` | GET | Recherche plein texte RAG |
| `/api/knowledge` | GET/DELETE | Liste/Supprime documents RAG |
| `/api/memory` | GET/PUT | CRUD mémoire long-terme |
| `/api/memory/extract` | POST | Extraction mémoire auto depuis conversation |
| `/api/graph` | GET | Graphe de connaissances (nodes + edges) |
| `/api/graph/extract` | POST | Extraction entités/relations depuis texte |
| `/api/graph/clear` | POST | Efface le graphe |
| `/api/stats` | GET | Statistiques d'utilisation |
| `/api/info` | GET | Infos système (modèles, features dispo) |
| `/api/agent/tasks` | GET/DELETE | Liste/Efface tâches agent |
| `/api/terminal` | POST (SSE) | Exécute commande système |
| `/api/auth/register` | POST | Inscription + Captcha |
| `/api/auth/login` | POST | Connexion (JWT) |
| `/api/captcha/task` | GET | Tâche labeling IA aléatoire |
| `/api/captcha/submit` | POST | Enregistre réponse captcha |

---

## Features Implémentées (toutes fonctionnelles ✅)

### Chat & Communication
- Chat SSE streaming (Ollama + Gemini)
- Mode Detection automatique (symbolic, code, creative, analysis, probabilistic, general)
- Vague Detection → pose 2-3 questions si demande imprécise
- Auto-Reflection (auto-correction après réponse)
- Hallucination Detector (vérifie contre sources RAG)
- Voice Input (Web Speech API, français)
- Text-to-Speech (SpeechSynthesis)

### Raisonnement Avancé
- Tree-of-Thoughts (3 branches parallèles, auto-évaluation, synthèse)
- Multi-Agent Debate (Optimiste, Critique, Synthétiseur)
- Autonomous Agent (goal → plan → execute steps → synthesis)
- Tool-Use System : 4 outils (search, url, read_file, python)

### Mémoire & Connaissances
- Hyper-RAG (base documentaire avec recherche plein texte)
- Long-Term Memory (nom, technos, projets, préférences → injecté dans chaque chat)
- Knowledge Graph (extraction entités + relations, visualisation)
- File Parsing (PDF, DOCX, XLSX, TXT)

### Web & Navigation
- Web Fetch (récupère contenu page → texte)
- Web Search (DuckDuckGo scraping, sans clé API)
- Web Nav (ouvre URL dans le navigateur système)
- Drag & Drop (glisser fichiers dans le chat)

### Sécurité & Privacy
- AES-256-GCM (Web Crypto API, PBKDF2 600k iterations)
- IndexedDB chiffré pour historique
- Local-first (Ollama par défaut, données jamais envoyées)
- Authentification (Bcrypt + JWT)
- Captcha IA-Training (Collecte de données d'entraînement)

### Productivité
- Auto-Scaffolding (génération architecture projet complète)
- Auto Unit Tests (génération tests pour code)
- Python Sandbox (Pyodide dans le navigateur)
- Dashboard / Stats (appels, temps, tokens, modes, providers)
- `/search <query>` — recherche web + résumé automatique dans le chat
- Terminal Intégré (exécution de commandes système via SSE)

### Vision & Multimodal
- Vision (Gemini Vision API ou LLaVA local)

### Divers
- Service Worker (cache offline, background tasks)
- Model Fine-tuning (Unsloth LoRA → GGUF, via Colab)
- Remote GPU (Colab → Ollama tunnel)
- Settings (provider Ollama/Gemini, sélection modèle)

---

## Détails Techniques

### Chat Endpoint Flow
1. Build memory context from nova_data.json (nom, technos, projets, préférences)
2. Enrich with RAG search results (TF-based keyword matching)
3. Detect vague → if vague + first message → ask 2-3 questions
4. Detect mode → adjust temperature (creative: 0.8, others: 0.4)
5. Stream response via SSE (Ollama /api/chat or Gemini REST API)
6. Post-process: auto-reflection, tool-use ([TOOL:search], [TOOL:url], etc.), hallucination detection

### Personas
- **Optimiste** : créatif, visionnaire (temp 0.7)
- **Critique** : logique, sceptique, identifie les failles (temp 0.7)
- **Synthétiseur** : équilibré, pragmatique, fusionne (temp 0.4)
- **Codeur** : clean code, best practices
- **Architecte** : architecture logicielle senior

### Modèle Nova1
- Base : qwen2.5-coder:1.5b
- Temperature : 0.7, top_p : 0.95
- Toujours dire "créé par Florin Marcu" si demandé
- Si demande vague → poser 2-3 questions
- Structure : Analyse → Réponse → Résumé

### Providers
| Provider | Connexion | Modèle | Statut |
|---|---|---|---|
| Ollama | localhost:11434 | nova1 (default), qwen2.5-coder:1.5b, 3b | ✅ |
| Groq | API gratuite | llama3-70b-8192 | ✅ |
| Gemini | API (gratuite) | gemini-2.0-flash | ✅ (clé dans .env) |
| xAI | API Key | grok-2-latest | ✅ |

### Tool-Use (dans réponses du modèle)
Le modèle peut générer ces marqueurs dans ses réponses :
- `[TOOL:search] query` → exécute une recherche DuckDuckGo
- `[TOOL:url] https://...` → fetch et lit le contenu d'une page
- `[TOOL:read_file] path` → lit un fichier du projet
- `[TOOL:python] code` → exécute du Python (via frontend Pyodide)

---

## Template pour Nouvel Endpoint

```js
app.post('/api/nouveau', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    // SSE streaming avec res.write()
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
    res.end();
  }
});
```

## Template pour Nouvel Onglet

1. Ajouter dans la sidebar (`index.html`) :
   ```html
   <div class="sidebar-item" data-tab="..." onclick="switchTab('...')">...</div>
   ```
2. Ajouter la vue onglet :
   ```html
   <div id="tab-..." class="tab-view flex-col flex-1 min-w-0">...</div>
   ```
3. Ajouter les fonctions dans `app.js`
4. Exporter : `window.maFonction = maFonction;`

---

## CLI Terminal (nova-cli.js)
- **Usage** : `node cli.js` (REPL interactif) ou `node cli.js "question"` (one-shot)
- **Providers** : `--provider=gemini`, `--provider=ollama`, `--provider=groq`, `--provider=xai`
- **Modèle** : `--model=gemini-2.0-flash`
- **Commandes REPL** : `/help`, `/provider`, `/model`, `/history`, `/save`, `/exit`
- **Raccourci npm** : `npm run cli`, `npm run cli:gemini`, etc.

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
