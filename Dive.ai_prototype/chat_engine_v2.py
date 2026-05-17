"""
chat_engine_v2.py — 동적 분기 채팅 엔진 v2
벡터DB.ipynb 섹션 11~13 구현체
"""

import json
import os
import re
from dataclasses import dataclass, field
from typing import Optional

from openai import OpenAI
from dotenv import load_dotenv
from ai_engine import vertex_complete, VERTEX_MODEL_FLASH_LITE, MODEL_PRO

load_dotenv()

_openai_key = os.environ.get("OPENAI_API_KEY")
client: Optional[OpenAI] = OpenAI(api_key=_openai_key) if _openai_key else None

# ──────────────────────────────────────────────────────────────────────────────
# GameStateV2
# ──────────────────────────────────────────────────────────────────────────────

STAGE_TURNS_BY_LENGTH: dict = {
    'short':  {'기': 4,  '승': 6,  '전': 5,  '결': 2},   # ~17턴
    'normal': {'기': 8,  '승': 13, '전': 9,  '결': 3},   # ~33턴
    'long':   {'기': 15, '승': 26, '전': 18, '결': 6},   # ~65턴
}
MIN_STAGE_TURNS: dict = STAGE_TURNS_BY_LENGTH['normal']  # 하위 호환용


@dataclass
class GameStateV2:
    current_stage: str = '기'
    stage_turn_count: int = 0
    total_turn_count: int = 0
    conversation_summary: str = ''
    affinity: int = 0
    off_track_count: int = 0
    is_ended: bool = False
    story_length: str = 'normal'

    _STAGES: list = field(default_factory=lambda: ['기', '승', '전', '결'], repr=False)

    def _min_turns(self) -> dict:
        return STAGE_TURNS_BY_LENGTH.get(self.story_length, STAGE_TURNS_BY_LENGTH['normal'])

    def advance_stage(self) -> bool:
        try:
            idx = self._STAGES.index(self.current_stage)
        except ValueError:
            return False
        if idx >= len(self._STAGES) - 1:
            return False
        self.current_stage = self._STAGES[idx + 1]
        self.stage_turn_count = 0
        return True

    def next_stage_name(self) -> Optional[str]:
        try:
            idx = self._STAGES.index(self.current_stage)
            if idx < len(self._STAGES) - 1:
                return self._STAGES[idx + 1]
        except ValueError:
            pass
        return None

    def is_final_stage(self) -> bool:
        return self.current_stage == '결'

    def min_turns_met(self) -> bool:
        return self.stage_turn_count >= self._min_turns().get(self.current_stage, 0)

    def turns_remaining(self) -> int:
        return max(0, self._min_turns().get(self.current_stage, 0) - self.stage_turn_count)

    def update_affinity(self, delta: int) -> None:
        self.affinity = max(-100, min(100, self.affinity + delta))

    def to_dict(self) -> dict:
        return {
            'current_stage': self.current_stage,
            'stage_turn_count': self.stage_turn_count,
            'total_turn_count': self.total_turn_count,
            'conversation_summary': self.conversation_summary,
            'affinity': self.affinity,
            'off_track_count': self.off_track_count,
            'is_ended': self.is_ended,
            'story_length': self.story_length,
        }

    @classmethod
    def from_dict(cls, d: dict) -> 'GameStateV2':
        return cls(
            current_stage=d.get('current_stage', '기'),
            stage_turn_count=d.get('stage_turn_count', 0),
            total_turn_count=d.get('total_turn_count', 0),
            conversation_summary=d.get('conversation_summary', ''),
            affinity=d.get('affinity', 0),
            off_track_count=d.get('off_track_count', 0),
            is_ended=d.get('is_ended', False),
            story_length=d.get('story_length', 'normal'),
        )

    def summary(self) -> str:
        remaining = self.turns_remaining()
        gate_str = f'(최소 {remaining}턴 더 필요)' if remaining > 0 else '(전환 가능)'
        return (
            f'단계: {self.current_stage} {gate_str} ({self.stage_turn_count}턴) | '
            f'전체: {self.total_turn_count}턴 | AI 호감도: {self.affinity:+d}'
        )


# ──────────────────────────────────────────────────────────────────────────────
# 나침반 생성
# ──────────────────────────────────────────────────────────────────────────────

def generate_compass(
    scenario_text: str,
    genre: str,
    category: str,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
) -> dict:
    system_prompt = (
        f'너는 인터랙티브 스토리의 서사 지휘관이야.\n'
        f'{genre} 장르 {category}의 기승전결 시나리오를 분석해서\n'
        f'채팅 AI가 대화 중 서사를 유지할 수 있도록 나침반 요약본을 JSON으로 생성해.\n\n'
        '[나침반 목적]\n'
        '채팅 AI는 기승전결 원문 대신 이 요약본만 보고 서사 일관성을 유지한다.\n'
        '총 300~500 토큰 이내로 압축할 것.\n\n'
        '[trigger_conditions 작성 규칙]\n'
        '단계 전환 트리거를 기→승, 승→전, 전→결 각각 1~2개씩 총 4~6개 작성.\n'
        '각 조건은 단일 발화나 행동이 아닌, 여러 턴에 걸쳐 누적된 관계·상황의 변화를 기준으로 할 것.\n'
        '캐릭터 이름 대신 반드시 "유저 캐릭터" / "AI 캐릭터" 표현만 사용할 것.\n'
        '형식: "[기→승] 조건 설명", "[승→전] 조건 설명", "[전→결] 조건 설명"\n'
        '각 조건은 이 시나리오의 핵심 갈등·복선을 직접 참조하여,'
        ' 채팅 LLM이 대화 중 명확하게 판단할 수 있을 만큼 구체적으로 서술할 것.\n\n'
        '[stage_constraints 작성 규칙]\n'
        '각 단계에 반드시 일어나야 하는 것과 절대 일어나면 안 되는 것을 함께 명시할 것.\n'
        '- 기: 관계의 시작·탐색 단계. 고백·이별·갈등 해소·마무리성 서술 절대 금지.\n'
        '- 승: 갈등 심화 단계. 결말 암시·감정 봉합·이별 서술 절대 금지.\n'
        '- 전: 갈등 절정 단계. 오프닝에서 반전·폭로를 한 번에 쏟지 말 것. 단계 초반 긴장감·복선으로 시작해 대화를 거치며 진실이 점진적으로 드러나고, 단계 후반부에 클라이맥스가 오도록 설계할 것. 해피엔딩·배드엔딩 등 결말성 서술 절대 금지. 분기점 제시만 허용.\n'
        '- 결: 선택 분기 상황만 제시. 결말은 유저에게 열어둘 것.\n\n'
        '출력은 아래 JSON 형식만 (ending_directions 포함하지 말 것):\n'
        '{\n'
        '  "conflict_core": "핵심 갈등 1~2문장",\n'
        '  "foreshadowing": ["복선1", "복선2"],\n'
        '  "narrative_goal": "서사 전체 목표 1문장",\n'
        '  "trigger_conditions": [\n'
        '    "[기→승] 조건1", "[승→전] 조건1", "[전→결] 조건1"\n'
        '  ],\n'
        '  "stage_constraints": {"기": "...", "승": "...", "전": "...", "결": "..."}\n'
        '}'
    )

    ai_name = (ai_character or {}).get('name', 'AI 캐릭터')
    ai_personality = (ai_character or {}).get('personality', '')
    ai_background = (ai_character or {}).get('background', '')
    user_name = (user_character or {}).get('name', '유저 캐릭터')
    user_personality = (user_character or {}).get('personality', '')
    user_background = (user_character or {}).get('background', '')

    char_info = (
        f'[등장인물]\n'
        f'- AI 캐릭터 ({ai_name}): 성격={ai_personality} / 배경={ai_background}\n'
        f'- 유저 캐릭터 ({user_name}): 성격={user_personality} / 배경={user_background}\n\n'
        f'[갈등 구조 작성 원칙]\n'
        f'conflict_core는 반드시 위 캐릭터들의 성격·배경·가치관에서 필연적으로 발생하는 갈등이어야 한다. '
        f'두 캐릭터를 다른 인물로 교체해도 어색하지 않을 만큼 일반적인 갈등은 금지. '
        f'이 캐릭터들만의 고유한 충돌 지점을 중심으로 서술할 것.\n'
        f'유저 캐릭터의 도덕적 입장과 서사적 역할은 소재·캐릭터 배경에서 도출하며, 사전에 고정하지 말 것.\n\n'
    )

    raw = vertex_complete(
        messages=[
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': f'[장르] {genre} / [유형] {category}\n\n{char_info}[시나리오 전문]\n{scenario_text[:3000]}'},
        ],
        temperature=0.3,
        max_tokens=700,
        json_mode=True,
    )

    print(f"[generate_compass] raw response ({len(raw)} chars): {raw[:200]}")
    try:
        start = raw.find('{')
        end = raw.rfind('}') + 1
        compass = json.loads(raw[start:end]) if start >= 0 and end > start else {}
    except json.JSONDecodeError as e:
        print(f"[generate_compass] JSON 파싱 실패: {e} / raw='{raw[:300]}'")
        compass = {}
    compass.pop('ending_directions', None)
    return compass


