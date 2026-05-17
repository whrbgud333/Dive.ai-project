# Dive.ai

AI 기반 인터랙티브 스토리텔링 플랫폼

사용자가 장르·소재·캐릭터를 입력하면 AI가 시나리오와 캐릭터를 자동 설계하고, 그 위에서 인터랙티브 채팅 롤플레이를 진행합니다.

---

## 주요 기능

- **빌더 파이프라인** — 장르·소재·캐릭터 입력 → 시나리오·나침반·로어북 자동 생성 (RAG + LLM)
- **인터랙티브 채팅** — 기승전결 서사 구조를 유지하며 AI 캐릭터와 대화
- **서사 일관성 유지** — 단계 전환·이탈 감지·엔딩 자동 생성
- **이미지 생성** — 캐릭터·표지·엔딩 이미지 자동 생성

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 백엔드 | Python 3.11, FastAPI, SQLAlchemy, SQLite |
| AI | Google Gemini (Vertex AI), OpenAI GPT |
| RAG | ChromaDB, OpenAI text-embedding-3-small |
| 프론트엔드 | React 18, TypeScript, Vite, Tailwind CSS |
| 인증 | Firebase Auth (Google 소셜 로그인) |

---

## 프로젝트 구성

```
Dive.ai_prototype/       ← 프로토타입 소스 코드 (FastAPI + React)
Dive.ai_발표.html        ← 발표 자료
Dive.ai_정리본.ipynb     ← 프로젝트 전체 정리 노트북
문화콘텐츠.ipynb         ← 문화콘텐츠 분야 적용 실험
동아시아 고전.ipynb      ← 동아시아 고전 데이터 실험
```

### 백엔드 구조 (`Dive.ai_prototype/`)

```
main.py               ← FastAPI 진입점, API 라우팅
ai_engine.py          ← LLM 팩토리 + Vertex AI 호출
scenario_builder.py   ← 빌더 파이프라인 + ChromaDB RAG
chat_engine_v2.py     ← 나침반·GameStateV2 기반 채팅 엔진
models.py             ← SQLAlchemy ORM 테이블 정의
auth.py               ← Firebase 인증 + JWT
frontend/             ← React + TypeScript 프론트엔드
```

---

## 실행 방법

### 사전 준비

1. Python 3.11 이상, Node.js 설치
2. 아래 API 키 및 서비스 계정 준비
   - OpenAI API 키
   - Google Cloud Vertex AI 서비스 계정 JSON
   - Firebase 서비스 계정 JSON + 웹앱 config
3. `vectordb/` 폴더를 `Dive.ai_prototype/` 상위 디렉토리에 배치

```
Dive.ai/
├── vectordb/
└── Dive.ai_prototype/
        └── .env
```

4. `Dive.ai_prototype/.env` 파일 작성

```env
OPENAI_API_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=...경로/서비스계정.json
VERTEX_PROJECT=...
VERTEX_LOCATION=us-central1
FIREBASE_SERVICE_ACCOUNT_PATH=...경로/firebase-adminsdk.json
```

### 백엔드 실행

```bash
cd Dive.ai_prototype
pip install -r requirements.txt
python main.py
# → http://localhost:8000
```

### 프론트엔드 실행

```bash
cd Dive.ai_prototype/frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## 팀원

| GitHub | 역할 |
|---|---|
| [@whrbgud333](https://github.com/whrbgud333) | |
| [@Aerhenav](https://github.com/Aerhenav) | |
| [@BalamBBang](https://github.com/BalamBBang) | |
| [@gjaewon071](https://github.com/gjaewon071) | |
| [@jklul941223-coder](https://github.com/jklul941223-coder) | |
