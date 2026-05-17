import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { FlowData } from '../types';

const STEPS = [
  '소재 분석 중...',
  '시나리오 작성 중...',
  '캐릭터 설계 중...',
  '인터랙티브 구조 변환 중...',
  '엔딩 조건 설계 중...',
  '완료!',
];


interface Props {
  flowData: FlowData;
  onUpdate: (data: Partial<FlowData>) => void;
  onNext: () => void;
  onBack: () => void;
  onError: (msg: string) => void;
  onHome: () => void;
  builderStep: number;
  isBuilding: boolean;
  onStartBuild: () => void;
}

export default function Screen3({ 
  flowData, onUpdate, onNext, onBack, onError, onHome,
  builderStep, isBuilding, onStartBuild
}: Props) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    // 이미 생성 완료된 상태(topicId 존재)라면 바로 다음으로
    if (flowData.topicId) {
      onNext();
      return;
    }
    // 생성 중이 아니라면 생성 시작
    if (!isBuilding) {
      onStartBuild();
    }
  }, []);

  // 생성 완료 감시 (백그라운드에서 완료되었을 때 처리)
  useEffect(() => {
    if (flowData.topicId) {
      const timer = setTimeout(() => onNext(), 800);
      return () => clearTimeout(timer);
    }
  }, [flowData.topicId]);

  const progress = Math.round((Math.min(builderStep, 6) / 6) * 100);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-6 gap-10 relative pb-28 overflow-hidden">

      {/* 배경 글로우 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-violet-600/6 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-72 h-72 bg-purple-700/5 rounded-full blur-3xl" />
      </div>

      {/* 로고 */}
      <div className="flex flex-col items-center gap-5 z-10">
        <button onClick={onHome} className="flex items-center gap-2.5 font-black text-xl text-white tracking-tighter hover:opacity-70 transition-opacity">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-700 rounded-xl flex items-center justify-center shadow-lg shadow-violet-900/40">
            <Sparkles size={17} className="text-white" />
          </div>
          Dive.ai
        </button>

        {!flowData.topicId && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-700">
            <div className="px-4 py-2 bg-violet-500/8 border border-violet-500/20 rounded-full flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
              <p className="text-violet-300/80 text-[11px] font-bold">
                시나리오가 생성 중입니다. 잠시만 기다려주세요.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 진행률 바 */}
      <div className="w-full max-w-xs z-10 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[11px] text-white/25 font-bold">생성 중</span>
          <span className="text-[11px] text-white/25 font-bold">{progress}%</span>
        </div>
        <div className="w-full h-0.5 bg-white/6 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>


      {/* DT 안내 */}
      {!flowData.topicId && (
        <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-1.5 z-10">
          <span className="text-amber-400 text-[11px] font-black">50 DT 소모</span>
          <span className="text-amber-400/60 text-[10px]">생성 완료 시 차감됩니다</span>
        </div>
      )}

      {/* 스텝 목록 */}
      <div className="w-full max-w-xs space-y-2 z-10">
        {STEPS.map((step, i) => {
          const stepNum = i + 1;
          const isActive = builderStep === stepNum;
          const isDone = builderStep > stepNum || (!!(flowData.topicId) && stepNum === 6);

          return (
            <div
              key={i}
              className={`flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border transition-all duration-500 ${
                isActive
                  ? 'bg-violet-600/12 border-violet-500/25 shadow-[0_0_24px_rgba(139,92,246,0.08)]'
                  : isDone
                  ? 'bg-white/3 border-white/6'
                  : 'bg-transparent border-transparent'
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs shrink-0 transition-all duration-500 ${
                isDone
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : isActive
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-900/50'
                  : 'bg-white/4 text-white/15 border border-white/6'
              }`}>
                {isDone ? '✓' : stepNum}
              </div>

              <span className={`text-sm font-bold transition-all duration-500 ${
                isActive ? 'text-white' : isDone ? 'text-white/35' : 'text-white/12'
              }`}>
                {step}
              </span>

              {isActive && (
                <div className="ml-auto flex gap-1">
                  {[0, 1, 2].map(j => (
                    <div
                      key={j}
                      className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${j * 150}ms` }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 중단 버튼 */}
      {!flowData.topicId && isBuilding && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-3 duration-500">
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="group flex items-center gap-2 px-6 py-3 rounded-full bg-slate-950/90 backdrop-blur-md border border-white/8 text-white/30 hover:text-red-400 hover:border-red-500/25 hover:bg-red-500/6 shadow-xl transition-all duration-300 text-xs font-black"
          >
            <X size={13} className="group-hover:rotate-90 transition-transform duration-300 shrink-0" />
            시나리오 생성 중단
          </button>
        </div>
      )}

      {/* 취소 확인 모달 */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-slate-900 rounded-3xl p-7 max-w-xs w-full shadow-2xl border border-white/8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-3">
              <div className="mx-auto w-11 h-11 bg-violet-500/10 border border-violet-500/15 rounded-2xl flex items-center justify-center mb-1">
                <Sparkles size={20} className="text-violet-400" />
              </div>
              <h3 className="text-lg font-black text-white">생성을 중단할까요?</h3>
              <p className="text-sm text-white/40 leading-relaxed">
                지금까지 진행된 내용은 저장되지 않으며<br />소재 입력 화면으로 돌아갑니다.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => { setShowCancelConfirm(false); onBack(); }}
                className="w-full bg-red-500/12 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-3.5 rounded-2xl font-black text-sm transition-all active:scale-[0.98]"
              >
                생성 취소하기
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="w-full bg-white/4 hover:bg-white/8 text-white/35 py-3 rounded-2xl font-black text-xs transition-all"
              >
                계속 기다리기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
