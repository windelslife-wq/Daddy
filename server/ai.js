import { z } from 'zod';
import { config } from './config.js';
import { logger } from './logger.js';
import { PLATFORMS } from './constants.js';

const sceneSchema = z.object({
  narration: z.string().trim().min(8).max(800),
  visualPrompt: z.string().trim().min(8).max(500),
  caption: z.string().trim().max(220).optional(),
});
const captionSchema = z.object({
  title: z.string().trim().max(180).default(''),
  description: z.string().trim().max(5000).default(''),
  hashtags: z.array(z.string().max(80)).max(20).default([]),
});
const planSchema = z.object({
  title: z.string().trim().min(3).max(220),
  hook: z.string().trim().min(5).max(400),
  script: z.string().trim().min(80).max(12000),
  scenes: z.array(sceneSchema).min(3).max(12),
  captions: z.record(z.string(), captionSchema.partial()).optional().default({}),
  safetyNotes: z.string().max(1000).optional(),
});

const SOURCE_SCHEMA = z.object({ title: z.string().max(300), url: z.string().url(), description: z.string().max(500).optional() });

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function truncate(value, max) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}
function slugWords(topic, count = 3) {
  const words = cleanText(topic).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  return (words.length ? words : ['faceless', 'story']).slice(0, count);
}
const STOP_WORDS = new Set(['about', 'with', 'that', 'this', 'from', 'into', 'your', 'have', 'their', 'what', 'when', 'where', 'story', 'stories', 'video', 'short']);
function sanitizeHashtag(word) {
  const camel = String(word).replace(/[^a-zA-Z0-9]/g, '');
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) {
    const snippet = text.slice(0, 600).replace(/(access_token|api[_-]?key|authorization)=[^&\s]+/gi, '$1=[redacted]');
    const error = new Error(`External API returned ${response.status}: ${snippet || response.statusText}`);
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    error.retryable = response.status === 429 || response.status >= 500;
    error.responseBody = snippet;
    throw error;
  }
  return { response, text };
}

export function extractJson(text) {
  let cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

export async function callLLM(prompt, { system = 'You are a professional short-form video writer.', temperature = 0.8, maxTokens = 4000 } = {}) {
  const provider = config.ai.provider;
  if (provider === 'openai') {
    const { text } = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.openaiKey}` },
      body: JSON.stringify({
        model: config.ai.openaiModel,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      }),
    });
    return JSON.parse(text).choices?.[0]?.message?.content || '';
  }
  if (provider === 'anthropic') {
    const { text } = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.ai.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.ai.anthropicModel, system, max_tokens: maxTokens, temperature, messages: [{ role: 'user', content: prompt }] }),
    });
    return JSON.parse(text).content?.map((part) => part.text || '').join('\n') || '';
  }
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.geminiModel)}:generateContent?key=${encodeURIComponent(config.ai.geminiKey)}`;
    const { text } = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json', maxOutputTokens: maxTokens },
      }),
    });
    return JSON.parse(text).candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '';
  }
  throw new Error('No external LLM provider is configured. Set AI_PROVIDER and its API key.');
}

export async function researchTopic(topic, niche = '') {
  const provider = config.ai.researchProvider;
  if (provider === 'none') return { provider: 'none', sources: [] };
  if (!config.ai.researchApiKey) throw new Error(`${provider.toUpperCase()} research is selected but SEARCH_API_KEY is not configured.`);
  const query = `${niche ? `${niche}: ` : ''}${topic}`.slice(0, 300);
  let raw = [];
  if (provider === 'brave') {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '5');
    url.searchParams.set('freshness', 'pm');
    const { text } = await fetchWithTimeout(url, { headers: { accept: 'application/json', 'x-subscription-token': config.ai.researchApiKey } }, 30000);
    raw = JSON.parse(text).web?.results || [];
  } else if (provider === 'tavily') {
    const { text } = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: config.ai.researchApiKey, query, search_depth: 'basic', max_results: 5, include_answer: false }),
    }, 30000);
    raw = JSON.parse(text).results || [];
  } else {
    throw new Error(`Unsupported SEARCH_PROVIDER "${provider}". Use none, brave, or tavily.`);
  }
  const sources = raw.slice(0, 5).map((item) => {
    const parsed = SOURCE_SCHEMA.safeParse({ title: item.title, url: item.url, description: item.description || item.snippet });
    return parsed.success ? parsed.data : null;
  }).filter(Boolean);
  return { provider, sources };
}