# ──────────────────────────────────────────────────────────────────────────────
# 채팅 시스템 프롬프트 & 응답 파서
# ──────────────────────────────────────────────────────────────────────────────

_TONE_MAP = {
    'positive': '다정하고 호의적이게',
    'negative': '냉소적이고 부정적이게',
    'neutral':  '중립적이고 객관적이게',
}


_DICE_TONE_MAP = {
    1: '극도로 냉담하고 적대적이게. 유저의 말을 단호히 거부하거나 무시하는 방향으로',
    2: '부정적이고 회의적이게. 유저의 말에 별 관심이 없거나 불쾌함을 내비치는 방향으로',
    3: '약간 부정적이게. 미온적이고 거리를 두는 방향으로',
    4: '약간 긍정적이게. 조심스럽게 호응하는 방향으로',
    5: '긍정적이고 호의적이게. 유저의 말에 관심을 보이고 따뜻하게 반응하는 방향으로',
    6: '매우 호의적이고 적극적이게. 유저의 말에 크게 공감하거나 예상보다 좋은 반응을 보이는 방향으로',
}


def build_chat_system_prompt(
    compass: dict,
    game_state: GameStateV2,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    genre: str = '판타지',
    lorebook_context: str = '',
    user_notes: str = '',
    tone_preference: Optional[str] = None,
    dice_roll: Optional[int] = None,
    relationship_graph: Optional[dict] = None,
    perceived_relationships: Optional[dict] = None,
    supporting_cast: Optional[list] = None,
) -> str:
    ai_name = (ai_character or {}).get('name', '상대방')
    user_name = (user_character or {}).get('name', '유저 캐릭터')
    ai_persona = (
        f"성격: {(ai_character or {}).get('personality', '')} / "
        f"배경: {(ai_character or {}).get('background', '')}"
    )

    stage = game_state.current_stage
    constraint = compass.get('stage_constraints', {}).get(stage, '')
    conflict = compass.get('conflict_core', '')
    goal = compass.get('narrative_goal', '')
    triggers = '\n'.join(f'  - {c}' for c in compass.get('trigger_conditions', []))
    foreshadowing_list = compass.get('foreshadowing', [])
    foreshadowing_section = (
        '[복선 목록 — 적절한 시점에 자연스럽게 서사에 녹여낼 것]\n' +
        '\n'.join(f'  - {f}' for f in foreshadowing_list)
    ) if foreshadowing_list else ''

    # 단계별 금지 규칙
    if stage == '결':
        stage_forbidden = '선택 분기 상황만 제시할 것. 결말은 유저에게 열어둘 것.'
    else:
        stage_forbidden = (
            f'현재 단계는 {stage}이며 아직 결 단계가 아니다. '
            f'결말·이별·감정 완전 봉합·마무리성 서술을 response에 절대 쓰지 말 것. '
            f'이야기는 반드시 열린 상태로 유지되어야 한다.'
        )

    remaining = game_state.turns_remaining()
    if remaining > 0:
        trigger_gate = (
            f'현재 {stage} 단계 {game_state.stage_turn_count}턴 경과. '
            f'이 단계를 충분히 탐색하려면 최소 {remaining}턴이 더 필요하다. '
            f'trigger_branch/trigger_ending은 반드시 false로 유지하고, '
            f'{stage} 단계의 서사와 캐릭터를 더 깊이 전개할 것.'
        )
    else:
        _sl = game_state.story_length
        if _sl == 'short':
            _pace_hint = (
                '이 스토리는 【단편】 모드입니다. 트리거 조건을 엄격하게 해석하지 말고, '
                '조건이 절반 이상 갖춰지면 즉시 true로 설정하여 빠르게 다음 단계로 전환하세요. '
                '지체 없이 서사를 진행하는 것이 단편의 핵심입니다.'
            )
        elif _sl == 'long':
            _pace_hint = (
                '이 스토리는 【장편】 모드입니다. 트리거 조건이 완전히 충족되기 전까지 '
                '현재 단계를 충분히 탐색하고 캐릭터를 깊이 발전시키세요. '
                '서두르지 말고 각 단계를 풍부하게 전개하는 것이 장편의 핵심입니다.'
            )
        else:
            _pace_hint = (
                '중요: 설정된 성향이 다정하거나 호의적(긍정적)이더라도, 이야기가 정체되지 않도록 '
                '[서사 나침반]의 트리거 조건을 적극적으로 조성하여 다음 단계로의 전환을 시도하세요. '
                '다정함이 서사의 진행을 방해해서는 안 됩니다.'
            )
        trigger_gate = (
            f'현재 {stage} 단계 {game_state.stage_turn_count}턴 경과. '
            f'최소 턴 조건 충족 — trigger_branch는 위 트리거 조건 목록 중 하나가 '
            f'실제로 충족됐을 때 true로 설정할 것. '
            f'분위기가 고조되거나 극적인 장면이라는 이유만으로는 절대 true 금지. '
            f'{_pace_hint}'
        )

    affinity_criteria = (
        '[affinity_delta 판단 기준]\n'
        f'현재 단계: {stage} (최대 delta — 기:±3 / 승:±5 / 전:±8)\n'
        '긍정\n'
        '  +1 : 가볍게 동의하거나 대화를 이어가는 수준\n'
        '  +2~+3 : AI 캐릭터의 감정·처지에 진심으로 공감하거나 이해 표현\n'
        '  +4~+5 : 중요한 순간에 AI 캐릭터를 지지하거나 신뢰를 보여줌\n'
        '  +6~+8 : (전 단계 한정) 결정적 순간에 AI 캐릭터의 핵심 가치와 일치하는 선택\n'
        '중립\n'
        '   0  : 감정 없이 사건·정보만 주고받는 경우\n'
        '부정\n'
        '  -1 : 가볍게 무관심하거나 흘려듣는 반응\n'
        '  -2~-3 : 명확한 거부·차가운 반응·AI 캐릭터의 감정 무시\n'
        '  -4~-5 : AI 캐릭터의 가치관이나 행동을 비난·조롱\n'
        '  -6~-8 : (전 단계 한정) 결정적 순간의 배신 또는 강한 적대 행동\n'
        '현재 단계 캡을 초과하는 delta는 절대 부여하지 말 것.'
    )

    lorebook_section = f'\n{lorebook_context}\n' if lorebook_context else ''
    user_notes_section = f'[유저 노트(항상 기억)] {user_notes}\n' if user_notes else ''
    if dice_roll and dice_roll in _DICE_TONE_MAP:
        tone_section = f'[주사위 결과: {dice_roll}] 이번 한 번의 응답에 한해 {_DICE_TONE_MAP[dice_roll]} 반응할 것. 캐릭터 성격 안에서 자연스럽게 표현할 것.\n'
    elif tone_preference and tone_preference in _TONE_MAP:
        tone_section = f'[현재 감정 톤] 유저의 대사·행동에 {_TONE_MAP[tone_preference]} 반응할 것.\n'
    else:
        tone_section = ''

    has_supporting = bool(relationship_graph and any(
        n.get('type') == 'supporting'
        for n in relationship_graph.get('nodes', [])
    ))

    impersonation_rule = (
        f'1. {user_name}의 대사나 행동은 절대 대신 쓰지 말 것. user_action은 항상 null.\n'
        f'2. 유저가 큰따옴표("")를 사용한 문장만 {user_name}의 직접 발화(대사)로 인식할 것. '
        f'따옴표가 없는 문장은 {user_name}의 행동·상황·나레이션 묘사이며 서사에 반영할 것. '
        f'단, 따옴표 없는 문장 속 표현을 {user_name}이 말한 것처럼 재인용하거나 직접 언급하는 것은 절대 금지. '
        f'(예: 나레이션에 "기적"이라는 단어가 있어도 {ai_name}이 "기적이라고?!"처럼 발화로 반응하면 안 됨.)\n'
        f'3. ② 형식의 직접 대사란은 {ai_name} 전용이다. '
        + (f'조연의 직접 대사는 supporting_dialogue 필드에만 작성하고 ① ③ 산문에는 포함하지 말 것.\n'
           if has_supporting else '\n')
    )

    summary_section = (
        f'[이전 대화 요약]\n{game_state.conversation_summary}\n\n'
        if game_state.conversation_summary else ''
    )

    graph_section = ''
    if relationship_graph:
        nodes = {n['id']: n['name'] for n in relationship_graph.get('nodes', [])}
        sentiment_map = {'positive': '우호적', 'neutral': '중립', 'negative': '적대적'}
        lines = []
        for e in relationship_graph.get('edges', []):
            from_name = nodes.get(e['from'], e['from'])
            to_name = nodes.get(e['to'], e['to'])
            sentiment = sentiment_map.get(e.get('sentiment', ''), e.get('sentiment', ''))
            relation = e.get('relation', '')
            lines.append(f'  - {from_name} → {to_name}: {relation} ({sentiment})')
        if lines:
            graph_section = (
                f'[세계관 인물 관계도 — 서사 구성 참고용 / {ai_name}의 대사·행동에 직접 사용 금지]\n'
                + '\n'.join(lines) + '\n\n'
            )

    _status_label_map = {
        'unknown': '모름', 'suspicious': '의심', 'hostile': '적대',
        'ally': '동맹', 'friend': '우호', 'neutral': '중립',
    }
    perceived_section = ''
    if perceived_relationships is not None:
        p_lines = [
            f'[{ai_name}의 인지 관계 — 대사·행동의 유일한 기준]',
            f'(이 목록에 없거나 "모름"인 인물은 {ai_name}이 아직 알지 못하는 상태)',
        ]
        supp_perc = perceived_relationships.get('supporting', {})
        if supp_perc:
            for char_name, info in supp_perc.items():
                status_str = _status_label_map.get(info.get('status', 'unknown'), info.get('status', '모름'))
                facts = info.get('known_facts', [])
                fact_str = ' / '.join(facts) if facts else '없음'
                p_lines.append(f'  - {char_name}: [{status_str}] 알고 있는 사실: {fact_str}')
        user_perc = perceived_relationships.get('user_character', {})
        if user_perc:
            uc_status = user_perc.get('status', '초기 관계')
            uc_facts = user_perc.get('known_facts', []) + user_perc.get('revealed_traits', [])
            fact_str = ' / '.join(uc_facts) if uc_facts else '없음'
            p_lines.append(f'  - {user_name}: [{uc_status}] 알고 있는 사실: {fact_str}')
        perceived_section = '\n'.join(p_lines) + '\n\n'

    # 상대 캐릭터 호감도 행동 지침
    _aff = game_state.affinity
    if _aff >= 70:
        _aff_instruction = (
            f'깊이 마음을 열고 있는 상태({_aff:+d}). '
            f'먼저 배려하거나 솔직한 감정을 드러내고, 유저를 적극적으로 지지하는 태도를 자연스럽게 표현할 것.'
        )
    elif _aff >= 40:
        _aff_instruction = (
            f'우호적인 상태({_aff:+d}). '
            f'가끔 호의나 관심을 드러낼 수 있으나 아직 완전히 마음을 열지는 않은 상태. '
            f'친근함이 묻어나되 아직 거리감이 남아있게 표현할 것.'
        )
    elif _aff >= -30:
        _aff_instruction = (
            f'중립 상태({_aff:+d}). '
            f'기본 페르소나대로 행동. 특별한 호의나 적대감 없이 자연스럽게 대할 것.'
        )
    elif _aff >= -70:
        _aff_instruction = (
            f'냉담·경계 상태({_aff:+d}). '
            f'거리를 두고 방어적으로 대하며, 정보를 최소화하거나 소극적으로 반응할 것. '
            f'노골적 적대는 아니나 불편함이 느껴지게 표현할 것.'
        )
    else:
        _aff_instruction = (
            f'적대적 상태({_aff:+d}). '
            f'차갑게 대하고 유저의 행동을 방해하거나 갈등을 유발할 수 있다. '
            f'협조를 거부하고 적극적으로 불리한 상황을 만들어도 무방.'
        )
    main_affinity_section = (
        f'[{ai_name}의 {user_name}에 대한 현재 감정 상태]\n'
        f'{_aff_instruction}\n'
        f'이 감정 상태를 대사·태도·행동에 일관되게 반영할 것. '
        f'(단, 단계 제약·트리거 조건보다 우선하지 않음)\n'
    )

    # 조연 캐릭터 목록 (supporting_dialogue 지침용)
    # supporting_cast 파라미터 우선, 없으면 relationship_graph에서 이름만 fallback
    if not supporting_cast:
        supporting_cast = []
        if relationship_graph:
            supporting_cast = [
                {'name': n['name']}
                for n in relationship_graph.get('nodes', [])
                if n.get('type') == 'supporting'
            ]

    knowledge_boundary = (
        f'[캐릭터 지식 경계 — 필수 준수]\n'
        f'{ai_name}은 위 [인지 관계]에 기록된 사실만 대사·행동에 반영할 수 있다.\n'
        f'세계관 관계도나 로어북 내용이라도 {ai_name}이 직접 경험·목격하지 않은 정보는 대사에 사용 금지.\n'
        f'이번 대화에서 {ai_name}이 새로 알게 된 사실은 perceived_updates에 기록할 것.\n\n'
    ) if perceived_relationships is not None else ''

    return (
        f'너는 {genre} 인터랙티브 스토리의 {ai_name}이야.\n'
        f'페르소나: {ai_persona}\n'
        f'[절대 금지] (속마음), (내면), (생각), (독백) 등 내면 서술을 어떤 형식·괄호로도 출력하지 말 것. '
        f'오직 {ai_name}이 실제로 말하거나 행동하는 내용만 response에 쓸 것.\n\n'
        + summary_section
        + graph_section
        + perceived_section
        + knowledge_boundary
        + main_affinity_section + '\n'
        + f'[나침반]\n'
        f'- 핵심 갈등: {conflict}\n'
        f'- 서사 목표: {goal}\n'
        f'- 현재 단계: {stage} / 제약: {constraint}\n\n'
        + (f'{foreshadowing_section}\n\n' if foreshadowing_section else '')
        + f'[단계 전환 트리거 조건]\n{triggers}\n\n'
        f'[트리거 판단 기준] {trigger_gate}\n'
        f'[현재 단계 금지 규칙] {stage_forbidden}\n'
        f'{lorebook_section}'
        f'{user_notes_section}'
        f'{tone_section}'
        '[응답 규칙]\n'
        f'{impersonation_rule}'
        f'4. {ai_name}의 외부로 표현되는 대사·행동만 서술할 것. '
        '(속마음), (내면), (생각) 등 내면 독백은 어떤 형식으로도 절대 출력하지 말 것.\n'
        f'[서술 형식] 3인칭 소설 산문체로 작성할 것. ①②③ 패턴을 따를 것.\n'
        f'① 장면·분위기·감각 묘사를 3인칭 산문체로 3~5문장 충분히 서술한다. (배경, 인물의 표정·자세·분위기 등)'
        + (f' 조연이 등장하는 경우 조연의 존재감·표정·행동을 산문으로 묘사할 것. (직접 대사는 supporting_dialogue에만 작성)\n'
           if has_supporting else '\n')
        + f'② 빈 줄 뒤에 "{ai_name} | 대사" 형식으로 {ai_name}의 직접 대사를 반드시 포함할 것. (따옴표 없이 말만)\n'
        f'   대사는 캐릭터 성격이 충분히 드러나도록 길고 풍부하게 작성할 것.\n'
        f'   "~라고 말했다", "~을 전했다" 같은 간접화법으로 대사를 대체하는 것 금지.\n'
        f'③ 빈 줄 뒤에 {ai_name}의 후속 행동·반응을 3인칭 산문체로 2~3문장 쓴다.\n'
        f'전체 응답은 반드시 400자 이상으로 충분히 서술할 것. 짧게 끊는 것 금지.\n'
        f'유저 캐릭터({user_name})의 행동·감정·내면은 절대 서술하지 말 것.\n'
        f'예시:\n{ai_name}의 눈이 가늘게 좁혀졌다. {ai_name}은 천천히 팔짱을 끼며 상대를 위아래로 훑어보았다. 주변 공기가 싸늘하게 가라앉는 느낌이었다.\n\n{ai_name} | 그게 전부야? 그 정도로 날 설득할 수 있다고 생각한 거라면, 기대 이하네.\n\n{ai_name}은 등을 돌리며 창밖으로 시선을 고정했다. 더 이상 대화할 의지가 없다는 듯, {ai_name}의 어깨는 굳어 있었다.\n'
        '5. 현재 단계 제약과 나침반 서사 목표를 벗어나지 말 것.\n'
        '6. trigger_branch: 트리거 조건 중 하나가 충족됐으면 true.\n'
        '7. trigger_ending: 결 단계 진입 조건이 충족됐으면 true\n'
        '   (trigger_ending=true이면 trigger_branch도 반드시 true).\n'
        f'8. affinity_delta 기준:\n{affinity_criteria}\n'
        + (
            f'8-1. supporting_dialogue: 이번 장면에 조연이 자연스럽게 직접 말해야 할 경우에만 포함.\n'
            f'   [조연 목록 — 성격·역할·배경을 반드시 반영할 것]\n'
            + ''.join(
                f'   - {c.get("name","조연")}: 역할={c.get("role","")} / 성격={c.get("personality","")} / 배경={c.get("background","")}\n'
                for c in supporting_cast
            )
            + f'   각 조연의 대사는 1~3문장으로 간결하게 작성.\n'
            f'   조연의 직접 대사는 반드시 이 필드에만 작성하고 response 산문에는 포함하지 말 것.\n'
            f'   자연스럽지 않다면 빈 배열 [] 로 둘 것.\n'
            f'   형식: [{{"name": "캐릭터명", "text": "대사 내용"}}]\n'
            if supporting_cast else ''
        )
        + '9. off_track: 유저 입력이 현재 서사·단계와 명확히 무관한 경우 true.\n'
        '   off_track=true일 때는 캐릭터 성격에 맞게 자연스럽게 현재 상황으로 화제를 돌릴 것.\n'
        '   (잠깐의 세계관 탐색이나 캐릭터 질문은 off_track=false)\n'
        '\n'
        '10. 응답은 유저가 반응할 수 있는 자연스러운 지점에서 끝낼 것. '
        '장면을 혼자 결론짓거나 다음 사건까지 전개하지 말 것.\n'
        '\n'
        '[응답 형식 — JSON only, 다른 텍스트 없이]\n'
        '{"user_action": null, "response": "대사·행동만 (속마음·내면 독백 절대 포함 금지)", '
        '"trigger_branch": false, "trigger_ending": false, "affinity_delta": 0, '
        + ('"supporting_dialogue": [], ' if supporting_cast else '')
        + ('"perceived_updates": [], ' if perceived_relationships is not None else '')
        + '"off_track": false}\n\n'
        + (
            'perceived_updates 형식: [{"character": "캐릭터명", "character_type": "supporting|user_character", '
            '"known_fact": "이번 대화에서 알게 된 사실", "new_status": "unknown|suspicious|hostile|ally|friend|neutral 중 하나 또는 null"}]\n'
            '변화가 없으면 빈 배열 []로 둘 것.'
            if perceived_relationships is not None else ''
        )
    )


