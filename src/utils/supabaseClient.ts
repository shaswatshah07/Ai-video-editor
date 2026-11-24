/// <reference types="vite/client" />
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read strictly from Vite environment variables (zero hardcoded secrets)
// Direct property access is required for Vite AST build-time replacement
const supabaseUrl: string = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey: string = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

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
      console.error('[Fastcutz Supabase] Failed to initialize client:', err);
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

/**
 * Returns the canonical email for the current guest visitor.
 */
export function getGuestEmail(): string {
  const visitorId = getOrCreateGuestVisitorId();
  return `${visitorId}@guest.fastcutz.ai`;
}

let pendingRegistration: Promise<boolean> | null = null;

/**
 * Deduplicated silent guest registration in Supabase `users` table.
 * 100% compatible with INSERT-only `anon` RLS policies (no .select()).
 * Tracks registration via localStorage and cookie flags.
 */
export async function ensureGuestUserRegistered(): Promise<boolean> {
  if (pendingRegistration) {
    return pendingRegistration;
  }

  pendingRegistration = (async () => {
    try {
      const visitorId = getOrCreateGuestVisitorId();
      const isRegisteredInStorage =
        typeof localStorage !== 'undefined' &&
        localStorage.getItem('fastcutz_user_registered_uid') === visitorId;
      const isRegisteredInCookie = getCookie('fastcutz_uid_synced') === visitorId;

      if (isRegisteredInStorage || isRegisteredInCookie) {
        if (!isRegisteredInStorage && typeof localStorage !== 'undefined') {
          localStorage.setItem('fastcutz_user_registered_uid', visitorId);
        }
        if (!isRegisteredInCookie) {
          setCookie('fastcutz_uid_synced', visitorId, 2592000);
        }
        return true;
      }

      const client = getSupabaseClient();
      if (!client) {
        return false;
      }

      const guestEmail = getGuestEmail();

      // INSERT-only RLS safe: plain insert sends PostgREST 'Prefer: return=minimal'
      // Strictly avoid .select() and .upsert() which require SELECT permission
      const { error } = await client.from('users').insert([
        {
          name: 'Guest Creator',
          email: guestEmail,
          device_type: getDeviceType(),
        },
      ]);

      // If insert succeeded or if already registered (23505 unique constraint violation on email)
      if (!error || error.code === '23505') {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('fastcutz_user_registered_uid', visitorId);
        }
        setCookie('fastcutz_uid_synced', visitorId, 2592000);
        return true;
      }

      console.error('[Fastcutz Supabase] users insert failed:', error);
      return false;
    } catch (err) {
      console.error('[Fastcutz Supabase] ensureGuestUserRegistered error:', err);
      return false;
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
      if (error.code === '23505') {
        return { ok: true };
      }
      console.error('[Fastcutz Supabase] users insert failed:', error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    console.error('[Fastcutz Supabase] registerUser error:', err);
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
  const visitorEmail = getGuestEmail();
  const user_email =
    profile && !profile.isGuest && profile.email && profile.email.includes('@')
      ? profile.email.trim().toLowerCase()
      : visitorEmail;

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
      console.error('[Fastcutz Supabase] export_events insert failed:', error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    console.error('[Fastcutz Supabase] logExportEvent error:', err);
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
    return { ok: false, skipped: true, error: 'Database is not configured' };
  }

  // Ensure guest user is registered so feedback attaches to a valid user
  await ensureGuestUserRegistered();

  const savedProfile = getSavedUserProfile();
  const visitorEmail = getGuestEmail();
  const user_email =
    params.emailOverride?.trim().toLowerCase() ||
    (savedProfile && !savedProfile.isGuest && savedProfile.email && savedProfile.email.includes('@')
      ? savedProfile.email.trim().toLowerCase()
      : visitorEmail);

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
      console.error('[Fastcutz Supabase] user_feedback insert failed:', error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    console.error('[Fastcutz Supabase] submitUserFeedback error:', err);
    return { ok: false, error: (err as Error).message };
  }
}