const LOCAL_TEXT = {
  en: {
    title: (t) => `The Untold Story of ${t}`,
    hook: (t) => `What if everything you thought you knew about ${t} was only the beginning?`,
    scene: (t, i, n) => [
      `Before we judge ${t}, look at the moment that started it all. The smallest detail can change the entire story.`,
      `At first, ${t} seems straightforward. Then the timeline, the people, and the evidence begin to pull in different directions.`,
      `This is where the story becomes fascinating. A careful look at ${t} reveals questions that are still worth asking today.`,
      `Every account has a turning point. In this one, a single choice reshapes how we understand ${t}.`,
      `The lasting lesson is simple: context matters. ${t} is not just a headline, but a chain of decisions and consequences.`,
      `So the next time you hear about ${t}, remember the detail that almost disappeared. Follow for more original stories.`,
    ][i % n],
    cta: 'Follow for more original, carefully written stories.',
    hashtags: ['Storytelling', 'Shorts', 'LearnSomethingNew'],
  },
  es: {
    title: (t) => `La historia oculta de ${t}`,
    hook: (t) => `¿Y si todo lo que creías saber sobre ${t} fuera solo el comienzo?`,
    scene: (t, i, n) => [
      `Antes de juzgar ${t}, observa el momento que lo empezó todo. Un pequeño detalle puede cambiar la historia.`,
      `Al principio, ${t} parece sencillo. Después aparecen preguntas, personas y decisiones inesperadas.`,
      `Aquí la historia se vuelve fascinante. Mirar ${t} con calma revela conexiones que suelen pasar desapercibidas.`,
      `Toda historia tiene un punto de giro. Una decisión cambia por completo nuestra forma de entender ${t}.`,
      `La lección es clara: el contexto importa. ${t} es una cadena de causas, consecuencias y preguntas abiertas.`,
      `La próxima vez que escuches hablar de ${t}, recuerda este detalle. Sígueme para más historias originales.`,
    ][i % n],
    cta: 'Sígueme para más historias originales.',
    hashtags: ['Historias', 'Shorts', 'Aprender'],
  },
  fr: {
    title: (t) => `L’histoire méconnue de ${t}`,
    hook: (t) => `Et si tout ce que vous pensiez savoir sur ${t} n’était que le début ?`,
    scene: (t, i, n) => [
      `Avant de juger ${t}, regardez le moment qui a tout déclenché. Un détail minuscule peut transformer toute l’histoire.`,
      `Au début, ${t} paraît simple. Puis les dates, les personnes et les faits commencent à se contredire.`,
      `C’est ici que l’histoire devient passionnante. Observer ${t} de près révèle des questions encore actuelles.`,
      `Chaque récit possède un tournant. Une seule décision change notre compréhension de ${t}.`,
      `La leçon est simple : le contexte compte. ${t} est une chaîne de choix et de conséquences.`,
      `La prochaine fois que vous entendrez parler de ${t}, souvenez-vous de ce détail. Suivez pour d’autres histoires originales.`,
    ][i % n],
    cta: 'Suivez pour d’autres histoires originales.',
    hashtags: ['Histoires', 'Shorts', 'Savoir'],
  },
  de: {
    title: (t) => `Die unbekannte Geschichte von ${t}`,
    hook: (t) => `Was wäre, wenn alles, was du über ${t} weißt, erst der Anfang wäre?`,
    scene: (t, i, n) => [
      `Bevor du ${t} beurteilst, sieh dir den Moment an, in dem alles begann. Ein kleines Detail verändert die ganze Geschichte.`,
      `Zuerst wirkt ${t} einfach. Dann tauchen Fragen, Menschen und unerwartete Entscheidungen auf.`,
      `Jetzt wird die Geschichte spannend. Ein genauer Blick auf ${t} zeigt Zusammenhänge, die oft übersehen werden.`,
      `Jede Geschichte hat einen Wendepunkt. Eine Entscheidung verändert unser Verständnis von ${t}.`,
      `Die wichtigste Lektion: Der Zusammenhang zählt. ${t} ist eine Kette aus Ursachen und Folgen.`,
      `Wenn du das nächste Mal von ${t} hörst, denk an dieses Detail. Folge für mehr originale Geschichten.`,
    ][i % n],
    cta: 'Folge für weitere originale Geschichten.',
    hashtags: ['Geschichten', 'Shorts', 'Wissen'],
  },
  pt: {
    title: (t) => `A história desconhecida de ${t}`,
    hook: (t) => `E se tudo o que você sabia sobre ${t} fosse apenas o começo?`,
    scene: (t, i, n) => [
      `Antes de julgar ${t}, observe o momento que começou tudo. Um pequeno detalhe pode mudar a história inteira.`,
      `No início, ${t} parece simples. Depois surgem perguntas, pessoas e decisões inesperadas.`,
      `É aqui que a história fica fascinante. Olhar ${t} com atenção revela conexões quase sempre ignoradas.`,
      `Toda história tem um ponto de virada. Uma decisão muda nossa compreensão sobre ${t}.`,
      `A lição é simples: o contexto importa. ${t} é uma cadeia de escolhas e consequências.`,
      `Da próxima vez que ouvir falar de ${t}, lembre-se deste detalhe. Siga para mais histórias originais.`,
    ][i % n],
    cta: 'Siga para mais histórias originais.',
    hashtags: ['Historias', 'Shorts', 'Conhecimento'],
  },
  it: {
    title: (t) => `La storia nascosta di ${t}`,
    hook: (t) => `E se tutto quello che sai su ${t} fosse solo l’inizio?`,
    scene: (t, i, n) => [
      `Prima di giudicare ${t}, osserva il momento da cui è cominciato tutto. Un piccolo dettaglio può cambiare la storia.`,
      `All’inizio ${t} sembra semplice. Poi arrivano domande, persone e decisioni inaspettate.`,
      `Qui la storia diventa affascinante. Guardare ${t} da vicino rivela collegamenti spesso invisibili.`,
      `Ogni storia ha un punto di svolta. Una decisione cambia il modo in cui comprendiamo ${t}.`,
      `La lezione è semplice: il contesto conta. ${t} è una catena di cause e conseguenze.`,
      `La prossima volta che sentirai parlare di ${t}, ricorda questo dettaglio. Segui per altre storie originali.`,
    ][i % n],
    cta: 'Segui per altre storie originali.',
    hashtags: ['Storie', 'Shorts', 'Conoscere'],
  },
  nl: {
    title: (t) => `Het onbekende verhaal van ${t}`,
    hook: (t) => `Wat als alles wat je dacht te weten over ${t} pas het begin was?`,
    scene: (t, i, n) => [
      `Voordat je ${t} beoordeelt, kijk naar het moment waarop alles begon. Eén klein detail verandert het hele verhaal.`,
      `Eerst lijkt ${t} eenvoudig. Dan verschijnen er vragen, mensen en onverwachte keuzes.`,
      `Hier wordt het verhaal fascinerend. Een zorgvuldige blik op ${t} laat verbanden zien die vaak worden gemist.`,
      `Elk verhaal heeft een keerpunt. Eén beslissing verandert ons begrip van ${t}.`,
      `De les is eenvoudig: context telt. ${t} is een keten van oorzaken en gevolgen.`,
      `Denk de volgende keer dat je over ${t} hoort aan dit detail. Volg voor meer originele verhalen.`,
    ][i % n],
    cta: 'Volg voor meer originele verhalen.',
    hashtags: ['Verhalen', 'Shorts', 'Leren'],
  },
  pl: {
    title: (t) => `Nieznana historia ${t}`,
    hook: (t) => `A jeśli wszystko, co wiesz o ${t}, to dopiero początek?`,
    scene: (t, i, n) => [
      `Zanim ocenisz ${t}, spójrz na moment, od którego wszystko się zaczęło. Jeden drobny szczegół zmienia całą historię.`,
      `Początkowo ${t} wydaje się prosty. Potem pojawiają się pytania, ludzie i nieoczekiwane decyzje.`,
      `Właśnie tutaj historia staje się fascynująca. Uważne spojrzenie na ${t} ujawnia często pomijane związki.`,
      `Każda historia ma punkt zwrotny. Jedna decyzja zmienia nasze rozumienie ${t}.`,
      `Najważniejsza lekcja jest prosta: kontekst ma znaczenie. ${t} to łańcuch przyczyn i skutków.`,
      `Gdy następnym razem usłyszysz o ${t}, przypomnij sobie ten szczegół. Obserwuj, by zobaczyć więcej oryginalnych historii.`,
    ][i % n],
    cta: 'Obserwuj, by zobaczyć więcej oryginalnych historii.',
    hashtags: ['Historie', 'Shorts', 'Wiedza'],
  },
  tr: {
    title: (t) => `${t} hakkında bilinmeyen hikâye`,
    hook: (t) => `${t} hakkında bildiğiniz her şey sadece bir başlangıç olsaydı?`,
    scene: (t, i, n) => [
      `${t} hakkında karar vermeden önce her şeyin başladığı ana bakın. Küçük bir ayrıntı tüm hikâyeyi değiştirebilir.`,
      `İlk bakışta ${t} basit görünür. Sonra sorular, insanlar ve beklenmedik kararlar ortaya çıkar.`,
      `Hikâye tam burada ilginçleşir. ${t} dikkatle incelendiğinde çoğu zaman görülmeyen bağlantılar ortaya çıkar.`,
      `Her hikâyenin bir dönüm noktası vardır. Tek bir karar, ${t} anlayışımızı tamamen değiştirir.`,
      `Asıl ders basit: bağlam önemlidir. ${t}, nedenler ve sonuçlardan oluşan bir zincirdir.`,
      `Bir dahaki sefere ${t} hakkında bir şey duyduğunuzda bu ayrıntıyı hatırlayın. Daha fazla özgün hikâye için takip edin.`,
    ][i % n],
    cta: 'Daha fazla özgün hikâye için takip edin.',
    hashtags: ['Hikayeler', 'Shorts', 'Bilgi'],
  },
  zh: {
    title: (t) => `关于${t}的未知故事`,
    hook: (t) => `如果你对${t}的了解只是一个开始呢？`,
    scene: (t, i, n) => [
      `在评价${t}之前，先看看这一切开始的时刻。一个微小的细节可能会改变整个故事。`,
      `起初，${t}似乎很简单。随后，问题、人物和意想不到的选择陆续出现。`,
      `故事在这里变得引人入胜。仔细观察${t}，会发现许多常被忽略的联系。`,
      `每个故事都有转折点。一个决定会彻底改变我们对${t}的理解。`,
      `最重要的启示很简单：背景很重要。${t}是一连串原因与结果。`,
      `下次听到${t}时，请记住这个细节。关注我们，查看更多原创故事。`,
    ][i % n],
    cta: '关注我们，查看更多原创故事。',
    hashtags: ['故事', 'Shorts', '知识'],
  },
};

