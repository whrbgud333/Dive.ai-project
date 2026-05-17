import React, { useState, useEffect } from 'react';
import { ArrowLeft, Coins, Check, Clock, Calendar, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface AttendanceData {
  consecutive_days: number;
  last_checkin_at: string | null;
  can_checkin: boolean;
  token_balance: number;
  next_streak: number;
  reward_grid: { day: number; tokens: number; multiplier: number }[];
}

interface Props {
  onBack: () => void;
  onRefreshUser: () => Promise<void>;
}

export default function AttendanceScreen({ onBack, onRefreshUser }: Props) {
  const [data, setData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  const fetchData = async () => {
    try {
      const res = await apiFetch('/auth/attendance');
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Attendance fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 카운트다운 로직 (다음 자정까지 남은 시간)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      
      const diff = tomorrow.getTime() - now.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff / (1000 * 60)) % 60);
      const secs = Math.floor((diff / 1000) % 60);
      
      setTimeLeft(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }, 1000);
    
    return () => clearInterval(timer);
  }, []);

  const handleCheckin = async () => {
    if (!data?.can_checkin || checkinLoading) return;
    
    setCheckinLoading(true);
    try {
      const res = await apiFetch('/auth/checkin', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        await fetchData();
        await onRefreshUser();
      } else {
        alert(result.message);
      }
    } catch (e) {
      alert('출석 체크에 실패했습니다.');
    } finally {
      setCheckinLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const milestones = [
    { day: 3, multiplier: 'x1.5' },
    { day: 7, multiplier: 'x3' },
    { day: 14, multiplier: 'x6' },
    { day: 21, multiplier: 'x8' },
    { day: 30, multiplier: 'x11' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#121214] text-white overflow-hidden">
      {/* 헤더 */}
      <header className="px-5 py-3 flex items-center justify-between border-b border-white/5 bg-[#121214]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 hover:bg-white/5 rounded-full transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-black tracking-tight">출석체크</h1>
        </div>
        <div className="flex items-center gap-1.5 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
          <Coins size={14} className="text-blue-400" />
          <span className="text-xs font-black text-blue-400">{data?.token_balance}</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-10">
        <div className="max-w-[480px] mx-auto px-5 py-8 space-y-8">
          
          {/* 1. 상단 마일스톤 프로그레스 바 */}
          <div className="relative px-2">
            <div className="flex justify-between items-end mb-3 h-8">
              {milestones.map((m) => (
                <div key={m.day} className="flex flex-col items-center flex-1">
                   <span className={`text-[10px] font-black px-2 py-0.5 rounded-full mb-1 ${ (data?.consecutive_days || 0) >= m.day ? 'bg-blue-600' : 'bg-slate-800 text-slate-500'}`}>
                     {m.multiplier}
                   </span>
                </div>
              ))}
            </div>
            
            <div className="relative h-2.5 bg-[#1e1e22] rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(37,99,235,0.5)]"
                style={{ width: `${Math.min(100, ((data?.consecutive_days || 0) / 30) * 100)}%` }}
              />
              {/* 마일스톤 점들 */}
              <div className="absolute inset-0 flex justify-between px-1 items-center">
                 {[3, 7, 14, 21, 30].map(day => (
                   <div key={day} className={`w-1.5 h-1.5 rounded-full ${ (data?.consecutive_days || 0) >= day ? 'bg-white' : 'bg-slate-700'}`} />
                 ))}
              </div>
            </div>

            <div className="flex justify-between mt-3 px-1">
               {[3, 7, 14, 21, 30].map(day => (
                 <span key={day} className={`text-[10px] font-black ${ (data?.consecutive_days || 0) >= day ? 'text-blue-400' : 'text-slate-600'}`}>{day}일</span>
               ))}
            </div>
          </div>

          {/* 2. 출석하기 버튼 (라인 맞춤) */}
          <div className="space-y-3">
            <button
              onClick={handleCheckin}
              disabled={!data?.can_checkin || checkinLoading}
              className={`w-full py-4 rounded-xl font-black text-base shadow-2xl transition-all active:scale-[0.99] flex items-center justify-center gap-3 ${
                data?.can_checkin 
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20' 
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              {checkinLoading ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : data?.can_checkin ? (
                <>출석하기</>
              ) : (
                <>오늘 출석 완료 <Check size={18} /></>
              )}
            </button>
            <div className="flex items-center justify-center gap-2 text-slate-500">
              <Clock size={12} />
              <span className="text-[10px] font-bold">다음 출석까지 {timeLeft}</span>
            </div>
          </div>

          {/* 3. 보상 그리드 (5열, 라인 맞춤) */}
          <div className="grid grid-cols-5 gap-2.5">
            {data?.reward_grid.map((item) => {
              const isChecked = (data?.consecutive_days || 0) >= item.day;
              const isToday = data?.next_streak === item.day && data?.can_checkin;
              const isMilestone = [3, 7, 14, 21, 30].includes(item.day);
              
              return (
                <div 
                  key={item.day}
                  className={`relative aspect-[4/5] rounded-xl flex flex-col p-2.5 border transition-all ${
                    isChecked 
                      ? 'bg-blue-600/10 border-blue-500/30' 
                      : isToday
                        ? 'bg-slate-800 border-blue-500 ring-2 ring-blue-500/20'
                        : 'bg-[#1e1e22] border-white/5'
                  }`}
                >
                  <span className={`text-[9px] font-bold mb-auto ${isChecked ? 'text-blue-400' : 'text-slate-500'}`}>{item.day}일차</span>
                  
                  <div className="flex items-center justify-end gap-1">
                     <Coins size={10} className={isChecked ? 'text-blue-400' : 'text-slate-600'} />
                     <span className={`text-[11px] font-black ${isChecked ? 'text-white' : 'text-slate-300'}`}>
                       {item.tokens}dt
                     </span>
                  </div>

                  {isMilestone && (
                    <div className={`absolute top-2 right-2 text-[8px] font-black px-1.5 py-0.5 rounded-md shadow-lg ${isChecked ? 'bg-blue-600' : 'bg-[#2a2a30] text-purple-400 border border-purple-500/30'}`}>
                      x{item.multiplier}
                    </div>
                  )}

                  {isChecked && (
                    <div className="absolute inset-0 bg-slate-950/20 rounded-xl flex items-center justify-center">
                      <Check size={16} className="text-blue-400 opacity-60" strokeWidth={5} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 4. 유의사항 (스크린샷 참고) */}
          <div className="pt-4 border-t border-white/5 opacity-40">
            <p className="text-[10px] font-bold mb-1 text-slate-300">[유의사항]</p>
            <ul className="text-[9px] text-slate-400 space-y-1 font-medium leading-relaxed">
              <li>• 본 이벤트는 연속 출석 시에만 최대 보상이 유지됩니다.</li>
              <li>• 출석일은 매일 00:00 (KST) 기준으로 갱신됩니다.</li>
              <li>• 비정상적인 방법으로 참여 시 혜택이 제한될 수 있습니다.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
