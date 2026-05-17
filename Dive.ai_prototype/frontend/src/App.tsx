import React, { useState, useEffect } from 'react';
import { Home, MessageCircle, Plus, User, Sparkles, X, BookOpen } from 'lucide-react';
import { FlowData, defaultFlowData } from './types';
import Screen0 from './components/Screen0';
import Screen1 from './components/Screen1';
import Screen2 from './components/Screen2';
import Screen3 from './components/Screen3';
import Screen4 from './components/Screen4';

import ChatInterface from './components/ChatInterface';
import ChatList from './components/ChatList';
import Settings from './components/Settings';
import AttendanceScreen from './components/AttendanceScreen';
import ScenarioGallery from './components/ScenarioGallery';
import AuthorProfile from './components/AuthorProfile';
import { AuthProvider, useAuth } from './context/AuthContext';
import { apiFetch } from './lib/api';

type Tab = 'home' | 'chat' | 'create' | 'gallery' | 'settings';
type CreateStep = 'screen1' | 'screen2' | 'screen3' | 'screen4';

const TABS = [
  { id: 'home' as Tab, icon: Home, label: '홈' },
  { id: 'chat' as Tab, icon: MessageCircle, label: '채팅' },
  { id: 'create' as Tab, icon: Plus, label: '생성' },
  { id: 'gallery' as Tab, icon: BookOpen, label: '갤러리' },
  { id: 'settings' as Tab, icon: User, label: '마이' },
];

