import React, { useEffect, useState } from 'react';
import { Sparkles, BookOpen, ChevronRight, ListFilter, Wand2, MessageCircleHeart } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface Props {
  onStart: () => void;
  onContinue: () => void;
  onGallery: (scenarioId?: number) => void;
}

interface ScenarioCard {
  id: number;
  title: string;
  genre: string | null;
  content_type: string | null;
  cover_image: string | null;
  ai_character: any;
}

const CONTENT_TYPE_COLOR: Record<string, string> = {
  만화:   'bg-violet-500/20 text-violet-300',
  소설:   'bg-blue-500/20 text-blue-300',
  시리즈: 'bg-emerald-500/20 text-emerald-300',
  영화:   'bg-amber-500/20 text-amber-300',
  고전:   'bg-rose-500/20 text-rose-300',
};

const HOW_TO_STEPS = [
  {
    step: '01',
    icon: ListFilter,
    title: '장르 선택',
    desc: '만화·소설·영화·고전 등 원하는 콘텐츠 유형과 장르를 고르세요. 무작위 선택도 가능합니다.',
    color: 'from-pink-500/20 to-rose-500/10',
    border: 'border-pink-500/20',
    iconColor: 'text-pink-400',
    iconBg: 'bg-pink-500/15',
  },
  {
    step: '02',
    icon: Wand2,
    title: 'AI 시나리오 생성',
    desc: '소재와 캐릭터를 입력하면 AI가 기승전결 시나리오와 표지 이미지를 자동으로 완성합니다.',
    color: 'from-fuchsia-500/20 to-pink-500/10',
    border: 'border-fuchsia-500/20',
    iconColor: 'text-fuchsia-400',
    iconBg: 'bg-fuchsia-500/15',
  },
  {
    step: '03',
    icon: MessageCircleHeart,
    title: '캐릭터와 대화',
    desc: '생성된 시나리오 속 AI 캐릭터와 실시간으로 대화하며 나만의 인터랙티브 스토리를 완성하세요.',
    color: 'from-rose-500/20 to-pink-500/10',
    border: 'border-rose-500/20',
    iconColor: 'text-rose-400',
    iconBg: 'bg-rose-500/15',
  },
];

const CARDS_PER_PAGE = 4;
const ROTATE_INTERVAL = 3500;

