const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'recipes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

function loadEnv() {
  const candidates = [
    path.join(__dirname, '.env'),
    path.join(process.env.USERPROFILE || '', '.env')
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z0-9_]+)=(.+)$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].trim();
        }
      }
    }
  }
}
loadEnv();

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

function readRecipes() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function writeRecipes(recipes) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(recipes, null, 2), 'utf8');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(str ? JSON.parse(str) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function generateFoodCover(title, englishPrompt) {
  const safePrompt = encodeURIComponent(
    englishPrompt ||
      `Professional editorial food photography of ${title}, homemade appetizing dish on a rustic ceramic plate, warm natural daylight, shallow depth of field, high resolution`
  );
  const seed = Math.floor(Math.random() * 1000000);
  const pollUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=1024&height=768&seed=${seed}&nologo=true&model=flux`;
  try {
    const fileName = `ai_${Date.now()}_${seed}.jpg`;
    const filePath = path.join(IMAGES_DIR, fileName);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    const resp = await fetch(pollUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > 5000) {
        fs.writeFileSync(filePath, buf);
        return `/images/${fileName}`;
      }
    }
  } catch (e) {
    // Fallback to direct URL if download times out
  }
  return pollUrl;
}

function extractFirstJsonObject(str) {
  const cleaned = String(str || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  }
  return JSON.parse(cleaned);
}

async function chatWithChefAI({ history, currentDraft, imageBase64, imageMimeType, adaptMambo, dualMode }) {
  const systemPrompt = `Eres el Chef IA de "Errezetak", una aplicación familiar de recetas vascas y caseras.
El usuario puede hacer CUALQUIERA de estas 3 cosas:
1) DARTE UNA RECETA QUE YA TIENE (pegando el texto de su receta, o subiendo una foto/PDF de una receta en castellano o euskera):
   - En este caso, NO te inventes una receta distinta: respeta fielmente todos los ingredientes, cantidades y pasos de la receta que te ha pasado el usuario (si está en euskera, pon la explicación en castellano conservando las expresiones originales si quieres).
   - Estructúrala limpia con el formato de Errezetak.
2) PEDIRTE QUE CREES O INVENTES UNA RECETA (ej. "Quiero hacer una pizza de jamón y burrata"):
   - En este caso, propón tú una receta casera completa y deliciosa.
3) PEDIRTE CAMBIOS SOBRE EL BORRADOR ACTUAL (ej. "Cambia la burrata por mozzarella", "Hazla para 6 personas"):
   - Modifica el borrador actual aplicando exactamente lo que pide.

Preferencias marcadas actualmente:
- Adaptar a Mambo Cecotec: ${adaptMambo ? 'SÍ (detallar accesorio: cuchillas, cuchara MamboMix o mariposa; velocidad Vel; temperatura ºC; potencia calorífica PC y tiempo)' : 'Solo si lo pide el usuario'}
- Incluir los 2 modos (Olla Exprés/Tradicional y Mambo Cecotec): ${dualMode ? 'SÍ, incluye una sección de pasos "Preparación en Olla Exprés / Tradicional" y otra "Preparación en Mambo Cecotec"' : 'No obligatorio'}

${currentDraft ? `BORRADOR ACTUAL DE LA RECETA (modifícalo según lo que pida ahora el usuario):\n${JSON.stringify(currentDraft, null, 2)}` : ''}