def parse_chat_response(raw: str, game_state: GameStateV2) -> dict:
    data = {}
    try:
        cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip(), flags=re.MULTILINE)
        start = cleaned.find('{')
        end = cleaned.rfind('}') + 1
        json_str = cleaned[start:end] if start >= 0 and end > start else cleaned

        # ① 직접 파싱
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            # ② 리터럴 줄바꿈 이스케이프 후 재시도
            fixed = re.sub(r'\n', r'\\n', json_str)
            try:
                data = json.loads(fixed)
                print("[parse_chat_response] 줄바꿈 이스케이프 후 파싱 성공")
            except json.JSONDecodeError:
                # ③ 정규식으로 response 값 직접 추출
                m = re.search(
                    r'"response"\s*:\s*"(.*?)"\s*(?:,\s*"(?:trigger_branch|trigger_ending|affinity_delta|user_action|off_track|supporting)"|$)',
                    json_str, re.DOTALL
                )
                if m:
                    extracted = m.group(1).replace('\\n', '\n').replace('\\"', '"')
                    data = {"response": extracted}
                    print("[parse_chat_response] 정규식 추출 성공")
                else:
                    print(f"[parse_chat_response] JSON 파싱 완전 실패 — raw 앞 200자: {raw[:200]}")
    except Exception as e:
        print(f"[parse_chat_response] 예외 발생: {e}")

    delta = max(-10, min(10, int(data.get('affinity_delta', 0))))
    game_state.update_affinity(delta)
    game_state.total_turn_count += 1
    game_state.stage_turn_count += 1

    trigger_branch = bool(data.get('trigger_branch', False))
    trigger_ending = bool(data.get('trigger_ending', False))
    # 백엔드 게이트: 최소 턴 미충족이면 강제 차단
    if not game_state.min_turns_met():
        trigger_branch = False
        trigger_ending = False

    off_track = bool(data.get('off_track', False))
    if off_track:
        game_state.off_track_count += 1
    else:
        game_state.off_track_count = 0

    user_action = data.get('user_action') or None
    if isinstance(user_action, str) and not user_action.strip():
        user_action = None

    response_text = data.get('response', '다시 시도해 주세요.')
    # 내면 독백 강제 제거: (속마음: ...), (내면: ...), (생각: ...) 등 괄호 패턴 삭제
    response_text = re.sub(r'\([^)]*(?:속마음|내면|생각|독백|내심|혼잣말)[^)]*\)', '', response_text)
    response_text = response_text.strip()

    # 조연 대사 파싱
    raw_sd = data.get('supporting_dialogue', [])
    supporting_dialogue = []
    if isinstance(raw_sd, list):
        for item in raw_sd:
            if isinstance(item, dict) and item.get('name') and item.get('text'):
                supporting_dialogue.append({'name': str(item['name']), 'text': str(item['text'])})

    # 인지 관계 업데이트 파싱
    raw_pu = data.get('perceived_updates', [])
    perceived_updates = []
    if isinstance(raw_pu, list):
        for item in raw_pu:
            if isinstance(item, dict) and item.get('character'):
                perceived_updates.append({
                    'character': str(item['character']),
                    'character_type': str(item.get('character_type', 'supporting')),
                    'known_fact': str(item.get('known_fact', '')),
                    'new_status': item.get('new_status') or None,
                })

    return {
        'response': response_text,
        'user_action': user_action,
        'trigger_branch': trigger_branch,
        'trigger_ending': trigger_ending,
        'affinity_delta': delta,
        'off_track': off_track,
        'supporting_dialogue': supporting_dialogue,
        'perceived_updates': perceived_updates,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 단계 전환 오프닝
# ──────────────────────────────────────────────────────────────────────────────

def generate_next_stage(
    next_stage: str,
    user_input: str,
    compass: dict,
    game_state: GameStateV2,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    genre: str = '판타지',
) -> str:
    ai_name = (ai_character or {}).get('name', '상대방')
    user_name = (user_character or {}).get('name', '유저 캐릭터')
    ai_personality = (ai_character or {}).get('personality', '')
    ai_background = (ai_character or {}).get('background', '')
    ai_char_info = ' / '.join(filter(None, [ai_personality, ai_background]))
    constraint = compass.get('stage_constraints', {}).get(next_stage, '')
    conflict = compass.get('conflict_core', '')
    goal = compass.get('narrative_goal', '')
    ending_note = '선택 분기 상황만 제시하고 결말은 유저에게 열어둘 것.' if next_stage == '결' else ''

    jeon_rule = ''
    if next_stage == '전':
        jeon_rule = (
            '\n[전 단계 특별 규칙]\n'
            '이 오프닝은 전 단계의 시작일 뿐이다. 반전·폭로·클라이맥스를 여기에 담지 말 것.\n'
            '오프닝의 역할: 뭔가 이상하다는 긴장감과 불안감만 깔 것. 구체적인 진실은 암시만 하고 직접 드러내지 않는다.\n'
            '진실과 클라이맥스는 이후 대화를 통해 단계적으로 드러나도록 여지를 남길 것.\n'
        )

    return vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                f'너는 인터랙티브 {genre} 스토리의 게임 마스터야.\n'
                f'유저의 대사/행동과 대화 흐름을 반영해서 {next_stage} 단계 오프닝 서사를 즉석 생성한다.\n\n'
                f'[나침반]\n'
                f'- 핵심 갈등: {conflict}\n'
                f'- 서사 목표: {goal}\n'
                f'- {next_stage} 단계 제약: {constraint} {ending_note}\n\n'
                f'[캐릭터]\n'
                f'- {ai_name}(AI 담당): {ai_char_info}\n'
                f'- {user_name}(유저 담당)\n\n'
                f'[말투 유지 규칙] {ai_name}의 대사는 반드시 지금까지 대화에서 사용한 말투·문체를 그대로 유지할 것.\n'
                f'{jeon_rule}\n'
                '[생성 규칙]\n'
                '1. 유저의 최근 입력이 자연스럽게 반영될 것.\n'
                f'2. {next_stage} 단계의 갈등 수위와 분위기를 충실히 구현할 것.\n'
                f'3. {ai_name}의 첫 대사 또는 행동 묘사로 마무리할 것.\n'
                '4. 200~400자 이내.\n'
                f'5. 문체: 한다체(서술형)로 작성할 것. "~합니다", "~입니다", "~었습니다" 등 합쇼체 절대 금지. "~한다", "~됐다", "~이다" 형식 사용.\n'
                f'6. "당신" 대신 반드시 {user_name} 이름을 사용할 것.\n'
                f'7. "그가", "그녀가", "그는", "그녀는" 등 대명사 대신 반드시 {ai_name} 이름을 사용할 것.'
            )},
            {'role': 'user', 'content': (
                f'[현재 상태] {game_state.summary()}\n\n'
                f'[대화 요약]\n{game_state.conversation_summary[-500:] or "없음"}\n\n'
                f'[유저 최근 입력] {user_input}\n\n'
                f"'{next_stage}' 단계 오프닝 서사를 생성해줘."
            )},
        ],
        temperature=0.75,
        max_tokens=500,
        model=MODEL_PRO,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 대화 요약기
