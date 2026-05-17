import React, { useEffect, useState, useMemo } from 'react';
import { BookOpen, Play, User, Tag, Loader2, RefreshCw, X, ChevronLeft, ChevronRight, ArrowLeft, UserPlus, UserCheck, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface PublishedScenario {
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
  author_name: string;
  author_user_id: number | null;
  is_following?: boolean;
  story_length?: string | null;
}

interface Props {
  onStartChat: (topicId: number) => void;
  onViewAuthor?: (authorId: number) => void;
  initialScenarioId?: number;
  onModalOpened?: () => void;
}

interface LightboxImage {
  src: string;
  label: string;
  isCover: boolean;
  scenarioTitle: string;
  images: { src: string; label: string; isCover: boolean; scenarioTitle: string }[];
  index: number;
}

const CONTENT_TYPE_COLOR: Record<string, string> = {
  만화: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  소설: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  시리즈: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  영화: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  고전: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

function timeAgo(dateStr: string): string {
  const normalized = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  const diff = Math.floor((Date.now() - new Date(normalized).getTime()) / 1000);
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

const CONTENT_TYPES = ['만화', '소설', '시리즈', '영화', '고전'] as const;

const GENRES: Record<string, string[]> = {
  만화:   ['드라마', '멜로·로맨스', '스릴러', '판타지', '액션', '미스터리', '코미디', 'SF', '전쟁', '공포(호러)'],
  시리즈: ['드라마', '멜로·로맨스', '스릴러', '판타지', '액션', '미스터리', '코미디', 'SF', '전쟁', '공포(호러)'],
  영화:   ['드라마', '멜로·로맨스', '스릴러', '판타지', '액션', '미스터리', '코미디', 'SF', '전쟁', '공포(호러)'],
  소설:   ['드라마', '멜로·로맨스', '스릴러', '판타지', '액션', '미스터리', '코미디', 'SF', '전쟁'],
};

const CLASSIC_COUNTRIES = ['한국', '중국', '일본'] as const;

const CLASSIC_GENRES: Record<string, string[]> = {
  한국: ['가문소설', '판타지', '로맨스', '영웅소설', '미스터리', '공포(호러)'],
  중국: ['무협', '로맨스', '공포(호러)', '판타지', '미스터리'],
  일본: ['설화', '미스터리', '공포(호러)'],
};

export default function ScenarioGallery({ onStartChat, onViewAuthor, initialScenarioId, onModalOpened }: Props) {
  const { user } = useAuth();
  const [scenarios, setScenarios] = useState<PublishedScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [importLengthModal, setImportLengthModal] = useState<{ scenario: PublishedScenario; navigate: boolean } | null>(null);
  const [pendingLength, setPendingLength] = useState<'short' | 'normal' | 'long'>('normal');
  const [toast, setToast] = useState('');
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [infoModal, setInfoModal] = useState<PublishedScenario | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterCountry, setFilterCountry] = useState<string | null>(null);
  const [filterGenre, setFilterGenre] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/scenarios/published');
      setScenarios(await res.json());
    } catch {
      showToast('목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!initialScenarioId || loading || scenarios.length === 0) return;
    const target = scenarios.find(s => s.id === initialScenarioId);
    if (target) {
      setInfoModal(target);
      onModalOpened?.();
    }
  }, [initialScenarioId, loading, scenarios]);

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

  const openLightbox = (s: PublishedScenario, startIndex: number) => {
    const images: { src: string; label: string; isCover: boolean; scenarioTitle: string }[] = [];
    if (s.cover_image) images.push({ src: s.cover_image, label: s.title, isCover: true, scenarioTitle: s.title });
    if (s.ai_character?.image) images.push({ src: s.ai_character.image, label: s.ai_character.name || 'AI 캐릭터', isCover: false, scenarioTitle: s.title });
    if (s.user_character?.image) images.push({ src: s.user_character.image, label: s.user_character.name || '내 캐릭터', isCover: false, scenarioTitle: s.title });
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

  const moveLightboxTo = (i: number) => {
    setLightbox(prev => prev ? { ...prev.images[i], images: prev.images, index: i } : null);
  };

  const handleFollow = async (authorId: number, isFollowing: boolean) => {
    if (!user) { showToast('로그인이 필요합니다.'); return; }
    try {
      await apiFetch(`/users/${authorId}/follow`, { method: isFollowing ? 'DELETE' : 'POST' });
      setScenarios(prev => prev.map(s =>
        s.author_user_id === authorId ? { ...s, is_following: !isFollowing } : s
      ));
      showToast(isFollowing ? '팔로우를 취소했습니다.' : '팔로우했습니다!');
    } catch {
      showToast('오류가 발생했습니다.');
    }
  };

  const openImportModal = (scenario: PublishedScenario, navigate: boolean) => {
    if (!user) { showToast('로그인이 필요합니다.'); return; }
    setPendingLength('normal');
    setImportLengthModal({ scenario, navigate });
  };

  const handleImport = async (scenario: PublishedScenario, navigate: boolean, storyLength: 'short' | 'normal' | 'long') => {
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

  const availableGenres = useMemo(() => {
    if (!filterType) return [];
    if (filterType === '고전') return filterCountry ? (CLASSIC_GENRES[filterCountry] ?? []) : [];
    return GENRES[filterType] ?? [];
  }, [filterType, filterCountry]);

  const filteredScenarios = useMemo(() => {
    let list = scenarios;
    if (filterType) list = list.filter(s => s.content_type === filterType);
    if (filterType === '고전' && filterCountry) list = list.filter(s => s.classic_country === filterCountry);
    if (filterGenre) list = list.filter(s => s.genre === filterGenre);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.author_name.toLowerCase().includes(q) ||
        (s.intro_display ?? '').toLowerCase().includes(q) ||
        (s.genre ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [scenarios, filterType, filterCountry, filterGenre, searchQuery]);

  const hasFilter = !!filterType || !!searchQuery.trim();

  const handleSetFilterType = (ct: string | null) => {
    setFilterType(ct);
    setFilterCountry(null);
    setFilterGenre(null);
  };

  const handleSetFilterCountry = (country: string | null) => {
    setFilterCountry(country);
    setFilterGenre(null);
  };

  const ScenarioCard = ({ s }: { s: PublishedScenario }) => {
    let imgIdx = 0;
    if (s.cover_image) imgIdx++;
    const aiImgIndex = s.ai_character?.image ? imgIdx++ : -1;
    const userImgIndex = s.user_character?.image ? imgIdx++ : -1;

    return (
      <div className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden hover:border-purple-500/40 hover:bg-white/6 transition-all">
        <div className="flex gap-0 h-44">
          {/* 표지 이미지 */}
          <div
            onClick={() => s.cover_image && openLightbox(s, 0)}
            className={`w-72 shrink-0 bg-slate-800 relative overflow-hidden ${s.cover_image ? 'cursor-pointer' : ''}`}
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
                <BookOpen size={24} className="text-white/20" />
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

            <div className="flex items-center gap-3 text-[11px] text-white/40">
              {s.content_type === '고전' && s.classic_country && s.genre ? (
                <span className="flex items-center gap-1"><Tag size={10} /> {s.classic_country} · {s.genre}</span>
              ) : s.content_type === '고전' && s.classic_country ? (
                <span className="flex items-center gap-1"><Tag size={10} /> {s.classic_country}</span>
              ) : s.genre ? (
                <span className="flex items-center gap-1"><Tag size={10} /> {s.genre}</span>
              ) : null}
              <button
                onClick={() => s.author_user_id && onViewAuthor?.(s.author_user_id)}
                className="flex items-center gap-1 hover:text-purple-300 transition-colors"
              >
                <User size={10} /> {s.author_name}
              </button>
              {s.author_user_id && user && s.author_user_id !== (user as any).id && (
                <button
                  onClick={() => handleFollow(s.author_user_id!, !!s.is_following)}
                  className={`flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border transition-all ${s.is_following ? 'text-violet-300 border-violet-500/30 bg-violet-500/10 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10' : 'text-white/40 border-white/15 hover:text-violet-300 hover:border-violet-500/30 hover:bg-violet-500/10'}`}
                >
                  {s.is_following ? <UserCheck size={9} /> : <UserPlus size={9} />}
                  {s.is_following ? '팔로잉' : '팔로우'}
                </button>
              )}
              {s.published_at && <span className="ml-auto">{timeAgo(s.published_at)}</span>}
            </div>

            {(s.ai_character?.name || s.user_character?.name) && (
              <div className="flex items-center gap-2">
                {s.ai_character?.image && (
                  <img src={s.ai_character.image} alt={s.ai_character.name} onClick={() => openLightbox(s, aiImgIndex)}
                    style={{ objectPosition: 'top' }}
                    className="w-7 h-7 rounded-full object-cover border border-white/20 cursor-pointer hover:border-purple-400 hover:scale-110 transition-all shrink-0" />
                )}
                {s.user_character?.image && (
                  <img src={s.user_character.image} alt={s.user_character.name} onClick={() => openLightbox(s, userImgIndex)}
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
                onClick={() => setInfoModal(s)}
                className="text-[11px] text-white/40 leading-relaxed cursor-pointer hover:text-white/60 transition-colors"
              >
                {s.intro_display.length > 130 ? s.intro_display.slice(0, 130) + '...' : s.intro_display}
              </p>
            )}

            <div className="mt-1 flex gap-2">
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
                title="바로 시작하기"
                className="px-3 py-2 bg-white/8 hover:bg-white/15 disabled:opacity-50 text-white/70 hover:text-white rounded-xl transition-all text-[10px] font-black shrink-0"
              >
                바로 시작하기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white">
      {/* 헤더 */}
      <div className="px-5 pt-6 pb-3 border-b border-white/8 space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-white tracking-tight">시나리오 갤러리</h1>
            <p className="text-xs text-white/40 mt-0.5">다른 작가의 시나리오로 새로운 이야기를 시작하세요</p>
          </div>
          <button onClick={load} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all">
            <RefreshCw size={15} />
          </button>
        </div>

        {/* 검색바 */}
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="제목, 작가명 등으로 검색해보세요"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-9 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-violet-500/40 focus:bg-white/8 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* 콘텐츠 타입 필터 칩 */}
        <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
          <button
            onClick={() => handleSetFilterType(null)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black border transition-all ${
              !filterType
                ? 'bg-violet-600 text-white border-violet-500'
                : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white/60'
            }`}
          >
            전체
          </button>
          {CONTENT_TYPES.map(ct => (
            <button
              key={ct}
              onClick={() => handleSetFilterType(filterType === ct ? null : ct)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black border transition-all ${
                filterType === ct
                  ? CONTENT_TYPE_COLOR[ct]
                  : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white/60'
              }`}
            >
              {ct}
            </button>
          ))}
        </div>

        {/* 고전 국가 칩 */}
        {filterType === '고전' && (
          <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide animate-in fade-in slide-in-from-top-1 duration-150">
            <span className="shrink-0 text-[10px] font-black text-white/25 self-center pr-1">국가</span>
            {CLASSIC_COUNTRIES.map(c => (
              <button
                key={c}
                onClick={() => handleSetFilterCountry(filterCountry === c ? null : c)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black border transition-all ${
                  filterCountry === c
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white/60'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* 장르 칩 */}
        {availableGenres.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide animate-in fade-in slide-in-from-top-1 duration-150">
            <span className="shrink-0 text-[10px] font-black text-white/25 self-center pr-1">장르</span>
            {availableGenres.map(g => (
              <button
                key={g}
                onClick={() => setFilterGenre(prev => prev === g ? null : g)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-black border transition-all ${
                  filterGenre === g
                    ? 'bg-white/15 text-white border-white/30'
                    : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white/60'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        )}

      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* 결과 수 & 필터 초기화 */}
        {!loading && scenarios.length > 0 && (
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/30 font-medium">
              {hasFilter ? `${filteredScenarios.length}개 검색됨` : `전체 ${scenarios.length}개`}
            </p>
            {hasFilter && (
              <button
                onClick={() => { setSearchQuery(''); handleSetFilterType(null); }}
                className="text-xs text-violet-400 hover:text-violet-300 font-bold transition-colors flex items-center gap-1"
              >
                <X size={11} /> 초기화
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-white/30">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-xs font-bold">불러오는 중...</p>
          </div>
        ) : scenarios.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-white/30">
            <BookOpen size={36} className="opacity-30" />
            <p className="text-sm font-bold">아직 게시된 시나리오가 없습니다.</p>
            <p className="text-xs text-white/20">내 채팅방에서 시나리오를 게시해보세요!</p>
          </div>
        ) : filteredScenarios.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Search size={32} className="text-white/15" />
            <p className="text-sm font-bold text-white/30">검색 결과가 없습니다.</p>
            <button
              onClick={() => { setSearchQuery(''); handleSetFilterType(null); }}
              className="text-xs text-violet-400 hover:text-violet-300 font-bold transition-colors"
            >
              필터 초기화
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredScenarios.map(s => <ScenarioCard key={s.id} s={s} />)}
          </div>
        )}
      </div>

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
            <div className="text-center">
              <p className="text-lg font-black text-white">{lightbox.label}</p>
              <p className="text-[10px] font-bold text-white/30 tracking-widest uppercase mt-1">
                {lightbox.isCover ? 'Dive.ai Original Series Cover' : lightbox.scenarioTitle}
              </p>
            </div>
            {lightbox.images.length > 1 && (
              <div className="flex gap-1.5">
                {lightbox.images.map((_, i) => (
                  <button key={i} onClick={() => moveLightboxTo(i)} className={`h-1.5 rounded-full transition-all ${i === lightbox.index ? 'bg-white w-4' : 'bg-white/30 w-1.5'}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
              <span className="text-[11px] text-white/30">by {infoModal.author_name}</span>
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