function AppInner() {
  const { user, loading, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [createStep, setCreateStep] = useState<CreateStep>('screen1');
  const [selectedTopic, setSelectedTopic] = useState<any>(null);
  const [showAttendance, setShowAttendance] = useState(false);
  const [flowData, setFlowData] = useState<FlowData>(defaultFlowData());
  const [errorMsg, setErrorMsg] = useState('');
  const [chatRefreshKey, setChatRefreshKey] = useState(0);
  const [toast, setToast] = useState('');
  const [selectedAuthorId, setSelectedAuthorId] = useState<number | null>(null);
  const [galleryInitScenarioId, setGalleryInitScenarioId] = useState<number | null>(null);
  
  // 지속성 알림 (시나리오 생성 완료 알림용)
  const [persistentNotif, setPersistentNotif] = useState<{ show: boolean; message: string } | null>(null);

  // 백그라운드 생성 완료 데이터 (flowData 충돌 방지를 위해 별도 보관)
  const [pendingBuilderResult, setPendingBuilderResult] = useState<any>(null);

  // 실시간 탭 추적을 위한 Ref (startBuilder 내 stale closure 해결용)
  const activeTabRef = React.useRef<Tab>(activeTab);
  React.useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // 마지막 채팅방 저장
  React.useEffect(() => {
    if (selectedTopic?.id) {
      localStorage.setItem('dive_last_topic_id', String(selectedTopic.id));
    }
  }, [selectedTopic?.id]);

  const handleContinue = () => {
    if (!user) { setActiveTab('settings'); return; }
    const lastId = localStorage.getItem('dive_last_topic_id');
    if (lastId) {
      setSelectedTopic({ id: Number(lastId), _aiImage: null, _userImage: null });
      setChatRefreshKey(k => k + 1);
      setActiveTab('chat');
    } else {
      handleTabClick('chat');
    }
  };

  // 시나리오 생성 상태 관리
  const [builderStep, setBuilderStep] = useState(0);
  const [isBuilding, setIsBuilding] = useState(false);
  const builderPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const builderJobIdRef = React.useRef<string | null>(null);
  const isStartingBuildRef = React.useRef(false);

  const updateFlow = (data: Partial<FlowData>) =>
    setFlowData(prev => ({ ...prev, ...data }));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const _jobStorageKey = (email: string) => `dive_builder_job_${email}`;

  const _onBuilderDone = (result: any) => {
    if (builderPollRef.current) { clearInterval(builderPollRef.current); builderPollRef.current = null; }
    builderJobIdRef.current = null;
    if (user?.email) localStorage.removeItem(_jobStorageKey(user.email));
    setPendingBuilderResult(result);
    if (activeTabRef.current !== 'create') {
      setPersistentNotif({ show: true, message: '✨ 시나리오 생성이 완료되었습니다!' });
    }
    setTimeout(() => {
      setIsBuilding(false);
      if (activeTabRef.current === 'create') applyPendingResult(result);
    }, 100);
  };

  const _startBuilderPolling = (jobId: string) => {
    if (builderPollRef.current) clearInterval(builderPollRef.current);
    builderPollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/builder/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.current_step !== undefined) setBuilderStep(data.current_step);
        if (data.status === 'done' && data.result) {
          _onBuilderDone(data.result);
        } else if (data.status === 'error') {
          if (builderPollRef.current) { clearInterval(builderPollRef.current); builderPollRef.current = null; }
          builderJobIdRef.current = null;
          if (user?.email) localStorage.removeItem(_jobStorageKey(user.email));
          setErrorMsg(data.error_message || '시나리오 생성 중 오류가 발생했습니다.');
          setIsBuilding(false);
        } else if (data.status === 'cancelled') {
          if (builderPollRef.current) { clearInterval(builderPollRef.current); builderPollRef.current = null; }
          builderJobIdRef.current = null;
          if (user?.email) localStorage.removeItem(_jobStorageKey(user.email));
          setIsBuilding(false);
        }
      } catch (e) {
        console.error('Builder poll error:', e);
      }
    }, 3000);
  };

  // 앱 로드 시 localStorage에 저장된 진행 중인 잡 복원
  React.useEffect(() => {
    if (!user?.email) return;
    const savedJobId = localStorage.getItem(_jobStorageKey(user.email));
    if (savedJobId) {
      builderJobIdRef.current = savedJobId;
      setIsBuilding(true);
      _startBuilderPolling(savedJobId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const startBuilder = async () => {
    if (isBuilding || isStartingBuildRef.current) return;
    isStartingBuildRef.current = true;

    setErrorMsg('');
    setBuilderStep(0);
    setIsBuilding(true);

    try {
      const body = {
        content_type: flowData.contentType,
        genre: flowData.genre,
        classic_country: flowData.classicCountry || null,
        material: flowData.material || `${flowData.contentType} ${flowData.genre} 장르의 감성적인 이야기`,
        material_by_ai: flowData.materialByAI,
        ai_character: {
          name: flowData.aiCharacterInput.name,
          gender: flowData.aiCharacterInput.gender,
          age: flowData.aiCharacterInput.age,
          personality: flowData.aiCharacterInput.personality,
          appearance: flowData.aiCharacterInput.appearance,
          background: flowData.aiCharacterInput.background,
          ai_flags: flowData.aiCharacterInput.aiFlags,
        },
        user_character: {
          name: flowData.userCharacterInput.name,
          gender: flowData.userCharacterInput.gender,
          age: flowData.userCharacterInput.age,
          personality: flowData.userCharacterInput.personality,
          appearance: flowData.userCharacterInput.appearance,
          background: flowData.userCharacterInput.background,
          ai_flags: flowData.userCharacterInput.aiFlags,
        },
        model_selection: flowData.sessionOptions.model,
      };

      const response = await apiFetch('/builder/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error('시나리오 생성을 시작할 수 없습니다.');
      const { job_id } = await response.json();

      builderJobIdRef.current = job_id;
      if (user?.email) localStorage.setItem(_jobStorageKey(user.email), job_id);

      _startBuilderPolling(job_id);
    } catch (e: any) {
      setErrorMsg(e.message || '시나리오 생성 중 오류가 발생했습니다.');
      setIsBuilding(false);
    } finally {
      isStartingBuildRef.current = false;
    }
  };

  const applyPendingResult = (result: any) => {
    if (!result) return;
    updateFlow({
      topicId: result.topic_id,
      topicTitle: result.title ?? '',
      scenario: result.scenario,
      introDisplay: result.intro_display ?? '',
      aiCharacterResult: result.ai_character,
      userCharacterResult: result.user_character,
      supportingCast: result.supporting_cast ?? [],
      coverImage: result.cover_image ?? '',
      coverImages: result.cover_images ? result.cover_images : (result.cover_image ? [result.cover_image] : []),
      userPersona: {
        name: result.user_character?.name ?? '',
        personality: result.user_character?.personality ?? '',
        background: result.user_character?.background ?? '',
        appearance: result.user_character?.appearance ?? '',
        gender: result.user_character?.gender ?? '',
        age: result.user_character?.age ?? '',
      },
    });
    setCreateStep('screen4'); // 결과 화면으로 즉시 이동할 수 있도록 단계 설정
    setPendingBuilderResult(null);
  };

  const cancelBuilder = () => {
    if (builderJobIdRef.current) {
      apiFetch(`/builder/jobs/${builderJobIdRef.current}`, { method: 'DELETE' }).catch(() => {});
      builderJobIdRef.current = null;
    }
    if (builderPollRef.current) { clearInterval(builderPollRef.current); builderPollRef.current = null; }
    if (user?.email) localStorage.removeItem(_jobStorageKey(user.email));
    setIsBuilding(false);
    setBuilderStep(0);
    setCreateStep('screen2');
  };

  const goToCreate = () => {
    if (!user) { setActiveTab('settings'); return; }
    
    // 이미 생성 중이거나 진행 중인 단계가 있다면 리셋하지 않고 이동
    if (isBuilding || createStep !== 'screen1' || flowData.contentType !== '') {
      if (createStep === 'screen3' && !flowData.topicId) {
        showToast('시나리오 생성 중입니다. 완료 후 이용해주세요.');
      }
      setActiveTab('create');
      return;
    }

    setFlowData(defaultFlowData());
    setCreateStep('screen1');
    setBuilderStep(0);
    setIsBuilding(false);
    setActiveTab('create');
  };

  const handleCreateDone = () => {
    // flowData 리셋 전에 이미지 데이터를 캡처
    const capturedTopic = {
      id: flowData.topicId,
      _aiImage: flowData.aiCharacterResult?.image ?? null,
      _userImage: flowData.userCharacterResult?.image ?? null,
    };
    setChatRefreshKey(k => k + 1);
    setSelectedTopic(capturedTopic);
    setCreateStep('screen1');
    setFlowData(defaultFlowData());
    setActiveTab('chat');
  };

  const handleTabClick = (id: Tab) => {
    if (id === 'create') {
      if (!user) { setActiveTab('settings'); return; }
      // 생성 탭으로 갈 때 보관된 데이터가 있다면 그때 반영 (충돌 방지)
      if (pendingBuilderResult) applyPendingResult(pendingBuilderResult);
      setActiveTab('create');
      return;
    }
    if (id === 'chat' && !user) { setActiveTab('settings'); return; }
    if (id !== 'chat') setSelectedTopic(null);
    if (id !== 'gallery') setSelectedAuthorId(null);
    setActiveTab(id);
  };

  // 출석체크 화면
  if (showAttendance) {
    return (
      <AttendanceScreen 
        onBack={() => setShowAttendance(false)} 
        onRefreshUser={refreshUser}
      />
    );
  }

  const renderContent = () => {
    if (errorMsg) {
      return (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="bg-white rounded-[2rem] p-10 max-w-sm w-full shadow-xl space-y-6 text-center">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-xl font-black text-slate-800">오류가 발생했습니다</h2>
            <p className="text-sm text-slate-500 font-medium leading-relaxed">{errorMsg}</p>
            <button
              onClick={() => { setErrorMsg(''); setActiveTab('home'); }}
              className="w-full bg-blue-600 text-white py-3 rounded-2xl font-black text-sm hover:bg-blue-700 transition-all"
            >
              처음으로 돌아가기
            </button>
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case 'home':
        return <Screen0 onStart={goToCreate} onContinue={handleContinue} onGallery={(scenarioId) => {
          if (scenarioId) setGalleryInitScenarioId(scenarioId);
          handleTabClick('gallery');
        }} />;

      case 'chat':
        if (selectedTopic) {
          return (
            <ChatInterface
              user={{ name: user?.name ?? '', email: user?.email ?? '' }}
              initialTopicId={selectedTopic.id}
              initialCharacterImages={{
                ai_image: selectedTopic._aiImage ?? null,
                user_image: selectedTopic._userImage ?? null,
              }}
              initialPersona={flowData.userPersona}
              sessionOptions={flowData.sessionOptions}
              onBack={() => {
                setSelectedTopic(null);
                setChatRefreshKey(k => k + 1);
              }}
              onSelectTopic={(topicId) => {
                setSelectedTopic({ id: topicId, _aiImage: null, _userImage: null });
                setChatRefreshKey(k => k + 1);
              }}
            />
          );
        }
        return (
          <ChatList
            onSelectTopic={t => setSelectedTopic(t)}
            onCreateNew={goToCreate}
            refreshKey={chatRefreshKey}
          />
        );

      case 'create':
        if (createStep === 'screen1')
          return <Screen1 flowData={flowData} onUpdate={updateFlow} onNext={() => setCreateStep('screen2')} onHome={() => setActiveTab('home')} />;
        if (createStep === 'screen2')
          return <Screen2 flowData={flowData} onUpdate={updateFlow} onNext={() => setCreateStep('screen3')} onBack={() => setCreateStep('screen1')} onHome={() => setActiveTab('home')} />;
        if (createStep === 'screen3')
          return (
            <Screen3 
              flowData={flowData} 
              onUpdate={updateFlow} 
              onNext={() => setCreateStep('screen4')} 
              onBack={cancelBuilder} 
              onError={msg => setErrorMsg(msg)} 
              onHome={() => setActiveTab('home')}
              builderStep={builderStep}
              isBuilding={isBuilding}
              onStartBuild={startBuilder}
            />
          );
        if (createStep === 'screen4')
          return <Screen4 flowData={flowData} onUpdate={updateFlow} onNext={handleCreateDone} onBack={() => setCreateStep('screen2')} onHome={() => setActiveTab('home')} />;
        return null;

      case 'gallery':
        if (selectedAuthorId !== null) {
          return (
            <AuthorProfile
              authorId={selectedAuthorId}
              onBack={() => setSelectedAuthorId(null)}
              onStartChat={(topicId) => {
                setSelectedAuthorId(null);
                setSelectedTopic({ id: topicId, _aiImage: null, _userImage: null });
                setChatRefreshKey(k => k + 1);
                setActiveTab('chat');
              }}
            />
          );
        }
        return (
          <ScenarioGallery
            initialScenarioId={galleryInitScenarioId ?? undefined}
            onModalOpened={() => setGalleryInitScenarioId(null)}
            onStartChat={(topicId) => {
              setSelectedTopic({ id: topicId, _aiImage: null, _userImage: null });
              setChatRefreshKey(k => k + 1);
              setActiveTab('chat');
            }}
            onViewAuthor={(authorId) => setSelectedAuthorId(authorId)}
          />
        );

      case 'settings':
        return (
          <Settings
            user={user ? { name: user.name, email: user.email, tokenBalance: user.tokenBalance } : undefined}
            onGoToAttendance={() => setShowAttendance(true)}
            onViewAuthor={(authorId) => {
              setSelectedAuthorId(authorId);
              setActiveTab('gallery');
            }}
          />
        );
    }
  };

  return (
    <div className="flex flex-col bg-[#fcfcfd]" style={{ height: '100dvh' }}>
      {/* 토스트 (자동 소멸형) */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-xs font-bold px-5 py-3 rounded-2xl shadow-xl animate-fade-in">
          {toast}
        </div>
      )}

      {/* 지속성 알림 (X 버튼 눌러야 소멸) */}
      {persistentNotif?.show && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm bg-white border border-blue-100 shadow-[0_20px_40px_rgba(0,0,0,0.1)] rounded-[1.5rem] p-4 flex items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
              <Sparkles size={18} className="text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-black text-slate-800 truncate">{persistentNotif.message}</p>
              <button 
                onClick={() => {
                  setPersistentNotif(null);
                  if (pendingBuilderResult) applyPendingResult(pendingBuilderResult);
                  setActiveTab('create');
                }}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-700 underline underline-offset-4"
              >
                확인하러 가기
              </button>
            </div>
          </div>
          <button 
            onClick={() => setPersistentNotif(null)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* 콘텐츠 영역 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {renderContent()}
      </div>

      {/* 하단 탭바 */}
      {!selectedTopic && (
        <nav className="shrink-0 bg-white border-t border-slate-100 flex items-stretch">
          {TABS.map(({ id, icon: Icon, label }) => {
            const isActive = activeTab === id;
            const isCreate = id === 'create';
            return (
              <button
                key={id}
                onClick={() => handleTabClick(id)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-all ${
                  isActive && !isCreate ? 'text-blue-600' : 'text-slate-400'
                }`}
              >
                {isCreate ? (
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm transition-all ${
                    isActive ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Icon size={22} />
                  </div>
                ) : (
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                )}
                <span className={`text-[10px] font-black tracking-wide ${
                  isActive && !isCreate ? 'text-blue-600' : 'text-slate-400'
                }`}>
                  {label}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
