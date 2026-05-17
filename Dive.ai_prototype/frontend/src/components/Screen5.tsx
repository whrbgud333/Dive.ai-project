import React, { useState } from 'react';
import { Sparkles, ChevronLeft, Info } from 'lucide-react';
import { FlowData } from '../types';
import { apiFetch } from '../lib/api';

interface Props {
  flowData: FlowData;
  onUpdate: (data: Partial<FlowData>) => void;
  onStart: () => void;
  onBack: () => void;
  onHome: () => void;
}

export default function Screen5({ flowData, onUpdate, onStart, onBack, onHome }: Props) {
  const [persona, setPersona] = useState(flowData.userPersona);

  const handleStart = async () => {
    if (flowData.topicId) {
      try {
        await apiFetch(`/topics/${flowData.topicId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_character: {
              name: persona.name,
              gender: persona.gender,
              age: persona.age,
              personality: persona.personality,
              background: persona.background,
              appearance: persona.appearance,
              image: persona.image,
            },
          }),
        });
      } catch (e) {
        console.error(e);
      }
    }
    onUpdate({ userPersona: persona });
    onStart();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex flex-col">
      {/* 헤더 */}
      <header className="p-6 flex items-center gap-3 sticky top-0 bg-white/80 backdrop-blur-xl border-b border-slate-100 z-10">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
          <ChevronLeft size={20} className="text-slate-600" />
        </button>
        <div onClick={onHome} className="flex items-center gap-2 font-black text-lg text-slate-800 tracking-tighter cursor-pointer hover:opacity-70 transition-opacity">
          <Sparkles size={18} className="text-blue-500" /> Dive.ai
        </div>
        <div className="ml-auto text-xs font-black text-slate-400 uppercase tracking-widest">Step 5</div>
      </header>

      <main className="flex-1 px-6 py-8 pb-32 max-w-2xl mx-auto w-full space-y-10">

        {/* 타이틀 */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-black text-slate-800">플레이 시작 전 설정</h1>
          <p className="text-sm text-slate-400 font-medium">설정을 확인하고 대화를 시작하세요</p>
        </div>

        {/* 유저 페르소나 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-4 bg-purple-500 rounded-full" />
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">유저 페르소나</h2>
          </div>
          <p className="text-[11px] text-slate-400 font-medium -mt-2">
            캐릭터 정보를 자유롭게 수정해보세요.
          </p>
          <div className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm space-y-4">
            {(
              [
                { key: 'name' as const, label: '이름 (AI가 부를 이름)', placeholder: '이름 입력' },
                { key: 'gender' as const, label: '성별', placeholder: '예: 남성, 여성' },
                { key: 'age' as const, label: '나이', placeholder: '예: 20대 초반, 17세' },
                { key: 'personality' as const, label: '성격', placeholder: '성격 묘사' },
                { key: 'background' as const, label: '직업 / 배경', placeholder: '직업 또는 배경 설정' },
                { key: 'appearance' as const, label: '외형', placeholder: '외형 묘사' },
              ] as const
            ).map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
                <input
                  value={persona[key]}
                  onChange={e => setPersona(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                />
              </div>
            ))}
          </div>
        </div>


      </main>

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-xl border-t border-slate-100">
        <div className="max-w-sm mx-auto">
          <button
            onClick={handleStart}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-2xl font-black text-base shadow-lg hover:opacity-90 transition-all"
          >
            대화 시작 ✨
          </button>
        </div>
      </div>
    </div>
  );
}