export default function Screen0({ onStart, onContinue, onGallery }: Props) {
  const [scenarios, setScenarios] = useState<ScenarioCard[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    apiFetch('/scenarios/published')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setScenarios(data.slice(0, 24));
      })
      .catch(() => {});
  }, []);

  const totalPages = Math.max(1, Math.ceil(scenarios.length / CARDS_PER_PAGE));

  useEffect(() => {
    if (scenarios.length <= CARDS_PER_PAGE) return;
    const totalPgs = Math.ceil(scenarios.length / CARDS_PER_PAGE);
    const id = setInterval(() => {
      setPage(p => (p + 1) % totalPgs);
    }, ROTATE_INTERVAL);
    return () => clearInterval(id);
  }, [scenarios.length]);

  const visibleScenarios = scenarios.slice(page * CARDS_PER_PAGE, page * CARDS_PER_PAGE + CARDS_PER_PAGE);

  return (
    <div className="bg-slate-950 flex flex-col relative">

      {/* 배경 글로우 */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-pink-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 left-1/4 w-80 h-80 bg-rose-700/6 rounded-full blur-3xl" />
        <div className="absolute top-2/3 right-1/4 w-64 h-64 bg-fuchsia-600/5 rounded-full blur-3xl" />
      </div>

      {/* 헤더 */}
      <header className="relative z-10 px-6 pt-6 pb-4 flex items-center">
        <div className="flex items-center gap-2.5 font-black text-xl text-white tracking-tighter">
          <div className="w-9 h-9 bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl flex items-center justify-center shadow-lg shadow-pink-900/40">
            <Sparkles size={17} className="text-white" />
          </div>
          Dive.ai
        </div>
      </header>

      {/* ① 히어로 섹션 */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-10 pb-16 gap-8">

        <div className="space-y-4 max-w-lg">
          <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight tracking-tight">
            모험을 시작하세요
          </h1>
          <p className="text-white/40 text-sm sm:text-base font-medium leading-relaxed">
            장르를 고르고, 캐릭터를 설정하면 AI가 기승전결 시나리오를 완성합니다.<br />
            그리고 그 세계 속 캐릭터와 직접 대화하세요.
          </p>
        </div>

        {/* CTA 버튼 */}
        <div className="flex items-center gap-3 w-full max-w-lg">
          <button
            onClick={onStart}
            className="flex-1 py-4 bg-gradient-to-r from-pink-500 to-rose-500 text-white font-black text-base rounded-2xl shadow-2xl shadow-pink-900/50 hover:opacity-90 hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            새로운 모험 시작하기
          </button>
          <button
            onClick={onContinue}
            className="flex-1 py-4 bg-white/5 border border-white/12 text-white/60 font-black text-base rounded-2xl hover:bg-white/8 hover:text-white/80 hover:border-white/20 transition-all active:scale-[0.98]"
          >
            이어서 모험하기
          </button>
        </div>

        {/* 갤러리 미리보기 */}
        {scenarios.length > 0 && (
          <div className="w-full max-w-3xl pt-2 space-y-2">
            <div
              key={page}
              className="grid grid-cols-4 gap-2.5 animate-in fade-in duration-300"
            >
              {visibleScenarios.map(s => (
                <button
                  key={s.id}
                  onClick={() => onGallery(s.id)}
                  className="group relative rounded-2xl overflow-hidden aspect-[3/4] bg-white/5 border border-white/8 hover:border-pink-500/30 transition-all active:scale-[0.97]"
                >
                  {s.cover_image ? (
                    <img
                      src={s.cover_image}
                      alt={s.title}
                      className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <BookOpen size={20} className="text-white/15" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-2.5">
                    {s.content_type && (
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${CONTENT_TYPE_COLOR[s.content_type] ?? 'bg-white/15 text-white/50'}`}>
                        {s.content_type}
                      </span>
                    )}
                    <p className="text-white text-[10px] font-black leading-tight line-clamp-2 mt-1">{s.title}</p>
                  </div>
                </button>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex justify-center gap-1.5">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={`h-1 rounded-full transition-all duration-300 ${i === page ? 'w-4 bg-pink-400' : 'w-1 bg-white/20 hover:bg-white/40'}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 구분선 */}
      <div className="relative z-10 mx-6 border-t border-white/5" />

      {/* ② 사용 방법 섹션 */}
      <section className="relative z-10 px-6 py-16">
        <div className="max-w-2xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <p className="text-[11px] font-black text-pink-400/70 uppercase tracking-widest">How it works</p>
            <h2 className="text-2xl font-black text-white">3단계로 시작하는<br />나만의 AI 스토리</h2>
          </div>

          <div className="space-y-4">
            {HOW_TO_STEPS.map(({ step, icon: Icon, title, desc, color, border, iconColor, iconBg }, i) => (
              <div key={step} className="relative">
                <div className={`bg-gradient-to-br ${color} border ${border} rounded-2xl p-5 flex items-start gap-4`}>
                  <div className="shrink-0 flex flex-col items-center gap-2">
                    <div className={`w-11 h-11 ${iconBg} rounded-2xl flex items-center justify-center`}>
                      <Icon size={20} className={iconColor} />
                    </div>
                    <span className="text-[10px] font-black text-white/20 tracking-widest">{step}</span>
                  </div>
                  <div className="space-y-1.5 pt-1">
                    <p className="text-white font-black text-sm">{title}</p>
                    <p className="text-white/40 text-xs font-medium leading-relaxed">{desc}</p>
                  </div>
                </div>
                {i < HOW_TO_STEPS.length - 1 && (
                  <div className="flex justify-center my-1">
                    <div className="w-px h-4 bg-white/10" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={onStart}
            className="w-full py-4 bg-gradient-to-r from-pink-500 to-rose-500 text-white font-black text-base rounded-2xl shadow-xl shadow-pink-900/40 hover:opacity-90 hover:scale-[1.01] transition-all active:scale-[0.99] flex items-center justify-center gap-2"
          >
            지금 바로 시작하기 <ChevronRight size={18} />
          </button>
        </div>
      </section>


      <footer className="relative z-10 py-10 text-center space-y-1">
        <p className="text-white/12 text-xs font-bold">Dive.ai © 2025 — Powered by Gemini AI</p>
        <p className="text-white/8 text-[10px] font-medium">모든 시나리오와 캐릭터는 AI가 생성한 창작물입니다</p>
      </footer>
    </div>
  );
}
