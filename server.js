// server.js — Générateur de vidéos IA (texte -> vidéo) via l'API Higgsfield
// Authentification : une seule clé API complète, copiée depuis open.higgsfield.ai
// Format d'en-tête : Authorization: Key <clé complète>  (pas de ":" à ajouter)

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const MOCK_MODE = process.env.MOCK_MODE !== 'false'; // true par défaut
const HF_API_KEY = process.env.HF_API_KEY; // clé complète copiée depuis open.higgsfield.ai
const PUBLIC_URL = process.env.PUBLIC_URL;
const HF_MODEL_ID = process.env.HF_MODEL_ID || 'bytedance/seedance-2.5/text-to-video';

const DATA_DIR = path.join(__dirname, 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, '[]');
}

function loadJobs() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch (err) {
    console.error('Erreur de lecture de data/jobs.json, réinitialisation.', err);
    return [];
  }
}

function saveJobs(jobs) {
  ensureDataFile();
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function updateJob(id, patch) {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;
  jobs[idx] = { ...jobs[idx], ...patch, updatedAt: new Date().toISOString() };
  saveJobs(jobs);
  return jobs[idx];
}

ensureDataFile();

app.get('/api/status', (req, res) => {
  res.json({ mockMode: MOCK_MODE });
});

app.get('/api/jobs', (req, res) => {
  const jobs = loadJobs().sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json(jobs);
});

app.post('/api/jobs', async (req, res) => {
  const prompt = (req.body && req.body.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({ error: 'Le prompt est requis.' });
  }

  const job = {
    id: crypto.randomUUID(),
    prompt,
    status: 'queued',
    videoUrl: null,
    error: null,
    requestId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const jobs = loadJobs();
  jobs.push(job);
  saveJobs(jobs);

  res.status(201).json(job);

  processJob(job.id).catch((err) => {
    console.error(`Échec du traitement du job ${job.id} :`, err);
    updateJob(job.id, {
      status: 'failed',
      error: err.message || 'Erreur inconnue.',
    });
  });
});

app.post('/webhook/higgsfield', (req, res) => {
  const payload = req.body || {};
  console.log('Webhook Higgsfield reçu :', JSON.stringify(payload));

  const jobs = loadJobs();
  const job = jobs.find((j) => j.requestId === payload.request_id);

  if (!job) {
    console.warn(`Aucun job local pour request_id=${payload.request_id}`);
    return res.status(200).send('ok');
  }

  if (payload.status === 'completed') {
    updateJob(job.id, {
      status: 'completed',
      videoUrl: (payload.video && payload.video.url) || null,
    });
  } else if (payload.status === 'failed') {
    updateJob(job.id, {
      status: 'failed',
      error: payload.error || 'Échec de la génération.',
    });
  } else if (payload.status === 'nsfw') {
    updateJob(job.id, {
      status: 'failed',
      error: 'Contenu refusé par la modération (NSFW).',
    });
  }

  res.status(200).send('ok');
});

// Interroge périodiquement le statut d'une requête (filet de sécurité si le
// webhook n'arrive pas, par ex. en local sans URL publique).
async function pollStatus(id, requestId, attempt = 0) {
  if (attempt > 40) return; // ~10 minutes max (40 x 15s)
  await new Promise((r) => setTimeout(r, 15000));

  const current = loadJobs().find((j) => j.id === id);
  if (!current || current.status === 'completed' || current.status === 'failed') {
    return; // déjà résolu, probablement via webhook
  }

  try {
    const res = await fetch(`https://api.higgsfield.ai/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${HF_API_KEY}` },
    });
    const data = await res.json().catch(() => ({}));

    if (data.status === 'completed') {
      updateJob(id, { status: 'completed', videoUrl: (data.video && data.video.url) || null });
      return;
    }
    if (data.status === 'failed' || data.status === 'nsfw' || data.status === 'canceled') {
      updateJob(id, { status: 'failed', error: data.error || data.detail || 'Échec de la génération.' });
      return;
    }
  } catch (err) {
    console.error('Erreur de polling :', err.message);
  }

  pollStatus(id, requestId, attempt + 1);
}

async function processJob(id) {
  updateJob(id, { status: 'processing' });
  const job = loadJobs().find((j) => j.id === id);
  if (!job) return;

  if (MOCK_MODE) {
    return mockProcess(id);
  }

  if (!HF_API_KEY) {
    throw new Error('HF_API_KEY manquant dans les variables d\'environnement.');
  }

  let endpoint = `https://api.higgsfield.ai/${HF_MODEL_ID}`;
  if (PUBLIC_URL) {
    const webhookUrl = `${PUBLIC_URL.replace(/\/$/, '')}/webhook/higgsfield`;
    endpoint += `?hf_webhook=${encodeURIComponent(webhookUrl)}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Key ${HF_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      prompt: job.prompt,
      resolution: '720p',
      generate_audio: true,
      duration: 5,
      aspect_ratio: '9:16',
      output_format: 'mp4',
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('Réponse brute Higgsfield (erreur) :', JSON.stringify(data));
    throw new Error(
      data.detail || data.error || data.message || `Erreur API Higgsfield (HTTP ${response.status})`
    );
  }

  updateJob(id, {
    requestId: data.request_id || null,
    status: data.status || 'queued',
  });

  // Filet de sécurité : si le webhook n'arrive jamais (ex: PUBLIC_URL absent
  // ou injoignable), on vérifie quand même le statut régulièrement.
  if (data.request_id) {
    pollStatus(id, data.request_id);
  }
}

function mockProcess(id) {
  const delay = 3000 + Math.random() * 4000;
  setTimeout(() => {
    const shouldFail = Math.random() < 0.15;
    if (shouldFail) {
      updateJob(id, {
        status: 'failed',
        error: 'Échec simulé (mode simulation — MOCK_MODE=true).',
      });
    } else {
      updateJob(id, {
        status: 'completed',
        videoUrl:
          'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
      });
    }
  }, delay);
}

app.listen(PORT, () => {
  console.log(
    `Serveur démarré sur le port ${PORT} — MOCK_MODE=${MOCK_MODE ? 'true (simulation)' : 'false (réel)'}`
  );
});
