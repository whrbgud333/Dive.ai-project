import React, { useState } from 'react';
import { Sparkles, ChevronLeft, Wand2 } from 'lucide-react';
import { FlowData, CharacterInput, AiFlags } from '../types';

interface Props {
  flowData: FlowData;
  onUpdate: (data: Partial<FlowData>) => void;
  onNext: () => void;
  onBack: () => void;
  onHome: () => void;
}

interface AiBadgeProps {
  active: boolean;
  onToggle: () => void;
}

function AiBadge({ active, onToggle }: AiBadgeProps) {
  return (
    <button
      onClick={onToggle}
      className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-black border transition-all ${
        active
          ? 'bg-violet-600 border-violet-600 text-white'
          : 'bg-white/5 border-white/10 text-white/30 hover:border-violet-500/30 hover:text-violet-400'
      }`}
    >
      AI
    </button>
  );
}

interface CharSectionProps {
  label: string;
  accentClass: string;
  data: CharacterInput;
  onChange: (data: CharacterInput) => void;
}

const FIELDS: { key: keyof Omit<CharacterInput, 'aiFlags'>; label: string; placeholder: string }[] = [
  { key: 'name',        label: '이름',  placeholder: '캐릭터 이름' },
  { key: 'gender',      label: '성별',  placeholder: '예: 남성, 여성' },
  { key: 'age',         label: '나이',  placeholder: '예: 20대 초반, 17세' },
  { key: 'personality', label: '성격',  placeholder: '성격 묘사' },
  { key: 'appearance',  label: '외형',  placeholder: '외형 묘사' },
  { key: 'background',  label: '배경',  placeholder: '배경 및 설정' },
];

function CharSection({ label, accentClass, data, onChange }: CharSectionProps) {
  const toggleFlag = (field: keyof AiFlags) => {
    onChange({ ...data, aiFlags: { ...data.aiFlags, [field]: !data.aiFlags[field] } });
  };

  const setAllAI = () => {
    onChange({ ...data, aiFlags: { name: true, personality: true, appearance: true, background: true, gender: true, age: true } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className={`text-xs font-black uppercase tracking-widest ${accentClass}`}>{label}</h3>
        <button
          onClick={setAllAI}
          className="text-[10px] font-black px-3 py-1 rounded-lg border border-white/10 text-white/30 hover:border-violet-500/30 hover:text-violet-400 flex items-center gap-1 transition-all"
        >
          <Wand2 size={10} /> 전체 AI에게 맡김
        </button>
      </div>
      <p className="text-[11px] text-white/25 font-medium -mt-2">
        AI 뱃지를 누르면 시나리오에 맞게 AI가 자동으로 설정해요.
      </p>
      <div className="space-y-2.5">
        {FIELDS.map(({ key, label: fieldLabel, placeholder }) => {
          const isAI = data.aiFlags[key as keyof AiFlags];
          return (
            <div key={key} className="flex items-center gap-2">
              <label className="w-10 text-[11px] font-black text-white/30 shrink-0">{fieldLabel}</label>
              <input
                value={isAI ? '' : data[key]}
                onChange={e => onChange({ ...data, [key]: e.target.value })}
                disabled={isAI}
                placeholder={isAI ? 'AI가 자동 설정' : placeholder}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-all border ${
                  isAI
                    ? 'bg-violet-500/8 border-violet-500/15 text-violet-300/50 placeholder:text-violet-300/30 cursor-not-allowed'
                    : 'bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-violet-500/40 focus:bg-white/6'
                }`}
              />
              <AiBadge active={isAI} onToggle={() => toggleFlag(key as keyof AiFlags)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Screen2({ flowData, onUpdate, onNext, onBack, onHome }: Props) {
  const [material, setMaterial] = useState(flowData.material);
  const [materialByAI, setMaterialByAI] = useState(flowData.materialByAI);
  const [aiChar, setAiChar] = useState<CharacterInput>(flowData.aiCharacterInput);
  const [userChar, setUserChar] = useState<CharacterInput>(flowData.userCharacterInput);

  const handleStart = () => {
    onUpdate({
      material,
      materialByAI,
      aiCharacterInput: aiChar,
      userCharacterInput: userChar,
    });
    onNext();
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col overflow-hidden relative">

      {/* 배경 글로우 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 right-1/3 w-[400px] h-[400px] bg-violet-600/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 left-1/4 w-64 h-64 bg-purple-700/5 rounded-full blur-3xl" />
      </div>

      {/* 헤더 */}
      <header className="relative z-10 px-5 pt-6 pb-4 flex items-center gap-3 sticky top-0 bg-slate-950/90 backdrop-blur-xl border-b border-white/6">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/8 transition-colors"
        >
          <ChevronLeft size={20} className="text-white/60" />
        </button>
        <button
          onClick={onHome}
          className="flex items-center gap-2.5 font-black text-lg text-white tracking-tighter hover:opacity-70 transition-opacity"
        >
          <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-700 rounded-xl flex items-center justify-center shadow-lg shadow-violet-900/40">
            <Sparkles size={15} className="text-white" />
          </div>
          Dive.ai
        </button>
      </header>

      <main className="relative z-10 flex-1 px-5 py-8 pb-32 max-w-2xl mx-auto w-full space-y-9">

        {/* 섹션 A — 소재 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-emerald-400/80 uppercase tracking-widest">소재 입력</h3>
            <button
              onClick={() => setMaterialByAI(!materialByAI)}
              className={`text-[10px] font-black px-3 py-1 rounded-lg border flex items-center gap-1 transition-all ${
                materialByAI
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'bg-white/5 border-white/10 text-white/30 hover:border-violet-500/30 hover:text-violet-400'
              }`}
            >
              <Wand2 size={10} /> AI에게 맡김
            </button>
          </div>
          <textarea
            value={materialByAI ? '' : material}
            onChange={e => setMaterial(e.target.value)}
            disabled={materialByAI}
            rows={3}
            placeholder={
              materialByAI
                ? 'AI가 선택하신 장르·유형에 맞게 소재를 자동으로 생성합니다'
                : '예: 마력을 흡수하는 저주받은 소녀와 그녀를 지키는 몰락 기사'
            }
            className={`w-full rounded-2xl px-4 py-3 text-sm font-medium outline-none resize-none transition-all border ${
              materialByAI
                ? 'bg-violet-500/8 border-violet-500/15 text-violet-300/50 placeholder:text-violet-300/30 cursor-not-allowed'
                : 'bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-violet-500/40 focus:bg-white/6'
            }`}
          />
        </div>

        <div className="border-t border-white/6" />

        {/* 섹션 B — 상대 캐릭터 */}
        <CharSection
          label="상대 캐릭터 (챗에서 AI가 연기할 캐릭터)"
          accentClass="text-violet-400/80"
          data={aiChar}
          onChange={setAiChar}
        />

        <div className="border-t border-white/6" />

        {/* 섹션 C — 유저 캐릭터 */}
        <CharSection
          label="유저 캐릭터 (챗에서 유저가 연기할 캐릭터)"
          accentClass="text-purple-400/80"
          data={userChar}
          onChange={setUserChar}
        />

      </main>

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 p-5 bg-slate-950/90 backdrop-blur-xl border-t border-white/6 z-20">
        <div className="max-w-sm mx-auto">
          <button
            onClick={handleStart}
            className="w-full bg-gradient-to-r from-violet-600 to-purple-600 text-white py-4 rounded-2xl font-black text-base shadow-lg shadow-violet-900/40 hover:opacity-90 transition-all active:scale-[0.99]"
          >
            시나리오 생성 시작
          </button>
        </div>
      </div>
    </div>
  );
}