# ──────────────────────────────────────────────────────────────────────────────

SUMMARY_INTERVAL = 10


def summarize_conversation(
    chat_history: list,
    game_state: GameStateV2,
    compass: dict,
) -> str:
    recent = chat_history[-(2 * SUMMARY_INTERVAL):]
    history_text = '\n'.join(
        f"{'유저' if m['role'] == 'user' else 'AI'}: {m['content'][:300]}"
        for m in recent
    )

    prev_summary = (
        f'[이전 요약]\n{game_state.conversation_summary}\n\n'
        if game_state.conversation_summary else ''
    )

    return vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                '너는 인터랙티브 스토리 요약 전문가야.\n'
                '대화 이력에서 서사 진행과 관계 변화에 중요한 정보만 추출해 압축 요약해.\n\n'
                '[요약에 반드시 포함할 항목]\n'
                '1. 주요 사건·선택: 유저 캐릭터가 한 결정적 행동이나 선택\n'
                '2. 관계 변화: 유저 캐릭터와 AI 캐릭터 사이 감정·신뢰·갈등의 흐름\n'
                '3. 드러난 정보: 복선이 실현됐거나 새로 밝혀진 사실\n'
                '4. 현재 상태: 지금 두 캐릭터가 처한 상황과 분위기\n\n'
                '[작성 규칙]\n'
                "- 캐릭터 이름 대신 '유저 캐릭터' / 'AI 캐릭터' 표현만 사용\n"
                '- 300~500자 이내 / 대사 인용 없이 서술 형식'
            )},
            {'role': 'user', 'content': (
                f'{prev_summary}'
                f'[현재 단계] {game_state.current_stage} | 호감도: {game_state.affinity:+d} | '
                f'총 {game_state.total_turn_count}턴\n'
                f'[핵심 갈등] {compass.get("conflict_core", "")}\n\n'
                f'[최근 대화]\n{history_text}\n\n'
                '위 내용을 바탕으로 요약을 작성해줘.'
            )},
        ],
        temperature=0.3,
        max_tokens=400,
        model=VERTEX_MODEL_FLASH_LITE,
    )


