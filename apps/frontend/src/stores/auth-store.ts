import { create } from 'zustand';
import { getApiKey, setApiKeyCookie, clearApiKeyCookie } from '../lib/api';

interface AuthState {
  apiKey: string | null;
  isAuthenticated: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
  init: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  apiKey: null,
  isAuthenticated: false,
  setKey: (key: string) => {
    setApiKeyCookie(key);
    set({ apiKey: key, isAuthenticated: true });
  },
  clearKey: () => {
    clearApiKeyCookie();
    set({ apiKey: null, isAuthenticated: false });
  },
  init: () => {
    const key = getApiKey();
    if (key) {
      set({ apiKey: key, isAuthenticated: true });
    }
  },
}));