const NICHE_HOOKS = {
  horror: 'There is a story about {topic} that people avoid telling after dark.',
  'true-crime': 'The case of {topic} begins with a question that never fully went away.',
  history: 'History remembers {topic}, but not always for the reasons we think.',
  motivation: 'If {topic} feels impossible, this is your reminder to begin anyway.',
  education: 'Here is the surprising idea behind {topic}, explained simply.',
  business: 'The biggest lesson in {topic} is not what most people expect.',
  entertainment: 'Every memorable story has a twist. This one begins with {topic}.',
  religion: 'A quiet reflection on {topic} can change how we see the day.',
  news: 'The conversation around {topic} is moving quickly. Here is what matters.',
  custom: 'Here is an original short story about {topic}.',
};

function localContentPlan(input, sources = []) {
  const lang = LOCAL_TEXT[input.language] || LOCAL_TEXT.en;
  const topic = cleanText(input.topic);
  const nicheHook = (NICHE_HOOKS[input.niche] || NICHE_HOOKS.custom).replace('{topic}', topic);
  const count = Math.min(config.ai.maxScenes, Math.max(4, Math.round(input.duration / 8)));
  const sourceLine = sources.length
    ? ' Source links are saved with this project so claims can be checked before publication.'
    : '';
  const scenes = Array.from({ length: count }, (_, index) => {
    const narration = index === 0
      ? `${nicheHook} ${lang.scene(topic, index, 6)}`
      : lang.scene(topic, index, 6);
    return {
      narration: `${narration}${index === count - 1 && !sourceLine ? '' : ''}`,
      visualPrompt: `Original ${input.style} illustration for a faceless short video about ${topic}. Scene ${index + 1}: ${['mysterious opening', 'timeline and clues', 'unexpected connection', 'dramatic turning point', 'wider context', 'clear conclusion'][index % 6]}. No real people, no logos, no copyrighted characters, no text.`,
      caption: truncate(narration, 120),
    };
  });
  const script = scenes.map((scene) => scene.narration).join('\n\n');
  const words = slugWords(topic, 3).map(sanitizeHashtag);
  const baseTags = [...lang.hashtags, ...words].map((w) => `#${sanitizeHashtag(w)}`);
  const title = truncate(lang.title(topic), 100);
  const description = truncate(`${lang.hook(topic)} ${lang.cta}${sourceLine}`, 700);
  const hashtags = [...new Set(baseTags)].slice(0, 12);
  return {
    title,
    hook: lang.hook(topic),
    script: `${script}${sourceLine ? `\n\nEditorial note: ${sourceLine.trim()}` : ''}`,
    scenes,
    captions: {
      youtube: { title, description: `${description}\n\n${hashtags.join(' ')}`, hashtags },
      instagram: { title, description: truncate(`${lang.hook(topic)} ${lang.cta}\n\n${hashtags.join(' ')}`, PLATFORMS.instagram.maxCaption), hashtags },
      facebook: { title, description: truncate(`${description}\n\n${hashtags.slice(0, 5).join(' ')}`, 1000), hashtags: hashtags.slice(0, 5) },
      x: { title, description: truncate(`${lang.hook(topic)} ${hashtags.slice(0, 2).join(' ')}`, PLATFORMS.x.maxCaption - 14), hashtags: hashtags.slice(0, 2) },
      sandbox: { title, description, hashtags },
    },
    safetyNotes: 'Local outline is original and intentionally avoids unverified factual claims. Review before publishing factual niches.',
  };
}

