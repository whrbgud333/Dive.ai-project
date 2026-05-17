import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { signInWithPopup, GoogleAuthProvider, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../firebase';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  tokenBalance: number;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  needsNickname: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setNickname: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchMe(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch('http://localhost:8000/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { id: d.id, name: d.name, email: d.email, tokenBalance: d.token_balance };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsNickname, setNeedsNickname] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('jwt_token');
    if (!token) { setLoading(false); return; }
    fetchMe(token).then(u => {
      if (u) setUser(u);
      else localStorage.removeItem('jwt_token');
      setLoading(false);
    });
  }, []);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    const idToken = await result.user.getIdToken();

    const res = await fetch('http://localhost:8000/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });
    if (!res.ok) throw new Error('로그인에 실패했습니다.');
    const data = await res.json();

    localStorage.setItem('jwt_token', data.access_token);
    setUser({
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      tokenBalance: data.user.token_balance,
    });
    if (data.is_new) setNeedsNickname(true);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    localStorage.removeItem('jwt_token');
    setUser(null);
    setNeedsNickname(false);
  };

  const refreshUser = async () => {
    const token = localStorage.getItem('jwt_token');
    if (!token) return;
    const u = await fetchMe(token);
    if (u) setUser(u);
  };

  const setNickname = async (name: string) => {
    const token = localStorage.getItem('jwt_token');
    if (!token) return;
    const res = await fetch('http://localhost:8000/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('닉네임 저장 실패');
    const updated = await res.json();
    setUser(prev => prev ? { ...prev, name: updated.name } : prev);
    setNeedsNickname(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, needsNickname, signInWithGoogle, signOut, refreshUser, setNickname }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
