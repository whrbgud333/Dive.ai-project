import React, { useState, useEffect } from 'react';
import { LogOut, ChevronRight, Coins, Calendar, User, Edit3, Check, X, Users, UserMinus, BookOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

interface FollowingAuthor {
  author_id: number;
  author_name: string;
  scenario_count: number;
  followed_at: string | null;
}

export default function Settings({
  user,
  onGoToAttendance,
  onViewAuthor,
}: {
  user?: { name: string; email: string; tokenBalance: number };
  onGoToAttendance: () => void;
  onViewAuthor?: (authorId: number) => void;
}) {
  const { user: authUser, signInWithGoogle, signOut, needsNickname, setNickname, refreshUser } = useAuth();
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [nickname, setNicknameInput] = useState('');
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameError, setNicknameError] = useState('');
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [followingList, setFollowingList] = useState<FollowingAuthor[]>([]);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [myFollowerCount, setMyFollowerCount] = useState<number | null>(null);

  const loadFollowing = async () => {
    setFollowingLoading(true);
    try {
      const res = await apiFetch('/users/following');
      setFollowingList(await res.json());
    } catch {}
    finally { setFollowingLoading(false); }
  };

  const handleUnfollow = async (authorId: number) => {
    try {
      await apiFetch(`/users/${authorId}/follow`, { method: 'DELETE' });
      setFollowingList(prev => prev.filter(f => f.author_id !== authorId));
      setMyFollowerCount(null);
    } catch {}
  };

  useEffect(() => {
    if (showFollowing && user) loadFollowing();
  }, [showFollowing]);

  useEffect(() => {
    if (!authUser?.id) return;
    apiFetch(`/users/${authUser.id}/profile`)
      .then(r => r.json())
      .then(d => setMyFollowerCount(d.follower_count ?? 0))
      .catch(() => {});
  }, [authUser?.id]);

  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError('');
    try {
      await signInWithGoogle();
    } catch {
      setLoginError('로그인에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleNickname = async () => {
    const nameToSave = nickname.trim();
    if (!nameToSave) { setNicknameError('닉네임을 입력해주세요.'); return; }
    if (nameToSave.length > 20) { setNicknameError('20자 이하로 입력해주세요.'); return; }
    setNicknameLoading(true);
    setNicknameError('');
    try {
      await setNickname(nameToSave);
      setIsEditingNickname(false);
      setNicknameInput('');
    } catch {
      setNicknameError('저장에 실패했습니다.');
    } finally {
      setNicknameLoading(false);
    }
  };

  // ── 비로그인 상태 ─────────────────────────────────────────────
  if (!user) {
    return (
      <div className="flex flex-col h-full bg-slate-950">
        <div className="px-5 pt-6 pb-4 border-b border-white/8">
          <h1 className="text-xl font-black text-white tracking-tight">마이</h1>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-8 pb-16 gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 bg-gradient-to-br from-violet-500 to-purple-700 rounded-3xl flex items-center justify-center shadow-2xl shadow-violet-900/40">
              <span className="text-white font-black text-3xl">D</span>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-black text-white mb-1">로그인이 필요합니다</h2>
              <p className="text-sm text-white/40 font-medium leading-relaxed">
                로그인하면 매일 출석 체크로<br />무료 토큰 5개를 받을 수 있어요
              </p>
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={loginLoading}
            className="w-full max-w-xs flex items-center justify-center gap-3 bg-white/5 border border-white/12 rounded-2xl px-6 py-4 hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {loginLoading ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-violet-400 rounded-full animate-spin" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#4285F4" d="M47.5 24.6c0-1.6-.1-3.1-.4-4.6H24v8.7h13.2c-.6 3-2.3 5.6-4.9 7.3v6h7.9c4.6-4.3 7.3-10.6 7.3-17.4z"/>
                <path fill="#34A853" d="M24 48c6.5 0 12-2.1 16-5.8l-7.9-6c-2.2 1.5-5 2.3-8.1 2.3-6.2 0-11.5-4.2-13.4-9.9H2.5v6.2C6.5 42.7 14.7 48 24 48z"/>
                <path fill="#FBBC05" d="M10.6 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6v-6.2H2.5C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.8l8.1-6.2z"/>
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.9 2.4 30.4 0 24 0 14.7 0 6.5 5.3 2.5 13.2l8.1 6.2C12.5 13.7 17.8 9.5 24 9.5z"/>
              </svg>
            )}
            <span className="text-sm font-black text-white">
              {loginLoading ? '로그인 중...' : 'Google로 계속하기'}
            </span>
          </button>

          {loginError && (
            <p className="text-xs text-red-400 font-medium text-center">{loginError}</p>
          )}
        </div>
      </div>
    );
  }

  // ── 닉네임 설정 상태 (첫 로그인) ─────────────────────────────
  if (needsNickname) {
    return (
      <div className="flex flex-col h-full bg-slate-950">
        <div className="px-5 pt-6 pb-4 border-b border-white/8">
          <h1 className="text-xl font-black text-white tracking-tight">마이</h1>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-8 pb-16 gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 bg-gradient-to-br from-violet-500 to-purple-700 rounded-3xl flex items-center justify-center shadow-2xl shadow-violet-900/40">
              <span className="text-white font-black text-3xl">D</span>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-black text-white mb-1">닉네임 설정</h2>
              <p className="text-sm text-white/40 font-medium">Dive.ai에서 사용할 이름을 정해주세요</p>
            </div>
          </div>

          <div className="w-full max-w-xs space-y-3">
            <input
              type="text"
              value={nickname}
              onChange={e => setNicknameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNickname()}
              placeholder="닉네임 입력"
              maxLength={20}
              className="w-full bg-white/5 border border-white/12 rounded-2xl px-4 py-3.5 text-sm font-bold text-white placeholder:text-white/25 outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/30 transition-all"
              autoFocus
            />
            {nicknameError && (
              <p className="text-xs text-red-400 font-medium text-center">{nicknameError}</p>
            )}
            <button
              onClick={handleNickname}
              disabled={nicknameLoading || !nickname.trim()}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white rounded-2xl py-3.5 font-black text-sm transition-all disabled:opacity-40 active:scale-[0.98]"
            >
              {nicknameLoading ? '저장 중...' : '시작하기'}
            </button>
            <p className="text-xs text-white/25 font-medium text-center">
              나중에 마이 페이지에서 변경할 수 있어요
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── 로그인 완료 상태 ──────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto">
      <div className="px-5 pt-6 pb-4 border-b border-white/8">
        <h1 className="text-xl font-black text-white tracking-tight">마이</h1>
      </div>

      <div className="px-4 py-5 space-y-3">

        {/* 프로필 카드 */}
        <div className="bg-white/4 border border-white/8 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-violet-500 to-purple-700 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-violet-900/30 shrink-0">
            {user.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-black text-white truncate">{user.name}</p>
            <p className="text-xs text-white/35 font-medium truncate">{user.email}</p>
            {myFollowerCount !== null && (
              <p className="text-[11px] text-white/30 font-medium mt-1 flex items-center gap-1">
                <Users size={10} />
                팔로워 {myFollowerCount}명
              </p>
            )}
          </div>
        </div>

        {/* 토큰 & 출석 카드 */}
        <div className="bg-gradient-to-br from-violet-600/90 to-purple-700/90 border border-violet-500/20 rounded-2xl p-5 shadow-xl shadow-violet-900/20">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/15 rounded-xl flex items-center justify-center">
                <Coins size={16} className="text-white" />
              </div>
              <span className="text-sm font-black text-white/70">보유 토큰</span>
            </div>
            <span className="text-2xl font-black text-white">{user.tokenBalance}<span className="text-base ml-1 font-bold text-white/60">개</span></span>
          </div>

          <button
            onClick={onGoToAttendance}
            className="w-full flex items-center gap-2 bg-white/15 hover:bg-white/25 border border-white/20 text-white rounded-xl py-3 px-4 text-sm font-black transition-all active:scale-[0.98]"
          >
            <Calendar size={15} className="shrink-0" />
            <span>출석체크 하고 보상 받기</span>
            <ChevronRight size={14} className="ml-auto shrink-0" />
          </button>
        </div>

        {/* 닉네임 변경 */}
        <div className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden">
          {isEditingNickname ? (

            <div className="p-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
              <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">닉네임 변경</p>
              <input
                type="text"
                value={nickname}
                onChange={e => setNicknameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleNickname()}
                placeholder="새 닉네임 입력"
                maxLength={20}
                className="w-full bg-white/5 border border-white/12 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-white/25 outline-none focus:ring-2 focus:ring-violet-500/50 transition-all"
                autoFocus
              />
              {nicknameError && (
                <p className="text-xs text-red-400 font-medium">{nicknameError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setIsEditingNickname(false); setNicknameError(''); setNicknameInput(''); }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/50 rounded-xl py-2.5 text-sm font-black transition-all"
                >
                  <X size={13} /> 취소
                </button>
                <button
                  onClick={handleNickname}
                  disabled={nicknameLoading || !nickname.trim()}
                  className="flex-[2] flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl py-2.5 text-sm font-black transition-all disabled:opacity-40"
                >
                  <Check size={13} /> {nicknameLoading ? '저장 중...' : '변경하기'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setIsEditingNickname(true); setNicknameInput(user.name); }}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/4 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/6 rounded-xl flex items-center justify-center">
                  <User size={14} className="text-white/50" />
                </div>
                <span className="text-sm font-bold text-white/70">닉네임 변경하기</span>
              </div>
              <Edit3 size={13} className="text-white/25" />
            </button>
          )}
        </div>

        {/* 팔로잉 */}
        <div className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowFollowing(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/4 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-white/6 rounded-xl flex items-center justify-center">
                <Users size={14} className="text-white/50" />
              </div>
              <span className="text-sm font-bold text-white/70">팔로잉 관리</span>
            </div>
            <ChevronRight size={13} className={`text-white/25 transition-transform duration-200 ${showFollowing ? 'rotate-90' : ''}`} />
          </button>

          {showFollowing && (
            <div className="border-t border-white/6 px-4 pb-4 pt-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
              {followingLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="w-5 h-5 border-2 border-white/10 border-t-violet-400 rounded-full animate-spin" />
                </div>
              ) : followingList.length === 0 ? (
                <div className="text-center py-6">
                  <Users size={28} className="text-white/10 mx-auto mb-2" />
                  <p className="text-xs text-white/30 font-medium">팔로잉 중인 작가가 없습니다</p>
                  <p className="text-[11px] text-white/20 mt-1">갤러리에서 마음에 드는 작가를 팔로우해보세요</p>
                </div>
              ) : (
                followingList.map(f => (
                  <div key={f.author_id} className="flex items-center justify-between bg-white/4 rounded-xl px-3 py-2.5">
                    <button
                      onClick={() => onViewAuthor?.(f.author_id)}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
                    >
                      <div className="w-8 h-8 bg-gradient-to-br from-violet-500/40 to-purple-600/40 rounded-xl flex items-center justify-center shrink-0">
                        <span className="text-xs font-black text-violet-300">{f.author_name[0]}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{f.author_name}</p>
                        <p className="text-[10px] text-white/30 flex items-center gap-1">
                          <BookOpen size={9} /> 시나리오 {f.scenario_count}개
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleUnfollow(f.author_id)}
                      className="shrink-0 flex items-center gap-1 text-[10px] font-black text-white/30 hover:text-red-400 hover:bg-red-500/10 px-2 py-1 rounded-lg transition-all"
                    >
                      <UserMinus size={11} /> 언팔로우
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 로그아웃 */}
        <button
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 bg-red-500/8 hover:bg-red-500/15 border border-red-500/15 text-red-400 rounded-2xl py-3.5 font-black text-sm transition-all active:scale-[0.98]"
        >
          <LogOut size={15} /> 로그아웃
        </button>

      </div>

    </div>
  );
}
