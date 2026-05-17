from sqlalchemy import Column, Integer, String, Text, DateTime, Date, ForeignKey, JSON, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    google_id = Column(String, unique=True, index=True)
    token_balance = Column(Integer, default=10)
    last_checkin_date = Column(Date, nullable=True)
    consecutive_days = Column(Integer, default=0)

class Persona(Base):
    __tablename__ = "personas"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String)
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Topic(Base):
    __tablename__ = "topics"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    active_persona_id = Column(Integer, ForeignKey("personas.id"), nullable=True)
    character_name = Column(String)
    title = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    affection = Column(Integer, default=0)
    intimacy = Column(Integer, default=0)
    setting = Column(Text, nullable=True)
    user_notes = Column(Text, nullable=True)
    user_note_presets = Column(JSON, nullable=True)
    tone_preference = Column(String, nullable=True, default=None)
    worldview = Column(Text, nullable=True)
    genre = Column(String, nullable=True)
    original_title = Column(String, nullable=True)
    custom_name = Column(String, nullable=True)
    reasoning_level = Column(Integer, default=1)
    impersonation_enabled = Column(Boolean, default=False)
    output_length = Column(Integer, default=1500)
    character_info = Column(JSON, nullable=True)
    last_summary_turn = Column(Integer, default=0)
    inner_thought = Column(Text, nullable=True)
    last_inner_thought_turn = Column(Integer, default=0)
    inner_thoughts = Column(JSON, nullable=True)         # { char_name: thought_text }

    # 빌더 파이프라인 결과
    content_type = Column(String, nullable=True)        # 만화/시리즈/영화/소설/고전
    classic_country = Column(String, nullable=True)     # 고전 국가 (한/중/일)
    scenario = Column(JSON, nullable=True)              # {기, 승, 전, 결}
    intro_display = Column(Text, nullable=True)         # 시작 배경 요약 텍스트
    ai_character = Column(JSON, nullable=True)          # AI 캐릭터 정보
    user_character = Column(JSON, nullable=True)        # 유저 캐릭터 정보
    supporting_cast = Column(JSON, nullable=True)       # 조연 목록

    # v2 채팅 엔진
    compass = Column(JSON, nullable=True)               # 나침반 (서사 지침서)
    game_state = Column(JSON, nullable=True)            # GameStateV2 직렬화
    lorebook_entries = Column(JSON, nullable=True)      # 로어북 항목 목록
    relationship_graph = Column(JSON, nullable=True)    # 인물 관계도
    cover_image = Column(Text, nullable=True)           # 시나리오 표지 배경 이미지 (현재)
    cover_images = Column(JSON, nullable=True)          # 표지 이미지 히스토리 [url, ...]
    bgm_url = Column(String, nullable=True)             # 배경음악 URL (Firebase)
    bgm_urls = Column(JSON, nullable=True)              # 단계별 배경음악 URL { stage: url }
    background_images = Column(JSON, nullable=True)     # 단계별 배경 이미지 URL { '기': url, '승': url, ... }
    ending_image = Column(Text, nullable=True)           # 엔딩 일러스트 최신 URL (Firebase)
    ending_images = Column(JSON, nullable=True)          # 엔딩 일러스트 전체 히스토리 [url, ...]
    stage_character_images = Column(JSON, nullable=True) # 단계 전환 캐릭터 이미지 { '승': url, '전': url, '결': url }
    cinematic_url = Column(Text, nullable=True)          # 시네마틱 영상 URL (Firebase) - 현재 활성
    cinematic_urls = Column(JSON, nullable=True)         # 시네마틱 영상 보관함 [url, ...]
    affinity_image = Column(Text, nullable=True)         # 호감도 100 특전 이미지 최신 URL
    affinity_images = Column(JSON, nullable=True)        # 호감도 특전 이미지 히스토리 [url, ...]
    affinity_max_scene = Column(Text, nullable=True)     # 호감도 100 달성 시 AI 생성 특전 대사
    perceived_relationships = Column(JSON, nullable=True) # AI 캐릭터가 인지하는 관계 { supporting: {}, user_character: {} }

    # 시나리오 배포
    is_published = Column(Boolean, default=False, nullable=False)
    author_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    imported_from_id = Column(Integer, nullable=True)  # 갤러리에서 임포트된 경우 원본 topic_id

    messages = relationship("Message", back_populates="topic")
    summaries = relationship("Summary", back_populates="topic")
    persona = relationship("Persona")

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(Integer, ForeignKey("topics.id"))
    role = Column(String)
    content = Column(Text)
    turn_number = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # 버전 관리용 필드 추가
    parent_id = Column(Integer, ForeignKey("messages.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    version = Column(Integer, default=1)
    
    # DT 소모 추적용 필드
    model_name = Column(String, nullable=True)
    spent_dt = Column(Integer, default=0)
    speaker_name = Column(String, nullable=True)

    topic = relationship("Topic", back_populates="messages")

class Summary(Base):
    __tablename__ = "summaries"
    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(Integer, ForeignKey("topics.id"))
    content = Column(Text)
    stage = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    topic = relationship("Topic", back_populates="summaries")

class BuilderJob(Base):
    __tablename__ = "builder_jobs"
    id = Column(String, primary_key=True)          # UUID
    user_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String, default="running")      # running / done / error / cancelled
    current_step = Column(Integer, default=0)
    step_message = Column(String, nullable=True)
    result = Column(JSON, nullable=True)
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow)

class Following(Base):
    __tablename__ = "followings"
    id = Column(Integer, primary_key=True, index=True)
    follower_id = Column(Integer, ForeignKey("users.id"))
    author_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
