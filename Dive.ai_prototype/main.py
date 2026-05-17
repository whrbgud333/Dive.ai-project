"""
main.py - FastAPI 애플리케이션 진입점
"""

import os
import re
import json
import asyncio
import traceback
from typing import Optional

from dotenv import load_dotenv
load_dotenv()  # 다른 모듈 import 전에 먼저 실행

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import case as sa_case, func as sa_func
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

import models
from database import engine, get_db, SessionLocal
from auth import verify_firebase_token, create_access_token, get_current_user_id, get_optional_user_id
from ai_engine import (
    get_llm, get_vertex_llm, extract_ai_text, vertex_complete,
    _get_anthropic_vertex_client, CLAUDE_SONNET_MODEL, VERTEX_MODEL_FLASH_LITE, MODEL_PRO,
    generate_bgm_lyria, _crop_to_portrait, generate_cinematic_video
)
from scenario_builder import (
    generate_scenario_full,
    generate_scenario_with_rag,
    generate_query_auto,
    generate_characters,
    generate_character_image,
    analyze_relationship_for_composition,
    generate_cover_image,
    generate_background_image,
    generate_ending_image,
    generate_stage_character_image,
    parse_scenario_to_dict,
    generate_scenario_title,
    generate_intro_display,
    get_chat_context,
    extract_character_names_from_scenario,
)
from prompt_builder import (
    build_system_prompt,
    build_streaming_prompt,
    build_scenario_prompt,
    build_character_prompt,
)
from memory import summarize_chat, get_summary_context, check_and_auto_summarize, generate_inner_thought, check_and_auto_inner_thought
import chat_engine_v2 as _v2
from chat_engine_v2 import (
    GameStateV2,
    generate_compass,
    build_chat_system_prompt,
    parse_chat_response,
    generate_next_stage,
    update_summary_if_needed,
    generate_ending_scene,
    generate_hint_card,
    generate_affinity_max_scene,
    generate_initial_perceived_relationships,
    extract_lorebook_entries,
    get_lorebook_context,
    regenerate_compass,
    OFF_TRACK_THRESHOLD,
    generate_relationship_graph,
)

# ---------------------------------------------------------------------------
# DB 초기화
# ---------------------------------------------------------------------------

models.Base.metadata.create_all(bind=engine)




