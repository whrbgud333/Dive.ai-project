import React, { useState, useEffect, useRef } from 'react';
import { Search, MessageCircle, Trash2, Bookmark, BookmarkCheck, Edit3, Check, X, BookOpen } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface Props {
  onSelectTopic: (topic: any) => void;
  onCreateNew: () => void;
  refreshKey?: number;
}

const AVATAR_GRADIENTS = [
  'from-blue-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-500',
  'from-emerald-500 to-teal-600',
  'from-violet-500 to-indigo-600',
  'from-cyan-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-emerald-600',
];

function timeAgo(dateStr: string): string {
  const normalized = dateStr.includes('Z') || dateStr.includes('+')
    ? dateStr
    : dateStr.replace(' ', 'T') + 'Z';
  const diff = Math.floor((Date.now() - new Date(normalized).getTime()) / 1000);
  if (diff < 0) return '방금';
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

const BOOKMARK_KEY = 'dive_bookmarks';

function loadBookmarks(): Set<number> {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveBookmarks(bookmarks: Set<number>) {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...bookmarks]));
}

export default function ChatList({ onSelectTopic, onCreateNew, refreshKey }: Props) {
  const { user } = useAuth();
  const [topics, setTopics] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<Set<number>>(loadBookmarks);
  const [editingNameId, setEditingNameId] = useState<number | null>(null);
  const [editNameDraft, setEditNameDraft] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState<{ show: boolean; ids: number[] }>({ show: false, ids: [] });
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [publishToast, setPublishToast] = useState('');
  const [publishConfirm, setPublishConfirm] = useState<any | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [fullViewCover, setFullViewCover] = useState<{ src: string; title: string } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) loadTopics();
  }, [refreshKey, user]);

  if (!user) {
    return (
      <div className="flex flex-col h-full bg-slate-950">
        <div className="px-5 pt-6 pb-4 border-b border-white/8">
          <h1 className="text-xl font-black text-white tracking-tight">채팅</h1>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 pb-16">
          <MessageCircle size={40} className="text-white/10" />
          <p className="text-sm font-bold text-white/30">로그인 후 이용할 수 있습니다</p>
          <p className="text-xs text-white/20 font-medium">마이 탭에서 Google 로그인을 해주세요</p>
        </div>
      </div>
    );
  }

  const loadTopics = async () => {
    try {
      const res = await apiFetch('/topics');
      setTopics(await res.json());
    } catch (e) { console.error(e); }
  };

  const deleteTopics = async (ids: number[]) => {
    try {
      await apiFetch(`/topics`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids)
      });
      setTopics(prev => prev.filter(t => !ids.includes(t.id)));
      setBookmarks(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        saveBookmarks(next);
        return next;
      });
      setSelectedIds(new Set());
    } catch (e) { console.error(e); }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(t => t.id)));
    }
  };

  const startEditName = (e: React.MouseEvent, t: any) => {
    e.stopPropagation();
    setEditingNameId(t.id);
    setEditNameDraft(t.custom_name || t.title || '');
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const saveCustomName = async (e: React.MouseEvent | React.KeyboardEvent, id: number) => {
    e.stopPropagation();
    try {
      await apiFetch(`/topics/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_name: editNameDraft.trim() || null }),
      });
      setTopics(prev => prev.map(t => t.id === id ? { ...t, custom_name: editNameDraft.trim() || null } : t));
    } catch (e) { console.error(e); }
    setEditingNameId(null);
  };

  const cancelEditName = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setEditingNameId(null);
  };

  const showPubToast = (msg: string) => {
    setPublishToast(msg);
    setTimeout(() => setPublishToast(''), 2500);
  };

  const togglePublish = async (e: React.MouseEvent, t: any) => {
    e.stopPropagation();
    setPublishingId(t.id);
    try {
      const res = await apiFetch(`/topics/${t.id}/publish`, { method: 'POST' });
      const data = await res.json();
      setTopics(prev => prev.map(tp => tp.id === t.id ? { ...tp, is_published: data.is_published } : tp));
      showPubToast(data.is_published ? '갤러리에 게시되었습니다!' : '게시가 취소되었습니다.');
    } catch {
      showPubToast('오류가 발생했습니다.');
    } finally {
      setPublishingId(null);
    }
  };

  const toggleBookmark = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setBookmarks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveBookmarks(next);
      return next;
    });
  };

  const filtered = topics
    .filter(t =>
      (t.title ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (t.ai_character?.name ?? '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const aB = bookmarks.has(a.id);
      const bB = bookmarks.has(b.id);
      if (aB !== bB) return aB ? -1 : 1;
      const aTime = a.last_message_at ?? a.created_at;
      const bTime = b.last_message_at ?? b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

  const hasBookmarked = filtered.some(t => bookmarks.has(t.id));
  const hasNormal = filtered.some(t => !bookmarks.has(t.id));

  return (
    <div className="flex flex-col h-full bg-slate-950 relative">
      {/* 헤더 */}
      <div className="px-5 pt-6 pb-4 border-b border-white/8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-black text-white tracking-tight">채팅</h1>
          <div className="flex gap-2">
            {isEditMode && filtered.length > 0 && (
              <button
                onClick={toggleSelectAll}
                className="text-xs font-black text-violet-300 bg-violet-500/10 border border-violet-500/20 px-3 py-1.5 rounded-xl hover:bg-violet-500/20 transition-all"
              >
                {selectedIds.size === filtered.length ? '전체 해제' : '전체 선택'}
              </button>
            )}
            <button
              onClick={() => { setIsEditMode(!isEditMode); setSelectedIds(new Set()); }}
              className={`text-xs font-black px-3 py-1.5 rounded-xl transition-all ${isEditMode ? 'bg-white text-slate-900' : 'text-white/50 bg-white/8 border border-white/10 hover:bg-white/15'}`}
            >
              {isEditMode ? '완료' : '편집'}
            </button>
          </div>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="채팅 검색"
            className="w-full bg-white/5 border border-white/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm font-medium text-white placeholder:text-white/25 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/30 transition-all"
          />
        </div>
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 pb-16">
            <MessageCircle size={40} className="text-white/10" />
            <p className="text-sm font-bold text-white/30">
              {search ? '검색 결과가 없습니다' : '아직 채팅이 없습니다'}
            </p>
            {!search && (
              <button onClick={onCreateNew}
                className="text-xs font-black text-violet-300 bg-violet-500/10 px-5 py-2.5 rounded-2xl border border-violet-500/20 hover:bg-violet-500/20 transition-all">
                새 이야기 생성하기
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {hasBookmarked && (
              <div className="flex items-center gap-2 px-1 pb-1">
                <div className="w-1 h-3.5 bg-amber-400 rounded-full" />
                <span className="text-[10px] font-black text-amber-400/70 uppercase tracking-[0.2em]">북마크</span>
              </div>
            )}

            {filtered.map((t, i) => {
              const isBookmarked = bookmarks.has(t.id);
              const charName = t.ai_character?.name || t.character_name || '?';
              const gradient = AVATAR_GRADIENTS[(t.id ?? i) % AVATAR_GRADIENTS.length];
              const prevBookmarked = i > 0 ? bookmarks.has(filtered[i - 1].id) : isBookmarked;
              const showNormalLabel = hasBookmarked && hasNormal && !isBookmarked && prevBookmarked;

              return (
                <React.Fragment key={t.id ?? i}>
                  {showNormalLabel && (
                    <div className="flex items-center gap-2 px-1 pt-2 pb-1">
                      <div className="w-1 h-3.5 bg-white/20 rounded-full" />
                      <span className="text-[10px] font-black text-white/25 uppercase tracking-[0.2em]">최근 대화</span>
                    </div>
                  )}
                  <div
                    onClick={() => {
                      if (isEditMode) { toggleSelect(t.id); return; }
                      if (editingNameId === t.id) return;
                      onSelectTopic(t);
                    }}
                    className={`group relative flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer ${
                      isEditMode && selectedIds.has(t.id)
                        ? 'bg-violet-500/10 border-violet-500/30'
                        : isBookmarked
                        ? 'bg-amber-500/5 border-amber-500/15 hover:border-amber-500/30 hover:bg-amber-500/8'
                        : 'bg-white/4 border-white/8 hover:border-purple-500/40 hover:bg-white/6'
                    }`}
                  >
                    {/* 선택 체크박스 */}
                    {isEditMode && (
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${selectedIds.has(t.id) ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white/5 border-white/20'}`}>
                        {selectedIds.has(t.id) && <Check size={12} strokeWidth={4} />}
                      </div>
                    )}

                    {/* 표지 이미지 / 아바타 */}
                    <div
                      onClick={(e) => {
                        if (t.cover_image) {
                          e.stopPropagation();
                          setFullViewCover({ src: t.cover_image, title: t.custom_name || t.title });
                        }
                      }}
                      className={`w-14 h-14 rounded-xl overflow-hidden shrink-0 transition-all ${isEditMode ? 'opacity-40 scale-90' : ''} ${t.cover_image ? 'cursor-pointer hover:ring-2 hover:ring-purple-400/60 hover:scale-105' : `bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-black text-xl shadow-lg`}`}
                    >
                      {t.cover_image ? (
                        <img src={t.cover_image} alt={t.title} className="w-full h-full object-cover" />
                      ) : (
                        charName[0]?.toUpperCase()
                      )}
                    </div>

                    {/* 정보 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        {editingNameId === t.id ? (
                          <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                            <input
                              ref={nameInputRef}
                              value={editNameDraft}
                              onChange={e => setEditNameDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveCustomName(e, t.id); if (e.key === 'Escape') cancelEditName(e); }}
                              className="text-sm font-black text-white bg-white/10 border border-white/20 rounded-lg px-2 py-0.5 outline-none focus:ring-2 focus:ring-violet-500/50 flex-1 min-w-0"
                            />
                            <button onClick={e => saveCustomName(e, t.id)} className="p-1 text-violet-400 hover:text-violet-300 shrink-0"><Check size={13} /></button>
                            <button onClick={e => cancelEditName(e)} className="p-1 text-white/40 hover:text-white/60 shrink-0"><X size={13} /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 min-w-0 flex-1">
                            <span className="text-sm font-black text-white truncate">{t.custom_name || t.title}</span>
                            <button
                              onClick={e => startEditName(e, t)}
                              className="p-0.5 text-white/20 hover:text-violet-400 rounded transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                            ><Edit3 size={11} /></button>
                          </div>
                        )}
                        <span className="text-[10px] text-white/25 shrink-0 font-medium">{timeAgo(t.last_message_at ?? t.created_at)}</span>
                      </div>

                      {/* 캐릭터 이름 행 */}
                      {(t.ai_character_name || t.user_character_name) && (
                        <p className="text-[11px] text-white/40 truncate mb-1">
                          {t.ai_character_name && (
                            <span>AI 캐릭터: <span className="text-purple-300 font-bold">{t.ai_character_name}</span></span>
                          )}
                          {t.ai_character_name && t.user_character_name && <span className="mx-1">·</span>}
                          {t.user_character_name && (
                            <span>나: <span className="text-pink-300 font-bold">{t.user_character_name}</span></span>
                          )}
                        </p>
                      )}

                      {/* 뱃지 행 */}
                      <div className="flex items-center gap-1 flex-wrap">
                        {t.content_type && (
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border shrink-0 ${
                            t.content_type === '만화' ? 'text-violet-300 bg-violet-500/10 border-violet-500/15' :
                            t.content_type === '소설' ? 'text-blue-300 bg-blue-500/10 border-blue-500/15' :
                            t.content_type === '시리즈' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/15' :
                            t.content_type === '영화' ? 'text-amber-300 bg-amber-500/10 border-amber-500/15' :
                            t.content_type === '고전' ? 'text-rose-300 bg-rose-500/10 border-rose-500/15' :
                            'text-white/50 bg-white/5 border-white/10'
                          }`}>{t.content_type}</span>
                        )}
                        {(t.genre || (t.content_type === '고전' && t.classic_country)) && (
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border shrink-0 ${
                            t.genre === '판타지' ? 'text-violet-300 bg-violet-500/10 border-violet-500/15' :
                            t.genre === '로맨스' ? 'text-pink-300 bg-pink-500/10 border-pink-500/15' :
                            t.genre === '액션' ? 'text-orange-300 bg-orange-500/10 border-orange-500/15' :
                            t.genre === '미스터리' ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/15' :
                            t.genre === '공포' ? 'text-red-400 bg-red-500/10 border-red-500/15' :
                            t.genre === 'SF' ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/15' :
                            t.genre === '역사' ? 'text-yellow-300 bg-yellow-500/10 border-yellow-500/15' :
                            t.genre === '일상' ? 'text-green-300 bg-green-500/10 border-green-500/15' :
                            'text-white/50 bg-white/5 border-white/10'
                          }`}>
                            {t.content_type === '고전' && t.classic_country
                              ? `${t.classic_country}${t.genre ? ` · ${t.genre}` : ''}`
                              : t.genre}
                          </span>
                        )}
                        {t.current_stage && !t.is_ended && (
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 border ${
                            t.current_stage === '기' ? 'text-sky-300 bg-sky-500/10 border-sky-500/20' :
                            t.current_stage === '승' ? 'text-violet-300 bg-violet-500/10 border-violet-500/20' :
                            t.current_stage === '전' ? 'text-orange-300 bg-orange-500/10 border-orange-500/20' :
                            'text-rose-300 bg-rose-500/10 border-rose-500/20'
                          }`}>{t.current_stage}단계</span>
                        )}
                        {t.is_ended && (
                          <span className="text-[9px] font-black text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-full shrink-0">완결</span>
                        )}
                        {t.is_published && (
                          <span className="text-[9px] font-black text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded-full shrink-0">게시중</span>
                        )}
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 border ${
                          t.story_length === 'short' ? 'text-orange-300 bg-orange-500/10 border-orange-500/20' :
                          t.story_length === 'long' ? 'text-blue-300 bg-blue-500/10 border-blue-500/20' :
                          'text-slate-400 bg-white/5 border-white/10'
                        }`}>
                          {t.story_length === 'short' ? '단편' : t.story_length === 'long' ? '장편' : '중편'}
                        </span>
                        {t.source_author_name && (
                          <span className="text-[9px] font-black text-violet-300 bg-violet-500/10 border border-violet-500/15 px-1.5 py-0.5 rounded-full shrink-0">by {t.source_author_name}</span>
                        )}
                      </div>
                    </div>

                    {/* 액션 버튼 */}
                    {!isEditMode && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        {t.compass && !t.imported_from_id && (
                          <button
                            onClick={e => { e.stopPropagation(); setPublishConfirm(t); }}
                            disabled={publishingId === t.id}
                            title={t.is_published ? '게시 취소' : '갤러리에 게시'}
                            className={`p-2 rounded-xl transition-all disabled:opacity-30 ${t.is_published ? 'text-emerald-400 bg-emerald-400/10' : 'text-white/25 hover:text-emerald-400 hover:bg-emerald-400/10'}`}
                          >
                            <BookOpen size={14} />
                          </button>
                        )}
                        <button
                          onClick={e => toggleBookmark(e, t.id)}
                          className={`p-2 rounded-xl transition-all ${isBookmarked ? 'text-amber-400 bg-amber-400/10' : 'text-white/25 hover:text-amber-400 hover:bg-amber-400/10'}`}
                        >
                          {isBookmarked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setShowDeleteModal({ show: true, ids: [t.id] }); }}
                          disabled={deletingId === t.id}
                          className="p-2 text-white/25 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* 멀티 삭제 플로팅 액션 바 */}
      {isEditMode && selectedIds.size > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-40px)] max-w-sm bg-slate-900/90 backdrop-blur-lg border border-white/10 rounded-2xl p-4 flex items-center justify-between shadow-2xl animate-in slide-in-from-bottom-4 duration-300 z-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-violet-600 rounded-full flex items-center justify-center text-[11px] font-black text-white">
              {selectedIds.size}
            </div>
            <span className="text-xs font-bold text-white">개의 채팅방 선택됨</span>
          </div>
          <button
            onClick={() => setShowDeleteModal({ show: true, ids: Array.from(selectedIds) })}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl text-xs font-black transition-all active:scale-95 shadow-lg shadow-red-900/20"
          >
            <Trash2 size={14} /> 선택 삭제
          </button>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {showDeleteModal.show && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-[#1e1e22] rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl border border-white/5 space-y-7 animate-in zoom-in-95 duration-300">
            <div className="text-center space-y-3">
              <div className="mx-auto w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-2">
                <Trash2 size={24} />
              </div>
              <h3 className="text-xl font-black text-white">
                {showDeleteModal.ids.length > 1 ? '채팅방 일괄 삭제' : '채팅방 삭제'}
              </h3>
              <div className="space-y-1">
                <p className="text-sm font-black text-slate-200 leading-relaxed">
                  {showDeleteModal.ids.length > 1 ? `${showDeleteModal.ids.length}개의 채팅방을 삭제할까요?` : '선택한 채팅방을 삭제할까요?'}
                </p>
                <p className="text-[11px] font-medium text-slate-400 leading-relaxed px-2">
                  캐릭터와 나눈 모든 채팅이 삭제되고<br />
                  다시 복구할 수 없어요.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={async () => {
                  await deleteTopics(showDeleteModal.ids);
                  setShowDeleteModal({ show: false, ids: [] });
                  if (isEditMode) setIsEditMode(false);
                }}
                className="w-full bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-red-900/20 transition-all active:scale-[0.98]"
              >
                삭제하기
              </button>
              <button
                onClick={() => setShowDeleteModal({ show: false, ids: [] })}
                className="w-full bg-white/5 hover:bg-white/10 text-slate-400 py-3 rounded-2xl font-black text-xs transition-all"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 배포 확인 모달 */}
      {publishConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-6" onClick={() => setPublishConfirm(null)}>
          <div className="bg-[#1e1e22] rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl border border-white/5 space-y-7 animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
            <div className="text-center space-y-3">
              <div className="mx-auto w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-2">
                {publishConfirm.is_published
                  ? <BookOpen size={24} className="text-emerald-400" />
                  : <BookOpen size={24} className="text-slate-400" />}
              </div>
              <h3 className="text-xl font-black text-white">
                {publishConfirm.is_published ? '게시 취소' : '갤러리 게시'}
              </h3>
              <div className="space-y-1">
                <p className="text-sm font-black text-slate-200 leading-relaxed">
                  {publishConfirm.is_published
                    ? '갤러리에서 이 시나리오를 내릴까요?'
                    : '이 시나리오를 갤러리에 공개할까요?'}
                </p>
                <p className="text-[11px] font-medium text-slate-400 leading-relaxed px-2">
                  {publishConfirm.title}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={async () => { const t = publishConfirm; setPublishConfirm(null); await togglePublish({ stopPropagation: () => {} } as any, t); }}
                className={`w-full py-4 rounded-2xl font-black text-sm text-white shadow-xl transition-all active:scale-[0.98] ${publishConfirm.is_published ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
              >
                {publishConfirm.is_published ? '게시 취소하기' : '게시하기'}
              </button>
              <button
                onClick={() => setPublishConfirm(null)}
                className="w-full bg-white/5 hover:bg-white/10 text-slate-400 py-3 rounded-2xl font-black text-xs transition-all"
              >
                돌아가기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 배포 토스트 */}
      {publishToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-slate-800 border border-white/20 text-white text-xs font-bold px-4 py-2.5 rounded-2xl shadow-xl z-50 whitespace-nowrap">
          {publishToast}
        </div>
      )}

      {/* 표지 크게 보기 모달 */}
      {fullViewCover && (
        <div className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={() => setFullViewCover(null)}>
          <button className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all">
            <X size={24} />
          </button>
          <div className="relative max-w-4xl w-full h-full flex flex-col items-center justify-center gap-6" onClick={e => e.stopPropagation()}>
            <img src={fullViewCover.src} alt={fullViewCover.title} className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border border-white/10" />
            <div className="text-center">
              <h3 className="text-xl font-black text-white">{fullViewCover.title}</h3>
              <p className="text-white/40 text-xs font-bold tracking-widest mt-1 uppercase">Dive.ai Original Series Cover</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
