// server.js — Application de génération de vidéos IA à partir de texte (Higgsfield)
// Aucune dépendance externe : Node.js natif (http, fs). Node >= 18 requis (fetch intégré).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'jobs.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// MOCK_MODE=true (par défaut) : simule Higgsfield en interne, sans clé API ni réseau.
// Utile pour tester la plomberie de l'appli avant de brancher la vraie clé.
const MOCK_MODE = process.env.MOCK_MODE !== 'false';

// Vraie config Higgsfield (utilisée seulement si MOCK_MODE=false)
const HF_API_KEY = process.env.HF_API_KEY || '';
const HF_API_SECRET = process.env.HF_API_SECRET || '';
const HF_MODEL_ID = process.env.HF_MODEL_ID || 'bytedance/seedance-2.5/text-to-video';
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`; // doit être une URL publique en prod, pour le webhook

// ---------------------------------------------------------------------------
// Persistance simple (fichier JSON, écriture synchrone à chaque mutation)
// ---------------------------------------------------------------------------
function loadJobs() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(jobs, null, 2));
}

// Verrou très simple pour sérialiser les écritures concurrentes (10 requêtes en //)
let writeQueue = Promise.resolve();
function mutateJobs(fn) {
  writeQueue = writeQueue.then(() => {
    const jobs = loadJobs();
    const result = fn(jobs);
    saveJobs(jobs);
    return result;
  });
  return writeQueue;
}

// ---------------------------------------------------------------------------
// Coeur métier : création + traitement d'un job
// ---------------------------------------------------------------------------
async function createJob(prompt) {
  const job = {
    id: crypto.randomUUID(),
    prompt,
    status: 'queued', // queued -> processing -> completed | failed
    videoUrl: null,
    error: null,
    hfRequestId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await mutateJobs((jobs) => jobs.push(job));
  processJob(job.id, prompt); // asynchrone, ne bloque pas la réponse HTTP
  return job;
}

async function processJob(jobId, prompt) {
  await mutateJobs((jobs) => {
    const j = jobs.find((x) => x.id === jobId);
    if (j) { j.status = 'processing'; j.updatedAt = new Date().toISOString(); }
  });

  if (MOCK_MODE) {
    // Simule le délai de génération + l'appel webhook de Higgsfield
    const delay = 2000 + Math.random() * 3000;
    setTimeout(async () => {
      const ok = Math.random() > 0.05; // 5% d'échec simulé, pour tester ce cas aussi
      await mutateJobs((jobs) => {
        const j = jobs.find((x) => x.id === jobId);
        if (!j) return;
        if (ok) {
          j.status = 'completed';
          j.videoUrl = `https://example-mock-video.local/${jobId}.mp4`; // placeholder — remplacé par une vraie URL en mode réel
        } else {
          j.status = 'failed';
          j.error = 'Échec simulé (mode test)';
        }
        j.updatedAt = new Date().toISOString();
      });
    }, delay);
    return;
  }

  // ---- Mode réel : appel à l'API Higgsfield ----
  try {
    const webhookUrl = `${PUBLIC_URL}/api/webhook`;
    const endpoint = `https://platform.higgsfield.ai/${HF_MODEL_ID}?hf_webhook=${encodeURIComponent(webhookUrl)}`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${HF_API_KEY}:${HF_API_SECRET}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        resolution: '720p',
        duration: 5,
        aspect_ratio: '9:16', // format vertical, adapté aux réseaux sociaux
        output_format: 'mp4',
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || `Erreur API Higgsfield (${resp.status})`);

    await mutateJobs((jobs) => {
      const j = jobs.find((x) => x.id === jobId);
      if (j) { j.hfRequestId = data.request_id; j.updatedAt = new Date().toISOString(); }
    });
    // La suite arrive via /api/webhook quand Higgsfield a fini de générer la vidéo.
  } catch (err) {
    await mutateJobs((jobs) => {
      const j = jobs.find((x) => x.id === jobId);
      if (j) { j.status = 'failed'; j.error = String(err.message || err); j.updatedAt = new Date().toISOString(); }
    });
  }
}

// Appelé quand Higgsfield notifie la fin d'une génération (mode réel uniquement)
async function handleWebhook(payload) {
  const { request_id, status, video } = payload;
  await mutateJobs((jobs) => {
    const j = jobs.find((x) => x.hfRequestId === request_id);
    if (!j) return;
    if (status === 'completed' && video && video.url) {
      j.status = 'completed';
      j.videoUrl = video.url;
    } else {
      j.status = 'failed';
      j.error = `Statut Higgsfield : ${status}`;
    }
    j.updatedAt = new Date().toISOString();
  });
}

// ---------------------------------------------------------------------------
// Serveur HTTP minimal (routing + fichiers statiques)
// ---------------------------------------------------------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/jobs') {
      const raw = await readBody(req);
      const { prompt } = JSON.parse(raw || '{}');
      if (!prompt || !prompt.trim()) return sendJSON(res, 400, { error: 'Le champ "prompt" est requis.' });
      const job = await createJob(prompt.trim());
      return sendJSON(res, 201, job);
    }

    if (req.method === 'GET' && req.url === '/api/jobs') {
      const jobs = loadJobs().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJSON(res, 200, jobs);
    }

    if (req.method === 'POST' && req.url === '/api/webhook') {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || '{}');
      await handleWebhook(payload);
      return sendJSON(res, 200, { received: true });
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      return sendJSON(res, 200, { ok: true, mockMode: MOCK_MODE });
    }

    return serveStatic(req, res);
  } catch (err) {
    sendJSON(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT} (MOCK_MODE=${MOCK_MODE})`);
});