Responde SIEMPRE ÚNICAMENTE con un objeto JSON válido con esta estructura exacta (sin texto fuera del JSON):
{
  "assistantMessage": "Breve respuesta amable al usuario explicando que has estructurado su receta (o creado/modificado la propuesta) y preguntando si la aprueba o quiere cambiar algo.",
  "recipe": {
    "title": "Nombre descriptivo del plato",
    "icon": "🍕",
    "tags": ["Comida", "Facil", "Mambo"],
    "totalTime": "45 min",
    "yield": 4,
    "quote": "Consejo clave o descripción breve del plato",
    "imagePromptEn": "Mouth-watering realistic editorial food photography of ...",
    "sections": [
      {
        "heading": "Ingredientes",
        "type": "bullets",
        "items": ["300 g de harina...", "..."]
      },
      {
        "heading": "Preparación Tradicional / Olla Exprés",
        "type": "steps",
        "steps": [
          { "bold": "Preparar la masa: ", "text": "Mezclar..." }
        ]
      }
    ]
  }
}`;

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const userMessagesText = (history || [])
    .map(m => `${m.role === 'user' ? 'Usuario' : 'Chef IA'}: ${m.text}`)
    .join('\n\n');

  // 1. Try Google Gemini (Vertex Express AQ. key or AI Studio AIza key)
  if (apiKey) {
    try {
      const parts = [{ text: `${systemPrompt}\n\nHistorial de conversación:\n${userMessagesText}` }];
      if (imageBase64) {
        parts.push({
          inline_data: {
            mime_type: imageMimeType || 'image/jpeg',
            data: imageBase64.replace(/^data:[^;]+;base64,/, '')
          }
        });
      }

      const geminiUrl = apiKey.startsWith('AQ.')
        ? `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${apiKey}`
        : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const resp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textOut) {
          return extractFirstJsonObject(textOut);
        }
      }
    } catch (e) {
      console.warn('Gemini direct call warning, using cloud AI fallback:', e.message);
    }
  }

  // 2. Cloud AI Fallback (supports both text and vision images!)
  const messages = [{ role: 'system', content: systemPrompt }];
  const hist = history || [];
  for (let i = 0; i < hist.length; i++) {
    const m = hist[i];
    const isLastUser = i === hist.length - 1 && m.role === 'user';
    if (isLastUser && imageBase64 && imageBase64.startsWith('data:image/')) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: m.text || 'Extrae y estructura la receta de esta imagen.' },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]
      });
    } else {
      messages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text
      });
    }
  }

  const fallbackResp = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages,
      response_format: { type: 'json_object' }
    })
  });

  if (fallbackResp.ok) {
    const data = await fallbackResp.json();
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      return extractFirstJsonObject(content);
    }
  }

  throw new Error('No se pudo contactar con el Chef IA en este momento.');
}

function sectionsToBlocks(quote, sections) {
  const blocks = [];
  if (quote) {
    blocks.push({
      type: 'quote',
      text: quote,
      parts: [{ text: quote, bold: false }]
    });
  }
  for (const sec of sections || []) {
    blocks.push({
      type: 'heading_2',
      text: sec.heading,
      parts: [{ text: sec.heading, bold: false }]
    });
    if (sec.type === 'bullets') {
      for (const item of sec.items || []) {
        blocks.push({
          type: 'bulleted_list_item',
          text: item,
          parts: [{ text: item, bold: false }]
        });
      }
    } else if (sec.type === 'steps') {
      for (const st of sec.steps || []) {
        const boldPart = st.bold ? (st.bold.endsWith(' ') ? st.bold : st.bold + ' ') : '';
        const textPart = st.text || '';
        blocks.push({
          type: 'numbered_list_item',
          text: boldPart + textPart,
          parts: [
            ...(boldPart ? [{ text: boldPart, bold: true }] : []),
            { text: textPart, bold: false }
          ]
        });
      }
    }
  }
  return blocks;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      return sendJson(res, 200, { ok: true });
    }

    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    if (pathname === '/api/recipes' && req.method === 'GET') {
      const recipes = readRecipes();
      return sendJson(res, 200, { recipes });
    }

    if (pathname === '/api/chef-chat' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await chatWithChefAI(body);
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/recipes/approve-draft' && req.method === 'POST') {
      const body = await readBody(req);
      const draft = body.recipe;
      if (!draft || !draft.title) {
        return sendJson(res, 400, { error: 'Falta el borrador de la receta' });
      }
      const cover = await generateFoodCover(draft.title, draft.imagePromptEn);
      const blocks = sectionsToBlocks(draft.quote, draft.sections);

      const newRecipe = {
        id: crypto.randomUUID(),
        title: draft.title,
        icon: draft.icon || '🍽️',
        tags: Array.isArray(draft.tags) ? draft.tags : ['Comida'],
        totalTime: draft.totalTime || '40 min',
        yield: draft.yield ? Number(draft.yield) : 4,
        starRating: '★★★★★',
        sourceUrl: null,
        cover,
        createdAt: new Date().toISOString(),
        blocks
      };

      const recipes = readRecipes();
      recipes.unshift(newRecipe);
      writeRecipes(recipes);
      return sendJson(res, 201, { recipe: newRecipe });
    }

    if (pathname === '/api/recipes' && req.method === 'POST') {
      const body = await readBody(req);
      let cover = body.cover;
      if (!cover) {
        cover = await generateFoodCover(body.title || 'Receta casera', body.imagePromptEn);
      }

      const newRecipe = {
        id: crypto.randomUUID(),
        title: body.title || 'Nueva Receta',
        icon: body.icon || '🍽️',
        tags: Array.isArray(body.tags) ? body.tags : [],
        totalTime: body.totalTime || '',
        yield: body.yield ? Number(body.yield) : null,
        starRating: body.starRating || '★★★★★',
        sourceUrl: body.sourceUrl || null,
        cover,
        createdAt: new Date().toISOString(),
        blocks: Array.isArray(body.blocks) ? body.blocks : []
      };

      const recipes = readRecipes();
      recipes.unshift(newRecipe);
      writeRecipes(recipes);
      return sendJson(res, 201, { recipe: newRecipe });
    }

    if (pathname.startsWith('/api/recipes/') && pathname.endsWith('/regenerate-cover') && req.method === 'POST') {
      const id = pathname.replace('/api/recipes/', '').replace('/regenerate-cover', '');
      const recipes = readRecipes();
      const idx = recipes.findIndex(r => r.id === id);
      if (idx === -1) return sendJson(res, 404, { error: 'Receta no encontrada' });

      const cover = await generateFoodCover(recipes[idx].title);
      recipes[idx].cover = cover;
      writeRecipes(recipes);
      return sendJson(res, 200, { recipe: recipes[idx] });
    }

    if (pathname.startsWith('/api/recipes/') && req.method === 'PUT') {
      const id = pathname.replace('/api/recipes/', '');
      const body = await readBody(req);
      const recipes = readRecipes();
      const idx = recipes.findIndex(r => r.id === id);
      if (idx === -1) return sendJson(res, 404, { error: 'Receta no encontrada' });

      recipes[idx] = { ...recipes[idx], ...body, id };
      writeRecipes(recipes);
      return sendJson(res, 200, { recipe: recipes[idx] });
    }

    if (pathname.startsWith('/api/recipes/') && req.method === 'DELETE') {
      const id = pathname.replace('/api/recipes/', '');
      const recipes = readRecipes();
      const filtered = recipes.filter(r => r.id !== id);
      writeRecipes(filtered);
      return sendJson(res, 200, { ok: true });
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }

    const indexHtml = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(indexHtml).pipe(res);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: err.message || 'Error interno del servidor' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Errezetak Web App corriendo en http://localhost:${PORT}`);
});
