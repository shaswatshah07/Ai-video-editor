import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read strictly from Vite environment variables (zero hardcoded secrets)
const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
const supabaseUrl: string | undefined = meta.env?.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey: string | undefined = meta.env?.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  if (!cachedClient) {
    try {
      cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    } catch (err) {
      console.warn('[Fastcutz Supabase] Failed to initialize client:', err);
      cachedClient = null;
    }
  }
  return cachedClient;
}

export function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop';
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export interface UserProfile {
  name: string;
  email: string;
  isGuest: boolean;
}

const PROFILE_STORAGE_KEY = 'fastcutz_user_profile';

export function getSavedUserProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (parsed && typeof parsed.name === 'string' && typeof parsed.email === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveUserProfile(profile: UserProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn('[Fastcutz] Failed to save user profile to localStorage:', err);
  }
}

export function clearUserProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch (err) {
    console.warn('[Fastcutz] Failed to clear user profile from localStorage:', err);
  }
}

export interface OperationResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Registers a user profile in Supabase `users` table.
 * Uses insert-only RLS compatibility (no .select()).
 */
export async function registerUser(name: string, email: string): Promise<OperationResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, skipped: true };
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();

  try {
    const { error } = await client.from('users').insert([
      {
        name: trimmedName,
        email: trimmedEmail,
        device_type: getDeviceType(),
      },
    ]);

    if (error) {
      console.warn('[Fastcutz Supabase] users insert notice:', error.message);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    console.warn('[Fastcutz Supabase] registerUser error:', err);
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Logs an export event in Supabase `export_events` table.
 * Uses insert-only RLS compatibility (no .select()).
 */
export async function logExportEvent(params: {
  durationSec: number;
  cutsCount: number;
  memesCount: number;
}): Promise<OperationResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, skipped: true };
  }

  const profile = getSavedUserProfile();
  const user_email = profile && !profile.isGuest && profile.email ? profile.email : 'guest';

  try {
    const { error } = await client.from('export_events').insert([
      {
        user_email,
        duration_sec: Number(params.durationSec.toFixed(2)),
        cuts_count: Math.max(0, Math.round(params.cutsCount)),
        memes_count: Math.max(0, Math.round(params.memesCount)),
        device_type: getDeviceType(),
      },
    ]);

    if (error) {
      console.warn('[Fastcutz Supabase] export_events insert notice:', error.message);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    console.warn('[Fastcutz Supabase] logExportEvent error:', err);
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Submits feedback into Supabase `user_feedback` table.
 * Uses insert-only RLS compatibility (no .select()).
 */
export async function submitUserFeedback(params: {
  rating: number;
  comment: string;
  emailOverride?: string;
}): Promise<OperationResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, skipped: true };
  }

  const savedProfile = getSavedUserProfile();
  const user_email =
    params.emailOverride?.trim().toLowerCase() ||
    (savedProfile && !savedProfile.isGuest ? savedProfile.email : 'guest');

  try {
    const { error } = await client.from('user_feedback').insert([
      {
        user_email,
        rating: Math.min(5, Math.max(1, Math.round(params.rating))),
        comment: params.comment.trim(),
        device_type: getDeviceType(),
      },
    ]);

    if (error) {
      console.warn('[Fastcutz Supabase] user_feedback insert notice:', error.message);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    console.warn('[Fastcutz Supabase] submitUserFeedback error:', err);
    return { ok: false, error: (err as Error).message };
  }
}
