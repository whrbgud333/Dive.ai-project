"""
memory.py - 챗봇 장기기억(요약) 관련 로직

담당 역할:
  - 대화 내용을 LLM으로 요약하고 DB에 저장 (summarize_chat)
  - 최근 요약 기록을 프롬프트용 문자열로 반환 (get_summary_context)
  - 10턴마다 자동 요약 트리거 확인 및 실행 (check_and_auto_summarize)

의존성:
  - ai_engine.get_vertex_llm()  → LLM 인스턴스 생성 (Vertex AI Flash 모델 사용)
  - ai_engine.extract_ai_text() → AI 응답 정규화
  - models.Summary, models.Topic, models.Message → DB 모델
"""

import traceback
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from langchain_core.messages import HumanMessage

import models
from ai_engine import get_vertex_llm, extract_ai_text, VERTEX_MODEL_FLASH_LITE


# ---------------------------------------------------------------------------
# 공개 함수: 요약 컨텍스트 조회
# ---------------------------------------------------------------------------

def get_summary_context(topic_id: int, db: Session, limit: int = 3) -> str:
    """
    DB에서 최근 요약 기록을 가져와 하나의 문자열로 반환합니다.

    Args:
        topic_id: 조회할 토픽 ID
        db:       SQLAlchemy 세션
        limit:    가져올 최대 요약 개수 (기본값 3)

    Returns:
        요약 텍스트를 줄바꿈으로 이어 붙인 문자열.
        요약이 없으면 빈 문자열 반환.
    """
    summaries = (
        db.query(models.Summary)
        .filter(models.Summary.topic_id == topic_id)
        .order_by(models.Summary.created_at.desc())
        .limit(limit)
        .all()
    )
    return "\n".join([s.content for s in reversed(summaries)])


# ---------------------------------------------------------------------------
# 공개 함수: 요약 생성 및 저장
# ---------------------------------------------------------------------------

async def summarize_chat(topic_id: int, db: Session, stage: Optional[str] = None) -> Optional[str]:
    """
    현재까지의 대화 전체를 LLM으로 요약하고 DB에 저장합니다.

    Args:
        topic_id: 요약할 토픽 ID
        db:       SQLAlchemy 세션

    Returns:
        생성된 요약 텍스트. 실패 시 None 반환.
    """
    try:
        topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
        if not topic:
            return None

        messages = (
            db.query(models.Message)
            .filter(models.Message.topic_id == topic_id)
            .order_by(models.Message.created_at.asc())
            .all()
        )
        if not messages:
            return None

        # 대화 내용 텍스트로 조합
        text_to_summarize = "".join(f"{m.role}: {m.content}\n" for m in messages)

        # Vertex AI 사용
        llm = get_vertex_llm(VERTEX_MODEL_FLASH_LITE)
        prompt = (
            "다음은 대화 내용입니다. "
            "주요 사건, 캐릭터의 상태, 유저의 행동 등을 핵심 위주로 요약해주세요.\n"
            "마크다운 문법(**굵게**, *기울임*, # 제목, - 목록 등)을 절대 사용하지 말고 "
            "일반 텍스트로만 작성하세요.\n\n"
            f"{text_to_summarize}"
        )
        res = llm.invoke([HumanMessage(content=prompt)])

        # AI 응답 정규화 (리스트 형태 대응) — ai_engine.extract_ai_text 사용
        summary_text = extract_ai_text(res.content)

        # DB 저장
        summary = models.Summary(topic_id=topic_id, content=summary_text, stage=stage)
        db.add(summary)
        topic.last_summary_turn = len(messages) // 2
        db.commit()

        print(f"[Memory] Topic {topic_id} 요약 완료 ({len(summary_text)}자)")
        return summary_text

    except Exception as e:
        print(f"[Memory] Summarization Error (topic_id={topic_id}): {e}")
        traceback.print_exc()
        return None


# ---------------------------------------------------------------------------
# 공개 함수: 자동 요약 트리거 확인 및 실행
# ---------------------------------------------------------------------------

async def check_and_auto_summarize(
    topic_id: int, db: Session, topic, current_turns: int = 0,
    stage_changed: bool = False,
) -> bool:
    """
    단계(기→승, 승→전, 전→결) 전환 시 자동으로 요약을 실행합니다.

    Args:
        topic_id:      대상 토픽 ID
        db:            SQLAlchemy 세션
        topic:         models.Topic 인스턴스
        current_turns: 미사용 (하위 호환 유지용)
        stage_changed: 이번 턴에 단계 전환이 발생했으면 True

    Returns:
        요약이 실행됐으면 True, 아니면 False.
    """
    if not stage_changed:
        return False

    _gs = topic.game_state if isinstance(topic.game_state, dict) else {}
    _stage = _gs.get('current_stage') or None
    await summarize_chat(topic_id, db, stage=_stage)
    return True

    return False


