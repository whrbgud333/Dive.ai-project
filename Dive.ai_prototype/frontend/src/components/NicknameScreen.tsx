import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function NicknameScreen() {
  const { setNickname } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('닉네임을 입력해주세요.'); return; }
    if (name.trim().length > 20) { setError('닉네임은 20자 이하로 입력해주세요.'); return; }
    setLoading(true);
    setError('');
    try {
      await setNickname(name.trim());
    } catch {
      setError('저장에 실패했습니다. 다시 시도해주세요.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#fcfcfd] px-8">
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white font-black text-2xl">D</span>
          </div>
          <h2 className="text-xl font-black text-slate-800">닉네임 설정</h2>
          <p className="text-sm text-slate-400 font-medium mt-1">Dive.ai에서 사용할 이름을 정해주세요</p>
        </div>

        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="닉네임 입력"
          maxLength={20}
          className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all mb-3"
          autoFocus
        />

        {error && (
          <p className="text-xs text-red-500 font-medium mb-3 text-center">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !name.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-black text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '저장 중...' : '시작하기'}
        </button>

        <p className="text-xs text-slate-400 font-medium text-center mt-4">
          나중에 마이 페이지에서 변경할 수 있어요
        </p>
      </div>
    </div>
  );
}
