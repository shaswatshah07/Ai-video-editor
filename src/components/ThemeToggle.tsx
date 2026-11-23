import React, { useState, useEffect, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';

const THEME_STORAGE_KEY = 'fastcutz_theme';

export type ThemeMode = 'light' | 'dark';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    // Fail-safe
  }
  return 'light'; // Default is ALWAYS 'light' (Warm Light Studio)
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  try {
    const isDark = theme === 'dark';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    window.dispatchEvent(new CustomEvent('fastcutz-theme-change', { detail: { theme } }));
  } catch {
    // Fail-safe
  }
}

// Immediate module-level initialization to prevent flash on refresh
if (typeof window !== 'undefined') {
  try {
    const saved = getInitialTheme();
    if (saved === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch {
    // Fail-safe
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    // Synchronize DOM class on mount
    const current = getInitialTheme();
    if (current === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    setTheme(current);

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: ThemeMode }>;
      if (customEvent.detail?.theme) {
        setTheme(customEvent.detail.theme);
      }
    };
    window.addEventListener('fastcutz-theme-change', handleThemeChange);
    return () => window.removeEventListener('fastcutz-theme-change', handleThemeChange);
  }, []);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, [theme]);

  return { theme, toggleTheme, isDark: theme === 'dark' };
}

export interface ThemeToggleProps {
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false }) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark theme"
      title={isDark ? 'Switch to Warm Light Studio' : 'Switch to Cinema Obsidian Dark Mode'}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-medium border transition-colors shadow-xs cursor-pointer min-h-[34px] select-none bg-white hover:bg-[#F0EEE9] border-[#E5E2DC] text-[#181715] dark:bg-[#1F1E1C] dark:hover:bg-[#2A2825] dark:border-[#33302C] dark:text-[#F4F2EC] shrink-0"
    >
      {isDark ? (
        <>
          <Sun className="w-3.5 h-3.5 text-[#F59E0B] fill-[#F59E0B]" />
          {!compact && <span className="hidden sm:inline text-[#F4F2EC]">Light</span>}
        </>
      ) : (
        <>
          <Moon className="w-3.5 h-3.5 text-[#66625B]" />
          {!compact && <span className="hidden sm:inline text-[#181715]">Dark</span>}
        </>
      )}
    </button>
  );
};
