"""
prompt_builder.py - 시스템 프롬프트 생성

담당 역할:
  - /chat, /chat/stream 엔드포인트용 시스템 프롬프트 조립
  - /builder/run 엔드포인트용 시나리오·캐릭터 생성 프롬프트 조립
"""

# ---------------------------------------------------------------------------
# 내부 상수
# ---------------------------------------------------------------------------

_TONE_MAP = {
    "positive": "다정하고 호의적이게",
    "negative": "냉소적이고 부정적이게",
    "neutral":  "중립적이고 객관적이게",
}

_REASONING_MAP = {
    1: "직관적이고 빠르게 답변하세요.",
    2: "상황을 충분히 분석한 뒤 답변하세요.",
    3: "매우 깊게 추론하고 복잡한 복선이나 감정을 담아 답변하세요.",
}


# ---------------------------------------------------------------------------
# 챗 시스템 프롬프트 (기존 JSON 형식 — /chat 엔드포인트용)
# ---------------------------------------------------------------------------

def build_system_prompt(
    character_name: str,
    current_persona_name: str,
    persona_info: str,
    topic,
    summary_context: str,
    context_text: str,
) -> str:
    tone_inst = _TONE_MAP.get(topic.tone_preference, "중립적으로")
    reasoning_inst = _REASONING_MAP.get(topic.reasoning_level, "상황을 분석하여 답변하세요.")

    if topic.impersonation_enabled:
        impersonation_inst = (
            "유저가 직접 말하거나 행동하지 않았다면, "
            "유저의 페르소나에 맞춰 유저의 행동이나 짧은 대사를 대신 묘사해도 좋습니다."
        )
    else:
        impersonation_inst = "유저의 행동이나 대사를 절대로 대신 생성하지 마세요."

    ai_char = topic.ai_character or {}
    user_char = topic.user_character or {}
    scenario = topic.scenario or {}

    char_context = ""
    if ai_char:
        char_context += f"\n[AI 캐릭터 설정]\n이름: {ai_char.get('name','')}, 성격: {ai_char.get('personality','')}, 배경: {ai_char.get('background','')}"
    if scenario:
        char_context += f"\n[시나리오 나침반]\n기: {scenario.get('기','')[:100]}\n승: {scenario.get('승','')[:100]}"

    return f"""당신은 '{character_name}'입니다. 반드시 JSON으로만 답변하세요.
{char_context}

[현재 당신 앞에 있는 인물 (유저)]
- 이름: {current_persona_name}
- 상세 설정: {persona_info}

[인물 인지 및 관계 지침]
1. 오직 위에 명시된 '{current_persona_name}'의 설정에만 기반하여 반응하세요.
2. 대화 히스토리의 유저 이름이 '{current_persona_name}'과 다르면 새로운 인물로 인식하세요.
3. 페르소나가 바뀌었다면 이전 인물과의 친밀도, 약속을 모두 잊으세요.
4. 현재 인물의 직업, 성격, 배경에 어긋나는 반응을 절대 하지 마세요.

[당신(캐릭터) 성향] {tone_inst}
[추론 방식] {reasoning_inst}
[사칭 설정] {impersonation_inst}
[배경/장르] {topic.worldview or ''} / {topic.genre or ''}
[시작 설정] {topic.setting or ''}
[유저 노트(항상 기억)] {topic.user_notes or ''}
[과거 요약 기록] {summary_context}
[지식/참고] {context_text[:500]}

[JSON 구조] {{
    "situation": "현재 상황에 대한 3인칭 묘사",
    "reply": "캐릭터의 대사",
    "inner_thoughts": "캐릭터의 속마음",
    "stats": {{"affection": {topic.affection}, "intimacy": {topic.intimacy}}},
    "event": null,
    "suggested_actions": ["다음 행동 추천 1", "추천 2", "추천 3"],
    "character_update": "캐릭터가 현재 인물에 대해 새로 알게 된 사실 요약"
}}
유저가 ""를 써서 대화하면 대화로, 아니면 행동으로 인식하세요."""


# ---------------------------------------------------------------------------
# 스트리밍 챗 프롬프트 (REPLY/META 분리 형식 — /chat/stream 엔드포인트용)
# ---------------------------------------------------------------------------

