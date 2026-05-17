import React, { useEffect, useState } from 'react';
import { ArrowLeft, UserPlus, UserCheck, BookOpen, Tag, Play, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface AuthorProfileData {
  author_id: number;
  author_name: string;
  follower_count: number;
  following_count: number;
  scenario_count: number;
  is_following: boolean;
  is_self: boolean;
}

interface AuthorScenario {
  id: number;
  title: string;
  genre: string | null;
  content_type: string | null;
  classic_country: string | null;
  cover_image: string | null;
  ai_character: any;
  user_character: any;
  intro_display: string | null;
  published_at: string | null;
}

interface LightboxImage {
  src: string;
  label: string;
  images: { src: string; label: string }[];
  index: number;
}

interface Props {
  authorId: number;
  onBack: () => void;
  onStartChat: (topicId: number) => void;
}

const CONTENT_TYPE_COLOR: Record<string, string> = {
  만화: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  소설: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  시리즈: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  영화: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  고전: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

export default function AuthorProfile({ authorId, onBack, onStartChat }: Props) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<AuthorProfileData | null>(null);
  const [scenarios, setScenarios] = useState<AuthorScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [importLengthModal, setImportLengthModal] = useState<{ scenario: AuthorScenario; navigate: boolean } | null>(null);
  const [pendingLength, setPendingLength] = useState<'short' | 'normal' | 'long'>('normal');
  const [infoModal, setInfoModal] = useState<AuthorScenario | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [profileRes, scenariosRes] = await Promise.all([
          apiFetch(`/users/${authorId}/profile`),
          apiFetch(`/users/${authorId}/scenarios`),
        ]);
        setProfile(await profileRes.json());
        setScenarios(await scenariosRes.json());
      } catch {
        showToast('프로필을 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [authorId]);

  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') moveLightbox(1);
      if (e.key === 'ArrowLeft') moveLightbox(-1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox]);

  const openLightbox = (s: AuthorScenario, startIndex: number) => {
    const images: { src: string; label: string }[] = [];
    if (s.cover_image) images.push({ src: s.cover_image, label: s.title });
    if (s.ai_character?.image) images.push({ src: s.ai_character.image, label: s.ai_character.name || 'AI 캐릭터' });
    if (s.user_character?.image) images.push({ src: s.user_character.image, label: s.user_character.name || '내 캐릭터' });
    if (images.length === 0) return;
    const idx = Math.min(startIndex, images.length - 1);
    setLightbox({ ...images[idx], images, index: idx });
  };

  const moveLightbox = (dir: number) => {
    setLightbox(prev => {
      if (!prev) return null;
      const next = (prev.index + dir + prev.images.length) % prev.images.length;
      return { ...prev.images[next], images: prev.images, index: next };
    });
  };

  const handleFollow = async () => {
    if (!user) { showToast('로그인이 필요합니다.'); return; }
    if (!profile) return;
    setFollowLoading(true);
    try {
      await apiFetch(`/users/${authorId}/follow`, {
        method: profile.is_following ? 'DELETE' : 'POST',
      });
      setProfile(prev => prev ? {
        ...prev,
        is_following: !prev.is_following,
        follower_count: prev.is_following ? prev.follower_count - 1 : prev.follower_count + 1,
      } : null);
      showToast(profile.is_following ? '팔로우를 취소했습니다.' : '팔로우했습니다!');
    } catch {
      showToast('오류가 발생했습니다.');
    } finally {
      setFollowLoading(false);
    }
  };

  const openImportModal = (scenario: AuthorScenario, navigate: boolean) => {
    if (!user) { showToast('로그인이 필요합니다.'); return; }
    setPendingLength('normal');
    setImportLengthModal({ scenario, navigate });
  };

  const handleImport = async (scenario: AuthorScenario, navigate: boolean, storyLength: 'short' | 'normal' | 'long') => {
    setImportingId(scenario.id);
    setImportLengthModal(null);
    try {
      const res = await apiFetch(`/scenarios/${scenario.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_length: storyLength }),
      });
      const data = await res.json();
      if (data.topic_id) {
        showToast(`"${data.title}" 시나리오가 추가되었습니다!`);
        if (navigate) setTimeout(() => onStartChat(data.topic_id), 800);
      }
    } catch {
      showToast('가져오기에 실패했습니다.');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 pt-6 pb-4 border-b border-white/8 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/8 transition-colors">
          <ArrowLeft size={20} className="text-white" />
        </button>
        <h1 className="text-lg font-black text-white tracking-tight">작가 프로필</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
          </div>
        ) : profile ? (
          <>
            {/* 프로필 헤더 */}
            <div className="px-5 py-8 flex flex-col items-center gap-5 border-b border-white/8">
              <div className="w-20 h-20 bg-gradient-to-br from-violet-500 to-purple-700 rounded-3xl flex items-center justify-center shadow-2xl shadow-violet-900/40">
                <span className="text-white font-black text-3xl">{profile.author_name.charAt(0).toUpperCase()}</span>
              </div>
              <h2 className="text-xl font-black text-white">{profile.author_name}</h2>
              <div className="flex items-center gap-8">
                <div className="text-center">
                  <p className="text-2xl font-black text-white">{profile.scenario_count}</p>
                  <p className="text-xs text-white/40 font-medium mt-0.5">시나리오</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div className="text-center">
                  <p className="text-2xl font-black text-white">{profile.follower_count}</p>
                  <p className="text-xs text-white/40 font-medium mt-0.5">팔로워</p>
                </div>
                <div className="w-px h-10 bg-white/10" />
                <div className="text-center">
                  <p className="text-2xl font-black text-white">{profile.following_count}</p>
                  <p className="text-xs text-white/40 font-medium mt-0.5">팔로잉</p>
                </div>
              </div>
              {!profile.is_self && user && (
                <button
                  onClick={handleFollow}
                  disabled={followLoading}
                  className={`flex items-center gap-2 px-7 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 active:scale-[0.97] ${
                    profile.is_following
                      ? 'bg-white/8 text-white/50 border border-white/12 hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/25'
                      : 'bg-violet-600 text-white hover:bg-violet-500 shadow-lg shadow-violet-900/30'
                  }`}
                >
                  {followLoading ? (
                    <div className="w-3.5 h-3.5 border border-current/30 border-t-current rounded-full animate-spin" />
                  ) : profile.is_following ? <UserCheck size={15} /> : <UserPlus size={15} />}
                  {profile.is_following ? '팔로잉' : '팔로우'}
                </button>
              )}
            </div>

            {/* 시나리오 목록 */}
            <div className="px-4 py-5 space-y-4">
              <p className="text-xs font-black text-white/30 uppercase tracking-widest px-1 mb-4">
                게시된 시나리오 {scenarios.length > 0 ? `· ${scenarios.length}개` : ''}
              </p>
              {scenarios.length === 0 ? (
                <div className="flex flex-col items-center py-14 gap-3">
                  <BookOpen size={32} className="text-white/12" />
                  <p className="text-sm text-white/25 font-medium">게시된 시나리오가 없습니다</p>
                </div>
              ) : (
                scenarios.map(s => {
                  let imgIdx = 0;
                  if (s.cover_image) imgIdx++;
                  const aiImgIndex = s.ai_character?.image ? imgIdx++ : -1;
                  const userImgIndex = s.user_character?.image ? imgIdx++ : -1;

                  return (
                    <div key={s.id} className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden hover:border-purple-500/40 hover:bg-white/6 transition-all">
                      <div className="flex gap-0 h-44">
                        {/* 표지 이미지 */}
                        <div
                          onClick={() => s.cover_image && openLightbox(s, 0)}
                          className={`w-32 shrink-0 bg-slate-800 relative overflow-hidden ${s.cover_image ? 'cursor-pointer' : ''}`}
                        >
                          {s.cover_image ? (
                            <>
                              <img src={s.cover_image} alt={s.title} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-all flex items-center justify-center">
                                <div className="opacity-0 hover:opacity-100 transition-all w-7 h-7 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-slate-800">
                              <BookOpen size={22} className="text-white/20" />
                            </div>
                          )}
                        </div>

                        {/* 정보 */}
                        <div className="flex-1 p-4 flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-black text-white text-sm leading-tight line-clamp-2">{s.title}</h3>
                            <div className="flex gap-1.5 shrink-0">
                              {s.content_type && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CONTENT_TYPE_COLOR[s.content_type] ?? 'bg-white/10 text-white/50 border-white/10'}`}>
                                  {s.content_type}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-white/40">
                            {s.content_type === '고전' && s.classic_country && s.genre ? (
                              <span className="flex items-center gap-1"><Tag size={10} /> {s.classic_country} · {s.genre}</span>
                            ) : s.content_type === '고전' && s.classic_country ? (
                              <span className="flex items-center gap-1"><Tag size={10} /> {s.classic_country}</span>
                            ) : s.genre ? (
                              <span className="flex items-center gap-1"><Tag size={10} /> {s.genre}</span>
                            ) : null}
                          </div>

                          {(s.ai_character?.name || s.user_character?.name) && (
                            <div className="flex items-center gap-2">
                              {s.ai_character?.image && (
                                <img src={s.ai_character.image} alt={s.ai_character.name}
                                  onClick={() => openLightbox(s, aiImgIndex)}
                                  style={{ objectPosition: 'top' }}
                                  className="w-7 h-7 rounded-full object-cover border border-white/20 cursor-pointer hover:border-purple-400 hover:scale-110 transition-all shrink-0" />
                              )}
                              {s.user_character?.image && (
                                <img src={s.user_character.image} alt={s.user_character.name}
                                  onClick={() => openLightbox(s, userImgIndex)}
                                  style={{ objectPosition: 'top' }}
                                  className="w-7 h-7 rounded-full object-cover border border-white/20 cursor-pointer hover:border-pink-400 hover:scale-110 transition-all shrink-0" />
                              )}
                              <p className="text-[11px] text-white/50 truncate">
                                {s.ai_character?.name && <span>AI 캐릭터: <span className="text-purple-300 font-bold">{s.ai_character.name}</span></span>}
                                {s.ai_character?.name && s.user_character?.name && <span className="mx-1">·</span>}
                                {s.user_character?.name && <span>나: <span className="text-pink-300 font-bold">{s.user_character.name}</span></span>}
                              </p>
                            </div>
                          )}

                          {s.intro_display && (
                            <p
                              className="text-[11px] text-white/40 leading-relaxed line-clamp-2 cursor-pointer hover:text-white/60 transition-colors"
                              onClick={() => setInfoModal(s)}
                            >
                              {s.intro_display}
                            </p>
                          )}

                          <div className="mt-auto flex gap-2">
                            <button
                              onClick={() => openImportModal(s, false)}
                              disabled={importingId === s.id}
                              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-xs py-2 rounded-xl transition-all"
                            >
                              {importingId === s.id
                                ? <><Loader2 size={13} className="animate-spin" /> 추가 중...</>
                                : <><Play size={13} /> 이 시나리오 담기</>
                              }
                            </button>
                            <button
                              onClick={() => openImportModal(s, true)}
                              disabled={importingId === s.id}
                              className="px-3 py-2 bg-white/8 hover:bg-white/15 disabled:opacity-50 text-white/70 hover:text-white rounded-xl transition-all text-[10px] font-black shrink-0"
                            >
                              바로 시작
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-48">
            <p className="text-white/25 text-sm font-medium">프로필을 불러오지 못했습니다.</p>
          </div>
        )}
      </div>

      {/* 시나리오 정보 모달 */}
      {infoModal && (
        <div className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-md flex items-center justify-center p-6" onClick={() => setInfoModal(null)}>
          <div className="bg-[#1a1a22] border border-white/10 rounded-3xl p-7 max-w-sm w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-black text-white leading-snug">{infoModal.title}</h3>
              <button onClick={() => setInfoModal(null)} className="shrink-0 p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all">
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {infoModal.content_type && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CONTENT_TYPE_COLOR[infoModal.content_type] ?? 'bg-white/10 text-white/50 border-white/10'}`}>
                  {infoModal.content_type}
                </span>
              )}
              {infoModal.content_type === '고전' && infoModal.classic_country && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-rose-500/10 text-rose-300 border-rose-500/20">
                  {infoModal.classic_country}
                </span>
              )}
              {infoModal.genre && <span className="text-[11px] text-white/40">{infoModal.genre}</span>}
              {profile && <span className="text-[11px] text-white/30">by {profile.author_name}</span>}
            </div>
            {(infoModal.ai_character?.name || infoModal.user_character?.name) && (
              <div className="flex items-center gap-2">
                {infoModal.ai_character?.image && (
                  <img src={infoModal.ai_character.image} alt={infoModal.ai_character.name} style={{ objectPosition: 'top' }} className="w-8 h-8 rounded-full object-cover border border-white/20 shrink-0" />
                )}
                {infoModal.user_character?.image && (
                  <img src={infoModal.user_character.image} alt={infoModal.user_character.name} style={{ objectPosition: 'top' }} className="w-8 h-8 rounded-full object-cover border border-white/20 shrink-0" />
                )}
                <p className="text-[11px] text-white/50">
                  {infoModal.ai_character?.name && <span>AI 캐릭터: <span className="text-purple-300 font-bold">{infoModal.ai_character.name}</span></span>}
                  {infoModal.ai_character?.name && infoModal.user_character?.name && <span className="mx-1">·</span>}
                  {infoModal.user_character?.name && <span>나: <span className="text-pink-300 font-bold">{infoModal.user_character.name}</span></span>}
                </p>
              </div>
            )}
            <p className="text-sm text-white/70 leading-relaxed">{infoModal.intro_display}</p>
            <button
              onClick={() => { setInfoModal(null); openImportModal(infoModal, true); }}
              disabled={importingId === infoModal.id}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-black text-sm py-3 rounded-2xl transition-all"
            >
              <Play size={14} /> 바로 시작하기
            </button>
          </div>
        </div>
      )}

      {/* 라이트박스 */}
      {lightbox && (
        <div className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} className="absolute top-5 right-5 p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all z-10">
            <X size={20} />
          </button>
          {lightbox.images.length > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); moveLightbox(-1); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all z-10"><ChevronLeft size={22} /></button>
              <button onClick={e => { e.stopPropagation(); moveLightbox(1); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all z-10"><ChevronRight size={22} /></button>
            </>
          )}
          <div className="flex flex-col items-center gap-5 w-full max-w-4xl" onClick={e => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.label} className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border border-white/10" />
            <p className="text-lg font-black text-white">{lightbox.label}</p>
            {lightbox.images.length > 1 && (
              <div className="flex gap-1.5">
                {lightbox.images.map((_, i) => (
                  <button key={i} onClick={() => setLightbox(prev => prev ? { ...prev.images[i], images: prev.images, index: i } : null)}
                    className={`h-1.5 rounded-full transition-all ${i === lightbox.index ? 'bg-white w-4' : 'bg-white/30 w-1.5'}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 스토리 길이 선택 모달 */}
      {importLengthModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[500] flex items-center justify-center p-6" onClick={() => setImportLengthModal(null)}>
          <div className="bg-[#1a1a22] border border-white/10 rounded-3xl p-7 max-w-sm w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-white">스토리 길이 선택</h3>
                <p className="text-[11px] text-white/40 mt-0.5 leading-relaxed">"{importLengthModal.scenario.title}"을 어떤 길이로 즐길까요?</p>
              </div>
              <button onClick={() => setImportLengthModal(null)} className="shrink-0 p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all">
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'short' as const, label: '단편', turns: '~20턴', desc: '빠른 전개', color: 'orange' },
                { value: 'normal' as const, label: '중편', turns: '~40턴', desc: '균형잡힌 전개', color: 'slate' },
                { value: 'long' as const, label: '장편', turns: '~80턴', desc: '깊은 몰입감', color: 'blue' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPendingLength(opt.value)}
                  className={`flex flex-col items-center gap-0.5 py-3 px-2 rounded-xl border transition-all ${
                    pendingLength === opt.value
                      ? opt.color === 'orange' ? 'bg-orange-500/15 border-orange-500/40 text-orange-300'
                        : opt.color === 'blue' ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                        : 'bg-white/10 border-white/30 text-white'
                      : 'bg-white/4 border-white/8 text-white/35 hover:bg-white/8 hover:text-white/55'
                  }`}
                >
                  <span className="text-xs font-black">{opt.label}</span>
                  <span className="text-[9px] font-bold opacity-70">{opt.turns}</span>
                  <span className="text-[9px] opacity-50">{opt.desc}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => handleImport(importLengthModal.scenario, importLengthModal.navigate, pendingLength)}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-black text-sm py-3 rounded-2xl transition-all"
            >
              <Play size={14} /> 시작하기
            </button>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-slate-800 border border-white/20 text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-xl z-50 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
