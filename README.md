# NOVA AI — Personal AI Ecosystem

## Installation (5 minutes)

### 1. Install Node.js
- Va sur https://nodejs.org
- Télécharge et installe la version **LTS**
- Redémarre ton terminal

### 2. Configure les clés API (gratuites)

**Groq API** (recommandé pour commencer) :
1. Va sur https://console.groq.com/keys
2. Clique "Create API Key"
3. Copie la clé

**Gemini API** (optionnel, fallback) :
1. Va sur https://aistudio.google.com/app/apikey
2. Clique "Create API Key"
3. Copie la clé

### 3. Lance le projet

```bash
# Va dans le dossier backend
cd backend

# Installe les dépendances (une fois)
npm install

# Configure tes clés
# Ouvre .env et remplace les valeurs
notepad .env

# Lance le serveur
npm start
```

### 4. Ouvre le navigateur
- Va sur http://localhost:3000
- Clique "Settings" (en bas à gauche)
- Colle ta clé Groq
- Clique "Save"
- Commence à discuter !

## Fonctionnalités

### Mode Python (Pyodide)
Tape `>>> ` devant ton message pour exécuter du Python directement dans le navigateur :
```
>>> print("Hello from Python!")
>>> 2 + 2
>>> import math; math.sqrt(16)
```

### Mode Débat (3 agents)
Active le bouton 🧠 pour lancer un débat entre :
- **Optimiste** (créatif, visionnaire)
- **Critique** (logique, sceptique)
- **Synthétiseur** (fusion des deux)

### Mode Réflexion
Active le bouton 🔄 pour que l'IA se corrige automatiquement.

### Chiffrement AES-256
Toutes les conversations sont chiffrées localement avant stockage.

## Structure du projet

```
nova/
├── backend/
│   ├── server.js        # Serveur + API + streaming
│   ├── package.json     # Dépendances
│   ├── .env            # Tes clés API
│   └── public/
│       ├── index.html    # Interface utilisateur
│       ├── app.js        # Logique frontend
│       ├── crypto-utils.js # Chiffrement AES-GCM
│       └── sw.js         # Service Worker
└── README.md
```

## Prochaine étape
Une fois que ça marche, on ajoutera :
- Mémoire vectorielle (souvenirs à long terme)
- Tree-of-Thoughts (raisonnement arborescent)
- Graphe de connaissances
- Hyper-RAG (recherche dans fichiers)