OFF_TRACK_THRESHOLD = 3


def regenerate_compass(
    compass: dict,
    game_state: GameStateV2,
    chat_history: list,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    genre: str = '판타지',
) -> dict:
    ai_name = (ai_character or {}).get('name', '상대방')
    user_name = (user_character or {}).get('name', '유저 캐릭터')
    recent = chat_history[-6:] if len(chat_history) >= 6 else chat_history
    recent_text = '\n'.join(
        f"{'유저' if m['role'] == 'user' else ai_name}: {m['content'][:200]}"
        for m in recent
    )

    raw = vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                f'너는 {genre} 인터랙티브 스토리의 서사 디렉터야.\n'
                '유저가 원래 시나리오 방향에서 벗어나 새로운 흐름을 만들고 있다.\n'
                '현재 대화 흐름을 존중하면서 기존 나침반의 핵심 갈등과 서사 목표를 최대한 유지한 채 '
                '나침반을 자연스럽게 업데이트해야 한다.\n\n'
                '[기존 나침반]\n'
                f'- 핵심 갈등: {compass.get("conflict_core", "")}\n'
                f'- 서사 목표: {compass.get("narrative_goal", "")}\n'
                f'- 현재 단계: {game_state.current_stage}\n\n'
                '[반환 형식 — JSON only]\n'
                '{"conflict_core": "...", "narrative_goal": "...", '
                '"trigger_conditions": ["조건1", "조건2", "조건3"], '
                '"foreshadowing": "...", '
                '"stage_constraints": {"기": "...", "승": "...", "전": "...", "결": "..."}}'
            )},
            {'role': 'user', 'content': (
                f'[최근 대화]\n{recent_text}\n\n'
                f'[현재 호감도] {game_state.affinity:+d}\n\n'
                '위 대화 흐름을 반영해서 나침반을 업데이트해줘.'
            )},
        ],
        temperature=0.7,
        max_tokens=600,
    )
    try:
        start = raw.find('{')
        end = raw.rfind('}') + 1
        new_compass = json.loads(raw[start:end]) if start >= 0 and end > start else {}
    except Exception:
        new_compass = {}

    # 파싱 실패 시 기존 compass 유지
    if not new_compass:
        return compass

    # 기존 compass에서 누락된 키는 원본 값으로 채움
    for key in compass:
        if key not in new_compass:
            new_compass[key] = compass[key]

    game_state.off_track_count = 0
    return new_compass


