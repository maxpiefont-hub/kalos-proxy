/* Kalos — proxy IA partagé (Claude / Anthropic)
 *
 * But : permettre aux amis testeurs d'utiliser Kalos SANS fournir leur propre
 * clé. La clé Anthropic reste côté serveur (variable d'environnement Railway),
 * jamais dans le navigateur ni dans le code public.
 *
 * Zéro dépendance (Node 18+ : fetch global, http natif).
 *
 * Variables d'environnement (à régler dans Railway) :
 *   ANTHROPIC_API_KEY   (obligatoire) — ta clé sk-ant-...
 *   ALLOW_ORIGIN        (optionnel)   — origine autorisée, défaut "*"
 *   RATE_PER_DAY        (optionnel)   — nb max de requêtes/jour par IP, défaut 80
 *   MAX_OUTPUT_TOKENS   (optionnel)   — plafond dur de tokens de sortie, défaut 6000
 *   PORT                (fourni par Railway automatiquement)
 */

const http = require("http");

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const RATE_PER_DAY = parseInt(process.env.RATE_PER_DAY || "80", 10);
const MAX_OUTPUT_TOKENS = parseInt(process.env.MAX_OUTPUT_TOKENS || "6000", 10);
const PORT = process.env.PORT || 3000;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// --- Limitation de débit en mémoire (par IP, fenêtre 24 h) ---
const hits = new Map(); // ip -> { count, resetAt }
function rateCheck(ip) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now > h.resetAt) {
    h = { count: 0, resetAt: now + 24 * 60 * 60 * 1000 };
    hits.set(ip, h);
  }
  h.count++;
  return { ok: h.count <= RATE_PER_DAY, remaining: Math.max(0, RATE_PER_DAY - h.count), resetAt: h.resetAt };
}
// Nettoyage périodique pour ne pas garder les vieilles IP en mémoire
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (now > h.resetAt) hits.delete(ip);
}, 60 * 60 * 1000).unref();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}
function send(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }

  // Santé / accueil
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    return send(res, 200, { ok: true, service: "kalos-proxy", keyConfigured: !!API_KEY });
  }

  if (req.method === "POST" && req.url === "/ai") {
    if (!API_KEY) return send(res, 500, { error: "Clé serveur non configurée (ANTHROPIC_API_KEY)." });

    // IP réelle derrière le proxy Railway
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
    const rl = rateCheck(ip);
    if (!rl.ok) {
      const mins = Math.ceil((rl.resetAt - Date.now()) / 60000);
      return send(res, 429, { error: `Quota quotidien atteint (${RATE_PER_DAY} requêtes/jour). Réessaie dans ~${mins} min.` });
    }

    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
    req.on("end", async () => {
      let payload;
      try { payload = JSON.parse(body || "{}"); }
      catch { return send(res, 400, { error: "JSON invalide." }); }

      // On ne laisse passer que les champs utiles de l'API Messages, et on borne la sortie.
      const upstream = {
        model: payload.model || "claude-haiku-4-5-20251001",
        max_tokens: Math.min(payload.max_tokens || 3000, MAX_OUTPUT_TOKENS),
        messages: Array.isArray(payload.messages) ? payload.messages : [],
      };
      if (payload.system) upstream.system = payload.system;
      if (payload.temperature != null) upstream.temperature = payload.temperature;

      try {
        const r = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(upstream),
        });
        const data = await r.json();
        cors(res);
        res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
        res.writeHead(r.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (e) {
        return send(res, 502, { error: "Erreur d'appel au fournisseur IA.", detail: String(e) });
      }
    });
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`Kalos proxy en écoute sur :${PORT} (clé ${API_KEY ? "OK" : "MANQUANTE"})`));
