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

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, maxAgeSec = 2592000): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSec}; path=/; SameSite=Lax`;
}

/**
 * Returns or generates a persistent visitor identifier stored in both cookie and localStorage.
 */
export function getOrCreateGuestVisitorId(): string {
  if (typeof window === 'undefined') return 'fc_guest';
  try {
    const fromCookie = getCookie('fastcutz_uid');
    if (fromCookie && fromCookie.trim()) {
      localStorage.setItem('fastcutz_uid', fromCookie.trim());
      return fromCookie.trim();
    }

    const fromStorage = localStorage.getItem('fastcutz_uid');
    if (fromStorage && fromStorage.trim()) {
      setCookie('fastcutz_uid', fromStorage.trim(), 2592000);
      return fromStorage.trim();
    }

    let rawHex = '';
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      rawHex = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    } else {
      rawHex = Math.random().toString(36).substring(2, 14);
    }
    const newId = `fc_${rawHex}`;
    setCookie('fastcutz_uid', newId, 2592000);
    localStorage.setItem('fastcutz_uid', newId);
    return newId;
  } catch {
    return `fc_${Math.random().toString(36).substring(2, 14)}`;
  }
}

let pendingRegistration: Promise<string | null> | null = null;

/**
 * Deduplicated silent guest registration in Supabase `users` table.
 * Caches userId in localStorage & cookie so reloads never fire duplicate rows.
 */
export async function ensureGuestUserRegistered(): Promise<string | null> {
  if (pendingRegistration) {
    return pendingRegistration;
  }

  pendingRegistration = (async () => {
    try {
      const visitorId = getOrCreateGuestVisitorId();
      const cachedUserId = localStorage.getItem('fastcutz_sb_user_id') || getCookie('fastcutz_sb_uid');
      const cachedVisitorUid = localStorage.getItem('fastcutz_sb_user_uid');

      if (cachedUserId && cachedVisitorUid === visitorId) {
        return cachedUserId;
      }

      const client = getSupabaseClient();
      if (!client) {
        return cachedUserId || null;
      }

      const guestEmail = `${visitorId}@guest.fastcutz.ai`;

      // Insert guest row using exact users columns: name, email, device_type
      const { data, error } = await client
        .from('users')
        .insert([
          {
            name: 'Guest Creator',
            email: guestEmail,
            device_type: getDeviceType(),
          },
        ])
        .select('id')
        .single();

      if (!error && data?.id) {
        const idStr = String(data.id);
        localStorage.setItem('fastcutz_sb_user_id', idStr);
        localStorage.setItem('fastcutz_sb_user_uid', visitorId);
        setCookie('fastcutz_sb_uid', idStr, 2592000);
        return idStr;
      }

      // If duplicate-email / conflict occurred, safely fetch/reuse the existing row
      if (error) {
        const { data: existingUser } = await client
          .from('users')
          .select('id')
          .eq('email', guestEmail)
          .maybeSingle();

        if (existingUser?.id) {
          const idStr = String(existingUser.id);
          localStorage.setItem('fastcutz_sb_user_id', idStr);
          localStorage.setItem('fastcutz_sb_user_uid', visitorId);
          setCookie('fastcutz_sb_uid', idStr, 2592000);
          return idStr;
        }
      }

      return cachedUserId || null;
    } catch (err) {
      console.warn('[Fastcutz Supabase] ensureGuestUserRegistered notice:', err);
      return null;
    } finally {
      pendingRegistration = null;
    }
  })();

  return pendingRegistration;
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

  // Ensure guest user is registered so exports attach to a valid user
  await ensureGuestUserRegistered();

  const profile = getSavedUserProfile();
  const visitorId = getOrCreateGuestVisitorId();
  const user_email = profile && !profile.isGuest && profile.email ? profile.email : `${visitorId}@guest.fastcutz.ai`;

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

  // Ensure guest user is registered so feedback attaches to a valid user
  await ensureGuestUserRegistered();

  const savedProfile = getSavedUserProfile();
  const visitorId = getOrCreateGuestVisitorId();
  const user_email =
    params.emailOverride?.trim().toLowerCase() ||
    (savedProfile && !savedProfile.isGuest ? savedProfile.email : `${visitorId}@guest.fastcutz.ai`);

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