def update_summary_if_needed(
    chat_history: list,
    game_state: GameStateV2,
    compass: dict,
) -> bool:
    if game_state.total_turn_count > 0 and game_state.total_turn_count % SUMMARY_INTERVAL == 0:
        game_state.conversation_summary = summarize_conversation(chat_history, game_state, compass)
        return True
    return False


# ──────────────────────────────────────────────────────────────────────────────
# 엔딩 생성
# ──────────────────────────────────────────────────────────────────────────────

def generate_ending_scene(
    game_state: GameStateV2,
    compass: dict,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    genre: str = '판타지',
    category: str = '소설',
) -> dict:
    ai_name = (ai_character or {}).get('name', '상대방')
    user_name = (user_character or {}).get('name', '유저 캐릭터')
    ai_personality = (ai_character or {}).get('personality', '')
    ai_background = (ai_character or {}).get('background', '')
    ai_char_info = ' / '.join(filter(None, [ai_personality, ai_background]))

    scene = vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                f'너는 인터랙티브 {genre} 스토리의 엔딩 작가야.\n'
                '유저가 지금까지 플레이한 이력을 반영해서 이 유저만을 위한 고유한 엔딩 장면을 써.\n'
                '엔딩의 색채와 결말 방향은 지금까지의 대화 흐름과 시나리오 맥락에서 자연스럽게 도출할 것. 억지로 해피·배드를 구분하지 말 것.\n\n'
                f'[나침반]\n'
                f'- 핵심 갈등: {compass.get("conflict_core", "")}\n'
                f'- 서사 목표: {compass.get("narrative_goal", "")}\n\n'
                f'[캐릭터]\n'
                f'- {ai_name}(AI 담당): {ai_char_info}\n'
                f'- {user_name}(유저 담당)\n\n'
                f'[유저 플레이 요약]\n'
                f'- 호감도: {game_state.affinity:+d} / 총 {game_state.total_turn_count}턴\n\n'
                '[작성 규칙]\n'
                '1. AI 캐릭터와 유저 캐릭터의 관계가 어떻게 마무리되는지 서술할 것.\n'
                '2. 유저가 대화 중 한 선택과 행동이 자연스럽게 반영될 것.\n'
                f'3. {ai_name}의 대사는 반드시 지금까지 대화에서 사용한 말투·문체를 그대로 유지할 것.\n'
                '4. 300~500자 이내로 작성할 것.\n'
                '5. 유저 캐릭터의 대사나 행동은 서술하지 말 것 (유저 몫).\n'
                f'6. 문체: 한다체(서술형)로 작성할 것. "~합니다", "~입니다", "~었습니다" 등 합쇼체 절대 금지. "~한다", "~됐다", "~이다" 형식 사용.\n'
                f'7. "당신" 대신 반드시 {user_name} 이름을 사용할 것.\n'
                f'8. "그가", "그녀가", "그는", "그녀는" 등 대명사 대신 반드시 {ai_name} 이름을 사용할 것.'
            )},
            {'role': 'user', 'content': (
                f'[대화 요약]\n'
                f'{game_state.conversation_summary[-800:] if game_state.conversation_summary else "없음"}\n\n'
                '위 플레이 이력을 바탕으로 엔딩 장면을 써줘.'
            )},
        ],
        temperature=0.7,
        max_tokens=600,
        model=MODEL_PRO,
    )

    return {
        'type': '',
        'scene': scene,
        'affinity': game_state.affinity,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 호감도 100 특전 씬
# ──────────────────────────────────────────────────────────────────────────────

def generate_affinity_max_scene(
    game_state: GameStateV2,
    compass: dict,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    genre: str = '판타지',
) -> str:
    ai_name = (ai_character or {}).get('name', '상대방')
    user_name = (user_character or {}).get('name', '유저 캐릭터')
    ai_personality = (ai_character or {}).get('personality', '')
    ai_background = (ai_character or {}).get('background', '')
    conflict = compass.get('conflict_core', '')
    goal = compass.get('narrative_goal', '')

    return vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                f'너는 인터랙티브 {genre} 스토리의 특별 씬 작가야.\n'
                f'{ai_name}과 {user_name}의 관계가 마침내 완전한 신뢰와 친밀감에 도달했다.\n'
                f'이 결정적 순간, {ai_name}이 처음으로 마음을 완전히 여는 짧고 강렬한 특전 씬을 작성해.\n\n'
                f'[{ai_name} 정보]\n'
                f'- 성격: {ai_personality}\n'
                f'- 배경: {ai_background}\n\n'
                f'[서사 맥락]\n'
                f'- 핵심 갈등: {conflict}\n'
                f'- 서사 목표: {goal}\n\n'
                '[작성 규칙]\n'
                f'1. ① 짧은 분위기·감각 묘사 1~2문장 (3인칭 산문)\n'
                f'2. ② {ai_name} | 직접 대사 (진심 어린, 1~2문장)\n'
                f'3. ③ 후속 행동·여운 1문장\n'
                f'4. 전체 100~200자 이내\n'
                f'5. {user_name}의 대사·행동·내면은 절대 쓰지 말 것\n'
                '6. 속마음 괄호 표현 금지'
            )},
            {'role': 'user', 'content': (
                f'[현재 단계] {game_state.current_stage} | 총 {game_state.total_turn_count}턴\n'
                f'[대화 요약]\n{game_state.conversation_summary[-600:] if game_state.conversation_summary else "없음"}\n\n'
                f'{ai_name}이 {user_name}에게 마음을 여는 특전 씬을 작성해줘.'
            )},
        ],
        temperature=0.85,
        max_tokens=300,
        model=MODEL_PRO,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 초기 인지 관계 생성 (시나리오 빌더 단계)
# ──────────────────────────────────────────────────────────────────────────────

