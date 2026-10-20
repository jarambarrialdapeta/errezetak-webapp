let allRecipes = [];
let activeTag = 'Todas';
let onlyMambo = false;
let currentRecipe = null;
let currentCookMode = 'all';
let pickedAiImageBase64 = null;
let pickedAiImageMime = null;
let wakeLockSentinel = null;

// Conversational Chef IA state
let chefHistory = [];
let currentDraftRecipe = null;

async function loadRecipes() {
  const res = await fetch('/api/recipes');
  const data = await res.json();
  allRecipes = data.recipes || [];
  renderTagPills();
  renderGallery();
}

function renderTagPills() {
  const tagCounts = new Map();
  for (const r of allRecipes) {
    for (const t of r.tags || []) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  const sortedTags = ['Todas', ...Array.from(tagCounts.keys())];
  const container = document.getElementById('tagPills');
  container.innerHTML = sortedTags
    .map(
      t =>
        `<button class="tag-pill ${activeTag === t ? 'active' : ''}" onclick="selectTag('${t.replace(/'/g, "\\'")}')">${
          t === 'Mambo' ? '🤖 Mambo' : t
        }</button>`
    )
    .join('');
}

function selectTag(tag) {
  activeTag = tag;
  renderTagPills();
  renderGallery();
}

function toggleMamboFilter() {
  onlyMambo = !onlyMambo;
  document.getElementById('mamboFilterBtn').classList.toggle('active', onlyMambo);
  renderGallery();
}

function resetFilters() {
  activeTag = 'Todas';
  onlyMambo = false;
  document.getElementById('searchInput').value = '';
  document.getElementById('mamboFilterBtn').classList.remove('active');
  renderTagPills();
  renderGallery();
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  renderGallery();
}

function isMamboRecipe(r) {
  if ((r.tags || []).includes('Mambo')) return true;
  if (/mambo/i.test(r.title || '')) return true;
  return (r.blocks || []).some(b => /mambo/i.test(b.text || ''));
}

function renderGallery() {
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  document.getElementById('searchClearBtn').style.display = q ? 'block' : 'none';

  const filtered = allRecipes.filter(r => {
    if (onlyMambo && !isMamboRecipe(r)) return false;
    if (activeTag !== 'Todas' && !(r.tags || []).includes(activeTag)) return false;
    if (!q) return true;
    const inTitle = (r.title || '').toLowerCase().includes(q);
    const inTags = (r.tags || []).some(t => t.toLowerCase().includes(q));
    const inBlocks = (r.blocks || []).some(b => {
      if (b.text && b.text.toLowerCase().includes(q)) return true;
      if (b.rows) return b.rows.some(row => row.some(cell => cell.toLowerCase().includes(q)));
      return false;
    });
    return inTitle || inTags || inBlocks;
  });

  document.getElementById('recipeCountLabel').textContent = `${filtered.length} receta${
    filtered.length === 1 ? '' : 's'
  } disponible${filtered.length === 1 ? '' : 's'}`;

  const grid = document.getElementById('recipeGrid');
  if (!filtered.length) {
    grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:60px 20px; color:var(--muted)">
      <div style="font-size:3rem; margin-bottom:10px">🍳</div>
      <h3>No hemos encontrado recetas con ese filtro</h3>
      <p>Prueba con otra palabra o pulsa en "➕ Nueva Receta" para pedírsela al Chef IA.</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered
    .map(r => {
      const mambo = isMamboRecipe(r);
      const coverStyle = r.cover
        ? `background-image: url('${r.cover.replace(/'/g, "\\'")}')`
        : '';
      const tagsHtml = (r.tags || [])
        .slice(0, 4)
        .map(t => {
          const cls =
            t === 'Mambo' ? 'mambo' : t === 'Postre' ? 'postre' : t === 'Sano' ? 'sano' : '';
          return `<span class="mini-tag ${cls}">${t}</span>`;
        })
        .join('');

      return `<article class="recipe-card" onclick="openRecipeDetail('${r.id}')">
        <div class="card-cover" style="${coverStyle}">
          <div class="card-emoji-badge">${r.icon || '🍽️'}</div>
          ${mambo ? `<div class="card-mambo-badge">🤖 Mambo</div>` : ''}
        </div>
        <div class="card-body">
          <h3 class="card-title">${escapeHtml(r.title)}</h3>
          <div class="card-meta">
            ${r.totalTime ? `<span>⏱️ ${escapeHtml(r.totalTime)}</span>` : ''}
            ${r.yield ? `<span>👥 ${r.yield} rac.</span>` : ''}
            ${r.starRating ? `<span style="color:#f59e0b">${r.starRating}</span>` : ''}
          </div>
          <div class="card-tags">${tagsHtml}</div>
        </div>
      </article>`;
    })
    .join('');
}

function openRecipeDetail(id) {
  const r = allRecipes.find(x => x.id === id);
  if (!r) return;
  currentRecipe = r;
  currentCookMode = 'all';

  const hero = document.getElementById('detailHero');
  hero.style.backgroundImage = r.cover ? `url('${r.cover}')` : 'none';
  document.getElementById('detailEmoji').textContent = r.icon || '🍽️';
  document.getElementById('detailTitle').textContent = r.title;

  const metaParts = [];
  if (r.totalTime) metaParts.push(`<span>⏱️ ${escapeHtml(r.totalTime)}</span>`);
  if (r.yield) metaParts.push(`<span>👥 ${r.yield} raciones</span>`);
  if (r.starRating) metaParts.push(`<span>⭐ ${r.starRating}</span>`);
  if (r.sourceUrl) {
    metaParts.push(
      `<a href="${r.sourceUrl}" target="_blank" style="color:#fde047; text-decoration:underline">🔗 Vídeo/Fuente</a>`
    );
  }
  document.getElementById('detailMeta').innerHTML = metaParts.join('');

  const hasDualHeadings =
    (r.blocks || []).some(b => /heading/i.test(b.type) && /olla|cazuela|tradicional/i.test(b.text || '')) &&
    (r.blocks || []).some(b => /heading/i.test(b.type) && /mambo/i.test(b.text || ''));
  document.getElementById('cookModeBar').style.display = hasDualHeadings ? 'flex' : 'none';
  document.querySelectorAll('.cook-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === 'all');
  });

  renderDetailBlocks();
  document.getElementById('detailModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function setCookMode(mode) {
  currentCookMode = mode;
  document.querySelectorAll('.cook-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  renderDetailBlocks();
}

function renderDetailBlocks() {
  if (!currentRecipe) return;
  const blocks = currentRecipe.blocks || [];
  let html = '';
  let stepCounter = 0;
  let currentSectionMode = 'neutral';

  for (const b of blocks) {
    if (b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3') {
      stepCounter = 0;
      const t = b.text || '';
      if (/mambo/i.test(t)) {
        currentSectionMode = 'mambo';
      } else if (/olla|cazuela|tradicional/i.test(t)) {
        currentSectionMode = 'olla';
      } else {
        currentSectionMode = 'neutral';
      }
    }

    if (currentCookMode === 'olla' && currentSectionMode === 'mambo') continue;
    if (currentCookMode === 'mambo' && currentSectionMode === 'olla') continue;

    if (b.type === 'quote') {
      html += `<div class="detail-quote">💡 ${formatRichParts(b.parts, b.text)}</div>`;
    } else if (b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3') {
      html += `<h2>${escapeHtml(b.text)}</h2>`;
    } else if (b.type === 'bulleted_list_item') {
      html += `<div class="check-item" onclick="this.classList.toggle('checked')">
        <div class="check-box">✓</div>
        <div>${formatRichParts(b.parts, b.text)}</div>
      </div>`;
    } else if (b.type === 'numbered_list_item') {
      stepCounter++;
      html += `<div class="check-item" onclick="this.classList.toggle('checked')">
        <div class="step-num-badge">${stepCounter}</div>
        <div>${formatRichParts(b.parts, b.text)}</div>
      </div>`;
    } else if (b.type === 'paragraph' && b.text) {
      html += `<p style="line-height:1.6; margin: 10px 0">${formatRichParts(b.parts, b.text)}</p>`;
    } else if (b.type === 'table' && Array.isArray(b.rows)) {
      html += `<table class="recipe-table"><tbody>${b.rows
        .map(
          row =>
            `<tr onclick="this.classList.toggle('checked')">${row
              .map(cell => `<td>${escapeHtml(cell)}</td>`)
              .join('')}</tr>`
        )
        .join('')}</tbody></table>`;
    }
  }

  document.getElementById('detailContent').innerHTML = html;
}

function formatRichParts(parts, fallbackText) {
  if (Array.isArray(parts) && parts.length > 0) {
    return parts
      .map(p => (p.bold ? `<strong>${escapeHtml(p.text)}</strong>` : escapeHtml(p.text)))
      .join('');
  }
  return escapeHtml(fallbackText || '');
}

function closeDetailModal() {
  document.getElementById('detailModal').style.display = 'none';
  document.body.style.overflow = '';
  releaseWakeLock();
}

function closeDetailOnBackdrop(e) {
  if (e.target.id === 'detailModal') closeDetailModal();
}

async function toggleWakeLock() {
  const btn = document.getElementById('wakeLockBtn');
  if (wakeLockSentinel) {
    await releaseWakeLock();
    return;
  }
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      btn.classList.add('active');
      btn.textContent = '💡 Pantalla encendida: ON';
    } catch (e) {
      alert('Tu navegador no permitió bloquear el apagado de pantalla.');
    }
  } else {
    alert('Función disponible en Safari iOS 16.4+ / Chrome.');
  }
}

async function releaseWakeLock() {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch (e) {}
    wakeLockSentinel = null;
  }
  const btn = document.getElementById('wakeLockBtn');
  if (btn) {
    btn.classList.remove('active');
    btn.textContent = '💡 Pantalla siempre encendida: OFF';
  }
}

