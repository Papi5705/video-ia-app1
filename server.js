// server.js — Générateur de vidéos IA (texte -> vidéo) via l'API Higgsfield

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const MOCK_MODE = process.env.MOCK_MODE !== 'false'; // true par défaut
const HF_API_KEY = process.env.HF_API_KEY;
const HF_API_SECRET = process.env.HF_API_SECRET;
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

async function processJob(id) {
  updateJob(id, { status: 'processing' });
  const job = loadJobs().find((j) => j.id === id);
  if (!job) return;

  if (MOCK_MODE) {
    return mockProcess(id);
  }

  if (!HF_API_KEY || !HF_API_SECRET) {
    throw new Error('HF_API_KEY et/ou HF_API_SECRET manquant(s) dans les variables d\'environnement.');
  }
  if (!PUBLIC_URL) {
    throw new Error('PUBLIC_URL manquant : nécessaire pour recevoir le webhook Higgsfield.');
  }

  const webhookUrl = `${PUBLIC_URL.replace(/\/$/, '')}/webhook/higgsfield`;
  const endpoint = `https://api.higgsfield.ai/${HF_MODEL_ID}?hf_webhook=${encodeURIComponent(webhookUrl)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Key ${HF_API_KEY}:${HF_API_SECRET}`,
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
    throw new Error(
      data.error || data.message || `Erreur API Higgsfield (HTTP ${response.status})`
    );
  }

  updateJob(id, {
    requestId: data.request_id || null,
    status: data.status || 'queued',
  });
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