function contentPrompt(input, sources) {
  const sourceContext = sources.length
    ? `Research sources (use only as high-level context; do not copy text):\n${sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join('\n')}`
    : 'No external research sources were supplied. Do not invent specific citations, statistics, quotes, or claims.';
  const languages = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', zh: 'Mandarin Chinese' };
  return `Create a complete original short-form faceless video package in ${languages[input.language] || 'English'}.

Topic: ${input.topic}
Niche: ${input.niche}
Tone: ${input.tone}
Visual style: ${input.style}
Target duration: ${input.duration} seconds
Scene count: ${Math.min(config.ai.maxScenes, Math.max(4, Math.round(input.duration / 8)))}
${sourceContext}

Rules:
- Write entirely original narration. No copyrighted lyrics, long quotations, or near-copying from sources.
- Respect platform community guidelines; avoid graphic detail, defamation, hate, harassment, misinformation, and unverified allegations.
- For true crime, news, and history, use careful attribution and avoid presenting disputed facts as certain.
- Create platform-specific title/description/hashtags for youtube, instagram, facebook, x, and sandbox.
- X description must fit 280 characters including hashtags. Instagram captions must fit 2200 characters.
- Visual prompts must request original imagery with no text, logos, real-person likenesses, or copyrighted characters.

Return ONLY valid JSON with this exact shape:
{
  "title": string,
  "hook": string,
  "script": string,
  "scenes": [{ "narration": string, "visualPrompt": string, "caption": string }],
  "captions": { "youtube": {"title":string,"description":string,"hashtags":string[]}, "instagram": {...}, "facebook": {...}, "x": {...}, "sandbox": {...} },
  "safetyNotes": string
}`;
}