def generate_initial_perceived_relationships(
    scenario_ki_text: str,
    relationship_graph: dict,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    supporting_cast: Optional[list] = None,
) -> dict:
    """시나리오 기 단계 텍스트를 분석해 AI 캐릭터가 이야기 시작 시점에 이미 알고 있는 관계를 초기화한다."""
    ai_name = (ai_character or {}).get('name', 'AI 캐릭터')
    user_name = (user_character or {}).get('name', '유저 캐릭터')
    cast = supporting_cast or []

    cast_lines = ''.join(
        f"- {c.get('name', '조연')}: 역할={c.get('role', '')} / 배경={c.get('background', '')}\n"
        for c in cast
    )
    supporting_names = [c.get('name', '') for c in cast if c.get('name')]

    graph_lines = []
    nodes = {n['id']: n['name'] for n in relationship_graph.get('nodes', [])}
    for e in relationship_graph.get('edges', []):
        f_name = nodes.get(e['from'], e['from'])
        t_name = nodes.get(e['to'], e['to'])
        graph_lines.append(f'  {f_name} → {t_name}: {e.get("relation", "")} ({e.get("sentiment", "")})')
    graph_text = '\n'.join(graph_lines) if graph_lines else '없음'

    raw = vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                f'너는 인터랙티브 스토리 분석가야.\n'
                f'시나리오 기 단계 텍스트를 읽고, 이야기가 시작되는 시점에 {ai_name}이 각 인물에 대해\n'
                f'실제로 알고 있는 정보를 JSON으로 정리해.\n\n'
                f'[판단 기준]\n'
                f'- 시나리오 텍스트에 "{ai_name}이 알고 있다", "오래 알아온", "숙적", "친구" 등\n'
                f'  사전 관계가 명시된 인물 → 해당 status로 초기화\n'
                f'- 이야기 도중 처음 만나거나 등장하는 인물 → "unknown"\n'
                f'- 애매하면 "unknown"으로 처리할 것\n\n'
                f'[status 선택지] unknown / suspicious / hostile / ally / friend / neutral\n\n'
                f'[반환 형식 — JSON only]\n'
                '{\n'
                '  "supporting": {\n'
                '    "캐릭터명": {\n'
                '      "status": "unknown|suspicious|hostile|ally|friend|neutral",\n'
                '      "known_facts": ["이야기 시작 전부터 알고 있는 사실 (없으면 빈 배열)"]\n'
                '    }\n'
                '  },\n'
                '  "user_character": {\n'
                '    "status": "처음 만남 / 오랜 친구 / 숙적 등 시나리오 기반 짧은 설명",\n'
                '    "known_facts": ["이야기 시작 전부터 알고 있는 사실 (없으면 빈 배열)"],\n'
                '    "revealed_traits": []\n'
                '  }\n'
                '}'
            )},
            {'role': 'user', 'content': (
                f'[AI 캐릭터] {ai_name} / 성격: {(ai_character or {}).get("personality", "")} / 배경: {(ai_character or {}).get("background", "")}\n'
                f'[유저 캐릭터] {user_name}\n\n'
                f'[조연 목록]\n{cast_lines or "없음"}\n\n'
                f'[세계관 관계도 참고]\n{graph_text}\n\n'
                f'[시나리오 기 단계]\n{scenario_ki_text[:2000]}\n\n'
                f'위 내용을 바탕으로 이야기 시작 시점의 {ai_name} 인지 관계를 JSON으로 반환해줘.\n'
                f'조연 목록에 있는 모든 인물({", ".join(supporting_names)})을 supporting에 반드시 포함할 것.'
            )},
        ],
        temperature=0.2,
        max_tokens=800,
        json_mode=True,
    )

    print(f"[generate_initial_perceived] raw ({len(raw)} chars): {raw[:200]}")
    try:
        start = raw.find('{')
        end = raw.rfind('}') + 1
        parsed = json.loads(raw[start:end]) if start >= 0 and end > start else {}
    except json.JSONDecodeError as e:
        print(f"[generate_initial_perceived] JSON 파싱 실패: {e}")
        parsed = {}

    # 파싱 실패 또는 누락된 조연 보완 (fallback)
    result = {
        'supporting': parsed.get('supporting', {}),
        'user_character': parsed.get('user_character', {
            'status': '처음 만남',
            'known_facts': [],
            'revealed_traits': [],
        }),
    }
    for char_name in supporting_names:
        if char_name not in result['supporting']:
            result['supporting'][char_name] = {'status': 'unknown', 'known_facts': []}

    return result


# ──────────────────────────────────────────────────────────────────────────────
# 힌트 카드
# ──────────────────────────────────────────────────────────────────────────────

def generate_hint_card(
    game_state: GameStateV2,
    compass: dict,
    last_ai_response: str,
) -> str:
    ending_note = '이 분기점은 엔딩으로 이어진다. 결말의 무게감이 느껴지도록 할 것.' if game_state.is_final_stage() else ''

    return vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                '너는 인터랙티브 스토리의 힌트 카드 작가야.\n'
                '대화의 분기점에서 유저에게 보여줄 한 줄짜리 방향 암시 문구를 생성해.\n\n'
                '[작성 규칙]\n'
                '1. 구체적인 선택지를 제시하지 말 것 (A or B 형식 금지)\n'
                '2. 감성적·시적 표현으로 방향만 암시할 것\n'
                "3. '~할 것인가, ~할 것인가' 또는 유사한 대구 형식 권장\n"
                '4. 15~25자 이내 / 한국어 / 문구만 출력'
            )},
            {'role': 'user', 'content': (
                f'[현재 단계] {game_state.current_stage}\n'
                f'[핵심 갈등] {compass.get("conflict_core", "")}\n'
                f'[AI 마지막 대사] {last_ai_response[:200]}\n'
                f'[호감도] {game_state.affinity:+d}\n'
                f'{ending_note}\n\n힌트 카드 문구를 생성해줘.'
            )},
        ],
        temperature=0.8,
        max_tokens=50,
        model=VERTEX_MODEL_FLASH_LITE,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 로어북 (키워드 매칭 기반, ChromaDB 없이 동작)
# ──────────────────────────────────────────────────────────────────────────────

# ──────────────────────────────────────────────────────────────────────────────
# 인물 관계도 생성 / 업데이트
# ──────────────────────────────────────────────────────────────────────────────

