import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setError('로그인에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#fcfcfd] px-8">
      {/* 로고 */}
      <div className="mb-10 text-center">
        <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-white font-black text-3xl">D</span>
        </div>
        <h1 className="text-2xl font-black text-slate-800">Dive.ai</h1>
        <p className="text-sm text-slate-400 font-medium mt-1">AI와 함께하는 인터랙티브 스토리</p>
      </div>

      {/* 구글 로그인 버튼 */}
      <button
        onClick={handleLogin}
        disabled={loading}
        className="w-full max-w-xs flex items-center justify-center gap-3 bg-white border border-slate-200 rounded-2xl px-6 py-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M47.5 24.6c0-1.6-.1-3.1-.4-4.6H24v8.7h13.2c-.6 3-2.3 5.6-4.9 7.3v6h7.9c4.6-4.3 7.3-10.6 7.3-17.4z"/>
            <path fill="#34A853" d="M24 48c6.5 0 12-2.1 16-5.8l-7.9-6c-2.2 1.5-5 2.3-8.1 2.3-6.2 0-11.5-4.2-13.4-9.9H2.5v6.2C6.5 42.7 14.7 48 24 48z"/>
            <path fill="#FBBC05" d="M10.6 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6v-6.2H2.5C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.8l8.1-6.2z"/>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.9 2.4 30.4 0 24 0 14.7 0 6.5 5.3 2.5 13.2l8.1 6.2C12.5 13.7 17.8 9.5 24 9.5z"/>
          </svg>
        )}
        <span className="text-sm font-black text-slate-700">
          {loading ? '로그인 중...' : 'Google로 계속하기'}
        </span>
      </button>

      {error && (
        <p className="mt-4 text-xs text-red-500 font-medium text-center">{error}</p>
      )}

      <p className="mt-8 text-xs text-slate-400 font-medium text-center leading-relaxed">
        로그인하면 매일 출석 체크로<br />무료 토큰 5개를 받을 수 있어요
      </p>
    </div>
  );
}
