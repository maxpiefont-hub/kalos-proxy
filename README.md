# Kalos — proxy IA partagé

Petit serveur Node (zéro dépendance) qui relaie les appels de Kalos vers l'API
Claude (Anthropic) en gardant la clé **côté serveur**. Comme ça les amis
testeurs n'ont aucune clé à fournir.

## Déploiement Railway

1. Pousser ce dossier (`kalos-proxy`) sur un repo GitHub.
2. Railway → **New Project** → **Deploy from GitHub repo** → choisir ce repo.
3. Railway détecte Node tout seul (`npm start` → `node server.js`).
4. Onglet **Variables** → ajouter :
   - `ANTHROPIC_API_KEY` = ta clé `sk-ant-...` (⚠️ secret, ne jamais committer)
   - `ALLOW_ORIGIN` = `https://maxpiefont-hub.github.io` (recommandé)
   - `RATE_PER_DAY` = `80` (optionnel — plafond par IP/jour)
5. **Settings → Networking → Generate Domain** pour obtenir l'URL publique.

## Endpoints

- `GET /` → état du service (vérifie que la clé est bien configurée)
- `POST /ai` → corps = `{ model, system, messages, max_tokens, temperature }`
  (mêmes champs que l'API Messages d'Anthropic). La sortie est plafonnée.

## Sécurité

- La clé n'est **jamais** dans le code ni le navigateur, seulement dans les
  variables d'environnement Railway.
- Limitation de débit par IP (mémoire) pour éviter les abus.
- CORS restreint à `ALLOW_ORIGIN`.