async function regenerateCurrentCover() {
  if (!currentRecipe) return;
  const btn = document.getElementById('regenCoverBtn');
  btn.textContent = '⏳ Generando foto IA...';
  btn.disabled = true;
  try {
    const res = await fetch(`/api/recipes/${currentRecipe.id}/regenerate-cover`, { method: 'POST' });
    const data = await res.json();
    if (data.recipe) {
      currentRecipe = data.recipe;
      const idx = allRecipes.findIndex(r => r.id === currentRecipe.id);
      if (idx >= 0) allRecipes[idx] = currentRecipe;
      document.getElementById('detailHero').style.backgroundImage = `url('${currentRecipe.cover}')`;
      renderGallery();
    }
  } finally {
    btn.textContent = '🎨 Nueva foto IA';
    btn.disabled = false;
  }
}

async function deleteCurrentRecipe() {
  if (!currentRecipe) return;
  if (!confirm(`¿Seguro que quieres borrar "${currentRecipe.title}"?`)) return;
  await fetch(`/api/recipes/${currentRecipe.id}`, { method: 'DELETE' });
  allRecipes = allRecipes.filter(r => r.id !== currentRecipe.id);
  closeDetailModal();
  renderTagPills();
  renderGallery();
}

// Add / Chef Chat Modal
function openAddModal() {
  document.getElementById('editRecipeId').value = '';
  document.getElementById('addModalTitle').textContent = '👩‍🍳 Crear Receta con el Chef IA';
  chefHistory = [
    {
      role: 'assistant',
      text: '¡Kaixo! 👩‍🍳 Dime qué receta te apetece crear (por ejemplo: "Quiero hacer una pizza casera de jamón serrano y burrata" o pega una receta/foto). Te prepararé una propuesta y podrás pedirme todos los cambios que quieras antes de aprobarla y guardarla.'
    }
  ];
  currentDraftRecipe = null;
  clearPickedPhoto();
  renderChefChat();
  renderDraftPreview();
  switchAddTab('ai');
  document.getElementById('addModal').style.display = 'flex';
}

