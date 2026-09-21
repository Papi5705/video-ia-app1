const form = document.getElementById('job-form');
const promptInput = document.getElementById('prompt-input');
const submitBtn = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');
const gallery = document.getElementById('gallery');
const emptyState = document.getElementById('empty-state');
const modeBadge = document.getElementById('mode-badge');

const STATUS_LABELS = {
  queued: 'En attente…',
  processing: 'En cours…',
  completed: 'Terminé',
  failed: 'Échec',
};

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    modeBadge.textContent = data.mockMode
      ? '🧪 Mode simulation (MOCK_MODE=true) — aucune clé API utilisée'
      : '✅ Mode réel — connecté à l\'API Higgsfield';
  } catch (err) {
    modeBadge.textContent = 'Statut du serveur indisponible';
  }
}

async function loadJobs() {
  try {
    const res = await fetch('/api/jobs');
    const jobs = await res.json();
    renderGallery(jobs);
  } catch (err) {
    console.error('Erreur de chargement de la galerie :', err);
  }
}

function renderGallery(jobs) {
  if (!jobs.length) {
    emptyState.style.display = 'block';
    gallery.innerHTML = '';
    return;
  }
  emptyState.style.display = 'none';

  gallery.innerHTML = jobs.map(jobToHtml).join('');
}

function jobToHtml(job) {
  const date = new Date(job.createdAt).toLocaleString('fr-FR');
  const statusLabel = STATUS_LABELS[job.status] || job.status;

  let body = '';
  if (job.status === 'completed' && job.videoUrl) {
    body = `
      <video controls src="${escapeAttr(job.videoUrl)}"></video>
      <a class="download-link" href="${escapeAttr(job.videoUrl)}" download target="_blank" rel="noopener">Télécharger la vidéo</a>
    `;
  } else if (job.status === 'failed') {
    body = `<p class="card-error">${escapeHtml(job.error || 'Une erreur est survenue.')}</p>`;
  } else {
    body = `<p class="card-meta">La vidéo apparaîtra ici automatiquement dès qu'elle sera prête.</p>`;
  }

  return `
    <div class="card">
      <div class="card-top">
        <div class="card-prompt">${escapeHtml(job.prompt)}</div>
        <span class="status-pill status-${job.status}">${statusLabel}</span>
      </div>
      ${body}
      <div class="card-meta">Demandé le ${date}</div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str ?? '').replace(/"/g, '&quot;');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = promptInput.value.trim();
  formError.textContent = '';

  if (!prompt) {
    formError.textContent = 'Merci de décrire la vidéo souhaitée.';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Envoi…';

  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Erreur lors de la création de la demande.');
    }

    promptInput.value = '';
    await loadJobs();
  } catch (err) {
    formError.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Générer la vidéo';
  }
});

loadStatus();
loadJobs();
setInterval(loadJobs, 4000); // rafraîchit la galerie toutes les 4 secondes
