import React, { useState, useRef, useLayoutEffect } from 'react';
import { Sparkles, ChevronLeft, User, Bot, Users, Edit3, Check, X, Maximize2, Info, RotateCcw, Trash2, ChevronLeft as ChevLeft, ChevronRight as ChevRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { FlowData, CharacterResult, SupportingCharacter } from '../types';

interface Props {
  flowData: FlowData;
  onUpdate: (data: Partial<FlowData>) => void;
  onNext: () => void;
  onBack: () => void;
  onHome: () => void;
}

interface ReadCharCardProps {
  badge: string;
  badgeColor: string;
  icon: React.ReactNode;
  char: CharacterResult;
  onZoom: (src: string, name: string) => void;
}

function ReadCharCard({ badge, badgeColor, icon, char, onZoom }: ReadCharCardProps) {
  const fields: { key: keyof CharacterResult; label: string }[] = [
    { key: 'role', label: '역할' },
    { key: 'gender', label: '성별' },
    { key: 'age', label: '나이' },
    { key: 'personality', label: '성격' },
    { key: 'appearance', label: '외형' },
    { key: 'background', label: '배경' },
  ];

  return (
    <div className="bg-white/5 border border-white/8 rounded-2xl p-5 space-y-5">
      {char.image && (
        <div
          onClick={() => onZoom(char.image!, char.name)}
          className="relative group/img aspect-square w-full overflow-hidden rounded-xl bg-white/5 border border-white/8 cursor-pointer"
        >
          <img
            src={char.image}
            alt={char.name}
            className="w-full h-full object-cover object-top transition-transform duration-700 group-hover/img:scale-105"
          />
          <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
            <Maximize2 size={28} className="text-white opacity-0 group-hover/img:opacity-100 transition-opacity" />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-xl ${badgeColor}`}>{icon}</div>
        <div>
          <p className="font-black text-white text-sm leading-tight">{char.name || '—'}</p>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${badgeColor}`}>{badge}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-3.5 pt-1">
        {fields.map(({ key, label }) =>
          char[key] ? (
            <div key={key} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-black text-white/25 uppercase tracking-widest">{label}</p>
              </div>
              <p className="text-xs font-medium text-white/55 leading-relaxed line-clamp-3">{char[key]}</p>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

const TITLE_STYLES: Record<string, string> = {
  '멜로·로맨스': 'text-transparent bg-clip-text bg-gradient-to-b from-white via-pink-200 to-rose-300 [filter:drop-shadow(0_2px_0_rgb(219,39,119))_drop-shadow(0_0_15px_rgba(255,105,180,0.8))_drop-shadow(0_0_30px_white)] italic font-serif tracking-tighter',
  '판타지': 'text-transparent bg-clip-text bg-gradient-to-b from-yellow-100 via-amber-400 to-yellow-700 [filter:drop-shadow(0_4px_0_rgb(69,26,3))_drop-shadow(0_0_20px_rgba(255,215,0,0.6))_drop-shadow(0_0_5px_black)] font-black uppercase tracking-[0.15em]',
  '스릴러': 'text-transparent bg-clip-text bg-gradient-to-b from-red-600 via-red-950 to-black [filter:drop-shadow(2px_2px_0_rgb(0,0,0))_drop-shadow(0_0_10px_rgba(255,0,0,0.5))_drop-shadow(4px_6px_8px_rgba(0,0,0,0.9))] font-black tracking-tighter scale-y-125',
  '미스터리': 'text-transparent bg-clip-text bg-gradient-to-b from-violet-200 via-indigo-400 to-slate-900 [filter:drop-shadow(0_2px_0_rgb(30,27,75))_drop-shadow(0_0_15px_rgba(129,140,248,0.7))] font-bold italic tracking-widest',
  '공포(호러)': 'text-transparent bg-clip-text bg-gradient-to-b from-red-950 via-red-800 to-stone-950 [filter:drop-shadow(0_4px_4px_rgb(0,0,0))_drop-shadow(0_0_12px_rgba(153,27,27,0.8))] font-black blur-[0.4px] tracking-tight uppercase',
  '액션': 'text-transparent bg-clip-text bg-gradient-to-b from-slate-50 via-slate-400 to-slate-800 [filter:drop-shadow(0_4px_0_rgb(30,41,59))_drop-shadow(0_0_20px_rgba(255,255,255,0.5))_drop-shadow(4px_4px_10px_black)] italic font-black tracking-tight uppercase',
  '전쟁': 'text-transparent bg-clip-text bg-gradient-to-b from-stone-200 via-orange-950 to-stone-900 [filter:drop-shadow(3px_3px_0_rgb(28,25,23))_drop-shadow(0_0_12px_rgba(124,45,18,0.6))] font-black tracking-tighter border-b-4 border-red-900/30',
  'SF': 'text-transparent bg-clip-text bg-gradient-to-b from-cyan-100 via-blue-500 to-indigo-950 [filter:drop-shadow(0_2px_0_rgb(8,47,73))_drop-shadow(0_0_15px_rgba(6,182,212,0.9))_drop-shadow(0_0_30px_rgba(30,58,138,0.5))] font-mono font-black tracking-wider',
  '코미디': 'text-transparent bg-clip-text bg-gradient-to-b from-white via-yellow-300 to-orange-600 [filter:drop-shadow(4px_4px_0_rgb(154,52,18))_drop-shadow(-2px_-2px_0_white)_drop-shadow(0_0_10px_rgba(251,191,36,0.5))] font-black tracking-normal',
  '드라마': 'text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-200 to-slate-500 [filter:drop-shadow(0_2px_0_rgb(71,85,105))_drop-shadow(0_4px_12px_rgba(0,0,0,0.5))] font-black tracking-tight',
  '고전': 'text-transparent bg-clip-text bg-gradient-to-b from-amber-50 via-yellow-600 to-amber-950 [filter:drop-shadow(0_4px_0_rgb(69,26,3))_drop-shadow(0_0_25px_rgba(251,191,36,0.5))_drop-shadow(2px_2px_0_black)] font-black tracking-[0.25em]'
};

const STORY_LENGTH_OPTIONS = [
  { value: 'short',  label: '단편', turns: '~20턴', desc: '빠른 결말' },
  { value: 'normal', label: '중편', turns: '~40턴', desc: '기본 플레이' },
  { value: 'long',   label: '장편', turns: '~80턴', desc: '깊은 몰입' },
] as const;

export default function Screen4({ flowData, onUpdate, onNext, onBack, onHome }: Props) {
  const { scenario, introDisplay, aiCharacterResult, userCharacterResult, supportingCast, coverImage, genre } = flowData;
  const [storyLength, setStoryLength] = useState<'short' | 'normal' | 'long'>(flowData.storyLength ?? 'normal');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showFullImage, setShowFullImage] = useState<{ src: string; alt: string } | null>(null);
  const [localCoverImages, setLocalCoverImages] = useState<string[]>(() => {
    if (flowData.coverImages && flowData.coverImages.length > 0) return flowData.coverImages;
    return coverImage ? [coverImage] : [];
  });
  const [coverIdx, setCoverIdx] = useState<number>(() => {
    const imgs = flowData.coverImages && flowData.coverImages.length > 0 ? flowData.coverImages : (coverImage ? [coverImage] : []);
    return Math.max(0, imgs.length - 1);
  });
  const [isCoverHovered, setIsCoverHovered] = useState(false);
  const [isCoverRegenerating, setIsCoverRegenerating] = useState(false);
  const [coverRegenConfirm, setCoverRegenConfirm] = useState(false);
  const [coverDeleteConfirm, setCoverDeleteConfirm] = useState(false);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleContainerRef = useRef<HTMLDivElement>(null);
  const [titleScale, setTitleScale] = useState(1);

  const titleStyle = TITLE_STYLES[genre] || TITLE_STYLES['드라마'];

  useLayoutEffect(() => {
    if (!editingTitle && titleRef.current && titleContainerRef.current) {
      const containerWidth = titleContainerRef.current.offsetWidth;
      const titleWidth = titleRef.current.scrollWidth;
      if (titleWidth > containerWidth * 0.9) {
        setTitleScale(Math.max(0.5, (containerWidth * 0.9) / titleWidth));
      } else {
        setTitleScale(1);
      }
    }
  }, [flowData.topicTitle, editingTitle]);

  const regenCoverImage = async () => {
    if (!flowData.topicId) return;
    setIsCoverRegenerating(true);
    try {
      const res = await apiFetch(`/topics/${flowData.topicId}/generate-cover-image`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          const newUrls: string[] = data.urls ?? [data.url];
          setLocalCoverImages(newUrls);
          setCoverIdx(newUrls.length - 1);
          onUpdate({ coverImage: data.url, coverImages: newUrls });
        }
      }
    } catch {}
    setIsCoverRegenerating(false);
  };

  const deleteCoverImg = async (index: number) => {
    if (!flowData.topicId) return;
    try {
      const res = await apiFetch(`/topics/${flowData.topicId}/cover-image?index=${index}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        const remaining: string[] = data.remaining ?? [];
        setLocalCoverImages(remaining);
        setCoverIdx(Math.max(0, Math.min(coverIdx, remaining.length - 1)));
        onUpdate({ coverImage: remaining.length > 0 ? remaining[remaining.length - 1] : '', coverImages: remaining });
      }
    } catch {}
    setCoverDeleteConfirm(false);
  };

  const saveTitle = async () => {
    if (!titleDraft.trim() || !flowData.topicId) { setEditingTitle(false); return; }
    try {
      await apiFetch(`/topics/${flowData.topicId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleDraft }),
      });
      onUpdate({ topicTitle: titleDraft });
    } catch (e) { console.error(e); }
    setEditingTitle(false);
  };

  const handleNext = async () => {
    onUpdate({
      storyLength,
      userPersona: {
        name: userCharacterResult.name,
        personality: userCharacterResult.personality,
        background: userCharacterResult.background,
        appearance: userCharacterResult.appearance,
        gender: userCharacterResult.gender ?? '',
        age: userCharacterResult.age ?? '',
        image: userCharacterResult.image,
      },
    });
    if (flowData.topicId) {
      try {
        await apiFetch(`/topics/${flowData.topicId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ story_length: storyLength }),
        });
      } catch (e) { console.error(e); }
    }
    onNext();
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col relative overflow-hidden">

      {/* 배경 글로우 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-violet-600/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-72 h-72 bg-purple-700/4 rounded-full blur-3xl" />
      </div>

      {/* 헤더 */}
      <header className="relative z-10 px-5 pt-6 pb-4 flex items-center gap-3 sticky top-0 bg-slate-950/90 backdrop-blur-xl border-b border-white/6">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/8 transition-colors">
          <ChevronLeft size={20} className="text-white/60" />
        </button>
        <button onClick={onHome} className="flex items-center gap-2.5 font-black text-lg text-white tracking-tighter hover:opacity-70 transition-opacity">
          <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-700 rounded-xl flex items-center justify-center shadow-lg shadow-violet-900/40">
            <Sparkles size={15} className="text-white" />
          </div>
          Dive.ai
        </button>
      </header>

      <main className="relative z-10 flex-1 px-5 py-8 pb-32 max-w-2xl mx-auto w-full space-y-9">

        {/* 표지 이미지 */}
        {(() => {
          const displayUrl = localCoverImages[coverIdx] ?? null;
          const safeIdx = Math.max(0, Math.min(coverIdx, localCoverImages.length - 1));
          return (
            <div
              className="relative w-full rounded-2xl overflow-hidden bg-white/5 border border-white/8 aspect-video"
              onMouseEnter={() => setIsCoverHovered(true)}
              onMouseLeave={() => setIsCoverHovered(false)}
            >
              {displayUrl ? (
                <img
                  src={displayUrl}
                  alt="Cover"
                  className="w-full h-full object-cover transition-transform duration-1000 cursor-pointer"
                  style={{ transform: isCoverHovered ? 'scale(1.05)' : 'scale(1)' }}
                  onClick={() => setShowFullImage({ src: displayUrl, alt: flowData.topicTitle })}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/3">
                  {isCoverRegenerating
                    ? <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
                        <p className="text-xs font-bold text-white/30">표지 이미지 생성 중...</p>
                      </div>
                    : <Sparkles size={40} className="text-white/15 animate-pulse" />
                  }
                </div>
              )}
              {isCoverHovered && displayUrl && (
                <div className="absolute inset-0 bg-black/15 transition-colors duration-300 pointer-events-none" />
              )}
              {isCoverHovered && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  {localCoverImages.length > 1 && (
                    <span className="text-[10px] font-bold text-white bg-black/50 rounded-full px-2 py-0.5">
                      {safeIdx + 1}/{localCoverImages.length}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setCoverRegenConfirm(true); }}
                    disabled={isCoverRegenerating}
                    className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-amber-500/80 transition-all disabled:opacity-40"
                    title="표지 재생성"
                  >
                    {isCoverRegenerating ? <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <RotateCcw size={14} />}
                  </button>
                  {displayUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setCoverDeleteConfirm(true); }}
                      className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-red-500/80 transition-all"
                      title="표지 삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  {displayUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowFullImage({ src: displayUrl, alt: flowData.topicTitle }); }}
                      className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:scale-110 transition-all"
                    >
                      <Maximize2 size={14} />
                    </button>
                  )}
                </div>
              )}
              {isCoverHovered && localCoverImages.length > 1 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setCoverIdx(Math.max(0, safeIdx - 1)); }}
                    disabled={safeIdx === 0}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors disabled:opacity-20"
                  >
                    <ChevLeft size={18} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setCoverIdx(Math.min(localCoverImages.length - 1, safeIdx + 1)); }}
                    disabled={safeIdx === localCoverImages.length - 1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors disabled:opacity-20"
                  >
                    <ChevRight size={18} />
                  </button>
                </>
              )}
            </div>
          );
        })()}

        {/* 제목 */}
        <div className="flex flex-col items-center gap-3 pt-1 pb-2 text-center">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
            <span className="text-[10px] font-black text-violet-300/70 uppercase tracking-[0.2em]">Universe Prepared</span>
          </div>

          <div ref={titleContainerRef} className="relative inline-block w-full max-w-full px-4">
            {editingTitle ? (
              <div className="flex items-center justify-center gap-2">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                  className="bg-slate-800 border border-white/20 rounded-2xl px-5 py-3 text-2xl font-black text-white outline-none focus:border-violet-500/60 w-full max-w-sm text-center placeholder:text-white/30"
                />
                <div className="flex gap-2">
                  <button onClick={saveTitle} className="p-3 bg-violet-600 text-white rounded-2xl hover:bg-violet-500 transition-all shadow-lg active:scale-95"><Check size={18} /></button>
                  <button onClick={() => setEditingTitle(false)} className="p-3 bg-white/8 text-white/50 hover:bg-white/12 rounded-2xl transition-all active:scale-95"><X size={18} /></button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3">
                <h1
                  ref={titleRef}
                  style={{
                    transform: `scale(${titleScale})`,
                    transformOrigin: 'center',
                    whiteSpace: 'nowrap',
                    padding: '0 20px'
                  }}
                  className={`text-3xl md:text-5xl leading-tight transition-all duration-300 ${titleStyle}`}
                >
                  {flowData.topicTitle || '—'}
                </h1>
                <button
                  onClick={() => { setTitleDraft(flowData.topicTitle ?? ''); setEditingTitle(true); }}
                  className="shrink-0 p-2 bg-white/8 hover:bg-white/15 text-white/40 hover:text-white/70 rounded-full transition-all active:scale-90"
                >
                  <Edit3 size={15} />
                </button>
              </div>
            )}
          </div>

          <p className="text-white/20 text-[11px] font-black tracking-[0.3em] uppercase">The Chronicles of Your Destiny</p>
        </div>

        <div className="text-center -mt-2">
          <p className="text-sm text-white/30 font-medium">시작 배경과 등장인물을 확인해보세요</p>
        </div>

        {/* 시작 배경 */}
        <div className="space-y-3.5">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-emerald-500/70 rounded-full" />
            <h2 className="text-xs font-black text-white/40 uppercase tracking-wider">시작 배경</h2>
          </div>
          <div className="bg-white/5 border border-white/8 rounded-2xl p-5">
            <p className="text-sm font-medium text-white/60 leading-relaxed whitespace-pre-wrap break-keep [text-wrap:pretty]">
              {introDisplay || scenario['기'] || '—'}
            </p>
          </div>
        </div>

        {/* 등장인물 */}
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 bg-violet-500/70 rounded-full" />
              <h2 className="text-xs font-black text-white/40 uppercase tracking-wider">등장인물</h2>
            </div>
          </div>

          <div className="flex items-center gap-2 px-1">
            <User size={12} className="text-violet-400/60" />
            <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">주연</span>
          </div>

          <ReadCharCard
            badge="상대 캐릭터"
            badgeColor="bg-violet-500/15 text-violet-300"
            icon={<Bot size={15} className="text-violet-400" />}
            char={aiCharacterResult}
            onZoom={(src, alt) => setShowFullImage({ src, alt })}
          />

          <ReadCharCard
            badge="나의 캐릭터"
            badgeColor="bg-purple-500/15 text-purple-300"
            icon={<User size={15} className="text-purple-400" />}
            char={userCharacterResult}
            onZoom={(src, alt) => setShowFullImage({ src, alt })}
          />

          {supportingCast.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <Users size={12} className="text-white/25" />
                <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">조연</span>
              </div>
              {supportingCast.map((c, i) => {
                const charAsResult: CharacterResult = {
                  name: c.name,
                  role: c.role ?? '',
                  gender: c.gender ?? '',
                  age: c.age ?? '',
                  personality: c.personality ?? '',
                  appearance: c.appearance ?? '',
                  background: c.background ?? '',
                };
                return (
                  <ReadCharCard
                    key={i}
                    badge="조연"
                    badgeColor="bg-white/8 text-white/40"
                    icon={<Users size={15} className="text-white/30" />}
                    char={charAsResult}
                    onZoom={(src, alt) => setShowFullImage({ src, alt })}
                  />
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* 표지 재생성 확인 모달 */}
      {coverRegenConfirm && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-slate-900 border border-white/8 w-full max-w-sm rounded-3xl p-7 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-11 h-11 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <RotateCcw size={20} />
              </div>
              <h3 className="text-white text-lg font-black">표지 이미지 재생성</h3>
              <p className="text-white/40 text-sm font-medium leading-relaxed">
                시나리오를 기반으로 새 표지 이미지를 생성합니다.<br />이전 이미지는 보관됩니다.
              </p>
            </div>
            <div className="flex gap-2.5">
              <button onClick={() => setCoverRegenConfirm(false)} className="flex-1 py-3 bg-white/6 hover:bg-white/10 text-white/50 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => { setCoverRegenConfirm(false); regenCoverImage(); }} className="flex-1 py-3 bg-amber-500/90 hover:bg-amber-500 text-white rounded-xl font-black text-sm transition-all">재생성</button>
            </div>
          </div>
        </div>
      )}

      {/* 표지 삭제 확인 모달 */}
      {coverDeleteConfirm && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-slate-900 border border-white/8 w-full max-w-sm rounded-3xl p-7 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-11 h-11 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={20} />
              </div>
              <h3 className="text-white text-lg font-black">표지 이미지 삭제</h3>
              <p className="text-white/40 text-sm font-medium leading-relaxed">
                삭제된 이미지는 복구되지 않습니다.<br />정말 삭제할까요?
              </p>
            </div>
            <div className="flex gap-2.5">
              <button onClick={() => setCoverDeleteConfirm(false)} className="flex-1 py-3 bg-white/6 hover:bg-white/10 text-white/50 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => deleteCoverImg(coverIdx)} className="flex-1 py-3 bg-red-500/90 hover:bg-red-500 text-white rounded-xl font-black text-sm transition-all">확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 이미지 확대 모달 */}
      {showFullImage && (
        <div className="fixed inset-0 z-[500] bg-black/98 backdrop-blur-3xl flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-300" onClick={() => setShowFullImage(null)}>
          <button className="absolute top-8 right-8 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all">
            <X size={24} />
          </button>
          <div className="relative max-w-6xl w-full h-full flex flex-col items-center justify-center gap-6" onClick={e => e.stopPropagation()}>
            <img src={showFullImage.src} alt={showFullImage.alt} className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border border-white/10" />
            <div className="text-center">
              <h3 className="text-xl font-black text-white">{showFullImage.alt}</h3>
              <p className="text-white/25 text-xs font-black tracking-[0.5em] uppercase mt-2">Dive AI Original Chronicles</p>
            </div>
          </div>
        </div>
      )}

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-950/90 backdrop-blur-xl border-t border-white/6 z-20">
        {/* 스토리 길이 선택 */}
        <div className="max-w-sm mx-auto px-5 pt-4 pb-2 space-y-2">
          <p className="text-[10px] font-black text-white/25 uppercase tracking-widest text-center">스토리 길이</p>
          <div className="grid grid-cols-3 gap-2">
            {STORY_LENGTH_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setStoryLength(opt.value)}
                className={`flex flex-col items-center gap-0.5 py-2.5 px-2 rounded-xl border transition-all ${
                  storyLength === opt.value
                    ? 'bg-violet-600/20 border-violet-500/50 text-violet-300'
                    : 'bg-white/4 border-white/8 text-white/30 hover:bg-white/8 hover:text-white/50'
                }`}
              >
                <span className="text-xs font-black">{opt.label}</span>
                <span className="text-[9px] font-bold opacity-70">{opt.turns}</span>
                <span className="text-[9px] opacity-50">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="max-w-sm mx-auto px-5 pb-5">
          <button
            onClick={handleNext}
            className="w-full bg-gradient-to-r from-violet-600 to-purple-600 text-white py-4 rounded-2xl font-black text-base shadow-lg shadow-violet-900/40 hover:opacity-90 transition-all active:scale-[0.99]"
          >
            플레이 시작
          </button>
        </div>
      </div>
    </div>
  );
}
