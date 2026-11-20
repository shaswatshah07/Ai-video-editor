/**
 * Real 480p Meme Reaction Library
 * Files are served directly from `/memes/<filename>` under public/memes/
 * Same-origin serving guarantees 100% offline reliability with zero CORS issues.
 */

export interface MemeLibraryItem {
  id: string;
  title: string;
  filename: string;
  url: string;
  durationMs: number;
  keywords: string[];
  emoji?: string;
}

export const MEME_LIBRARY: MemeLibraryItem[] = [
  {
    id: 'damnnnnnnnnnnn',
    title: 'Damn!',
    filename: 'damnnnnnnnnnnn.mp4',
    url: '/memes/damnnnnnnnnnnn.mp4',
    durationMs: 3692,
    emoji: '🔥',
    keywords: ['damn', 'damnn', 'damnnnnnnnnnnn', 'friday', 'friday damn', 'wow', 'disbelief', 'shock', 'fail']
  },
  {
    id: 'mission_passed',
    title: 'Mission Passed (GTA)',
    filename: 'mission pass .mp4',
    url: '/memes/mission%20pass%20.mp4',
    durationMs: 9311,
    emoji: '⭐',
    keywords: ['mission passed', 'mission pass', 'gta', 'respect', 'success', 'win', 'victory', 'passed', 'cheer']
  },
  {
    id: 'ohhhhhhhhhhhhh_penguinz0',
    title: 'Penguinz0 (Yeah Baby!)',
    filename: 'ohhhhhhhhhhhhh penguinz0.mp4',
    url: '/memes/ohhhhhhhhhhhhh%20penguinz0.mp4',
    durationMs: 7000,
    emoji: '🙌',
    keywords: ['penguinz0', 'moistcr1tikal', 'yeah baby', 'oh baby', 'celebrate', 'charlie', 'cheer', 'woo', 'victory']
  },
  {
    id: 'pointing_finger',
    title: 'Pointing Finger (DiCaprio)',
    filename: 'pointing finger.mp4',
    url: '/memes/pointing%20finger.mp4',
    durationMs: 4950,
    emoji: '👉',
    keywords: ['pointing finger', 'pointing', 'leonardo', 'dicaprio', 'once upon a time', 'rick dalton', 'look', 'there it is', 'spotted']
  },
  {
    id: 'pow_ohhhhhhhhhhhhhhhhh',
    title: 'Supa Hot Fire (Pow!)',
    filename: 'pow ohhhhhhhhhhhhhhhhh.mp4',
    url: '/memes/pow%20ohhhhhhhhhhhhhhhhh.mp4',
    durationMs: 3917,
    emoji: '💥',
    keywords: ['pow', 'pow oh', 'supa hot fire', 'rap battle', 'roasted', 'boom', 'destroyed', 'turn up', 'roast']
  },
  {
    id: 'ten_hours_later',
    title: '10 Hours Later (SpongeBob)',
    filename: 'Ten hours later.mp4',
    url: '/memes/Ten%20hours%20later.mp4',
    durationMs: 1602,
    emoji: '⏰',
    keywords: ['ten hours later', '10 hours later', 'hours later', 'spongebob', 'narrator', 'time card', 'waiting', 'slow', 'later']
  },
  {
    id: 'the_rock_eyebrow_raise',
    title: 'The Rock Eyebrow Raise',
    filename: 'the rock eyebrow raise.mp4',
    url: '/memes/the%20rock%20eyebrow%20raise.mp4',
    durationMs: 4640,
    emoji: '🤨',
    keywords: ['the rock eyebrow raise', 'the rock', 'eyebrow', 'dwayne johnson', 'sus', 'suspicious', 'vine boom', 'side eye', 'shock', 'wait what']
  },
  {
    id: 'wait_who_are_you',
    title: 'Wait, Who Are You?',
    filename: 'wait who are you.mp4',
    url: '/memes/wait%20who%20are%20you.mp4',
    durationMs: 5506,
    emoji: '❓',
    keywords: ['wait who are you', 'kazoo kid', 'who are you', 'wait what', 'confused', 'stranger', 'what', 'question']
  },
  {
    id: 'yeah_boy',
    title: 'Yeah Boy (Ainsley Harriott)',
    filename: 'yeah boy.mp4',
    url: '/memes/yeah%20boy.mp4',
    durationMs: 1021,
    emoji: '😏',
    keywords: ['yeah boy', 'yeah boi', 'ainsley harriott', 'ainsley', 'smile', 'spicy', 'nice', 'good', 'happy']
  },
  {
    id: 'you_serious_spiderman',
    title: 'Are You Serious? (J. Jonah)',
    filename: 'you serious spider-man.mp4',
    url: '/memes/you%20serious%20spider-man.mp4',
    durationMs: 10565,
    emoji: '🤣',
    keywords: ['you serious spider-man', 'are you serious', 'j jonah jameson', 'laughing', 'spider-man', 'spiderman', 'jk simmons', 'laugh', 'serious', 'joke']
  }
];

// In-memory cache for dynamically measured durations
const durationCache = new Map<string, number>();

/**
 * Reads and caches the exact duration of a meme clip via hidden video metadata
 */
export async function getOrLoadMemeDuration(item: MemeLibraryItem): Promise<number> {
  if (durationCache.has(item.id)) {
    return durationCache.get(item.id)!;
  }
  if (typeof document === 'undefined') return item.durationMs;

  return new Promise<number>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = item.url;
    video.onloadedmetadata = () => {
      const ms = Math.round((video.duration || (item.durationMs / 1000)) * 1000);
      durationCache.set(item.id, ms);
      resolve(ms);
    };
    video.onerror = () => {
      resolve(item.durationMs);
    };
  });
}

/**
 * Finds a meme by exact ID or legacy fallback ID
 */
export function getMemeById(id: string): MemeLibraryItem | undefined {
  const direct = MEME_LIBRARY.find((m) => m.id === id);
  if (direct) return direct;

  // Legacy mappings for backwards compatibility
  if (id === 'fail_trombone') return MEME_LIBRARY.find((m) => m.id === 'damnnnnnnnnnnn');
  if (id === 'wait_what') return MEME_LIBRARY.find((m) => m.id === 'the_rock_eyebrow_raise');
  if (id === 'victory_cheer') return MEME_LIBRARY.find((m) => m.id === 'mission_passed');
  if (id === 'shocked_blink') return MEME_LIBRARY.find((m) => m.id === 'wait_who_are_you');

  return undefined;
}

/**
 * Matches a query string to the best meme by title or keywords
 */
export function findMemeByKeyword(query: string): MemeLibraryItem | undefined {
  const lower = query.trim().toLowerCase();
  if (!lower) return undefined;

  // 1. Exact title or ID match
  const exact = MEME_LIBRARY.find(
    (m) => m.id.toLowerCase() === lower || m.title.toLowerCase() === lower
  );
  if (exact) return exact;

  // 2. Keyword match
  for (const meme of MEME_LIBRARY) {
    if (meme.keywords.some((kw) => lower.includes(kw) || kw.includes(lower))) {
      return meme;
    }
  }

  // 3. Substring of title match
  const sub = MEME_LIBRARY.find((m) => m.title.toLowerCase().includes(lower) || lower.includes(m.title.toLowerCase()));
  if (sub) return sub;

  return undefined;
}
