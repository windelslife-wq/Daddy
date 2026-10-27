export const NICHES = [
  { id: 'horror', name: 'Horror & scary stories', icon: 'ghost', description: 'Original suspense, eerie legends, and psychological horror.' },
  { id: 'true-crime', name: 'True crime & real-life stories', icon: 'search', description: 'Carefully worded case narratives and real-life mysteries.' },
  { id: 'history', name: 'History & historical events', icon: 'landmark', description: 'Short documentaries about people, places, and turning points.' },
  { id: 'motivation', name: 'Motivation & inspiration', icon: 'sparkles', description: 'Inspiring lessons and practical mindset stories.' },
  { id: 'education', name: 'Education & interesting facts', icon: 'graduation', description: 'Explainer videos, science, and surprising facts.' },
  { id: 'business', name: 'Business & finance', icon: 'trending', description: 'Business lessons, markets, and entrepreneurship stories.' },
  { id: 'entertainment', name: 'Entertainment & storytelling', icon: 'clapperboard', description: 'Original short stories and pop-culture commentary.' },
  { id: 'religion', name: 'Religion & inspirational messages', icon: 'sun', description: 'Reflective, respectful messages and parables.' },
  { id: 'news', name: 'News & trending topics', icon: 'newspaper', description: 'Timely commentary with source-aware research.' },
  { id: 'custom', name: 'Custom niche', icon: 'wand', description: 'Create in any niche you can describe.' },
];

export const STYLES = [
  { id: 'comic', name: 'Comic book', description: 'Bold ink, panels, and saturated colors.' },
  { id: 'creepy-comic', name: 'Creepy comic', description: 'Dark noir ink with unsettling red highlights.' },
  { id: 'modern-cartoon', name: 'Modern cartoon', description: 'Clean shapes and friendly character-inspired scenes.' },
  { id: 'cinematic', name: 'Cinematic realistic', description: 'Moody lighting, depth, and dramatic composition.' },
  { id: 'animated', name: 'Animated storytelling', description: 'Soft gradients and storybook motion-friendly layouts.' },
  { id: '3d', name: '3D animation', description: 'Glossy geometry, soft shadows, and dimensional scenes.' },
];

export const LANGUAGES = [
  { id: 'en', name: 'English', voice: 'en/en-us' },
  { id: 'es', name: 'Spanish', voice: 'es' },
  { id: 'fr', name: 'French', voice: 'fr' },
  { id: 'de', name: 'German', voice: 'de' },
  { id: 'pt', name: 'Portuguese', voice: 'pt' },
  { id: 'it', name: 'Italian', voice: 'it' },
  { id: 'nl', name: 'Dutch', voice: 'nl' },
  { id: 'pl', name: 'Polish', voice: 'pl' },
  { id: 'tr', name: 'Turkish', voice: 'tr' },
  { id: 'zh', name: 'Mandarin Chinese', voice: 'zh' },
];

export const VOICES = [
  { id: 'nova', name: 'Nova', description: 'Warm and clear', provider: 'OpenAI / local' },
  { id: 'alloy', name: 'Alloy', description: 'Balanced narrator', provider: 'OpenAI / local' },
  { id: 'echo', name: 'Echo', description: 'Deep documentary', provider: 'OpenAI / local' },
  { id: 'fable', name: 'Fable', description: 'Expressive storyteller', provider: 'OpenAI / local' },
  { id: 'onyx', name: 'Onyx', description: 'Authoritative', provider: 'OpenAI / local' },
  { id: 'shimmer', name: 'Shimmer', description: 'Bright and energetic', provider: 'OpenAI / local' },
  { id: 'sage', name: 'Sage', description: 'Calm and reflective', provider: 'local' },
  { id: 'eleven-default', name: 'ElevenLabs default', description: 'Natural multilingual voice', provider: 'ElevenLabs' },
];

export const ASPECTS = [
  { id: '9:16', name: 'Vertical 9:16', width: 1080, height: 1920, platforms: ['instagram', 'facebook', 'sandbox'] },
  { id: '1:1', name: 'Square 1:1', width: 1080, height: 1080, platforms: ['facebook', 'x', 'sandbox'] },
  { id: '16:9', name: 'Horizontal 16:9', width: 1920, height: 1080, platforms: ['youtube', 'x', 'facebook', 'sandbox'] },
];

export const PLATFORMS = {
  sandbox: {
    name: 'Sandbox', maxDuration: 180, maxCaption: 5000, aspect: null, official: false,
    requirements: 'Local HTTP test endpoint. No external social posts are made.',
  },
  facebook: {
    name: 'Facebook Pages', maxDuration: 120, maxCaption: 5000, aspect: '16:9', official: true,
    requirements: 'A Facebook Page, pages_manage_posts and pages_read_engagement permissions, and Meta app review.',
  },
  instagram: {
    name: 'Instagram Business', maxDuration: 90, maxCaption: 2200, aspect: '9:16', official: true,
    requirements: 'An Instagram Business/Creator account linked to a Facebook Page and a publicly accessible HTTPS media URL.',
  },
  youtube: {
    name: 'YouTube', maxDuration: 180, maxCaption: 5000, aspect: '16:9', official: true,
    requirements: 'Google OAuth with youtube.upload and youtube.force-ssl scopes; videos start as private by default if configured.',
  },
  x: {
    name: 'X', maxDuration: 140, maxCaption: 280, aspect: '16:9', official: true,
    requirements: 'X API access with read/write permissions and media upload access.',
  },
};

export const VOICE_PRESETS = {
  nova: { pitch: 58, speed: 150, amplitude: 95, variant: 'en/en-us' },
  alloy: { pitch: 50, speed: 155, amplitude: 100, variant: 'en/en' },
  echo: { pitch: 36, speed: 145, amplitude: 100, variant: 'en/en-rp' },
  fable: { pitch: 62, speed: 165, amplitude: 100, variant: 'en/en-sc' },
  onyx: { pitch: 32, speed: 140, amplitude: 105, variant: 'en/en-n' },
  shimmer: { pitch: 68, speed: 168, amplitude: 95, variant: 'en/en-wm' },
  sage: { pitch: 45, speed: 135, amplitude: 90, variant: 'en/en' },
  'eleven-default': { pitch: 50, speed: 150, amplitude: 100, variant: 'en/en-us' },
};

export const STYLE_PALETTES = {
  comic: ['#ffcf3f', '#ff4d6d', '#3a86ff', '#11182f'],
  'creepy-comic': ['#b5121b', '#24111c', '#f4d6a0', '#07070b'],
  'modern-cartoon': ['#5ce1e6', '#ffbd59', '#a78bfa', '#10243e'],
  cinematic: ['#172554', '#6d28d9', '#f59e0b', '#050816'],
  animated: ['#38bdf8', '#c084fc', '#f9a8d4', '#0f172a'],
  '3d': ['#22d3ee', '#818cf8', '#f472b6', '#111827'],
};