async function llmContentPlan(input, sources) {
  const text = await callLLM(contentPrompt(input, sources), {
    system: 'You are an award-winning documentary scriptwriter, social media strategist, and responsible AI content editor. Always return strict valid JSON.',
    temperature: 0.82,
    maxTokens: 5000,
  });
  const parsed = planSchema.parse(extractJson(text));
  return parsed;
}

function ensureCaptions(plan, input, fallback) {
  const result = {};
  const tags = fallback.captions.sandbox.hashtags;
  for (const platform of Object.keys(PLATFORMS)) {
    const fromPlan = plan.captions?.[platform] || {};
    const base = fallback.captions[platform] || fallback.captions.sandbox;
    const max = PLATFORMS[platform].maxCaption;
    const hashtags = Array.isArray(fromPlan.hashtags) && fromPlan.hashtags.length ? fromPlan.hashtags : base.hashtags;
    const description = truncate(fromPlan.description || base.description, max - 14);
    result[platform] = {
      title: truncate(fromPlan.title || base.title, platform === 'youtube' ? 100 : 160),
      description,
      hashtags: hashtags.slice(0, platform === 'x' ? 2 : 10).map((tag) => `#${sanitizeHashtag(String(tag).replace(/^#/, ''))}`),
    };
    if (platform === 'x') result[platform].description = truncate(`${description} ${result[platform].hashtags.join(' ')}`, max - 14);
  }
  return result;
}