def build_streaming_prompt(
    character_name: str,
    current_persona_name: str,
    persona_info: str,
    topic,
    summary_context: str,
    context_text: str,
) -> str:
    tone_inst = _TONE_MAP.get(topic.tone_preference, "중립적으로")
    reasoning_inst = _REASONING_MAP.get(topic.reasoning_level, "상황을 분석하여 답변하세요.")

    if topic.impersonation_enabled:
        impersonation_inst = "유저의 페르소나에 맞춰 행동을 대신 묘사해도 좋습니다."
    else:
        impersonation_inst = "유저의 행동이나 대사를 절대로 대신 생성하지 마세요."

    ai_char = topic.ai_character or {}
    scenario = topic.scenario or {}

    char_context = ""
    if ai_char:
        char_context += f"\n[AI 캐릭터 설정]\n이름: {ai_char.get('name','')}, 성격: {ai_char.get('personality','')}, 배경: {ai_char.get('background','')}"
    if scenario:
        char_context += f"\n[시나리오 나침반]\n기: {scenario.get('기','')[:100]}\n승: {scenario.get('승','')[:100]}"

    return f"""당신은 '{character_name}'입니다.
{char_context}

[현재 유저]
- 이름: {current_persona_name}
- 설정: {persona_info}

[성향] {tone_inst} / [추론] {reasoning_inst} / [사칭] {impersonation_inst}
[배경] {topic.worldview or ''} / {topic.genre or ''}
[유저 노트] {topic.user_notes or ''}
[과거 요약] {summary_context}
[참고] {context_text[:300]}

[출력 형식 — 반드시 이 형식으로만 출력]
===REPLY===
(캐릭터의 대사와 행동 묘사, 자연스러운 문장, 여러 줄 가능)
===META===
{{"situation":"현재 상황 3인칭 묘사","inner_thoughts":"속마음","stats":{{"affection":{topic.affection},"intimacy":{topic.intimacy}}},"event":null,"suggested_actions":["추천1","추천2","추천3"],"character_update":null}}

유저가 ""를 써서 대화하면 대화로, 아니면 행동으로 인식하세요."""


# ---------------------------------------------------------------------------
# 빌더 — 시나리오 생성 프롬프트
# ---------------------------------------------------------------------------

def build_scenario_prompt(content_type: str, genre: str, material: str, classic_country: str = "") -> str:
    country_line = f"- 고전 국가: {classic_country}" if classic_country else ""
    return f"""당신은 인터랙티브 스토리 시나리오 작가입니다.
아래 설정에 맞는 기승전결 시나리오를 JSON으로 작성하세요.
각 단계는 인터랙티브 챗에서 AI 캐릭터의 서사 나침반으로 사용됩니다.

[설정]
- 콘텐츠 유형: {content_type}
- 장르: {genre}
- 소재: {material}
{country_line}

[작성 지침]
- 기: 도입부 — 배경·인물 소개, 관계의 씨앗, 첫 만남 또는 재회 상황 (200~300자)
- 승: 발전부 — 갈등 발생, 감정 심화, 복선 삽입 (200~300자)
- 전: 절정부 — 갈등의 정점, 극적 반전, 관계의 전환점 (200~300자)
- 결: 결말 방향성 — 여러 엔딩 가능성 암시, 감정적 여운 (200~300자)

[출력 형식] JSON만 출력:
{{"기":"...", "승":"...", "전":"...", "결":"..."}}"""


# ---------------------------------------------------------------------------
# 빌더 — 캐릭터 생성 프롬프트
# ---------------------------------------------------------------------------

def build_character_prompt(scenario: dict, ai_char_input: dict, user_char_input: dict) -> str:
    def field_hint(label: str, val: str, ai_flag: bool) -> str:
        if val and not ai_flag:
            return f"{label}: {val} (유저 지정값 — 반드시 그대로 사용)"
        if val and ai_flag:
            return f"{label}: {val} (유저 입력 참고값 — AI가 보완 가능)"
        return f"{label}: AI가 시나리오에 맞게 자유 설정"

    ai_flags = ai_char_input.get("ai_flags", {})
    user_flags = user_char_input.get("ai_flags", {})

    ai_hints = "\n".join([
        field_hint("이름",  ai_char_input.get("name",""),  ai_flags.get("name", True)),
        field_hint("성격",  ai_char_input.get("personality",""), ai_flags.get("personality", True)),
        field_hint("외형",  ai_char_input.get("appearance",""), ai_flags.get("appearance", True)),
        field_hint("배경",  ai_char_input.get("background",""), ai_flags.get("background", True)),
    ])
    user_hints = "\n".join([
        field_hint("이름",  user_char_input.get("name",""),  user_flags.get("name", False)),
        field_hint("성격",  user_char_input.get("personality",""), user_flags.get("personality", False)),
        field_hint("외형",  user_char_input.get("appearance",""), user_flags.get("appearance", False)),
        field_hint("배경",  user_char_input.get("background",""), user_flags.get("background", False)),
    ])

    return f"""당신은 인터랙티브 스토리 캐릭터 설계자입니다.
시나리오에 맞는 등장인물을 JSON으로 설계하세요.

[시나리오]
기: {scenario.get('기','')[:200]}
승: {scenario.get('승','')[:200]}

[AI 캐릭터 제약]
{ai_hints}

[유저 캐릭터 제약]
{user_hints}

[작성 지침]
- role: "냉혹한 용병", "복수를 꿈꾸는 몰락 귀족" 등 서사적 역할을 자유 서술
- supporting_cast: 2~3명, 시나리오 흐름에 필요한 조연
- 유저 지정값(※ 반드시 그대로 사용 표기된 필드)은 절대 변경 금지

[출력 형식] JSON만 출력:
{{
  "ai_character": {{"name":"","role":"","personality":"","appearance":"","background":""}},
  "user_character": {{"name":"","role":"","personality":"","appearance":"","background":""}},
  "supporting_cast": [{{"name":"","role":"","background":"","importance":"주연/조연"}}]
}}"""
