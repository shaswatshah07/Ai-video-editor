/**
 * Re-exports real meme items from memeLibrary.ts for backward compatibility.
 */
import { MEME_LIBRARY, getMemeById, getOrLoadMemeDuration } from './memeLibrary';

export type MemeId =
  | 'damnnnnnnnnnnn'
  | 'mission_passed'
  | 'ohhhhhhhhhhhhh_penguinz0'
  | 'pointing_finger'
  | 'pow_ohhhhhhhhhhhhhhhhh'
  | 'ten_hours_later'
  | 'the_rock_eyebrow_raise'
  | 'wait_who_are_you'
  | 'yeah_boy'
  | 'you_serious_spiderman'
  // Legacy
  | 'fail_trombone'
  | 'wait_what'
  | 'victory_cheer'
  | 'shocked_blink';

export interface MemePreset {
  id: string;
  name: string;
  durationMs: number;
  emoji: string;
  themeColor: string;
  blobUrl?: string;
  url: string;
}

export const MEME_PRESETS: Record<string, MemePreset> = {};

for (const m of MEME_LIBRARY) {
  MEME_PRESETS[m.id] = {
    id: m.id,
    name: m.title,
    durationMs: m.durationMs,
    emoji: m.emoji || '🎬',
    themeColor: '#8B5CF6',
    url: m.url
  };
}

// Add legacy fallbacks
const legacyMappings: Record<string, string> = {
  fail_trombone: 'damnnnnnnnnnnn',
  wait_what: 'the_rock_eyebrow_raise',
  victory_cheer: 'mission_passed',
  shocked_blink: 'wait_who_are_you'
};

for (const [legacyId, targetId] of Object.entries(legacyMappings)) {
  const target = MEME_PRESETS[targetId];
  if (target) {
    MEME_PRESETS[legacyId] = {
      ...target,
      id: legacyId
    };
  }
}

export async function getOrGenerateMemeBlob(memeId: string): Promise<string> {
  const meme = getMemeById(memeId) || MEME_LIBRARY[0];
  return meme.url;
}

export { MEME_LIBRARY, getMemeById, getOrLoadMemeDuration };