export async function generateContentPlan(input, research = { provider: 'none', sources: [] }) {
  const normalizedInput = {
    ...input,
    topic: cleanText(input.topic),
    duration: Number(input.duration) || 45,
    niche: cleanText(input.niche || 'education'),
    style: input.style || 'cinematic',
    language: input.language || 'en',
    tone: input.tone || 'documentary',
  };
  const fallback = localContentPlan(normalizedInput, research.sources);
  const provider = config.ai.provider;
  let plan;
  let aiGenerated = false;
  if (provider === 'local') {
    plan = fallback;
  } else {
    try {
      plan = await llmContentPlan(normalizedInput, research.sources);
      aiGenerated = true;
    } catch (error) {
      logger.error({ error: error.message, provider }, 'AI script provider failed');
      const wrapped = new Error(`AI script provider (${provider}) failed: ${error.message}`);
      wrapped.status = error.status || 502;
      wrapped.code = 'ai_provider_error';
      throw wrapped;
    }
  }
  const validated = planSchema.parse(plan);
  const captions = ensureCaptions(validated, normalizedInput, fallback);
  const script = validated.scenes.map((scene) => scene.narration).join('\n\n') || validated.script;
  return {
    title: truncate(validated.title, 180),
    hook: truncate(validated.hook, 400),
    script,
    scenes: validated.scenes.map((scene, index) => ({
      index: index + 1,
      narration: cleanText(scene.narration),
      visualPrompt: cleanText(scene.visualPrompt),
      caption: cleanText(scene.caption || scene.narration),
    })),
    captions,
    safetyNotes: validated.safetyNotes || fallback.safetyNotes,
    sources: research.sources || [],
    providerSummary: {
      scriptProvider: provider,
      aiGenerated,
      researchProvider: research.provider || 'none',
      sourceCount: research.sources?.length || 0,
      language: normalizedInput.language,
      model: provider === 'openai' ? config.ai.openaiModel : provider === 'anthropic' ? config.ai.anthropicModel : provider === 'gemini' ? config.ai.geminiModel : 'local-template',
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function generateAutopilotTopic(niche) {
  const base = cleanText(niche?.defaultTopic || niche?.description || niche?.name || 'a surprising historical mystery');
  const angles = ['the overlooked detail', 'the beginning nobody noticed', 'a surprising turning point', 'what happened next', 'the lesson we missed', 'the question still debated', 'the human story behind it'];
  if (config.ai.provider === 'local') {
    const angle = angles[Math.floor(Math.random() * angles.length)];
    return `${base}: ${angle}`;
  }
  try {
    const text = await callLLM(`Suggest one original, policy-safe short-video topic for the niche "${niche.name}". Avoid real-person allegations and copyrighted characters. Return JSON: {"topic":"..."}`, { maxTokens: 300, temperature: 1 });
    return cleanText(extractJson(text).topic || base).slice(0, 500);
  } catch (error) {
    logger.warn({ error: error.message }, 'Autopilot topic LLM failed; using local angle');
    return `${base}: ${angles[Math.floor(Math.random() * angles.length)]}`;
  }
}

export async function llmRecommendations(aggregate) {
  const text = await callLLM(`Analyze these aggregated content performance statistics and return JSON with a "recommendations" array. Each item needs title, body, category, confidence (0-1), and basis. Do not invent data. Keep each body under 300 characters.\n\n${JSON.stringify(aggregate, null, 2)}`, {
    system: 'You are a data-driven short-form video strategist. Use only the supplied statistics and label uncertainty when data is sparse.',
    temperature: 0.25,
    maxTokens: 2000,
  });
  const parsed = extractJson(text);
  if (!Array.isArray(parsed.recommendations)) throw new Error('AI recommendations response is missing recommendations array');
  return parsed.recommendations;
}