function renderChefChat() {
  const box = document.getElementById('chefChatBox');
  box.innerHTML = chefHistory
    .map(
      m =>
        `<div class="chat-bubble ${m.role === 'user' ? 'user' : 'assistant'}">${escapeHtml(
          m.text
        )}</div>`
    )
    .join('');
  box.scrollTop = box.scrollHeight;
}

function renderDraftPreview() {
  const card = document.getElementById('draftPreviewCard');
  if (!currentDraftRecipe) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.getElementById('draftTitle').textContent = `${currentDraftRecipe.icon || '🍲'} ${
    currentDraftRecipe.title
  }`;
  document.getElementById('draftMeta').textContent = `⏱️ ${
    currentDraftRecipe.totalTime || '40 min'
  } · 👥 ${currentDraftRecipe.yield || 4} raciones · 🏷️ ${(currentDraftRecipe.tags || []).join(', ')}`;

  let bodyHtml = '';
  if (currentDraftRecipe.quote) {
    bodyHtml += `<p style="background:#fff8eb; padding:8px 12px; border-radius:8px; margin:6px 0">💡 ${escapeHtml(
      currentDraftRecipe.quote
    )}</p>`;
  }
  for (const sec of currentDraftRecipe.sections || []) {
    bodyHtml += `<h4>${escapeHtml(sec.heading)}</h4>`;
    if (sec.type === 'bullets') {
      bodyHtml += `<ul>${(sec.items || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    } else if (sec.type === 'steps') {
      bodyHtml += `<ol>${(sec.steps || [])
        .map(s => `<li><strong>${escapeHtml(s.bold || '')}</strong>${escapeHtml(s.text || '')}</li>`)
        .join('')}</ol>`;
    }
  }
  document.getElementById('draftPreviewBody').innerHTML = bodyHtml;
}

async function sendChefMessage() {
  const input = document.getElementById('chefChatInput');
  const text = input.value.trim();
  if (!text && !pickedAiImageBase64) return;

  const userMsg = text || '📸 [Foto de receta enviada]';
  chefHistory.push({ role: 'user', text: userMsg });
  input.value = '';
  renderChefChat();

  const btn = document.getElementById('btnSendChef');
  btn.disabled = true;
  btn.textContent = '⏳ Pensando...';

  try {
    const res = await fetch('/api/chef-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: chefHistory,
        currentDraft: currentDraftRecipe,
        imageBase64: pickedAiImageBase64,
        imageMimeType: pickedAiImageMime,
        adaptMambo: document.getElementById('aiAdaptMambo').checked,
        dualMode: document.getElementById('aiDualMode').checked
      })
    });
    const data = await res.json();
    clearPickedPhoto();
    if (data.error) {
      chefHistory.push({ role: 'assistant', text: `⚠️ ${data.error}` });
    } else {
      chefHistory.push({
        role: 'assistant',
        text:
          data.assistantMessage ||
          '¡Aquí tienes la propuesta de receta! Revísala abajo: si te gusta pulsa en Aprobar, o dime qué quieres cambiar.'
      });
      if (data.recipe) {
        currentDraftRecipe = data.recipe;
        renderDraftPreview();
      }
    }
    renderChefChat();
  } catch (err) {
    chefHistory.push({ role: 'assistant', text: `⚠️ Error al conectar: ${err.message}` });
    renderChefChat();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar ➤';
  }
}

async function approveAndSaveDraft() {
  if (!currentDraftRecipe) return;
  const btn = document.getElementById('btnApproveDraft');
  btn.disabled = true;
  btn.textContent = '⏳ Generando foto con IA y guardando...';

  try {
    const res = await fetch('/api/recipes/approve-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe: currentDraftRecipe })
    });
    const data = await res.json();
    if (data.recipe) {
      allRecipes.unshift(data.recipe);
      closeAddModal();
      renderTagPills();
      renderGallery();
      openRecipeDetail(data.recipe.id);
    } else {
      alert(data.error || 'Error al guardar la receta');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ ¡La apruebo! Guardar con Foto IA';
  }
}

function handleAiImagePicked(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  pickedAiImageMime = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = () => {
    pickedAiImageBase64 = reader.result;
    document.getElementById('attachedPhotoIndicator').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function clearPickedPhoto() {
  pickedAiImageBase64 = null;
  pickedAiImageMime = null;
  const el = document.getElementById('attachedPhotoIndicator');
  if (el) el.style.display = 'none';
}

function openEditCurrentRecipe() {
  if (!currentRecipe) return;
  const r = currentRecipe;
  closeDetailModal();
  document.getElementById('editRecipeId').value = r.id;
  document.getElementById('addModalTitle').textContent = '✏️ Editar Receta';
  document.getElementById('manIcon').value = r.icon || '🍲';
  document.getElementById('manTitle').value = r.title || '';
  document.getElementById('manTime').value = r.totalTime || '';
  document.getElementById('manYield').value = r.yield || '';
  document.getElementById('manStars').value = r.starRating || '★★★★★';
  document.getElementById('manTags').value = (r.tags || []).join(', ');

  const ings = [];
  const steps = [];
  for (const b of r.blocks || []) {
    if (b.type === 'bulleted_list_item') ings.push(b.text);
    if (b.type === 'numbered_list_item') steps.push(b.text);
  }
  document.getElementById('manIngredients').value = ings.join('\n');
  document.getElementById('manSteps').value = steps.join('\n');

  switchAddTab('manual');
  document.getElementById('addModal').style.display = 'flex';
}

function closeAddModal() {
  document.getElementById('addModal').style.display = 'none';
}

function closeAddOnBackdrop(e) {
  if (e.target.id === 'addModal') closeAddModal();
}

function switchAddTab(tab) {
  document.getElementById('tabAiBtn').classList.toggle('active', tab === 'ai');
  document.getElementById('tabManualBtn').classList.toggle('active', tab === 'manual');
  document.getElementById('aiTabContent').style.display = tab === 'ai' ? 'block' : 'none';
  document.getElementById('manualTabContent').style.display = tab === 'manual' ? 'block' : 'none';
}

async function submitManualRecipe() {
  const editId = document.getElementById('editRecipeId').value;
  const icon = document.getElementById('manIcon').value.trim() || '🍲';
  const title = document.getElementById('manTitle').value.trim() || 'Nueva Receta';
  const totalTime = document.getElementById('manTime').value.trim();
  const yieldVal = document.getElementById('manYield').value;
  const starRating = document.getElementById('manStars').value;
  const tags = document
    .getElementById('manTags')
    .value.split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const ingLines = document
    .getElementById('manIngredients')
    .value.split('\n')
    .map(s => s.trim())
    .filter(Boolean);
  const stepLines = document
    .getElementById('manSteps')
    .value.split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const blocks = [
    { type: 'heading_2', text: 'Ingredientes', parts: [{ text: 'Ingredientes', bold: false }] },
    ...ingLines.map(l => ({
      type: 'bulleted_list_item',
      text: l,
      parts: [{ text: l, bold: false }]
    })),
    { type: 'heading_2', text: 'Preparación', parts: [{ text: 'Preparación', bold: false }] },
    ...stepLines.map(l => {
      const idx = l.indexOf(':');
      if (idx > 0 && idx < 45) {
        return {
          type: 'numbered_list_item',
          text: l,
          parts: [
            { text: l.slice(0, idx + 1) + ' ', bold: true },
            { text: l.slice(idx + 1).trim(), bold: false }
          ]
        };
      }
      return {
        type: 'numbered_list_item',
        text: l,
        parts: [{ text: l, bold: false }]
      };
    })
  ];

  if (editId) {
    const res = await fetch(`/api/recipes/${editId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        icon,
        title,
        totalTime,
        yield: yieldVal ? Number(yieldVal) : null,
        starRating,
        tags,
        blocks
      })
    });
    const data = await res.json();
    if (data.recipe) {
      const idx = allRecipes.findIndex(r => r.id === editId);
      if (idx >= 0) allRecipes[idx] = data.recipe;
      closeAddModal();
      renderTagPills();
      renderGallery();
      openRecipeDetail(editId);
    }
  } else {
    const res = await fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        icon,
        title,
        totalTime,
        yield: yieldVal ? Number(yieldVal) : null,
        starRating,
        tags,
        blocks
      })
    });
    const data = await res.json();
    if (data.recipe) {
      allRecipes.unshift(data.recipe);
      closeAddModal();
      renderTagPills();
      renderGallery();
      openRecipeDetail(data.recipe.id);
    }
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

loadRecipes();