def generate_relationship_graph(
    ai_character: Optional[dict],
    user_character: Optional[dict],
    supporting_cast: Optional[list],
    compass: dict,
    stage: str = '기',
    conversation_summary: str = '',
    previous_graph: Optional[dict] = None,
    recent_messages: str = '',
) -> dict:
    ai_name = (ai_character or {}).get('name', 'AI 캐릭터')
    user_name = (user_character or {}).get('name', '유저 캐릭터')
    cast = supporting_cast or []

    char_list = (
        f'- {ai_name} (AI 캐릭터, id: "ai") / 성격: {(ai_character or {}).get("personality", "")}\n'
        f'- {user_name} (유저 캐릭터, id: "user")\n'
    )
    for c in cast:
        char_list += f'- {c.get("name", "조연")} (조연, id: "supporting_{c.get("name", "npc")}") / 역할: {c.get("role", "")}\n'

    prev_info = ''
    if previous_graph:
        prev_info = f'\n[이전 관계도]\n{json.dumps(previous_graph, ensure_ascii=False)}\n'

    summary_info = f'\n[대화 요약]\n{conversation_summary[-600:]}' if conversation_summary else ''
    recent_info = f'\n[최근 대화 원문 — 이 내용을 최우선으로 반영할 것]\n{recent_messages}' if recent_messages else ''

    raw = vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                '너는 인터랙티브 스토리의 인물 관계 분석가야.\n'
                '등장인물 간의 현재 관계를 분석해서 관계도 JSON을 반환해.\n\n'
                '[노드 타입]\n'
                '- "ai": AI 캐릭터 (주인공)\n'
                '- "user": 유저 캐릭터\n'
                '- "supporting": 조연\n\n'
                '[감정 방향 (sentiment)]\n'
                '- "positive": 우호적, 신뢰, 애정\n'
                '- "neutral": 중립, 모름, 거래 관계\n'
                '- "negative": 적대, 갈등, 불신\n\n'
                '[반환 형식 — JSON only]\n'
                '각 노드의 "name" 필드는 반드시 [등장인물] 목록에 적힌 실제 이름을 그대로 사용할 것.\n'
                '{"nodes": [{"id": "ai", "name": "실제AI캐릭터이름", "type": "ai"}, {"id": "user", "name": "실제유저캐릭터이름", "type": "user"}, ...], '
                '"edges": [{"from": "ai", "to": "user", "relation": "한 단어~짧은 구", "sentiment": "positive|neutral|negative"}, ...], '
                '"stage": "현재 단계"}'
            )},
            {'role': 'user', 'content': (
                f'[현재 단계] {stage}\n'
                f'[핵심 갈등] {compass.get("conflict_core", "")}\n'
                f'[등장인물]\n{char_list}'
                f'{prev_info}'
                f'{summary_info}'
                f'{recent_info}\n\n'
                '이전 관계도는 출발점으로만 참고하고, 최근 대화 원문을 기준으로 각 인물 간 관계를 처음부터 재평가해줘. '
                '대화에서 관계가 변했다면 반드시 반영하고, 변화가 없는 관계도 근거를 확인한 뒤 유지해줘.'
            )},
        ],
        temperature=0.3,
        max_tokens=800,
        json_mode=True,
    )

    try:
        graph = json.loads(raw)
        graph['stage'] = stage
        return graph
    except Exception:
        return {'nodes': [], 'edges': [], 'stage': stage}


def extract_lorebook_entries(
    scenario_text: str,
    compass: dict,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    supporting_cast: Optional[list] = None,
) -> list:
    cast = supporting_cast or []
    cast_lines = ''.join(
        f"- 조연: {c.get('name', '조연')} / 역할: {c.get('role', '')} / 배경: {c.get('background', '')}\n"
        for c in cast
    )

    raw = vertex_complete(
        messages=[
            {'role': 'system', 'content': (
                '너는 인터랙티브 스토리의 세계관 분석가야.\n'
                '시나리오 텍스트에서 AI가 대화 중 일관되게 기억해야 할 핵심 항목을 추출해.\n\n'
                '[추출 대상]\n'
                '- place       : 지명, 장소, 공간 설명\n'
                '- character   : 등장인물 관계, 성격, 숨겨진 정보 — 주인공뿐 아니라 [조연 목록]의 인물도 반드시 포함\n'
                '- event       : 이야기 시작 전 이미 일어난 역사적 사건, 세계관 배경 — 아직 일어나지 않은 미래 플롯은 절대 포함 금지\n'
                '- foreshadowing: 기 단계 본문에 심어진 복선 디테일 — AI 내부 참고용\n\n'
                '[작성 규칙]\n'
                '- 항목당 content는 1~3문장 이내\n'
                '- keyword와 content에 [등장인물] 에 명시된 실제 이름을 그대로 사용할 것\n'
                '- character 항목의 keyword는 반드시 해당 인물의 실제 이름이어야 함\n'
                '- AI 캐릭터 이름과 유저 캐릭터 이름을 절대 혼용하지 말 것\n'
                '- [조연 목록]에 있는 인물은 각각 character 항목으로 반드시 1개 이상 추출할 것\n'
                '- 8~15개 항목 추출\n'
                '- JSON 배열만 출력 (키: "entries")\n\n'
                '출력 형식:\n'
                '{"entries": [{"keyword": "실제이름또는장소명", "content": "...", "category": "place|character|event|foreshadowing", "stage": "기|승|전"}]}'
            )},
            {'role': 'user', 'content': (
                f"[등장인물 — 이름 혼동 절대 금지]\n"
                f"- AI 캐릭터: {(ai_character or {}).get('name', 'AI 캐릭터')} (이 이름만 AI 캐릭터에 사용)\n"
                f"- 유저 캐릭터: {(user_character or {}).get('name', '유저 캐릭터')} (이 이름만 유저 캐릭터에 사용)\n"
                + (f"[조연 목록 — 반드시 character 항목으로 포함]\n{cast_lines}" if cast_lines else "")
                + f"\n[핵심 갈등] {compass.get('conflict_core', '')}\n"
                f"[복선 목록] {compass.get('foreshadowing', [])}\n\n"
                f'[시나리오 전문]\n{scenario_text[:3000]}'
            )},
        ],
        temperature=0.2,
        max_tokens=1500,
        json_mode=True,
    )

    print(f"[extract_lorebook] raw response ({len(raw)} chars): {raw[:200]}")
    try:
        start = raw.find('{')
        end = raw.rfind('}') + 1
        parsed = json.loads(raw[start:end]) if start >= 0 and end > start else {}
    except json.JSONDecodeError as e:
        print(f"[extract_lorebook] JSON 파싱 실패: {e} / raw='{raw[:300]}'")
        return []
    if isinstance(parsed, list):
        return parsed
    for v in parsed.values():
        if isinstance(v, list):
            return v
    return []


def get_lorebook_context(
    recent_messages: list,
    lorebook_entries: list,
    top_k: int = 3,
    forced_keywords: Optional[list] = None,
) -> str:
    """복선·노트는 항상, forced_keywords 항목은 강제, 나머지는 키워드 매칭된 항목을 시스템 프롬프트 주입용 텍스트로 반환."""
    if not lorebook_entries:
        return ''

    # foreshadowing, note 항목은 항상 포함
    always_entries = [e for e in lorebook_entries if e.get('category') in ('foreshadowing', 'note')]
    other_entries = [e for e in lorebook_entries if e.get('category') not in ('foreshadowing', 'note')]

    # forced_keywords 항목은 강제 포함 (조연 캐릭터 로어북)
    forced_lower = [k.lower() for k in (forced_keywords or [])]
    forced_entries = []
    remaining_entries = []
    for entry in other_entries:
        if entry.get('keyword', '').lower() in forced_lower:
            forced_entries.append(entry)
        else:
            remaining_entries.append(entry)

    # 나머지 항목은 키워드 매칭
    query_text = ' '.join(m.get('content', '') for m in (recent_messages or [])[-5:]).lower()
    scored = []
    for entry in remaining_entries:
        keyword = entry.get('keyword', '').lower()
        if not keyword:
            continue
        if keyword in query_text:
            scored.append((2, entry))
        elif any(w in query_text for w in keyword.split() if len(w) > 1):
            scored.append((1, entry))
    scored.sort(key=lambda x: x[0], reverse=True)
    matched_entries = [e for _, e in scored[:top_k]]

    all_entries = always_entries + forced_entries + matched_entries
    if not all_entries:
        return ''

    label_map = {'place': '장소', 'character': '인물', 'event': '사건', 'foreshadowing': '복선', 'note': '노트'}
    lines = ['[로어북 — 세계관 정보 및 복선]']
    for entry in all_entries:
        label = label_map.get(entry.get('category', ''), '정보')
        lines.append(f'- [{label}] {entry.get("content", "")}')
    lines.append('※ 복선 항목은 적절한 시점에 자연스럽게 서사에 녹여낼 것. 노트 항목은 항상 반영할 것.')
    return '\n'.join(lines)
