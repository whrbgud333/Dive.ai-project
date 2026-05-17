import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, Send, Info, Zap, MessageSquare, Sparkles, Edit3, Trash2, Check, X, Book, ChevronDown, ChevronUp, GitFork, Maximize2, RotateCcw, Coins, Play, Pause, Square, Volume2, VolumeX, MoreVertical, Music, Headphones, Dices, Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, ImageIcon } from 'lucide-react';
import { SessionOptions } from '../types';
import { apiFetch } from '../lib/api';

import { useAuth } from '../context/AuthContext';

// ── 생성 작업 localStorage 플래그 (컴포넌트 언마운트 후에도 유지) ──
const GEN_TIMEOUT_MS = 15 * 60 * 1000; // 15분

function setGenFlag(topicId: number, type: string, extra?: Record<string, any>) {
  localStorage.setItem(`dive_gen_${topicId}_${type}`, JSON.stringify({ ...extra, startedAt: Date.now() }));
}
function clearGenFlag(topicId: number, type: string) {
  localStorage.removeItem(`dive_gen_${topicId}_${type}`);
}
function getGenFlag(topicId: number, type: string): Record<string, any> | null {
  try {
    const raw = localStorage.getItem(`dive_gen_${topicId}_${type}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.startedAt > GEN_TIMEOUT_MS) {
      localStorage.removeItem(`dive_gen_${topicId}_${type}`);
      return null;
    }
    return data;
  } catch { return null; }
}
function getActiveBackgroundStatic(bgImages: any, stage: string): string | null {
  if (!bgImages) return null;
  if (bgImages.active && Object.prototype.hasOwnProperty.call(bgImages.active, stage)) return bgImages.active[stage] ?? null;
  const val = bgImages[stage];
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && val.length > 0) return val[0];
  return null;
}

interface ChatProps {
  user: { name: string; email: string };
  initialTopicId?: number | null;
  initialPersona?: { name: string; personality: string; background: string; appearance: string };
  initialCharacterImages?: { ai_image?: string | null; user_image?: string | null };
  sessionOptions?: SessionOptions;
  onBack?: () => void;
  onNewChat?: () => void;
  onSelectTopic?: (topicId: number) => void;
}

const ChatInterface: React.FC<ChatProps> = ({
  user: initialUser,
  initialTopicId = null,
  initialPersona,
  initialCharacterImages,
  sessionOptions,
  onBack,
  onNewChat,
  onSelectTopic,
}) => {
  const { user, refreshUser } = useAuth();
  const [topics, setTopics] = useState<any[]>([]);
  const [activeTopic, setActiveTopic] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [allMessagesForUsage, setAllMessagesForUsage] = useState<any[]>([]);
  const [input, setInput] = useState('');

  const [model, setModel] = useState<string>(sessionOptions?.model ?? 'gemini-3.1-flash-lite-preview-vertex');
  const [isSidebarOpen, setSidebarOpen] = useState(window.innerWidth > 1024);
  const [isRightSidebarOpen, setRightSidebarOpen] = useState(window.innerWidth > 1024);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [diceRoll, setDiceRoll] = useState<number | null>(null);
  const [showAutoMenu, setShowAutoMenu] = useState(false);
  const [showToneMenu, setShowToneMenu] = useState(false);
  const autoTurnsRef = useRef(0);
  const sendAutoRef = useRef<() => void>(() => {});
  const openingAbortRef = useRef<AbortController | null>(null);
  const [showOpeningButton, setShowOpeningButton] = useState(false);
  const [showScenarioInfo, setShowScenarioInfo] = useState(false);
  const [showReplayModal, setShowReplayModal] = useState(false);
  const [replayLength, setReplayLength] = useState<'short' | 'normal' | 'long'>('normal');
  const [isReplaying, setIsReplaying] = useState(false);
  const [editingOpeningTitle, setEditingOpeningTitle] = useState(false);
  const [openingTitleDraft, setOpeningTitleDraft] = useState('');

  const [personas, setPersonas] = useState<any[]>([]);
  const [isPersonaExpanded, setIsPersonaExpanded] = useState(true);
  const [showPersonaForm, setShowPersonaForm] = useState(false);
  const [personaForm, setPersonaForm] = useState({ name: '', description: '' });
  const [editingPersonaId, setEditingPersonaId] = useState<number | null>(null);
  const [editPersonaForm, setEditPersonaForm] = useState({ name: '', description: '' });

  const [editingTopicId, setEditingTopicId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [modal, setModal] = useState<{ show: boolean; title: string; message: string; warning?: string; confirmLabel?: string; variant?: 'delete' | 'confirm'; onConfirm: () => void } | null>(null);
  const [activeTab, setActiveTab] = useState<'status' | 'summaries' | 'lorebook' | 'relation' | 'gallery'>('status');
  const [summaries, setSummaries] = useState<any[]>([]);
  const [summaryNotif, setSummaryNotif] = useState<{ show: boolean; success: boolean; text: string } | null>(null);
  const [editingSummaryId, setEditingSummaryId] = useState<number | null>(null);
  const [editSummaryText, setEditSummaryText] = useState('');

  // 인물 관계도 상태
  const [relationGraph, setRelationGraph] = useState<any>(null);
  const [isGraphRefreshing, setIsGraphRefreshing] = useState(false);
  const [showGraphRefreshConfirm, setShowGraphRefreshConfirm] = useState(false);
  const [showGraphModal, setShowGraphModal] = useState(false);

  // 로어북 상태
  const [lorebookEntries, setLorebookEntries] = useState<any[]>([]);
  const [lorebookAddSection, setLorebookAddSection] = useState<string | null>(null);
  const [lorebookForm, setLorebookForm] = useState({ keyword: '', content: '', category: 'place' });
  const [editingLorebookIndex, setEditingLorebookIndex] = useState<number | null>(null);
  const [editLorebookForm, setEditLorebookForm] = useState({ keyword: '', content: '', category: 'place' });
  const [editCharInfo, setEditCharInfo] = useState<{ role: string; gender: string; age: string; personality: string; appearance: string; background: string } | null>(null);
  const [addCharForm, setAddCharForm] = useState({ name: '', role: '', gender: '', age: '', personality: '', appearance: '', background: '', notes: '' });

  const [showTokenPopup, setShowTokenPopup] = useState(false);
  const [lastOutputTokens, setLastOutputTokens] = useState(0);
  const [lastInputTokens, setLastInputTokens] = useState(0);
  const [tokenEstimate, setTokenEstimate] = useState<any>(null);
  const tokenPopupRef = useRef<HTMLDivElement>(null);
  const dtBtnRef = useRef<HTMLButtonElement>(null);
  const [dtPopupPos, setDtPopupPos] = useState<{top: number; left: number}>({top: 56, left: 0}); // unused, kept for compat

  const [userNotes, setUserNotes] = useState('');
  const [tone, setTone] = useState(sessionOptions?.tone ?? '');
  const [notePresets, setNotePresets] = useState<{id: number; title: string; content: string}[]>([]);
  const [noteForm, setNoteForm] = useState({ title: '', content: '' });
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);

  // v2 상태
  const [hintCard, setHintCard] = useState<string | null>(null);
  const [endingData, setEndingData] = useState<{ type: string; scene: string; affinity: number } | null>(null);
  const [isEnded, setIsEnded] = useState(false);
  const [showSuggestMenu, setShowSuggestMenu] = useState(false);
  const [suggestedReplies, setSuggestedReplies] = useState<{ type: string; text: string }[]>([]);
  const [isSuggestLoading, setIsSuggestLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [isStageTransitioning, setIsStageTransitioning] = useState(false);
  const [isEndingLoading, setIsEndingLoading] = useState(false);
  const [isAffinityImageLoading, setIsAffinityImageLoading] = useState(false);
  const [innerThoughts, setInnerThoughts] = useState<Record<string, string>>({});
  const [selectedInnerChar, setSelectedInnerChar] = useState<string>('');
  const [isInnerThoughtLoading, setIsInnerThoughtLoading] = useState(false);
  const [showInnerThoughtConfirm, setShowInnerThoughtConfirm] = useState(false);
  const [expandedChars, setExpandedChars] = useState<Set<string>>(new Set());
  const [showSummaryConfirm, setShowSummaryConfirm] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // 채팅 배경 이미지 상태
  const [chatBackground, setChatBackground] = useState<string | null>(null);
  const [isBgLoading, setIsBgLoading] = useState(false);

  // 엔딩 이미지 상태
  const [isEndingImageLoading, setIsEndingImageLoading] = useState(false);

  // 단계 전환 캐릭터 이미지 상태
  const [isStageCharImgLoading, setIsStageCharImgLoading] = useState(false);
  const [stageCharImgLoadingStage, setStageCharImgLoadingStage] = useState<string | null>(null);
  const [stageCharImageIndices, setStageCharImageIndices] = useState<Record<string, number>>({});
  const [hoveredStageImg, setHoveredStageImg] = useState<string | null>(null);
  const [stageImgDeleteConfirm, setStageImgDeleteConfirm] = useState<{ stage: string; index: number } | null>(null);
  const [galleryLightbox, setGalleryLightbox] = useState<string | null>(null);
  // 이미지 세트 재생성 (표지 + AI캐릭터 + 유저캐릭터)
  const [coverImgIndex, setCoverImgIndex] = useState<number>(0);
  const [aiCharImgIndex, setAiCharImgIndex] = useState<number>(0);
  const [userCharImgIndex, setUserCharImgIndex] = useState<number>(0);
  const [charImgRegenConfirm, setCharImgRegenConfirm] = useState(false);
  const [isCharImgRegenerating, setIsCharImgRegenerating] = useState(false);
  const [charRegenStep, setCharRegenStep] = useState<string>('');
  const [isCoverImgRegenerating, setIsCoverImgRegenerating] = useState(false);
  const [coverImgRegenConfirm, setCoverImgRegenConfirm] = useState(false);
  const [coverImgDeleteConfirm, setCoverImgDeleteConfirm] = useState<number | null>(null);
  const [hoveredCoverImg, setHoveredCoverImg] = useState(false);
  const [hoveredAiCharImg, setHoveredAiCharImg] = useState(false);
  const [isAiCharImgRegenerating, setIsAiCharImgRegenerating] = useState(false);
  const [aiCharImgRegenConfirm, setAiCharImgRegenConfirm] = useState(false);
  const [aiCharImgDeleteConfirm, setAiCharImgDeleteConfirm] = useState<number | null>(null);
  const [hoveredUserCharImg, setHoveredUserCharImg] = useState(false);
  const [isUserCharImgRegenerating, setIsUserCharImgRegenerating] = useState(false);
  const [userCharImgRegenConfirm, setUserCharImgRegenConfirm] = useState(false);
  const [userCharImgDeleteConfirm, setUserCharImgDeleteConfirm] = useState<number | null>(null);
  const [endingImgIndex, setEndingImgIndex] = useState<number>(0);
  const [hoveredEndingImg, setHoveredEndingImg] = useState(false);
  const [hoveredEndingImgChat, setHoveredEndingImgChat] = useState(false);
  const [endingImgDeleteConfirm, setEndingImgDeleteConfirm] = useState<number | null>(null);
  const [lorebookDeleteConfirm, setLorebookDeleteConfirm] = useState<number | null>(null);
  const [endingImgRegenConfirm, setEndingImgRegenConfirm] = useState(false);
  const [isEndingImgRegenerating, setIsEndingImgRegenerating] = useState(false);
  // 호감도 100 특전
  const [affinityMaxOverlay, setAffinityMaxOverlay] = useState<{ scene: string } | null>(null);
  const [affinityImgIndex, setAffinityImgIndex] = useState<number>(0);
  const [hoveredAffinityImg, setHoveredAffinityImg] = useState(false);
  const [affinityImgDeleteConfirm, setAffinityImgDeleteConfirm] = useState<number | null>(null);
  const [affinityImgRegenConfirm, setAffinityImgRegenConfirm] = useState(false);
  const [isAffinityImgRegenerating, setIsAffinityImgRegenerating] = useState(false);
  const [showBgImgModal, setShowBgImgModal] = useState(false);
  const [bgImgSelectedStage, setBgImgSelectedStage] = useState<string>('기');
  const [bgImgDeleteConfirm, setBgImgDeleteConfirm] = useState<{stage: string; url: string} | null>(null);
  const [bgImgGenerateConfirm, setBgImgGenerateConfirm] = useState<{show: boolean; stage: string} | null>(null);
  const [bgImgListExpanded, setBgImgListExpanded] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // 시네마틱 상태
  const [cinematicUrl, setCinematicUrl] = useState<string | null>(null);
  const [cinematicArchive, setCinematicArchive] = useState<string[]>([]);
  const [isCinematicLoading, setIsCinematicLoading] = useState(false);
  const [showCinematicModal, setShowCinematicModal] = useState(false);
  const [showCinematicArchive, setShowCinematicArchive] = useState(false);

  // BGM 상태
  const [isBgmLoading, setIsBgmLoading] = useState(false);
  const [currentBgm, setCurrentBgm] = useState<string | null>(null);

  // BGM 플레이어 상태
  const audioRef = useRef<HTMLAudioElement>(null);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const [isBgmPlaying, setIsBgmPlaying] = useState(false);
  const [isBgmLoop, setIsBgmLoop] = useState(false);
  const [bgmProgress, setBgmProgress] = useState(0);
  const [bgmCurrentTime, setBgmCurrentTime] = useState(0);
  const [bgmDuration, setBgmDuration] = useState(0);
  const [bgmVolume, setBgmVolume] = useState(1);
  const [bgmPlaybackRate, setBgmPlaybackRate] = useState(1);
  const [bgmListExpanded, setBgmListExpanded] = useState<string | null>(null);
  const [showBgmMenu, setShowBgmMenu] = useState(false);
  const [showBgmModal, setShowBgmModal] = useState(false);
  const [showBgmSpeedMenu, setShowBgmSpeedMenu] = useState(false);
  const [selectedBgmStage, setSelectedBgmStage] = useState<string>('기');
  const [playingBgmStage, setPlayingBgmStage] = useState<string>('기');
  const [bgmGenerateConfirm, setBgmGenerateConfirm] = useState<{show: boolean; stage: string} | null>(null);
  const [bgmDeleteConfirm, setBgmDeleteConfirm] = useState<{stage: string; url: string} | null>(null);
  const [editingBgmUrl, setEditingBgmUrl] = useState<string | null>(null);
  const [editingBgmName, setEditingBgmName] = useState('');
  const bgmMenuRef = useRef<HTMLDivElement>(null);
  const bgmSpeedMenuRef = useRef<HTMLDivElement>(null);
  const genPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cinematicPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 음량 및 배속 실시간 반영
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = bgmVolume;
    }
  }, [bgmVolume]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = bgmPlaybackRate;
    }
  }, [bgmPlaybackRate]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bgmMenuRef.current && !bgmMenuRef.current.contains(event.target as Node)) {
        setShowBgmMenu(false);
      }
      if (bgmSpeedMenuRef.current && !bgmSpeedMenuRef.current.contains(event.target as Node)) {
        setShowBgmSpeedMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleBgmPlay = () => {
    if (audioRef.current) {
      if (isBgmPlaying) {
        audioRef.current.pause();
        setIsBgmPlaying(false);
      } else {
        audioRef.current.play().catch(console.error);
        setIsBgmPlaying(true);
      }
    }
  };

  const stopBgm = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsBgmPlaying(false);
    }
  };

  const handleBgmTimeUpdate = () => {
    if (audioRef.current) {
      setBgmCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration) {
        setBgmProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
      }
    }
  };

  const handleBgmProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const newTime = (Number(e.target.value) / 100) * bgmDuration;
      audioRef.current.currentTime = newTime;
      setBgmProgress(Number(e.target.value));
    }
  };

  const handleBgmVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = Number(e.target.value) / 100;
    setBgmVolume(newVol);
  };

  const toggleBgmVolume = () => {
    setBgmVolume(prev => prev > 0 ? 0 : 1);
  };

  // 재생성 관련 상태
  const [retryMessageId, setRetryMessageId] = useState<number | null>(null);
  const [retryGuidance, setRetryGuidance] = useState('');
  const [showRetryOverlay, setShowRetryOverlay] = useState(false);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState<{ show: boolean; messageId: number | null }>({ show: false, messageId: null });
  const [showModelModal, setShowModelModal] = useState(false);
  const [fullViewImage, setFullViewImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setSidebarOpen(window.innerWidth > 1024);
      setRightSidebarOpen(window.innerWidth > 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!showTokenPopup) return;
    const handler = (e: MouseEvent) => {
      if (tokenPopupRef.current && !tokenPopupRef.current.contains(e.target as Node))
        setShowTokenPopup(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTokenPopup]);

  useEffect(() => {
    loadTopics();
    loadPersonas();
  }, []);

  useEffect(() => {
    if (activeTopic && activeTab === 'summaries') loadSummaries(activeTopic.id);
  }, [activeTopic, activeTab]);

  // 앨범 탭: activeTopic 변경 시 현재 선택된 이미지 위치로 인덱스 동기화
  useEffect(() => {
    if (!activeTopic) return;
    const coverUrls: string[] = Array.isArray(activeTopic.cover_images) && activeTopic.cover_images.length > 0
      ? activeTopic.cover_images : activeTopic.cover_image ? [activeTopic.cover_image] : [];
    const coverActive = activeTopic.cover_image;
    const coverIdx = coverActive ? Math.max(0, coverUrls.lastIndexOf(coverActive)) : coverUrls.length - 1;
    setCoverImgIndex(Math.max(0, coverIdx));

    const aiUrls: string[] = Array.isArray(activeTopic.ai_character?.images) && activeTopic.ai_character.images.length > 0
      ? activeTopic.ai_character.images : activeTopic.ai_character?.image ? [activeTopic.ai_character.image] : [];
    const aiActive = activeTopic.ai_character?.image;
    const aiIdx = aiActive ? Math.max(0, aiUrls.lastIndexOf(aiActive)) : aiUrls.length - 1;
    setAiCharImgIndex(Math.max(0, aiIdx));

    const userUrls: string[] = Array.isArray(activeTopic.user_character?.images) && activeTopic.user_character.images.length > 0
      ? activeTopic.user_character.images : activeTopic.user_character?.image ? [activeTopic.user_character.image] : [];
    const userActive = activeTopic.user_character?.image;
    const userIdx = userActive ? Math.max(0, userUrls.lastIndexOf(userActive)) : userUrls.length - 1;
    setUserCharImgIndex(Math.max(0, userIdx));
  }, [activeTopic?.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, isLoading]);

  // 자동 턴: isLoading이 false가 될 때마다 남은 턴 처리
  useEffect(() => {
    if (!isLoading && autoTurnsRef.current > 0) {
      autoTurnsRef.current -= 1;
      sendAutoRef.current();
    }
  }, [isLoading]);

  // 자동 진행 메뉴: 외부 클릭 시 닫기
  useEffect(() => {
    if (!showAutoMenu) return;
    const close = () => setShowAutoMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showAutoMenu]);

  // 성향 메뉴: 외부 클릭 시 닫기
  useEffect(() => {
    if (!showToneMenu) return;
    const close = () => setShowToneMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showToneMenu]);

  const fetchSuggestedReplies = async () => {
    if (!activeTopic || isSuggestLoading || isEnded) return;
    setShowSuggestMenu(true);
    if (suggestedReplies.length > 0) return; // 캐시 있으면 재사용
    setIsSuggestLoading(true);
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/suggest-replies`);
      const data = await res.json();
      setSuggestedReplies(data.replies ?? []);
      // DT 잔액 및 사용 내역 실시간 동기화
      refreshUser();
      loadMessages(activeTopic.id);
    } catch (e) { console.error(e); }
    finally { setIsSuggestLoading(false); }
  };

  const refreshSuggestedReplies = async () => {
    if (!activeTopic || isSuggestLoading) return;
    setIsSuggestLoading(true);
    setSuggestedReplies([]);
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/suggest-replies`);
      const data = await res.json();
      setSuggestedReplies(data.replies ?? []);
      // DT 잔액 및 사용 내역 실시간 동기화
      refreshUser();
      loadMessages(activeTopic.id);
    } catch (e) { console.error(e); }
    finally { setIsSuggestLoading(false); }
  };

  // initialTopicId가 있으면 해당 토픽으로 자동 진입
  useEffect(() => {
    if (initialTopicId) {
      // 단일 토픽 엔드포인트로 전체 데이터(이미지 포함) 로드
      apiFetch(`/topics/${initialTopicId}`)
        .then(r => r.json())
        .then((topic: any) => {
          setTopics(prev => {
            const exists = prev.some(t => t.id === topic.id);
            return exists ? prev.map(t => t.id === topic.id ? topic : t) : [topic, ...prev];
          });
          selectTopic(topic);
        })
        .catch(console.error);
    }
  }, [initialTopicId]);

  useEffect(() => {
    if (!isBgLoading && !isStageCharImgLoading) setIsStageTransitioning(false);
  }, [isBgLoading, isStageCharImgLoading]);

  // 채팅방 재진입 시 진행 중인 생성 작업 복구 및 완료 감지
  useEffect(() => {
    if (!activeTopic?.id) return;
    const tid = activeTopic.id;

    const bgFlag = getGenFlag(tid, 'bg');
    const bgmFlag = getGenFlag(tid, 'bgm');
    const cinematicFlag = getGenFlag(tid, 'cinematic');
    const aiCharRegenFlag = getGenFlag(tid, 'ai_char_regen');
    const userCharRegenFlag = getGenFlag(tid, 'user_char_regen');
    const charRegenFlag = getGenFlag(tid, 'char_regen');

    if (!bgFlag && !bgmFlag && !cinematicFlag && !aiCharRegenFlag && !userCharRegenFlag && !charRegenFlag) return;

    const initialBgImages = activeTopic.background_images;
    const initialBgmUrls = activeTopic.bgm_urls;
    const initialCinematicUrl = activeTopic.cinematic_url;
    const gameStage = activeTopic.game_state?.current_stage ?? '기';
    const bgStage = bgFlag?.stage ?? gameStage;
    const bgmStage = bgmFlag?.stage ?? gameStage;
    const initialAiCharImg = aiCharRegenFlag?.initialImg ?? null;
    const initialUserCharImg = userCharRegenFlag?.initialImg ?? null;
    const initialCharAiImg = charRegenFlag?.initialAiImg ?? null;
    const initialCharUserImg = charRegenFlag?.initialUserImg ?? null;
    const initialCharCoverImg = charRegenFlag?.initialCoverImg ?? null;

    if (bgFlag) setIsBgLoading(true);
    if (bgmFlag) setIsBgmLoading(true);
    if (cinematicFlag) setIsCinematicLoading(true);
    if (aiCharRegenFlag) setIsAiCharImgRegenerating(true);
    if (userCharRegenFlag) setIsUserCharImgRegenerating(true);
    if (charRegenFlag) { setIsCharImgRegenerating(true); setCharRegenStep('이미지 생성 중...'); }

    if (genPollRef.current) clearInterval(genPollRef.current);

    genPollRef.current = setInterval(async () => {
      const bgPending = getGenFlag(tid, 'bg');
      const bgmPending = getGenFlag(tid, 'bgm');
      const cinematicPending = getGenFlag(tid, 'cinematic');
      const aiCharRegenPending = getGenFlag(tid, 'ai_char_regen');
      const userCharRegenPending = getGenFlag(tid, 'user_char_regen');
      const charRegenPending = getGenFlag(tid, 'char_regen');

      if (!bgPending && !bgmPending && !cinematicPending && !aiCharRegenPending && !userCharRegenPending && !charRegenPending) {
        clearInterval(genPollRef.current!);
        genPollRef.current = null;
        return;
      }

      try {
        const res = await apiFetch(`/topics/${tid}`);
        if (!res.ok) return;
        const topic = await res.json();

        if (bgPending) {
          const newUrl = getActiveBackgroundStatic(topic.background_images, bgStage);
          const oldUrl = getActiveBackgroundStatic(initialBgImages, bgStage);
          if (newUrl && newUrl !== oldUrl) {
            setActiveTopic((prev: any) => prev ? { ...prev, background_images: topic.background_images } : prev);
            if (bgStage === gameStage) setChatBackground(newUrl);
            clearGenFlag(tid, 'bg');
            setIsBgLoading(false);
          }
        }

        if (bgmPending) {
          const stage = bgmStage;
          const newTrack = topic.bgm_urls?.active?.[stage] ||
            (Array.isArray(topic.bgm_urls?.[stage]) ? topic.bgm_urls[stage][topic.bgm_urls[stage].length - 1] : null);
          const oldTrack = initialBgmUrls?.active?.[stage] ||
            (Array.isArray(initialBgmUrls?.[stage]) ? initialBgmUrls[stage][0] : null);
          if (newTrack && newTrack !== oldTrack) {
            setActiveTopic((prev: any) => prev ? { ...prev, bgm_urls: topic.bgm_urls } : prev);
            setCurrentBgm(newTrack);
            setPlayingBgmStage(stage);
            setIsBgmPlaying(false);
            clearGenFlag(tid, 'bgm');
            setIsBgmLoading(false);
          }
        }

        if (cinematicPending) {
          if (topic.cinematic_url && topic.cinematic_url !== initialCinematicUrl) {
            setCinematicUrl(topic.cinematic_url);
            setCinematicArchive(topic.cinematic_urls ?? []);
            setActiveTopic((prev: any) => prev ? { ...prev, cinematic_url: topic.cinematic_url, cinematic_urls: topic.cinematic_urls ?? [] } : prev);
            clearGenFlag(tid, 'cinematic');
            setIsCinematicLoading(false);
          }
        }

        if (aiCharRegenPending) {
          if (topic.ai_character?.image && topic.ai_character.image !== initialAiCharImg) {
            setActiveTopic((prev: any) => prev ? {
              ...prev,
              ai_character: { ...prev.ai_character, image: topic.ai_character.image, images: topic.ai_character.images ?? [topic.ai_character.image] },
            } : prev);
            setAiCharImgIndex((topic.ai_character.images?.length ?? 1) - 1);
            clearGenFlag(tid, 'ai_char_regen');
            setIsAiCharImgRegenerating(false);
          }
        }

        if (userCharRegenPending) {
          if (topic.user_character?.image && topic.user_character.image !== initialUserCharImg) {
            setActiveTopic((prev: any) => prev ? {
              ...prev,
              user_character: { ...prev.user_character, image: topic.user_character.image, images: topic.user_character.images ?? [topic.user_character.image] },
            } : prev);
            setUserCharImgIndex((topic.user_character.images?.length ?? 1) - 1);
            clearGenFlag(tid, 'user_char_regen');
            setIsUserCharImgRegenerating(false);
          }
        }

        if (charRegenPending) {
          const aiDone = topic.ai_character?.image && topic.ai_character.image !== initialCharAiImg;
          const userDone = topic.user_character?.image && topic.user_character.image !== initialCharUserImg;
          const coverDone = topic.cover_image && topic.cover_image !== initialCharCoverImg;
          if (aiDone) {
            setActiveTopic((prev: any) => prev ? {
              ...prev,
              ai_character: { ...prev.ai_character, image: topic.ai_character.image, images: topic.ai_character.images ?? [topic.ai_character.image] },
            } : prev);
            setAiCharImgIndex((topic.ai_character.images?.length ?? 1) - 1);
          }
          if (userDone) {
            setActiveTopic((prev: any) => prev ? {
              ...prev,
              user_character: { ...prev.user_character, image: topic.user_character.image, images: topic.user_character.images ?? [topic.user_character.image] },
            } : prev);
            setUserCharImgIndex((topic.user_character.images?.length ?? 1) - 1);
          }
          if (coverDone) {
            setActiveTopic((prev: any) => prev ? {
              ...prev,
              cover_image: topic.cover_image,
              cover_images: topic.cover_images ?? [topic.cover_image],
            } : prev);
            setCoverImgIndex((topic.cover_images?.length ?? 1) - 1);
          }
          if (aiDone && userDone && coverDone) {
            clearGenFlag(tid, 'char_regen');
            setIsCharImgRegenerating(false);
            setCharRegenStep('');
          }
        }
      } catch (e) {
        console.error('Generation poll error:', e);
      }
    }, 5000);

    return () => {
      if (genPollRef.current) { clearInterval(genPollRef.current); genPollRef.current = null; }
      if (cinematicPollRef.current) { clearInterval(cinematicPollRef.current); cinematicPollRef.current = null; }
    };
  }, [activeTopic?.id]);

  // initialPersona가 있으면 페르소나 자동 생성
  useEffect(() => {
    if (initialPersona && initialPersona.name && initialTopicId) {
      const desc = [
        initialPersona.personality && `성격: ${initialPersona.personality}`,
        initialPersona.background && `배경: ${initialPersona.background}`,
        initialPersona.appearance && `외형: ${initialPersona.appearance}`,
      ].filter(Boolean).join(', ');

      apiFetch('/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: initialPersona.name, description: desc }),
      })
        .then(r => r.json())
        .then(newP => {
          setPersonas(prev => [...prev, newP]);
          if (initialTopicId) {
            apiFetch(`/topics/${initialTopicId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active_persona_id: newP.id }),
            });
          }
        })
        .catch(console.error);
    }
  }, [initialPersona, initialTopicId]);

  const loadTopics = async () => {
    try {
      const res = await apiFetch('/topics');
      const data = await res.json();
      setTopics(data);
      // 이미 activeTopic이 있거나 initialTopicId가 있는 경우 자동 선택 방지
      if (!initialTopicId && data.length > 0 && !activeTopic) selectTopic(data[0]);
    } catch (e) { console.error(e); }
  };

  const loadPersonas = async () => {
    try {
      const res = await apiFetch('/personas');
      setPersonas(await res.json());
    } catch (e) { console.error(e); }
  };

  const loadSummaries = async (topicId: number, scrollToTop = false) => {
    try {
      const res = await apiFetch(`/summaries/${topicId}`);
      setSummaries(await res.json());
      if (scrollToTop) {
        setTimeout(() => {
          sidebarScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        }, 50);
      }
    } catch (e) { console.error(e); }
  };

  const loadRelationGraph = async (topicId: number) => {
    try {
      const res = await apiFetch(`/topics/${topicId}/relationship-graph`);
      const data = await res.json();
      setRelationGraph(data.graph);
    } catch (e) { console.error(e); }
  };

  const refreshRelationGraph = async () => {
    if (!activeTopic || isGraphRefreshing) return;
    setIsGraphRefreshing(true);
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/relationship-graph/refresh`, { method: 'POST' });
      const data = await res.json();
      setRelationGraph(data.graph);
      // 상단 보유 DT 잔액 및 소모 내역 동기화
      refreshUser();
      loadMessages(activeTopic.id);
    } catch (e) { console.error(e); }
    finally { setIsGraphRefreshing(false); }
  };

  const loadLorebook = async (topicId: number) => {
    try {
      const res = await apiFetch(`/topics/${topicId}/lorebook`);
      const data = await res.json();
      setLorebookEntries(data.entries || []);
    } catch (e) { console.error(e); }
  };

  const addLorebookEntry = async () => {
    if (!activeTopic || !lorebookForm.keyword.trim() || !lorebookForm.content.trim()) return;
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/lorebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lorebookForm),
      });
      const data = await res.json();
      setLorebookEntries(data.entries);
      setLorebookForm({ keyword: '', content: '', category: 'place' });
      setLorebookAddSection(null);
    } catch (e) { console.error(e); }
  };

  const addCharacterEntry = async () => {
    if (!activeTopic || !addCharForm.name.trim()) return;
    const content = addCharForm.notes.trim();
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/lorebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: addCharForm.name, content, category: 'character' }),
      });
      const data = await res.json();
      setLorebookEntries(data.entries);
      const newChar = {
        name: addCharForm.name,
        role: addCharForm.role,
        gender: addCharForm.gender,
        age: addCharForm.age,
        personality: addCharForm.personality,
        appearance: addCharForm.appearance,
        background: addCharForm.background,
        importance: '조연',
      };
      const updatedCast = [...(activeTopic.supporting_cast ?? []), newChar];
      await apiFetch(`/topics/${activeTopic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supporting_cast: updatedCast }),
      });
      setTopics(prev => prev.map(t => t.id === activeTopic.id ? { ...t, supporting_cast: updatedCast } : t));
      setActiveTopic((prev: any) => prev ? { ...prev, supporting_cast: updatedCast } : prev);
      setAddCharForm({ name: '', role: '', gender: '', age: '', personality: '', appearance: '', background: '', notes: '' });
      setLorebookAddSection(null);
    } catch (e) { console.error(e); }
  };

  const updateLorebookEntry = async (index: number) => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/lorebook/${index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editLorebookForm),
      });
      const data = await res.json();
      setLorebookEntries(data.entries);

      if (editLorebookForm.category === 'character' && editCharInfo) {
        const keyword = editLorebookForm.keyword;
        const aiName = (activeTopic.ai_character ?? {}).name;
        const userName = (activeTopic.user_character ?? {}).name;
        const charPatch: Record<string, any> = {};
        if (aiName && keyword === aiName) {
          charPatch.ai_character = { ...(activeTopic.ai_character ?? {}), ...editCharInfo };
        } else if (userName && keyword === userName) {
          charPatch.user_character = { ...(activeTopic.user_character ?? {}), ...editCharInfo };
        } else {
          const cast = (activeTopic.supporting_cast ?? []).map((c: any) =>
            c.name === keyword ? { ...c, ...editCharInfo } : c
          );
          charPatch.supporting_cast = cast;
        }
        await apiFetch(`/topics/${activeTopic.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(charPatch),
        });
        setTopics(prev => prev.map(t => t.id === activeTopic.id ? { ...t, ...charPatch } : t));
        setActiveTopic((prev: any) => prev ? { ...prev, ...charPatch } : prev);
      }

      setEditingLorebookIndex(null);
      setEditCharInfo(null);
    } catch (e) { console.error(e); }
  };

  const deleteLorebookEntry = async (index: number) => {
    if (!activeTopic) return;
    const entry = lorebookEntries[index];
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/lorebook/${index}`, { method: 'DELETE' });
      const data = await res.json();
      setLorebookEntries(data.entries);

      if (entry?.category === 'character') {
        const keyword = entry.keyword;
        const aiName = (activeTopic.ai_character ?? {}).name;
        const userName = (activeTopic.user_character ?? {}).name;
        if (keyword !== aiName && keyword !== userName) {
          const updatedCast = (activeTopic.supporting_cast ?? []).filter((c: any) => c.name !== keyword);
          await apiFetch(`/topics/${activeTopic.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ supporting_cast: updatedCast }),
          });
          setTopics(prev => prev.map(t => t.id === activeTopic.id ? { ...t, supporting_cast: updatedCast } : t));
          setActiveTopic((prev: any) => prev ? { ...prev, supporting_cast: updatedCast } : prev);
        }
      }
    } catch (e) { console.error(e); }
  };

  const fetchTokenEstimate = async () => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch(`/token-estimate/${activeTopic.id}`);
      setTokenEstimate(await res.json());
    } catch (e) { console.error(e); }
  };

  const estimateInputTokens = (text: string) => Math.ceil(text.length / 2.5);

  const getDiceIcon = (n: number, size = 13) => {
    const icons = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];
    const Icon = icons[(n - 1) % 6] ?? Dices;
    return <Icon size={size} />;
  };

  const selectTopic = async (topic: any) => {
    if (!topic) return;
    setIsLoading(true);
    try {
      // 목록에서는 최소한의 데이터만 가져오므로, 선택 시 전체 데이터를 다시 로드
      const res = await apiFetch(`/topics/${topic.id}`);
      const fullTopic = await res.json();

      // DB에 이미지가 없으면 메모리에서 캡처한 이미지로 보완
      const aiChar = fullTopic.ai_character
        ? { ...fullTopic.ai_character, image: fullTopic.ai_character.image || initialCharacterImages?.ai_image || null }
        : fullTopic.ai_character;
      const userChar = fullTopic.user_character
        ? { ...fullTopic.user_character, image: fullTopic.user_character.image || initialCharacterImages?.user_image || null }
        : fullTopic.user_character;
      
      const enriched = {
        ...fullTopic,
        ai_character: aiChar,
        user_character: userChar,
        supporting_affinities: fullTopic.game_state?.supporting_affinities ?? {},
      };

      setActiveTopic(enriched);
      loadMessages(fullTopic.id, fullTopic.ending_image ?? null, fullTopic.stage_character_images ?? null);
      loadLorebook(fullTopic.id);
      loadRelationGraph(fullTopic.id);

      const savedModel = localStorage.getItem(`dive_chat_model_${fullTopic.id}`);
      if (savedModel) setModel(savedModel);

      const endingUrls: string[] = Array.isArray(fullTopic.ending_images) ? fullTopic.ending_images
        : fullTopic.ending_image ? [fullTopic.ending_image] : [];
      setEndingImgIndex(endingUrls.length > 0 ? endingUrls.length - 1 : 0);

      const affinityUrls: string[] = Array.isArray(fullTopic.affinity_images) ? fullTopic.affinity_images
        : fullTopic.affinity_image ? [fullTopic.affinity_image] : [];
      setAffinityImgIndex(affinityUrls.length > 0 ? affinityUrls.length - 1 : 0);
      
      setUserNotes(fullTopic.user_notes || '');
      setTone(fullTopic.tone_preference || '');
      setNotePresets(fullTopic.user_note_presets || []);
      setShowNoteForm(false);
      setEditingNoteId(null);
      setHintCard(null);
      setEndingData(null);
      setCurrentStage(fullTopic.game_state?.current_stage ?? null);
      
      const loadedThoughts: Record<string, string> = fullTopic.inner_thoughts ?? {};
      if (fullTopic.inner_thought && fullTopic.ai_character?.name && !loadedThoughts[fullTopic.ai_character.name]) {
        loadedThoughts[fullTopic.ai_character.name] = fullTopic.inner_thought;
      }
      setInnerThoughts(loadedThoughts);
      setSelectedInnerChar(fullTopic.ai_character?.name ?? '');
      setExpandedChars(new Set());

      // 시네마틱 영상 로드
      setCinematicUrl(fullTopic.cinematic_url ?? null);
      setCinematicArchive(fullTopic.cinematic_urls ?? []);

      // BGM 자동 로드: bgm_urls가 있으면 사운드바 노출
      const bgmUrls = fullTopic.bgm_urls;
      const gameStage = fullTopic.game_state?.current_stage ?? '기';
      if (bgmUrls) {
        const stageOrder: string[] = ['기', '승', '전', '결'];
        let foundUrl: string | null = null;
        let foundStage: string = gameStage;
        // 현재 단계의 active URL 우선
        if (bgmUrls.active?.[gameStage]) {
          foundUrl = bgmUrls.active[gameStage];
          foundStage = gameStage;
        } else {
          for (const s of stageOrder) {
            if (bgmUrls.active?.[s]) {
              foundUrl = bgmUrls.active[s]; foundStage = s; break;
            }
            const tracks = Array.isArray(bgmUrls[s]) ? bgmUrls[s] : (typeof bgmUrls[s] === 'string' ? [bgmUrls[s]] : []);
            if (tracks.length > 0) {
              foundUrl = tracks[0]; foundStage = s; break;
            }
          }
        }
        if (foundUrl) {
          setCurrentBgm(foundUrl);
          setPlayingBgmStage(foundStage);
          setIsBgmPlaying(false);
        } else {
          setCurrentBgm(null);
        }
      } else {
        setCurrentBgm(null);
      }

      // 배경 이미지 로드 (신규: {active:{기:url}, 기:[url,...]} / 구형: {기:url})
      const existingBg = getActiveBackground(fullTopic.background_images, gameStage);
      setChatBackground(existingBg);

      // 기 단계 배경 없으면 자동 생성 (대화 시작 시점)
      if (!existingBg && gameStage === '기') {
        generateStageImages('기', fullTopic.id);
      }
    } catch (e) {
      console.error("Topic detail load error:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const getActiveBackground = (bgImages: any, stage: string): string | null => {
    if (!bgImages) return null;
    // active[stage]가 명시적으로 설정된 경우 (null 포함) 우선 적용
    if (bgImages.active && Object.prototype.hasOwnProperty.call(bgImages.active, stage)) {
      return bgImages.active[stage] ?? null; // null이면 "배경 없음"
    }
    const val = bgImages[stage];
    if (typeof val === 'string') return val;
    if (Array.isArray(val) && val.length > 0) return val[0];
    return null;
  };

  // 분기 이미지 재생성 전용 (캐릭터 이미지만, 배경 건드리지 않음)
  const regenerateStageCharImage = async (stage: string) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    setIsStageCharImgLoading(true);
    setStageCharImgLoadingStage(stage);
    try {
      const charRes = await apiFetch(
        `/topics/${tid}/generate-stage-character?stage=${encodeURIComponent(stage)}`,
        { method: 'POST' }
      );
      if (charRes.ok) {
        const charData = await charRes.json();
        if (charData.url) {
          const newUrls: string[] = charData.urls ?? [charData.url];
          setActiveTopic((prev: any) => prev ? {
            ...prev,
            stage_character_images: { ...(prev.stage_character_images || {}), [stage]: newUrls },
          } : prev);
          setStageCharImageIndices(prev => ({ ...prev, [stage]: newUrls.length - 1 }));
          setMessages(prev => prev.map(m =>
            m.is_stage_opening && m.stage === stage
              ? { ...m, stage_char_image_url: charData.url }
              : m
          ));
        }
      }
    } catch {}
    setIsStageCharImgLoading(false);
    setStageCharImgLoadingStage(null);
  };

  const setActiveAiCharImage = async (url: string) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    try {
      const res = await apiFetch(`/topics/${tid}/set-active-ai-character-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        setActiveTopic((prev: any) => prev ? {
          ...prev, ai_character: { ...prev.ai_character, image: url },
        } : prev);
      }
    } catch {}
  };

  const setActiveUserCharImage = async (url: string) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    try {
      const res = await apiFetch(`/topics/${tid}/set-active-user-character-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        setActiveTopic((prev: any) => prev ? {
          ...prev, user_character: { ...prev.user_character, image: url },
        } : prev);
      }
    } catch {}
  };

  const setActiveCoverImage = async (url: string) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    try {
      const res = await apiFetch(`/topics/${tid}/set-active-cover-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        setActiveTopic((prev: any) => prev ? { ...prev, cover_image: url } : prev);
      }
    } catch {}
  };

  const regenerateCoverImage = async () => {
    const tid = activeTopic?.id;
    if (!tid) return;
    setIsCoverImgRegenerating(true);
    try {
      const res = await apiFetch(`/topics/${tid}/generate-cover-image`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          const newUrls: string[] = data.urls ?? [data.url];
          setActiveTopic((prev: any) => prev ? { ...prev, cover_image: data.url, cover_images: newUrls } : prev);
          setCoverImgIndex(newUrls.length - 1);
        }
      }
    } catch {}
    setIsCoverImgRegenerating(false);
  };

  const deleteCoverImage = async (index: number) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    try {
      const res = await apiFetch(`/topics/${tid}/cover-image?index=${index}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        const remaining: string[] = data.remaining ?? [];
        setActiveTopic((prev: any) => prev ? {
          ...prev,
          cover_image: remaining.length > 0 ? remaining[remaining.length - 1] : null,
          cover_images: remaining,
        } : prev);
        setCoverImgIndex(Math.max(0, Math.min(coverImgIndex, remaining.length - 1)));
      }
    } catch {}
    setCoverImgDeleteConfirm(null);
  };

  const handleReplay = async () => {
    if (!activeTopic?.id) return;
    setIsReplaying(true);
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_length: replayLength }),
      });
      const data = await res.json();
      if (data.topic_id) {
        setShowReplayModal(false);
        onSelectTopic?.(data.topic_id);
      }
    } catch (e) { console.error(e); }
    finally { setIsReplaying(false); }
  };

  const regenerateAiCharImage = async () => {
    const tid = activeTopic?.id;
    if (!tid) return;
    setIsAiCharImgRegenerating(true);
    setGenFlag(tid, 'ai_char_regen', { initialImg: activeTopic.ai_character?.image ?? null });
    try {
      const res = await apiFetch(`/topics/${tid}/regenerate-ai-character-image`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          setActiveTopic((prev: any) => prev ? {
            ...prev,
            ai_character: { ...prev.ai_character, image: data.url, images: data.images },
          } : prev);
          setAiCharImgIndex(data.images.length - 1);
        }
      }
    } catch {}
    clearGenFlag(tid, 'ai_char_regen');
    setIsAiCharImgRegenerating(false);
  };

  const deleteAiCharImage = async (index: number) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    try {
      const res = await apiFetch(`/topics/${tid}/ai-character-image?index=${index}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        const remaining: string[] = data.remaining ?? [];
        setActiveTopic((prev: any) => prev ? {
          ...prev,
          ai_character: { ...prev.ai_character, image: remaining.length > 0 ? remaining[remaining.length - 1] : null, images: remaining },
        } : prev);
        setAiCharImgIndex(Math.max(0, Math.min(aiCharImgIndex, remaining.length - 1)));
      }
    } catch {}
    setAiCharImgDeleteConfirm(null);
  };

  const regenerateUserCharImage = async () => {
    const tid = activeTopic?.id;
    if (!tid) return;
    setIsUserCharImgRegenerating(true);
    setGenFlag(tid, 'user_char_regen', { initialImg: activeTopic.user_character?.image ?? null });
    try {
      const res = await apiFetch(`/topics/${tid}/regenerate-user-character-image`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          setActiveTopic((prev: any) => prev ? {
            ...prev,
            user_character: { ...prev.user_character, image: data.url, images: data.images },
          } : prev);
          setUserCharImgIndex(data.images.length - 1);
        }
      }
    } catch {}
    clearGenFlag(tid, 'user_char_regen');
    setIsUserCharImgRegenerating(false);
  };

  const deleteUserCharImage = async (index: number) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    try {
      const res = await apiFetch(`/topics/${tid}/user-character-image?index=${index}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        const remaining: string[] = data.remaining ?? [];
        setActiveTopic((prev: any) => prev ? {
          ...prev,
          user_character: { ...prev.user_character, image: remaining.length > 0 ? remaining[remaining.length - 1] : null, images: remaining },
        } : prev);
        setUserCharImgIndex(Math.max(0, Math.min(userCharImgIndex, remaining.length - 1)));
      }
    } catch {}
    setUserCharImgDeleteConfirm(null);
  };

  const regenerateCharacterImages = async () => {
    const tid = activeTopic?.id;
    if (!tid) return;
    setIsCharImgRegenerating(true);
    setCharRegenStep('준비 중...');
    setGenFlag(tid, 'char_regen', {
      initialAiImg: activeTopic.ai_character?.image ?? null,
      initialUserImg: activeTopic.user_character?.image ?? null,
      initialCoverImg: activeTopic.cover_image ?? null,
    });
    try {
      const res = await apiFetch(`/topics/${tid}/regenerate-character-images`, { method: 'POST' });
      if (!res.ok || !res.body) throw new Error('요청 실패');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(part.slice(6));
            if (data.message) setCharRegenStep(data.message);
            if (data.ai_url) {
              setActiveTopic((prev: any) => prev ? {
                ...prev,
                ai_character: { ...prev.ai_character, image: data.ai_url, images: data.ai_images },
              } : prev);
              setAiCharImgIndex((data.ai_images?.length ?? 1) - 1);
            }
            if (data.user_url) {
              setActiveTopic((prev: any) => prev ? {
                ...prev,
                user_character: { ...prev.user_character, image: data.user_url, images: data.user_images },
              } : prev);
              setUserCharImgIndex((data.user_images?.length ?? 1) - 1);
            }
            if (data.cover_url) {
              setActiveTopic((prev: any) => prev ? {
                ...prev,
                cover_image: data.cover_url,
                cover_images: data.cover_images,
              } : prev);
              setCoverImgIndex((data.cover_images?.length ?? 1) - 1);
            }
          } catch {}
        }
      }
    } catch {}
    clearGenFlag(tid, 'char_regen');
    setIsCharImgRegenerating(false);
    setCharRegenStep('');
  };

  const regenerateEndingImage = async () => {
    const tid = activeTopic?.id;
    if (!tid) return;
    setIsEndingImgRegenerating(true);
    try {
      const res = await apiFetch(`/topics/${tid}/generate-ending-image`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          const newUrls: string[] = data.urls ?? [data.url];
          setActiveTopic((prev: any) => prev ? { ...prev, ending_image: data.url, ending_images: newUrls } : prev);
          setEndingImgIndex(newUrls.length - 1);
          setMessages(prev => prev.map(m => m.is_ending ? { ...m, ending_image_url: data.url } : m));
        }
      }
    } catch {}
    setIsEndingImgRegenerating(false);
  };

  const deleteEndingImage = async (index: number) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    try {
      const res = await apiFetch(`/topics/${tid}/ending-image?index=${index}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        const remaining: string[] = data.remaining ?? [];
        setActiveTopic((prev: any) => prev ? {
          ...prev,
          ending_image: remaining.length > 0 ? remaining[remaining.length - 1] : null,
          ending_images: remaining,
        } : prev);
        setEndingImgIndex(Math.max(0, Math.min(endingImgIndex, remaining.length - 1)));
        if (remaining.length > 0) {
          setMessages(prev => prev.map(m => m.is_ending ? { ...m, ending_image_url: remaining[remaining.length - 1] } : m));
        }
      }
    } catch {}
    setEndingImgDeleteConfirm(null);
  };

  const regenAffinityImage = async () => {
    const tid = activeTopic?.id;
    if (!tid) return;
    setIsAffinityImgRegenerating(true);
    try {
      const res = await apiFetch(`/topics/${tid}/generate-affinity-image`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          const newUrls: string[] = data.urls ?? [data.url];
          setActiveTopic((prev: any) => prev ? { ...prev, affinity_image: data.url, affinity_images: newUrls } : prev);
          setAffinityImgIndex(newUrls.length - 1);
        }
      }
    } catch {}
    setIsAffinityImgRegenerating(false);
  };

  const deleteAffinityImage = async (index: number) => {
    const tid = activeTopic?.id;
    if (!tid) return;
    try {
      const res = await apiFetch(`/topics/${tid}/affinity-image?index=${index}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        const remaining: string[] = data.remaining ?? [];
        setActiveTopic((prev: any) => prev ? {
          ...prev,
          affinity_image: remaining.length > 0 ? remaining[remaining.length - 1] : null,
          affinity_images: remaining,
        } : prev);
        setAffinityImgIndex(Math.max(0, Math.min(affinityImgIndex, remaining.length - 1)));
      }
    } catch {}
    setAffinityImgDeleteConfirm(null);
  };

  // 단계 전환 시 배경→캐릭터 이미지 순차 생성 (30초 간격으로 429 방지)
  const generateStageImages = async (stage: string, topicId?: number) => {
    const tid = topicId ?? activeTopic?.id;
    if (!tid) return;

    // Step 1: 배경 이미지
    setIsBgLoading(true);
    setGenFlag(tid, 'bg', { stage });
    try {
      const bgRes = await apiFetch(
        `/topics/${tid}/generate-background?stage=${encodeURIComponent(stage)}`,
        { method: 'POST' }
      );
      if (bgRes.ok) {
        const bgData = await bgRes.json();
        if (bgData.url) {
          if (bgData.background_images) {
            setActiveTopic((prev: any) => prev ? { ...prev, background_images: bgData.background_images } : prev);
          }
          await new Promise<void>(resolve => {
            const img = new Image();
            img.onload = () => { setChatBackground(bgData.url); resolve(); };
            img.onerror = () => resolve();
            img.src = bgData.url;
          });
        }
      }
    } catch {}
    clearGenFlag(tid, 'bg');
    setIsBgLoading(false);

    // Step 2: 30초 대기 후 캐릭터 이미지
    setIsStageCharImgLoading(true);
    setStageCharImgLoadingStage(stage);
    await new Promise(resolve => setTimeout(resolve, 30000));

    try {
      const charRes = await apiFetch(
        `/topics/${tid}/generate-stage-character?stage=${encodeURIComponent(stage)}`,
        { method: 'POST' }
      );
      if (charRes.ok) {
        const charData = await charRes.json();
        if (charData.url) {
          const newUrls: string[] = charData.urls ?? [charData.url];
          setActiveTopic((prev: any) => prev ? {
            ...prev,
            stage_character_images: { ...(prev.stage_character_images || {}), [stage]: newUrls },
          } : prev);
          const newIndex = newUrls.length - 1;
          setStageCharImageIndices(prev => ({ ...prev, [stage]: newIndex }));
          setMessages(prev => prev.map(m =>
            m.is_stage_opening && m.stage === stage
              ? { ...m, stage_char_image_url: charData.url }
              : m
          ));
        }
      }
    } catch {}
    setIsStageCharImgLoading(false);
    setStageCharImgLoadingStage(null);
  };

  const generateStageBackground = async (stage: string, topicId?: number) => {
    const tid = topicId ?? activeTopic?.id;
    if (!tid) return;
    setIsBgLoading(true);
    setGenFlag(tid, 'bg', { stage });
    try {
      const res = await apiFetch(
        `/topics/${tid}/generate-background?stage=${encodeURIComponent(stage)}`,
        { method: 'POST' }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          if (data.background_images) {
            setActiveTopic((prev: any) => prev ? { ...prev, background_images: data.background_images } : prev);
          }
          const img = new Image();
          img.onload = () => {
            const gameStage = activeTopic?.game_state?.current_stage ?? '기';
            if (stage === gameStage) setChatBackground(data.url);
            clearGenFlag(tid, 'bg');
            setIsBgLoading(false);
          };
          img.onerror = () => { clearGenFlag(tid, 'bg'); setIsBgLoading(false); };
          img.src = data.url;
        } else {
          clearGenFlag(tid, 'bg');
          setIsBgLoading(false);
        }
      } else {
        clearGenFlag(tid, 'bg');
        setIsBgLoading(false);
      }
    } catch {
      clearGenFlag(tid, 'bg');
      setIsBgLoading(false);
    }
  };

  const selectBackground = async (stage: string, url: string) => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch('/chat/select-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: activeTopic.id, stage, image_url: url }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.background_images) {
        setActiveTopic((prev: any) => prev ? { ...prev, background_images: data.background_images } : prev);
      }
      setChatBackground(url);
    } catch (e) { console.error(e); }
  };

  const clearBackground = async (stage: string) => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch('/chat/clear-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: activeTopic.id, stage, image_url: null }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.background_images) {
        setActiveTopic((prev: any) => prev ? { ...prev, background_images: data.background_images } : prev);
      }
      setChatBackground(null);
    } catch (e) { console.error(e); }
  };

  const deleteBackground = async (stage: string, url: string) => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch('/chat/delete-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: activeTopic.id, stage, image_url: url }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.background_images) {
        setActiveTopic((prev: any) => prev ? { ...prev, background_images: data.background_images } : prev);
        // 삭제된 이미지가 현재 배경이면 새 active 이미지로 교체 (없으면 null)
        if (chatBackground === url) {
          const gameStage = activeTopic.game_state?.current_stage ?? '기';
          setChatBackground(getActiveBackground(data.background_images, gameStage));
        }
      }
    } catch (e) { console.error(e); }
  };

  const loadMessages = async (topicId: number, endingImageUrl?: string | null, stageCharImages?: Record<string, string | string[]> | null) => {
    try {
      const res = await apiFetch(`/messages/${topicId}`);
      const data = await res.json();
      
      // 1. 전체 메시지 기록 (사용량 합산용)
      const allMsgs = data.map((m: any) => ({
        id: m.id, role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        model_name: m.model_name,
        spent_dt: m.spent_dt ?? 0,
        is_active: m.is_active,
        parent_id: m.parent_id,
        version: m.version,
        max_version: m.max_version,
      }));
      setAllMessagesForUsage(allMsgs);

      // 2. 활성 메시지만 필터링 (화면 출력용)
      const mapped = data.filter((m: any) => m.is_active).map((m: any) => ({
        id: m.id, role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        situation: m.situation || null,
        suggested_actions: m.suggested_actions || [],
        is_stage_opening: m.is_stage_opening || false,
        stage: m.stage || null,
        is_ending: m.is_ending || false,
        ending_type: m.ending_type || null,
        ending_affinity: m.ending_affinity ?? 0,
        ending_image_url: m.is_ending ? (endingImageUrl ?? null) : null,
        stage_char_image_url: (m.is_stage_opening && m.stage && stageCharImages) ? (() => {
          const v = stageCharImages[m.stage];
          if (!v) return null;
          if (Array.isArray(v)) return v[v.length - 1] ?? null;
          return v;
        })() : null,
        is_supporting: m.is_supporting || false,
        speaker_name: m.speaker_name || null,
        parent_id: m.parent_id,
        version: m.version,
        max_version: m.max_version,
        model_name: m.model_name,
        spent_dt: m.spent_dt ?? 0,
      }));

      if (mapped.length === 0) {
        setMessages([]);
        setShowOpeningButton(true);
      } else {
        setMessages(mapped);
        setShowOpeningButton(false);
        setIsEnded(mapped.some((m: any) => m.is_ending));
      }
    } catch (e) { setMessages([]); }
  };

  const startOpening = async () => {
    if (!activeTopic) return;
    setShowOpeningButton(false);
    setIsLoading(true);
    const controller = new AbortController();
    openingAbortRef.current = controller;
    try {
      const openingRes = await apiFetch(`/topics/${activeTopic.id}/opening`, { method: 'POST', signal: controller.signal });
      const od = await openingRes.json();
      if (od.reply) setMessages([{ role: 'assistant', content: od.reply }]);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setMessages([]);
    } finally {
      openingAbortRef.current = null;
      setIsLoading(false);
    }
  };

  // ── 스트리밍 메시지 전송 ──────────────────────────────────────────────────
  const sendMessage = async (textOverride?: string, skipLoadingCheck = false, autoAdvance = false, guidance?: string, isRegeneration = false, replyType?: string) => {
    const textToSend = autoAdvance ? (textOverride || '(계속 진행해줘)') : (textOverride || input);
    if (!autoAdvance && !textToSend.trim()) return;
    if (!activeTopic || (!skipLoadingCheck && isLoading)) return;
    if (autoAdvance && isEnded) return;

    let userActionReceived = false;
    if (!autoAdvance && !isRegeneration) {
      setMessages(prev => [...prev, { role: 'user', content: textToSend }]);
    }
    setInput('');
    setIsLoading(true);
    setStreamingText('');
    setHintCard(null);

    // !요약 / !설정 은 기존 /chat 엔드포인트 사용
    if (textToSend === '!요약' || textToSend.startsWith('!설정')) {
      try {
        const res = await apiFetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_message: textToSend,
            topic_id: activeTopic.id,
            model_selection: model,
            character_name: activeTopic.character_name || 'AI 캐릭터',
            guidance: guidance,
            is_regeneration: isRegeneration,
          }),
        });
        const data = await res.json();
        if (data.event === 'SUMMARY_COMPLETE') {
          setSummaryNotif({ show: true, success: true, text: data.summary || '' });
          loadSummaries(activeTopic.id, true);
          // 소모 내역 실시간 동기화
          loadMessages(activeTopic.id);
          refreshUser();
        } else if (data.event === 'SUMMARY_FAILED') {
          setSummaryNotif({ show: true, success: false, text: '요약 생성 실패' });
        } else {
          setMessages(prev => [...prev, { role: 'assistant', situation: data.situation, content: data.reply, suggested_actions: data.suggested_actions }]);
        }
      } catch (e) {
        setMessages(prev => [...prev, { role: 'assistant', content: '오류가 발생했습니다.' }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 일반 대화 — 스트리밍
    try {
      const response = await apiFetch('/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_message: textToSend,
          topic_id: activeTopic.id,
          model_selection: model,
          character_name: activeTopic.character_name || 'AI 캐릭터',
          dice_roll: diceRoll,
          auto_advance: autoAdvance,
          guidance: guidance,
          is_regeneration: isRegeneration,
          reply_type: replyType,
        }),
      });
      setDiceRoll(null);

      if (!response.body) throw new Error('스트리밍 불가');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'stage_transition') {
              setIsStageTransitioning(true);
            } else if (data.type === 'ending_image_loading') {
              setIsEndingLoading(true);
            } else if (data.type === 'affinity_image_loading') {
              setIsAffinityImageLoading(true);
            } else if (data.type === 'user_action' && data.content) {
              userActionReceived = true;
              setMessages(prev => [...prev, { role: 'user', content: data.content }]);
            } else if (data.type === 'chunk') {
              accText += data.content;
              setStreamingText(accText);
              
              if (isRegeneration) {
                setMessages(prev => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === 'assistant') {
                    next[lastIdx] = { ...next[lastIdx], content: accText };
                  }
                  return next;
                });
              }
            } else if (data.type === 'done') {
              const meta = data.meta ?? {};

              setMessages(prev => {
                let updated = [...prev];

                // 유저 메시지에 id 부여
                if (meta.user_message_id) {
                  const lastUserIdx = updated.map(m => m.role === 'user' && !m.id).lastIndexOf(true);
                  if (lastUserIdx !== -1) {
                    updated[lastUserIdx] = { ...updated[lastUserIdx], id: meta.user_message_id };
                  }
                }

                if (autoAdvance && !userActionReceived) {
                  const uaName = (activeTopic as any)?.user_character?.name || '유저 캐릭터';
                  updated = [...updated, { role: 'user', content: `${uaName}은 그 말을 듣고 잠시 멈추었다.` }];
                }

                const newAiMsg = {
                  id: meta.message_id ?? undefined,
                  role: 'assistant',
                  content: accText,
                  situation: meta.situation ?? null,
                  suggested_actions: meta.suggested_actions ?? [],
                  parent_id: meta.user_message_id,
                  version: meta.version,
                  max_version: meta.version,
                  model_name: meta.model_name,
                  spent_dt: meta.spent_dt ?? 0,
                };

                // 실시간 사용량 합산용 데이터 업데이트
                setAllMessagesForUsage(prev => {
                  const exists = prev.some(m => m.id === newAiMsg.id);
                  if (exists) return prev;
                  return [...prev, { ...newAiMsg, is_active: true }];
                });

                if (isRegeneration) {
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                    updated[lastIdx] = newAiMsg;
                    return updated;
                  }
                }
                return [...updated, newAiMsg];
              });
              setStreamingText('');
              
              if (isRegeneration) loadMessages(activeTopic.id);

              // v2: 호감도 100 특전 씬 오버레이
              if (meta.affinity_max_scene) {
                setAffinityMaxOverlay({ scene: meta.affinity_max_scene });
                setActiveTopic((prev: any) => prev ? { ...prev, affinity_max_scene: meta.affinity_max_scene } : prev);
              }

              // v2: 조연 대사 → 별도 메시지
              if (meta.supporting_messages && meta.supporting_messages.length > 0) {
                setMessages(prev => [
                  ...prev,
                  ...meta.supporting_messages.map((sm: any) => ({
                    id: sm.message_id,
                    role: 'assistant',
                    content: sm.text,
                    is_supporting: true,
                    speaker_name: sm.name,
                    is_active: true,
                  })),
                ]);
              }

              // v2: 단계 전환 오프닝 → 별도 메시지
              if (meta.stage_opening) {
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: meta.stage_opening,
                  is_stage_opening: true,
                  stage: meta.stage,
                  stage_char_image_url: null,
                }]);
              }

              // v2: 단계 업데이트
              if (meta.stage) {
                setCurrentStage(meta.stage);
                // activeTopic.game_state.current_stage도 즉시 동기화 (배경 해금 판단에 사용됨)
                setActiveTopic((prev: any) => prev ? {
                  ...prev,
                  game_state: { ...(prev.game_state ?? {}), current_stage: meta.stage },
                } : prev);
              }

              // 단계 전환 시 배경→캐릭터 이미지 순차 생성
              if (meta.stage_changed && meta.stage) {
                generateStageImages(meta.stage);
                if (activeTopic) loadSummaries(activeTopic.id, true);
              }

              // v2: 힌트 카드
              if (meta.hint_card) setHintCard(meta.hint_card);

              // v2: 엔딩
              if (meta.ending) {
                setEndingData(meta.ending);
                setIsEnded(true);
                setIsEndingImageLoading(true);
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: meta.ending.scene,
                  is_ending: true,
                  ending_type: meta.ending.type,
                  ending_affinity: meta.ending.affinity,
                  ending_image_url: null,
                }]);
              }

              // 새 AI 응답이 완료되면 추천 답변 캐시 초기화
              setSuggestedReplies([]);
              
              // 상단 보유 DT 잔액 동기화
              refreshUser();

              // v2: 관계도 업데이트 (단계 전환 시)
              if (meta.relationship_graph) setRelationGraph(meta.relationship_graph);

              // v2: 속마음 자동 갱신
              if (meta.inner_thoughts) setInnerThoughts(prev => ({ ...prev, ...meta.inner_thoughts }));

              // 출력/입력 토큰 업데이트
              if (meta.output_tokens) setLastOutputTokens(meta.output_tokens);
              if (meta.input_tokens) setLastInputTokens(meta.input_tokens);

              // 호감도 업데이트: v2는 meta.affinity, 레거시는 meta.stats
              if (meta.affinity !== undefined) {
                const affection = Math.max(0, Math.min(100, Math.floor((meta.affinity + 100) / 2)));
                setActiveTopic((prev: any) => prev ? {
                  ...prev, affection, affinity: meta.affinity,
                  ...(meta.supporting_affinities !== undefined ? { supporting_affinities: meta.supporting_affinities } : {}),
                } : prev);
              } else if (meta.stats) {
                setActiveTopic((prev: any) => prev
                  ? { ...prev, affection: meta.stats.affection, intimacy: meta.stats.intimacy }
                  : prev
                );
              }
            } else if (data.type === 'ending_image') {
              const imgUrl = data.url;
              if (imgUrl) {
                setIsEndingImageLoading(false);
                setIsEndingLoading(false);
                const newUrls: string[] = data.urls ?? [imgUrl];
                setActiveTopic((prev: any) => prev ? { ...prev, ending_image: imgUrl, ending_images: newUrls } : prev);
                setEndingImgIndex(newUrls.length - 1);
                setMessages(prev => prev.map(m =>
                  m.is_ending ? { ...m, ending_image_url: imgUrl } : m
                ));
              }
            } else if (data.type === 'affinity_image') {
              const imgUrl = data.url;
              if (imgUrl) {
                setIsAffinityImageLoading(false);
                const newUrls: string[] = data.urls ?? [imgUrl];
                setActiveTopic((prev: any) => prev ? { ...prev, affinity_image: imgUrl, affinity_images: newUrls } : prev);
                setAffinityImgIndex(newUrls.length - 1);
              }
            } else if (data.type === 'error') {
              const msg = data.message || '';
              const isQuota = /429|quota|exhausted|resource.has.been.exhausted|rate.limit/i.test(msg);
              const is503 = /503|unavailable|overloaded/i.test(msg);
              const friendlyMsg = isQuota
                ? '무료 API 할당량이 소진됐습니다. 모델 선택에서 (Vertex AI)가 붙은 모델로 전환 후 다시 시도해주세요.'
                : is503
                ? '503 오류: 모델 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.'
                : `오류: ${msg}`;
              showErrorToast(friendlyMsg);
              setStreamingText('');
              setIsEndingImageLoading(false);
            }
          } catch { /* JSON parse skip */ }
        }
      }
    } catch (e) {
      console.error(e);
      showErrorToast('연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      setStreamingText('');
      setIsEndingImageLoading(false);
    } finally {
      setIsLoading(false);
    }
  };

  // 매 렌더마다 최신 sendMessage를 ref에 보관 (자동 턴 effect용)
  sendAutoRef.current = () => sendMessage('(계속 진행해줘)', true, true);

  const showErrorToast = (msg: string) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 5000);
  };

  const updateTopicSettings = async (updates: any) => {
    if (!activeTopic) return;
    try {
      await apiFetch(`/topics/${activeTopic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const updated = { ...activeTopic, ...updates };
      setActiveTopic(updated);
      setTopics(prev => prev.map(t => t.id === updated.id ? updated : t));
    } catch (e) { console.error(e); }
  };

  const generateCinematic = async () => {
    if (!activeTopic || isCinematicLoading) return;
    const tid = activeTopic.id;
    const initialUrl = activeTopic.cinematic_url;

    setIsCinematicLoading(true);
    setGenFlag(tid, 'cinematic');

    // HTTP 응답이 오기 전에도 완료를 감지할 수 있도록 즉시 폴링 시작.
    // 백엔드가 동기 방식이라 HTTP 연결이 길게 열리는데, 프록시 타임아웃 등으로
    // 연결이 끊겨도 백엔드는 계속 생성 → DB 저장하므로 폴링으로 감지 가능.
    if (cinematicPollRef.current) clearInterval(cinematicPollRef.current);
    cinematicPollRef.current = setInterval(async () => {
      if (!getGenFlag(tid, 'cinematic')) {
        clearInterval(cinematicPollRef.current!);
        cinematicPollRef.current = null;
        return;
      }
      try {
        const res = await apiFetch(`/topics/${tid}`);
        if (!res.ok) return;
        const topic = await res.json();
        if (topic.cinematic_url && topic.cinematic_url !== initialUrl) {
          clearInterval(cinematicPollRef.current!);
          cinematicPollRef.current = null;
          clearGenFlag(tid, 'cinematic');
          setCinematicUrl(topic.cinematic_url);
          setCinematicArchive(topic.cinematic_urls ?? []);
          setActiveTopic((prev: any) => prev
            ? { ...prev, cinematic_url: topic.cinematic_url, cinematic_urls: topic.cinematic_urls ?? [] }
            : prev);
          setIsCinematicLoading(false);
          setShowCinematicModal(true);
        }
      } catch {}
    }, 5000);

    try {
      const res = await apiFetch(`/topics/${tid}/cinematic`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // HTTP 응답이 폴링보다 먼저 도착한 경우
      if (cinematicPollRef.current) { clearInterval(cinematicPollRef.current); cinematicPollRef.current = null; }
      if (getGenFlag(tid, 'cinematic')) {
        clearGenFlag(tid, 'cinematic');
        setCinematicUrl(data.cinematic_url);
        setCinematicArchive(data.cinematic_urls ?? []);
        setActiveTopic((prev: any) => ({ ...prev, cinematic_url: data.cinematic_url, cinematic_urls: data.cinematic_urls ?? [] }));
        setIsCinematicLoading(false);
        setShowCinematicModal(true);
      }
    } catch (e) {
      console.error(e);
      // HTTP 실패 시 폴링이 계속 완료를 감지함 — 에러 토스트만 표시하고 로딩 유지
      setErrorToast('연결이 지연되고 있습니다. 생성 완료 시 자동으로 표시됩니다.');
    }
  };

  const archiveCurrentCinematic = async () => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch(`/topics/${activeTopic.id}/cinematic/archive-current`, { method: 'POST' });
      const data = await res.json();
      setCinematicArchive(data.cinematic_urls ?? []);
      setCinematicUrl(null);
      setActiveTopic((prev: any) => ({ ...prev, cinematic_url: null, cinematic_urls: data.cinematic_urls ?? [] }));
    } catch (e) {
      console.error(e);
    }
  };

  const deleteCinematic = async () => {
    if (!activeTopic) return;
    try {
      await apiFetch(`/topics/${activeTopic.id}/cinematic`, { method: 'DELETE' });
      setCinematicUrl(null);
      setCinematicArchive(prev => prev.filter(u => u !== cinematicUrl));
      setActiveTopic((prev: any) => ({ ...prev, cinematic_url: null }));
    } catch (e) {
      console.error(e);
    }
  };

  const selectCinematicFromArchive = async (url: string) => {
    if (!activeTopic) return;
    try {
      await apiFetch(`/topics/${activeTopic.id}/cinematic/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      setCinematicUrl(url);
      setActiveTopic((prev: any) => ({ ...prev, cinematic_url: url }));
      setShowCinematicArchive(false);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteCinematicArchiveItem = async (url: string) => {
    if (!activeTopic) return;
    try {
      await apiFetch(`/topics/${activeTopic.id}/cinematic/archive-item`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      setCinematicArchive(prev => prev.filter(u => u !== url));
      if (cinematicUrl === url) { setCinematicUrl(null); }
      setActiveTopic((prev: any) => ({
        ...prev,
        cinematic_url: prev.cinematic_url === url ? null : prev.cinematic_url,
        cinematic_urls: (prev.cinematic_urls ?? []).filter((u: string) => u !== url),
      }));
    } catch (e) {
      console.error(e);
    }
  };

  const generateBgm = async (stage: string) => {
    if (!activeTopic) return;
    const tid = activeTopic.id;
    setIsBgmLoading(true);
    setGenFlag(tid, 'bgm', { stage });
    try {
      const res = await apiFetch('/chat/generate-bgm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: tid, target_stage: stage }),
      });
      const data = await res.json();

      setActiveTopic((prev: any) => ({ ...prev, bgm_urls: data.bgm_urls }));

      if (data.audio_url) {
        setCurrentBgm(data.audio_url);
        setPlayingBgmStage(stage);
        setIsBgmPlaying(false);
      }
    } catch (e) {
      console.error(e);
      setErrorToast("BGM 생성에 실패했습니다.");
    } finally {
      clearGenFlag(tid, 'bgm');
      setIsBgmLoading(false);
    }
  };

  const selectBgm = async (stage: string, url: string) => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch('/chat/select-bgm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: activeTopic.id, stage, audio_url: url }),
      });
      const data = await res.json();
      setActiveTopic((prev: any) => ({ ...prev, bgm_urls: data.bgm_urls }));

      setCurrentBgm(url);
      setPlayingBgmStage(stage);
      setIsBgmPlaying(false);
    } catch (e) { console.error(e); }
  };

  const deleteBgm = async (stage: string, url: string) => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch('/chat/delete-bgm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: activeTopic.id, stage, audio_url: url }),
      });
      const data = await res.json();
      setActiveTopic((prev: any) => prev ? { ...prev, bgm_urls: data.bgm_urls } : prev);
      
      // 현재 재생 중인 곡을 삭제했다면 플레이어 중지
      if (currentBgm === url) {
        stopBgm();
        setCurrentBgm(null);
      }
    } catch (e) { console.error(e); }
  };

  const saveBgmName = async (url: string, name: string) => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch('/chat/rename-bgm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: activeTopic.id, audio_url: url, name }),
      });
      const data = await res.json();
      setActiveTopic((prev: any) => prev ? { ...prev, bgm_urls: data.bgm_urls } : prev);
    } catch (e) { console.error(e); }
    setEditingBgmUrl(null);
  };

  const deleteTopic = (id: number) => {
    setModal({
      show: true, title: '모험 삭제',
      message: '이 모험을 삭제하시겠습니까? 모든 대화 내용이 사라집니다.',
      onConfirm: async () => {
        try {
          await apiFetch(`/topics/${id}`, { method: 'DELETE' });
          setTopics(prev => prev.filter(t => t.id !== id));
          if (activeTopic?.id === id) setActiveTopic(null);
        } catch (e) { console.error(e); }
        setModal(null);
      },
    });
  };

  const deletePersona = (id: number) => {
    setModal({
      show: true, title: '페르소나 삭제',
      message: '이 페르소나를 삭제하시겠습니까?',
      onConfirm: async () => {
        try {
          await apiFetch(`/personas/${id}`, { method: 'DELETE' });
          setPersonas(prev => prev.filter(p => p.id !== id));
        } catch (e) { console.error(e); }
        setModal(null);
      },
    });
  };

  const handleCreatePersona = async () => {
    if (!personaForm.name.trim()) return;
    try {
      const res = await apiFetch('/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(personaForm),
      });
      const newP = await res.json();
      setPersonas(prev => [...prev, newP]);
      setPersonaForm({ name: '', description: '' });
      setShowPersonaForm(false);
    } catch (e) { console.error(e); }
  };

  const handleUpdatePersona = async (id: number) => {
    if (!editPersonaForm.name.trim()) return;
    try {
      const res = await apiFetch(`/personas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editPersonaForm),
      });
      const updated = await res.json();
      setPersonas(prev => prev.map(p => p.id === id ? updated : p));
      setEditingPersonaId(null);
    } catch (e) { console.error(e); }
  };

  const applyPersona = async (personaId: number) => {
    if (!activeTopic) return;
    const isApplying = activeTopic.active_persona_id !== personaId;
    const targetId = isApplying ? personaId : 0;
    try {
      await apiFetch(`/topics/${activeTopic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_persona_id: targetId }),
      });
      const updated = { ...activeTopic, active_persona_id: isApplying ? personaId : null };
      setActiveTopic(updated);
      setTopics(prev => prev.map(t => t.id === updated.id ? updated : t));
    } catch (e) { console.error(e); }
  };

  const saveTitle = async (id: number) => {
    try {
      await apiFetch(`/topics/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle }),
      });
      setTopics(prev => prev.map(t => t.id === id ? { ...t, title: editTitle } : t));
      if (activeTopic?.id === id) setActiveTopic((p: any) => ({ ...p, title: editTitle }));
      setEditingTopicId(null);
    } catch (e) { console.error(e); }
  };

  const deleteMessageBranch = (messageId: number) => {
    setModal({
      show: true,
      title: '대화 삭제',
      message: '이 시점 이후의 모든 대화 내역이 삭제됩니다.\nAI도 해당 내용을 기억하지 못하게 됩니다.',
      warning: '삭제된 대화에서 사용된 토큰은 환불되지 않습니다.',
      onConfirm: async () => {
        try {
          await apiFetch(`/messages/${messageId}`, { method: 'DELETE' });
          loadMessages(activeTopic.id);
        } catch (e) { console.error(e); }
        setModal(null);
      },
    });
  };

  const handleRegenerate = async () => {
    if (!activeTopic || !retryMessageId) return;
    
    // 2. 마지막 유저 메시지 찾기
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    
    if (lastUserMsg) {
      setShowRetryOverlay(false);
      setRetryMessageId(null);
      // 3. 새 답변 요청 (is_regeneration=true, 가이드 포함)
      sendMessage(lastUserMsg.content, true, false, retryGuidance, true);
      setRetryGuidance('');
    } else {
       setShowRetryOverlay(false);
       setRetryMessageId(null);
    }
  };

  const switchMessageVersion = async (topicId: number, parentId: number, direction: 'prev' | 'next') => {
    try {
      const res = await apiFetch(`/messages/${topicId}/versions/${parentId}?direction=${direction}`, { method: 'POST' });
      if (res.ok) {
        loadMessages(topicId);
      }
    } catch (e) { console.error(e); }
  };

  const duplicateTopicAt = async (messageId: number) => {
    if (!activeTopic) return;
    try {
      const res = await apiFetch(
        `/topics/${activeTopic.id}/duplicate?until_message_id=${messageId}`,
        { method: 'POST' }
      );
      const data = await res.json();
      await loadTopics();
      const newTopicsRes = await apiFetch('/topics');
      const newTopics = await newTopicsRes.json();
      const newTopic = newTopics.find((t: any) => t.id === data.id);
      if (newTopic) selectTopic(newTopic);
    } catch (e) { console.error(e); }
  };

  const handleUpdateSummary = async (summaryId: number) => {
    if (!editSummaryText.trim()) return;
    try {
      const res = await apiFetch(`/summaries/${summaryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editSummaryText }),
      });
      const updated = await res.json();
      setSummaries(prev => prev.map(s => s.id === summaryId ? updated : s));
      setEditingSummaryId(null);
    } catch (e) { console.error(e); }
  };

  const handleDeleteSummary = (summaryId: number) => {
    setModal({
      show: true, title: '요약 삭제',
      message: '이 요약 기록을 삭제하시겠습니까?',
      onConfirm: async () => {
        try {
          await apiFetch(`/summaries/${summaryId}`, { method: 'DELETE' });
          setSummaries(prev => prev.filter(s => s.id !== summaryId));
        } catch (e) { console.error(e); }
        setModal(null);
      },
    });
  };

  return (
    <div className="flex h-screen w-full bg-[#fcfcfd] overflow-hidden font-sans text-slate-800 gap-0">
      <audio
        ref={audioRef}
        src={currentBgm || undefined}
        onTimeUpdate={handleBgmTimeUpdate}
        onLoadedMetadata={() => audioRef.current && setBgmDuration(audioRef.current.duration)}
        onEnded={() => !isBgmLoop && setIsBgmPlaying(false)}
        loop={isBgmLoop}
      />

      {/* 배경 이미지 갤러리 모달 */}
      {showBgImgModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-md px-6 animate-in fade-in duration-300">
          <div className="bg-[#141418] w-full max-w-md rounded-[2rem] overflow-hidden shadow-2xl border border-white/8 animate-in zoom-in-95 duration-200">
            {/* 헤더 */}
            <div className="p-6 pb-4 text-center space-y-1.5 border-b border-white/8">
              <div className="w-11 h-11 bg-violet-500/15 text-violet-400 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-violet-500/20">
                <ImageIcon size={20} />
              </div>
              <h3 className="text-lg font-black text-white/90">단계별 배경 이미지</h3>
              <p className="text-[11px] text-white/40 leading-relaxed">분위기에 맞는 배경 이미지를 생성하거나 선택하세요.</p>
            </div>

            <div className="px-5 py-4 space-y-2 max-h-[45vh] overflow-y-auto custom-scrollbar">
              {['기', '승', '전', '결'].map((stage) => {
                const stageIndex = ['기', '승', '전', '결'].indexOf(stage);
                const currentIndex = ['기', '승', '전', '결'].indexOf(
                  activeTopic?.game_state?.current_stage || '기'
                );
                const isLocked = stageIndex > currentIndex;

                const bgData = activeTopic?.background_images || {};
                let imgList: string[] = [];
                if (Array.isArray(bgData[stage])) {
                  imgList = bgData[stage];
                } else if (typeof bgData[stage] === 'string') {
                  imgList = [bgData[stage]];
                }
                const activeUrl = bgData.active?.[stage] || (imgList.length > 0 ? imgList[0] : null);
                const isExpanded = bgImgListExpanded === stage;
                const isBgSelected = !isLocked && bgImgSelectedStage === stage;

                return (
                  <div
                    key={stage}
                    onClick={() => { if (!isLocked) setBgImgSelectedStage(stage); }}
                    className={`rounded-xl border transition-all ${
                      isLocked ? 'border-white/5 opacity-30 cursor-not-allowed'
                      : isBgSelected ? 'border-violet-500/60 bg-violet-500/10 cursor-pointer'
                      : 'border-white/8 bg-white/4 cursor-pointer hover:border-white/15 hover:bg-white/6'
                    }`}
                  >
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black transition-all ${
                          isLocked ? 'bg-white/8 text-white/20'
                          : isBgSelected ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm shadow-violet-900/40'
                          : 'bg-white/10 text-white/40'
                        }`}>{stage}</div>
                        <div>
                          <p className={`font-bold text-[12px] ${isLocked ? 'text-white/20' : isBgSelected ? 'text-violet-300' : 'text-white/60'}`}>{stage} 단계</p>
                          {!isLocked && imgList.length > 0 && (
                            <p className="text-[9px] text-white/30">{imgList.length}개의 배경</p>
                          )}
                        </div>
                      </div>
                      {!isLocked && imgList.length > 0 && (
                        <button
                          onClick={() => setBgImgListExpanded(isExpanded ? null : stage)}
                          className={`p-1.5 rounded-lg transition-all ${isExpanded ? 'text-violet-400 rotate-180' : 'text-white/25 hover:text-white/50'}`}
                        >
                          <ChevronDown size={13} />
                        </button>
                      )}
                    </div>

                    {!isLocked && isExpanded && imgList.length > 0 && (
                      <div className="px-3 pb-3 border-t border-white/8">
                        <div className="grid grid-cols-2 gap-2 pt-3">
                          {imgList.map((url, idx) => {
                            const isCurrentlyDisplayed = chatBackground === url;
                            return (
                              <div key={idx} className={`relative rounded-xl overflow-hidden border-2 transition-all ${isCurrentlyDisplayed ? 'border-violet-500 shadow-lg shadow-violet-900/40' : 'border-white/10 hover:border-violet-400/40'}`}>
                                <img
                                  src={url}
                                  alt={`배경 #${idx + 1}`}
                                  className="w-full aspect-square object-cover cursor-zoom-in"
                                  onClick={(e) => { e.stopPropagation(); setLightboxUrl(url); }}
                                />
                                {isCurrentlyDisplayed && (
                                  <div className="absolute top-1.5 left-1.5 bg-violet-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                                    사용 중
                                  </div>
                                )}
                                <div className="absolute bottom-0 inset-x-0 flex gap-1 p-1.5 bg-gradient-to-t from-black/70 to-transparent">
                                  {!isCurrentlyDisplayed && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); selectBackground(stage, url); }}
                                      className="flex-1 py-1 text-[9px] font-black text-white bg-violet-600/90 hover:bg-violet-600 rounded-lg transition-all"
                                    >적용</button>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setBgImgDeleteConfirm({ stage, url }); }}
                                    className="p-1 text-white/70 hover:text-red-400 bg-black/30 hover:bg-black/50 rounded-lg transition-all"
                                  ><Trash2 size={10} /></button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-5 pt-3 space-y-2 border-t border-white/8">
              <button
                onClick={() => setBgImgGenerateConfirm({ show: true, stage: bgImgSelectedStage })}
                disabled={isBgLoading}
                className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl font-black text-sm shadow-lg shadow-violet-900/30 transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {isBgLoading ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />생성 중...</>
                ) : (
                  <><Sparkles size={15} /> {bgImgSelectedStage} 단계 배경 이미지 생성하기</>
                )}
              </button>
              {chatBackground && (
                <button
                  onClick={() => { clearBackground(bgImgSelectedStage); setShowBgImgModal(false); }}
                  className="w-full py-3 bg-white/5 hover:bg-white/8 text-white/40 hover:text-white/60 rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 border border-white/8"
                >
                  <X size={13} /> 기본 배경으로 되돌리기
                </button>
              )}
              <button
                onClick={() => setShowBgImgModal(false)}
                className="w-full py-3 bg-white/5 hover:bg-white/8 text-white/40 hover:text-white/60 rounded-xl font-bold text-sm transition-all"
              >닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 배경 이미지 생성 확인 모달 */}
      {bgImgGenerateConfirm?.show && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-[#1e1e22] w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl border border-white/5 space-y-7 animate-in zoom-in-95 duration-300">
            <div className="space-y-2 text-center">
              <div className="w-12 h-12 bg-violet-500/20 text-violet-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Sparkles size={24} />
              </div>
              <h3 className="text-white text-lg font-black">배경 이미지 생성</h3>
              <p className="text-white/70 text-xs font-medium leading-relaxed">
                '{bgImgGenerateConfirm.stage}' 단계의 대화와 분위기를 반영한<br />배경 이미지를 생성하시겠습니까?
              </p>
              <div className="inline-flex items-center gap-1.5 bg-violet-500/15 border border-violet-500/30 rounded-full px-3 py-1 mt-1">
                <span className="text-violet-300 text-xs font-black">15 DT 소모</span>
              </div>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => {
                  generateStageBackground(bgImgGenerateConfirm.stage);
                  setBgImgGenerateConfirm(null);
                  setBgImgListExpanded(bgImgGenerateConfirm.stage);
                }}
                className="w-full py-4 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-xl shadow-violet-900/30"
              >
                <Sparkles size={18} /> 지금 생성하기
              </button>
              <button
                onClick={() => setBgImgGenerateConfirm(null)}
                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-black text-sm transition-all active:scale-[0.98]"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 배경 이미지 삭제 확인 모달 */}
      {stageImgDeleteConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">분기 이미지 삭제</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                삭제된 이미지는 복구되지 않습니다.<br />정말 삭제할까요?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStageImgDeleteConfirm(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  const { stage, index } = stageImgDeleteConfirm;
                  setStageImgDeleteConfirm(null);
                  try {
                    const res = await apiFetch(
                      `/topics/${activeTopic?.id}/stage-character-image?stage=${encodeURIComponent(stage)}&index=${index}`,
                      { method: 'DELETE' }
                    );
                    if (res.ok) {
                      const data = await res.json();
                      const remaining: string[] = data.remaining ?? [];
                      setActiveTopic((prev: any) => {
                        if (!prev) return prev;
                        const imgs = { ...(prev.stage_character_images || {}), [stage]: remaining };
                        if (remaining.length === 0) delete imgs[stage];
                        return { ...prev, stage_character_images: imgs };
                      });
                      const newIdx = Math.max(0, Math.min(index, remaining.length - 1));
                      setStageCharImageIndices(prev => ({ ...prev, [stage]: newIdx }));
                      const newUrl = remaining[newIdx] ?? null;
                      setMessages(prev => prev.map(m =>
                        m.is_stage_opening && m.stage === stage
                          ? { ...m, stage_char_image_url: newUrl }
                          : m
                      ));
                    }
                  } catch {}
                }}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 표지 이미지 재생성 확인 모달 */}
      {coverImgRegenConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <RotateCcw size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">표지 이미지 재생성</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                시나리오와 캐릭터 정보를 기반으로 새 표지 이미지를 생성합니다.<br />로어북에서 수정한 캐릭터 정보가 반영됩니다.<br />이전 이미지는 보관됩니다.
              </p>
              <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 mt-1">
                <span className="text-amber-500 text-xs font-black">15 DT 소모</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCoverImgRegenConfirm(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => { setCoverImgRegenConfirm(false); regenerateCoverImage(); }} className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-sm transition-all">재생성</button>
            </div>
          </div>
        </div>
      )}

      {/* 표지 이미지 삭제 확인 모달 */}
      {coverImgDeleteConfirm !== null && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">표지 이미지 삭제</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                삭제된 이미지는 복구되지 않습니다.<br />정말 삭제할까요?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCoverImgDeleteConfirm(null)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => deleteCoverImage(coverImgDeleteConfirm!)} className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all">확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 상대 캐릭터 이미지 재생성 확인 모달 */}
      {aiCharImgRegenConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <RotateCcw size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">상대 캐릭터 이미지 재생성</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                로어북에서 수정한 외형·나이·성별 정보가 반영된 새 이미지를 생성합니다.<br />이전 이미지는 보관됩니다.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAiCharImgRegenConfirm(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => { setAiCharImgRegenConfirm(false); regenerateAiCharImage(); }} className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-sm transition-all">재생성</button>
            </div>
          </div>
        </div>
      )}

      {/* 상대 캐릭터 이미지 삭제 확인 모달 */}
      {aiCharImgDeleteConfirm !== null && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">상대 캐릭터 이미지 삭제</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                삭제된 이미지는 복구되지 않습니다.<br />정말 삭제할까요?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAiCharImgDeleteConfirm(null)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => deleteAiCharImage(aiCharImgDeleteConfirm!)} className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all">확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 내 캐릭터 이미지 재생성 확인 모달 */}
      {userCharImgRegenConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <RotateCcw size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">내 캐릭터 이미지 재생성</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                로어북에서 수정한 외형·나이·성별 정보가 반영된 새 이미지를 생성합니다.<br />이전 이미지는 보관됩니다.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setUserCharImgRegenConfirm(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => { setUserCharImgRegenConfirm(false); regenerateUserCharImage(); }} className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-sm transition-all">재생성</button>
            </div>
          </div>
        </div>
      )}

      {/* 내 캐릭터 이미지 삭제 확인 모달 */}
      {userCharImgDeleteConfirm !== null && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">내 캐릭터 이미지 삭제</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                삭제된 이미지는 복구되지 않습니다.<br />정말 삭제할까요?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setUserCharImgDeleteConfirm(null)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => deleteUserCharImage(userCharImgDeleteConfirm!)} className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all">확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 이미지 세트 재생성 확인 모달 */}
      {charImgRegenConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <RotateCcw size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">이미지 세트 재생성</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                표지 이미지, 상대 캐릭터, 내 캐릭터<br />
                총 3장의 이미지를 순서대로 재생성합니다.<br />
                이전 이미지는 보관되어 선택할 수 있습니다.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCharImgRegenConfirm(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => { setCharImgRegenConfirm(false); regenerateCharacterImages(); }} className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-sm transition-all">재생성</button>
            </div>
          </div>
        </div>
      )}

      {/* 엔딩 이미지 재생성 확인 모달 */}
      {endingImgRegenConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Coins size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">엔딩 이미지 재생성</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                새로운 엔딩 이미지를 생성합니다.<br />기존 이미지는 히스토리에 남습니다.
              </p>
              <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 mt-1">
                <span className="text-amber-500 text-xs font-black">15 DT 소모</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEndingImgRegenConfirm(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => { setEndingImgRegenConfirm(false); regenerateEndingImage(); }} className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-sm transition-all">확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 로어북 캐릭터 삭제 확인 모달 */}
      {lorebookDeleteConfirm !== null && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-[#1e1e22] w-full max-w-sm rounded-[2rem] p-8 shadow-2xl border border-white/5 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-white text-lg font-black">캐릭터 삭제</h3>
              <p className="text-white/60 text-sm font-medium leading-relaxed">
                캐릭터 정보와 로어북 항목이 함께 삭제됩니다.<br />삭제 후 복구할 수 없습니다.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setLorebookDeleteConfirm(null)}
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl font-black text-sm transition-all"
              >취소</button>
              <button
                onClick={() => { deleteLorebookEntry(lorebookDeleteConfirm!); setLorebookDeleteConfirm(null); }}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all"
              >삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* 엔딩 이미지 삭제 확인 모달 */}
      {endingImgDeleteConfirm !== null && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">엔딩 이미지 삭제</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                삭제된 이미지는 복구되지 않습니다.<br />정말 삭제할까요?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEndingImgDeleteConfirm(null)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => deleteEndingImage(endingImgDeleteConfirm!)} className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all">확인</button>
            </div>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="배경 이미지 확대"
            className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-white/20 hover:bg-white/30 text-white rounded-full transition-all"
            onClick={() => setLightboxUrl(null)}
          >
            ✕
          </button>
        </div>
      )}

      {bgImgDeleteConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">배경 이미지 삭제</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                삭제된 배경 이미지는 복구되지 않습니다.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setBgImgDeleteConfirm(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all"
              >
                취소
              </button>
              <button
                onClick={() => { deleteBackground(bgImgDeleteConfirm.stage, bgImgDeleteConfirm.url); setBgImgDeleteConfirm(null); }}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DT 소모량 팝업 — 최상위 렌더링 (부모 transform 영향 없음) */}
      {showTokenPopup && (
        <div ref={tokenPopupRef} className="fixed top-14 right-4 z-[9999] w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 space-y-5 animate-in slide-in-from-top-1 duration-200 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">누적 DT 소모량</span>
            <span className="text-base font-black text-blue-600">
              {allMessagesForUsage.reduce((acc, m) => acc + (m.spent_dt || 0), 0).toLocaleString()} DT
            </span>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <MessageSquare size={10} className="text-slate-400" />
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">채팅 (모델별)</span>
              </div>
              <div className="space-y-1">
                {Object.entries(
                  allMessagesForUsage.reduce((acc: Record<string, number>, m) => {
                    if (m.role === 'assistant' && m.model_name && !m.model_name.startsWith('FEATURE_')) {
                      const name = m.model_name.replace('-vertex', '').toUpperCase();
                      acc[name] = (acc[name] || 0) + (m.spent_dt || 0);
                    }
                    return acc;
                  }, {})
                ).map(([name, dt]) => (
                  <div key={name} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-100/50">
                    <span className="text-[10px] font-bold text-slate-600">{name}</span>
                    <span className="text-[10px] font-black text-slate-800">{dt.toLocaleString()} DT</span>
                  </div>
                ))}
                {!allMessagesForUsage.some(m => m.model_name && !m.model_name.startsWith('FEATURE_')) && (
                  <p className="text-[10px] text-slate-300 font-bold text-center py-2 italic">채팅 기록이 없습니다.</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <RotateCcw size={10} className="text-slate-400" />
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">기능 (새로고침)</span>
              </div>
              <div className="space-y-1">
                {Object.entries(
                  allMessagesForUsage.reduce((acc: Record<string, number>, m) => {
                    if (m.model_name?.startsWith('FEATURE_')) {
                      const key = m.model_name.replace('FEATURE_', '');
                      const label = key === 'INNER_THOUGHT' ? '속마음' : key === 'SUMMARY' ? '요약' : key === 'RELATION_GRAPH' ? '인물관계도' : key === 'SUGGEST_REPLIES' ? '추천 답변' : key;
                      acc[label] = (acc[label] || 0) + (m.spent_dt || 0);
                    }
                    return acc;
                  }, {})
                ).map(([name, dt]) => (
                  <div key={name} className="flex items-center justify-between bg-violet-50/30 px-3 py-2 rounded-xl border border-violet-100/50">
                    <span className="text-[10px] font-bold text-violet-600">{name}</span>
                    <span className="text-[10px] font-black text-violet-700">{dt.toLocaleString()} DT</span>
                  </div>
                ))}
                {!allMessagesForUsage.some(m => m.model_name?.startsWith('FEATURE_')) && (
                  <p className="text-[10px] text-slate-300 font-bold text-center py-2 italic">기능 사용 기록이 없습니다.</p>
                )}
              </div>
            </div>
          </div>

          <div className="pt-1 border-t border-slate-50">
            <p className="text-[9px] text-slate-400 font-medium leading-relaxed italic">
              * 모델 및 기능별로 소모되는 DT가 다를 수 있습니다.
            </p>
          </div>
        </div>
      )}

      {/* 시네마틱 영상 모달 */}
      {showCinematicModal && cinematicUrl && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => { setShowCinematicModal(false); setShowCinematicArchive(false); }}>
          <div className="relative w-full max-w-3xl mx-4 rounded-[2rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-5 py-3 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
              <span className="text-white text-sm font-black tracking-wide">🎬 시네마틱</span>
              <div className="flex items-center gap-2 pointer-events-auto">
                {cinematicArchive.length > 0 && (
                  <button
                    onClick={() => setShowCinematicArchive(v => !v)}
                    className="text-white/70 hover:text-white transition-colors text-xs font-bold px-2 py-1 rounded-lg hover:bg-white/10"
                  >
                    📁 보관함 ({cinematicArchive.length})
                  </button>
                )}
                <button
                  onClick={() => setModal({
                    show: true,
                    title: '🔄 시네마틱 재생성',
                    message: '시네마틱 영상을 다시 생성할까요?',
                    warning: '기존 영상은 보관되고 새로 생성됩니다.',
                    confirmLabel: '재생성',
                    variant: 'confirm',
                    onConfirm: async () => { await archiveCurrentCinematic(); generateCinematic(); setShowCinematicModal(false); setShowCinematicArchive(false); },
                  })}
                  className="text-white/70 hover:text-white transition-colors text-xs font-bold px-2 py-1 rounded-lg hover:bg-white/10"
                >
                  🔄 재생성
                </button>
                <button
                  onClick={() => setModal({
                    show: true,
                    title: '시네마틱 영상 삭제',
                    message: '삭제하시겠습니까?',
                    warning: '삭제된 시네마틱 영상은 복구되지 않습니다.',
                    variant: 'delete',
                    onConfirm: async () => { await deleteCinematic(); setShowCinematicModal(false); setShowCinematicArchive(false); },
                  })}
                  className="text-white/70 hover:text-red-400 transition-colors text-xs font-bold px-2 py-1 rounded-lg hover:bg-white/10"
                >
                  삭제
                </button>
                <button onClick={() => { setShowCinematicModal(false); setShowCinematicArchive(false); }} className="text-white/70 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                  <X size={18} />
                </button>
              </div>
            </div>
            {/* 비디오 */}
            <video
              src={cinematicUrl}
              controls
              autoPlay
              loop
              className="w-full aspect-video bg-black"
              style={{ display: 'block' }}
            />
            {/* 보관함 패널 */}
            {showCinematicArchive && (
              <div className="bg-black/90 px-4 py-3">
                <p className="text-white/60 text-[10px] font-bold mb-2 uppercase tracking-widest">보관함</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {cinematicArchive.map((url, idx) => (
                    <div key={url} className="relative flex-shrink-0 w-32 group">
                      <video
                        src={url}
                        className={`w-32 h-20 object-cover rounded-xl cursor-pointer border-2 transition-all ${url === cinematicUrl ? 'border-purple-400' : 'border-white/10 hover:border-white/40'}`}
                        muted
                        onClick={() => selectCinematicFromArchive(url)}
                      />
                      {url === cinematicUrl && (
                        <span className="absolute top-1 left-1 bg-purple-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md">현재</span>
                      )}
                      <button
                        onClick={() => setModal({
                          show: true,
                          title: '영상 삭제',
                          message: `보관함 영상 ${idx + 1}번을 삭제할까요?`,
                          warning: '삭제된 영상은 복구되지 않습니다.',
                          variant: 'delete',
                          onConfirm: () => deleteCinematicArchiveItem(url),
                        })}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-red-500/80 text-white rounded-full items-center justify-center text-[10px] hidden group-hover:flex transition-all"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* BGM 생성 모달 */}
      {showBgmModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-md px-6 animate-in fade-in duration-300">
          <div className="bg-[#141418] w-full max-w-md rounded-[2rem] overflow-hidden shadow-2xl border border-white/8 animate-in zoom-in-95 duration-200">
            {/* 헤더 */}
            <div className="p-6 pb-4 text-center space-y-1.5 border-b border-white/8">
              <div className="w-11 h-11 bg-indigo-500/15 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-indigo-500/20">
                <Music size={20} />
              </div>
              <h3 className="text-lg font-black text-white/90">단계별 BGM</h3>
              <p className="text-[11px] text-white/40 leading-relaxed">분위기에 맞는 배경음악을 생성하거나 선택하세요.</p>
            </div>

            <div className="px-5 py-4 space-y-2 max-h-[45vh] overflow-y-auto custom-scrollbar">
              {['기', '승', '전', '결'].map((stage) => {
                const stageIndex = ['기', '승', '전', '결'].indexOf(stage);
                const currentIndex = ['기', '승', '전', '결'].indexOf(currentStage || '기');
                const isLocked = stageIndex > currentIndex;

                let trackList: string[] = [];
                if (activeTopic?.bgm_urls && Array.isArray(activeTopic.bgm_urls[stage])) {
                  trackList = activeTopic.bgm_urls[stage];
                } else if (activeTopic?.bgm_urls && typeof activeTopic.bgm_urls[stage] === 'string') {
                  trackList = [activeTopic.bgm_urls[stage]];
                }

                const activeUrl = activeTopic?.bgm_urls?.active?.[stage] || (trackList.length > 0 ? trackList[0] : null);
                const isExpanded = bgmListExpanded === stage;
                const isSelected = !isLocked && selectedBgmStage === stage;

                return (
                  <div
                    key={stage}
                    onClick={() => { if (!isLocked) setSelectedBgmStage(stage); }}
                    className={`rounded-xl border transition-all ${
                      isLocked ? 'border-white/5 opacity-30 cursor-not-allowed'
                      : isSelected ? 'border-indigo-500/60 bg-indigo-500/10 cursor-pointer'
                      : 'border-white/8 bg-white/4 cursor-pointer hover:border-white/15 hover:bg-white/6'
                    }`}
                  >
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black transition-all ${
                          isLocked ? 'bg-white/8 text-white/20'
                          : isSelected ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-900/40'
                          : 'bg-white/10 text-white/40'
                        }`}>{stage}</div>
                        <div>
                          <p className={`font-bold text-[12px] ${isLocked ? 'text-white/20' : isSelected ? 'text-indigo-300' : 'text-white/60'}`}>{stage} 단계</p>
                          {!isLocked && trackList.length > 0 && (
                            <p className="text-[9px] text-white/30">{trackList.length}개의 트랙</p>
                          )}
                        </div>
                      </div>
                      {!isLocked && trackList.length > 0 && (
                        <button
                          onClick={() => setBgmListExpanded(isExpanded ? null : stage)}
                          className={`p-1.5 rounded-lg transition-all ${isExpanded ? 'text-indigo-400 rotate-180' : 'text-white/25 hover:text-white/50'}`}
                        >
                          <ChevronDown size={13} />
                        </button>
                      )}
                    </div>

                    {!isLocked && isExpanded && (
                      <div className="px-3 pb-3 space-y-1 max-h-40 overflow-y-auto no-scrollbar border-t border-white/8 pt-2">
                        {trackList.map((url, idx) => {
                          const isActive = activeUrl === url;
                          return (
                            <div key={idx} className={`flex items-center justify-between p-2 rounded-xl transition-all ${isActive ? 'bg-indigo-500/15 border border-indigo-500/25' : 'hover:bg-white/5'}`}>
                              <div className="flex items-center gap-1.5 overflow-hidden pl-1 flex-1 min-w-0">
                                {editingBgmUrl === url ? (
                                  <input
                                    autoFocus
                                    value={editingBgmName}
                                    onChange={e => setEditingBgmName(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveBgmName(url, editingBgmName);
                                      if (e.key === 'Escape') setEditingBgmUrl(null);
                                    }}
                                    onBlur={() => saveBgmName(url, editingBgmName)}
                                    className="text-[11px] font-bold border border-indigo-500/40 rounded-lg px-2 py-0.5 outline-none focus:ring-1 focus:ring-indigo-500 w-full bg-white/10 text-white/80"
                                    placeholder={`BGM #${idx + 1}`}
                                  />
                                ) : (
                                  <>
                                    <span className={`text-[11px] font-bold truncate ${isActive ? 'text-indigo-300' : 'text-white/50'}`}>
                                      {activeTopic?.bgm_urls?.names?.[url] || `BGM #${idx + 1}`}
                                      {isActive && ' (사용 중)'}
                                    </span>
                                    <button
                                      onClick={() => { setEditingBgmUrl(url); setEditingBgmName(activeTopic?.bgm_urls?.names?.[url] || ''); }}
                                      className="shrink-0 p-0.5 text-white/20 hover:text-indigo-400 transition-colors"
                                    ><Edit3 size={10} /></button>
                                  </>
                                )}
                              </div>
                              {editingBgmUrl !== url && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {!isActive && (
                                    <button
                                      onClick={() => selectBgm(stage, url)}
                                      className="px-2 py-1 text-[9px] font-black text-white/40 hover:text-indigo-300 hover:bg-indigo-500/20 rounded-md transition-all"
                                    >선택</button>
                                  )}
                                  <button
                                    onClick={() => setBgmDeleteConfirm({ stage, url })}
                                    className="p-1 text-white/20 hover:text-red-400 hover:bg-red-500/15 rounded-md transition-all"
                                  ><Trash2 size={12} /></button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-5 pt-3 space-y-2 border-t border-white/8">
              <button
                onClick={() => setBgmGenerateConfirm({ show: true, stage: selectedBgmStage })}
                disabled={isBgmLoading}
                className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl font-black text-sm shadow-lg shadow-indigo-900/30 transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {isBgmLoading ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />생성 중...</>
                ) : (
                  <><Sparkles size={15} /> {selectedBgmStage} 단계 BGM 생성하기</>
                )}
              </button>
              <button
                onClick={() => setShowBgmModal(false)}
                className="w-full py-3 bg-white/5 hover:bg-white/8 text-white/40 hover:text-white/60 rounded-xl font-bold text-sm transition-all"
              >닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* BGM 생성 확인 모달 - 스크린샷 044044.png의 '삭제하기' 오류 해결 버전 */}
      {bgmGenerateConfirm?.show && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-[#1e1e22] w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl border border-white/5 space-y-7 animate-in zoom-in-95 duration-300">
            <div className="space-y-2 text-center">
              <div className="w-12 h-12 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Sparkles size={24} />
              </div>
              <h3 className="text-white text-lg font-black">배경음악 생성</h3>
              <p className="text-white/70 text-xs font-medium leading-relaxed">
                '{bgmGenerateConfirm.stage}' 단계의 서사에 어울리는 새로운 음악을 생성하시겠습니까?
              </p>
              <div className="inline-flex items-center gap-1.5 bg-indigo-500/15 border border-indigo-500/30 rounded-full px-3 py-1 mt-1">
                <span className="text-indigo-300 text-xs font-black">30 DT 소모</span>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => {
                  generateBgm(bgmGenerateConfirm.stage);
                  setBgmGenerateConfirm(null);
                }}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-xl shadow-indigo-900/30"
              >
                <Sparkles size={18} /> 지금 생성하기
              </button>
              <button
                onClick={() => setBgmGenerateConfirm(null)}
                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-black text-sm transition-all active:scale-[0.98]"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BGM 삭제 확인 모달 */}
      {bgmDeleteConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-slate-800 text-lg font-black">BGM 삭제</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">
                삭제된 BGM은 복구되지 않습니다.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setBgmDeleteConfirm(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black text-sm transition-all"
              >
                취소
              </button>
              <button
                onClick={() => { deleteBgm(bgmDeleteConfirm.stage, bgmDeleteConfirm.url); setBgmDeleteConfirm(null); }}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 대화 복제 확인 오버레이 */}
      {showDuplicateConfirm.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-[#1e1e22] w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl border border-white/5 space-y-7 animate-in zoom-in-95 duration-300">
            <div className="space-y-2 text-center">
              <h3 className="text-white text-lg font-black">채팅방 복제</h3>
              <p className="text-white/70 text-xs font-medium leading-relaxed">
                별도의 새로운 채팅방이 생성되어 해당 부분까지 기억을 유지한채<br />
                대화를 진행할 수 있습니다.
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => {
                  if (showDuplicateConfirm.messageId) duplicateTopicAt(showDuplicateConfirm.messageId);
                  setShowDuplicateConfirm({ show: false, messageId: null });
                }}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-xl shadow-blue-900/30"
              >
                <GitFork size={18} /> 지금 복제하기
              </button>
              <button
                onClick={() => setShowDuplicateConfirm({ show: false, messageId: null })}
                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-black text-sm transition-all active:scale-[0.98]"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 재생성(다시 시도) 오버레이 — 참고 이미지 스타일 적용 */}
      {showRetryOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-[#1e1e22] w-full max-w-sm rounded-[2.5rem] p-7 shadow-2xl border border-white/5 space-y-7 animate-in zoom-in-95 duration-300">

            {/* 방향성 입력창 */}
            <div className="space-y-3">
              <div className="flex flex-col gap-1 px-1">
                <span className="text-white text-xs font-black">원하는 답변 방향을 적어주세요</span>
                <span className="text-white text-[9px] font-bold opacity-80">선택한 모델에 맞는 DT가 소모됩니다</span>
              </div>
              <div className="bg-[#121214] rounded-3xl p-5 border border-white/5 group focus-within:border-violet-500/50 transition-all">
                <textarea
                  value={retryGuidance}
                  onChange={e => setRetryGuidance(e.target.value)}
                  placeholder="예: 조금 더 다정하게 말해줘"
                  className="w-full bg-transparent border-none text-white text-[13px] font-medium outline-none resize-none min-h-[120px] placeholder:text-slate-700 leading-relaxed"
                  autoFocus
                />
                <div className="flex justify-end pt-2">
                  <span className="text-[9px] font-black text-slate-700 tracking-widest">{retryGuidance.length} / 500</span>
                </div>
              </div>
            </div>

            {/* 액션 버튼 섹션 */}
            <div className="space-y-4">
              <button
                onClick={handleRegenerate}
                className="w-full py-4 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] shadow-xl shadow-violet-900/30"
              >
                <RotateCcw size={18} /> 재생성하기
              </button>

              <div className="relative">
                <div className="w-full flex items-center justify-between bg-white/5 border border-white/5 rounded-2xl px-5 py-4 hover:bg-white/10 transition-colors">
                  <div className="flex items-center gap-3 shrink-0">
                    <Zap size={16} className="text-violet-400" />
                    <span className="text-sm font-bold text-slate-300 whitespace-nowrap">모델 변경하기</span>
                  </div>
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="text-[10px] font-black text-slate-500 truncate">{model.replace('-vertex','').toUpperCase()}</span>
                    <ChevronDown size={14} className="text-slate-600 shrink-0" />
                  </div>
                </div>
                <select
                  value={model}
                  onChange={e => { setModel(e.target.value); if (activeTopic) localStorage.setItem(`dive_chat_model_${activeTopic.id}`, e.target.value); }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                >
                  <option value="gemini-3.1-flash-lite-preview-vertex">Free (Gemini 3.1 Flash-Lite)</option>
                  <option value="gemini-3-flash-preview-vertex">Gemini 3 Flash · 25 DT</option>
                  <option value="gemini-2.5-pro-vertex">Gemini 2.5 Pro · 50 DT</option>
                  <option value="gemini-3.1-pro-preview-vertex">Gemini 3.1 Pro · 90 DT</option>
                  <option value="gpt-5.4">GPT-5.4 · 110 DT</option>
                </select>
              </div>
            </div>

            {/* 하단 닫기 */}
            <div className="flex justify-center">
              <button
                onClick={() => { setShowRetryOverlay(false); setRetryGuidance(''); }}
                className="text-white hover:text-white/80 text-[11px] font-black tracking-widest transition-colors"
              >
                취소하고 돌아가기
              </button>
            </div>
          </div>
        </div>
      )}
      {/* AI 모델 선택 모달 — 참고 이미지 디자인 적용 */}
      {showModelModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-[#1e1e22] w-full max-w-lg rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/5 flex flex-col animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between px-8 py-6 border-b border-white/5">
              <h2 className="text-white text-lg font-black tracking-tight">AI 모델 선택</h2>
              <button onClick={() => setShowModelModal(false)} className="p-2 hover:bg-white/5 rounded-full transition-all">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar max-h-[60vh]">
              {[
                { id: 'gemini-3.1-flash-lite-preview-vertex', name: 'Gemini 3.1 Flash-Lite', cost: 'Free', desc: '가장 빠르고 가벼운 무료 AI 모델' },
                { id: 'gemini-3-flash-preview-vertex', name: 'Gemini 3 Flash', cost: '25 DT', desc: '빠른 응답과 풍부한 지식을 갖춘 모델' },
                { id: 'gemini-2.5-pro-vertex', name: 'Gemini 2.5 Pro', cost: '50 DT', desc: '최신 고성능 AI 모델로 장문의 대화에 적합' },
                { id: 'gemini-3.1-pro-preview-vertex', name: 'Gemini 3.1 Pro', cost: '90 DT', desc: '향상된 성능과 표현력을 갖춘 최신 AI 모델' },
                { id: 'gpt-5.4', name: 'GPT-5.4', cost: '110 DT', desc: '최고 수준의 지능과 창의적인 대화를 제공하는 플래그십 모델' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setModel(m.id); if (activeTopic) localStorage.setItem(`dive_chat_model_${activeTopic.id}`, m.id); setShowModelModal(false); }}
                  className={`w-full text-left p-6 rounded-3xl transition-all flex items-center justify-between group ${model === m.id ? 'bg-white/10 ring-1 ring-white/10' : 'hover:bg-white/5'}`}
                >
                  <div className="space-y-1.5">
                    <h3 className="text-white font-black text-sm">{m.name}</h3>
                    <p className={`text-[11px] font-black ${m.cost === 'Free' ? 'text-emerald-400' : 'text-rose-500'}`}>
                      {m.cost} {m.cost !== 'Free' && '소모'}
                    </p>
                    <p className="text-[11px] text-slate-400 font-medium">{m.desc}</p>
                  </div>
                  {model === m.id && (
                    <div className="w-6 h-6 bg-rose-500 rounded-full flex items-center justify-center shadow-lg animate-in fade-in scale-in duration-300">
                      <Check size={14} className="text-white" strokeWidth={4} />
                    </div>
                  )}
                </button>
              ))}
            </div>
            
            <div className="p-6 bg-white/5 border-t border-white/5">
              <p className="text-[10px] text-slate-500 text-center font-medium">
                모델을 변경하면 다음 대화부터 즉시 적용됩니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 시나리오 정보 모달 */}
      {showScenarioInfo && activeTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md" onClick={() => setShowScenarioInfo(false)}>
          <div className="bg-[#141418] rounded-[2rem] shadow-2xl border border-white/8 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
              <h2 className="text-sm font-black text-white/90 tracking-wide">{activeTopic.title || '시나리오 정보'}</h2>
              <button onClick={() => setShowScenarioInfo(false)} className="p-1.5 hover:bg-white/10 rounded-xl transition-all text-white/40 hover:text-white/70"><X size={15} /></button>
            </div>
            {/* 바디 */}
            <div className="overflow-y-auto px-6 py-5 space-y-4 custom-scrollbar">
              {/* 태그 */}
              <div className="flex items-center gap-2 flex-wrap">
                {activeTopic.content_type && (
                  <span className="text-[10px] font-black tracking-widest uppercase px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/20 to-indigo-500/20 border border-violet-400/20 text-violet-300 shadow-sm shadow-violet-900/20">{activeTopic.content_type}</span>
                )}
                {activeTopic.genre && (
                  <span className="text-[10px] font-black tracking-widest uppercase px-3.5 py-1.5 rounded-lg bg-white/6 border border-white/12 text-white/50">{activeTopic.genre}</span>
                )}
                {activeTopic.classic_country && (
                  <span className="text-[10px] font-black tracking-widest uppercase px-3.5 py-1.5 rounded-lg bg-white/6 border border-white/12 text-white/50">{activeTopic.classic_country}</span>
                )}
                {(() => {
                  const sl = activeTopic.game_state?.story_length ?? activeTopic.story_length;
                  return (
                    <span className={`text-[10px] font-black tracking-widest uppercase px-3.5 py-1.5 rounded-lg border ${
                      sl === 'short' ? 'bg-orange-500/15 border-orange-500/30 text-orange-300' :
                      sl === 'long'  ? 'bg-blue-500/15 border-blue-500/30 text-blue-300' :
                                       'bg-white/6 border-white/12 text-white/50'
                    }`}>
                      {sl === 'short' ? '단편' : sl === 'long' ? '장편' : '중편'}
                    </span>
                  );
                })()}
              </div>
              {/* 원작자 (갤러리에서 가져온 시나리오) */}
              {activeTopic.source_author_name && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/4 border border-white/8">
                  <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">원작</span>
                  <span className="text-xs font-bold text-violet-300">{activeTopic.source_author_name}</span>
                </div>
              )}
              {/* 본문 */}
              {(activeTopic.intro_display || activeTopic.scenario?.기) && (
                <p className="text-[12px] text-white/60 leading-relaxed whitespace-pre-wrap break-keep [text-wrap:pretty]">
                  {activeTopic.intro_display || activeTopic.scenario?.기}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 다시 하기 모달 */}
      {showReplayModal && activeTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md" onClick={() => setShowReplayModal(false)}>
          <div className="bg-[#141418] rounded-[2rem] shadow-2xl border border-white/8 w-full max-w-sm mx-4 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
              <h2 className="text-sm font-black text-white/90">다시 하기</h2>
              <button onClick={() => setShowReplayModal(false)} className="p-1.5 hover:bg-white/10 rounded-xl transition-all text-white/40 hover:text-white/70"><X size={15} /></button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* 안내 문구 */}
              <div className="flex items-start gap-2.5 bg-violet-500/8 border border-violet-500/20 rounded-xl px-4 py-3">
                <Info size={14} className="text-violet-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-violet-300/80 font-medium leading-relaxed">
                  현재 채팅방은 그대로 유지되고,<br />새로운 채팅방이 생성됩니다.
                </p>
              </div>
              {/* 스토리 길이 선택 */}
              <div className="space-y-2">
                <p className="text-[10px] font-black text-white/25 uppercase tracking-widest">스토리 길이 선택</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'short',  label: '단편', turns: '~20턴', desc: '빠른 결말' },
                    { value: 'normal', label: '중편', turns: '~40턴', desc: '기본 플레이' },
                    { value: 'long',   label: '장편', turns: '~80턴', desc: '깊은 몰입' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setReplayLength(opt.value)}
                      className={`flex flex-col items-center gap-0.5 py-2.5 px-2 rounded-xl border transition-all ${
                        replayLength === opt.value
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
              {/* 확인 버튼 */}
              <button
                onClick={handleReplay}
                disabled={isReplaying}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:opacity-90 disabled:opacity-50 text-white font-black text-sm rounded-2xl transition-all flex items-center justify-center gap-2"
              >
                {isReplaying ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> 생성 중...</> : <><RotateCcw size={14} /> 새 채팅방으로 시작</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 메인 */}
      <div
        className="flex-1 flex flex-col relative min-w-0 overflow-hidden transition-all duration-700"
        style={chatBackground
          ? { backgroundImage: `url(${chatBackground})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { backgroundColor: '#0f172a' }
        }
      >
        <header className={`min-h-14 border-b flex items-center justify-between px-6 py-2 shrink-0 gap-4 ${chatBackground ? 'bg-white/85 backdrop-blur-md border-white/30' : 'bg-white border-slate-100'}`}>
          <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
            <button onClick={() => { openingAbortRef.current?.abort(); setIsLoading(false); onBack?.(); }} className="p-2 hover:bg-slate-50 rounded-full shrink-0"><ChevronLeft size={20} /></button>
            {activeTopic && (
              <h1 className="text-sm font-black text-slate-800 break-words">
                {activeTopic.custom_name || activeTopic.title}
              </h1>
            )}
            {currentStage && (
              <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-black/30 backdrop-blur-sm border border-white/10 shrink-0">
                {(['기','승','전','결'] as const).map((s, i) => {
                  const stageOrder = ['기','승','전','결'];
                  const cur = stageOrder.indexOf(currentStage);
                  const idx = stageOrder.indexOf(s);
                  const isActive = idx === cur;
                  const isPast = idx < cur;
                  return (
                    <React.Fragment key={s}>
                      {i > 0 && (
                        <div className={`w-3 h-px transition-all duration-500 ${isPast || isActive ? 'bg-violet-400/60' : 'bg-white/15'}`} />
                      )}
                      <div className={`relative flex items-center justify-center transition-all duration-500 ${
                        isActive ? 'w-6 h-6' : 'w-5 h-5'
                      }`}>
                        {isActive && (
                          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/40" />
                        )}
                        {isPast && (
                          <div className="absolute inset-0 rounded-full bg-violet-500/20" />
                        )}
                        <span className={`relative text-[10px] font-black tracking-tight transition-all duration-500 ${
                          isActive ? 'text-white' : isPast ? 'text-violet-400/80' : 'text-white/25'
                        }`}>{s}</span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            {(isBgLoading || isStageCharImgLoading) && (
              <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 shrink-0 animate-pulse">
                <div className="w-3 h-3 border-2 border-slate-300 border-t-violet-500 rounded-full animate-spin" />
                {isBgLoading ? '배경 이미지 생성 중' : '캐릭터 이미지 생성 중'}
              </div>
            )}
            {activeTopic && (
              <button onClick={() => setShowScenarioInfo(true)}
                className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-blue-500 hover:bg-blue-50 px-2 py-1 rounded-lg transition-all shrink-0">
                <Info size={11} /> 시나리오 정보
              </button>
            )}
            {activeTopic && (
              <button onClick={() => setShowReplayModal(true)}
                className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-violet-500 hover:bg-violet-50 px-2 py-1 rounded-lg transition-all shrink-0">
                <RotateCcw size={11} /> 다시 하기
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeTopic && (
              <div className="flex items-center gap-2">
                {/* 현재 보유 DT 표시 */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <Coins size={12} className="text-blue-500" />
                  <span className="text-[11px] font-black text-slate-700">
                    {(user?.tokenBalance ?? 0).toLocaleString()} DT
                  </span>
                </div>

                <div className="relative">
                  <button
                    ref={dtBtnRef}
                    onClick={() => {
                      setShowTokenPopup(v => !v);
                    }}
                    className="flex items-center gap-1.5 text-[10px] font-black bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded-lg px-2.5 py-1.5 transition-all">
                    <Zap size={12} /> DT 소모량
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* 대화 영역 */}
        {activeTopic ? (
          <>
            <main className="flex-1 overflow-y-auto pr-6 pl-20 space-y-8 no-scrollbar pb-48 pt-4">
              {/* 시나리오 배경 — 대화 시작 전후 모두 항상 표시 */}
              {(activeTopic.intro_display || activeTopic.scenario?.기) && (
                <div className={`border rounded-3xl px-6 py-5 shadow-sm space-y-3 ${chatBackground ? 'bg-white/80 backdrop-blur-sm border-white/40' : 'bg-slate-50 border-slate-100'}`}>
                  {/* 제목 */}
                  <div className="flex items-center gap-2 group/title">
                    {editingOpeningTitle ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          autoFocus
                          value={openingTitleDraft}
                          onChange={e => setOpeningTitleDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { updateTopicSettings({ title: openingTitleDraft }); setEditingOpeningTitle(false); }
                            if (e.key === 'Escape') setEditingOpeningTitle(false);
                          }}
                          className="flex-1 bg-white border border-blue-300 rounded-xl px-3 py-1.5 text-sm font-black text-slate-800 outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <button onClick={() => { updateTopicSettings({ title: openingTitleDraft }); setEditingOpeningTitle(false); }} className="p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600"><Check size={13} /></button>
                        <button onClick={() => setEditingOpeningTitle(false)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={13} /></button>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-sm font-black text-slate-800 flex-1">{activeTopic.title}</h2>
                        <button
                          onClick={() => { setOpeningTitleDraft(activeTopic.title); setEditingOpeningTitle(true); }}
                          className="opacity-0 group-hover/title:opacity-100 transition-opacity p-1.5 hover:bg-slate-200 text-slate-400 rounded-lg"
                        ><Edit3 size={13} /></button>
                      </>
                    )}
                  </div>
                  <div className="h-px bg-slate-200" />
                  <p className="text-[12px] text-slate-600 leading-relaxed whitespace-pre-wrap break-keep [text-wrap:pretty]">{activeTopic.intro_display || activeTopic.scenario?.기}</p>
                </div>
              )}

              {/* 대화 시작 버튼 */}
              {showOpeningButton && (
                <div className="flex justify-center py-4">
                  <button
                    onClick={startOpening}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-sm rounded-2xl shadow-md transition-all"
                  >
                    <Sparkles size={16} /> 대화 시작
                  </button>
                </div>
              )}
              {(() => {
                const lastAiMsgIdx = messages.reduce((acc: number, m: any, idx: number) =>
                  (m.role === 'assistant' && !m.is_supporting) ? idx : acc, -1);
                return messages.map((msg, i) => (
                msg.role === 'system' ? (
                  <div key={i} className="flex items-center gap-3 my-3 px-4 animate-in slide-in-from-bottom-2">
                    <div className="h-px flex-1 bg-white/20" />
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-white/85 tracking-wide bg-black/55 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/15 shrink-0">
                      <GitFork size={10} className="text-violet-400 shrink-0" />
                      {msg.content}
                    </div>
                    <div className="h-px flex-1 bg-white/20" />
                  </div>
                ) : msg.is_ending ? (
                  /* 엔딩 카드 */
                  <div key={i} className="flex flex-col items-center w-full my-4 animate-in slide-in-from-bottom-2 space-y-4">
                    {/* 엔딩 헤더 — 단계 divider 스타일 */}
                    <div className="flex items-center gap-3 w-full px-2">
                      <div className="h-px flex-1 bg-white/30" />
                      <span className="text-[11px] font-black tracking-[0.25em] uppercase px-4 py-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white/90 border border-white/20 shadow-lg">
                        엔딩
                      </span>
                      <div className="h-px flex-1 bg-white/30" />
                    </div>
                    {/* 엔딩 이미지 */}
                    {msg.ending_image_url ? (
                      <div
                        className="w-full max-w-[90%] relative"
                        onMouseEnter={() => setHoveredEndingImgChat(true)}
                        onMouseLeave={() => setHoveredEndingImgChat(false)}
                      >
                        <div
                          className="overflow-hidden rounded-[2rem] cursor-pointer shadow-md"
                          onClick={() => setFullViewImage({ src: msg.ending_image_url, alt: '엔딩 이미지' })}
                        >
                          <img src={msg.ending_image_url} alt="엔딩 이미지" className="w-full object-contain" />
                        </div>
                        {hoveredEndingImgChat && (
                          <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-b from-black/30 via-transparent to-black/30 pointer-events-none" />
                        )}
                        {hoveredEndingImgChat && (
                          <div className="absolute top-2 right-2 flex items-center gap-1">
                            <button
                              className="w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-amber-500 transition-colors"
                              title="이미지 재생성"
                              onClick={e => { e.stopPropagation(); setEndingImgRegenConfirm(true); }}
                              disabled={isEndingImgRegenerating}
                            >
                              {isEndingImgRegenerating
                                ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                : <RotateCcw size={12} />}
                            </button>
                            <button
                              className="w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-500 transition-colors"
                              title="이미지 삭제"
                              onClick={e => {
                                e.stopPropagation();
                                const endingImgs: string[] = Array.isArray(activeTopic?.ending_images) && activeTopic.ending_images.length > 0
                                  ? activeTopic.ending_images
                                  : activeTopic?.ending_image ? [activeTopic.ending_image] : [];
                                const idx = endingImgs.findIndex((u: string) => u === msg.ending_image_url);
                                setEndingImgDeleteConfirm(idx >= 0 ? idx : 0);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    ) : isEndingImageLoading ? (
                      <div className="w-full max-w-[90%] aspect-[4/3] bg-black/30 backdrop-blur-sm rounded-[2rem] flex flex-col items-center justify-center gap-3">
                        <div className="w-8 h-8 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
                        <p className="text-[11px] font-bold text-white/70">엔딩 이미지 생성 중...</p>
                      </div>
                    ) : null}
                    {/* 엔딩 문구 */}
                    <div className="w-full max-w-[90%] bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-[2rem] p-6 shadow-md space-y-3">
                      <p className="text-sm font-medium text-slate-700 leading-relaxed text-center whitespace-pre-wrap">
                        {String(msg.content)}
                      </p>
                      {typeof msg.ending_affinity === 'number' && msg.ending_affinity !== 0 && (
                        <div className="flex justify-center pt-1">
                          <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border text-[11px] font-black tracking-widest uppercase bg-slate-500/10 border-slate-400/30 text-slate-400">
                            <span className="text-[10px]">♥</span>
                            <span>호감도 {msg.ending_affinity > 0 ? '+' : ''}{msg.ending_affinity}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group/msg animate-in slide-in-from-bottom-2`}>
                  {/* 단계 전환 오프닝 헤더 + 캐릭터 이미지 */}
                  {msg.is_stage_opening && (
                    <>
                      <div className="mb-4 flex items-center gap-3 self-stretch justify-center">
                        <div className="h-px flex-1 bg-white/30" />
                        <span className="text-[11px] font-black tracking-[0.25em] uppercase px-4 py-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white/90 border border-white/20 shadow-lg">
                          {msg.stage} 단계
                        </span>
                        <div className="h-px flex-1 bg-white/30" />
                      </div>
                      {(() => {
                        const stageUrls: string[] = (() => {
                          const v = activeTopic?.stage_character_images?.[msg.stage];
                          if (!v) return msg.stage_char_image_url ? [msg.stage_char_image_url] : [];
                          if (Array.isArray(v)) return v;
                          return [v];
                        })();
                        const currentIdx = stageCharImageIndices[msg.stage] ?? (stageUrls.length - 1);
                        const clampedIdx = Math.max(0, Math.min(currentIdx, stageUrls.length - 1));
                        const currentUrl = stageUrls[clampedIdx] ?? null;
                        const isLoading = isStageCharImgLoading && stageCharImgLoadingStage === msg.stage;

                        if (isLoading && stageUrls.length === 0) {
                          return (
                            <div className="w-full max-w-[85%] mb-3 aspect-[3/4] rounded-[1.5rem] bg-violet-50 border border-violet-100 flex flex-col items-center justify-center gap-2">
                              <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
                              <p className="text-[10px] font-bold text-violet-400">캐릭터 이미지 생성 중...</p>
                            </div>
                          );
                        }
                        if (!currentUrl) return null;
                        const hoverKey = `${msg.stage}-${i}`;
                        const isHovered = hoveredStageImg === hoverKey;
                        return (
                          <div
                            className="w-full max-w-[85%] mb-3 relative"
                            onMouseEnter={() => setHoveredStageImg(hoverKey)}
                            onMouseLeave={() => setHoveredStageImg(null)}
                          >
                            <div
                              className="rounded-[1.5rem] overflow-hidden cursor-pointer border border-violet-100 shadow-sm"
                              onClick={() => setFullViewImage({ src: currentUrl, alt: `${msg.stage} 단계` })}
                            >
                              <img src={currentUrl} alt={`${msg.stage} 단계 캐릭터`} className="w-full object-cover" />
                            </div>
                            {/* 오버레이 그라디언트 */}
                            {isHovered && (
                              <div className="absolute inset-0 rounded-[1.5rem] bg-gradient-to-b from-black/30 via-transparent to-black/40 pointer-events-none" />
                            )}
                            {/* 좌우 화살표 */}
                            {stageUrls.length > 1 && isHovered && (
                              <>
                                <button
                                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors disabled:opacity-30"
                                  onClick={e => { e.stopPropagation(); setStageCharImageIndices(prev => ({ ...prev, [msg.stage]: Math.max(0, clampedIdx - 1) })); }}
                                  disabled={clampedIdx === 0}
                                >
                                  <ChevronLeft size={16} />
                                </button>
                                <button
                                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors disabled:opacity-30"
                                  onClick={e => { e.stopPropagation(); setStageCharImageIndices(prev => ({ ...prev, [msg.stage]: Math.min(stageUrls.length - 1, clampedIdx + 1) })); }}
                                  disabled={clampedIdx === stageUrls.length - 1}
                                >
                                  <ChevronRight size={16} />
                                </button>
                              </>
                            )}
                            {/* 상단 우측: 인덱스 + 재생성 + 삭제 */}
                            {isHovered && (
                              <div className="absolute top-2 right-2 flex items-center gap-1">
                                {stageUrls.length > 1 && (
                                  <span className="text-[10px] font-bold text-white bg-black/50 rounded-full px-2 py-0.5">
                                    {clampedIdx + 1}/{stageUrls.length}
                                  </span>
                                )}
                                <button
                                  className="w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-violet-600 transition-colors"
                                  title="이미지 재생성"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setModal({
                                      show: true,
                                      title: '분기 이미지 재생성',
                                      message: '이미지를 재생성하면 15 DT가 소모됩니다.\n계속할까요?',
                                      confirmLabel: '재생성',
                                      variant: 'confirm',
                                      onConfirm: () => regenerateStageCharImage(msg.stage),
                                    });
                                  }}
                                  disabled={isLoading}
                                >
                                  {isLoading ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : <RotateCcw size={12} />}
                                </button>
                                <button
                                  className="w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-500 transition-colors"
                                  title="이미지 삭제"
                                  onClick={e => { e.stopPropagation(); setStageImgDeleteConfirm({ stage: msg.stage, index: clampedIdx }); }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}
                  {msg.role === 'assistant' && msg.situation && (
                    <div className="mb-3 max-w-[90%] bg-slate-50/50 p-3 px-4 rounded-2xl border border-slate-100 text-xs text-slate-500 italic leading-relaxed whitespace-pre-wrap">
                      {String(msg.situation)}
                    </div>
                  )}
                  {/* 발화자 이름 + 아바타 */}
                  {msg.role === 'assistant' && !msg.is_stage_opening && (() => {
                    if (msg.is_supporting && msg.speaker_name) {
                      return (
                        <div className="flex items-center gap-1.5 mb-1 ml-1">
                          <span className="text-[10px] font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">{msg.speaker_name}</span>
                        </div>
                      );
                    }
                    const aiName = activeTopic?.ai_character?.name || 'AI';
                    const aiImg = activeTopic?.ai_character?.image || activeTopic?.character_info?.image || null;
                    return (
                      <div className="flex items-center gap-1.5 mb-1 ml-1">
                        <div
                          onClick={() => aiImg && setFullViewImage({ src: aiImg, alt: aiName })}
                          className={`w-8 h-8 rounded-full overflow-hidden border border-slate-100 shadow-sm shrink-0 flex items-center justify-center text-[10px] font-black transition-all ${aiImg ? 'cursor-pointer hover:ring-2 hover:ring-blue-400' : 'bg-slate-200 text-slate-400'}`}
                        >
                          {aiImg ? <img src={aiImg} alt={aiName} style={{ objectPosition: 'top' }} className="w-full h-full object-cover" /> : aiName[0].toUpperCase()}
                        </div>
                        <span className="text-[10px] font-black text-slate-400">{aiName}</span>
                      </div>
                    );
                  })()}
                  {msg.role === 'user' && (() => {
                    const userName = activeTopic?.user_character?.name || user?.name || '나';
                    const userImg = activeTopic?.user_character?.image || activeTopic?.character_info?.user_image || null;
                    return (
                      <div className="flex items-center gap-1.5 mb-1 mr-1">
                        <span className="text-[10px] font-black text-blue-400">{userName}</span>
                        <div
                          onClick={() => userImg && setFullViewImage({ src: userImg, alt: userName })}
                          className={`w-8 h-8 rounded-full overflow-hidden border border-blue-100 shadow-sm shrink-0 flex items-center justify-center text-[10px] font-black transition-all ${userImg ? 'cursor-pointer hover:ring-2 hover:ring-blue-400' : 'bg-blue-100 text-blue-400'}`}
                        >
                          {userImg ? <img src={userImg} alt={userName} style={{ objectPosition: 'top' }} className="w-full h-full object-cover" /> : userName[0].toUpperCase()}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="relative max-w-[85%]">
                    <div className={`p-4 px-5 rounded-[2rem] text-sm font-medium leading-relaxed shadow-sm whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-none'
                        : msg.is_stage_opening
                        ? `rounded-tl-none border border-violet-200 ${chatBackground ? 'bg-violet-50/90 backdrop-blur-sm' : 'bg-violet-50'} text-slate-800`
                        : msg.is_supporting
                        ? `rounded-tl-none border ${chatBackground ? 'bg-amber-50/90 backdrop-blur-sm border-amber-100/50' : 'bg-amber-50 border-amber-100'} text-slate-800`
                        : `rounded-tl-none border ${chatBackground ? 'bg-white/90 backdrop-blur-sm border-white/50' : 'bg-white border-slate-100'} text-slate-800`
                    }`}>
                      {String(msg.content)}
                    </div>
                    <div className="absolute -left-16 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover/msg:opacity-100 transition-all">
                      {msg.role === 'assistant' && msg.id && (
                        <div className="relative group/fork">
                          <button
                            onClick={() => setShowDuplicateConfirm({ show: true, messageId: msg.id })}
                            className="p-1.5 bg-white border border-slate-100 rounded-full text-slate-300 hover:text-violet-500 hover:border-violet-200 transition-all shadow-sm"
                          >
                            <GitFork size={12} />
                          </button>
                          <div className="absolute left-8 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg pointer-events-none opacity-0 group-hover/fork:opacity-100 transition-opacity z-50 w-24 text-center">
                            채팅방 복제
                          </div>
                        </div>
                      )}
                      
                      {msg.role === 'assistant' && !msg.is_supporting && i === lastAiMsgIdx && (
                        <div className="relative group/retry">
                          <button
                            onClick={() => { setRetryMessageId(msg.id); setShowRetryOverlay(true); }}
                            className="p-1.5 bg-white border border-slate-100 rounded-full text-slate-300 hover:text-blue-500 transition-all shadow-sm"
                          >
                            <RotateCcw size={12} />
                          </button>
                          <div className="absolute left-8 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg pointer-events-none opacity-0 group-hover/retry:opacity-100 transition-opacity z-50 w-24 text-center">
                            답변 재생성
                          </div>
                        </div>
                      )}

                      <div className="relative group/delete">
                        <button onClick={() => deleteMessageBranch(msg.id)}
                          className="p-1.5 bg-white border border-slate-100 rounded-full text-slate-300 hover:text-red-500 transition-all shadow-sm">
                          <Trash2 size={12} />
                        </button>
                        <div className="absolute left-8 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg pointer-events-none opacity-0 group-hover/delete:opacity-100 transition-opacity z-50 w-20 text-center">
                          대화 삭제
                        </div>
                      </div>
                    </div>

                    {/* 버전 선택 UI (재생성 시에만 표시) */}
                    {msg.role === 'assistant' && !msg.is_supporting && msg.parent_id && (msg.max_version ?? 1) > 1 && (
                      <div className="flex items-center gap-2 mt-2 ml-1">
                        <div className="flex items-center bg-slate-100 rounded-full px-2 py-0.5 border border-slate-200 shadow-sm">
                          <button 
                            onClick={() => switchMessageVersion(activeTopic.id, msg.parent_id!, 'prev')}
                            className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
                          >
                            <ChevronLeft size={10} />
                          </button>
                          <span className="text-[9px] font-black text-slate-600 px-1.5 min-w-[30px] text-center">
                            {msg.version ?? 1} / {msg.max_version ?? 1}
                          </span>
                          <button 
                            onClick={() => switchMessageVersion(activeTopic.id, msg.parent_id!, 'next')}
                            className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
                          >
                            <ChevronRight size={10} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {msg.role === 'assistant' && msg.suggested_actions?.length > 0 && (
                    <div className="mt-2 flex gap-2 flex-wrap max-w-[85%]">
                      {msg.suggested_actions.map((action: string, idx: number) => (
                        <button key={idx} onClick={() => sendMessage(action)}
                          className="text-[10px] font-black bg-slate-50 hover:bg-blue-50 text-slate-500 hover:text-blue-600 border border-slate-200 px-3 py-1.5 rounded-xl transition-all">
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                )
              ));
              })()}

              {/* 스트리밍 중 텍스트 */}
              {(isLoading || streamingText) && (
                <div className="flex flex-col items-start animate-in slide-in-from-bottom-2">
                  <div className="text-[10px] font-black text-slate-400 mb-1 ml-1">
                    {activeTopic?.ai_character?.name || 'AI'}
                  </div>
                  <div className="p-4 px-5 bg-white text-slate-800 rounded-[2rem] rounded-tl-none border border-slate-100 text-sm font-medium leading-relaxed shadow-sm max-w-[85%] whitespace-pre-wrap">
                    {streamingText || (
                      <div className="flex gap-1 items-center text-slate-400">
                        <span className="text-xs font-bold">생각하는 중</span>
                        {[0, 1, 2].map(j => (
                          <div key={j} className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: `${j * 150}ms` }} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </main>
            <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-slate-900/75 backdrop-blur-xl border-t border-white/10">
              <div className="max-w-3xl mx-auto space-y-3 relative">
                {/* 힌트 카드 & 추천 답변 패널 — absolute 부유, 흰 배경 영역 확장 없이 채팅 위에 표시 */}
                {(hintCard || showSuggestMenu) && (
                  <div className="absolute bottom-full left-0 right-0 pb-2 z-10 space-y-2">
                    {/* 힌트 카드 */}
                    {hintCard && !isEnded && (
                      <div className="flex justify-center animate-in slide-in-from-bottom-3 duration-500">
                        <div className="relative group max-w-xl w-full mx-4">
                          {/* 글로우 효과 */}
                          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-violet-500/20 via-purple-500/20 to-indigo-500/20 blur-md" />
                          <div className="relative flex items-center gap-3 px-5 py-3 rounded-2xl bg-black/60 backdrop-blur-md border border-violet-400/30 shadow-lg shadow-violet-900/30">
                            {/* 좌측 아이콘 장식 */}
                            <div className="shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center shadow-sm shadow-violet-500/50">
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.976.223-1.77.7-2.437A5 5 0 1010.064 6.3 5.003 5.003 0 008 10a5 5 0 002.85 4.487c.447.223.15.513 1.15.513z" />
                              </svg>
                            </div>
                            {/* 텍스트 */}
                            <span className="text-[12px] font-semibold text-violet-200/90 tracking-wide leading-relaxed flex-1 text-center">
                              {hintCard}
                            </span>
                            {/* 우측 닫기 버튼 */}
                            <button
                              onClick={() => setHintCard(null)}
                              className="shrink-0 w-4 h-4 flex items-center justify-center text-violet-400/50 hover:text-violet-300 transition-colors"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* 추천 답변 패널 */}
                    {showSuggestMenu && (
                      <div className="bg-slate-800/95 border border-white/15 rounded-2xl shadow-lg p-3 space-y-2 animate-in slide-in-from-bottom-2 backdrop-blur-md">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-black text-white/50 uppercase tracking-wider">추천 답변</span>
                          <div className="flex items-center gap-2">
                            <button onClick={refreshSuggestedReplies} disabled={isSuggestLoading} className="text-white/30 hover:text-amber-400 text-sm leading-none disabled:opacity-30" title="새로 생성">🔄</button>
                            <button onClick={() => setShowSuggestMenu(false)} className="text-white/30 hover:text-white/60 text-base leading-none font-black">✕</button>
                          </div>
                        </div>
                        {isSuggestLoading ? (
                          <div className="text-center py-3 text-[11px] text-slate-400 font-bold">생성 중...</div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {suggestedReplies.map((r, i) => {
                              const colors: Record<string, string> = {
                                긍정: 'border-emerald-500/30 hover:bg-emerald-500/15 hover:border-emerald-400/50 hover:text-emerald-300',
                                부정: 'border-red-500/30 hover:bg-red-500/15 hover:border-red-400/50 hover:text-red-300',
                                중립: 'border-white/15 hover:bg-white/10 hover:border-white/25 hover:text-white/90',
                                엉뚱: 'border-violet-500/30 hover:bg-violet-500/15 hover:border-violet-400/50 hover:text-violet-300',
                              };
                              const badges: Record<string, string> = {
                                긍정: 'bg-emerald-500/20 text-emerald-300',
                                부정: 'bg-red-500/20 text-red-300',
                                중립: 'bg-white/10 text-white/50',
                                엉뚱: 'bg-violet-500/20 text-violet-300',
                              };
                              return (
                                <button
                                  key={i}
                                  onClick={() => { setShowSuggestMenu(false); sendMessage(r.text, false, false, undefined, false, r.type); }}
                                  className={`text-left p-3 rounded-xl border text-white/70 transition-all space-y-1.5 ${colors[r.type] ?? 'border-white/15 hover:bg-white/10'}`}
                                >
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${badges[r.type] ?? 'bg-slate-100 text-slate-500'}`}>{r.type}</span>
                                  <p className="text-[11px] font-semibold leading-snug">{r.text}</p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* 단계 전환 / 엔딩 / 호감도 안내 */}
                {(isStageTransitioning || isEndingLoading || isAffinityImageLoading) && (
                  <div className="flex items-center justify-center gap-2 px-4 py-2 mb-1">
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin shrink-0" />
                    <span className="text-[11px] font-bold text-white/80">
                      {isEndingLoading
                        ? '엔딩으로 전환하는 중입니다. 잠시만 기다려주세요.'
                        : isAffinityImageLoading
                        ? '특별한 순간을 담은 일러스트를 완성하고 있습니다. 잠시만 기다려주세요.'
                        : '다음 단계로 전환되고 있습니다. 잠시만 기다려주세요.'}
                    </span>
                  </div>
                )}
                {/* AI 성향 + 자동진행 + 추천답변 + BGM UI — 스크린샷 020343.png 기반 완벽 가로 정렬 (스크롤 없이 한 줄) */}
                <div className="flex items-center gap-1.5 px-1 flex-nowrap py-1 relative z-30">
                  <div className="relative group/tone-tip shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setShowToneMenu(v => !v); }}
                      disabled={isLoading}
                      className={`flex items-center gap-1 px-2 py-1 rounded-xl border text-[11px] font-black transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                        diceRoll ? 'bg-violet-500/20 border-violet-400/50 text-violet-300'
                        : tone === 'positive' ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                        : tone === 'negative' ? 'bg-red-500/20 border-red-400/50 text-red-300'
                        : tone === 'neutral' ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                        : 'bg-white/10 border-white/20 hover:border-blue-400/60 hover:text-blue-300 text-white/70'
                      }`}
                    >
                      {diceRoll
                        ? <>{getDiceIcon(diceRoll, 13)} {diceRoll}</>
                        : tone === 'positive' ? '😊 긍정적'
                        : tone === 'negative' ? '😤 부정적'
                        : tone === 'neutral' ? '😐 중립적'
                        : '🎭 AI 성향'}
                      <span className={`transition-transform duration-150 ${showToneMenu ? 'rotate-180' : ''}`}>▾</span>
                    </button>
                    {!showToneMenu && (
                      <div className="absolute bottom-full mb-3 left-0 z-[100] pointer-events-none opacity-0 group-hover/tone-tip:opacity-100 transition-opacity duration-150">
                        <div className="bg-slate-800 text-white text-[10px] font-medium px-3 py-2 rounded-xl whitespace-nowrap leading-relaxed shadow-2xl border border-white/10">
                          <p className="font-black text-[11px] mb-1">🎭 AI 성향</p>
                          <p>상대 캐릭터의 이번 답변 성향을 설정합니다.</p>
                          <p className="text-slate-300 mt-0.5">없음 — 기본 페르소나 그대로</p>
                          <p className="text-slate-300">긍정·중립·부정 — 지속 적용됨</p>
                          <p className="text-slate-300">Random — 이번 한 턴만 무작위 성향</p>
                        </div>
                        <div className="w-2 h-2 bg-slate-800 rotate-45 ml-4 -mt-1 border-r border-b border-white/10" />
                      </div>
                    )}
                    {showToneMenu && (
                      <div className="absolute bottom-full mb-2 left-0 bg-slate-800/95 border border-white/15 rounded-2xl shadow-xl p-1.5 flex flex-col gap-1 z-[110] min-w-[100px] backdrop-blur-md" onClick={e => e.stopPropagation()}>
                        {[
                          { value: '', label: '없음', color: 'text-white/70' },
                          { value: 'positive', label: '긍정적', color: 'text-emerald-300' },
                          { value: 'neutral', label: '중립적', color: 'text-amber-300' },
                          { value: 'negative', label: '부정적', color: 'text-red-300' },
                        ].map(opt => (
                          <button key={opt.value}
                            onClick={() => { setTone(opt.value); updateTopicSettings({ tone_preference: opt.value }); setDiceRoll(null); setShowToneMenu(false); }}
                            className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all text-left hover:bg-white/10 border border-transparent hover:border-white/20 ${opt.color} ${tone === opt.value && !diceRoll ? 'bg-white/10 border-white/20' : ''}`}
                          >{opt.label}</button>
                        ))}
                        <div className="border-t border-white/10 mt-0.5 pt-0.5">
                          <button
                            onClick={() => { setDiceRoll(Math.ceil(Math.random() * 6)); setTone(''); updateTopicSettings({ tone_preference: '' }); setShowToneMenu(false); }}
                            className={`w-full px-3 py-1.5 rounded-xl text-[11px] font-black transition-all text-left hover:bg-violet-500/20 border border-transparent hover:border-violet-400/50 text-violet-300 flex items-center gap-1.5 ${diceRoll ? 'bg-violet-500/20 border-violet-400/50' : ''}`}
                          ><Dices size={13} /> Random</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative group/auto-tip shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setShowAutoMenu(v => !v); }}
                      disabled={isLoading || showOpeningButton || isEnded}
                      className="flex items-center gap-1 px-2 py-1 rounded-xl border text-[11px] font-black transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/10 border-white/20 hover:border-blue-400/60 hover:text-blue-300 text-white/70"
                    >
                      ⚡ 자동 진행
                      <span className={`transition-transform duration-150 ${showAutoMenu ? 'rotate-180' : ''}`}>▾</span>
                    </button>
                    {!showAutoMenu && (
                      <div className="absolute bottom-full mb-3 left-0 z-[100] pointer-events-none opacity-0 group-hover/auto-tip:opacity-100 transition-opacity duration-150">
                        <div className="bg-slate-800 text-white text-[10px] font-medium px-3 py-2 rounded-xl whitespace-nowrap leading-relaxed shadow-2xl border border-white/10">
                          <p className="font-black text-[11px] mb-1">⚡ 자동 진행</p>
                          <p>AI가 선택한 턴 수만큼 자동으로 이야기를 이어갑니다.</p>
                          <p className="text-slate-300 mt-0.5">중간에 입력하면 자동 진행이 중단됩니다.</p>
                        </div>
                        <div className="w-2 h-2 bg-slate-800 rotate-45 ml-4 -mt-1 border-r border-b border-white/10" />
                      </div>
                    )}
                    {showAutoMenu && (
                      <div className="absolute bottom-full mb-2 left-0 bg-slate-800/95 border border-white/15 rounded-2xl shadow-xl p-1.5 flex gap-1.5 z-[110] backdrop-blur-md" onClick={e => e.stopPropagation()}>
                        {[1, 2, 3].map(n => (
                          <button
                            key={n}
                            onClick={() => {
                              setShowAutoMenu(false);
                              autoTurnsRef.current = n - 1;
                              sendMessage('(계속 진행해줘)', true, true);
                            }}
                            className="px-4 py-2 rounded-xl text-[11px] font-black transition-all bg-white/10 hover:bg-blue-500/20 hover:text-blue-300 border border-white/20 hover:border-blue-400/50 text-white/70 whitespace-nowrap"
                          >
                            {n}턴
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative group/suggest-tip shrink-0">
                    <button
                      onClick={fetchSuggestedReplies}
                      disabled={isLoading || isSuggestLoading || showOpeningButton || isEnded}
                      className="flex items-center gap-1 px-2 py-1 rounded-xl border text-[11px] font-black transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/10 border-white/20 hover:border-amber-400/60 hover:text-amber-300 text-white/70"
                    >
                      💡 추천 답변
                    </button>
                    <div className="absolute bottom-full mb-3 left-0 z-[100] pointer-events-none opacity-0 group-hover/suggest-tip:opacity-100 transition-opacity duration-150">
                      <div className="bg-slate-800 text-white text-[10px] font-medium px-3 py-2 rounded-xl whitespace-nowrap leading-relaxed shadow-2xl border border-white/10">
                        <p className="font-black text-[11px] mb-1">💡 추천 답변</p>
                        <p>현재 상황에 어울리는 유저 답변 예시를 생성합니다.</p>
                        <p className="text-slate-300 mt-0.5">마음에 드는 답변을 선택하면 바로 입력됩니다.</p>
                      </div>
                      <div className="w-2 h-2 bg-slate-800 rotate-45 ml-4 -mt-1 border-r border-b border-white/10" />
                    </div>
                  </div>

                  {/* 배경 이미지 버튼 */}
                  <div className="relative group/bg-tip shrink-0">
                    <button
                      onClick={() => { setBgImgSelectedStage(activeTopic?.game_state?.current_stage || '기'); setShowBgImgModal(true); }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-xl border text-[11px] font-black transition-all ${isBgLoading ? 'bg-violet-500/15 border-violet-400/40 text-violet-300 animate-pulse' : 'bg-white/10 border-white/20 hover:border-violet-400/60 hover:text-violet-300 text-white/70'}`}
                    >
                      {isBgLoading ? (
                        <>
                          <svg className="animate-spin shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          배경
                        </>
                      ) : '🖼️ 배경'}
                    </button>
                    <div className="absolute bottom-full mb-3 left-0 z-[100] pointer-events-none opacity-0 group-hover/bg-tip:opacity-100 transition-opacity duration-150">
                      <div className="bg-slate-800 text-white text-[10px] font-medium px-3 py-2 rounded-xl whitespace-nowrap leading-relaxed shadow-2xl border border-white/10">
                        <p className="font-black text-[11px] mb-1">🖼️ 배경 이미지</p>
                        <p>각 단계별 배경 이미지를 확인하고 변경합니다.</p>
                        <p className="text-slate-300 mt-0.5">단계가 전환될 때 자동으로 생성됩니다.</p>
                      </div>
                      <div className="w-2 h-2 bg-slate-800 rotate-45 ml-4 -mt-1 border-r border-b border-white/10" />
                    </div>
                  </div>

                  {/* BGM 버튼 */}
                  <div className="relative group/bgm-tip shrink-0">
                    <button
                      onClick={() => { setSelectedBgmStage(currentStage || '기'); setShowBgmModal(true); }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-xl border text-[11px] font-black transition-all ${isBgmLoading ? 'bg-blue-500/15 border-blue-400/40 text-blue-300 animate-pulse' : 'bg-white/10 border-white/20 hover:border-blue-400/60 hover:text-blue-300 text-white/70'}`}
                    >
                      {isBgmLoading ? (
                        <>
                          <svg className="animate-spin shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                          BGM
                        </>
                      ) : '🎵 BGM'}
                    </button>
                    <div className="absolute bottom-full mb-3 left-0 z-[100] pointer-events-none opacity-0 group-hover/bgm-tip:opacity-100 transition-opacity duration-150">
                      <div className="bg-slate-800 text-white text-[10px] font-medium px-3 py-2 rounded-xl whitespace-nowrap leading-relaxed shadow-2xl border border-white/10">
                        <p className="font-black text-[11px] mb-1">🎵 배경 음악</p>
                        <p>각 단계별 BGM을 재생하거나 변경합니다.</p>
                        <p className="text-slate-300 mt-0.5">분위기에 맞는 음악으로 몰입감을 높여보세요.</p>
                      </div>
                      <div className="w-2 h-2 bg-slate-800 rotate-45 ml-4 -mt-1 border-r border-b border-white/10" />
                    </div>
                  </div>

                  {/* 시네마틱 버튼 */}
                  <div className="relative group/cinematic-tip shrink-0">
                  <button
                    onClick={() => {
                      if (cinematicUrl) {
                        setShowCinematicModal(true);
                      } else {
                        setModal({
                          show: true,
                          title: '🎬 시네마틱 영상 생성',
                          message: '시나리오 도입부를 시네마틱 영상으로 생성합니다.\n생성에는 약 3~4분이 소요됩니다.\n\n50 DT가 소모됩니다.',
                          confirmLabel: '생성하기',
                          variant: 'confirm',
                          onConfirm: generateCinematic,
                        });
                      }
                    }}
                    disabled={isCinematicLoading}
                    className={`flex items-center gap-1 px-2 py-1 rounded-xl border text-[11px] font-black transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      cinematicUrl
                        ? 'bg-purple-500/20 border-purple-400/50 text-purple-300 hover:bg-purple-500/30 hover:border-purple-400/80'
                        : 'bg-white/10 border-white/20 hover:border-purple-400/60 hover:text-purple-300 text-white/70'
                    }`}
                  >
                    {isCinematicLoading ? (
                      <><span className="animate-spin text-[10px]">⏳</span> 생성 중...</>
                    ) : cinematicUrl ? (
                      <>▶ 시네마틱 재생</>
                    ) : (
                      <>🎬 시네마틱</>
                    )}
                  </button>
                  <div className="absolute bottom-full mb-3 left-0 z-[100] pointer-events-none opacity-0 group-hover/cinematic-tip:opacity-100 transition-opacity duration-150">
                    <div className="bg-slate-800 text-white text-[10px] font-medium px-3 py-2 rounded-xl whitespace-nowrap leading-relaxed shadow-2xl border border-white/10">
                      <p className="font-black text-[11px] mb-1">🎬 시네마틱 영상</p>
                      <p>시나리오 도입부를 짧은 영상으로 생성합니다.</p>
                      <p className="text-slate-300 mt-0.5">시네마틱 영상을 감상하고 대화를 시작해보세요.</p>
                      <p className="text-amber-400 font-black mt-1">50 DT 소모</p>
                    </div>
                    <div className="w-2 h-2 bg-slate-800 rotate-45 ml-4 -mt-1 border-r border-b border-white/10" />
                  </div>
                  </div>

                  {/* BGM 플레이어 컨트롤러 */}
                  {currentBgm && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-white/10 border border-white/20 rounded-xl animate-in slide-in-from-right-2 shrink-0">
                      <div className="flex items-center gap-1.5 pr-1.5 border-r border-white/20 shrink-0">
                        <span className="text-[11px] font-black text-white/70">{playingBgmStage || '기'}</span>
                      </div>

                      <button onClick={toggleBgmPlay} className="text-white/70 hover:scale-110 transition-transform shrink-0 mx-0.5">
                        {isBgmPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                      </button>

                      {/* 반복재생 버튼 */}
                      <button
                        onClick={() => setIsBgmLoop(v => !v)}
                        className={`shrink-0 transition-all hover:scale-110 ${isBgmLoop ? 'text-blue-400' : 'text-white/40 hover:text-white/70'}`}
                        title={isBgmLoop ? '반복재생 켜짐' : '반복재생 꺼짐'}
                      >
                        <RotateCcw size={11} strokeWidth={2.5} />
                      </button>

                      {/* 재생 진행 바 + 시간 */}
                      <div className="flex flex-col gap-0.5 w-16 shrink-0">
                        <input
                          type="range" min="0" max="100" value={bgmProgress} onChange={handleBgmProgressChange}
                          className="w-full h-1.5 bg-slate-200 rounded-full appearance-none accent-slate-600 cursor-pointer"
                        />
                        <div className="flex justify-between text-[8px] font-medium text-white/40 px-0.5">
                          <span>{bgmDuration > 0 ? `${Math.floor(bgmCurrentTime/60)}:${String(Math.floor(bgmCurrentTime%60)).padStart(2,'0')}` : '0:00'}</span>
                          <span>{bgmDuration > 0 ? `${Math.floor(bgmDuration/60)}:${String(Math.floor(bgmDuration%60)).padStart(2,'0')}` : '0:00'}</span>
                        </div>
                      </div>

                      {/* 음량 조절 */}
                      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white/10 rounded-full border border-white/20 shrink-0 ml-0.5">
                        <button onClick={toggleBgmVolume} className="text-white/50 hover:text-white/80">
                          {bgmVolume > 0 ? <Volume2 size={11} /> : <VolumeX size={11} />}
                        </button>
                        <input
                          type="range" min="0" max="100" value={bgmVolume * 100} onChange={handleBgmVolumeChange}
                          className="w-10 h-1.5 bg-slate-200 rounded-full appearance-none accent-slate-600 cursor-pointer"
                        />
                      </div>

                      {/* 배속 버튼 */}
                      <div className="relative shrink-0" ref={bgmSpeedMenuRef}>
                        <button
                          onClick={() => setShowBgmSpeedMenu(!showBgmSpeedMenu)}
                          className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-full text-[9px] font-black text-slate-600 hover:bg-slate-50 shadow-sm"
                        >
                          {bgmPlaybackRate.toFixed(1)}x
                        </button>
                        {showBgmSpeedMenu && (
                          <div className="absolute bottom-full right-0 mb-2 w-14 bg-white border border-slate-200 rounded-xl shadow-2xl p-1 z-[120]">
                            {[0.5, 0.8, 1.0, 1.2, 1.5, 2.0].map(rate => (
                              <button key={rate} onClick={() => { setBgmPlaybackRate(rate); setShowBgmSpeedMenu(false); }}
                                className={`w-full text-center py-1 text-[9px] font-black rounded-lg transition-all ${bgmPlaybackRate === rate ? 'bg-slate-800 text-white' : 'hover:bg-slate-50 text-slate-600'}`}>
                                {rate}x
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {diceRoll && (
                    <div className="flex items-center gap-1.5 animate-in slide-in-from-left-2 shrink-0">
                      <span className="text-violet-500 flex items-center gap-1 text-[11px] font-black">
                        {getDiceIcon(diceRoll, 14)} {diceRoll}
                      </span>
                      <span className={`text-[11px] font-black ${diceRoll <= 2 ? 'text-red-500' : diceRoll <= 4 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {diceRoll <= 2 ? '— 부정적' : diceRoll <= 4 ? '— 중립' : '— 긍정적'}
                      </span>
                      <button onClick={() => setDiceRoll(null)} className="text-[10px] text-white/30 hover:text-white/60">✕</button>
                    </div>
                  )}

                  <button 
                    onClick={() => setShowModelModal(true)}
                    className="ml-auto flex items-center gap-1.5 bg-white/10 border border-white/20 hover:border-blue-400/60 rounded-xl px-2 py-1 transition-all group shrink-0"
                  >
                    <div className="w-5 h-5 bg-[#ff4d6a] rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                      <Zap size={10} className="text-white fill-white" />
                    </div>
                    <span className="text-[11px] font-black text-white/80">
                      {model === 'gemini-3.1-pro-preview-vertex' ? '3.1 Pro' :
                       model === 'gemini-3-flash-preview-vertex' ? '3 Flash' :
                       model === 'gemini-2.5-pro-vertex' ? '2.5 Pro' :
                       (model === 'gemini-3.1-flash-lite-preview-vertex' || model === 'gemini-3.1-flash-lite-preview') ? '3.1 Flash-Lite' : 'GPT-5.4'}
                    </span>
                    <ChevronUp size={12} className="text-white/30" />
                  </button>
                </div>

                {/* 대화/행동 가이드 UI */}
                {!isEnded && !showOpeningButton && (
                  <div className="flex items-center gap-2 px-1 pt-1 animate-in fade-in slide-in-from-bottom-1 duration-500">
                    <span className="text-[10px] font-bold text-white/40">
                      대사는 큰 따옴표 안에, 행동이나 상황을 표현하고 싶을 때는 큰 따옴표 없이 써보세요
                    </span>
                    <div className="relative group/guide-tip">
                      <Info size={12} className="text-slate-300 cursor-help hover:text-blue-400 transition-colors" />
                      <div className="absolute bottom-full mb-2 right-0 z-[500] pointer-events-none opacity-0 group-hover/guide-tip:opacity-100 transition-opacity duration-200">
                        <div className="bg-slate-800 text-white text-[10px] font-medium px-4 py-3 rounded-2xl whitespace-nowrap leading-relaxed shadow-xl border border-white/10">
                          <p className="font-black text-blue-400 text-[11px] mb-2">💬 대화 & 행동 가이드</p>
                          <div className="space-y-1.5">
                            <p><span className="text-blue-300 font-black">대사:</span> <span className="bg-white/10 px-1 rounded">"엘라라, 도망쳐!"</span> (큰 따옴표 사용)</p>
                            <p><span className="text-slate-400 font-black">행동:</span> <span className="bg-white/10 px-1 rounded">방 안을 서성거렸다.</span> (큰 따옴표 미사용)</p>
                            <p className="text-[9px] text-slate-400 mt-2 italic">* 대사와 행동을 섞어서 써도 AI가 완벽하게 이해해요!</p>
                          </div>
                        </div>
                        <div className="w-2.5 h-2.5 bg-slate-800 rotate-45 ml-auto mr-1 -mt-1.5 border-r border-b border-white/10" />
                      </div>
                    </div>
                  </div>
                )}

                {isEnded ? (
                  <div className="text-center py-3 text-sm font-bold text-slate-400">
                    이야기가 종료되었습니다. 특정 시점으로 돌아가려면 대화창 왼쪽의 채팅방 복제를 이용하세요.
                  </div>
                ) : (
                  <div className="relative group">
                    <textarea
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      rows={Math.min(input.split('\n').length, 5)}
                      placeholder={showOpeningButton ? '대화 시작을 눌러 대화를 시작해보세요' : '행동이나 대화를 입력하세요... ("대사" 또는 서술 형식)'}
                      disabled={isLoading || showOpeningButton}
                      className={`w-full bg-white/10 border border-white/20 text-white placeholder:text-white/35 rounded-3xl pl-6 pr-14 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-400/60 focus:border-transparent transition-all resize-none overflow-y-auto no-scrollbar ${(isLoading || showOpeningButton) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                    <button onClick={() => sendMessage()} disabled={isLoading || showOpeningButton}
                      className="absolute right-2 top-2 bottom-2 px-5 text-white rounded-2xl shadow-lg disabled:bg-slate-300 flex items-center justify-center transition-colors bg-blue-600 hover:bg-blue-700">
                      <Send size={18} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-300">
            <div className="text-center space-y-3">
              <Sparkles size={32} className="mx-auto opacity-30" />
              <p className="text-sm font-bold">새로운 세계로 다이브하는 중...</p>
            </div>
          </div>
        )}
      </div>

      {/* 오른쪽 사이드바 */}
      <div className="hidden lg:flex w-80 bg-slate-900/90 backdrop-blur-md flex-col overflow-hidden shrink-0 border-l border-white/10">
        {/* 탭 내비게이션 — 2줄 그리드 */}
        <div className="px-3 pt-3 pb-0 space-y-1 border-b border-white/10 bg-slate-800/50">
          {/* 1줄: Status · Summaries · Lorebook */}
          <div className="grid grid-cols-3 gap-1">
            {([
              { id: 'status',    label: 'Status',    icon: <Zap size={13} />,            color: 'blue',   onClick: () => { setActiveTab('status'); setShowSummaryConfirm(false); setShowInnerThoughtConfirm(false); } },
              { id: 'summaries', label: 'Summaries', icon: <MessageSquare size={13} />,  color: 'sky',    onClick: () => { setActiveTab('summaries'); setShowInnerThoughtConfirm(false); } },
              { id: 'lorebook',  label: 'Lorebook',  icon: <Book size={13} />,           color: 'violet', onClick: () => { setActiveTab('lorebook'); if (activeTopic) loadLorebook(activeTopic.id); } },
            ] as const).map(({ id, label, icon, color, onClick }) => {
              const active = activeTab === id;
              const colorMap: Record<string, string> = {
                blue:   active ? 'bg-blue-500 text-white shadow-sm'   : 'text-white/40 hover:text-blue-300 hover:bg-blue-500/20',
                sky:    active ? 'bg-sky-500 text-white shadow-sm'     : 'text-white/40 hover:text-sky-300 hover:bg-sky-500/20',
                violet: active ? 'bg-violet-500 text-white shadow-sm'  : 'text-white/40 hover:text-violet-300 hover:bg-violet-500/20',
              };
              return (
                <button key={id} onClick={onClick} className={`flex flex-col items-center gap-0.5 py-2 rounded-xl text-[9px] font-black tracking-widest uppercase transition-all ${colorMap[color]}`}>
                  {icon}
                  {label}
                </button>
              );
            })}
          </div>
          {/* 2줄: Relation · Gallery */}
          <div className="grid grid-cols-2 gap-1 pb-2">
            {([
              { id: 'relation', label: 'Relation', icon: <GitFork size={13} />,   color: 'rose',  onClick: () => { setActiveTab('relation'); if (activeTopic) loadRelationGraph(activeTopic.id); } },
              { id: 'gallery',  label: 'Album',  icon: <ImageIcon size={13} />, color: 'amber', onClick: () => setActiveTab('gallery') },
            ] as const).map(({ id, label, icon, color, onClick }) => {
              const active = activeTab === id;
              const colorMap: Record<string, string> = {
                rose:  active ? 'bg-rose-500 text-white shadow-sm'   : 'text-white/40 hover:text-rose-300 hover:bg-rose-500/20',
                amber: active ? 'bg-amber-500 text-white shadow-sm'  : 'text-white/40 hover:text-amber-300 hover:bg-amber-500/20',
              };
              return (
                <button key={id} onClick={onClick} className={`flex flex-col items-center gap-0.5 py-2 rounded-xl text-[9px] font-black tracking-widest uppercase transition-all ${colorMap[color]}`}>
                  {icon}
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div ref={sidebarScrollRef} className="flex-1 overflow-y-auto p-5 space-y-8 no-scrollbar">
          {activeTab === 'status' ? (
            <>
              {/* 스토리 단계 */}
              {currentStage && (
                <div className="flex items-center gap-1.5 px-1">
                  {['기', '승', '전', '결'].map(s => {
                    const order = ['기','승','전','결'];
                    const isActive = s === currentStage;
                    const isPast = order.indexOf(s) < order.indexOf(currentStage);
                    return (
                      <div key={s} className="flex-1 flex flex-col items-center gap-1">
                        <div className={`w-full flex items-center justify-center py-1.5 rounded-xl text-[11px] font-black transition-all duration-500 relative overflow-hidden ${
                          isActive
                            ? 'bg-gradient-to-b from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-900/40'
                            : isPast
                            ? 'bg-white/8 text-violet-400/70'
                            : 'bg-white/5 text-white/20'
                        }`}>
                          {isActive && <div className="absolute inset-0 bg-white/10 rounded-xl" />}
                          <span className="relative">{s}</span>
                        </div>
                        <div className={`h-0.5 w-3/4 rounded-full transition-all duration-500 ${
                          isActive ? 'bg-violet-400' : isPast ? 'bg-violet-500/30' : 'bg-white/10'
                        }`} />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 등장인물 기본 정보 */}
              {(activeTopic?.ai_character || activeTopic?.user_character) && (() => {
                type CharEntry = { key: string; label: string; labelColor: string; bgColor: string; borderColor: string; info: any; affinityVal: number | null };
                const chars: CharEntry[] = [];
                
                // 상대 캐릭터 데이터 매핑
                if (activeTopic?.ai_character) {
                  const v = activeTopic?.affinity !== undefined ? activeTopic.affinity : (activeTopic?.affection ?? 50) * 2 - 100;
                  const aiCharData = {
                    ...activeTopic.ai_character,
                    image: activeTopic.ai_character.image || activeTopic.character_info?.image
                  };
                  chars.push({ key: activeTopic.ai_character.name, label: '상대', labelColor: 'text-indigo-300', bgColor: 'bg-indigo-500/10', borderColor: 'border-indigo-500/20', info: aiCharData, affinityVal: v });
                }

                // 유저 캐릭터 데이터 매핑 (이미지 포함)
                if (activeTopic?.user_character) {
                  const userCharData = {
                    ...activeTopic.user_character,
                    // 유저 캐릭터의 이미지를 topic 레벨이나 캐릭터 객체 내부에서 모두 탐색
                    image: activeTopic.user_character.image || activeTopic.character_info?.user_image
                  };
                  chars.push({ key: activeTopic.user_character.name, label: '나', labelColor: 'text-white/50', bgColor: 'bg-white/5', borderColor: 'border-white/10', info: userCharData, affinityVal: null });
                }

                // 조연 캐릭터 데이터 매핑
                (activeTopic?.supporting_cast ?? []).forEach((c: any) => {
                  chars.push({ key: c.name, label: '조연', labelColor: 'text-amber-300', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20', info: c, affinityVal: null });
                });

                const affinityLabel = (v: number) => {
                  if (v >= 60) return { text: '매우 우호적', color: 'text-violet-500' };
                  if (v >= 20) return { text: '우호적', color: 'text-blue-400' };
                  if (v >= -20) return { text: '중립', color: 'text-slate-400' };
                  if (v >= -60) return { text: '경계심', color: 'text-orange-400' };
                  return { text: '적대적', color: 'text-red-400' };
                };

                return (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2"><div className="w-1.5 h-4 bg-indigo-400 rounded-full" /><h3 className="text-sm font-black text-white/80 uppercase">등장인물</h3></div>
                    <div className="space-y-2">
                      {chars.map(({ key, label, labelColor, bgColor, borderColor, info, affinityVal }) => {
                        const isExpanded = expandedChars.has(key);
                        const hasMore = !!(info.personality || info.background || info.appearance) || affinityVal !== null;
                        const aff = affinityLabel(affinityVal ?? 0);
                        const affPct = affinityVal !== null ? Math.max(0, Math.min(100, Math.floor((affinityVal + 100) / 2))) : null;
                        return (
                          <div
                            key={key}
                            className={`${bgColor} border ${borderColor} rounded-2xl p-3 space-y-2.5 ${hasMore ? 'cursor-pointer' : ''}`}
                            onClick={() => {
                              if (!hasMore) return;
                              setExpandedChars(prev => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key); else next.add(key);
                                return next;
                              });
                            }}
                          >
                            <div className="flex items-center gap-2">
                              {/* 프로필 이미지 (이미지 있을 때만 표시) */}
                              {info.image && (
                                <div
                                  onClick={(e) => { e.stopPropagation(); setFullViewImage({ src: info.image, alt: info.name }); }}
                                  className="w-9 h-9 rounded-full overflow-hidden border border-white/50 shadow-sm shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                                >
                                  <img src={info.image} alt={info.name} style={{ objectPosition: 'top' }} className="w-full h-full object-cover" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className={`text-[8px] font-black ${labelColor} uppercase tracking-widest bg-white/10 px-1.5 py-0.5 rounded-full shrink-0`}>{label}</span>
                                  <span className="text-[11px] font-black text-white/80 truncate">{info.name}</span>
                                </div>
                                {(info.age || info.gender) && (
                                  <span className="text-[9px] text-white/40 font-medium">
                                    {[
                                      info.age ? `${info.age}${/\d$/.test(info.age) ? '세' : ''}` : null,
                                      info.gender ? (/남|남성|male/i.test(info.gender) ? '남' : /여|여성|female/i.test(info.gender) ? '여' : info.gender) : null,
                                    ].filter(Boolean).join(', ')}
                                  </span>
                                )}
                              </div>
                              {/* 미展開 상태에서 호감도 요약 */}
                              {!isExpanded && affinityVal !== null && (
                                <span className={`text-[9px] font-black ${aff.color} ml-1`}>{affinityVal > 0 ? '+' : ''}{affinityVal}</span>
                              )}
                              {hasMore && (
                                <span className="ml-auto text-[8px] font-black text-white/30 transition-transform">
                                  <ChevronDown size={12} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </span>
                              )}
                            </div>
                            {/* 展開 시 호감도 바 */}
                            {isExpanded && affinityVal !== null && (
                              <div className="pt-1 space-y-1">
                                <div className="flex justify-between items-center px-0.5">
                                  <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">호감도</span>
                                  <span className={`text-[10px] font-black ${aff.color}`}>{affinityVal > 0 ? '+' : ''}{affinityVal} · {aff.text}</span>
                                </div>
                                <div className="w-full bg-white/15 rounded-full h-1.5 overflow-hidden">
                                  <div className="h-full rounded-full transition-all duration-700"
                                    style={{ width: `${affPct}%`, backgroundColor: affinityVal >= 0 ? '#8b5cf6' : '#ef4444' }} />
                                </div>
                              </div>
                            )}
                            {info.personality && (
                              <p className={`text-[10px] text-white/55 font-medium leading-relaxed pl-0.5 ${isExpanded ? '' : 'line-clamp-2'}`}>{info.personality}</p>
                            )}
                            {isExpanded && (
                              <>
                                {info.appearance && (
                                  <div className="pt-1 space-y-0.5">
                                    <p className="text-[9px] font-black text-white/35 uppercase tracking-widest">외형</p>
                                    <p className="text-[10px] text-white/55 font-medium leading-relaxed pl-0.5">{info.appearance}</p>
                                  </div>
                                )}
                                {info.background && (
                                  <div className="pt-1 space-y-0.5">
                                    <p className="text-[9px] font-black text-white/35 uppercase tracking-widest">배경</p>
                                    <p className="text-[10px] text-white/55 font-medium leading-relaxed pl-0.5">{info.background}</p>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 속마음 */}
              {activeTopic?.compass && (() => {
                const chars: { key: string }[] = [];
                if (activeTopic?.ai_character?.name)
                  chars.push({ key: activeTopic.ai_character.name });
                if (activeTopic?.user_character?.name)
                  chars.push({ key: activeTopic.user_character.name });
                (activeTopic?.supporting_cast ?? []).forEach((c: any) => {
                  if (c.name) chars.push({ key: c.name });
                });
                const activeChar = selectedInnerChar || chars[0]?.key || '';
                const thought = innerThoughts[activeChar];
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-4 bg-rose-400 rounded-full" />
                      <h3 className="text-sm font-black text-white/80 uppercase">속마음</h3>
                      <button
                        onClick={() => { if (!isInnerThoughtLoading) setShowInnerThoughtConfirm(true); }}
                        disabled={isInnerThoughtLoading}
                        className="ml-auto flex items-center gap-1 text-[10px] font-black text-rose-400 hover:bg-rose-500/20 px-2 py-1 rounded-lg transition-all disabled:opacity-40"
                      >
                        {isInnerThoughtLoading ? (
                          <span className="animate-pulse">갱신 중...</span>
                        ) : (
                          <><MessageSquare size={11} /> 지금 갱신</>
                        )}
                      </button>
                    </div>
                    {showInnerThoughtConfirm && (
                      <div className="flex items-center gap-2 bg-rose-500/15 border border-rose-500/30 rounded-xl px-3 py-1.5 text-[11px]">
                        <span className="text-rose-300 font-bold flex-1">10 DT가 소모됩니다. {activeChar}의 속마음을 갱신할까요?</span>
                        <button
                          onClick={async () => {
                            setShowInnerThoughtConfirm(false);
                            if (!activeTopic || isInnerThoughtLoading) return;
                            setIsInnerThoughtLoading(true);
                            try {
                              const res = await apiFetch(`/topics/${activeTopic.id}/inner-thought`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ character_name: activeChar || null }),
                              });
                              if (!res.ok) throw new Error(`HTTP ${res.status}`);
                              const data = await res.json();
                              if (data.inner_thoughts) setInnerThoughts(data.inner_thoughts);
                              // 상단 보유 DT 잔액 및 소모 내역 동기화
                              refreshUser();
                              loadMessages(activeTopic.id);
                              } catch (e) { console.error('[속마음 갱신 실패]', e); }
                            finally { setIsInnerThoughtLoading(false); }
                          }}
                          className="font-black text-white bg-rose-400 hover:bg-rose-500 rounded-lg px-2 py-0.5 transition-all"
                        >확인</button>
                        <button
                          onClick={() => setShowInnerThoughtConfirm(false)}
                          className="font-black text-slate-500 hover:text-slate-700 transition-all"
                        >취소</button>
                      </div>
                    )}
                    {/* 캐릭터 선택 탭 */}
                    {chars.length > 1 && (
                      <div className="flex flex-wrap gap-1.5">
                        {chars.map(({ key }) => (
                          <button
                            key={key}
                            onClick={() => setSelectedInnerChar(key)}
                            className={`text-[10px] font-black px-2.5 py-1 rounded-full transition-all ${
                              activeChar === key
                                ? 'bg-rose-500 text-white shadow-sm'
                                : 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                            }`}
                          >
                            {key}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4">
                      {thought ? (
                        <p className="text-[11px] font-medium text-white/65 leading-relaxed whitespace-pre-wrap italic">{thought}</p>
                      ) : (
                        <p className="text-[10px] text-white/30 font-bold text-center py-2">
                          {chars.length > 1 ? `${activeChar}의 속마음` : '속마음'}이 아직 없습니다.<br />기·승·전·결 단계 전환 시 자동 갱신되거나, 지금 갱신 버튼을 눌러보세요.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}


              {/* 유저 노트 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 bg-violet-500 rounded-full" />
                  <h3 className="text-sm font-black text-white/80 uppercase">유저 노트</h3>
                  <button
                    onClick={() => { setShowNoteForm(true); setEditingNoteId(null); setNoteForm({ title: '', content: '' }); }}
                    className="ml-auto flex items-center gap-1 text-[10px] font-black text-violet-400 hover:bg-violet-500/20 px-2 py-1 rounded-lg transition-all"
                  >
                    <Plus size={11} /> 추가
                  </button>
                </div>
                <p className="text-[11px] text-white/40 font-medium -mt-1">캐릭터가 기억했으면 하는 정보를 입력해보세요.</p>

                {/* 노트 추가/수정 폼 */}
                {(showNoteForm || editingNoteId !== null) && (
                  <div className="bg-violet-500/10 border border-violet-500/25 rounded-2xl p-3 space-y-2">
                    <input
                      value={noteForm.title}
                      onChange={e => setNoteForm(p => ({ ...p, title: e.target.value }))}
                      placeholder="노트 제목 (예: 말투 설정)"
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-[11px] font-bold outline-none focus:ring-2 focus:ring-violet-400 text-white placeholder:text-white/30"
                    />
                    <textarea
                      value={noteForm.content}
                      onChange={e => setNoteForm(p => ({ ...p, content: e.target.value }))}
                      placeholder="AI에게 전달할 내용..."
                      rows={3}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-[11px] font-medium outline-none focus:ring-2 focus:ring-violet-400 resize-none text-white placeholder:text-white/30"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setShowNoteForm(false); setEditingNoteId(null); }} className="text-[10px] font-black text-white/40 px-2 py-1">취소</button>
                      <button
                        onClick={() => {
                          if (!noteForm.title.trim() && !noteForm.content.trim()) return;
                          let updated: typeof notePresets;
                          if (editingNoteId !== null) {
                            updated = notePresets.map(n => n.id === editingNoteId ? { ...n, ...noteForm } : n);
                            if (userNotes === notePresets.find(n => n.id === editingNoteId)?.content) {
                              setUserNotes(noteForm.content);
                              updateTopicSettings({ user_notes: noteForm.content, user_note_presets: updated });
                            } else {
                              updateTopicSettings({ user_note_presets: updated });
                            }
                          } else {
                            updated = [...notePresets, { id: Date.now(), ...noteForm }];
                            updateTopicSettings({ user_note_presets: updated });
                          }
                          setNotePresets(updated);
                          setShowNoteForm(false);
                          setEditingNoteId(null);
                        }}
                        className="text-[10px] font-black bg-violet-500 text-white px-3 py-1 rounded-lg"
                      >
                        {editingNoteId !== null ? '저장' : '추가'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 노트 목록 */}
                {notePresets.length === 0 && !showNoteForm ? (
                  <p className="text-center text-[10px] text-white/30 font-bold py-4">노트가 없습니다. + 추가를 눌러보세요.</p>
                ) : (
                  <div className="space-y-2">
                    {notePresets.map(note => {
                      const isActive = userNotes === note.content;
                      return (
                        <div key={note.id} className={`rounded-2xl border p-3 space-y-1.5 transition-all ${isActive ? 'bg-violet-500/15 border-violet-500/30' : 'bg-white/5 border-white/10'}`}>
                          <div className="flex items-center gap-2">
                            {isActive && <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
                            <span className={`text-[11px] font-black flex-1 truncate ${isActive ? 'text-violet-300' : 'text-white/70'}`}>{note.title || '(제목 없음)'}</span>
                            <div className="flex gap-1 shrink-0">
                              {!isActive && (
                                <button
                                  onClick={() => { setUserNotes(note.content); updateTopicSettings({ user_notes: note.content }); }}
                                  className="text-[9px] font-black bg-violet-500 text-white px-2 py-0.5 rounded-lg hover:bg-violet-600 transition-all"
                                >적용</button>
                              )}
                              <button onClick={() => { setEditingNoteId(note.id); setShowNoteForm(false); setNoteForm({ title: note.title, content: note.content }); }} className="p-1 hover:bg-blue-500/20 text-blue-400 rounded-lg"><Edit3 size={11} /></button>
                              <button
                                onClick={() => {
                                  const updated = notePresets.filter(n => n.id !== note.id);
                                  setNotePresets(updated);
                                  if (isActive) { setUserNotes(''); updateTopicSettings({ user_notes: '', user_note_presets: updated }); }
                                  else updateTopicSettings({ user_note_presets: updated });
                                }}
                                className="p-1 hover:bg-red-500/20 text-red-400 rounded-lg"
                              ><Trash2 size={11} /></button>
                            </div>
                          </div>
                          <p className="text-[10px] text-white/45 font-medium leading-relaxed line-clamp-2">{note.content}</p>
                          {isActive && <p className="text-[9px] font-black text-violet-400 tracking-wider">✓ 현재 적용 중</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>


            </>
          ) : activeTab === 'summaries' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><div className="w-1.5 h-4 bg-blue-500 rounded-full" /><h3 className="text-sm font-black text-white/80 uppercase">Summary Record</h3></div>
                <button onClick={() => setShowSummaryConfirm(true)} className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-white/70 border border-white/20 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all">
                  <MessageSquare size={12} /> 즉시 요약
                </button>
              </div>
              {showSummaryConfirm && (
                <div className="flex items-center gap-2 bg-blue-500/15 border border-blue-500/30 rounded-xl px-3 py-1.5 text-[11px] -mt-2">
                  <span className="text-blue-300 font-bold flex-1">10 DT가 소모됩니다. 지금까지의 대화를 요약할까요?</span>
                  <button
                    onClick={() => { setShowSummaryConfirm(false); sendMessage('!요약'); }}
                    className="font-black text-white bg-blue-500 hover:bg-blue-600 rounded-lg px-2 py-0.5 transition-all"
                  >확인</button>
                  <button
                    onClick={() => setShowSummaryConfirm(false)}
                    className="font-black text-white/50 hover:text-white/80 transition-all"
                  >취소</button>
                </div>
              )}
              <p className="text-xs text-white/40 font-semibold -mt-4">기·승·전·결 단계 전환 시 자동 요약됩니다.</p>
              {summaries.length === 0 ? (
                <div className="text-center py-20 text-white/30 space-y-3">
                  <Book size={32} className="mx-auto opacity-20" />
                  <p className="text-[10px] font-bold">아직 기록된 요약이 없습니다.<br />기, 승, 전, 결 분기가 넘어갈 때마다 자동 생성됩니다.</p>
                </div>
              ) : (() => {
                const STAGE_ORDER = ['결', '전', '승', '기'];
                const STAGE_COLOR: Record<string, string> = { '기': 'bg-emerald-500', '승': 'bg-blue-500', '전': 'bg-violet-500', '결': 'bg-rose-500' };
                const grouped: Record<string, any[]> = {};
                for (const s of summaries) {
                  const k = s.stage || '미분류';
                  if (!grouped[k]) grouped[k] = [];
                  grouped[k].push(s);
                }
                const groupKeys = [
                  ...(grouped['미분류'] ? ['미분류'] : []),
                  ...STAGE_ORDER.filter(k => grouped[k]),
                ];
                return (
                  <div className="space-y-8">
                    {groupKeys.map(key => (
                      <div key={key} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0 ${STAGE_COLOR[key] ?? 'bg-slate-300'}`}>{key === '미분류' ? '—' : key}</div>
                          <span className="text-[10px] font-black text-white/40 uppercase tracking-wider">{key === '미분류' ? '단계 미지정' : `${key}단계`}</span>
                          <div className="flex-1 h-px bg-white/10" />
                        </div>
                        {grouped[key].map((s, i) => (
                          <div key={s.id ?? i} className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2 relative group/summary">
                            <div className="flex items-center justify-between">
                              <div className="text-[9px] font-black text-white/35 uppercase">{new Date(s.created_at.endsWith('Z') ? s.created_at : s.created_at + 'Z').toLocaleString()}</div>
                              {editingSummaryId !== s.id && (
                                <div className="flex gap-1 opacity-0 group-hover/summary:opacity-100 transition-opacity">
                                  <button onClick={() => { setEditingSummaryId(s.id); setEditSummaryText(s.content); }} className="p-1.5 hover:bg-blue-500/20 text-blue-400 rounded-lg"><Edit3 size={12} /></button>
                                  <button onClick={() => handleDeleteSummary(s.id)} className="p-1.5 hover:bg-red-500/20 text-red-400 rounded-lg"><Trash2 size={12} /></button>
                                </div>
                              )}
                            </div>
                            {editingSummaryId === s.id ? (
                              <div className="space-y-2">
                                <textarea autoFocus value={editSummaryText} onChange={e => setEditSummaryText(e.target.value)} className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-[11px] font-medium outline-none focus:ring-2 focus:ring-blue-400 resize-none min-h-[100px] text-white" />
                                <div className="flex justify-end gap-2">
                                  <button onClick={() => setEditingSummaryId(null)} className="text-[10px] font-black text-white/40 px-2">취소</button>
                                  <button onClick={() => handleUpdateSummary(s.id)} className="text-[10px] font-black bg-blue-500 text-white px-3 py-1 rounded-lg">저장</button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-[11px] font-medium text-white/60 leading-relaxed whitespace-pre-wrap">{s.content}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : activeTab === 'lorebook' ? (
            <div className="space-y-6">
              {/* 헤더 */}
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-4 bg-violet-500 rounded-full" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Lorebook</h3>
                <span className="ml-auto text-[9px] font-bold text-white/35">
                  {lorebookEntries.filter(e => e.category !== 'foreshadowing').length}개 항목
                </span>
              </div>

              {/* 섹션 */}
              {([
                {
                  key: 'world',
                  label: '세계관 설정',
                  sublabel: '장소 · 규칙 · 역사적 배경 등을 설정하고 +버튼을 눌러 새로운 세계관 설정을 만들어보세요.',
                  barColor: 'bg-emerald-400',
                  btnHover: 'hover:bg-emerald-500/20 text-emerald-400',
                  ringColor: 'focus:ring-emerald-500/40',
                  filterCategories: ['place', 'event'],
                  addCategory: 'place',
                  showCatSelect: false,
                  catOptions: [] as any[],
                },
                {
                  key: 'character',
                  label: '캐릭터 정보',
                  sublabel: (
                    <>
                      관계 · 비밀 · 말투 등 캐릭터 정보를 설정하고 +버튼을 눌러 새로운 조연 캐릭터를 만들어보세요.
                    </>
                  ),
                  barColor: 'bg-blue-400',
                  btnHover: 'hover:bg-blue-500/20 text-blue-400',
                  ringColor: 'focus:ring-blue-500/40',
                  filterCategories: ['character'],
                  addCategory: 'character',
                  showCatSelect: false,
                  catOptions: [] as any[],
                },
              ] as const).map(section => {
                const sectionEntries = lorebookEntries
                  .map((e, idx) => ({ ...e, _idx: idx }))
                  .filter(e => (section.filterCategories as readonly string[]).includes(e.category));

                const catColor: Record<string, string> = {
                  place: 'bg-emerald-500/20 text-emerald-300',
                  event: 'bg-amber-500/20 text-amber-300',
                  character: 'bg-blue-500/20 text-blue-300',
                  note: 'bg-violet-500/20 text-violet-300',
                };
                const catLabel: Record<string, string> = {
                  place: '장소', event: '사건', character: '인물', note: '노트',
                };
                const aiName = activeTopic?.ai_character?.name;
                const userName = activeTopic?.user_character?.name;
                const getCharLabel = (keyword: string) => {
                  if (aiName && keyword === aiName) return '상대';
                  if (userName && keyword === userName) return '나';
                  return '조연';
                };
                const getCharColor = (keyword: string) => {
                  if (aiName && keyword === aiName) return 'bg-blue-500/20 text-blue-300';
                  if (userName && keyword === userName) return 'bg-violet-500/20 text-violet-300';
                  return 'bg-white/10 text-white/50';
                };
                const getCharInfo = (keyword: string) => {
                  if (aiName && keyword === aiName) return activeTopic?.ai_character ?? null;
                  if (userName && keyword === userName) return activeTopic?.user_character ?? null;
                  return (activeTopic?.supporting_cast ?? []).find((c: any) => c.name === keyword) ?? null;
                };
                const charInfoFields: { key: string; label: string }[] = [
                  { key: 'role', label: '역할' },
                  { key: 'gender', label: '성별' },
                  { key: 'age', label: '나이' },
                  { key: 'personality', label: '성격' },
                  { key: 'appearance', label: '외형' },
                  { key: 'background', label: '배경' },
                ];

                return (
                  <div key={section.key} className="space-y-2">
                    {/* 섹션 헤더 */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-1 h-8 ${section.barColor} rounded-full flex-shrink-0`} />
                        <div>
                          <p className="text-[11px] font-black text-white/80">{section.label}</p>
                          <p className="text-[9px] text-white/40 leading-tight">{section.sublabel}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setLorebookAddSection(lorebookAddSection === section.key ? null : section.key);
                          setLorebookForm({ keyword: '', content: '', category: section.addCategory });
                        }}
                        className={`p-1.5 rounded-lg transition-all flex-shrink-0 ${section.btnHover}`}
                      >
                        <Plus size={13} />
                      </button>
                    </div>

                    {/* 추가 폼 */}
                    {lorebookAddSection === section.key && (
                      <div className="bg-white/5 border border-white/10 rounded-2xl p-3 space-y-2">
                        {section.key === 'character' ? (
                          <>
                            {([
                              { key: 'name' as const, label: '이름', placeholder: '캐릭터 이름', bold: true },
                              { key: 'role' as const, label: '역할', placeholder: '예: 마을 대장장이', bold: false },
                              { key: 'gender' as const, label: '성별', placeholder: '예: 남성, 여성', bold: false },
                              { key: 'age' as const, label: '나이', placeholder: '예: 30대 초반', bold: false },
                              { key: 'personality' as const, label: '성격', placeholder: '성격 묘사', bold: false },
                              { key: 'appearance' as const, label: '외형', placeholder: '외형 묘사', bold: false },
                              { key: 'background' as const, label: '배경', placeholder: '배경 및 설정', bold: false },
                            ]).map(({ key, label, placeholder, bold }) => (
                              <div key={key} className="flex items-center gap-2">
                                <span className="text-[9px] font-black text-white/40 w-8 shrink-0">{label}</span>
                                <input
                                  value={addCharForm[key]}
                                  onChange={e => setAddCharForm(f => ({ ...f, [key]: e.target.value }))}
                                  placeholder={placeholder}
                                  autoFocus={key === 'name'}
                                  className={`flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-1.5 text-[11px] outline-none focus:ring-2 ${section.ringColor} text-white placeholder:text-white/30 ${bold ? 'font-bold' : 'font-medium'}`}
                                />
                              </div>
                            ))}
                            <div className="pt-1 border-t border-white/10 space-y-1">
                              <span className="text-[9px] font-black text-white/40">추가 정보</span>
                              <textarea
                                value={addCharForm.notes}
                                onChange={e => setAddCharForm(f => ({ ...f, notes: e.target.value }))}
                                placeholder="관계, 비밀, 말투, 특이사항 등 자유롭게 적어보세요."
                                rows={3}
                                className={`w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-[11px] font-medium outline-none focus:ring-2 ${section.ringColor} resize-none text-white placeholder:text-white/30`}
                              />
                            </div>
                            <div className="flex justify-end gap-2 pt-1">
                              <button onClick={() => { setLorebookAddSection(null); setAddCharForm({ name: '', role: '', gender: '', age: '', personality: '', appearance: '', background: '', notes: '' }); }} className="text-[10px] font-black text-white/40 px-2">취소</button>
                              <button onClick={addCharacterEntry} className="text-[10px] font-black bg-blue-500 text-white px-3 py-1.5 rounded-lg">추가</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <input
                              value={lorebookForm.keyword}
                              onChange={e => setLorebookForm(f => ({ ...f, keyword: e.target.value }))}
                              placeholder="키워드 (예: 마법 탑)"
                              autoFocus
                              className={`w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-[11px] font-bold outline-none focus:ring-2 ${section.ringColor} text-white placeholder:text-white/30`}
                            />
                            <textarea
                              value={lorebookForm.content}
                              onChange={e => setLorebookForm(f => ({ ...f, content: e.target.value }))}
                              placeholder="내용..."
                              rows={2}
                              className={`w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-[11px] font-medium outline-none focus:ring-2 ${section.ringColor} resize-none text-white placeholder:text-white/30`}
                            />
                            {section.showCatSelect && (
                              <select
                                value={lorebookForm.category}
                                onChange={e => setLorebookForm(f => ({ ...f, category: e.target.value }))}
                                className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-[11px] font-bold outline-none text-white"
                              >
                                {section.catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            )}
                            <div className="flex justify-end gap-2">
                              <button onClick={() => setLorebookAddSection(null)} className="text-[10px] font-black text-white/40 px-2">취소</button>
                              <button onClick={addLorebookEntry} className="text-[10px] font-black bg-violet-500 text-white px-3 py-1.5 rounded-lg">추가</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* 항목 목록 */}
                    {sectionEntries.length === 0 ? (
                      <div className="text-center py-4 text-[9px] text-white/30 font-bold">
                        {section.key === 'character' ? '시나리오 생성 시 자동 추출됩니다' : '+ 버튼으로 AI가 기억할 정보를 추가해보세요'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {sectionEntries.map(entry => {
                          const i = entry._idx;
                          return (
                            <div key={i} className="bg-white/5 border border-white/10 p-3 rounded-2xl space-y-1.5 group/lore">
                              {editingLorebookIndex === i ? (
                                <div className="space-y-2">
                                  <input
                                    value={editLorebookForm.keyword}
                                    onChange={e => editLorebookForm.category !== 'character' && setEditLorebookForm(f => ({ ...f, keyword: e.target.value }))}
                                    readOnly={editLorebookForm.category === 'character'}
                                    className={`w-full bg-white/10 border border-violet-500/40 rounded-xl px-3 py-2 text-[11px] font-bold outline-none text-white ${editLorebookForm.category === 'character' ? 'opacity-50 cursor-not-allowed' : 'focus:ring-2 focus:ring-violet-500/40'}`}
                                  />
                                  <textarea
                                    value={editLorebookForm.content}
                                    onChange={e => setEditLorebookForm(f => ({ ...f, content: e.target.value }))}
                                    rows={2}
                                    className="w-full bg-white/10 border border-violet-500/40 rounded-xl px-3 py-2 text-[11px] font-medium outline-none focus:ring-2 focus:ring-violet-500/40 resize-none text-white"
                                  />
                                  {editCharInfo && (
                                    <div className="space-y-1.5 pt-1 border-t border-white/10">
                                      {([
                                        { key: 'role', label: '역할' },
                                        { key: 'gender', label: '성별' },
                                        { key: 'age', label: '나이' },
                                        { key: 'personality', label: '성격' },
                                        { key: 'appearance', label: '외형' },
                                        { key: 'background', label: '배경' },
                                      ] as const).map(({ key, label }) => (
                                        <div key={key} className="flex items-center gap-2">
                                          <span className="text-[9px] font-black text-white/40 w-8 shrink-0">{label}</span>
                                          <input
                                            value={editCharInfo[key]}
                                            onChange={e => setEditCharInfo(prev => prev ? { ...prev, [key]: e.target.value } : prev)}
                                            placeholder={label}
                                            className="flex-1 bg-white/10 border border-violet-500/30 rounded-lg px-2 py-1 text-[10px] font-medium outline-none focus:ring-1 focus:ring-violet-500/40 text-white placeholder:text-white/30"
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex justify-end gap-2">
                                    <button onClick={() => { setEditingLorebookIndex(null); setEditCharInfo(null); }} className="text-[10px] font-black text-white/40 px-2">취소</button>
                                    <button onClick={() => updateLorebookEntry(i)} className="text-[10px] font-black bg-violet-500 text-white px-3 py-1.5 rounded-lg">저장</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md flex-shrink-0 ${entry.category === 'character' ? getCharColor(entry.keyword) : section.key === 'world' ? 'bg-emerald-500/20 text-emerald-300' : (catColor[entry.category] ?? 'bg-white/10 text-white/50')}`}>
                                        {entry.category === 'character' ? getCharLabel(entry.keyword) : section.key === 'world' ? '세계관' : (catLabel[entry.category] ?? entry.category)}
                                      </span>
                                      <span className="text-[11px] font-black text-white/80 truncate">{entry.keyword}</span>
                                    </div>
                                    <div className="flex gap-0.5 opacity-0 group-hover/lore:opacity-100 transition-opacity flex-shrink-0">
                                      <button
                                        onClick={() => {
                                          setEditingLorebookIndex(i);
                                          setEditLorebookForm({ keyword: entry.keyword, content: entry.content, category: entry.category });
                                          if (entry.category === 'character') {
                                            const ci = getCharInfo(entry.keyword);
                                            setEditCharInfo({
                                              role: ci?.role ?? '',
                                              gender: ci?.gender ?? '',
                                              age: ci?.age ?? '',
                                              personality: ci?.personality ?? '',
                                              appearance: ci?.appearance ?? '',
                                              background: ci?.background ?? '',
                                            });
                                          } else {
                                            setEditCharInfo(null);
                                          }
                                        }}
                                        className="p-1 hover:bg-violet-500/20 text-violet-400 rounded-lg"
                                      ><Edit3 size={11} /></button>
                                      {!(entry.is_generated) && !(entry.category === 'character' && (entry.keyword === aiName || entry.keyword === userName)) && (
                                        <button onClick={() => setLorebookDeleteConfirm(i)} className="p-1 hover:bg-red-500/20 text-red-400 rounded-lg"><Trash2 size={11} /></button>
                                      )}
                                    </div>
                                  </div>
                                  {entry.content && <p className="text-[10px] font-medium text-white/50 leading-relaxed">{entry.content}</p>}
                                  {entry.category === 'character' && (() => {
                                    const charInfo = getCharInfo(entry.keyword);
                                    if (!charInfo) return null;
                                    const filled = charInfoFields.filter(f => charInfo[f.key]);
                                    if (filled.length === 0) return null;
                                    return (
                                      <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                                        {filled.map(f => (
                                          <div key={f.key} className="flex gap-2">
                                            <span className="text-[9px] font-black text-white/35 uppercase tracking-widest w-8 shrink-0 pt-px">{f.label}</span>
                                            <span className="text-[10px] font-medium text-white/50 leading-relaxed">{charInfo[f.key]}</span>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : activeTab === 'relation' ? (
            <div className="space-y-4">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 bg-rose-500 rounded-full" />
                  <h3 className="text-sm font-black text-white uppercase">Relations</h3>
                  {relationGraph?.stage && (
                    <span className="text-[9px] font-black px-2 py-0.5 bg-rose-500/20 text-rose-400 rounded-md">{relationGraph.stage} 단계</span>
                  )}
                </div>
                <div className="relative flex items-center gap-1">
                  <button
                    onClick={() => setShowGraphModal(true)}
                    className="p-1.5 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-all"
                    title="크게 보기"
                  >
                    <Maximize2 size={14} />
                  </button>
                  <button
                    onClick={() => setShowGraphRefreshConfirm(v => !v)}
                    disabled={isGraphRefreshing}
                    className="p-1.5 hover:bg-rose-500/20 text-rose-400 rounded-lg disabled:opacity-40 transition-all"
                    title="수동 업데이트"
                  >
                    {isGraphRefreshing ? (
                      <div className="w-4 h-4 border-2 border-rose-300 border-t-rose-500 rounded-full animate-spin" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
                      </svg>
                    )}
                  </button>
                  {showGraphRefreshConfirm && (
                    <div className="absolute right-0 top-full mt-1 z-10 flex items-center gap-2 bg-slate-800/95 backdrop-blur-md border border-rose-500/30 rounded-xl shadow-2xl px-3 py-2 text-[11px] whitespace-nowrap">
                      <span className="text-rose-400 font-bold">10 DT가 소모됩니다. 업데이트할까요?</span>
                      <button
                        onClick={() => { setShowGraphRefreshConfirm(false); refreshRelationGraph(); }}
                        className="font-black text-white bg-rose-500 hover:bg-rose-600 rounded-lg px-2 py-0.5 transition-all"
                      >확인</button>
                      <button
                        onClick={() => setShowGraphRefreshConfirm(false)}
                        className="font-black text-white/40 hover:text-white/70 transition-all"
                      >취소</button>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[9px] text-white/40 font-medium -mt-1">단계 전환(기/승/전/결)시 자동 갱신됩니다</p>

              {!relationGraph || !relationGraph.nodes?.length ? (
                <div className="text-center py-20 text-white/40 space-y-3">
                  <svg className="mx-auto opacity-20" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>
                  <p className="text-[10px] font-bold">관계도가 없습니다.<br />시나리오 생성 후 자동으로 만들어집니다.</p>
                </div>
              ) : (() => {
                const nodes = relationGraph.nodes || [];
                const edges = relationGraph.edges || [];
                const nodeR = 22;
                const namePad = 6;   // gap between circle edge and name label
                const nameH = 13;    // name label height

                const n = nodes.length;
                // 엣지 레이블 최대 너비 계산
                const maxLabelW = edges.length > 0
                  ? Math.max(...edges.map((e: any) => Math.max((e.relation || '').length * 5.5, 8)))
                  : 0;
                // 노드 간격 기준 최소 r
                const neededChord = 2 * nodeR + 2 * (namePad + nameH) + 8;
                const minRNodes = n <= 1 ? 0 : Math.ceil(neededChord / 2 / Math.sin(Math.PI / n));
                // 인접 엣지 레이블 간격 기준 최소 r
                // 같은 소스에서 인접 두 엣지의 중간점 간격 = r * sin(π/n) → 이 값이 maxLabelW 이상이어야 함
                const minRLabels = n >= 2 && maxLabelW > 0
                  ? Math.ceil(maxLabelW / Math.sin(Math.PI / n))
                  : 0;
                const r = n <= 1 ? 0 : Math.max(85, minRNodes, minRLabels);

                // 이름 최대 너비 추정 (캔버스 여백 계산용)
                const maxNamePx = nodes.reduce((m: number, nd: any) => {
                  return Math.max(m, Math.min((nd.name || '').length, 7) * 9);
                }, 0);
                // Canvas: circle + outward label in every direction
                const outerExtent = r + nodeR + namePad + maxNamePx + 12;
                const W = Math.max(260, outerExtent * 2);
                const H = Math.max(220, outerExtent * 2);
                const cx = W / 2, cy = H / 2;

                // Positions with outward label anchor
                const positions: Record<string, { x: number; y: number; lx: number; ly: number; anchor: string }> = {};
                nodes.forEach((node: any, i: number) => {
                  const angle = n <= 1 ? -Math.PI / 2 : (2 * Math.PI / n) * i - Math.PI / 2;
                  const px = cx + r * Math.cos(angle);
                  const py = cy + r * Math.sin(angle);
                  const dx = px - cx, dy = py - cy;
                  const len = Math.sqrt(dx * dx + dy * dy) || 1;
                  const ndx = dx / len, ndy = dy / len;
                  // 방향에 따라 텍스트 정렬 결정: 오른쪽→start, 왼쪽→end, 위아래→middle
                  const anchor = ndx > 0.3 ? 'start' : ndx < -0.3 ? 'end' : 'middle';
                  const labelOffset = nodeR + namePad + 2;
                  positions[node.id] = {
                    x: px, y: py,
                    lx: n <= 1 ? px : px + ndx * labelOffset,
                    ly: n <= 1 ? py + labelOffset + nameH / 2 : py + ndy * labelOffset,
                    anchor: anchor as "start" | "middle" | "end" | "inherit",
                  };
                });

                const nodeColor: Record<string, string> = {
                  ai: '#3b82f6',
                  user: '#8b5cf6',
                  supporting: '#64748b',
                };
                const edgeColor: Record<string, string> = {
                  positive: '#22c55e',
                  neutral: '#94a3b8',
                  negative: '#ef4444',
                };

                return (
                  <div className="space-y-4">
                    <div className="overflow-x-auto">
                    <svg width={W} height={H} className="mx-auto block">
                      {/* 엣지 — 선 먼저, 레이블 나중에 + 충돌 해소 */}
                      {(() => {
                        // 1패스: 기하 계산
                        const edgeData = edges.map((edge: any) => {
                          const from = positions[edge.from];
                          const to = positions[edge.to];
                          if (!from || !to) return null;
                          const ex = to.x - from.x, ey = to.y - from.y;
                          const elen = Math.sqrt(ex * ex + ey * ey) || 1;
                          const ux = ex / elen, uy = ey / elen;
                          const x1 = from.x + ux * nodeR, y1 = from.y + uy * nodeR;
                          const x2 = to.x - ux * nodeR,  y2 = to.y - uy * nodeR;
                          const label = edge.relation || '';
                          const lw = Math.max(label.length * 5.5, 8);
                          const color = edgeColor[edge.sentiment] ?? '#94a3b8';
                          return { x1, y1, x2, y2,
                            plx: (x1 + x2) / 2 + (-uy * 10),
                            ply: (y1 + y2) / 2 + (ux * 10),
                            label, lw, color };
                        });

                        // 2패스: 레이블 충돌 해소
                        for (let iter = 0; iter < 12; iter++) {
                          for (let a = 0; a < edgeData.length; a++) {
                            for (let b = a + 1; b < edgeData.length; b++) {
                              const la = edgeData[a], lb = edgeData[b];
                              if (!la || !lb || !la.label || !lb.label) continue;
                              const overlapX = (la.lw + lb.lw) / 2 + 3 - Math.abs(la.plx - lb.plx);
                              const overlapY = 15 - Math.abs(la.ply - lb.ply);
                              if (overlapX > 0 && overlapY > 0) {
                                const push = overlapY / 2 + 1;
                                if (la.ply <= lb.ply) { la.ply -= push; lb.ply += push; }
                                else                  { la.ply += push; lb.ply -= push; }
                              }
                            }
                          }
                        }

                        return (
                          <>
                            {/* 선만 먼저 */}
                            {edgeData.map((d: any, i: number) => d && (
                              <line key={`l${i}`} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2}
                                stroke={d.color} strokeWidth="1.5" strokeOpacity="0.5" />
                            ))}
                            {/* 레이블은 모든 선 위에 */}
                            {edgeData.map((d: any, i: number) => d && d.label && (
                              <g key={`t${i}`}>
                                <rect x={d.plx - d.lw / 2} y={d.ply - 7} width={d.lw} height={13} fill="#1e293b" fillOpacity="0.95" rx="3" />
                                <text x={d.plx} y={d.ply} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill={d.color} fontWeight="700">
                                  {d.label}
                                </text>
                              </g>
                            ))}
                          </>
                        );
                      })()}
                      {/* 노드 */}
                      {nodes.map((node: any) => {
                        const pos = positions[node.id];
                        if (!pos) return null;
                        const color = nodeColor[node.type] ?? '#64748b';
                        const name = node.name.length > 7 ? node.name.slice(0, 7) + '…' : node.name;
                        const nw = Math.max(name.length * 6.5, 20);
                        const nwHalf = nw / 2;
                        // rect x: anchor에 따라 조정
                        const rectX = pos.anchor === 'start' ? pos.lx
                                    : pos.anchor === 'end'   ? pos.lx - nw
                                    : pos.lx - nwHalf;
                        return (
                          <g key={node.id}>
                            <circle cx={pos.x} cy={pos.y} r={nodeR} fill={color} fillOpacity="0.15" stroke={color} strokeWidth="2" />
                            {/* 원 안: 역할 이니셜 */}
                            <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill={color} fontWeight="900" opacity="0.7">
                              {node.type === 'ai' ? '상대' : node.type === 'user' ? '나' : '조연'}
                            </text>
                            {/* 이름 라벨: 방향에 따라 정렬 */}
                            <rect x={rectX} y={pos.ly - nameH / 2} width={nw} height={nameH} fill="#1e293b" fillOpacity="0.95" rx="3" />
                            <text x={pos.lx} y={pos.ly} textAnchor={pos.anchor as "start" | "middle" | "end"} dominantBaseline="middle" fontSize="9" fill={color} fontWeight="800">
                              {name}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                    </div>

                    {/* 범례 */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
                      {[['#3b82f6', '상대'], ['#8b5cf6', '나'], ['#64748b', '조연']].map(([c, l]) => (
                        <div key={l} className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                          <span className="text-[9px] font-bold text-white/40">{l}</span>
                        </div>
                      ))}
                      <div className="w-full h-px bg-white/10 my-0.5" />
                      {[['#22c55e', '우호'], ['#94a3b8', '중립'], ['#ef4444', '적대']].map(([c, l]) => (
                        <div key={l} className="flex items-center gap-1">
                          <div className="w-4 h-0.5 rounded" style={{ backgroundColor: c }} />
                          <span className="text-[9px] font-bold text-white/40">{l}</span>
                        </div>
                      ))}
                    </div>

                    {/* 관계 목록 */}
                    <div className="space-y-2">
                      {edges.map((edge: any, i: number) => {
                        const fromNode = nodes.find((n: any) => n.id === edge.from);
                        const toNode = nodes.find((n: any) => n.id === edge.to);
                        return (
                          <div key={i} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                            <span className="text-[10px] font-black text-white/70">{fromNode?.name}</span>
                            <div className="h-px flex-1 rounded" style={{ backgroundColor: edgeColor[edge.sentiment] ?? '#94a3b8' }} />
                            <span className="text-[9px] font-black" style={{ color: edgeColor[edge.sentiment] ?? '#94a3b8' }}>{edge.relation}</span>
                            <div className="h-px flex-1 rounded" style={{ backgroundColor: edgeColor[edge.sentiment] ?? '#94a3b8' }} />
                            <span className="text-[10px] font-black text-white/70">{toNode?.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : activeTab === 'gallery' ? (
            <div className="space-y-5">
              {/* 이미지 세트 재생성 버튼 */}
              {(activeTopic?.cover_image || activeTopic?.ai_character?.image || activeTopic?.user_character?.image) && (
                <button
                  onClick={() => setCharImgRegenConfirm(true)}
                  disabled={isCharImgRegenerating}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-amber-500/10 hover:border-amber-500/30 text-white/50 hover:text-amber-400 transition-all text-[11px] font-black disabled:opacity-40"
                >
                  <RotateCcw size={11} className={isCharImgRegenerating ? 'animate-spin' : ''} />
                  {isCharImgRegenerating ? charRegenStep || '재생성 중...' : '이미지 세트 재생성'}
                </button>
              )}

              {/* 표지 이미지 */}
              {(() => {
                const coverUrls: string[] = Array.isArray((activeTopic as any)?.cover_images) && (activeTopic as any).cover_images.length > 0
                  ? (activeTopic as any).cover_images
                  : activeTopic?.cover_image ? [activeTopic.cover_image] : [];
                if (coverUrls.length === 0) return null;
                const safeIdx = Math.max(0, Math.min(coverImgIndex, coverUrls.length - 1));
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[9px] font-black text-white/50 uppercase tracking-[0.15em]">Cover</p>
                        {coverUrls.length > 1 && (
                          <span className="text-[9px] font-black text-amber-400 bg-amber-500/20 rounded-full px-1.5 py-0.5">{safeIdx + 1}/{coverUrls.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCoverImgRegenConfirm(true)}
                          disabled={isCoverImgRegenerating}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-amber-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          <RotateCcw size={10} className={isCoverImgRegenerating ? 'animate-spin' : ''} />
                          재생성
                        </button>
                        <button
                          onClick={() => setCoverImgDeleteConfirm(safeIdx)}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-red-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-red-500/20"
                        >
                          <Trash2 size={10} />
                          삭제
                        </button>
                      </div>
                    </div>
                    <div
                      className="relative rounded-2xl overflow-hidden border border-white/10"
                      onMouseEnter={() => setHoveredCoverImg(true)}
                      onMouseLeave={() => setHoveredCoverImg(false)}
                    >
                      <div className="cursor-zoom-in group" onClick={() => setGalleryLightbox(coverUrls[safeIdx])}>
                        <img src={coverUrls[safeIdx]} alt="cover" className="w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center pointer-events-none">
                          <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow" />
                        </div>
                      </div>
                      {hoveredCoverImg && coverUrls.length > 1 && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setCoverImgIndex(Math.max(0, safeIdx - 1)); }}
                            disabled={safeIdx === 0}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >‹</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setCoverImgIndex(Math.min(coverUrls.length - 1, safeIdx + 1)); }}
                            disabled={safeIdx === coverUrls.length - 1}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >›</button>
                        </>
                      )}
                    </div>
                    {coverUrls[safeIdx] !== activeTopic?.cover_image && (
                      <button
                        onClick={() => setActiveCoverImage(coverUrls[safeIdx])}
                        className="w-full py-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all text-[10px] font-black"
                      >
                        이 이미지로 설정
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* 상대 캐릭터 이미지 */}
              {(() => {
                const aiUrls: string[] = Array.isArray(activeTopic?.ai_character?.images) && activeTopic!.ai_character!.images!.length > 0
                  ? activeTopic!.ai_character!.images!
                  : activeTopic?.ai_character?.image ? [activeTopic.ai_character.image] : [];
                if (aiUrls.length === 0) return null;
                const safeIdx = Math.max(0, Math.min(aiCharImgIndex, aiUrls.length - 1));
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[9px] font-black text-white/50 uppercase tracking-[0.15em]">{activeTopic?.ai_character?.name ?? 'AI Character'}</p>
                        {aiUrls.length > 1 && (
                          <span className="text-[9px] font-black text-amber-400 bg-amber-500/20 rounded-full px-1.5 py-0.5">{safeIdx + 1}/{aiUrls.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setAiCharImgRegenConfirm(true)}
                          disabled={isAiCharImgRegenerating}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-amber-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          <RotateCcw size={10} className={isAiCharImgRegenerating ? 'animate-spin' : ''} />
                          재생성
                        </button>
                        <button
                          onClick={() => setAiCharImgDeleteConfirm(safeIdx)}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-red-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-red-500/20"
                        >
                          <Trash2 size={10} />
                          삭제
                        </button>
                      </div>
                    </div>
                    <div
                      className="relative rounded-2xl overflow-hidden border border-white/10"
                      onMouseEnter={() => setHoveredAiCharImg(true)}
                      onMouseLeave={() => setHoveredAiCharImg(false)}
                    >
                      <div className="cursor-zoom-in group" onClick={() => setGalleryLightbox(aiUrls[safeIdx])}>
                        <img src={aiUrls[safeIdx]} alt="ai character" className="w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center pointer-events-none">
                          <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow" />
                        </div>
                      </div>
                      {hoveredAiCharImg && aiUrls.length > 1 && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setAiCharImgIndex(Math.max(0, safeIdx - 1)); }}
                            disabled={safeIdx === 0}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >‹</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setAiCharImgIndex(Math.min(aiUrls.length - 1, safeIdx + 1)); }}
                            disabled={safeIdx === aiUrls.length - 1}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >›</button>
                        </>
                      )}
                    </div>
                    {aiUrls[safeIdx] !== activeTopic?.ai_character?.image && (
                      <button
                        onClick={() => setActiveAiCharImage(aiUrls[safeIdx])}
                        className="w-full py-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all text-[10px] font-black"
                      >
                        이 이미지로 설정
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* 유저 캐릭터 이미지 */}
              {(() => {
                const userUrls: string[] = Array.isArray(activeTopic?.user_character?.images) && activeTopic!.user_character!.images!.length > 0
                  ? activeTopic!.user_character!.images!
                  : activeTopic?.user_character?.image ? [activeTopic.user_character.image] : [];
                if (userUrls.length === 0) return null;
                const safeIdx = Math.max(0, Math.min(userCharImgIndex, userUrls.length - 1));
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[9px] font-black text-white/50 uppercase tracking-[0.15em]">{activeTopic?.user_character?.name ?? 'My Character'}</p>
                        {userUrls.length > 1 && (
                          <span className="text-[9px] font-black text-amber-400 bg-amber-500/20 rounded-full px-1.5 py-0.5">{safeIdx + 1}/{userUrls.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setUserCharImgRegenConfirm(true)}
                          disabled={isUserCharImgRegenerating}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-amber-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          <RotateCcw size={10} className={isUserCharImgRegenerating ? 'animate-spin' : ''} />
                          재생성
                        </button>
                        <button
                          onClick={() => setUserCharImgDeleteConfirm(safeIdx)}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-red-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-red-500/20"
                        >
                          <Trash2 size={10} />
                          삭제
                        </button>
                      </div>
                    </div>
                    <div
                      className="relative rounded-2xl overflow-hidden border border-white/10"
                      onMouseEnter={() => setHoveredUserCharImg(true)}
                      onMouseLeave={() => setHoveredUserCharImg(false)}
                    >
                      <div className="cursor-zoom-in group" onClick={() => setGalleryLightbox(userUrls[safeIdx])}>
                        <img src={userUrls[safeIdx]} alt="user character" className="w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center pointer-events-none">
                          <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow" />
                        </div>
                      </div>
                      {hoveredUserCharImg && userUrls.length > 1 && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setUserCharImgIndex(Math.max(0, safeIdx - 1)); }}
                            disabled={safeIdx === 0}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >‹</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setUserCharImgIndex(Math.min(userUrls.length - 1, safeIdx + 1)); }}
                            disabled={safeIdx === userUrls.length - 1}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >›</button>
                        </>
                      )}
                    </div>
                    {userUrls[safeIdx] !== activeTopic?.user_character?.image && (
                      <button
                        onClick={() => setActiveUserCharImage(userUrls[safeIdx])}
                        className="w-full py-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all text-[10px] font-black"
                      >
                        이 이미지로 설정
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* 분기 이미지들 */}
              {(['승', '전', '결'] as const).map((stage) => {
                const raw = activeTopic?.stage_character_images?.[stage];
                const urls: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
                if (urls.length === 0) return null;
                const idx = stageCharImageIndices[stage] ?? urls.length - 1;
                const safeIdx = Math.max(0, Math.min(idx, urls.length - 1));
                const isLoadingThisStage = isStageCharImgLoading && stageCharImgLoadingStage === stage;
                return (
                  <div key={stage} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[9px] font-black text-white/50 uppercase tracking-[0.15em]">{stage} Scene</p>
                        {urls.length > 1 && (
                          <span className="text-[9px] font-black text-amber-400 bg-amber-500/20 rounded-full px-1.5 py-0.5">{safeIdx + 1}/{urls.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setModal({
                            show: true,
                            title: '분기 이미지 재생성',
                            message: '이미지를 재생성하면 100DT가 소모됩니다.\n계속할까요?',
                            confirmLabel: '재생성',
                            variant: 'confirm',
                            onConfirm: () => regenerateStageCharImage(stage),
                          })}
                          disabled={isStageCharImgLoading}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-amber-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          <RotateCcw size={10} className={isLoadingThisStage ? 'animate-spin' : ''} />
                          재생성
                        </button>
                        <button
                          onClick={() => setStageImgDeleteConfirm({ stage, index: safeIdx })}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-red-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-red-500/20"
                        >
                          <Trash2 size={10} />
                          삭제
                        </button>
                      </div>
                    </div>
                    <div
                      className="relative rounded-2xl overflow-hidden border border-white/10"
                      onMouseEnter={() => setHoveredStageImg(`gallery-${stage}`)}
                      onMouseLeave={() => setHoveredStageImg(null)}
                    >
                      <div className="cursor-zoom-in group" onClick={() => setGalleryLightbox(urls[safeIdx])}>
                        <img src={urls[safeIdx]} alt={`${stage} scene`} className="w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center pointer-events-none">
                          <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow" />
                        </div>
                      </div>
                      {hoveredStageImg === `gallery-${stage}` && urls.length > 1 && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setStageCharImageIndices(prev => ({ ...prev, [stage]: Math.max(0, safeIdx - 1) })); }}
                            disabled={safeIdx === 0}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >‹</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setStageCharImageIndices(prev => ({ ...prev, [stage]: Math.min(urls.length - 1, safeIdx + 1) })); }}
                            disabled={safeIdx === urls.length - 1}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >›</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 엔딩 이미지 */}
              {(() => {
                const endUrls: string[] = Array.isArray(activeTopic?.ending_images) && activeTopic.ending_images.length > 0
                  ? activeTopic.ending_images
                  : activeTopic?.ending_image ? [activeTopic.ending_image] : [];
                if (endUrls.length === 0) return null;
                const safeIdx = Math.max(0, Math.min(endingImgIndex, endUrls.length - 1));
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[9px] font-black text-white/50 uppercase tracking-[0.15em]">Ending</p>
                        {endUrls.length > 1 && (
                          <span className="text-[9px] font-black text-amber-400 bg-amber-500/20 rounded-full px-1.5 py-0.5">{safeIdx + 1}/{endUrls.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEndingImgRegenConfirm(true)}
                          disabled={isEndingImgRegenerating}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-amber-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          <RotateCcw size={10} className={isEndingImgRegenerating ? 'animate-spin' : ''} />
                          재생성
                        </button>
                        <button
                          onClick={() => setEndingImgDeleteConfirm(safeIdx)}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-red-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-red-500/20"
                        >
                          <Trash2 size={10} />
                          삭제
                        </button>
                      </div>
                    </div>
                    <div
                      className="relative rounded-2xl overflow-hidden border border-white/10"
                      onMouseEnter={() => setHoveredEndingImg(true)}
                      onMouseLeave={() => setHoveredEndingImg(false)}
                    >
                      <div className="cursor-zoom-in group" onClick={() => setGalleryLightbox(endUrls[safeIdx])}>
                        <img src={endUrls[safeIdx]} alt="ending" className="w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center pointer-events-none">
                          <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow" />
                        </div>
                      </div>
                      {hoveredEndingImg && endUrls.length > 1 && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEndingImgIndex(Math.max(0, safeIdx - 1)); }}
                            disabled={safeIdx === 0}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >‹</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEndingImgIndex(Math.min(endUrls.length - 1, safeIdx + 1)); }}
                            disabled={safeIdx === endUrls.length - 1}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >›</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* 호감도 100 특전 이미지 */}
              {(() => {
                const affUrls: string[] = Array.isArray(activeTopic?.affinity_images) && activeTopic.affinity_images.length > 0
                  ? activeTopic.affinity_images
                  : activeTopic?.affinity_image ? [activeTopic.affinity_image] : [];
                if (affUrls.length === 0) return null;
                const safeIdx = Math.max(0, Math.min(affinityImgIndex, affUrls.length - 1));
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[9px] font-black text-white/50 uppercase tracking-[0.15em]">❤️ 호감도 특전</p>
                        {affUrls.length > 1 && (
                          <span className="text-[9px] font-black text-amber-400 bg-amber-500/20 rounded-full px-1.5 py-0.5">{safeIdx + 1}/{affUrls.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setAffinityImgRegenConfirm(true)}
                          disabled={isAffinityImgRegenerating}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-amber-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          <RotateCcw size={10} className={isAffinityImgRegenerating ? 'animate-spin' : ''} />
                          재생성
                        </button>
                        <button
                          onClick={() => setAffinityImgDeleteConfirm(safeIdx)}
                          className="flex items-center gap-0.5 text-[9px] font-black text-white/40 hover:text-red-400 transition-colors px-1.5 py-1 rounded-lg hover:bg-red-500/20"
                        >
                          <Trash2 size={10} />
                          삭제
                        </button>
                      </div>
                    </div>
                    <div
                      className="relative rounded-2xl overflow-hidden border border-white/10"
                      onMouseEnter={() => setHoveredAffinityImg(true)}
                      onMouseLeave={() => setHoveredAffinityImg(false)}
                    >
                      <div className="cursor-zoom-in group" onClick={() => setGalleryLightbox(affUrls[safeIdx])}>
                        <img src={affUrls[safeIdx]} alt="affinity" className="w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center pointer-events-none">
                          <Maximize2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow" />
                        </div>
                      </div>
                      {hoveredAffinityImg && affUrls.length > 1 && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setAffinityImgIndex(Math.max(0, safeIdx - 1)); }}
                            disabled={safeIdx === 0}
                            className="absolute left-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >‹</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setAffinityImgIndex(Math.min(affUrls.length - 1, safeIdx + 1)); }}
                            disabled={safeIdx === affUrls.length - 1}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center disabled:opacity-20 text-sm font-bold z-10 hover:bg-black/80 transition-colors"
                          >›</button>
                        </>
                      )}
                    </div>
                    {activeTopic?.affinity_max_scene && (
                      <p className="text-[10px] text-white/40 italic leading-relaxed px-1 whitespace-pre-wrap">{activeTopic.affinity_max_scene}</p>
                    )}
                  </div>
                );
              })()}

              {!activeTopic?.cover_image && !activeTopic?.ai_character?.image && !activeTopic?.user_character?.image && !activeTopic?.ending_image && !activeTopic?.affinity_image &&
               (['승', '전', '결'] as const).every(s => { const r = activeTopic?.stage_character_images?.[s]; return !r || (Array.isArray(r) && r.length === 0); }) && (
                <div className="text-center py-16 space-y-2">
                  <ImageIcon size={28} className="mx-auto text-white/20" />
                  <p className="text-xs font-bold text-white/30">아직 생성된 이미지가 없습니다</p>
                </div>
              )}
            </div>
          ) : null}

          {/* 갤러리 라이트박스 */}
        </div>
      </div>

      {/* 호감도 100 특전 CG 오버레이 */}
      {affinityMaxOverlay && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
          <div className="relative w-full max-w-lg bg-[#0f0f12] rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10 animate-in zoom-in-95 duration-300">
            {/* 상단 배지 */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-amber-500/20 border border-amber-500/30 rounded-full px-4 py-1.5">
              <span className="text-amber-400 text-[10px] font-black uppercase tracking-widest">❤ 호감도 MAX</span>
            </div>
            {/* 이미지 영역 */}
            {activeTopic?.affinity_image ? (
              <div className="relative cursor-zoom-in group" onClick={() => setGalleryLightbox(activeTopic.affinity_image)}>
                <img src={activeTopic.affinity_image} alt="affinity max" className="w-full object-cover max-h-80 group-hover:scale-[1.02] transition-transform duration-300" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f12] via-transparent to-transparent" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                  <div className="bg-black/50 backdrop-blur-sm rounded-full p-2.5">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center bg-gradient-to-b from-amber-900/20 to-[#0f0f12]">
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto">
                    <ImageIcon size={22} className="text-amber-400" />
                  </div>
                  <p className="text-[10px] text-white/30 font-bold">이미지 생성 중...</p>
                </div>
              </div>
            )}
            {/* 씬 텍스트 */}
            <div className="px-6 pb-6 pt-2 space-y-4">
              <p className="text-sm text-white/80 font-medium leading-relaxed whitespace-pre-wrap text-center">
                {affinityMaxOverlay.scene}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setAffinityMaxOverlay(null); setActiveTab('gallery'); }}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white/60 rounded-2xl font-black text-sm transition-all"
                >
                  앨범에서 보기
                </button>
                <button
                  onClick={() => setAffinityMaxOverlay(null)}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-2xl font-black text-sm transition-all"
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 호감도 특전 이미지 재생성 확인 */}
      {affinityImgRegenConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-[#1e1e22] w-full max-w-sm rounded-[2rem] p-8 shadow-2xl border border-white/5 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <RotateCcw size={22} />
              </div>
              <h3 className="text-white text-lg font-black">특전 이미지 재생성</h3>
              <p className="text-white/60 text-sm font-medium leading-relaxed">새로운 특전 이미지를 생성합니다.<br />기존 이미지는 히스토리에 남습니다.</p>
              <div className="inline-flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 rounded-full px-3 py-1 mt-1">
                <span className="text-amber-400 text-xs font-black">15 DT 소모</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAffinityImgRegenConfirm(false)} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => { setAffinityImgRegenConfirm(false); regenAffinityImage(); }} className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-black text-sm transition-all">재생성</button>
            </div>
          </div>
        </div>
      )}

      {/* 호감도 특전 이미지 삭제 확인 */}
      {affinityImgDeleteConfirm !== null && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 backdrop-blur-md px-6">
          <div className="bg-[#1e1e22] w-full max-w-sm rounded-[2rem] p-8 shadow-2xl border border-white/5 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Trash2 size={22} />
              </div>
              <h3 className="text-white text-lg font-black">이미지 삭제</h3>
              <p className="text-white/60 text-sm font-medium leading-relaxed">이 특전 이미지를 삭제합니다.<br />삭제 후 복구할 수 없습니다.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAffinityImgDeleteConfirm(null)} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl font-black text-sm transition-all">취소</button>
              <button onClick={() => deleteAffinityImage(affinityImgDeleteConfirm!)} className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm transition-all">삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* 갤러리 라이트박스 */}
      {galleryLightbox && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center p-4"
          onClick={() => setGalleryLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
            onClick={() => setGalleryLightbox(null)}
          >
            <X size={28} />
          </button>
          <img
            src={galleryLightbox}
            alt="확대 보기"
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 인물 관계도 풀스크린 모달 */}
      {showGraphModal && relationGraph?.nodes?.length && (() => {
        const nodes = relationGraph.nodes || [];
        const edges = relationGraph.edges || [];
        const nodeR = 28;
        const namePad = 8;
        const nameH = 15;
        const n = nodes.length;
        const maxLabelW = edges.length > 0
          ? Math.max(...edges.map((e: any) => Math.max((e.relation || '').length * 6, 8)))
          : 0;
        const neededChord = 2 * nodeR + 2 * (namePad + nameH) + 12;
        const minRNodes = n <= 1 ? 0 : Math.ceil(neededChord / 2 / Math.sin(Math.PI / n));
        const minRLabels = n >= 2 && maxLabelW > 0
          ? Math.ceil(maxLabelW / Math.sin(Math.PI / n))
          : 0;
        const r = n <= 1 ? 0 : Math.max(110, minRNodes, minRLabels);
        const maxNamePx = nodes.reduce((m: number, nd: any) => Math.max(m, Math.min((nd.name || '').length, 7) * 11), 0);
        const outerExtent = r + nodeR + namePad + maxNamePx + 16;
        const W = Math.max(320, outerExtent * 2);
        const H = Math.max(280, outerExtent * 2);
        const cx = W / 2, cy = H / 2;

        const positions: Record<string, { x: number; y: number; lx: number; ly: number; anchor: string }> = {};
        nodes.forEach((node: any, i: number) => {
          const angle = n <= 1 ? -Math.PI / 2 : (2 * Math.PI / n) * i - Math.PI / 2;
          const px = cx + r * Math.cos(angle);
          const py = cy + r * Math.sin(angle);
          const dx = px - cx, dy = py - cy;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ndx = dx / len, ndy = dy / len;
          const anchor = ndx > 0.3 ? 'start' : ndx < -0.3 ? 'end' : 'middle';
          const labelOffset = nodeR + namePad + 2;
          positions[node.id] = {
            x: px, y: py,
            lx: n <= 1 ? px : px + ndx * labelOffset,
            ly: n <= 1 ? py + labelOffset + nameH / 2 : py + ndy * labelOffset,
            anchor,
          };
        });

        const nodeColor: Record<string, string> = { ai: '#3b82f6', user: '#8b5cf6', supporting: '#64748b' };
        const edgeColor: Record<string, string> = { positive: '#22c55e', neutral: '#94a3b8', negative: '#ef4444' };

        const edgeData = edges.map((edge: any) => {
          const from = positions[edge.from], to = positions[edge.to];
          if (!from || !to) return null;
          const ex = to.x - from.x, ey = to.y - from.y;
          const elen = Math.sqrt(ex * ex + ey * ey) || 1;
          const ux = ex / elen, uy = ey / elen;
          const x1 = from.x + ux * nodeR, y1 = from.y + uy * nodeR;
          const x2 = to.x - ux * nodeR, y2 = to.y - uy * nodeR;
          const label = edge.relation || '';
          const lw = Math.max(label.length * 6, 8);
          const color = edgeColor[edge.sentiment] ?? '#94a3b8';
          return { x1, y1, x2, y2, plx: (x1 + x2) / 2 + (-uy * 12), ply: (y1 + y2) / 2 + (ux * 12), label, lw, color };
        });
        for (let iter = 0; iter < 12; iter++) {
          for (let a = 0; a < edgeData.length; a++) {
            for (let b = a + 1; b < edgeData.length; b++) {
              const la = edgeData[a], lb = edgeData[b];
              if (!la || !lb || !la.label || !lb.label) continue;
              const overlapX = (la.lw + lb.lw) / 2 + 4 - Math.abs(la.plx - lb.plx);
              const overlapY = 17 - Math.abs(la.ply - lb.ply);
              if (overlapX > 0 && overlapY > 0) {
                const push = overlapY / 2 + 1;
                if (la.ply <= lb.ply) { la.ply -= push; lb.ply += push; }
                else { la.ply += push; lb.ply -= push; }
              }
            }
          }
        }

        return (
          <div
            className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
            onClick={() => setShowGraphModal(false)}
          >
            <div
              className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
              style={{ maxWidth: '90vw', maxHeight: '90vh', width: Math.min(W + 48, window.innerWidth * 0.9), height: Math.min(H + 120, window.innerHeight * 0.9) }}
              onClick={e => e.stopPropagation()}
            >
              {/* 모달 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 bg-rose-500 rounded-full" />
                  <h3 className="text-sm font-black text-white uppercase">인물 관계도</h3>
                  {relationGraph?.stage && (
                    <span className="text-[9px] font-black px-2 py-0.5 bg-rose-500/20 text-rose-400 rounded-md">{relationGraph.stage} 단계</span>
                  )}
                </div>
                <button onClick={() => setShowGraphModal(false)} className="p-1.5 hover:bg-white/10 text-white/40 hover:text-white/70 rounded-xl transition-all">
                  <X size={16} />
                </button>
              </div>

              {/* SVG */}
              <div className="flex-1 overflow-auto flex items-center justify-center p-4">
                <svg width={W} height={H}>
                  {edgeData.map((d: any, i: number) => d && (
                    <line key={`ml${i}`} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2}
                      stroke={d.color} strokeWidth="1.8" strokeOpacity="0.5" />
                  ))}
                  {edgeData.map((d: any, i: number) => d && d.label && (
                    <g key={`mt${i}`}>
                      <rect x={d.plx - d.lw / 2} y={d.ply - 8} width={d.lw} height={15} fill="#1e293b" fillOpacity="0.95" rx="3" />
                      <text x={d.plx} y={d.ply} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={d.color} fontWeight="700">{d.label}</text>
                    </g>
                  ))}
                  {nodes.map((node: any) => {
                    const pos = positions[node.id];
                    if (!pos) return null;
                    const color = nodeColor[node.type] ?? '#64748b';
                    const name = node.name.length > 7 ? node.name.slice(0, 7) + '…' : node.name;
                    const nw = Math.max(name.length * 7.5, 24);
                    const nwHalf = nw / 2;
                    const rectX = pos.anchor === 'start' ? pos.lx : pos.anchor === 'end' ? pos.lx - nw : pos.lx - nwHalf;
                    return (
                      <g key={node.id}>
                        <circle cx={pos.x} cy={pos.y} r={nodeR} fill={color} fillOpacity="0.15" stroke={color} strokeWidth="2.5" />
                        <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={color} fontWeight="900" opacity="0.7">
                          {node.type === 'ai' ? '상대' : node.type === 'user' ? '나' : '조연'}
                        </text>
                        <rect x={rectX} y={pos.ly - nameH / 2} width={nw} height={nameH} fill="#1e293b" fillOpacity="0.95" rx="3" />
                        <text x={pos.lx} y={pos.ly} textAnchor={pos.anchor as "start" | "middle" | "end" | "inherit"} dominantBaseline="middle" fontSize="10" fill={color} fontWeight="800">{name}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* 범례 */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-6 py-3 border-t border-white/10">
                {[['#3b82f6', '상대'], ['#8b5cf6', '나'], ['#64748b', '조연']].map(([c, l]) => (
                  <div key={l} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                    <span className="text-[10px] font-bold text-white/40">{l}</span>
                  </div>
                ))}
                <div className="w-px h-4 bg-white/10 mx-1 self-center" />
                {[['#22c55e', '우호'], ['#94a3b8', '중립'], ['#ef4444', '적대']].map(([c, l]) => (
                  <div key={l} className="flex items-center gap-1.5">
                    <div className="w-5 h-0.5 rounded" style={{ backgroundColor: c }} />
                    <span className="text-[10px] font-bold text-white/40">{l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 요약 완료 모달 */}
      {summaryNotif?.show && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-2xl ${summaryNotif.success ? 'bg-blue-50 text-blue-500' : 'bg-red-50 text-red-500'}`}><MessageSquare size={22} /></div>
              <h3 className="text-lg font-black text-slate-800">{summaryNotif.success ? '요약 완료' : '요약 실패'}</h3>
            </div>
            {summaryNotif.success && (
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 max-h-60 overflow-y-auto">
                <p className="text-[12px] font-medium text-slate-600 leading-relaxed whitespace-pre-wrap">{summaryNotif.text}</p>
              </div>
            )}
            {!summaryNotif.success && <p className="text-sm font-medium text-slate-500">{summaryNotif.text}</p>}
            <button onClick={() => setSummaryNotif(null)} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-2xl font-black text-sm transition-all">확인</button>
          </div>
        </div>
      )}

      {/* 에러 토스트 */}
      {errorToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 px-5 py-3 rounded-2xl shadow-lg max-w-sm">
            <span className="text-sm font-bold leading-snug">{errorToast}</span>
            <button onClick={() => setErrorToast(null)} className="ml-auto text-red-400 hover:text-red-600 shrink-0 font-black text-base leading-none">✕</button>
          </div>
        </div>
      )}

      {/* 엔딩 오버레이 */}
      {endingData && (() => {
        const glowColor = 'from-amber-500/20 via-orange-500/20 to-yellow-500/20';
        const borderColor = 'border-amber-400/20';
        const titleColor = 'text-amber-300';
        const btnClass = 'from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-amber-900/30';
        return (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <div className="relative max-w-md w-full animate-in zoom-in-95 duration-300">
              {/* 배경 글로우 */}
              <div className={`absolute inset-0 rounded-[2.5rem] bg-gradient-to-br ${glowColor} blur-xl`} />
              <div className={`relative bg-[#111115] rounded-[2.5rem] border ${borderColor} shadow-2xl overflow-hidden`}>
                {/* 헤더 */}
                <div className="pt-8 pb-5 px-8 text-center space-y-3 border-b border-white/6">
                  <h2 className={`text-2xl font-black tracking-tight ${titleColor}`}>
                    엔딩
                  </h2>
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                    <p className="text-[11px] font-bold text-white/30 tracking-widest uppercase">
                      최종 호감도 {endingData.affinity > 0 ? '+' : ''}{endingData.affinity}
                    </p>
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                  </div>
                </div>
                {/* 본문 */}
                <div className="px-8 py-5 max-h-60 overflow-y-auto custom-scrollbar">
                  <p className="text-[13px] text-white/70 leading-[1.9] whitespace-pre-wrap break-keep [text-wrap:pretty]">{endingData.scene}</p>
                </div>
                {/* 버튼 */}
                <div className="px-8 pb-8 pt-3">
                  <button
                    onClick={() => setEndingData(null)}
                    className={`w-full bg-gradient-to-r ${btnClass} text-white py-3.5 rounded-2xl font-black text-sm transition-all shadow-lg`}
                  >
                    이야기를 마칩니다
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 확인 모달 (삭제/확인 등) — variant에 따라 UI 분기 */}
      {modal?.show && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[300] flex items-center justify-center p-4">
          <div className="bg-[#1e1e22] rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl border border-white/5 space-y-7 animate-in zoom-in-95 duration-300">
            <div className="text-center space-y-3">
              {modal.variant === 'delete' ? (
                <div className="mx-auto w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-2">
                  <Trash2 size={24} />
                </div>
              ) : (
                <div className="mx-auto w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center text-purple-400 mb-2 text-2xl">
                  {modal.title.startsWith('🎬') ? '🎬' : modal.title.startsWith('🔄') ? '🔄' : '✨'}
                </div>
              )}
              <h3 className="text-xl font-black text-white">{modal.title.replace(/^[🎬🔄✨]\s*/u, '')}</h3>
              <p className="text-xs font-medium text-slate-400 leading-relaxed whitespace-pre-line px-2">{modal.message}</p>
            </div>

            {modal.warning && (
              <div className={`${modal.variant === 'delete' ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'} border rounded-2xl px-4 py-3.5`}>
                <p className={`text-[10px] font-black ${modal.variant === 'delete' ? 'text-red-400' : 'text-amber-400'} leading-relaxed text-center`}>
                  ⚠ {modal.warning}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={() => { modal.onConfirm(); setModal(null); }}
                className={`w-full text-white py-4 rounded-2xl font-black text-sm transition-all active:scale-[0.98] ${
                  modal.variant === 'delete'
                    ? 'bg-red-600 hover:bg-red-500 shadow-xl shadow-red-900/20'
                    : 'bg-purple-600 hover:bg-purple-500 shadow-xl shadow-purple-900/20'
                }`}
              >
                {modal.confirmLabel ?? (modal.variant === 'delete' ? '삭제하기' : '확인')}
              </button>
              <button
                onClick={() => setModal(null)}
                className="w-full bg-white/5 hover:bg-white/10 text-slate-400 py-3 rounded-2xl font-black text-xs transition-all"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 이미지 크게 보기 모달 */}
      {fullViewImage && (
        <div className="fixed inset-0 z-[500] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={() => setFullViewImage(null)}>
          <button className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all">
            <X size={24} />
          </button>
          <div className="relative max-w-4xl w-full h-full flex flex-col items-center justify-center gap-6" onClick={e => e.stopPropagation()}>
            <img src={fullViewImage.src} alt={fullViewImage.alt} className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border border-white/10" />
            <div className="text-center">
              <h3 className="text-xl font-black text-white">{fullViewImage.alt}</h3>
              <p className="text-white/40 text-xs font-bold tracking-widest mt-1 uppercase">Dive.ai Character Portrait</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;
