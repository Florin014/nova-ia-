# NOVA AI — Fine-tuning de modèles IA

## En 2 minutes

1. **Va sur** https://colab.research.google.com
2. **Importe** le fichier `fine_tune_unsloth.ipynb`
3. **Exécute** toutes les cellules dans l'ordre
4. **Upload** ton fichier `data.json` (ou utilise le template)
5. **Télécharge** ton modèle fine-tuné

## Prérequis

- Un compte **Google** (pour Colab)
- Un compte **Groq** (gratuit, pour tester)

## Structure des fichiers

```
finetuning/
├── fine_tune_unsloth.ipynb   # Notebook Colab (l'essentiel)
├── data_template.json        # Exemple de données à personnaliser
└── README.md                 # Ce fichier
```

## Créer ton propre dataset

1. Copie `data_template.json` → `mes_donnees.json`
2. Remplace les exemples par les tiens
3. Format : `instruction` (ta question) + `output` (ta réponse)
4. Minimum 20 exemples, idéal 100+

## Installer le modèle sur ton PC après fine-tuning

```bash
# 1. Installe Ollama (gratuit)
# Va sur https://ollama.com

# 2. Crée un fichier Modelfile
echo 'FROM ./mon_modele.gguf

TEMPLATE """<|begin_of_text|><|start_header_id|>user<|end_header_id|>
{{ .Prompt }}<|eot_id|><|start_header_id|>assistant<|end_header_id|>
{{ .Response }}<|eot_id|>"""

PARAMETER temperature 0.7' > Modelfile

# 3. Importe le modèle dans Ollama
ollama create mon-modele -f Modelfile

# 4. Utilise-le
ollama run mon-modele
```

## Intégrer avec NOVA AI

Une fois importé dans Ollama, ton modèle sera accessible en local.
Tu pourras ensuite modifier le backend NOVA pour l'utiliser directement.