def migrate_db():
    """기존 DB에 컬럼 추가 (없는 경우에만)."""
    from sqlalchemy import text
    topic_cols = [
        ("compass", "JSON"),
        ("game_state", "JSON"),
        ("lorebook_entries", "JSON"),
        ("relationship_graph", "JSON"),
        ("intro_display", "TEXT"),
    ]
    with engine.connect() as conn:
        for col_name, col_type in topic_cols:
            try:
                conn.execute(text(f"ALTER TABLE topics ADD COLUMN {col_name} {col_type}"))
                conn.commit()
            except Exception:
                pass
        try:
            conn.execute(text("ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
        # 유저 테이블: 토큰 잔액 + 출석 날짜
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN token_balance INTEGER DEFAULT 10"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_checkin_date DATE"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN consecutive_days INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_checkin_at DATETIME"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE summaries ADD COLUMN stage VARCHAR"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN user_note_presets JSON"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN inner_thought TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN last_inner_thought_turn INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN inner_thoughts TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN custom_name VARCHAR"))
            conn.commit()
        except Exception:
            pass
        # 메시지 테이블 버전 관리 컬럼
        try:
            conn.execute(text("ALTER TABLE messages ADD COLUMN parent_id INTEGER"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE messages ADD COLUMN is_active BOOLEAN DEFAULT 1"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE messages ADD COLUMN version INTEGER DEFAULT 1"))
            conn.commit()
        except Exception:
            pass
        # DT 소모 추적 컬럼
        try:
            conn.execute(text("ALTER TABLE messages ADD COLUMN model_name VARCHAR"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE messages ADD COLUMN spent_dt INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE messages ADD COLUMN speaker_name VARCHAR"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN affinity_image TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN affinity_images JSON"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN affinity_max_scene TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN perceived_relationships JSON"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN cover_image TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN background_images JSON"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN ending_image TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN stage_character_images JSON"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN cinematic_urls JSON"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE topics ADD COLUMN ending_images JSON"))
            conn.commit()
        except Exception:
            pass


migrate_db()

# ---------------------------------------------------------------------------
# FastAPI 앱 설정
# ---------------------------------------------------------------------------

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic 스키마
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    user_message: str
    topic_id: int
    model_selection: str
    character_name: str
    dice_roll: Optional[int] = None
    auto_advance: bool = False
    guidance: Optional[str] = None
    is_regeneration: bool = False
    reply_type: Optional[str] = None  # 추천 답변 타입: 긍정/부정 시 고정 delta 적용

class PersonaCreate(BaseModel):
    name: str
    description: str

class PersonaUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class TopicCreate(BaseModel):
    character_name: str
    title: str
    worldview: Optional[str] = None
    genre: Optional[str] = None
    original_title: Optional[str] = None

class TopicUpdate(BaseModel):
    title: Optional[str] = None
    tone_preference: Optional[str] = None
    user_notes: Optional[str] = None
    user_note_presets: Optional[list] = None
    active_persona_id: Optional[int] = None
    reasoning_level: Optional[int] = None
    output_length: Optional[int] = None
    scenario: Optional[dict] = None
    ai_character: Optional[dict] = None
    user_character: Optional[dict] = None
    supporting_cast: Optional[list] = None
    custom_name: Optional[str] = None
    cover_image: Optional[str] = None
    story_length: Optional[str] = None  # 'short' | 'normal' | 'long'

class ScenarioRequest(BaseModel):
    worldview: str
    genre: Optional[str] = None
    original_title: Optional[str] = None

class SummaryUpdate(BaseModel):
    content: str

# 빌더 파이프라인 스키마
class AiFlags(BaseModel):
    name: bool = True
    personality: bool = True
    appearance: bool = True
    background: bool = True
    gender: bool = True
    age: bool = True

class CharacterInput(BaseModel):
    name: Optional[str] = ""
    personality: Optional[str] = ""
    appearance: Optional[str] = ""
    background: Optional[str] = ""
    gender: Optional[str] = ""
    age: Optional[str] = ""
    ai_flags: AiFlags = AiFlags()

class BuilderRequest(BaseModel):
    content_type: str
    genre: str
    classic_country: Optional[str] = None
    material: str
    material_by_ai: bool = False
    ai_character: CharacterInput = CharacterInput()
    user_character: CharacterInput = CharacterInput()
    model_selection: Optional[str] = "gemini-3-flash-preview"

class BGMRequest(BaseModel):
    topic_id: int
    target_stage: Optional[str] = None

# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def _get_llm_or_raise(model_name: str):
    try:
        # Vertex AI로 통합
        return get_vertex_llm(model_name)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _generate_image_with_retry(fn, *args, max_retries: int = 3, base_wait: int = 60, **kwargs):
    """이미지 생성 함수를 최대 max_retries회 재시도합니다.
    429 / RESOURCE_EXHAUSTED 오류 발생 시 base_wait초씩 대기 후 재시도.
    그 외 에러도 짧게 대기 후 재시도. 최종 실패해도 None을 반환해 파이프라인이 중단되지 않도록 합니다.
    """
    for attempt in range(max_retries):
        try:
            result = await asyncio.to_thread(fn, *args, **kwargs)
            return result
        except Exception as e:
            err_str = str(e)
            is_quota_err = '429' in err_str or 'RESOURCE_EXHAUSTED' in err_str
            if attempt < max_retries - 1:
                wait_sec = base_wait * (attempt + 1) if is_quota_err else 15 * (attempt + 1)
                reason = "429 쿼터" if is_quota_err else "일반 오류"
                print(f"[Image Retry] {reason} 감지, {wait_sec}초 대기 후 재시도 ({attempt + 1}/{max_retries - 1}): {e}")
                await asyncio.sleep(wait_sec)
            else:
                print(f"[Image Retry] 이미지 생성 최종 실패 (시도 {max_retries}회): {e}")
                return None
    return None


def _parse_json_safe(text: str, fallback: dict) -> dict:
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception:
        pass
    return fallback

# ---------------------------------------------------------------------------
# API — Auth
# ---------------------------------------------------------------------------

import datetime as _dt

class GoogleAuthRequest(BaseModel):
    id_token: str

@app.post("/auth/google")
def google_auth(body: GoogleAuthRequest, db: Session = Depends(get_db)):
    try:
        decoded = verify_firebase_token(body.id_token)
    except Exception as e:
        print(f"[Firebase 토큰 검증 실패] {type(e).__name__}: {e}")
        raise HTTPException(status_code=401, detail=f"Firebase 토큰 검증 실패: {type(e).__name__}: {e}")

    google_id = decoded["uid"]
    email = decoded.get("email", "")
    name = decoded.get("name", "") or email.split("@")[0]

    is_new = False

    # 1. google_id로 찾기
    user = db.query(models.User).filter(models.User.google_id == google_id).first()

    if not user:
        # 2. 이메일로 찾기
        user = db.query(models.User).filter(models.User.email == email).first()
        if user:
            user.google_id = google_id
            db.commit()
            is_new = True  # 이메일 연결은 첫 구글 연동

    if not user:
        # 3. 기존 user_id=1에 연결 (기존 데이터 보존)
        first_user = db.query(models.User).filter(models.User.id == 1).first()
        if first_user and not first_user.google_id:
            first_user.google_id = google_id
            first_user.email = email
            if not first_user.token_balance:
                first_user.token_balance = 10
            db.commit()
            db.refresh(first_user)
            user = first_user
            is_new = True  # 닉네임 설정 필요
        else:
            user = models.User(google_id=google_id, email=email, name=email.split("@")[0], token_balance=10)
            db.add(user)
            db.commit()
            db.refresh(user)
            is_new = True

    token = create_access_token(user.id)
    return {
        "access_token": token,
        "is_new": is_new,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "token_balance": user.token_balance or 10,
        },
    }


class NicknameUpdate(BaseModel):
    name: str

@app.patch("/auth/me")
def update_me(body: NicknameUpdate, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="닉네임을 입력해주세요.")
    user = db.query(models.User).filter(models.User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    user.name = body.name.strip()
    db.commit()
    db.refresh(user)
    return {"id": user.id, "name": user.name, "email": user.email, "token_balance": user.token_balance or 0}


@app.get("/auth/me")
def get_me(current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "token_balance": user.token_balance or 0,
        "last_checkin_date": str(user.last_checkin_date) if user.last_checkin_date else None,
    }


@app.get("/auth/attendance")
def get_attendance_status(current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    
    today = _dt.date.today()
    last_date = user.last_checkin_date
    
    can_checkin = (last_date != today)
    
    # 내일 출석하면 며칠째인지 계산
    if not last_date:
        next_streak = 1
    elif last_date == today:
        next_streak = user.consecutive_days
    elif last_date == today - _dt.timedelta(days=1):
        next_streak = user.consecutive_days + 1
    else:
        next_streak = 1

    return {
        "consecutive_days": user.consecutive_days or 0,
        "last_checkin_at": user.last_checkin_at.isoformat() if hasattr(user, 'last_checkin_at') and user.last_checkin_at else None,
        "can_checkin": can_checkin,
        "token_balance": user.token_balance or 0,
        "next_streak": next_streak,
        "reward_grid": [
            {"day": i, "tokens": 5000 if i not in [3, 7, 14, 21, 30] else 
             (7500 if i == 3 else 15000 if i == 7 else 30000 if i == 14 else 40000 if i == 21 else 55000),
             "multiplier": 1.5 if i == 3 else 3 if i == 7 else 6 if i == 14 else 8 if i == 21 else 11 if i == 30 else 1}
            for i in range(1, 31)
        ]
    }


@app.post("/auth/checkin")
def checkin(current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    
    today = _dt.date.today()
    if user.last_checkin_date == today:
        return {"success": False, "message": "이미 오늘 출석했습니다.", "token_balance": user.token_balance or 0}
    
    # 연속 일수 계산
    if user.last_checkin_date == today - _dt.timedelta(days=1):
        user.consecutive_days = (user.consecutive_days or 0) + 1
    else:
        user.consecutive_days = 1
    
    # 보상 계산 (3, 7, 14, 21, 30일 보너스)
    base_reward = 5000
    streak = user.consecutive_days
    
    if streak == 3: tokens_earned = 7500  # x1.5
    elif streak == 7: tokens_earned = 15000 # x3
    elif streak == 14: tokens_earned = 30000 # x6
    elif streak == 21: tokens_earned = 40000 # x8
    elif streak == 30: tokens_earned = 55000 # x11
    else: tokens_earned = base_reward
    
    user.token_balance = (user.token_balance or 0) + tokens_earned
    user.last_checkin_date = today
    if hasattr(user, 'last_checkin_at'):
        user.last_checkin_at = _dt.datetime.utcnow()
        
    db.commit()
    return {
        "success": True, 
        "tokens_earned": tokens_earned, 
        "token_balance": user.token_balance,
        "consecutive_days": user.consecutive_days
    }


# ---------------------------------------------------------------------------
# API — Summaries
# ---------------------------------------------------------------------------

@app.get("/summaries/{topic_id}")
async def get_summaries(topic_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.Summary)
        .filter(models.Summary.topic_id == topic_id)
        .order_by(models.Summary.created_at.desc())
        .all()
    )

@app.patch("/summaries/{summary_id}")
async def update_summary(summary_id: int, data: SummaryUpdate, db: Session = Depends(get_db)):
    s = db.query(models.Summary).filter(models.Summary.id == summary_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="요약을 찾을 수 없습니다.")
    s.content = data.content.strip()
    db.commit()
    db.refresh(s)
    return s

class InnerThoughtRequest(BaseModel):
    character_name: Optional[str] = None

@app.post("/topics/{topic_id}/inner-thought")
async def refresh_inner_thought(
    topic_id: int,
    body: InnerThoughtRequest = InnerThoughtRequest(),
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
        
    result = await generate_inner_thought(topic_id, db, target_name=body.character_name)
    if result is None:
        raise HTTPException(status_code=500, detail="속마음 생성 실패")
    
    # DT 차감 및 기록
    log_feature_usage(db, topic_id, current_user_id, "INNER_THOUGHT", FEATURE_DT_COST)
    
    return {"inner_thoughts": result}

@app.delete("/summaries/{summary_id}")
async def delete_summary(summary_id: int, db: Session = Depends(get_db)):
    s = db.query(models.Summary).filter(models.Summary.id == summary_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="요약을 찾을 수 없습니다.")
    db.delete(s)
    db.commit()
    return {"message": "삭제 완료"}

# ---------------------------------------------------------------------------
# 모델 가격 정책 (1회 응답당 DT 소모량)
# ---------------------------------------------------------------------------
MODEL_DT_PRICES = {
    "gemini-3.1-flash-lite-preview-vertex": 0,
    "gemini-3-flash-preview-vertex": 25,
    "gemini-2.5-pro-vertex": 50,
    "gemini-3.1-pro-preview-vertex": 90,
    "gpt-5.4": 110,
}
FEATURE_DT_COST = 10  # 기능 갱신 고정 비용

# 이미지/영상/음악 생성 DT 비용
IMAGE_DT_COST        = 15   # 이미지 생성 (배경, 단계 캐릭터, 엔딩, 호감도, 표지)
BGM_DT_COST          = 30   # BGM 생성
CINEMATIC_DT_COST    = 50   # 시네마틱 영상 생성
SCENARIO_BUILD_COST  = 50   # 시나리오 생성 (빌더 파이프라인)

def get_dt_price(model_selection: str) -> int:
    return MODEL_DT_PRICES.get(model_selection, 0) # 기본값 0 (무료)

def log_feature_usage(db: Session, topic_id: int, user_id: int, feature_name: str, cost: int):
    """기능 사용 시 DT 차감 및 기록 (is_active=False로 저장하여 채팅에는 안 보임)"""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user:
        user.token_balance = (user.token_balance or 0) - cost
        
    usage_record = models.Message(
        topic_id=topic_id,
        role="system",
        content=f"Feature Used: {feature_name}",
        model_name=f"FEATURE_{feature_name}",
        spent_dt=cost,
        is_active=False
    )
    db.add(usage_record)
    db.commit()

# ---------------------------------------------------------------------------

@app.get("/personas")
async def get_personas(current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    return db.query(models.Persona).filter(models.Persona.user_id == current_user_id).all()

@app.post("/personas")
async def create_persona(data: PersonaCreate, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    new_p = models.Persona(user_id=current_user_id, name=data.name, description=data.description)
    db.add(new_p)
    db.commit()
    db.refresh(new_p)
    return new_p

@app.patch("/personas/{persona_id}")
async def update_persona(persona_id: int, data: PersonaUpdate, db: Session = Depends(get_db)):
    p = db.query(models.Persona).filter(models.Persona.id == persona_id).first()
    if not p:
        raise HTTPException(status_code=404)
    if data.name:
        p.name = data.name
    if data.description:
        p.description = data.description
    db.commit()
    db.refresh(p)
    return p

@app.delete("/personas/{persona_id}")
async def delete_persona(persona_id: int, db: Session = Depends(get_db)):
    p = db.query(models.Persona).filter(models.Persona.id == persona_id).first()
    if not p:
        raise HTTPException(status_code=404)
    db.query(models.Topic).filter(models.Topic.active_persona_id == persona_id).update(
        {models.Topic.active_persona_id: None}
    )
    db.delete(p)
    db.commit()
    return {"message": "삭제 완료"}

# ---------------------------------------------------------------------------
# API — Topics
# ---------------------------------------------------------------------------

@app.get("/topics")
async def get_topics(current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    # 성능 최적화: 방대한 JSON 필드 제외 (목록 조회용)
    # 썸네일 표시를 위해 cover_image는 다시 포함
    topics = db.query(
        models.Topic.id,
        models.Topic.user_id,
        models.Topic.title,
        models.Topic.character_name,
        models.Topic.created_at,
        models.Topic.affection,
        models.Topic.intimacy,
        models.Topic.genre,
        models.Topic.content_type,
        models.Topic.original_title,
        models.Topic.custom_name,
        models.Topic.active_persona_id,
        models.Topic.cover_image,
        models.Topic.is_published,
        models.Topic.imported_from_id,
        sa_case((models.Topic.compass.isnot(None), True), else_=False).label('has_compass'),
        models.Topic.classic_country,
        sa_func.json_extract(models.Topic.ai_character, '$.name').label('ai_character_name'),
        sa_func.json_extract(models.Topic.user_character, '$.name').label('user_character_name'),
        sa_func.json_extract(models.Topic.game_state, '$.is_ended').label('is_ended'),
        sa_func.json_extract(models.Topic.game_state, '$.current_stage').label('current_stage'),
        sa_func.json_extract(models.Topic.game_state, '$.story_length').label('story_length'),
    ).filter(models.Topic.user_id == current_user_id).all()
    
    # 배치로 원작자 이름 조회 (imported 토픽 전용)
    imported_ids = [t.imported_from_id for t in topics if t.imported_from_id]
    source_author_map: dict = {}
    if imported_ids:
        src_rows = (
            db.query(models.Topic.id, models.User.name.label("author_name"))
            .join(models.User, models.Topic.author_user_id == models.User.id)
            .filter(models.Topic.id.in_(imported_ids))
            .all()
        )
        source_author_map = {r.id: r.author_name for r in src_rows}

    result = []
    for t in topics:
        # Row 객체를 dict로 변환
        row = t._asdict()

        # UI 호환성을 위해 제외된 필드들에 대한 기본값(null) 추가 (하얀 화면 방지)
        row['scenario'] = None
        row['ai_character'] = None
        row['user_character'] = None
        row['supporting_cast'] = None
        # row['cover_image'] = None  <-- 이제 DB에서 가져오므로 null로 덮어쓰지 않음
        row['compass'] = 'set' if row.pop('has_compass', False) else None
        row['game_state'] = None
        row['ai_character_name'] = row.pop('ai_character_name', None)
        row['user_character_name'] = row.pop('user_character_name', None)
        row['is_ended'] = bool(row.pop('is_ended', False))
        row['current_stage'] = row.pop('current_stage', None)
        row['story_length'] = row.pop('story_length', None)
        row['relationship_graph'] = None
        row['lorebook_entries'] = None
        row['source_author_name'] = source_author_map.get(t.imported_from_id) if t.imported_from_id else None

        last_msg = (
            db.query(models.Message)
            .filter(models.Message.topic_id == t.id)
            .order_by(models.Message.created_at.desc())
            .first()
        )
        row['last_message_at'] = (
            last_msg.created_at.isoformat() if last_msg else t.created_at.isoformat()
        )
        result.append(row)
    return result

@app.get("/topics/{topic_id}")
async def get_topic(topic_id: int, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)
    data = {c.name: getattr(topic, c.name) for c in topic.__table__.columns}
    # 갤러리에서 가져온 시나리오인 경우 원작자 이름 포함
    if topic.imported_from_id:
        src = db.query(models.Topic, models.User.name.label("author_name")) \
            .join(models.User, models.Topic.author_user_id == models.User.id) \
            .filter(models.Topic.id == topic.imported_from_id) \
            .first()
        if src:
            data["source_author_name"] = src.author_name
            data["source_author_user_id"] = src.Topic.author_user_id
    return data

@app.post("/topics")
async def create_topic(topic_data: TopicCreate, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    new_topic = models.Topic(
        user_id=current_user_id,
        character_name=topic_data.character_name,
        title=topic_data.title,
        worldview=topic_data.worldview,
        genre=topic_data.genre,
        original_title=topic_data.original_title,
        affection=0,
        intimacy=0,
    )
    db.add(new_topic)
    db.commit()
    db.refresh(new_topic)
    return new_topic

@app.patch("/topics/{topic_id}")
async def update_topic(topic_id: int, data: TopicUpdate, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    if data.title is not None:
        topic.title = data.title
    if data.tone_preference is not None:
        topic.tone_preference = data.tone_preference or None
    if data.user_notes is not None:
        topic.user_notes = data.user_notes
    if data.active_persona_id is not None:
        topic.active_persona_id = data.active_persona_id if data.active_persona_id > 0 else None
    if data.reasoning_level is not None:
        topic.reasoning_level = data.reasoning_level
    if data.output_length is not None:
        topic.output_length = data.output_length
    if data.scenario is not None:
        topic.scenario = data.scenario
    if data.ai_character is not None:
        topic.ai_character = data.ai_character
    if data.user_character is not None:
        topic.user_character = data.user_character
    if data.supporting_cast is not None:
        topic.supporting_cast = data.supporting_cast
    if data.user_note_presets is not None:
        topic.user_note_presets = data.user_note_presets
    if data.custom_name is not None:
        topic.custom_name = data.custom_name if data.custom_name.strip() else None
    if data.story_length is not None and data.story_length in ('short', 'normal', 'long'):
        gs = dict(topic.game_state) if topic.game_state else {}
        gs['story_length'] = data.story_length
        topic.game_state = gs
    db.commit()
    return {"message": "업데이트 완료"}

# ---------------------------------------------------------------------------
# API — Lorebook
# ---------------------------------------------------------------------------

class LorebookEntryCreate(BaseModel):
    keyword: str
    content: str
    category: str = "event"

class LorebookEntryUpdate(BaseModel):
    keyword: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None

# ---------------------------------------------------------------------------
# API — Relationship Graph
# ---------------------------------------------------------------------------

@app.get("/topics/{topic_id}/relationship-graph")
async def get_relationship_graph(topic_id: int, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    return {"graph": topic.relationship_graph}

@app.post("/topics/{topic_id}/relationship-graph/refresh")
async def refresh_relationship_graph(
    topic_id: int, 
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    game_state = GameStateV2.from_dict(topic.game_state or {})
    recent_msgs = (
        db.query(models.Message)
        .filter(models.Message.topic_id == topic_id)
        .order_by(models.Message.created_at.desc())
        .limit(10)
        .all()
    )
    recent_text = "".join(
        f"{m.role}: {m.content}\n"
        for m in reversed(recent_msgs)
        if not isinstance(m.content, str) or not m.content.startswith('{')
    )
    graph = await asyncio.to_thread(
        generate_relationship_graph,
        topic.ai_character,
        topic.user_character,
        topic.supporting_cast,
        topic.compass or {},
        game_state.current_stage,
        game_state.conversation_summary,
        topic.relationship_graph,
        recent_text,
    )
    topic.relationship_graph = graph
    
    # DT 차감 및 기록
    log_feature_usage(db, topic_id, current_user_id, "RELATION_GRAPH", FEATURE_DT_COST)
    
    db.commit()
    return {"graph": graph}

@app.post("/topics/{topic_id}/generate-background")
async def generate_stage_background(
    topic_id: int,
    stage: str,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """특정 단계의 채팅 배경 이미지를 생성하고 Firebase에 저장 후 URL을 반환합니다."""
    import copy, time
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    scenario = topic.scenario or {}
    scenario_text = scenario.get(stage, '') if isinstance(scenario, dict) else ''

    # 해당 단계의 대화 컨텍스트 수집 (stage 기준 메시지, 최대 10개)
    all_msgs = (
        db.query(models.Message)
        .filter(
            models.Message.topic_id == topic_id,
            models.Message.role.in_(['user', 'assistant']),
            models.Message.is_active == True,
        )
        .order_by(models.Message.created_at.asc())
        .all()
    )
    stage_order = ['기', '승', '전', '결']
    target_idx = stage_order.index(stage) if stage in stage_order else 0
    # stage_opening 메시지로 단계 경계 감지
    stage_boundaries = {}
    for m in all_msgs:
        try:
            parsed = json.loads(m.content) if isinstance(m.content, str) and m.content.startswith('{') else {}
            if parsed.get('is_stage_opening') and parsed.get('stage'):
                stage_boundaries[parsed['stage']] = m.id
        except Exception:
            pass
    # 해당 단계에 속하는 메시지 필터링
    stage_start_id = stage_boundaries.get(stage, None)
    next_stage = stage_order[target_idx + 1] if target_idx + 1 < len(stage_order) else None
    stage_end_id = stage_boundaries.get(next_stage, None) if next_stage else None
    stage_msgs = [
        m for m in all_msgs
        if (stage_start_id is None or m.id >= stage_start_id)
        and (stage_end_id is None or m.id < stage_end_id)
    ]
    recent_msgs = stage_msgs[-10:] if len(stage_msgs) > 10 else stage_msgs
    ai_name = (topic.ai_character or {}).get('name', 'AI')
    recent_chat_context = "\n".join(
        f"{'유저' if m.role == 'user' else ai_name}: "
        + (json.loads(m.content).get('reply', m.content) if m.role == 'assistant' else m.content)[:300]
        for m in recent_msgs
    ) if recent_msgs else None

    bg_img_raw = await asyncio.to_thread(
        generate_background_image,
        content_type=topic.content_type or '소설',
        genre=topic.genre or '판타지',
        stage=stage,
        scenario_stage_text=scenario_text,
        classic_country=topic.classic_country,
        seed=abs(hash(f"{topic_id}_{stage}_{int(time.time())}")) % 10000,
        recent_chat_context=recent_chat_context,
    )

    if not bg_img_raw:
        raise HTTPException(status_code=500, detail="배경 이미지 생성 실패")

    timestamp = int(time.time())
    bg_url = await upload_image_to_firebase(
        bg_img_raw, f"images/background/topic_{topic_id}_bg_{stage}_{timestamp}"
    )

    # 배열 기반 구조로 저장: {"기": [url, ...], "active": {"기": url}}
    import copy as _copy
    current_bg = _copy.deepcopy(topic.background_images) if topic.background_images else {}

    # 기존 단일 URL 문자열이면 배열로 마이그레이션
    for s in ['기', '승', '전', '결']:
        if s in current_bg and isinstance(current_bg[s], str):
            current_bg[s] = [current_bg[s]]

    if stage not in current_bg or not isinstance(current_bg[stage], list):
        current_bg[stage] = []
    current_bg[stage].append(bg_url)

    if 'active' not in current_bg:
        current_bg['active'] = {}
    current_bg['active'][stage] = bg_url

    topic.background_images = current_bg
    log_feature_usage(db, topic_id, current_user_id, "BACKGROUND_IMAGE", IMAGE_DT_COST)
    db.commit()

    return {"stage": stage, "url": bg_url, "background_images": current_bg}


class BackgroundSelectRequest(BaseModel):
    topic_id: int
    stage: str
    image_url: Optional[str] = None


@app.post("/chat/select-background")
async def select_background_endpoint(
    request: BackgroundSelectRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    topic = db.query(models.Topic).filter(
        models.Topic.id == request.topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    import copy as _copy
    current_bg = _copy.deepcopy(topic.background_images) if topic.background_images else {}
    if 'active' not in current_bg:
        current_bg['active'] = {}
    current_bg['active'][request.stage] = request.image_url

    topic.background_images = current_bg
    db.commit()
    return {"message": "Background selected", "background_images": current_bg}


@app.post("/chat/clear-background")
async def clear_background_endpoint(
    request: BackgroundSelectRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """특정 단계의 활성 배경을 해제합니다 (기본 배경으로 되돌리기)."""
    topic = db.query(models.Topic).filter(
        models.Topic.id == request.topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    import copy as _copy
    current_bg = _copy.deepcopy(topic.background_images) if topic.background_images else {}
    if 'active' not in current_bg:
        current_bg['active'] = {}
    current_bg['active'][request.stage] = None

    topic.background_images = current_bg
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(topic, "background_images")
    db.commit()
    return {"message": "Background cleared", "background_images": current_bg}


@app.post("/chat/delete-background")
async def delete_background_endpoint(
    request: BackgroundSelectRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    topic = db.query(models.Topic).filter(
        models.Topic.id == request.topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    import copy as _copy
    current_bg = _copy.deepcopy(topic.background_images) if topic.background_images else {}

    stage_list = current_bg.get(request.stage, [])
    if isinstance(stage_list, str):
        stage_list = [stage_list]

    if request.image_url in stage_list:
        stage_list.remove(request.image_url)
        current_bg[request.stage] = stage_list

        await asyncio.to_thread(delete_firebase_file, request.image_url)

        if current_bg.get('active', {}).get(request.stage) == request.image_url:
            current_bg['active'][request.stage] = stage_list[0] if stage_list else None

        topic.background_images = current_bg
        db.commit()

    return {"message": "Background deleted", "background_images": current_bg}


@app.post("/topics/{topic_id}/generate-stage-character")
async def generate_stage_character_endpoint(
    topic_id: int,
    stage: str,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """단계 전환 시 AI 캐릭터 이미지를 생성합니다."""
    import copy as _copy, time as _time
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    # 단계 오프닝 텍스트 + 최근 대화 조회
    opening_text = ''
    recent_lines = []
    all_msgs = (
        db.query(models.Message)
        .filter(
            models.Message.topic_id == topic_id,
            models.Message.is_active == True,
        )
        .order_by(models.Message.created_at.asc())
        .all()
    )
    for m in all_msgs:
        try:
            parsed = json.loads(m.content)
            if parsed.get('is_stage_opening') and parsed.get('stage') == stage:
                opening_text = parsed.get('reply', '')
        except Exception:
            pass
        # 최근 대화 수집 (최근 10턴)
        content = m.content if isinstance(m.content, str) else ''
        try:
            parsed_c = json.loads(content)
            content = parsed_c.get('reply', content)
        except Exception:
            pass
        if content and not content.startswith('{'):
            recent_lines.append(f"{'AI' if m.role == 'assistant' else '유저'}: {content[:150]}")
    recent_conversation = '\n'.join(recent_lines[-20:])

    # 게임 상태에서 호감도 추출
    game_state_data = topic.game_state or {}
    affinity = game_state_data.get('affinity', 0)

    img_raw = await asyncio.to_thread(
        generate_stage_character_image,
        content_type=topic.content_type or '소설',
        genre=topic.genre or '판타지',
        stage=stage,
        ai_char=topic.ai_character or {},
        stage_opening_text=opening_text,
        classic_country=topic.classic_country,
        user_char=topic.user_character or {},
        recent_conversation=recent_conversation,
        worldview=topic.worldview or topic.setting or '',
        compass=topic.compass,
        affinity=affinity,
    )
    if not img_raw:
        raise HTTPException(status_code=500, detail="캐릭터 이미지 생성 실패")

    img_url = await upload_image_to_firebase(
        img_raw,
        f"images/stage_character/topic_{topic_id}_stage_{stage}_{int(_time.time())}",
    )

    current_imgs = _copy.deepcopy(topic.stage_character_images) if topic.stage_character_images else {}
    # 하위 호환: 기존 string → array 변환
    if stage in current_imgs and isinstance(current_imgs[stage], str):
        current_imgs[stage] = [current_imgs[stage]]
    if stage not in current_imgs:
        current_imgs[stage] = []
    current_imgs[stage].append(img_url)
    topic.stage_character_images = current_imgs
    log_feature_usage(db, topic_id, current_user_id, "STAGE_CHARACTER_IMAGE", IMAGE_DT_COST)
    db.commit()

    return {"stage": stage, "url": img_url, "urls": current_imgs[stage]}


@app.delete("/topics/{topic_id}/stage-character-image")
async def delete_stage_character_image(
    topic_id: int,
    stage: str,
    index: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """단계 캐릭터 이미지 히스토리에서 특정 인덱스 이미지를 삭제합니다."""
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    current_imgs = _copy.deepcopy(topic.stage_character_images) if topic.stage_character_images else {}
    if stage not in current_imgs:
        raise HTTPException(status_code=404, detail="해당 단계 이미지 없음")

    imgs = current_imgs[stage]
    if isinstance(imgs, str):
        imgs = [imgs]
    if index < 0 or index >= len(imgs):
        raise HTTPException(status_code=400, detail="잘못된 인덱스")

    imgs.pop(index)
    if imgs:
        current_imgs[stage] = imgs
    else:
        del current_imgs[stage]

    topic.stage_character_images = current_imgs
    db.commit()

    return {"stage": stage, "remaining": current_imgs.get(stage, [])}


@app.post("/topics/{topic_id}/generate-ending-image")
async def regenerate_ending_image(
    topic_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """엔딩 이미지를 재생성하고 히스토리에 추가합니다."""
    import time as _time
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    # 엔딩 정보 조회
    ending_msg = (
        db.query(models.Message)
        .filter(models.Message.topic_id == topic_id)
        .order_by(models.Message.id.desc())
        .all()
    )
    ending_scene = ""
    for m in ending_msg:
        if m.meta_json:
            meta = m.meta_json if isinstance(m.meta_json, dict) else {}
            if meta.get("ending"):
                ending_scene = meta["ending"].get("scene", "")
                break

    ai_char = topic.ai_character or {}
    user_char = topic.user_character or {}
    category = topic.category or "로맨스"
    genre = topic.genre or ""

    try:
        ending_img_raw = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: generate_ending_image(
                content_type=category,
                genre=genre,
                ending_scene=ending_scene,
                ai_char=ai_char,
                user_char=user_char,
                classic_country=topic.classic_country,
            )
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not ending_img_raw:
        raise HTTPException(status_code=500, detail="이미지 생성 실패")

    img_url = await upload_image_to_firebase(
        ending_img_raw,
        f"images/ending/topic_{topic_id}_ending_{int(_time.time())}",
    )

    import copy as _copy
    topic.ending_image = img_url
    existing = _copy.deepcopy(topic.ending_images) if topic.ending_images else []
    existing.append(img_url)
    topic.ending_images = existing
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(topic, "ending_images")
    log_feature_usage(db, topic_id, current_user_id, "ENDING_IMAGE", IMAGE_DT_COST)
    db.commit()

    return {"url": img_url, "urls": existing}


@app.delete("/topics/{topic_id}/ending-image")
async def delete_ending_image(
    topic_id: int,
    index: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """엔딩 이미지 히스토리에서 특정 인덱스 이미지를 삭제합니다."""
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    imgs = _copy.deepcopy(topic.ending_images) if topic.ending_images else []
    if isinstance(topic.ending_image, str) and not imgs:
        imgs = [topic.ending_image]

    if index < 0 or index >= len(imgs):
        raise HTTPException(status_code=400, detail="잘못된 인덱스")

    imgs.pop(index)
    topic.ending_images = imgs
    topic.ending_image = imgs[-1] if imgs else None
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(topic, "ending_images")
    db.commit()

    return {"remaining": imgs}


@app.post("/topics/{topic_id}/generate-affinity-image")
async def regenerate_affinity_image(
    topic_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """호감도 100 특전 이미지를 재생성하고 히스토리에 추가합니다."""
    import time as _time
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)
    if not topic.affinity_max_scene:
        raise HTTPException(status_code=400, detail="특전 씬 정보가 없습니다.")

    ai_char = topic.ai_character or {}
    user_char = topic.user_character or {}
    category = topic.content_type or "소설"
    genre = topic.genre or "판타지"

    try:
        img_raw = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: generate_ending_image(
                content_type=category,
                genre=genre,
                ending_type='해피',
                ending_scene=topic.affinity_max_scene,
                ai_char=ai_char,
                user_char=user_char,
                classic_country=topic.classic_country,
            )
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not img_raw:
        raise HTTPException(status_code=500, detail="이미지 생성 실패")

    img_url = await upload_image_to_firebase(
        img_raw,
        f"images/affinity/topic_{topic_id}_affinity_{int(_time.time())}",
    )

    topic.affinity_image = img_url
    existing = _copy.deepcopy(topic.affinity_images) if topic.affinity_images else []
    existing.append(img_url)
    topic.affinity_images = existing
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(topic, "affinity_images")
    log_feature_usage(db, topic_id, current_user_id, "AFFINITY_IMAGE", IMAGE_DT_COST)
    db.commit()

    return {"url": img_url, "urls": existing}


@app.delete("/topics/{topic_id}/affinity-image")
async def delete_affinity_image(
    topic_id: int,
    index: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """호감도 특전 이미지 히스토리에서 특정 인덱스 이미지를 삭제합니다."""
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    imgs = _copy.deepcopy(topic.affinity_images) if topic.affinity_images else []
    if isinstance(topic.affinity_image, str) and not imgs:
        imgs = [topic.affinity_image]

    if index < 0 or index >= len(imgs):
        raise HTTPException(status_code=400, detail="잘못된 인덱스")

    imgs.pop(index)
    topic.affinity_images = imgs
    topic.affinity_image = imgs[-1] if imgs else None
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(topic, "affinity_images")
    db.commit()

    return {"remaining": imgs}


@app.post("/topics/{topic_id}/generate-cover-image")
async def regenerate_cover_image_endpoint(
    topic_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """표지 이미지만 재생성합니다."""
    import time as _time, copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    ai_char = topic.ai_character or {}
    user_char = topic.user_character or {}
    content_type = topic.content_type or "소설"
    classic_country = topic.classic_country
    scenario_dict = topic.scenario or {}
    scenario_text = "\n".join([scenario_dict.get(k, '') for k in ['기', '승', '전', '결'] if scenario_dict.get(k)])

    try:
        composition_prompt = await asyncio.to_thread(
            analyze_relationship_for_composition,
            scenario_text=scenario_text,
            ai_name=ai_char.get('name', '상대'),
            user_name=user_char.get('name', '나'),
            genre=topic.genre or '',
            content_type=content_type,
        )
        cover_img_raw = await _generate_image_with_retry(
            generate_cover_image,
            content_type,
            composition_prompt,
            ai_char,
            user_char,
            ai_char.get('image') or None,
            user_char.get('image') or None,
            classic_country,
            999,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not cover_img_raw:
        raise HTTPException(status_code=500, detail="표지 이미지 생성 실패")

    cover_url = await upload_image_to_firebase(
        cover_img_raw,
        f"images/cover/topic_{topic_id}_cover_{int(_time.time())}",
    )

    from sqlalchemy.orm.attributes import flag_modified
    old_cover_images = list(_copy.deepcopy(topic.cover_images) or [])
    if topic.cover_image:
        old_cover_images.append(topic.cover_image)
    new_cover_images = old_cover_images + [cover_url]
    topic.cover_image = cover_url
    topic.cover_images = new_cover_images
    flag_modified(topic, "cover_images")
    log_feature_usage(db, topic_id, current_user_id, "COVER_IMAGE", IMAGE_DT_COST)
    db.commit()

    return {"url": cover_url, "urls": new_cover_images}


@app.delete("/topics/{topic_id}/cover-image")
async def delete_cover_image_endpoint(
    topic_id: int,
    index: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """표지 이미지 히스토리에서 특정 인덱스를 삭제합니다."""
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    imgs = _copy.deepcopy(topic.cover_images) if topic.cover_images else []
    if isinstance(topic.cover_image, str) and not imgs:
        imgs = [topic.cover_image]

    if index < 0 or index >= len(imgs):
        raise HTTPException(status_code=400, detail="잘못된 인덱스")

    imgs.pop(index)
    topic.cover_images = imgs
    topic.cover_image = imgs[-1] if imgs else None
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(topic, "cover_images")
    db.commit()

    return {"remaining": imgs}


class SetActiveCoverRequest(BaseModel):
    url: str

@app.post("/topics/{topic_id}/set-active-cover-image")
async def set_active_cover_image_endpoint(
    topic_id: int,
    body: SetActiveCoverRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """cover_images 중 하나를 현재 표지로 지정합니다."""
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)
    imgs = list(topic.cover_images or [])
    if body.url not in imgs:
        raise HTTPException(status_code=400, detail="해당 이미지가 목록에 없습니다.")
    topic.cover_image = body.url
    db.commit()
    return {"cover_image": body.url}


@app.post("/topics/{topic_id}/set-active-ai-character-image")
async def set_active_ai_character_image_endpoint(
    topic_id: int,
    body: SetActiveCoverRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)
    ai_char = _copy.deepcopy(topic.ai_character or {})
    if body.url not in (ai_char.get('images') or []):
        raise HTTPException(status_code=400, detail="해당 이미지가 목록에 없습니다.")
    ai_char['image'] = body.url
    from sqlalchemy.orm.attributes import flag_modified
    topic.ai_character = ai_char
    flag_modified(topic, "ai_character")
    db.commit()
    return {"image": body.url}


@app.post("/topics/{topic_id}/set-active-user-character-image")
async def set_active_user_character_image_endpoint(
    topic_id: int,
    body: SetActiveCoverRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)
    user_char = _copy.deepcopy(topic.user_character or {})
    if body.url not in (user_char.get('images') or []):
        raise HTTPException(status_code=400, detail="해당 이미지가 목록에 없습니다.")
    user_char['image'] = body.url
    from sqlalchemy.orm.attributes import flag_modified
    topic.user_character = user_char
    flag_modified(topic, "user_character")
    db.commit()
    return {"image": body.url}


@app.post("/topics/{topic_id}/regenerate-ai-character-image")
async def regenerate_ai_character_image_endpoint(
    topic_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """AI 캐릭터 이미지 단독 재생성."""
    import time as _time, copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    ai_char = _copy.deepcopy(topic.ai_character or {})
    content_type = topic.content_type or "소설"
    scenario_summary = (topic.scenario or {}).get('기', '')[:300]

    img_b64 = await _generate_image_with_retry(
        generate_character_image,
        content_type,
        ai_char.get('gender', ''),
        ai_char.get('age', ''),
        ai_char.get('appearance', ''),
        scenario_summary,
        ai_char.get('name', ''),
        topic.classic_country,
        777,
    )
    if not img_b64:
        raise HTTPException(status_code=500, detail="이미지 생성 실패")

    url = await upload_image_to_firebase(
        img_b64,
        f"images/ai_character/topic_{topic_id}_ai_{int(_time.time())}",
    )
    old_images = list(ai_char.get('images') or [])
    if ai_char.get('image'):
        old_images.append(ai_char['image'])
    new_images = old_images + [url]
    ai_char['image'] = url
    ai_char['images'] = new_images

    from sqlalchemy.orm.attributes import flag_modified
    topic.ai_character = ai_char
    flag_modified(topic, "ai_character")
    db.commit()

    return {"url": url, "images": new_images}


@app.delete("/topics/{topic_id}/ai-character-image")
async def delete_ai_character_image_endpoint(
    topic_id: int,
    index: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """AI 캐릭터 이미지 히스토리에서 특정 인덱스 삭제."""
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    ai_char = _copy.deepcopy(topic.ai_character or {})
    imgs = list(ai_char.get('images') or [])
    if not imgs and ai_char.get('image'):
        imgs = [ai_char['image']]

    if index < 0 or index >= len(imgs):
        raise HTTPException(status_code=400, detail="잘못된 인덱스")

    imgs.pop(index)
    ai_char['images'] = imgs
    ai_char['image'] = imgs[-1] if imgs else None

    from sqlalchemy.orm.attributes import flag_modified
    topic.ai_character = ai_char
    flag_modified(topic, "ai_character")
    db.commit()

    return {"remaining": imgs}


@app.post("/topics/{topic_id}/regenerate-user-character-image")
async def regenerate_user_character_image_endpoint(
    topic_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """유저 캐릭터 이미지 단독 재생성."""
    import time as _time, copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    user_char = _copy.deepcopy(topic.user_character or {})
    content_type = topic.content_type or "소설"
    scenario_summary = (topic.scenario or {}).get('기', '')[:300]

    img_b64 = await _generate_image_with_retry(
        generate_character_image,
        content_type,
        user_char.get('gender', ''),
        user_char.get('age', ''),
        user_char.get('appearance', ''),
        scenario_summary,
        user_char.get('name', ''),
        topic.classic_country,
        888,
    )
    if not img_b64:
        raise HTTPException(status_code=500, detail="이미지 생성 실패")

    url = await upload_image_to_firebase(
        img_b64,
        f"images/user_character/topic_{topic_id}_user_{int(_time.time())}",
    )
    old_images = list(user_char.get('images') or [])
    if user_char.get('image'):
        old_images.append(user_char['image'])
    new_images = old_images + [url]
    user_char['image'] = url
    user_char['images'] = new_images

    from sqlalchemy.orm.attributes import flag_modified
    topic.user_character = user_char
    flag_modified(topic, "user_character")
    db.commit()

    return {"url": url, "images": new_images}


@app.delete("/topics/{topic_id}/user-character-image")
async def delete_user_character_image_endpoint(
    topic_id: int,
    index: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """유저 캐릭터 이미지 히스토리에서 특정 인덱스 삭제."""
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    user_char = _copy.deepcopy(topic.user_character or {})
    imgs = list(user_char.get('images') or [])
    if not imgs and user_char.get('image'):
        imgs = [user_char['image']]

    if index < 0 or index >= len(imgs):
        raise HTTPException(status_code=400, detail="잘못된 인덱스")

    imgs.pop(index)
    user_char['images'] = imgs
    user_char['image'] = imgs[-1] if imgs else None

    from sqlalchemy.orm.attributes import flag_modified
    topic.user_character = user_char
    flag_modified(topic, "user_character")
    db.commit()

    return {"remaining": imgs}


@app.post("/topics/{topic_id}/regenerate-character-images")
async def regenerate_character_images_endpoint(
    topic_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """표지·AI캐릭터·유저캐릭터 이미지를 세트로 재생성합니다. SSE 스트림으로 진행상황 전달."""
    import time as _time
    import copy as _copy
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404)

    ai_char = _copy.deepcopy(topic.ai_character or {})
    user_char = _copy.deepcopy(topic.user_character or {})
    content_type = topic.content_type or "소설"
    classic_country = topic.classic_country
    scenario_dict = topic.scenario or {}
    scenario_summary = scenario_dict.get('기', '')[:300]
    scenario_text = "\n".join([scenario_dict.get(k, '') for k in ['기', '승', '전', '결'] if scenario_dict.get(k)])

    async def generate():
        nonlocal ai_char, user_char
        from sqlalchemy.orm.attributes import flag_modified

        # 1. AI 캐릭터 이미지
        yield _sse({"step": 1, "message": "AI 캐릭터 이미지 생성 중..."})
        ai_img_b64 = None
        ai_url = None
        try:
            ai_img_b64 = await _generate_image_with_retry(
                generate_character_image,
                content_type,
                ai_char.get('gender', ''),
                ai_char.get('age', ''),
                ai_char.get('appearance', ''),
                scenario_summary,
                ai_char.get('name', ''),
                classic_country,
                777,
            )
            if ai_img_b64:
                ai_url = await upload_image_to_firebase(
                    ai_img_b64,
                    f"images/ai_character/topic_{topic_id}_ai_{int(_time.time())}",
                )
                old_ai_images = list(ai_char.get('images') or [])
                if ai_char.get('image'):
                    old_ai_images.append(ai_char['image'])
                ai_char['image'] = ai_url
                ai_char['images'] = old_ai_images + [ai_url]
                # DB 저장 - 새 세션에서 재조회
                _topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
                if _topic:
                    _topic.ai_character = _copy.deepcopy(ai_char)
                    flag_modified(_topic, "ai_character")
                    db.commit()
                yield _sse({"step": 1, "done": True, "ai_url": ai_url, "ai_images": ai_char['images']})
        except Exception as e:
            yield _sse({"step": 1, "error": str(e)})

        await asyncio.sleep(30)

        # 2. 유저 캐릭터 이미지
        yield _sse({"step": 2, "message": "유저 캐릭터 이미지 생성 중..."})
        user_img_b64 = None
        user_url = None
        try:
            user_img_b64 = await _generate_image_with_retry(
                generate_character_image,
                content_type,
                user_char.get('gender', ''),
                user_char.get('age', ''),
                user_char.get('appearance', ''),
                scenario_summary,
                user_char.get('name', ''),
                classic_country,
                888,
            )
            if user_img_b64:
                user_url = await upload_image_to_firebase(
                    user_img_b64,
                    f"images/user_character/topic_{topic_id}_user_{int(_time.time())}",
                )
                old_user_images = list(user_char.get('images') or [])
                if user_char.get('image'):
                    old_user_images.append(user_char['image'])
                user_char['image'] = user_url
                user_char['images'] = old_user_images + [user_url]
                _topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
                if _topic:
                    _topic.user_character = _copy.deepcopy(user_char)
                    flag_modified(_topic, "user_character")
                    db.commit()
                yield _sse({"step": 2, "done": True, "user_url": user_url, "user_images": user_char['images']})
        except Exception as e:
            yield _sse({"step": 2, "error": str(e)})

        await asyncio.sleep(30)

        # 3. 표지 이미지
        yield _sse({"step": 3, "message": "표지 이미지 생성 중..."})
        try:
            composition_prompt = await asyncio.to_thread(
                analyze_relationship_for_composition,
                scenario_text=scenario_text,
                ai_name=ai_char.get('name', '상대'),
                user_name=user_char.get('name', '나'),
                genre=topic.genre or '',
                content_type=content_type,
            )
            cover_img_raw = await _generate_image_with_retry(
                generate_cover_image,
                content_type,
                composition_prompt,
                ai_char,
                user_char,
                ai_img_b64,
                user_img_b64,
                classic_country,
                999,
            )
            if cover_img_raw:
                cover_url = await upload_image_to_firebase(
                    cover_img_raw,
                    f"images/cover/topic_{topic_id}_cover_{int(_time.time())}",
                )
                _topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
                if _topic:
                    old_cover_images = list(_copy.deepcopy(_topic.cover_images) or [])
                    if _topic.cover_image:
                        old_cover_images.append(_topic.cover_image)
                    new_cover_images = old_cover_images + [cover_url]
                    _topic.cover_image = cover_url
                    _topic.cover_images = new_cover_images
                    flag_modified(_topic, "cover_images")
                    db.commit()
                    yield _sse({"step": 3, "done": True, "cover_url": cover_url, "cover_images": new_cover_images})
        except Exception as e:
            yield _sse({"step": 3, "error": str(e)})

        yield _sse({"step": "complete", "message": "이미지 세트 재생성 완료"})

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/topics/{topic_id}/suggest-replies")
async def suggest_replies(topic_id: int, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)

    recent_msgs = (
        db.query(models.Message)
        .filter(models.Message.topic_id == topic_id)
        .order_by(models.Message.created_at.desc())
        .limit(10).all()
    )
    recent_msgs = list(reversed(recent_msgs))

    ai_name = (topic.ai_character or {}).get('name', 'AI')
    user_name = (topic.user_character or {}).get('name', '유저')

    # DT 차감 및 기록 (추천 답변 새로고침 시 10 DT 소모)
    log_feature_usage(db, topic_id, current_user_id, "SUGGEST_REPLIES", FEATURE_DT_COST)

    recent_text = "\n".join(
        f"{'유저' if m.role == 'user' else ai_name}: "
        + (json.loads(m.content).get('reply', m.content) if m.role == 'assistant' else m.content)[:200]
        for m in recent_msgs
        if m.role in ('user', 'assistant')
    )

    def generate():
        result = vertex_complete(
            messages=[
                {"role": "system", "content": (
                    f"당신은 인터랙티브 소설 게임의 유저 답변 추천 시스템입니다.\n"
                    f"유저 캐릭터: {user_name} / AI 캐릭터: {ai_name} / 장르: {topic.genre or '판타지'}\n\n"
                    "최근 대화를 보고, 유저가 다음에 할 수 있는 자연스러운 답변 4가지를 추천해줘.\n"
                    "각 답변은 서로 다른 특성을 가져야 해: 긍정적, 부정적, 중립적, 엉뚱한.\n"
                    "답변은 짧고 구체적으로 (30자 이내)로 작성해. 직접 대사는 큰따옴표(\"\")를 포함하고, 행동 묘사는 따옴표 없이 써줘.\n\n"
                    '[응답 형식 — JSON only, 다른 텍스트 없이]\n'
                    '{"replies": ['
                    '{"type": "긍정", "text": "..."}, '
                    '{"type": "부정", "text": "..."}, '
                    '{"type": "중립", "text": "..."}, '
                    '{"type": "엉뚱", "text": "..."}'
                    ']}'
                )},
                {"role": "user", "content": f"[최근 대화]\n{recent_text}"},
            ],
            temperature=0.85,
            max_tokens=400,
            model=VERTEX_MODEL_FLASH_LITE,
        )
        try:
            cleaned = re.sub(r'^```json\s*|\s*```$', '', result.strip())
            return json.loads(cleaned)
        except Exception:
            return {"replies": [
                {"type": "긍정", "text": "\"좋아, 해보자.\""},
                {"type": "부정", "text": "\"싫어, 난 안 할 거야.\""},
                {"type": "중립", "text": "\"...그래서?\""},
                {"type": "엉뚱", "text": "갑자기 하늘을 올려다봤다."},
            ]}

    return await asyncio.to_thread(generate)


@app.get("/topics/{topic_id}/lorebook")
async def get_lorebook(topic_id: int, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    return {"entries": topic.lorebook_entries or []}

@app.post("/topics/{topic_id}/lorebook")
async def add_lorebook_entry(topic_id: int, entry: LorebookEntryCreate, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    entries = list(topic.lorebook_entries or [])
    new_entry = {"keyword": entry.keyword, "content": entry.content, "category": entry.category}
    entries.append(new_entry)
    topic.lorebook_entries = entries
    db.commit()
    return {"entries": entries}

@app.patch("/topics/{topic_id}/lorebook/{index}")
async def update_lorebook_entry(topic_id: int, index: int, entry: LorebookEntryUpdate, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    entries = list(topic.lorebook_entries or [])
    if index < 0 or index >= len(entries):
        raise HTTPException(status_code=404, detail="항목 없음")
    if entry.keyword is not None:
        entries[index]["keyword"] = entry.keyword
    if entry.content is not None:
        entries[index]["content"] = entry.content
    if entry.category is not None:
        entries[index]["category"] = entry.category
    topic.lorebook_entries = entries
    db.commit()
    return {"entries": entries}

@app.delete("/topics/{topic_id}/lorebook/{index}")
async def delete_lorebook_entry(topic_id: int, index: int, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    entries = list(topic.lorebook_entries or [])
    if index < 0 or index >= len(entries):
        raise HTTPException(status_code=404, detail="항목 없음")
    entries.pop(index)
    topic.lorebook_entries = entries
    db.commit()
    return {"entries": entries}

@app.delete("/topics/{topic_id}")
async def delete_topic(topic_id: int, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)

    # Firebase Storage 파일 삭제 (다른 topic이 같은 URL 사용 시 건너뜀)
    firebase_urls = collect_topic_firebase_urls(topic)
    for url in firebase_urls:
        if not _url_used_by_other_topic(url, topic_id, db):
            await asyncio.to_thread(delete_firebase_file, url)

    db.query(models.Message).filter(models.Message.topic_id == topic_id).delete()
    db.query(models.Summary).filter(models.Summary.topic_id == topic_id).delete()
    db.delete(topic)
    db.commit()
    return {"message": "삭제 완료"}

@app.delete("/topics")
async def bulk_delete_topics(topic_ids: list[int], current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    topics = db.query(models.Topic).filter(
        models.Topic.id.in_(topic_ids),
        models.Topic.user_id == current_user_id
    ).all()
    # 삭제 대상 topic들의 Firebase URL 수집
    deleting_ids = {t.id for t in topics}
    all_urls_to_delete = set()
    for topic in topics:
        all_urls_to_delete.update(collect_topic_firebase_urls(topic))
    # 삭제하지 않는 topic들이 사용 중인 URL은 제외
    remaining_topics = db.query(models.Topic).filter(
        models.Topic.id.notin_(deleting_ids)
    ).all()
    protected_urls = set()
    for t in remaining_topics:
        protected_urls.update(collect_topic_firebase_urls(t))
    for url in all_urls_to_delete:
        if url not in protected_urls:
            await asyncio.to_thread(delete_firebase_file, url)

    db.query(models.Message).filter(models.Message.topic_id.in_(topic_ids)).delete(synchronize_session=False)
    db.query(models.Summary).filter(models.Summary.topic_id.in_(topic_ids)).delete(synchronize_session=False)
    db.query(models.Topic).filter(models.Topic.id.in_(topic_ids), models.Topic.user_id == current_user_id).delete(synchronize_session=False)
    db.commit()
    return {"message": f"{len(topic_ids)}개 삭제 완료"}


# ---------------------------------------------------------------------------
# API — Messages
# ---------------------------------------------------------------------------

@app.get("/messages/{topic_id}")
async def get_messages(topic_id: int, db: Session = Depends(get_db)):
    # 1. 일단 해당 토픽의 모든 메시지 로드
    all_messages = db.query(models.Message).filter(models.Message.topic_id == topic_id).order_by(models.Message.created_at.asc()).all()
    
    # 2. 각 부모(유저 메시지)별 최대 버전 계산
    max_versions = {}
    for m in all_messages:
        if m.parent_id:
            max_versions[m.parent_id] = max(max_versions.get(m.parent_id, 0), m.version or 1)

    # 3. 활성 메시지만 필터링 (화면 출력용) -> 모든 메시지 반환으로 변경 (사용량 합산 목적)
    # 다만 프론트엔드 렌더링 시에는 is_active를 확인하여 처리 필요
    
    result = []
    for m in all_messages:
        raw_content = m.content
        display_content = raw_content
        situation = None
        suggested_actions = []
        is_stage_opening = False
        stage_val = None
        is_ending = False
        ending_type = None
        ending_affinity = 0

        is_supporting = False
        speaker_name_val = m.speaker_name or None

        if m.role == "assistant":
            try:
                parsed = json.loads(raw_content)
                if isinstance(parsed, dict):
                    display_content = parsed.get("reply", str(parsed))
                    situation = parsed.get("situation")
                    suggested_actions = parsed.get("suggested_actions", [])
                    is_stage_opening = parsed.get("is_stage_opening", False)
                    stage_val = parsed.get("stage")
                    is_ending = parsed.get("is_ending", False)
                    ending_type = parsed.get("ending_type")
                    ending_affinity = parsed.get("ending_affinity", 0)
                    is_supporting = parsed.get("is_supporting", False)
                    if not speaker_name_val:
                        speaker_name_val = parsed.get("speaker_name") or None
            except:
                display_content = raw_content

        result.append({
            "id": m.id,
            "role": m.role,
            "content": display_content,
            "situation": situation,
            "suggested_actions": suggested_actions,
            "is_stage_opening": is_stage_opening,
            "stage": stage_val,
            "is_ending": is_ending,
            "ending_type": ending_type,
            "ending_affinity": ending_affinity,
            "is_supporting": is_supporting,
            "speaker_name": speaker_name_val,
            "parent_id": m.parent_id,
            "version": m.version,
            "max_version": max_versions.get(m.parent_id) if m.parent_id else (m.version or 1),
            "model_name": m.model_name,
            "spent_dt": m.spent_dt or 0,
            "is_active": m.is_active
        })
    return result

@app.delete("/messages/{message_id}")
async def delete_message_branch(message_id: int, db: Session = Depends(get_db)):
    target_msg = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not target_msg:
        raise HTTPException(status_code=404)
    topic_id = target_msg.topic_id
    db.query(models.Message).filter(
        models.Message.topic_id == topic_id,
        models.Message.created_at >= target_msg.created_at,
    ).delete(synchronize_session=False)
    db.flush()

    # 엔딩 메시지가 삭제됐으면 game_state.is_ended 리셋
    remaining = db.query(models.Message).filter(
        models.Message.topic_id == topic_id,
        models.Message.role == 'assistant',
    ).all()
    has_ending = any(
        '"is_ending": true' in (m.content or '') or "'is_ending': True" in (m.content or '')
        for m in remaining
    )
    if not has_ending:
        topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
        if topic and topic.game_state:
            gs = dict(topic.game_state)
            if gs.get('is_ended'):
                gs['is_ended'] = False
                topic.game_state = gs

    db.commit()
    return {"message": "삭제 완료"}

@app.post("/topics/{topic_id}/duplicate")
async def duplicate_topic(topic_id: int, until_message_id: Optional[int] = None, db: Session = Depends(get_db)):
    original = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not original:
        raise HTTPException(status_code=404)

    # 복제 시점까지의 메시지 목록 먼저 확정
    msg_query = db.query(models.Message).filter(
        models.Message.topic_id == topic_id
    ).order_by(models.Message.created_at.asc())

    if until_message_id:
        target_msg = db.query(models.Message).filter(models.Message.id == until_message_id).first()
        if target_msg:
            msg_query = msg_query.filter(models.Message.created_at <= target_msg.created_at)

    messages_to_clone = msg_query.all()

    # game_state 및 미디어 재구성 (until_message_id 지정 시 복제 시점 기준으로 보정)
    import copy as _copy
    import json as _json
    _STAGE_ORDER = ['기', '승', '전', '결']
    base_gs = _copy.deepcopy(original.game_state) if original.game_state else {}

    if until_message_id:
        reconstructed_stage = '기'
        stage_turn_count = 0
        total_turn_count = 0
        reconstructed_affinity = 0
        for m in messages_to_clone:
            if m.role == 'assistant':
                try:
                    parsed = _json.loads(m.content) if isinstance(m.content, str) and m.content.startswith('{') else {}
                    if parsed.get('is_stage_opening') and parsed.get('stage'):
                        reconstructed_stage = parsed['stage']
                        stage_turn_count = 0
                        continue
                    delta = int(parsed.get('affinity_delta', 0))
                    reconstructed_affinity = max(-100, min(100, reconstructed_affinity + delta))
                except Exception:
                    pass
                stage_turn_count += 1
                total_turn_count += 1

        cloned_game_state = {
            **base_gs,
            'current_stage': reconstructed_stage,
            'stage_turn_count': stage_turn_count,
            'total_turn_count': total_turn_count,
            'affinity': reconstructed_affinity,
            'is_ended': False,
            'off_track_count': 0,
        }

        # 복제 시점 단계까지의 인덱스
        stage_idx = _STAGE_ORDER.index(reconstructed_stage) if reconstructed_stage in _STAGE_ORDER else 0
        allowed_stages = set(_STAGE_ORDER[:stage_idx + 1])

        # background_images: 복제 시점 단계까지만
        orig_bg = _copy.deepcopy(original.background_images) if original.background_images else {}
        cloned_bg = {s: v for s, v in orig_bg.items() if s in allowed_stages}

        # stage_character_images: 복제 시점 이전 단계 전환에서 생성된 것만
        # (stage_char_image는 해당 단계 오프닝 시 생성 → 복제 시점 단계 포함)
        orig_char = _copy.deepcopy(original.stage_character_images) if original.stage_character_images else {}
        cloned_char = {s: v for s, v in orig_char.items() if s in allowed_stages}

        # bgm_urls: 복제 시점 단계까지만
        orig_bgm = _copy.deepcopy(original.bgm_urls) if original.bgm_urls else {}
        cloned_bgm = {s: v for s, v in orig_bgm.items() if s in allowed_stages}

        # bgm_url: 현재 단계 BGM 또는 None
        active_bgm = cloned_bgm.get(reconstructed_stage)
        cloned_bgm_url = (active_bgm[0] if isinstance(active_bgm, list) and active_bgm else active_bgm) if active_bgm else None

        # 호감도 특전 이미지: 복제 시점 호감도 100 이상인 경우만 복사
        cloned_affinity_image = original.affinity_image if reconstructed_affinity >= 100 else None
        cloned_affinity_images = (_copy.deepcopy(original.affinity_images) if original.affinity_images else []) if reconstructed_affinity >= 100 else []
        cloned_affinity_max_scene = original.affinity_max_scene if reconstructed_affinity >= 100 else None

    else:
        cloned_game_state = base_gs
        cloned_bg = _copy.deepcopy(original.background_images) if original.background_images else {}
        cloned_char = _copy.deepcopy(original.stage_character_images) if original.stage_character_images else {}
        cloned_bgm = _copy.deepcopy(original.bgm_urls) if original.bgm_urls else {}
        cloned_bgm_url = original.bgm_url
        cloned_affinity_image = original.affinity_image
        cloned_affinity_images = _copy.deepcopy(original.affinity_images) if original.affinity_images else []
        cloned_affinity_max_scene = original.affinity_max_scene

    cloned_affection = max(0, min(100, (reconstructed_affinity + 100) // 2)) if until_message_id else original.affection

    new_topic = models.Topic(
        user_id=original.user_id,
        character_name=original.character_name,
        title=original.title,
        affection=cloned_affection,
        intimacy=original.intimacy,
        setting=original.setting,
        user_notes=original.user_notes,
        tone_preference=original.tone_preference,
        worldview=original.worldview,
        genre=original.genre,
        original_title=original.original_title,
        reasoning_level=original.reasoning_level,
        output_length=original.output_length,
        character_info=original.character_info,
        last_summary_turn=original.last_summary_turn,
        content_type=original.content_type,
        classic_country=original.classic_country,
        scenario=original.scenario,
        ai_character=original.ai_character,
        user_character=original.user_character,
        compass=original.compass,
        game_state=cloned_game_state,
        lorebook_entries=(original.compass or {}).get('_initial_lorebook_entries', original.lorebook_entries),
        relationship_graph=(original.compass or {}).get('_initial_relationship_graph'),
        supporting_cast=(original.compass or {}).get('_initial_supporting_cast', original.supporting_cast),
        cover_image=original.cover_image,
        background_images=cloned_bg,
        stage_character_images=cloned_char,
        cinematic_url=original.cinematic_url,
        cinematic_urls=original.cinematic_urls,
        bgm_url=cloned_bgm_url,
        bgm_urls=cloned_bgm,
        affinity_image=cloned_affinity_image,
        affinity_images=cloned_affinity_images,
        affinity_max_scene=cloned_affinity_max_scene,
    )
    db.add(new_topic)
    db.flush()

    # 이미지 독립 복사 (원본 topic 삭제 시 영향 없도록)
    new_topic.cover_image = await clone_firebase_image_url(
        original.cover_image or '', "images/cover/topic_new_cover"
    )
    _ai = dict(new_topic.ai_character) if isinstance(new_topic.ai_character, dict) else {}
    if _ai.get('image'):
        _ai['image'] = await clone_firebase_image_url(_ai['image'], "images/ai_character/topic_new_ai")
        new_topic.ai_character = _ai
    _user = dict(new_topic.user_character) if isinstance(new_topic.user_character, dict) else {}
    if _user.get('image'):
        _user['image'] = await clone_firebase_image_url(_user['image'], "images/user_character/topic_new_user")
        new_topic.user_character = _user

    for m in messages_to_clone:
        if not m.is_active:
            continue  # DT 기록용 비활성 메시지(Feature Used 등)는 복제 제외
        db.add(models.Message(
            topic_id=new_topic.id,
            role=m.role,
            content=m.content,
            turn_number=m.turn_number,
            output_tokens=m.output_tokens,
            created_at=m.created_at,
        ))

    # 분기 시작 안내 메시지 추가
    db.add(models.Message(
        topic_id=new_topic.id,
        role='system',
        content='📍 이 시점부터 분기된 대화입니다. 기존 대화는 원본에서 그대로 진행됩니다.',
    ))

    # 서머리 복사 (복제 시점 이전 항목만)
    summary_query = db.query(models.Summary).filter(models.Summary.topic_id == topic_id)
    if until_message_id and target_msg:
        summary_query = summary_query.filter(models.Summary.created_at <= target_msg.created_at)
    for s in summary_query.all():
        db.add(models.Summary(
            topic_id=new_topic.id,
            content=s.content,
            stage=s.stage,
            created_at=s.created_at,
        ))

    db.commit()
    return {"id": new_topic.id, "title": new_topic.title}

# ---------------------------------------------------------------------------
# API — Chat (기존 JSON 방식, 하위 호환)
# ---------------------------------------------------------------------------

@app.post("/chat")
async def chat(request: ChatRequest, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    try:
        topic = db.query(models.Topic).filter(models.Topic.id == request.topic_id).first()
        if not topic:
            raise HTTPException(status_code=404)
        user_message = request.user_message.strip()

        if user_message == "!요약":
            _gs = topic.game_state if isinstance(topic.game_state, dict) else {}
            _stage = _gs.get('current_stage') or None
            summary_text = await summarize_chat(topic.id, db, stage=_stage)
            if summary_text:
                # DT 차감 및 기록
                log_feature_usage(db, topic.id, current_user_id, "SUMMARY", FEATURE_DT_COST)
                return {"reply": "", "situation": None, "event": "SUMMARY_COMPLETE", "summary": summary_text, "suggested_actions": []}
            return {"reply": "", "situation": None, "event": "SUMMARY_FAILED", "summary": None, "suggested_actions": []}

        if user_message.startswith("!설정 "):
            scenario_text = user_message[4:].strip()
            topic.setting = scenario_text
            res_data = {
                "reply": scenario_text, "situation": None,
                "inner_thoughts": "이야기가 시작되었습니다.",
                "stats": {"affection": topic.affection, "intimacy": topic.intimacy},
                "event": "START",
                "suggested_actions": ["이야기를 계속한다", "주변을 살펴본다", "상대방에게 말을 건넨다"],
                "character_update": None,
            }
            db.add(models.Message(topic_id=topic.id, role="assistant", content=json.dumps(res_data, ensure_ascii=False)))
            db.commit()
            return res_data

        llm = _get_llm_or_raise(request.model_selection)

        current_persona_name = "여행자"
        persona_info = "일반적인 여행자"
        if topic.active_persona_id:
            p = db.query(models.Persona).filter(models.Persona.id == topic.active_persona_id).first()
            if p:
                current_persona_name = p.name
                persona_info = f"이름: {p.name}, 설정: {p.description}"

        summary_context = get_summary_context(topic.id, db)
        context_text = get_chat_context(
            f"{topic.original_title or ''} {user_message}",
            genre=topic.genre,
            category=topic.content_type,
        )

        system_prompt = build_system_prompt(
            character_name=request.character_name,
            current_persona_name=current_persona_name,
            persona_info=persona_info,
            topic=topic,
            summary_context=summary_context,
            context_text=context_text,
        )

        messages_list = [SystemMessage(content=system_prompt)]
        recent = (
            db.query(models.Message)
            .filter(models.Message.topic_id == topic.id)
            .order_by(models.Message.created_at.desc())
            .limit(30).all()
        )
        for m in reversed(recent):
            if m.role == "user":
                messages_list.append(HumanMessage(content=m.content))
            else:
                try:
                    cj = json.loads(m.content)
                    reply = cj.get("reply", m.content)
                    it = cj.get("inner_thoughts", "")
                    messages_list.append(AIMessage(content=f"[속마음: {it}]\n{reply}" if it else reply))
                except:
                    messages_list.append(AIMessage(content=m.content))
        messages_list.append(HumanMessage(content=user_message))

        llm_with_limit = llm.bind(max_output_tokens=16384)
        res = llm_with_limit.invoke(messages_list)
        ai_content = extract_ai_text(res.content)

        try:
            res_data = json.loads(ai_content)
        except:
            res_data = {
                "reply": ai_content, "situation": "대화 중", "inner_thoughts": "생각 중",
                "stats": {"affection": topic.affection, "intimacy": topic.intimacy},
                "event": None, "suggested_actions": [],
            }

        if res_data.get("character_update"):
            if not topic.character_info:
                topic.character_info = {}
            info_list = topic.character_info.get("traits", [])
            info_list.append(res_data["character_update"])
            topic.character_info = {"traits": info_list[-10:]}

        if "stats" in res_data:
            topic.affection = max(0, min(100, res_data["stats"].get("affection", topic.affection)))
            topic.intimacy = max(0, min(100, res_data["stats"].get("intimacy", topic.intimacy)))

        db.add(models.Message(topic_id=topic.id, role="user", content=user_message))
        db.add(models.Message(topic_id=topic.id, role="assistant", content=json.dumps(res_data, ensure_ascii=False)))
        await check_and_auto_summarize(topic.id, db, topic)
        db.commit()

        output_tokens = 0
        try:
            if hasattr(res, "usage_metadata") and res.usage_metadata:
                output_tokens = res.usage_metadata.get("output_tokens", 0)
        except:
            pass

        return {**res_data, "output_tokens": output_tokens}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


FIREBASE_BUCKET = "diveai-494805.firebasestorage.app"
FIREBASE_URL_PREFIX = f"https://storage.googleapis.com/{FIREBASE_BUCKET}/"
_FIREBASE_REST_PREFIX = f"https://firebasestorage.googleapis.com/v0/b/{FIREBASE_BUCKET}/o/"

def _extract_firebase_blob_path(url: str):
    """Firebase URL(구/신 형식 모두)에서 blob 경로를 추출합니다. Firebase URL이 아니면 None 반환."""
    import urllib.parse as _up
    if not url or not isinstance(url, str):
        return None
    if url.startswith(FIREBASE_URL_PREFIX):
        return url[len(FIREBASE_URL_PREFIX):]
    if url.startswith(_FIREBASE_REST_PREFIX):
        encoded = url[len(_FIREBASE_REST_PREFIX):].split('?')[0]
        return _up.unquote(encoded)
    return None

def delete_firebase_file(url: str) -> None:
    """Firebase Storage URL의 파일을 삭제합니다. 실패해도 예외를 던지지 않습니다."""
    try:
        from firebase_admin import storage
        path = _extract_firebase_blob_path(url)
        if not path:
            return
        bucket = storage.bucket(FIREBASE_BUCKET)
        bucket.blob(path).delete()
        print(f"[Firebase Delete] 삭제 완료: {path}")
    except Exception as e:
        print(f"[Firebase Delete Error] {e}")

def collect_topic_firebase_urls(topic) -> list:
    """토픽에 연결된 모든 Firebase Storage URL을 수집합니다 (구/신 형식 모두)."""
    urls = set()
    def _add(u):
        if u and isinstance(u, str) and _extract_firebase_blob_path(u) is not None:
            urls.add(u)
    def _scan(obj):
        if isinstance(obj, str):
            _add(obj)
        elif isinstance(obj, list):
            for item in obj: _scan(item)
        elif isinstance(obj, dict):
            for v in obj.values(): _scan(v)
    _add(topic.cover_image)
    _add(topic.ending_image)
    _add(topic.affinity_image)
    _add(topic.cinematic_url)
    _scan(topic.ai_character)
    _scan(topic.user_character)
    _scan(topic.background_images)
    _scan(topic.stage_character_images)
    _scan(topic.ending_images)
    _scan(topic.affinity_images)
    # BGM URL (오디오 파일)
    bgm_data = topic.bgm_urls or {}
    for stage in ['기', '승', '전', '결']:
        tracks = bgm_data.get(stage, [])
        if isinstance(tracks, str): tracks = [tracks]
        for u in tracks:
            if u and isinstance(u, str) and u.startswith('https://'):
                urls.add(u)
    if topic.bgm_url and topic.bgm_url.startswith('https://'):
        urls.add(topic.bgm_url)
    return list(urls)

def _url_used_by_other_topic(url: str, exclude_topic_id: int, db) -> bool:
    """해당 URL을 사용하는 다른 topic이 존재하는지 확인합니다."""
    other_topics = db.query(models.Topic).filter(models.Topic.id != exclude_topic_id).all()
    for t in other_topics:
        if url in collect_topic_firebase_urls(t):
            return True
    return False

async def clone_firebase_image_url(url: str, new_path: str) -> str:
    """Firebase Storage 이미지를 새 경로로 복사하고 독립적인 URL을 반환합니다.
    복사 실패 시 원본 URL을 그대로 반환합니다."""
    path = _extract_firebase_blob_path(url)
    if not path:
        return url
    import time as _time, urllib.parse as _urlparse
    try:
        from firebase_admin import storage as _storage
        def _do_clone():
            _bucket = _storage.bucket(FIREBASE_BUCKET)
            src_blob = _bucket.blob(path)
            if not src_blob.exists():
                return url
            ext = path.rsplit('.', 1)[-1] if '.' in path else 'png'
            dst_path = f"{new_path}_{int(_time.time())}.{ext}"
            _bucket.copy_blob(src_blob, _bucket, dst_path)
            encoded = _urlparse.quote(dst_path, safe='')
            return f"https://firebasestorage.googleapis.com/v0/b/{FIREBASE_BUCKET}/o/{encoded}?alt=media"
        return await asyncio.to_thread(_do_clone)
    except Exception as e:
        print(f"[Firebase Clone Error] {e}")
        return url

async def upload_image_to_firebase(base64_data: str, path: str) -> str:
    """base64 이미지를 Firebase Storage에 업로드하고 공개 URL을 반환합니다.
    실패 시 원본 base64를 그대로 반환합니다 (폴백).
    """
    import base64 as _b64, time as _time, urllib.parse as _urlparse
    try:
        from firebase_admin import storage
        header, data = base64_data.split(',', 1)
        content_type = header.split(';')[0].split(':')[1]
        image_bytes = _b64.b64decode(data)
        ext = 'jpg' if 'jpeg' in content_type else 'png'

        def _upload():
            _bucket_name = "diveai-494805.firebasestorage.app"
            bucket = storage.bucket(_bucket_name)
            blob = bucket.blob(f"{path}_{int(_time.time())}.{ext}")
            blob.upload_from_string(image_bytes, content_type=content_type)
            # Firebase Security Rules가 적용되는 URL 형식 사용 (토큰 불필요)
            encoded_path = _urlparse.quote(blob.name, safe='')
            return f"https://firebasestorage.googleapis.com/v0/b/{_bucket_name}/o/{encoded_path}?alt=media"

        return await asyncio.to_thread(_upload)
    except Exception as e:
        print(f"[Firebase Image Upload Error] {e} — base64 폴백 사용")
        return base64_data


@app.post("/chat/generate-bgm")
async def generate_bgm_endpoint(request: BGMRequest, db: Session = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    topic = db.query(models.Topic).filter(models.Topic.id == request.topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    
    # 장르 및 현재 단계 정보 추출
    genre = topic.genre or "판타지"
    game_state = GameStateV2.from_dict(topic.game_state or {})
    
    # 클라이언트가 특정 단계를 요청했다면 그것을 사용, 아니면 현재 단계
    stage = request.target_stage or game_state.current_stage or "기"
    
    # BGM 프롬프트 자동 조립
    # 1. 콘텐츠 유형 및 고전 국가 정보 추출
    content_type = topic.content_type or "일반"
    country_context = ""
    if content_type == "고전" and topic.classic_country:
        country_context = f" based on traditional {topic.classic_country} style"
    
    # 2. 시나리오 배경 및 캐릭터 정보 추출
    character_name = topic.character_name or "Unknown Character"
    scenario_text = ""
    if topic.scenario and isinstance(topic.scenario, dict):
        scenario_text = topic.scenario.get(stage, "")

    # 3. 실시간 문맥 데이터 추출 (승, 전, 결 단계에서만 적용)
    realtime_context = ""
    if stage != "기":
        # 해당 단계의 대화만 추출 (stage_opening 메시지로 경계 감지)
        _all_msgs = (
            db.query(models.Message)
            .filter(models.Message.topic_id == topic.id)
            .order_by(models.Message.id.asc())
            .all()
        )
        _stage_order = ['기', '승', '전', '결']
        _target_idx = _stage_order.index(stage) if stage in _stage_order else 0
        _boundaries: dict = {}
        for _m in _all_msgs:
            try:
                _p = json.loads(_m.content) if isinstance(_m.content, str) and _m.content.startswith('{') else {}
                if _p.get('is_stage_opening') and _p.get('stage'):
                    _boundaries[_p['stage']] = _m.id
            except Exception:
                pass
        _start_id = _boundaries.get(stage)
        _next_stage = _stage_order[_target_idx + 1] if _target_idx + 1 < len(_stage_order) else None
        _end_id = _boundaries.get(_next_stage) if _next_stage else None
        _stage_msgs = [
            _m for _m in _all_msgs
            if (_start_id is None or _m.id >= _start_id)
            and (_end_id is None or _m.id < _end_id)
        ]
        recent_msgs = _stage_msgs[-10:] if len(_stage_msgs) > 10 else _stage_msgs
        chat_history_text = "\n".join([f"{m.role}: {m.content[:100]}" for m in recent_msgs])
        
        # 최신 요약 정보 추출
        latest_summary = (
            db.query(models.Summary)
            .filter(models.Summary.topic_id == topic.id)
            .order_by(models.Summary.id.desc())
            .first()
        )
        summary_text = latest_summary.content if latest_summary else "No summary available yet."
        
        realtime_context = (
            f"\n\n[Current Real-time Context]\n"
            f"Story Summary: {summary_text}\n"
            f"Recent Dialogue Flow:\n{chat_history_text}"
        )

    # 4. 단계별 분위기 가이드
    stage_moods = {
        "기": "peaceful, introductory, curious, ambient",
        "승": "rising tension, adventurous, developing, melodic",
        "전": "climax, intense, dramatic, high tension, emotional",
        "결": "resolution, emotional, calm, reflective, ending theme"
    }
    mood = stage_moods.get(stage, "ambient")
    
    # 5. 최종 프롬프트 조립 (Pro 모델 맞춤형 서사 중심 프롬프트)
    prompt = (
        f"A 180-second (3-minute) instrumental soundtrack for a {content_type} ({genre}){country_context}. "
        f"Atmosphere: {mood}. "
        f"Context: The story follows '{character_name}'. {scenario_text[:100]}... "
        f"{realtime_context}"
        "\n\nThe music should have a complete emotional arc matching the atmosphere, "
        "and must be a full composition with a natural resolution, concluding with a final lingering note. "
        "No sudden cuts."
    )
    
    audio_data = await asyncio.to_thread(generate_bgm_lyria, prompt)
    if not audio_data:
        raise HTTPException(status_code=500, detail="BGM generation failed")

    # Base64 문자열을 Firebase Storage에 저장 (서버 용량 및 OOM 방지)
    import base64
    import time
    from firebase_admin import storage
    
    try:
        if audio_data.startswith('data:'):
            b64_str = audio_data.split(',')[1]
            audio_bytes = base64.b64decode(b64_str)

            # 고유 파일명 생성
            filename = f"bgm/topic_{topic.id}_{stage}_{int(time.time())}.mp3"
            
            # 비동기 처리를 위한 래퍼 함수 (메인 엔진 마비 방지)
            def _upload_to_firebase():
                import urllib.parse as _urlparse
                upload_start = time.time()
                print(f"[generate_bgm_endpoint] [3/3] Firebase 업로드 시작 (파일명: {filename})")
                _fb_bucket_name = "diveai-494805.firebasestorage.app"
                bucket = storage.bucket(_fb_bucket_name)
                _blob = bucket.blob(filename)
                _blob.upload_from_string(audio_bytes, content_type="audio/mpeg")
                _encoded = _urlparse.quote(filename, safe='')
                _url = f"https://firebasestorage.googleapis.com/v0/b/{_fb_bucket_name}/o/{_encoded}?alt=media"
                print(f"[generate_bgm_endpoint] 업로드 완료 (소요시간: {time.time() - upload_start:.2f}초)")
                return _url
            
            # 메인 스레드 차단 없이 백그라운드에서 업로드 실행
            audio_url = await asyncio.to_thread(_upload_to_firebase)
            
            # DB에 BGM URL 저장 (하위 호환성 유지)
            topic.bgm_url = audio_url
            
            # 단계별 BGM 목록(List) 저장 로직
            import copy
            current_data = copy.deepcopy(topic.bgm_urls) if topic.bgm_urls else {}
            
            # 만약 기존 데이터가 리스트가 아니라 문자열이라면 리스트로 변환 (마이그레이션)
            for s in ['기', '승', '전', '결']:
                if s in current_data and isinstance(current_data[s], str):
                    current_data[s] = [current_data[s]]
                elif s not in current_data:
                    current_data[s] = []
            
            # 새 곡 추가
            if stage not in current_data:
                current_data[stage] = []
            current_data[stage].append(audio_url)
            
            # 현재 활성화된 곡 정보 업데이트 (새로 만든 곡을 즉시 활성화)
            if 'active' not in current_data:
                current_data['active'] = {}
            current_data['active'][stage] = audio_url
            
            topic.bgm_urls = current_data
            log_feature_usage(db, request.topic_id, current_user_id, "BGM_GENERATE", BGM_DT_COST)
            db.commit()

            return {"audio_url": audio_url, "stage": stage, "bgm_urls": current_data}
        else:
            return {"audio_data": audio_data, "stage": stage} # Fallback
    except Exception as e:
        print(f"Firebase Storage BGM 저장 실패: {e}")
        return {"audio_data": audio_data, "stage": stage} # Fallback

class BGMSelectRequest(BaseModel):
    topic_id: int
    stage: str
    audio_url: str

class BGMRenameRequest(BaseModel):
    topic_id: int
    audio_url: str
    name: str

def _build_veo_prompt_direct(
    genre: str,
    content_type: str,
    worldview_text: str,
    setting_text: str,
    stage_text: str,
    tone_text: str,
    style_hint: str,
    camera_hint: str,
    ai_character: dict,
    user_character: dict,
) -> str:
    """캐릭터/세계관 정보를 직접 조합해 Veo 프롬프트를 생성합니다 (LLM 없음)."""
    _GENRE_EN = {
        "판타지": "fantasy world",
        "로맨스": "romantic atmosphere",
        "현대": "modern urban setting",
        "무협": "martial arts wuxia world",
        "SF": "science fiction futuristic world",
        "공포": "dark horror atmosphere",
        "미스터리": "mystery suspense",
        "역사": "historical period setting",
        "학원": "school campus setting",
        "드라마": "emotional drama",
        "액션": "action-packed scene",
    }
    parts = [style_hint, _GENRE_EN.get(genre, f"{genre} genre")]

    if setting_text:
        parts.append(setting_text[:150])
    elif worldview_text:
        parts.append(worldview_text[:150])

    if stage_text:
        parts.append(stage_text[:200])

    for char in [ai_character, user_character]:
        if not char:
            continue
        name       = char.get("name", "")
        age        = char.get("age", "")
        gender     = char.get("gender", "")
        appearance = char.get("appearance", "")
        if not (name or appearance):
            continue
        desc_parts = [name] if name else []
        if age:
            desc_parts.append(str(age))
        if gender:
            desc_parts.append(gender)
        prefix = f"({', '.join(desc_parts[1:])}) " if len(desc_parts) > 1 else ""
        char_str = f"{desc_parts[0]} {prefix}{appearance}".strip() if desc_parts else appearance
        parts.append(char_str[:150])

    parts.append(camera_hint)
    parts.append("No dialogue, no subtitles, no text overlay, no human voice. Cinematic, film grain, emotional storytelling, masterpiece quality.")

    return ". ".join(p.strip() for p in parts if p.strip())


@app.post("/topics/{topic_id}/cinematic")
async def generate_cinematic_endpoint(topic_id: int, db: Session = Depends(get_db), current_user_id: int = Depends(get_current_user_id)):
    """Veo 3.1 Fast로 기 단계 시네마틱 영상을 생성합니다."""
    import time as _time
    import httpx

    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)

    # 이미 생성된 영상이 있으면 바로 반환
    if topic.cinematic_url:
        return {"cinematic_url": topic.cinematic_url}

    # ── 메타 정보 수집 ──────────────────────────────────────────────────────────
    scenario  = topic.scenario or {}
    stage_text = scenario.get('기', '')[:300]
    genre = topic.genre or '판타지'
    content_type = topic.content_type or '소설'
    setting_text   = topic.setting or ''
    worldview_text = topic.worldview or ''
    tone_text      = topic.tone_preference or ''

    is_realistic = content_type in ["시리즈", "영화"]
    style_hint = (
        "high-end cinematic film, ultra-realistic 8K"
        if is_realistic
        else "Korean webtoon manhwa illustration style, vivid color palette, dramatic"
    )

    _tone_camera_map = {
        "로맨틱": "warm golden lighting, slow zoom-in, soft focus, tender romantic mood",
        "달달":   "warm golden lighting, slow zoom-in, soft focus, tender romantic mood",
        "긴장":   "cold blue lighting, handheld camera shake, tense suspenseful atmosphere",
        "스릴러": "cold blue lighting, handheld camera shake, tense suspenseful atmosphere",
        "판타지": "epic wide establishing shot, sweeping crane camera, awe-inspiring magical atmosphere",
        "모험":   "epic wide establishing shot, sweeping crane camera, awe-inspiring adventurous atmosphere",
        "슬픔":   "desaturated cool tones, slow dolly pull-back, melancholic sorrowful mood",
        "코미디": "bright warm lighting, playful medium shot, lighthearted cheerful mood",
    }
    camera_hint = "dramatic lighting, slow dolly shot, emotional depth"
    for key, val in _tone_camera_map.items():
        if key in (tone_text or ''):
            camera_hint = val
            break

    # ── 캐릭터 정보 직접 조합으로 Veo 프롬프트 생성 ─────────────────────────────
    prompt = _build_veo_prompt_direct(
        genre, content_type, worldview_text, setting_text, stage_text, tone_text,
        style_hint, camera_hint,
        topic.ai_character or {},
        topic.user_character or {},
    )
    print(f"[Cinematic] 직접 빌드 프롬프트 (앞 150자): {prompt[:150]}")

    # reference 이미지: 시리즈/영화는 실사 얼굴 → safety 정책 차단 → 사용 안 함
    ref_b64 = None
    if not is_realistic and topic.cover_image and topic.cover_image.startswith("http"):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(topic.cover_image)
                if r.status_code == 200:
                    import base64 as _b64
                    ref_b64 = "data:image/png;base64," + _b64.b64encode(r.content).decode()
        except Exception as e:
            print(f"[Cinematic] 표지 이미지 다운로드 실패 (무시): {e}")

    # ── 영상 생성 (동기 → 스레드) ──────────────────────────────────────────────
    from ai_engine import _RAIImageFilteredError

    async def _fetch_image_b64(url: str) -> Optional[str]:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(url)
                if r.status_code == 200:
                    import base64 as _b64
                    return "data:image/png;base64," + _b64.b64encode(r.content).decode()
        except Exception as e:
            print(f"[Cinematic] 이미지 다운로드 실패 (무시): {e}")
        return None

    print(f"[Cinematic] 영상 생성 시작. topic_id={topic_id}, prompt 길이={len(prompt)}, ref_img={'있음' if ref_b64 else '없음'}")
    try:
        gcs_uri = await asyncio.to_thread(generate_cinematic_video, prompt, ref_b64)
        print(f"[Cinematic] 영상 생성 완료: {gcs_uri}")
    except _RAIImageFilteredError:
        # stripped_prompt: 시나리오 장면 제외, 세계관+캐릭터 외형만 포함
        _char_descs = []
        for _char in [topic.ai_character or {}, topic.user_character or {}]:
            _age        = _char.get("age", "")
            _gender     = _char.get("gender", "")
            _appearance = _char.get("appearance", "")
            if _appearance:
                _meta = ", ".join(str(x) for x in [_age, _gender] if x)
                _char_descs.append(f"({_meta}) {_appearance}".strip() if _meta else _appearance)
        _char_desc_str = ". ".join(c[:120] for c in _char_descs) if _char_descs else ""
        stripped_prompt = " ".join(filter(None, [
            f"{style_hint}, {genre} genre.",
            (setting_text or worldview_text or "")[:150],
            _char_desc_str,
            f"{camera_hint}.",
            "No dialogue, no subtitles, no text overlay, no human voice. Cinematic, film grain, emotional storytelling, masterpiece quality.",
        ]))

        # 2차 시도: 캐릭터 이미지로 재시도 (AI 캐릭터 우선, 없으면 유저 캐릭터)
        char_ref_b64 = None
        char_img_url = (
            (topic.ai_character or {}).get('image')
            or (topic.user_character or {}).get('image')
        )
        if char_img_url and char_img_url.startswith("http"):
            print(f"[Cinematic] 2차 시도: 캐릭터 이미지로 재시도")
            char_ref_b64 = await _fetch_image_b64(char_img_url)

        try:
            gcs_uri = await asyncio.to_thread(generate_cinematic_video, prompt, char_ref_b64)
            print(f"[Cinematic] 2차 시도 성공: {gcs_uri}")
        except (_RAIImageFilteredError, ValueError) as e2:
            # 3차 시도: 시나리오 장면 제외한 stripped_prompt, 이미지 없음
            print(f"[Cinematic] 3차 시도 (stripped_prompt, 이미지 없음)")
            try:
                gcs_uri = await asyncio.to_thread(generate_cinematic_video, stripped_prompt, None)
                print(f"[Cinematic] 3차 시도 성공: {gcs_uri}")
            except Exception as e3:
                import traceback; traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"영상 생성 실패 (3차 시도): {e3}")
        except Exception as e2:
            import traceback; traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"영상 생성 실패 (2차 시도): {e2}")
    except ValueError as e:
        if "[RAI_FILTERED]" in str(e):
            # 이미지 없이 1차 시도했는데 텍스트도 필터된 경우 → stripped_prompt
            _char_descs = []
            for _char in [topic.ai_character or {}, topic.user_character or {}]:
                _age        = _char.get("age", "")
                _gender     = _char.get("gender", "")
                _appearance = _char.get("appearance", "")
                if _appearance:
                    _meta = ", ".join(str(x) for x in [_age, _gender] if x)
                    _char_descs.append(f"({_meta}) {_appearance}".strip() if _meta else _appearance)
            _char_desc_str = ". ".join(c[:120] for c in _char_descs) if _char_descs else ""
            stripped_prompt = " ".join(filter(None, [
                f"{style_hint}, {genre} genre.",
                (setting_text or worldview_text or "")[:150],
                _char_desc_str,
                f"{camera_hint}.",
                "No dialogue, no subtitles, no text overlay, no human voice. Cinematic, film grain, emotional storytelling, masterpiece quality.",
            ]))
            print(f"[Cinematic] 3차 시도 (stripped_prompt)")
            try:
                gcs_uri = await asyncio.to_thread(generate_cinematic_video, stripped_prompt, None)
                print(f"[Cinematic] 3차 시도 성공: {gcs_uri}")
            except Exception as e2:
                import traceback; traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"영상 생성 실패 (3차 시도): {e2}")
        else:
            import traceback; traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"영상 생성 실패: {e}")
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"영상 생성 실패: {e}")

    # ── GCS → Firebase Storage REST URL (make_public() 대신 Security Rules 활용) ──
    print(f"[Cinematic] Firebase URL 변환 중: {gcs_uri}")
    try:
        import urllib.parse as _urlparse
        fb_bucket_name = "diveai-494805.firebasestorage.app"
        blob_path = gcs_uri.replace(f"gs://{fb_bucket_name}/", "")
        encoded_path = _urlparse.quote(blob_path, safe='')
        video_url = f"https://firebasestorage.googleapis.com/v0/b/{fb_bucket_name}/o/{encoded_path}?alt=media"
        print(f"[Cinematic] 공개 URL: {video_url}")
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"영상 URL 생성 실패: {e}")

    # ── DB 저장 (보관함에도 추가) ───────────────────────────────────────────────
    archive = list(topic.cinematic_urls or [])
    if video_url not in archive:
        archive.append(video_url)
    topic.cinematic_url = video_url
    topic.cinematic_urls = archive
    log_feature_usage(db, topic_id, current_user_id, "CINEMATIC_VIDEO", CINEMATIC_DT_COST)
    db.commit()

    return {"cinematic_url": video_url, "cinematic_urls": archive}


@app.delete("/topics/{topic_id}/cinematic")
async def delete_cinematic_endpoint(topic_id: int, db: Session = Depends(get_db)):
    """현재 활성 시네마틱 영상을 Firebase에서 삭제하고 보관함에서도 제거합니다."""
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    if topic.cinematic_url:
        delete_firebase_file(topic.cinematic_url)
        archive = list(topic.cinematic_urls or [])
        if topic.cinematic_url in archive:
            archive.remove(topic.cinematic_url)
        topic.cinematic_urls = archive
    topic.cinematic_url = None
    db.commit()
    return {"ok": True}


@app.post("/topics/{topic_id}/cinematic/archive-current")
async def archive_current_cinematic(topic_id: int, db: Session = Depends(get_db)):
    """현재 시네마틱 영상을 보관함에 보존하고 활성 URL만 해제합니다 (Firebase 파일 유지)."""
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    archive = list(topic.cinematic_urls or [])
    if topic.cinematic_url and topic.cinematic_url not in archive:
        archive.append(topic.cinematic_url)
    topic.cinematic_urls = archive
    topic.cinematic_url = None
    db.commit()
    return {"ok": True, "cinematic_urls": archive}


@app.get("/topics/{topic_id}/cinematic/archive")
async def get_cinematic_archive(topic_id: int, db: Session = Depends(get_db)):
    """시네마틱 영상 보관함 목록을 반환합니다."""
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    return {"cinematic_urls": list(topic.cinematic_urls or [])}


class CinematicSelectRequest(BaseModel):
    url: str

@app.post("/topics/{topic_id}/cinematic/select")
async def select_cinematic(topic_id: int, request: CinematicSelectRequest, db: Session = Depends(get_db)):
    """보관함에서 특정 영상을 현재 활성 시네마틱으로 선택합니다."""
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    archive = list(topic.cinematic_urls or [])
    if request.url not in archive:
        raise HTTPException(status_code=400, detail="보관함에 없는 URL입니다.")
    topic.cinematic_url = request.url
    db.commit()
    return {"cinematic_url": request.url}


class CinematicArchiveDeleteRequest(BaseModel):
    url: str

@app.delete("/topics/{topic_id}/cinematic/archive-item")
async def delete_cinematic_archive_item(topic_id: int, request: CinematicArchiveDeleteRequest, db: Session = Depends(get_db)):
    """보관함에서 특정 영상을 Firebase 포함 완전 삭제합니다."""
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)
    delete_firebase_file(request.url)
    archive = list(topic.cinematic_urls or [])
    if request.url in archive:
        archive.remove(request.url)
    topic.cinematic_urls = archive
    if topic.cinematic_url == request.url:
        topic.cinematic_url = archive[0] if archive else None
    db.commit()
    return {"ok": True, "cinematic_urls": archive}


@app.post("/chat/select-bgm")
async def select_bgm_endpoint(request: BGMSelectRequest, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == request.topic_id).first()
    if not topic: raise HTTPException(status_code=404)
    
    import copy
    current_data = copy.deepcopy(topic.bgm_urls) if topic.bgm_urls else {}
    if 'active' not in current_data: current_data['active'] = {}
    current_data['active'][request.stage] = request.audio_url
    
    # 하위 호환성을 위해 현재 단계의 곡이면 bgm_url도 업데이트
    game_state = GameStateV2.from_dict(topic.game_state or {})
    if request.stage == (game_state.current_stage or "기"):
        topic.bgm_url = request.audio_url

    topic.bgm_urls = current_data
    db.commit()
    return {"message": "BGM selected", "bgm_urls": current_data}

@app.post("/chat/delete-bgm")
async def delete_bgm_endpoint(request: BGMSelectRequest, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == request.topic_id).first()
    if not topic: raise HTTPException(status_code=404)
    
    import copy
    current_data = copy.deepcopy(topic.bgm_urls) if topic.bgm_urls else {}
    if request.stage in current_data and isinstance(current_data[request.stage], list):
        if request.audio_url in current_data[request.stage]:
            current_data[request.stage].remove(request.audio_url)

            # Firebase Storage에서 파일 삭제
            await asyncio.to_thread(delete_firebase_file, request.audio_url)

            # 삭제한 곡이 활성화된 곡이었다면 비워줌
            if current_data.get('active', {}).get(request.stage) == request.audio_url:
                current_data['active'][request.stage] = None
                # 하위 호환성 필드도 비워줌
                game_state = GameStateV2.from_dict(topic.game_state or {})
                if request.stage == (game_state.current_stage or "기"):
                    topic.bgm_url = None

            topic.bgm_urls = current_data
            db.commit()
            return {"message": "BGM deleted", "bgm_urls": current_data}

    return {"message": "BGM not found"}

@app.post("/chat/rename-bgm")
async def rename_bgm_endpoint(request: BGMRenameRequest, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    topic = db.query(models.Topic).filter(models.Topic.id == request.topic_id).first()
    if not topic: raise HTTPException(status_code=404)

    import copy
    current_data = copy.deepcopy(topic.bgm_urls) if topic.bgm_urls else {}
    if 'names' not in current_data:
        current_data['names'] = {}
    if request.name.strip():
        current_data['names'][request.audio_url] = request.name.strip()
    else:
        current_data['names'].pop(request.audio_url, None)

    topic.bgm_urls = current_data
    db.commit()
    return {"message": "BGM renamed", "bgm_urls": current_data}

# ---------------------------------------------------------------------------
# API — Chat Stream (SSE 스트리밍, REPLY/META 분리 형식)
# ---------------------------------------------------------------------------

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == request.topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)

    user_message = request.user_message.strip()

    # ── v2 라우팅: compass가 있는 토픽은 v2 엔진 사용 ──────────────────────────
    if topic.compass:
        return StreamingResponse(
            _chat_stream_v2(request, topic, user_message, db),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache"},
        )

    # ── 레거시: compass 없는 구형 토픽 (기존 LangChain 방식 유지) ───────────────
    current_persona_name = "여행자"
    persona_info = "일반적인 여행자"
    if topic.active_persona_id:
        p = db.query(models.Persona).filter(models.Persona.id == topic.active_persona_id).first()
        if p:
            current_persona_name = p.name
            persona_info = f"이름: {p.name}, 설정: {p.description}"

    summary_context = get_summary_context(topic.id, db)
    context_text = get_chat_context(
        f"{topic.original_title or ''} {user_message}",
        genre=topic.genre,
        category=topic.content_type,
    )

    system_prompt = build_streaming_prompt(
        character_name=request.character_name,
        current_persona_name=current_persona_name,
        persona_info=persona_info,
        topic=topic,
        summary_context=summary_context,
        context_text=context_text,
    )

    messages_list = [SystemMessage(content=system_prompt)]
    recent = (
        db.query(models.Message)
        .filter(models.Message.topic_id == topic.id, models.Message.is_active == True)
        .order_by(models.Message.created_at.desc())
        .limit(30).all()
    )
    for m in reversed(recent):
        if m.role == "user":
            messages_list.append(HumanMessage(content=m.content))
        else:
            try:
                cj = json.loads(m.content)
                reply = cj.get("reply", m.content)
                messages_list.append(AIMessage(content=reply))
            except:
                messages_list.append(AIMessage(content=m.content))
    
    # 재생성이 아닐 때만 현재 유저 메시지를 추가 (재생성 시에는 히스토리에 이미 포함됨)
    if not request.is_regeneration:
        messages_list.append(HumanMessage(content=user_message))

    topic_id = topic.id
    topic_affection = topic.affection
    topic_intimacy = topic.intimacy
    topic_output_length = topic.output_length or 4096

    async def generate_legacy():
        try:
            # Vertex AI로 통합
            llm = get_vertex_llm(request.model_selection)
            llm_with_limit = llm.bind(max_output_tokens=16384)

            buffer = ""
            reply_text = ""
            in_reply = False
            in_meta = False

            async for chunk in llm_with_limit.astream(messages_list):
                token = extract_ai_text(chunk.content) if chunk.content else ""
                if not token:
                    continue
                buffer += token

                if not in_reply and "===REPLY===" in buffer:
                    in_reply = True
                    buffer = buffer.split("===REPLY===", 1)[1]

                if in_reply and not in_meta:
                    if "===META===" in buffer:
                        parts = buffer.split("===META===", 1)
                        reply_chunk = parts[0]
                        if reply_chunk:
                            reply_text += reply_chunk
                            yield _sse({"type": "chunk", "content": reply_chunk})
                        in_meta = True
                        buffer = parts[1]
                    else:
                        reply_text += token
                        yield _sse({"type": "chunk", "content": token})
                elif in_meta:
                    pass

            meta = _parse_json_safe(buffer, {
                "situation": "대화 중",
                "stats": {"affection": topic_affection, "intimacy": topic_intimacy},
                "suggested_actions": [],
            })

            user_msg_id = None
            new_version = 1
            db2 = next(get_db())
            try:
                t = db2.query(models.Topic).filter(models.Topic.id == topic_id).first()
                if t:
                    if "stats" in meta:
                        t.affection = max(0, min(100, meta["stats"].get("affection", t.affection)))
                        t.intimacy = max(0, min(100, meta["stats"].get("intimacy", t.intimacy)))
                    full_data = {**meta, "reply": reply_text}
                    dt_cost = get_dt_price(request.model_selection)

                    # ── 버전 관리 로직 (Legacy) ──
                    parent_msg = db2.query(models.Message).filter(models.Message.topic_id == topic_id, models.Message.role == 'user').order_by(models.Message.created_at.desc()).first()

                    if request.is_regeneration and parent_msg:
                        user_msg_id = parent_msg.id
                        db2.query(models.Message).filter(models.Message.parent_id == user_msg_id).update({"is_active": False})
                        last_v_msg = db2.query(models.Message).filter(models.Message.parent_id == user_msg_id).order_by(models.Message.version.desc()).first()
                        new_version = ((last_v_msg.version or 1) if last_v_msg else 1) + 1
                    else:
                        user_msg_obj = models.Message(topic_id=topic_id, role="user", content=user_message)
                        db2.add(user_msg_obj)
                        db2.flush()
                        user_msg_id = user_msg_obj.id

                    assistant_msg = models.Message(
                        topic_id=topic_id, role="assistant", 
                        content=json.dumps(full_data, ensure_ascii=False),
                        parent_id=user_msg_id,
                        version=new_version,
                        is_active=True,
                        model_name=request.model_selection,
                        spent_dt=dt_cost
                    )
                    db2.add(assistant_msg)
                    
                    # 유저 토큰 잔액 차감
                    user_record = db2.query(models.User).filter(models.User.id == t.user_id).first()
                    if user_record:
                        user_record.token_balance = (user_record.token_balance or 0) - dt_cost
                    await check_and_auto_summarize(topic_id, db2, t)
                    db2.commit()
                    db2.refresh(assistant_msg)
                    meta["user_message_id"] = user_msg_id
                    meta["message_id"] = assistant_msg.id
                    meta["version"] = new_version
            finally:
                db2.close()

            yield _sse({"type": "done", "meta": {
                **meta,
                "spent_dt": dt_cost,
                "model_name": request.model_selection,
                "version": new_version
            }})

        except Exception as e:
            traceback.print_exc()
            yield _sse({"type": "error", "message": str(e)})

    return StreamingResponse(generate_legacy(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


async def _chat_stream_v2(request: ChatRequest, topic, user_message: str, db: Session):
    """v2 채팅 스트림 제너레이터 — compass + GameStateV2 기반."""
    user_message = user_message.strip() or "(계속 진행해줘)"
    topic_id = topic.id
    compass = topic.compass
    ai_character = topic.ai_character or {}
    user_character = topic.user_character or {}
    lorebook_entries = topic.lorebook_entries or []
    genre = topic.genre or '판타지'
    category = topic.content_type or '소설'
    classic_country = topic.classic_country

    # DB에서 현재 game_state 로드
    game_state = GameStateV2.from_dict(topic.game_state or {})

    # 최근 메시지 히스토리 (최대 30개, 활성 버전만)
    recent_msgs = (
        db.query(models.Message)
        .filter(models.Message.topic_id == topic_id, models.Message.is_active == True)
        .order_by(models.Message.created_at.desc())
        .limit(30).all()
    )
    # 오래된 것 먼저 정렬
    recent_msgs = list(reversed(recent_msgs))

    # LLM에 넣을 대화 히스토리
    chat_history = []
    for m in recent_msgs:
        if m.role == "user":
            content = m.content.strip()
            if content:
                chat_history.append({"role": "user", "content": content})
        else:
            try:
                cj = json.loads(m.content)
                reply = cj.get("reply", m.content)
            except Exception:
                reply = m.content
            if reply and reply.strip():
                chat_history.append({"role": "assistant", "content": reply.strip()})

    # 재생성 시 마지막 assistant 메시지 제거 (비활성화 전이라 히스토리에 포함됨)
    if request.is_regeneration and chat_history and chat_history[-1]["role"] == "assistant":
        chat_history = chat_history[:-1]

    # 조연 캐릭터 이름 목록 (로어북 강제 주입용)
    supporting_names = [
        n['name'] for n in (topic.relationship_graph or {}).get('nodes', [])
        if n.get('type') == 'supporting'
    ]

    # 로어북 컨텍스트 (키워드 매칭 + 조연 강제 주입)
    lorebook_ctx = get_lorebook_context(
        recent_messages=chat_history[-10:],
        lorebook_entries=lorebook_entries,
        forced_keywords=supporting_names,
    )

    # perceived_relationships 초기화 (없으면 생성)
    perceived_relationships = topic.perceived_relationships
    if perceived_relationships is None:
        supp_init = {}
        for char in (topic.supporting_cast or []):
            char_name = char.get('name', '')
            if char_name:
                supp_init[char_name] = {'status': 'unknown', 'known_facts': []}
        perceived_relationships = {
            'supporting': supp_init,
            'user_character': {
                'status': '시나리오 초기 관계',
                'known_facts': [],
                'revealed_traits': [],
            },
        }

    auto_advance = request.auto_advance
    model_sel  = request.model_selection or "gemini-3.1-flash-lite-preview-vertex"
    is_gpt     = model_sel.lower().startswith("gpt")
    is_claude  = model_sel.lower().startswith("claude")
    is_vertex  = "vertex" in model_sel.lower() and not is_claude

    # ── 자동 진행: 유저 행동/대사 별도 생성 후 SSE 전송 ─────────────────
    if auto_advance:
        import re as _re
        _ua_name = user_character.get('name', '유저 캐릭터')
        _ai_name = ai_character.get('name', 'AI 캐릭터')

        # 채팅 히스토리를 통째로 주면 LLM이 "이름 | 대사" 포맷을 그대로 따라 씀.
        # 마지막 AI 대사(대화 부분만)를 뽑아서 단순 프롬프트로 전달.
        _last_ai_raw = next(
            (m["content"] for m in reversed(chat_history) if m["role"] == "assistant"), ""
        )
        _speech_match = _re.search(r'.{1,20}\s*\|\s*(.+?)(?:\n|$)', _last_ai_raw)
        _ai_speech = _speech_match.group(1).strip() if _speech_match else _last_ai_raw[:200].strip()

        _ua_prompt = (
            f"인터랙티브 소설에서 '{_ua_name}'의 다음 행동이나 대사를 1~2문장으로 써줘.\n"
            f"상황: {_ai_name}이(가) 방금 이렇게 말했다 — \"{_ai_speech}\"\n\n"
            f"[규칙] 3인칭 산문체. '{_ai_name}' 이름 포함 금지. "
            f"'이름 | 대사' 형식 금지. 오직 {_ua_name}의 행동/대사만 출력."
        )

        _ua_text = ""
        try:
            if is_gpt:
                _ua_result = await asyncio.to_thread(
                    _v2.client.chat.completions.create,
                    model=model_sel,
                    messages=[{"role": "user", "content": _ua_prompt}],
                    temperature=0.8,
                    max_completion_tokens=150,
                )
                _ua_text = (_ua_result.choices[0].message.content or '').strip()
            elif is_claude:
                _claude = _get_anthropic_vertex_client()
                _ua_result = await asyncio.to_thread(
                    _claude.messages.create,
                    model=CLAUDE_SONNET_MODEL,
                    max_tokens=150,
                    temperature=0.8,
                    messages=[{"role": "user", "content": _ua_prompt}],
                )
                _ua_text = (_ua_result.content[0].text or '').strip()
            else:
                from langchain_core.messages import HumanMessage as _LCH
                # 모든 Gemini 요청은 Vertex AI로 통합됨 (get_llm/get_vertex_llm)
                _ua_llm = get_vertex_llm(model_sel.replace("-vertex", "").strip())
                _ua_res = await _ua_llm.with_config(max_tokens=150).ainvoke(
                    [_LCH(content=_ua_prompt)]
                )
                _ua_text = extract_ai_text(_ua_res.content).strip()

            # 필터: "이름 | 대사" 포맷 / 지시문 유출 / 너무 길거나 여러 줄
            _is_bad = any(p in _ua_text for p in [
                _ai_name, "이름 |", "작성하세요", "당신은", "캐릭터입니다", "규칙", "형식"
            ]) if _ua_text else True
            if _re.search(r'.{1,20}\s*\|', _ua_text):
                _is_bad = True
            if len(_ua_text) > 250 or _ua_text.count('\n') > 3:
                _is_bad = True

            # 좋은 출력이면 그대로, 나쁜 출력이면 유저 캐릭터 이름을 넣은 자연스러운 행동으로 대체
            user_message = _ua_text if (not _is_bad and _ua_text) else f"{_ua_name}은 그 말을 듣고 잠시 멈추었다."
            yield _sse({"type": "user_action", "content": user_message})

        except Exception as e:
            print(f"[Auto Advance Error] {e}")
            yield _sse({"type": "user_action", "content": f"{_ua_name}은 그 말을 듣고 잠시 멈추었다."})

    # 시스템 프롬프트 빌드
    system_prompt = build_chat_system_prompt(
        compass=compass,
        game_state=game_state,
        ai_character=ai_character,
        user_character=user_character,
        genre=genre,
        lorebook_context=lorebook_ctx,
        user_notes=topic.user_notes or '',
        tone_preference=topic.tone_preference or None,
        dice_roll=request.dice_roll,
        relationship_graph=topic.relationship_graph,
        perceived_relationships=perceived_relationships,
        supporting_cast=topic.supporting_cast or [],
    )

    if auto_advance:
        system_prompt += "\n\n[자동 진행 중] 최근 대화 흐름을 참고하여 서사를 자연스럽게 이어갈 것. 등장 인물들을 상황에 맞게 활용해 장면을 풍성하게 구성할 것."

    if request.guidance:
        _ai_name = ai_character.get('name', 'AI 캐릭터') if isinstance(ai_character, dict) else 'AI 캐릭터'
        system_prompt += (
            f"\n\n[⚠️ OOC 연출 지시 — 스토리 외부에서 플레이어가 보낸 메타 지시입니다]"
            f"\n이 지시는 유저 캐릭터의 대사나 행동이 아닙니다. 절대 유저 캐릭터가 이 내용을 말하거나 행동한 것으로 해석하지 마세요."
            f"\n당신({_ai_name})이 생성할 다음 응답에 아래 방향성을 자연스럽게 녹여내세요:"
            f"\n→ {request.guidance}"
        )

    # OpenAI 메시지 구성 (최근 20턴만 컨텍스트로)
    messages = [{"role": "system", "content": system_prompt}]
    messages += chat_history[-20:]
    
    # 재생성이 아닐 때만 현재 유저 메시지를 추가 (재생성 시에는 히스토리에 이미 포함됨)
    if not request.is_regeneration:
        messages.append({"role": "user", "content": user_message})

    try:
        output_tokens = 0
        input_tokens = 0
        if is_gpt:
            # GPT 경로 (OpenAI)
            result = await asyncio.to_thread(
                _v2.client.chat.completions.create,
                model=model_sel,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.8,
                max_completion_tokens=topic.output_length or 4096,
            )
            raw = result.choices[0].message.content
            if result.usage:
                output_tokens = result.usage.completion_tokens or 0
                input_tokens = result.usage.prompt_tokens or 0
        elif is_claude:
            # Claude 경로 (Anthropic Vertex AI) — Prompt Caching 적용
            _claude = _get_anthropic_vertex_client()
            _claude_sys = messages[0]["content"] if messages and messages[0]["role"] == "system" else ""
            _claude_msgs = [m for m in messages if m["role"] != "system"]
            _claude_result = await asyncio.to_thread(
                _claude.messages.create,
                model=CLAUDE_SONNET_MODEL,
                max_tokens=topic.output_length or 4096,
                temperature=0.8,
                system=[
                    {"type": "text", "text": _claude_sys, "cache_control": {"type": "ephemeral"}}
                ] if _claude_sys else [],
                messages=_claude_msgs,
            )
            raw = _claude_result.content[0].text
            if _claude_result.usage:
                input_tokens  = _claude_result.usage.input_tokens or 0
                output_tokens = _claude_result.usage.output_tokens or 0
        else:
            # Gemini 경로 (LangChain) — Vertex AI 또는 Google AI Studio
            from langchain_core.messages import SystemMessage as LCSystem, HumanMessage as LCHuman, AIMessage as LCAi
            lc_msgs = []
            for msg in messages:
                role, content = msg["role"], msg["content"]
                if role == "system":
                    lc_msgs.append(LCSystem(content=content))
                elif role == "user":
                    lc_msgs.append(LCHuman(content=content))
                else:
                    lc_msgs.append(LCAi(content=content))
            else:
                # 모든 Gemini 요청은 Vertex AI로 통합됨
                vertex_model = model_sel.replace("-vertex", "").strip()
                llm_v2 = get_vertex_llm(vertex_model)
                # Gemini 1.5+ 모델의 경우 JSON 모드 명시적 활성화
                llm_v2 = llm_v2.bind(response_mime_type="application/json", max_output_tokens=16384)
            res = await llm_v2.ainvoke(lc_msgs)
            raw = extract_ai_text(res.content)
            try:
                um = res.usage_metadata
                if um:
                    _get = lambda k: (um.get(k, 0) if isinstance(um, dict) else getattr(um, k, 0)) or 0
                    output_tokens = _get("output_tokens")
                    input_tokens = _get("input_tokens")
            except Exception:
                pass

        # 호감도 100 달성 감지 (parse 전 스냅샷)
        affinity_before = game_state.affinity

        # 응답 파싱 + game_state 업데이트
        parsed = parse_chat_response(raw, game_state)
        response_text = parsed['response']
        trigger_branch = parsed['trigger_branch']
        trigger_ending = parsed['trigger_ending']
        affinity_delta = parsed['affinity_delta']

        # 추천 답변 긍정/부정 선택 시 고정 delta 적용 (AI 판단 무시, 단계 무관 ±5)
        if request.reply_type in ('긍정', '부정'):
            _fixed = 10 if request.reply_type == '긍정' else -10
            game_state.affinity = max(-100, min(100, game_state.affinity - affinity_delta + _fixed))
            affinity_delta = _fixed
        supporting_dialogue = parsed.get('supporting_dialogue', [])

        # perceived_relationships 업데이트 (이번 턴에 AI가 새로 알게 된 사실 반영)
        perceived_updates = parsed.get('perceived_updates', [])
        if perceived_updates and perceived_relationships is not None:
            import copy as _copy
            perceived_relationships = _copy.deepcopy(perceived_relationships)
            for upd in perceived_updates:
                char = upd.get('character', '')
                char_type = upd.get('character_type', 'supporting')
                fact = upd.get('known_fact', '')
                new_status = upd.get('new_status')
                if not char:
                    continue
                if char_type == 'supporting':
                    supp = perceived_relationships.setdefault('supporting', {})
                    if char not in supp:
                        supp[char] = {'status': 'unknown', 'known_facts': []}
                    if fact:
                        supp[char]['known_facts'].append(fact)
                    if new_status:
                        supp[char]['status'] = new_status
                elif char_type == 'user_character':
                    uc = perceived_relationships.setdefault('user_character', {'status': '알 수 없음', 'known_facts': [], 'revealed_traits': []})
                    if fact:
                        uc['known_facts'].append(fact)
                    if new_status:
                        uc['status'] = new_status

        # 호감도 100 달성 여부 (이번 턴에 처음 도달, 이미 특전 이미지가 없을 때만)
        db_check = next(get_db())
        try:
            t_check = db_check.query(models.Topic).filter(models.Topic.id == topic_id).first()
            already_has_affinity_reward = bool(t_check and t_check.affinity_max_scene)
        finally:
            db_check.close()
        affinity_just_maxed = (
            affinity_before < 100
            and game_state.affinity >= 100
            and not already_has_affinity_reward
        )

        # ── 이탈 감지: 3턴 연속 off_track이면 compass 재생성 ─────────────
        if game_state.off_track_count >= OFF_TRACK_THRESHOLD:
            full_history = chat_history + [
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": response_text},
            ]
            compass = await asyncio.to_thread(
                regenerate_compass,
                compass, game_state, full_history,
                ai_character, user_character, genre,
            )
            # 업데이트된 compass DB 저장
            db_temp = next(get_db())
            try:
                t_temp = db_temp.query(models.Topic).filter(models.Topic.id == topic_id).first()
                if t_temp:
                    t_temp.compass = compass
                    db_temp.commit()
            finally:
                db_temp.close()

        # 응답 텍스트 스트리밍 (문장 단위)
        sentences = re.split(r'(?<=[.!?。！？\n])', response_text)
        for sent in sentences:
            if sent:
                yield _sse({"type": "chunk", "content": sent})
                await asyncio.sleep(0.03)

        # ── 단계 전환 처리 ────────────────────────────────────────────────
        old_stage = game_state.current_stage
        stage_opening = None
        updated_graph = None
        if trigger_branch and not game_state.is_final_stage():
            next_stage = game_state.next_stage_name()
            if next_stage:
                yield _sse({"type": "stage_transition", "stage": next_stage})
                stage_opening = await asyncio.to_thread(
                    generate_next_stage,
                    next_stage, user_message, compass,
                    game_state, ai_character, user_character, genre,
                )
                game_state.advance_stage()
                # 단계 전환 시 관계도 자동 업데이트
                db_prev = next(get_db())
                try:
                    t_prev = db_prev.query(models.Topic).filter(models.Topic.id == topic_id).first()
                    prev_graph = t_prev.relationship_graph if t_prev else None
                finally:
                    db_prev.close()
                recent_msgs = (
                    db.query(models.Message)
                    .filter(models.Message.topic_id == topic_id)
                    .order_by(models.Message.created_at.desc())
                    .limit(10)
                    .all()
                )
                recent_text = "".join(
                    f"{m.role}: {m.content}\n"
                    for m in reversed(recent_msgs)
                    if not isinstance(m.content, str) or not m.content.startswith('{')
                )
                updated_graph = await asyncio.to_thread(
                    generate_relationship_graph,
                    ai_character, user_character,
                    topic.supporting_cast,
                    compass,
                    game_state.current_stage,
                    game_state.conversation_summary,
                    prev_graph,
                    recent_text,
                )

        # ── 엔딩 처리 ────────────────────────────────────────────────────
        ending = None
        just_entered_final = stage_opening is not None and game_state.current_stage == '결'
        if trigger_ending and game_state.is_final_stage() and not just_entered_final and not game_state.is_ended:
            ending = await asyncio.to_thread(
                generate_ending_scene,
                game_state, compass, ai_character, user_character, genre, category,
            )
            game_state.is_ended = True

        # ── 호감도 100 특전 씬 텍스트 생성 ──────────────────────────────
        affinity_max_scene_text = None
        if affinity_just_maxed:
            affinity_max_scene_text = await asyncio.to_thread(
                generate_affinity_max_scene,
                game_state, compass, ai_character, user_character, genre,
            )

        # ── 힌트 카드 ────────────────────────────────────────────────────
        hint_card = None
        if trigger_branch or trigger_ending:
            hint_card = await asyncio.to_thread(
                generate_hint_card,
                game_state, compass, response_text,
            )

        # ── 대화 요약 갱신 (10턴마다) ────────────────────────────────────
        history_for_summary = chat_history + [
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": response_text},
        ]
        await asyncio.to_thread(
            update_summary_if_needed,
            history_for_summary, game_state, compass,
        )

        # ── DB 저장 ───────────────────────────────────────────────────────
        affinity_as_0_100 = max(0, min(100, (game_state.affinity + 100) // 2))

        message_id = None
        user_message_id = None
        new_version = 1
        
        db2 = next(get_db())
        try:
            t = db2.query(models.Topic).filter(models.Topic.id == topic_id).first()
            if t:
                t.game_state = game_state.to_dict()
                t.affection = affinity_as_0_100
                if updated_graph:
                    t.relationship_graph = updated_graph
                t.perceived_relationships = perceived_relationships

                # 마지막 유저 메시지 찾기
                parent_msg = db2.query(models.Message).filter(
                    models.Message.topic_id == topic_id, 
                    models.Message.role == 'user'
                ).order_by(models.Message.created_at.desc()).first()

                if request.is_regeneration and parent_msg:
                    user_message_id = parent_msg.id
                    db2.query(models.Message).filter(models.Message.parent_id == user_message_id).update({"is_active": False})
                    last_v_msg = db2.query(models.Message).filter(models.Message.parent_id == user_message_id).order_by(models.Message.version.desc()).first()
                    new_version = ((last_v_msg.version or 1) if last_v_msg else 1) + 1
                else:
                    user_msg_obj = models.Message(topic_id=topic_id, role="user", content=user_message)
                    db2.add(user_msg_obj)
                    db2.flush()
                    user_message_id = user_msg_obj.id
                    new_version = 1

                ai_msg_data = {"reply": response_text, "affinity_delta": affinity_delta}
                dt_cost = get_dt_price(request.model_selection)
                
                assistant_msg = models.Message(
                    topic_id=topic_id, role="assistant",
                    content=json.dumps(ai_msg_data, ensure_ascii=False),
                    output_tokens=output_tokens,
                    parent_id=user_message_id,
                    version=new_version,
                    is_active=True,
                    model_name=request.model_selection,
                    spent_dt=dt_cost
                )
                db2.add(assistant_msg)

                # 유저 토큰 잔액 차감
                user_record = db2.query(models.User).filter(models.User.id == t.user_id).first()
                if user_record:
                    user_record.token_balance = (user_record.token_balance or 0) - dt_cost

                # 조연 대사 메시지 저장
                supporting_msgs_data = []
                for sd in supporting_dialogue:
                    sd_name = sd.get('name', '')
                    sd_text = sd.get('text', '')
                    if sd_name and sd_text:
                        sd_msg = models.Message(
                            topic_id=topic_id,
                            role='assistant',
                            content=json.dumps({'reply': sd_text, 'is_supporting': True, 'speaker_name': sd_name}, ensure_ascii=False),
                            speaker_name=sd_name,
                            is_active=True,
                            parent_id=user_message_id,
                            version=new_version,
                        )
                        db2.add(sd_msg)
                        db2.flush()
                        supporting_msgs_data.append({'name': sd_name, 'text': sd_text, 'message_id': sd_msg.id})

                # 단계 전환 오프닝을 별도 메시지로 저장
                if stage_opening:
                    db2.add(models.Message(
                        topic_id=topic_id, role="assistant",
                        content=json.dumps(
                            {"reply": stage_opening, "is_stage_opening": True,
                             "stage": game_state.current_stage},
                            ensure_ascii=False,
                        ),
                        is_active=True
                    ))
                # 엔딩을 별도 메시지로 저장
                if ending:
                    db2.add(models.Message(
                        topic_id=topic_id, role="assistant",
                        content=json.dumps(
                            {"reply": ending.get("scene", ""), "is_ending": True,
                             "ending_type": ending.get("type", ""),
                             "ending_affinity": ending.get("affinity", 0)},
                            ensure_ascii=False,
                        ),
                        is_active=True
                    ))
                # 호감도 100 특전 씬 텍스트 저장
                if affinity_max_scene_text:
                    t.affinity_max_scene = affinity_max_scene_text
                db2.commit()
                db2.refresh(assistant_msg)
                message_id = assistant_msg.id
        finally:
            db2.close()

        # ── summaries 탭 자동 저장 (단계 전환 시) ──────────────────────────
        db_sum = next(get_db())
        try:
            t_sum = db_sum.query(models.Topic).filter(models.Topic.id == topic_id).first()
            if t_sum:
                await check_and_auto_summarize(
                    topic_id, db_sum, t_sum,
                    stage_changed=(old_stage != game_state.current_stage),
                )
        finally:
            db_sum.close()

        # ── 속마음 자동 갱신 (단계 전환 시) ──────────────────────────────────
        db_it = next(get_db())
        new_inner_thoughts = None
        try:
            t_it = db_it.query(models.Topic).filter(models.Topic.id == topic_id).first()
            if t_it:
                new_inner_thoughts = await check_and_auto_inner_thought(
                    topic_id, db_it, t_it,
                    stage_changed=(old_stage != game_state.current_stage),
                )
        finally:
            db_it.close()

        # ── done 이벤트 ──────────────────────────────────────────────────
        meta = {
            "message_id": message_id,
            "user_message_id": user_message_id,
            "version": new_version,
            "spent_dt": dt_cost,
            "model_name": request.model_selection,
            "affinity_delta": affinity_delta,
            "affinity": game_state.affinity,
            "supporting_messages": supporting_msgs_data,
            "affinity_max_scene": affinity_max_scene_text,
            "stage": game_state.current_stage,
            "stage_changed": old_stage != game_state.current_stage,
            "stage_opening": stage_opening,
            "hint_card": hint_card,
            "trigger_ending": trigger_ending,
            "ending": ending,
            "relationship_graph": updated_graph,
            "output_tokens": output_tokens,
            "input_tokens": input_tokens,
            "inner_thoughts": new_inner_thoughts,
        }
        yield _sse({"type": "done", "meta": meta})

        # ── 엔딩 이미지 생성 (done 이후 비동기, 15~30s) ──────────────────
        if ending:
            try:
                yield _sse({"type": "ending_image_loading"})
                ending_img_raw = await _generate_image_with_retry(
                    generate_ending_image,
                    content_type=category,
                    genre=genre,
                    ending_scene=ending.get('scene', ''),
                    ai_char=ai_character or {},
                    user_char=user_character or {},
                    classic_country=classic_country,
                )
                if ending_img_raw:
                    import time as _time
                    ending_img_url = await upload_image_to_firebase(
                        ending_img_raw,
                        f"images/ending/topic_{topic_id}_ending_{int(_time.time())}",
                    )
                    db_end = next(get_db())
                    ending_urls_to_send = [ending_img_url]
                    try:
                        t_end = db_end.query(models.Topic).filter(models.Topic.id == topic_id).first()
                        if t_end:
                            t_end.ending_image = ending_img_url
                            existing = t_end.ending_images or []
                            new_ending_list = existing + [ending_img_url]
                            t_end.ending_images = new_ending_list
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(t_end, "ending_images")
                            db_end.commit()
                            ending_urls_to_send = new_ending_list
                    finally:
                        db_end.close()
                    yield _sse({"type": "ending_image", "url": ending_img_url, "urls": ending_urls_to_send})
            except Exception as e_img:
                print(f"[Ending Image] 생성 실패: {e_img}")

        # ── 호감도 100 특전 이미지 생성 (done 이후 비동기) ───────────────
        if affinity_just_maxed and affinity_max_scene_text:
            try:
                yield _sse({"type": "affinity_image_loading"})
                affinity_img_raw = await _generate_image_with_retry(
                    generate_ending_image,
                    content_type=category,
                    genre=genre,
                    ending_type='해피',
                    ending_scene=affinity_max_scene_text,
                    ai_char=ai_character or {},
                    user_char=user_character or {},
                    classic_country=classic_country,
                )
                if affinity_img_raw:
                    import time as _time
                    affinity_img_url = await upload_image_to_firebase(
                        affinity_img_raw,
                        f"images/affinity/topic_{topic_id}_affinity_{int(_time.time())}",
                    )
                    db_aff = next(get_db())
                    affinity_urls_to_send = [affinity_img_url]
                    try:
                        t_aff = db_aff.query(models.Topic).filter(models.Topic.id == topic_id).first()
                        if t_aff:
                            t_aff.affinity_image = affinity_img_url
                            existing_aff = t_aff.affinity_images or []
                            new_aff_list = existing_aff + [affinity_img_url]
                            t_aff.affinity_images = new_aff_list
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(t_aff, "affinity_images")
                            db_aff.commit()
                            affinity_urls_to_send = new_aff_list
                    finally:
                        db_aff.close()
                    yield _sse({"type": "affinity_image", "url": affinity_img_url, "urls": affinity_urls_to_send})
            except Exception as e_aff:
                print(f"[Affinity Image] 생성 실패: {e_aff}")

    except Exception as e:
        traceback.print_exc()
        yield _sse({"type": "error", "message": str(e)})


# ---------------------------------------------------------------------------
# API — 빌더 파이프라인 (백그라운드 잡 방식)
# ---------------------------------------------------------------------------

async def _run_builder_background(job_id: str, request: "BuilderRequest", user_id: int):
    """백그라운드 시나리오 생성. 진행상황을 BuilderJob DB 레코드에 기록."""
    db = SessionLocal()

    def _update_job(**kwargs):
        try:
            job = db.query(models.BuilderJob).filter(models.BuilderJob.id == job_id).first()
            if job:
                for k, v in kwargs.items():
                    setattr(job, k, v)
                job.updated_at = _dt.datetime.utcnow()
                db.commit()
        except Exception as _e:
            print(f"[BuilderJob] DB update error: {_e}")

    def _is_cancelled() -> bool:
        try:
            job = db.query(models.BuilderJob).filter(models.BuilderJob.id == job_id).first()
            return not job or job.status == "cancelled"
        except Exception:
            return False

    try:
        if _is_cancelled():
            return

        def _char_for_pipeline(char_input, default_ai: bool):
            flags = char_input.ai_flags.model_dump()
            result = {}
            for field in ["name", "personality", "appearance", "background", "gender", "age"]:
                val = getattr(char_input, field, "") or ""
                is_ai = flags.get(field, default_ai)
                if val and not is_ai:
                    result[field] = val
            return result or None

        ai_char_input  = _char_for_pipeline(request.ai_character,  default_ai=True)
        user_char_input = _char_for_pipeline(request.user_character, default_ai=False)

        category = request.content_type if request.content_type != "고전" else "시리즈"
        user_query = None if request.material_by_ai else (request.material.strip() or None)
        ai_generated = not user_query
        recent_names: list = []
        recent_queries: list = []

        # Step 1: 소재 분석
        _update_job(current_step=1, step_message="소재 분석 중...")
        if _is_cancelled(): return

        recent_topics = (
            db.query(models.Topic)
            .filter(
                models.Topic.user_id == user_id,
                models.Topic.original_title != None,
                models.Topic.original_title != "",
            )
            .order_by(models.Topic.id.desc())
            .limit(5)
            .all()
        )
        recent_queries = list({t.original_title for t in recent_topics if t.original_title})[:5]
        for t in recent_topics:
            if t.ai_character and t.ai_character.get("name"):
                recent_names.append(t.ai_character["name"])
            if t.user_character and t.user_character.get("name"):
                recent_names.append(t.user_character["name"])

        if not user_query:
            user_query = await asyncio.to_thread(
                generate_query_auto,
                request.genre, category,
                ai_char_input,
                user_char_input,
                recent_queries or None,
            )

        # Step 2: 시나리오 작성
        _update_job(current_step=2, step_message="시나리오 작성 중...")
        if _is_cancelled(): return

        scenario_text = await asyncio.to_thread(
            generate_scenario_with_rag,
            user_query,
            request.genre,
            category,
            ai_char_input,
            user_char_input,
            request.classic_country,
            None,
            recent_names if ai_generated else None,
            recent_queries if ai_generated else None,
        )
        scenario_dict = parse_scenario_to_dict(scenario_text)
        scenario_title_generated = await asyncio.to_thread(
            generate_scenario_title,
            user_query or "",
            request.genre,
            scenario_dict.get('기', ''),
            (ai_char_input or {}).get('name', ''),
            request.content_type,
        )

        _ai_name_given   = (ai_char_input   or {}).get("name", "")
        _user_name_given = (user_char_input or {}).get("name", "")
        if not _ai_name_given or not _user_name_given:
            _extracted = await asyncio.to_thread(
                extract_character_names_from_scenario,
                scenario_text,
                _ai_name_given,
                _user_name_given,
            )
            if not _ai_name_given and _extracted.get("ai_name"):
                ai_char_input = {**(ai_char_input or {}), "name": _extracted["ai_name"]}
            if not _user_name_given and _extracted.get("user_name"):
                user_char_input = {**(user_char_input or {}), "name": _extracted["user_name"]}

        # Step 3: 캐릭터 설계
        _update_job(current_step=3, step_message="캐릭터 설계 중...")
        if _is_cancelled(): return

        characters = await asyncio.to_thread(
            generate_characters,
            scenario_text,
            request.genre,
            category,
            ai_char_input,
            user_char_input,
            request.classic_country,
            recent_names if ai_generated else None,
        )
        ai_char   = characters.get("ai_character", {})
        user_char = characters.get("user_character", {})

        _update_job(current_step=3, step_message="캐릭터 이미지 생성 중...")
        if _is_cancelled(): return

        scenario_summary = scenario_dict.get('기', '')[:300]
        ai_img = await _generate_image_with_retry(
            generate_character_image,
            request.content_type,
            ai_char.get('gender', ''),
            ai_char.get('age', ''),
            ai_char.get('appearance', ''),
            scenario_summary,
            ai_char.get('name', ''),
            request.classic_country,
            777,
        )
        ai_img_b64 = ai_img
        if ai_img:
            ai_char['image'] = await upload_image_to_firebase(
                ai_img, f"images/ai_character/topic_new_ai"
            )

        await asyncio.sleep(30)
        if _is_cancelled(): return

        user_img = await _generate_image_with_retry(
            generate_character_image,
            request.content_type,
            user_char.get('gender', ''),
            user_char.get('age', ''),
            user_char.get('appearance', ''),
            scenario_summary,
            user_char.get('name', ''),
            request.classic_country,
            888,
        )
        user_img_b64 = user_img
        if user_img:
            user_char['image'] = await upload_image_to_firebase(
                user_img, f"images/user_character/topic_new_user"
            )
        print(f"[Image Debug] ai_char has image: {'image' in ai_char}, url={str(ai_char.get('image',''))[:60]}")
        print(f"[Image Debug] user_char has image: {'image' in user_char}, url={str(user_char.get('image',''))[:60]}")

        # Step 4: 표지 이미지
        _update_job(current_step=4, step_message="시나리오 관계 분석 중...")
        if _is_cancelled(): return

        composition_prompt = await asyncio.to_thread(
            analyze_relationship_for_composition,
            scenario_text=scenario_text,
            ai_name=ai_char.get('name', '상대'),
            user_name=user_char.get('name', '나'),
            genre=request.genre,
            content_type=request.content_type or "소설"
        )

        await asyncio.sleep(30)
        if _is_cancelled(): return

        _update_job(current_step=4, step_message="시나리오 표지 생성 중...")
        cover_img_raw = await _generate_image_with_retry(
            generate_cover_image,
            request.content_type,
            composition_prompt,
            ai_char,
            user_char,
            ai_img_b64,
            user_img_b64,
            request.classic_country,
            999,
        )
        cover_img = None
        if cover_img_raw:
            cover_img = await upload_image_to_firebase(
                cover_img_raw, f"images/cover/topic_new_cover"
            )
        background_images: dict = {}

        supporting_cast = [
            {
                "name":        c.get("name", ""),
                "role":        c.get("role", ""),
                "gender":      c.get("gender", ""),
                "age":         c.get("age", ""),
                "personality": c.get("personality", ""),
                "appearance":  c.get("appearance", ""),
                "background":  c.get("background", ""),
                "importance":  c.get("importance", "보조"),
            }
            for c in characters.get("supporting_characters", [])
        ]

        intro_display = await asyncio.to_thread(
            generate_intro_display,
            scenario_dict.get('기', ''),
            request.genre,
            ai_char.get('name', ''),
            user_char.get('name', ''),
        )

        _update_job(current_step=4, step_message="나침반 생성 중...")
        if _is_cancelled(): return

        compass = await asyncio.to_thread(
            generate_compass,
            scenario_text=scenario_text,
            genre=request.genre,
            category=category,
            ai_character=ai_char,
            user_character=user_char,
        )

        # Step 5: 로어북 & 관계도
        _update_job(current_step=5, step_message="세계관 로어북 구성 중...")
        if _is_cancelled(): return

        lorebook_entries = await asyncio.to_thread(
            extract_lorebook_entries,
            scenario_text=scenario_text,
            compass=compass,
            ai_character=ai_char,
            user_character=user_char,
            supporting_cast=supporting_cast,
        )
        lorebook_entries = [{ **e, "is_generated": True } for e in lorebook_entries]

        initial_graph = await asyncio.to_thread(
            generate_relationship_graph,
            ai_char,
            user_char,
            supporting_cast,
            compass,
            '기',
            '',
            None,
        )

        _update_job(current_step=5, step_message="인물 인지 관계 분석 중...")
        if _is_cancelled(): return

        scenario_ki_text = scenario_dict.get('기', '') or scenario_text[:2000]
        initial_perceived = await asyncio.to_thread(
            generate_initial_perceived_relationships,
            scenario_ki_text,
            initial_graph,
            ai_char,
            user_char,
            supporting_cast,
        )

        compass['_initial_lorebook_entries'] = lorebook_entries
        compass['_initial_relationship_graph'] = initial_graph
        compass['_initial_supporting_cast'] = supporting_cast

        # Topic DB 저장
        ai_char_name = ai_char.get("name", "AI 캐릭터")
        worldview = f"{request.content_type} / {request.genre}"
        if request.classic_country:
            worldview += f" / {request.classic_country}"

        initial_game_state = GameStateV2().to_dict()
        scenario_title = scenario_title_generated or f"{ai_char_name}와의 이야기"

        new_topic = models.Topic(
            user_id=user_id,
            character_name=ai_char_name,
            title=scenario_title,
            worldview=worldview,
            genre=request.genre,
            original_title=(user_query or ""),
            content_type=request.content_type,
            classic_country=request.classic_country,
            scenario=scenario_dict,
            intro_display=intro_display,
            ai_character=ai_char,
            user_character=user_char,
            supporting_cast=supporting_cast,
            affection=0,
            intimacy=0,
            compass=compass,
            game_state=initial_game_state,
            lorebook_entries=lorebook_entries,
            relationship_graph=initial_graph,
            cover_image=cover_img,
            background_images=background_images if background_images else None,
            perceived_relationships=initial_perceived,
        )
        db.add(new_topic)
        db.commit()
        db.refresh(new_topic)

        # Step 6: 완료
        result = {
            "topic_id":        new_topic.id,
            "title":           new_topic.title,
            "scenario":        scenario_dict,
            "intro_display":   intro_display,
            "ai_character":    ai_char,
            "user_character":  user_char,
            "supporting_cast": supporting_cast,
            "compass":         compass,
            "cover_image":     cover_img,
            "background_images": background_images if background_images else {},
        }
        # DT 차감 (시나리오 생성 성공 시)
        try:
            _user = db.query(models.User).filter(models.User.id == user_id).first()
            if _user:
                _user.token_balance = (_user.token_balance or 0) - SCENARIO_BUILD_COST
                db.add(models.Message(
                    topic_id=new_topic.id,
                    role='system',
                    content=f'Feature Used: SCENARIO_BUILD',
                    is_active=False,
                ))
                db.commit()
        except Exception:
            pass

        _update_job(status="done", current_step=6, step_message="완료!", result=result)

    except Exception as e:
        traceback.print_exc()
        _update_job(status="error", error_message=str(e))
    finally:
        db.close()


@app.post("/builder/run")
async def builder_run(request: BuilderRequest, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    import uuid as _uuid
    job_id = str(_uuid.uuid4())
    new_job = models.BuilderJob(
        id=job_id,
        user_id=current_user_id,
        status="running",
        current_step=0,
    )
    db.add(new_job)
    db.commit()
    asyncio.create_task(_run_builder_background(job_id, request, current_user_id))
    return {"job_id": job_id}


@app.get("/builder/jobs/{job_id}")
async def get_builder_job(job_id: str, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    job = db.query(models.BuilderJob).filter(
        models.BuilderJob.id == job_id,
        models.BuilderJob.user_id == current_user_id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "id": job.id,
        "status": job.status,
        "current_step": job.current_step,
        "step_message": job.step_message,
        "result": job.result,
        "error_message": job.error_message,
    }


@app.delete("/builder/jobs/{job_id}")
async def cancel_builder_job(job_id: str, current_user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    job = db.query(models.BuilderJob).filter(
        models.BuilderJob.id == job_id,
        models.BuilderJob.user_id == current_user_id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == "running":
        job.status = "cancelled"
        db.commit()
    return {"message": "Job cancelled"}


# ---------------------------------------------------------------------------
# (삭제됨: SSE 방식 builder — 백그라운드 잡 방식으로 교체됨)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# API — 토큰 사용량 추정
# ---------------------------------------------------------------------------

@app.get("/token-estimate/{topic_id}")
async def get_token_estimate(topic_id: int, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)

    def est(text: str) -> int:
        return max(0, int(len(text or "") / 2.5))

    # 실제 채팅과 동일한 방식으로 구성
    game_state = GameStateV2.from_dict(topic.game_state or {})
    compass = topic.compass or {}
    ai_character = topic.ai_character or {}
    user_character = topic.user_character or {}
    genre = topic.genre or "판타지"
    lorebook_entries = topic.lorebook_entries or []

    recent_msgs = (
        db.query(models.Message)
        .filter(models.Message.topic_id == topic.id)
        .order_by(models.Message.created_at.desc())
        .limit(40).all()
    )
    recent_msgs = list(reversed(recent_msgs))

    chat_history = []
    for m in recent_msgs:
        if m.role == "user":
            chat_history.append({"role": "user", "content": m.content})
        else:
            try:
                reply = json.loads(m.content).get("reply", m.content)
            except Exception:
                reply = m.content
            chat_history.append({"role": "assistant", "content": reply})

    lorebook_ctx = get_lorebook_context(
        recent_messages=chat_history[-10:],
        lorebook_entries=lorebook_entries,
    )

    system_prompt = build_chat_system_prompt(
        compass=compass,
        game_state=game_state,
        ai_character=ai_character,
        user_character=user_character,
        genre=genre,
        lorebook_context=lorebook_ctx,
        user_notes=topic.user_notes or '',
        tone_preference=topic.tone_preference or None,
        relationship_graph=topic.relationship_graph,
        perceived_relationships=topic.perceived_relationships,
    )

    summary = game_state.conversation_summary or ''
    history_text = ''.join(m["content"] for m in chat_history[-20:])

    system_tokens = est(system_prompt)
    summary_tokens = est(summary)
    history_tokens = est(history_text)

    from sqlalchemy import func
    total_output_tokens = db.query(
        func.sum(models.Message.output_tokens)
    ).filter(
        models.Message.topic_id == topic_id,
        models.Message.role == "assistant",
    ).scalar() or 0

    return {
        "system_tokens": system_tokens,
        "summary_tokens": summary_tokens,
        "history_tokens": history_tokens,
        "total_tokens": system_tokens + history_tokens,
        "total_output_tokens": total_output_tokens,
    }


# ---------------------------------------------------------------------------
# API — 채팅 오프닝 메시지 생성
# ---------------------------------------------------------------------------

@app.post("/topics/{topic_id}/opening")
async def generate_opening_message(topic_id: int, db: Session = Depends(get_db)):
    topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404)

    # 이미 메시지가 있으면 첫 번째 AI 메시지 반환 (빈 메시지면 재생성)
    existing_count = db.query(models.Message).filter(models.Message.topic_id == topic_id).count()
    if existing_count > 0:
        first_ai = (
            db.query(models.Message)
            .filter(models.Message.topic_id == topic_id, models.Message.role == "assistant")
            .order_by(models.Message.created_at.asc())
            .first()
        )
        if first_ai:
            try:
                parsed = json.loads(first_ai.content)
                reply = parsed.get("reply", first_ai.content) if isinstance(parsed, dict) else first_ai.content
            except Exception:
                reply = first_ai.content
            # 빈 메시지면 삭제 후 재생성
            if reply and reply.strip():
                return {"reply": reply}
            db.delete(first_ai)
            db.commit()
            existing_count = db.query(models.Message).filter(models.Message.topic_id == topic_id).count()

    ai_char = topic.ai_character or {}
    user_char = topic.user_character or {}
    ai_name = ai_char.get("name", "캐릭터")
    user_name = user_char.get("name", "당신")
    scenario_raw = topic.scenario or ""
    if isinstance(scenario_raw, dict):
        scenario_raw = json.dumps(scenario_raw, ensure_ascii=False)
    scenario = str(scenario_raw)[:600]
    genre = topic.genre or "판타지"

    ai_char_for_prompt = {k: v for k, v in ai_char.items() if k != "image"}
    prompt = (
        f"너는 {genre} 인터랙티브 스토리 작가야. 아래 정보를 바탕으로 채팅의 첫 오프닝 장면을 작성해.\n\n"
        f"[AI 캐릭터] {ai_name}: {json.dumps(ai_char_for_prompt, ensure_ascii=False)}\n"
        f"[유저 캐릭터] {user_name}\n"
        f"[시나리오 도입부]\n{scenario}\n\n"
        f"[작성 규칙]\n"
        f"1. 3인칭 소설 산문체로 배경과 {ai_name}의 등장 장면을 2~3문장으로 묘사한다. "
        f"계절감·날씨·장소·분위기를 구체적으로 담을 것.\n"
        f"2. 빈 줄로 단락을 구분한 뒤, \"{ai_name} | \" 형식으로 {ai_name}의 첫 대사를 쓴다. "
        f"대사는 따옴표 없이 {ai_name}의 말만 쓴다.\n"
        f"3. 빈 줄 뒤에 {ai_name}의 행동을 3인칭 산문체로 1~2문장 추가한다.\n"
        f"4. {user_name}의 내면·감정·과거·상태는 절대 묘사하지 말 것.\n"
        f"5. {user_name}의 대사나 행동은 쓰지 말 것.\n"
        f"6. 문체: 한다체(서술형)로 작성할 것. '~합니다', '~입니다', '~었습니다' 등 합쇼체 절대 금지. '~한다', '~됐다', '~이다' 형식 사용.\n"
        f"7. '그가', '그녀가', '그는', '그녀는' 등 대명사 대신 반드시 {ai_name} 이름을 사용할 것.\n\n"
        f"[출력 예시]\n"
        f"봄바람이 아직 서늘한 기운을 품고 불어오는 어느 한적한 골목. "
        f"낡은 철문이 삐걱 열리며 {ai_name}이 하품을 쩍 내밀며 걸어 나왔다.\n\n"
        f"{ai_name} | 어이구, 연락도 없이 벌써 도착했어?\n\n"
        f"{ai_name}은 주머니에서 손을 빼내어 {user_name}의 어깨를 툭툭 두드렸다."
    )

    try:
        reply = await asyncio.to_thread(
            vertex_complete,
            [{"role": "user", "content": prompt}],
            2000,
            0.7,
            False,
            MODEL_PRO,
        )
        reply = reply.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    db.add(models.Message(
        topic_id=topic_id,
        role="assistant",
        content=json.dumps({"reply": reply, "is_opening": True}, ensure_ascii=False),
    ))
    db.commit()
    return {"reply": reply}


# ---------------------------------------------------------------------------
# API — 시나리오 자동 생성 (기존 호환)
# ---------------------------------------------------------------------------

@app.post("/generate-scenario")
async def generate_scenario(request: ScenarioRequest):
    try:
        llm = _get_llm_or_raise("flash")
        prompt = f"{request.worldview} 배경의 스토리 도입부 상황을 1문장으로 제안해줘. 부연 설명 없이 상황만 대답해."
        res = llm.invoke([HumanMessage(content=prompt)])
        return {"scenario": extract_ai_text(res.content).strip()}
    except HTTPException:
        raise
    except Exception:
        return {"scenario": "어둠 속에서 당신의 이야기가 시작됩니다."}


@app.post("/messages/{topic_id}/versions/{parent_id}")
def switch_message_version(topic_id: int, parent_id: int, direction: str, db: Session = Depends(get_db)):
    all_msgs = db.query(models.Message).filter(
        models.Message.topic_id == topic_id,
        models.Message.parent_id == parent_id
    ).order_by(models.Message.version.asc()).all()

    if not all_msgs:
        raise HTTPException(status_code=404, detail="버전을 찾을 수 없습니다.")

    # version 번호 기준으로 그룹핑 (같은 version = 같은 턴의 메시지 묶음)
    from collections import defaultdict
    by_version: dict = defaultdict(list)
    for m in all_msgs:
        by_version[m.version or 1].append(m)

    sorted_versions = sorted(by_version.keys())

    # 현재 활성 version 번호 파악
    current_version = next(
        (v for v in sorted_versions if any(m.is_active for m in by_version[v])),
        sorted_versions[-1],
    )
    current_idx = sorted_versions.index(current_version)

    if direction == "prev":
        target_idx = (current_idx - 1) % len(sorted_versions)
    else:
        target_idx = (current_idx + 1) % len(sorted_versions)

    target_version = sorted_versions[target_idx]

    # 타겟 version 그룹 전체 활성화, 나머지 전체 비활성화
    for m in all_msgs:
        m.is_active = ((m.version or 1) == target_version)

    db.commit()
    return {"success": True, "new_version": target_version}


# ---------------------------------------------------------------------------
# 시나리오 배포 / 갤러리
# ---------------------------------------------------------------------------

@app.post("/topics/{topic_id}/publish")
async def publish_topic(
    topic_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    topic = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not topic:
        raise HTTPException(status_code=404, detail="시나리오를 찾을 수 없습니다.")
    if topic.imported_from_id:
        raise HTTPException(status_code=403, detail="갤러리에서 가져온 시나리오는 배포할 수 없습니다.")

    if topic.is_published:
        # 배포 취소
        topic.is_published = False
        topic.author_user_id = None
        topic.published_at = None
        db.commit()
        return {"is_published": False}
    else:
        # 배포
        if not topic.intro_display and topic.scenario:
            scenario_dict = topic.scenario if isinstance(topic.scenario, dict) else {}
            ai_name = (topic.ai_character or {}).get('name', '') if topic.ai_character else ''
            user_name = (topic.user_character or {}).get('name', '') if topic.user_character else ''
            try:
                topic.intro_display = await asyncio.to_thread(
                    generate_intro_display,
                    scenario_dict.get('기', ''),
                    topic.genre or '',
                    ai_name,
                    user_name,
                )
            except Exception:
                pass
        topic.is_published = True
        topic.author_user_id = current_user_id
        topic.published_at = _dt.datetime.utcnow()
        db.commit()
        return {"is_published": True}


@app.get("/scenarios/published")
async def get_published_scenarios(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user_id: Optional[int] = Depends(get_optional_user_id),
):
    rows = (
        db.query(models.Topic, models.User.name.label("author_name"))
        .join(models.User, models.Topic.author_user_id == models.User.id)
        .filter(models.Topic.is_published == True)
        .order_by(models.Topic.published_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    # 팔로잉 중인 author_id 집합
    following_ids: set = set()
    if current_user_id:
        following_rows = db.query(models.Following.author_id).filter(
            models.Following.follower_id == current_user_id
        ).all()
        following_ids = {r.author_id for r in following_rows}

    result = []
    for topic, author_name in rows:
        result.append({
            "id": topic.id,
            "title": topic.custom_name or topic.title or topic.original_title or "무제",
            "genre": topic.genre,
            "content_type": topic.content_type,
            "classic_country": topic.classic_country,
            "cover_image": topic.cover_image,
            "ai_character": topic.ai_character,
            "user_character": topic.user_character,
            "intro_display": topic.intro_display,
            "published_at": topic.published_at.isoformat() if topic.published_at else None,
            "author_name": author_name or "익명",
            "author_user_id": topic.author_user_id,
            "is_following": topic.author_user_id in following_ids,
            "story_length": (topic.game_state or {}).get('story_length', 'normal'),
        })
    return result


@app.post("/users/{author_id}/follow")
async def follow_author(
    author_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    if author_id == current_user_id:
        raise HTTPException(status_code=400, detail="자기 자신을 팔로우할 수 없습니다.")
    existing = db.query(models.Following).filter(
        models.Following.follower_id == current_user_id,
        models.Following.author_id == author_id,
    ).first()
    if not existing:
        db.add(models.Following(follower_id=current_user_id, author_id=author_id))
        db.commit()
    return {"is_following": True}


@app.delete("/users/{author_id}/follow")
async def unfollow_author(
    author_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    db.query(models.Following).filter(
        models.Following.follower_id == current_user_id,
        models.Following.author_id == author_id,
    ).delete()
    db.commit()
    return {"is_following": False}


@app.get("/users/following")
async def get_following_list(
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.Following, models.User.name.label("author_name"))
        .join(models.User, models.Following.author_id == models.User.id)
        .filter(models.Following.follower_id == current_user_id)
        .order_by(models.Following.created_at.desc())
        .all()
    )
    result = []
    for following, author_name in rows:
        # 해당 작가의 배포된 시나리오 수
        count = db.query(models.Topic).filter(
            models.Topic.author_user_id == following.author_id,
            models.Topic.is_published == True,
        ).count()
        result.append({
            "author_id": following.author_id,
            "author_name": author_name,
            "scenario_count": count,
            "followed_at": following.created_at.isoformat() if following.created_at else None,
        })
    return result


@app.get("/users/{author_id}/profile")
async def get_author_profile(
    author_id: int,
    current_user_id: Optional[int] = Depends(get_optional_user_id),
    db: Session = Depends(get_db),
):
    author = db.query(models.User).filter(models.User.id == author_id).first()
    if not author:
        raise HTTPException(status_code=404, detail="User not found")
    follower_count = db.query(models.Following).filter(models.Following.author_id == author_id).count()
    following_count = db.query(models.Following).filter(models.Following.follower_id == author_id).count()
    scenario_count = db.query(models.Topic).filter(
        models.Topic.author_user_id == author_id,
        models.Topic.is_published == True,
    ).count()
    is_self = current_user_id == author_id
    is_following = False
    if current_user_id and not is_self:
        is_following = db.query(models.Following).filter(
            models.Following.follower_id == current_user_id,
            models.Following.author_id == author_id,
        ).first() is not None
    return {
        "author_id": author_id,
        "author_name": author.name,
        "follower_count": follower_count,
        "following_count": following_count,
        "scenario_count": scenario_count,
        "is_following": is_following,
        "is_self": is_self,
    }


@app.get("/users/{author_id}/scenarios")
async def get_author_scenarios(
    author_id: int,
    db: Session = Depends(get_db),
):
    topics = db.query(models.Topic).filter(
        models.Topic.author_user_id == author_id,
        models.Topic.is_published == True,
    ).order_by(models.Topic.published_at.desc()).all()
    return [
        {
            "id": t.id,
            "title": t.custom_name or t.title or t.original_title or "무제",
            "genre": t.genre,
            "content_type": t.content_type,
            "classic_country": t.classic_country,
            "cover_image": t.cover_image,
            "ai_character": t.ai_character,
            "user_character": t.user_character,
            "intro_display": t.intro_display,
            "published_at": t.published_at.isoformat() if t.published_at else None,
        }
        for t in topics
    ]


class ImportRequest(BaseModel):
    story_length: str = 'normal'  # 'short' | 'normal' | 'long'

@app.post("/scenarios/{topic_id}/import")
async def import_scenario(
    topic_id: int,
    body: Optional[ImportRequest] = None,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    src = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.is_published == True,
    ).first()
    if not src:
        raise HTTPException(status_code=404, detail="배포된 시나리오를 찾을 수 없습니다.")

    import_story_length = (body.story_length if body and body.story_length in ('short', 'normal', 'long') else 'normal')
    _src_compass = src.compass or {}
    _init_lorebook = _src_compass.get('_initial_lorebook_entries', src.lorebook_entries)
    _init_graph = _src_compass.get('_initial_relationship_graph')  # 스냅샷 없으면 None (빈 상태로 시작)
    _init_cast = _src_compass.get('_initial_supporting_cast', src.supporting_cast)

    new_topic = models.Topic(
        user_id=current_user_id,
        title=src.title,
        original_title=src.original_title,
        custom_name=src.custom_name,
        genre=src.genre,
        content_type=src.content_type,
        classic_country=src.classic_country,
        worldview=src.worldview,
        scenario=src.scenario,
        intro_display=src.intro_display,
        ai_character=src.ai_character,
        user_character=src.user_character,
        supporting_cast=_init_cast,
        compass=src.compass,
        lorebook_entries=_init_lorebook,
        relationship_graph=_init_graph,
        cover_image=src.cover_image,
        character_name=src.character_name,
        output_length=src.output_length,
        game_state={
            "current_stage": "기",
            "stage_turn_count": 0,
            "total_turn_count": 0,
            "affinity": 0,
            "off_track_count": 0,
            "is_ended": False,
            "story_length": import_story_length,
        },
        affection=0,
        intimacy=0,
        is_published=False,
        author_user_id=None,
        imported_from_id=src.id,
    )
    db.add(new_topic)
    db.flush()  # commit 전에 ID 확보

    # 이미지 독립 복사 (원본 topic 삭제 시 영향 없도록, 후보 목록은 초기화)
    new_topic.cover_image = await clone_firebase_image_url(
        src.cover_image or '', "images/cover/topic_new_cover"
    )
    _ai = dict(new_topic.ai_character) if isinstance(new_topic.ai_character, dict) else {}
    if _ai.get('image'):
        _cloned_ai = await clone_firebase_image_url(_ai['image'], "images/ai_character/topic_new_ai")
        _ai['image'] = _cloned_ai
        _ai['images'] = [_cloned_ai]
        new_topic.ai_character = _ai
    _user = dict(new_topic.user_character) if isinstance(new_topic.user_character, dict) else {}
    if _user.get('image'):
        _cloned_user = await clone_firebase_image_url(_user['image'], "images/user_character/topic_new_user")
        _user['image'] = _cloned_user
        _user['images'] = [_cloned_user]
        new_topic.user_character = _user

    db.commit()
    db.refresh(new_topic)
    return {"topic_id": new_topic.id, "title": new_topic.custom_name or new_topic.title or "무제"}


class ReplayRequest(BaseModel):
    story_length: str = 'normal'  # 'short' | 'normal' | 'long'

@app.post("/topics/{topic_id}/replay")
async def replay_topic(
    topic_id: int,
    body: ReplayRequest,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    src = db.query(models.Topic).filter(
        models.Topic.id == topic_id,
        models.Topic.user_id == current_user_id,
    ).first()
    if not src:
        raise HTTPException(status_code=404, detail="토픽을 찾을 수 없습니다.")

    story_length = body.story_length if body.story_length in ('short', 'normal', 'long') else 'normal'
    base_title = src.custom_name or src.title or '무제'

    _src_compass = src.compass or {}
    _init_lorebook = _src_compass.get('_initial_lorebook_entries', src.lorebook_entries)
    _init_graph = _src_compass.get('_initial_relationship_graph')
    _init_cast = _src_compass.get('_initial_supporting_cast', src.supporting_cast)

    new_topic = models.Topic(
        user_id=current_user_id,
        title=src.title,
        original_title=src.original_title,
        custom_name=base_title,
        genre=src.genre,
        content_type=src.content_type,
        classic_country=src.classic_country,
        worldview=src.worldview,
        scenario=src.scenario,
        intro_display=src.intro_display,
        ai_character=src.ai_character,
        user_character=src.user_character,
        supporting_cast=_init_cast,
        compass=src.compass,
        lorebook_entries=_init_lorebook,
        relationship_graph=_init_graph,
        cover_image=src.cover_image,
        cover_images=src.cover_images,
        character_name=src.character_name,
        output_length=src.output_length,
        game_state={
            "current_stage": "기",
            "stage_turn_count": 0,
            "total_turn_count": 0,
            "affinity": 0,
            "off_track_count": 0,
            "is_ended": False,
            "story_length": story_length,
        },
        affection=0,
        intimacy=0,
        is_published=False,
        author_user_id=None,
        imported_from_id=src.imported_from_id or src.id,
    )
    db.add(new_topic)
    db.commit()
    db.refresh(new_topic)
    return {"topic_id": new_topic.id, "title": new_topic.custom_name}


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
