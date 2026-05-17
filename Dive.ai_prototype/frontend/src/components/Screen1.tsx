import React, { useState } from 'react';
import { Sparkles, Shuffle } from 'lucide-react';
import { FlowData } from '../types';

const CONTENT_TYPES = ['만화', '시리즈', '영화', '소설', '고전'] as const;

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

interface Props {
  flowData: FlowData;
  onUpdate: (data: Partial<FlowData>) => void;
  onNext: () => void;
  onHome: () => void;
}

export default function Screen1({ flowData, onUpdate, onNext, onHome }: Props) {
  const [contentType, setContentType] = useState(flowData.contentType);
  const [genre, setGenre] = useState(flowData.genre);
  const [classicCountry, setClassicCountry] = useState(flowData.classicCountry);

  const genres = contentType === '고전'
    ? (classicCountry ? CLASSIC_GENRES[classicCountry] ?? [] : [])
    : (GENRES[contentType] ?? []);

  const canProceed = contentType && genre && (contentType !== '고전' || classicCountry);

  const handleRandom = () => {
    const types = CONTENT_TYPES.filter(t => t !== '고전');
    const randomType = types[Math.floor(Math.random() * types.length)];
    const randomGenreList = GENRES[randomType];
    const randomGenre = randomGenreList[Math.floor(Math.random() * randomGenreList.length)];
    setContentType(randomType);
    setGenre(randomGenre);
    setClassicCountry('');
    onUpdate({ contentType: randomType, genre: randomGenre, classicCountry: '' });
  };

  const handleSelectType = (type: string) => {
    setContentType(type);
    setGenre('');
    setClassicCountry('');
    onUpdate({ contentType: type, genre: '', classicCountry: '' });
  };

  const handleSelectCountry = (country: string) => {
    setClassicCountry(country);
    setGenre('');
    onUpdate({ classicCountry: country, genre: '' });
  };

  const handleSelectGenre = (g: string) => {
    setGenre(g);
    onUpdate({ genre: g });
  };

  const handleNext = () => {
    onUpdate({ contentType, genre, classicCountry });
    onNext();
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col overflow-hidden relative">

      {/* 배경 글로우 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-violet-600/6 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-purple-700/5 rounded-full blur-3xl" />
      </div>

      {/* 헤더 */}
      <header className="relative z-10 px-5 pt-6 pb-4 flex items-center">
        <button
          onClick={onHome}
          className="flex items-center gap-2.5 font-black text-xl text-white tracking-tighter hover:opacity-70 transition-opacity"
        >
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-700 rounded-xl flex items-center justify-center shadow-lg shadow-violet-900/40">
            <Sparkles size={17} className="text-white" />
          </div>
          Dive.ai
        </button>
      </header>

      {/* 본문 */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-28 gap-10">
        <div className="text-center space-y-2.5">
          <h1 className="text-3xl font-black text-white tracking-tight">콘텐츠 유형을 선택하세요</h1>
          <p className="text-sm text-white/35 font-medium">시나리오가 어떤 작품 형식으로 펼쳐질지 결정합니다</p>
        </div>

        {/* 콘텐츠 유형 */}
        <div className="flex flex-wrap justify-center gap-2.5">
          {CONTENT_TYPES.map(type => (
            <button
              key={type}
              onClick={() => handleSelectType(type)}
              className={`px-6 py-2.5 rounded-2xl font-black text-sm border transition-all active:scale-[0.97] ${
                contentType === type
                  ? 'bg-violet-600 border-violet-600 text-white shadow-lg shadow-violet-900/40'
                  : 'bg-white/4 border-white/10 text-white/50 hover:border-violet-500/30 hover:text-white/80 hover:bg-white/6'
              }`}
            >
              {type}
            </button>
          ))}
          <button
            onClick={handleRandom}
            className="px-6 py-2.5 rounded-2xl font-black text-sm border border-dashed border-violet-400/25 text-violet-400/60 hover:border-violet-400/50 hover:text-violet-400 hover:bg-violet-500/6 transition-all flex items-center gap-2 active:scale-[0.97]"
          >
            <Shuffle size={13} /> 무작위
          </button>
        </div>

        {/* 고전 국가 선택 */}
        {contentType === '고전' && (
          <div className="w-full max-w-xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <p className="text-center text-[11px] font-black text-white/25 uppercase tracking-widest">국가 선택</p>
            <div className="flex justify-center gap-2.5">
              {CLASSIC_COUNTRIES.map(country => (
                <button
                  key={country}
                  onClick={() => handleSelectCountry(country)}
                  className={`px-6 py-2.5 rounded-2xl font-black text-sm border transition-all active:scale-[0.97] ${
                    classicCountry === country
                      ? 'bg-purple-600 border-purple-600 text-white shadow-lg shadow-purple-900/40'
                      : 'bg-white/4 border-white/10 text-white/50 hover:border-purple-500/30 hover:text-white/80 hover:bg-white/6'
                  }`}
                >
                  {country}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 장르 선택 */}
        {genres.length > 0 && (
          <div className="w-full max-w-2xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <p className="text-center text-[11px] font-black text-white/25 uppercase tracking-widest">장르 선택</p>
            <div className="flex flex-wrap justify-center gap-2">
              {genres.map(g => (
                <button
                  key={g}
                  onClick={() => handleSelectGenre(g)}
                  className={`px-5 py-2 rounded-xl font-bold text-sm border transition-all active:scale-[0.97] ${
                    genre === g
                      ? 'bg-violet-600 border-violet-600 text-white shadow-md shadow-violet-900/30'
                      : 'bg-white/4 border-white/8 text-white/45 hover:border-violet-500/30 hover:text-white/75 hover:bg-white/6'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 p-5 bg-slate-950/90 backdrop-blur-xl border-t border-white/6 z-20">
        <div className="max-w-sm mx-auto">
          <button
            onClick={handleNext}
            disabled={!canProceed}
            className="w-full bg-gradient-to-r from-violet-600 to-purple-600 text-white py-4 rounded-2xl font-black text-base shadow-lg shadow-violet-900/40 hover:opacity-90 transition-all disabled:opacity-20 disabled:cursor-not-allowed active:scale-[0.99]"
          >
            다음 단계로
          </button>
        </div>
      </div>
    </div>
  );
}