# ---------------------------------------------------------------------------
# 공개 함수: 캐릭터 속마음 생성
# ---------------------------------------------------------------------------

async def generate_inner_thought(
    topic_id: int, db: Session, target_name: Optional[str] = None
) -> Optional[dict]:
    """
    특정 캐릭터의 속마음을 생성하고 inner_thoughts 딕셔너리에 저장합니다.
    target_name이 None이면 AI 메인 캐릭터 대상.

    Returns:
        업데이트된 inner_thoughts dict (전체). 실패 시 None.
    """
    import json as _json
    try:
        topic = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
        if not topic:
            return None

        recent_msgs = (
            db.query(models.Message)
            .filter(models.Message.topic_id == topic_id)
            .order_by(models.Message.created_at.desc())
            .limit(10)
            .all()
        )
        if not recent_msgs:
            return None

        recent_msgs = list(reversed(recent_msgs))
        conv_lines = []
        for m in recent_msgs:
            if m.role == 'user':
                conv_lines.append(f"유저: {m.content}")
            else:
                try:
                    reply = _json.loads(m.content).get('reply', m.content)
                except Exception:
                    reply = m.content
                conv_lines.append(f"AI: {reply}")
        conv_text = '\n'.join(conv_lines)

        # 대상 캐릭터 결정
        ai_char = topic.ai_character or {}
        user_char = topic.user_character or {}
        supporting = topic.supporting_cast or []
        ai_name = ai_char.get('name', '')

        if target_name is None or target_name == ai_name:
            char_info = ai_char
            char_name = ai_name or 'AI 캐릭터'
            is_ai_char = True
        elif target_name == user_char.get('name'):
            char_info = user_char
            char_name = target_name
            is_ai_char = False
        else:
            char_info = next((c for c in supporting if c.get('name') == target_name), {})
            char_name = target_name
            is_ai_char = False

        char_personality = char_info.get('personality', '')

        # Vertex AI 사용
        llm = get_vertex_llm(VERTEX_MODEL_FLASH_LITE)
        prompt = (
            f"캐릭터 이름: {char_name}\n"
            f"성격: {char_personality}\n\n"
            f"[최근 대화]\n{conv_text}\n\n"
            f"위 대화를 바탕으로 지금 {char_name}이 속으로 느끼는 감정과 생각을 "
            f"1인칭 시점으로 2~3문장으로 써줘. "
            f"외부에 드러내지 않는 진짜 속마음만 담을 것. "
            f"출력 형식: 속마음 텍스트만, 따옴표나 설명 없이."
        )
        res = llm.invoke([HumanMessage(content=prompt)])
        thought_text = extract_ai_text(res.content).strip()

        # inner_thoughts dict 업데이트
        thoughts = dict(topic.inner_thoughts or {})
        thoughts[char_name] = thought_text
        topic.inner_thoughts = thoughts
        flag_modified(topic, 'inner_thoughts')

        # AI 메인 캐릭터면 레거시 필드도 함께 업데이트
        if is_ai_char:
            topic.inner_thought = thought_text
            topic.last_inner_thought_turn = (
                db.query(models.Message)
                .filter(models.Message.topic_id == topic_id)
                .count()
            ) // 2

        db.commit()

        print(f"[Memory] Topic {topic_id} {char_name} 속마음 갱신 완료")
        return thoughts

    except Exception as e:
        print(f"[Memory] InnerThought Error (topic_id={topic_id}): {e}")
        import traceback; traceback.print_exc()
        return None


async def check_and_auto_inner_thought(
    topic_id: int, db: Session, topic, current_turns: int = 0,
    stage_changed: bool = False,
) -> Optional[dict]:
    """단계 전환 시 AI, 유저, 조연 캐릭터의 속마음을 자동 갱신합니다. 갱신 시 전체 inner_thoughts dict 반환."""
    if not stage_changed:
        return None

    # 1. AI 메인 캐릭터 속마음 갱신
    res = await generate_inner_thought(topic_id, db, target_name=None)

    # 2. 유저 캐릭터 속마음 갱신
    user_char = topic.user_character or {}
    user_name = user_char.get('name')
    if user_name:
        res = await generate_inner_thought(topic_id, db, target_name=user_name)

    # 3. 모든 조연 캐릭터 속마음 갱신
    supporting_cast = topic.supporting_cast or []
    for char in supporting_cast:
        char_name = char.get('name')
        if char_name:
            res = await generate_inner_thought(topic_id, db, target_name=char_name)

    return res
