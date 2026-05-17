"""
scenario_builder.py
벡터DB.ipynb의 핵심 함수들을 웹 백엔드 연동용으로 추출한 모듈.

사용 DB: C:/Users/User/Desktop/Github/Dive.ai/vectordb (scenes 89,851개 / classics 12,717개)
임베딩: OpenAI text-embedding-3-small (1536차원 — VectorDB와 동일 모델 필요)
LLM   : Vertex AI Gemini
"""

from typing import Optional, List, Dict, Any
import json
import os
import re
from pathlib import Path

import chromadb
from openai import OpenAI
from dotenv import load_dotenv
from ai_engine import vertex_complete, VERTEX_MODEL_FLASH_LITE, MODEL_PRO, gemini_generate_image, _SYSTEM_WEBTOON, _SYSTEM_WEBTOON_COVER, _SYSTEM_WEBTOON_CLASSIC, _SYSTEM_WEBTOON_CLASSIC_COVER

load_dotenv()

# ---------------------------------------------------------------------------
# 경로 및 클라이언트
# ---------------------------------------------------------------------------
DB_DIR = Path(__file__).parent.parent / "vectordb"

_openai_key = os.environ.get("OPENAI_API_KEY")
client: Optional[OpenAI] = OpenAI(api_key=_openai_key) if _openai_key else None

EMBED_MODEL = "text-embedding-3-small"

# ---------------------------------------------------------------------------
# ChromaDB 초기화
# ---------------------------------------------------------------------------
_chroma_client = None
scene_collection = None
classic_collection = None

try:
    _chroma_client = chromadb.PersistentClient(path=str(DB_DIR))
    scene_collection = _chroma_client.get_or_create_collection(
        name="scenes",
        metadata={"hnsw:space": "cosine"},
    )
    classic_collection = _chroma_client.get_or_create_collection(
        name="classics",
        metadata={"hnsw:space": "cosine"},
    )
    print(f"[Scenario Builder] VectorDB 로드 완료 — scenes={scene_collection.count():,}, classics={classic_collection.count():,}")
except Exception as e:
    print(f"[Scenario Builder] VectorDB 초기화 오류 (RAG 비활성화): {e}")

# ---------------------------------------------------------------------------
# 상수 및 설정
# ---------------------------------------------------------------------------
BASE_STYLES = {
    "만화": (
        "Korean webtoon manhwa illustration style, semi-realistic digital painting, "
        "clean crisp black line art with sophisticated cel-shading with detailed highlights and shadows, "
        "dramatic rim lighting with subtle depth shadows, vibrant color palette, "
        "professional Korean digital comic art, detailed expressive eyes, clean skin rendering."
    ),
    "소설": (
        "Korean webtoon manhwa novel illustration style, semi-realistic digital painting, "
        "clean detailed line art with sophisticated cel-shading with detailed highlights and shadows, "
        "soft atmospheric lighting, rich emotional color palette, "
        "cinematic single-character illustration, professional Korean digital illustration style, detailed face and costume."
    ),
    "고전": (
        "Korean webtoon manhwa illustration style, semi-realistic digital painting, "
        "clean crisp black line art with sophisticated cel-shading with detailed highlights and shadows, "
        "dramatic rim lighting with subtle depth shadows, "
        "traditional {period} historical aesthetics, period-accurate costume and ornate details, "
        "professional Korean digital comic art, detailed expressive eyes, clean skin rendering."
    ),
    "시리즈": "High-end cinematic photography, centered composition, generous headroom, medium shot, dramatic studio lighting, rich detailed environment, ultra-high-quality realistic 8k photography, professional production art, masterpiece.",
    "영화": "High-end cinematic film still, centered composition, generous headroom, medium shot, intense dramatic lighting, subtle film grain, ultra-high-quality realistic 8k photography, Hollywood production value, masterpiece.",
}

COVER_STYLES = {
    "만화": (
        "Korean webtoon manhwa illustration style, semi-realistic digital painting, "
        "clean crisp black line art with sophisticated cel-shading with detailed highlights, "
        "dramatic cinematic character composition, rich atmospheric environment, "
        "professional Korean digital comic art, pure illustration artwork."
    ),
    "소설": (
        "Korean webtoon manhwa novel illustration style, semi-realistic digital painting, "
        "clean detailed line art with sophisticated cel-shading with detailed highlights, "
        "dramatic cinematic character composition, rich atmospheric environment, "
        "professional Korean digital illustration, pure illustration artwork."
    ),
    "고전": (
        "Korean webtoon manhwa illustration style, semi-realistic digital painting, "
        "clean crisp black line art with sophisticated cel-shading with detailed highlights, "
        "dramatic cinematic character composition, rich atmospheric historical environment, "
        "traditional {period} historical aesthetics, ornate period-accurate costumes, "
        "professional Korean digital comic art, pure illustration artwork."
    ),
    "시리즈": "High-end cinematic photography, dramatic original drama series poster style, centered composition, ensure all main characters are fully visible within the frame, dramatic studio lighting, rich detailed environment, ultra-high-quality realistic 8k photography, professional production art, masterpiece.",
    "영화": "High-end cinematic widescreen film still, epic blockbuster scale, dynamic action-oriented composition, centered composition, ensure all main characters are fully visible within the frame, intense dramatic studio lighting, rich cinematic textures, ultra-high-quality 8k, professional production art, masterpiece.",
}

# 고전 국가 → 구체적 시대명 매핑
CLASSIC_PERIOD_MAP = {
    "한국": "Korean Joseon-period",
    "중국": "Chinese Ming/Qing-period",
    "일본": "Japanese Edo-period",
}

STORY_ARC_STAGES: Dict[str, List[str]] = {
    "기": ["Opening Salvo", "Main Character", "Setting-up"],
    "승": ["1st Accident", "Villains Move", "Doubts & Debate", "Making a Choice", "Choice to Fight"],
    "전": ["Ups & Downs", "2nd Accident", "Innermost Cave", "Defeat", "Resurrection", "Another Story"],
    "결": ["Trailer Moments", "Final Salvo"],
}

COUNTRY_TO_GENRES: Dict[str, List[str]] = {
    "한국": ["가문소설", "판타지", "로맨스", "영웅소설", "미스터리", "호러"],
    "중국": ["판타지", "로맨스", "무협", "호러", "미스터리"],
    "일본": ["설화", "미스터리", "호러", "편지소설", "영험담"],
}

CLASSIC_COUNTRIES = set(COUNTRY_TO_GENRES.keys())

_GENRE_NORMALIZE: Dict[str, str] = {
    "멜로·로맨스": "멜로/로맨스",
    "공포(호러)":  "호러",
}

def _normalize_genre(genre: str) -> str:
    return _GENRE_NORMALIZE.get(genre, genre)


def _normalize_classic_genre(genre: str) -> str:
    return _GENRE_NORMALIZE.get(genre, genre)

# ---------------------------------------------------------------------------
# 이미지 생성 로직 (단독 캐릭터 프로필 전용)
# ---------------------------------------------------------------------------

def generate_character_image(
    content_type: str,
    gender: str,
    age: str,
    traits: str,
    scenario_summary: str,
    name: str = "",
    country: Optional[str] = "Korean",
    seed: int = 777
) -> Optional[str]:
    """Vertex AI 모델을 사용하여 단독 캐릭터 이미지를 생성합니다."""
    
    # 성별/나이 영어 변환 매핑
    gender_map = {"남성": "man", "여성": "woman", "남자": "man", "여자": "woman"}
    gender_en = gender_map.get(gender, gender)
    
    age_map = {"10대": "teenager", "20대": "20s", "30대": "30s", "40대": "40s", "50대": "50s"}
    age_en = age_map.get(age, age)

    # ── 시리즈/영화: Gemini 3.1 Flash Image (시네마틱) ───────────────────────────
    if content_type in ["시리즈", "영화"]:
        base = BASE_STYLES.get(content_type, BASE_STYLES["소설"])
        if country and country != "Korean":
            ethnicity_line = f"Nationality/Ethnicity: {country}. "
        else:
            ethnicity_line = f"Ensure ethnicity matches the name '{name}' and story context naturally. "

        if "{country}" in base: base = base.format(country=country or "Korean")

        prompt = (
            f"{base} "
            f"{name}, a {age_en} {gender_en}, standing in a single frame. "
            f"{ethnicity_line}"
            f"Faithfully portray the following physical traits exactly as described: {traits}. "
            f"Do not omit or modify any specific details provided. Clean face, professional lighting. "
            f"ONE FRAME ONLY — strictly a single-angle, single-panel view. "
            f"Absolutely no character sheets, no reference sheets, no triptychs, no side-by-side panels, no multi-angle layouts. "
            f"Masterpiece quality."
        )
        return gemini_generate_image(prompt=prompt, resolution="2K", seed=seed)

    # ── 만화/소설: Gemini 3.1 Flash Image (웹툰) ────────────────────────────────
    if content_type in ["만화", "소설"]:
        base = BASE_STYLES.get(content_type)

        if country and country != "Korean":
            ethnicity_line = f"Nationality/Ethnicity: {country}. "
        else:
            ethnicity_line = f"Ensure ethnicity matches the name '{name}' and story context naturally. "

        # traits 영어 번역 (Gemini도 영어 프롬프트 성능이 더 뛰어남)
        traits_en = traits
        try:
            traits_en = vertex_complete(
                messages=[{"role": "user", "content": f"Translate these character appearance traits into a short English prompt for an image generator. Output only the English translation: {traits}"}],
                temperature=0.0,
                max_tokens=200,
                model="gemini-3.1-flash-lite-preview"
            ).strip()
        except: pass

        if content_type == "만화":
            expression_lighting = "Confident expression, dramatic side rim light on hair and shoulders."
            background = "soft gradient atmospheric background with subtle dark bokeh."
            neg_extra = "no speech bubbles, no panel borders,"
        else:  # 소설
            expression_lighting = "Emotional expression, dramatic side lighting." if gender_en in ["man"] else "Gentle expression, soft frontal lighting."
            background = "simple atmospheric background with soft depth-of-field bokeh."
            neg_extra = "no watermarks, no speech bubbles, no panel borders,"

        prompt = (
            f"SINGLE PORTRAIT IMAGE ONLY. VERTICAL FORMAT. ONE CHARACTER ONLY. "
            f"{base} "
            f"Upper body portrait of {name}, a {age_en} {gender_en}, waist-up shot, centered, facing forward. "
            f"{ethnicity_line}"
            f"flawless skin, clean face, no blood, no wounds, no scars, no dirt. "
            f"Accurately represent traits: {traits_en}. "
            f"{expression_lighting} "
            f"Strictly 1 person in frame, {background} "
            f"No other characters, no extra people, no text, {neg_extra} "
            f"no distorted face, no double exposure, no surreal distortion, no morbid elements. "
            f"ABSOLUTELY ONE SINGLE ANGLE, ONE SINGLE POSE, ONE SINGLE PANEL. "
            f"NO character sheets, NO reference sheets, NO triptychs, NO side-by-side panels, NO multi-angle layouts, NO turnarounds, NO front/side/back views. "
            f"Highly detailed, professional quality, masterpiece."
        )
        return gemini_generate_image(prompt=prompt, resolution="2K", seed=seed, system_instruction=_SYSTEM_WEBTOON)
    # ────────────────────────────────────────────────────────────────────────────

    # ── 고전: Gemini 3.1 Flash Image (웹툰 역사 스타일) ─────────────────────────────
    period = CLASSIC_PERIOD_MAP.get(country, f"{country} historical") if country else "Korean Joseon-period"
    base = BASE_STYLES.get("고전", BASE_STYLES["소설"]).format(period=period)

    traits_en = traits
    try:
        traits_en = vertex_complete(
            messages=[{"role": "user", "content": f"Translate these character appearance traits into a short English prompt for an image generator. Output only the English translation: {traits}"}],
            temperature=0.0,
            max_tokens=200,
            model="gemini-3.1-flash-lite-preview"
        ).strip()
    except: pass

    period_line = f"Set in traditional {period} period. Wearing period-accurate {period} traditional costume and ornate accessories. "

    if gender_en in ["man", "male"]:
        expression_lighting = "Dignified expression, dramatic side rim light on hair and shoulders."
    else:
        expression_lighting = "Gentle dignified expression, soft warm rim light on hair."
    background = "simple traditional pale atmospheric background with subtle depth-of-field."

    prompt = (
        f"SINGLE PORTRAIT IMAGE ONLY. VERTICAL FORMAT. ONE CHARACTER ONLY. "
        f"{base} "
        f"Upper body portrait of {name}, a {age_en} {gender_en}, waist-up shot, centered, facing forward. "
        f"{period_line}"
        f"flawless skin, clean face, no blood, no wounds, no scars, no dirt. "
        f"Accurately represent traits: {traits_en}. "
        f"{expression_lighting} "
        f"Strictly 1 person in frame, {background} "
        f"No other characters, no extra people, no text, no speech bubbles, no panel borders, "
        f"no distorted face, no double exposure, no surreal distortion, no morbid elements. "
        f"ABSOLUTELY ONE SINGLE ANGLE, ONE SINGLE POSE, ONE SINGLE PANEL. "
        f"NO character sheets, NO reference sheets, NO triptychs, NO side-by-side panels, NO multi-angle layouts, NO turnarounds, NO front/side/back views. "
        f"Highly detailed, professional quality, masterpiece."
    )
    return gemini_generate_image(prompt=prompt, resolution="2K", seed=seed, system_instruction=_SYSTEM_WEBTOON_CLASSIC)
    # ────────────────────────────────────────────────────────────────────────────

# ---------------------------------------------------------------------------
# 이미지 생성 로직 (표지 및 구도 분석)
# ---------------------------------------------------------------------------

def analyze_relationship_for_composition(scenario_text: str, ai_name: str, user_name: str, genre: str, content_type: str = "소설") -> str:
    """시나리오의 핵심 정서·관계를 분석해 하이엔드 시네마틱 구도 프롬프트를 생성합니다."""
    prompt = (
        f"너는 영화 및 게임의 비주얼 아트 디렉터야. 아래 시나리오를 분석해서 가장 임팩트 있는 시네마틱 구도를 영어 프롬프트 한 문장으로 작성해줘.\n\n"
        f"[시나리오]\n{scenario_text[:1500]}\n\n"
        f"[장르] {genre}\n"
        f"[콘텐츠 유형] {content_type}\n"
        f"[두 주인공] {ai_name}, {user_name}\n\n"
        f"[작성 규칙]\n"
        f"1. 시나리오의 핵심 감정·분위기를 반영한 웅장하고 드라마틱한 구도를 설계해.\n"
        f"2. 인물 배치: 두 캐릭터의 관계가 핵심이면 Two-shot, 주인공 단독의 아우라가 중요하면 Solo-shot으로 구성해.\n"
        f"3. 절대 금지: 시나리오의 제목(Title)이나 캐릭터의 이름을 프롬프트 본문에 절대 포함하지 마라. 대신 'A man', 'A woman', 'A knight' 등 외형적 특징으로만 묘사해.\n"
        f"4. 절대 금지: 'Cover', 'Book', 'Novel', 'Layout', 'Title space' 등 글자를 연상시키는 단어를 절대 사용하지 마라.\n"
        f"5. 지향 언어: Cinematic composition, Epic scale, Narrative-driven visual, Dramatic lighting, Atmospheric production art.\n"
        f"6. 화면 전체를 그림으로 가득 채우는 구도로 작성해. 오직 영어 프롬프트 한 문장만 출력."
    )
    try:
        composition = vertex_complete(messages=[{"role": "user", "content": prompt}], temperature=0.8, max_tokens=250, model="gemini-3.1-pro-preview")
        return composition.strip()
    except:
        return f"Dramatic cinematic composition, narrative-driven visual, intense atmospheric lighting, highly detailed production art"

def generate_cover_image(
    content_type: str,
    composition_prompt: str,
    ai_char: dict,
    user_char: dict,
    ai_ref_img: Optional[str] = None,
    user_ref_img: Optional[str] = None,
    country: Optional[str] = "Korean",
    seed: int = 999
) -> Optional[str]:
    """Vertex AI 모델을 사용하여 웹소설 표지 이미지를 생성합니다."""
    
    # 성별/나이 영어 변환 매핑
    gender_map = {"남성": "man", "여성": "woman", "남자": "man", "여자": "woman"}
    age_map = {"10대": "teenager", "20대": "20s", "30대": "30s", "40대": "40s", "50대": "50s"}

    # ── 시리즈/영화: Gemini 3.1 Flash Image (시네마틱 + 참조 이미지) ──────────────
    if content_type in ["시리즈", "영화"]:
        base = COVER_STYLES.get(content_type, COVER_STYLES["소설"])
        if country and country != "Korean":
            ethnicity_line = f"Nationality: {country}, "
        else:
            ethnicity_line = "Ethnicity matching the character names naturally, "
            
        if "{country}" in base: base = base.format(country=country or "Korean")

        ai_name = ai_char.get('name', '')
        ai_gen_en = gender_map.get(ai_char.get('gender', ''), ai_char.get('gender', ''))
        ai_age_en = age_map.get(ai_char.get('age', ''), ai_char.get('age', ''))
        ai_info = f"{ai_name} ({ai_age_en} {ai_gen_en}), {ethnicity_line}{ai_char.get('appearance','')}"
        
        user_name = user_char.get('name', '')
        user_gen_en = gender_map.get(user_char.get('gender', ''), user_char.get('gender', ''))
        user_age_en = age_map.get(user_char.get('age', ''), user_char.get('age', ''))
        user_info = f"{user_name} ({user_age_en} {user_gen_en}), {ethnicity_line}{user_char.get('appearance','')}"

        prompt = (
            f"{base} {composition_prompt}. Character details — {ai_info}; {user_info}. "
            "Physically accurate interaction, realistic textures, grounded in reality, masterpiece quality."
        )
        
        ref_imgs = []
        if ai_ref_img: ref_imgs.append(ai_ref_img)
        if user_ref_img: ref_imgs.append(user_ref_img)
        
        return gemini_generate_image(prompt=prompt, reference_images=ref_imgs, resolution="2K", seed=seed)

    # ── 만화/소설: Gemini 3.1 Flash Image (웹툰 + 참조 이미지) ─────────────────────
    if content_type in ["만화", "소설"]:
        base = COVER_STYLES.get(content_type)

        ai_name = ai_char.get('name', '')
        user_name_str = user_char.get('name', '')

        ref_imgs = []
        if ai_ref_img: ref_imgs.append(ai_ref_img)
        if user_ref_img: ref_imgs.append(user_ref_img)

        prompt = (
            f"HORIZONTAL LANDSCAPE FORMAT, WIDE ASPECT RATIO (16:9 or wider). "
            f"{base} {composition_prompt}. "
            f"Image 0 is {ai_name}, Image 1 is {user_name_str}. "
            f"Reproduce both characters with their exact same faces from the reference images — "
            f"same face structure, same hair, same features. "
            f"Ensure both characters are fully visible within the frame. "
            f"No text, no titles, no watermarks, no speech bubbles, no panel borders, "
            f"no distorted faces, no extra people, no double exposure, no surreal distortion, no morbid elements. "
            f"Dramatic character illustration, highly detailed, professional quality, masterpiece."
        )
        return gemini_generate_image(
            prompt=prompt,
            reference_images=ref_imgs,
            resolution="2K",
            seed=seed,
            system_instruction=_SYSTEM_WEBTOON_COVER
        )
    # ────────────────────────────────────────────────────────────────────────────

    # ── 고전: Gemini 3.1 Flash Image (웹툰 역사 스타일 + 참조 이미지) ────────────────
    period = CLASSIC_PERIOD_MAP.get(country, f"{country} historical") if country else "Korean Joseon-period"
    base = COVER_STYLES.get("고전", COVER_STYLES["소설"]).format(period=period)

    ai_name = ai_char.get('name', '')
    user_name_str = user_char.get('name', '')

    ref_imgs = []
    if ai_ref_img: ref_imgs.append(ai_ref_img)
    if user_ref_img: ref_imgs.append(user_ref_img)

    prompt = (
        f"HORIZONTAL LANDSCAPE FORMAT, WIDE ASPECT RATIO (16:9 or wider). "
        f"{base} {composition_prompt}. "
        f"Image 0 is {ai_name}, Image 1 is {user_name_str}. "
        f"Reproduce both characters with their exact same faces from the reference images — "
        f"same face structure, same hair, same features, same period-accurate costume. "
        f"Set in traditional {period} period with period-accurate environment. "
        f"Ensure both characters are fully visible within the frame. "
        f"No text, no titles, no watermarks, no speech bubbles, no panel borders, "
        f"no distorted faces, no extra people, no double exposure, no surreal distortion, no morbid elements. "
        f"Dramatic historical character illustration, highly detailed, professional quality, masterpiece."
    )
    return gemini_generate_image(
        prompt=prompt,
        reference_images=ref_imgs,
        resolution="2K",
        seed=seed,
        system_instruction=_SYSTEM_WEBTOON_CLASSIC_COVER
    )
    # ────────────────────────────────────────────────────────────────────────────

# ---------------------------------------------------------------------------
# 배경 이미지 생성 (단계별, 캐릭터 없는 환경/분위기 전용)
# ---------------------------------------------------------------------------

_SYSTEM_BACKGROUND = (
    "You are a professional cinematic environment and landscape artist specializing in atmospheric backgrounds. "
    "Generate wide, immersive environment and landscape imagery suitable as a full-screen chat background. "
    "STRICTLY: Do NOT include any people, characters, human figures, silhouettes, or body parts. "
    "Do NOT include any text, watermarks, logos, UI elements, or titles. "
    "Focus entirely on the environment: scenery, architecture, nature, lighting, atmosphere."
)

_STAGE_MOOD_EN = {
    '기': 'peaceful, serene, introductory calm — a quiet world waiting for a story to begin',
    '승': 'building tension, dynamic energy, shifting atmosphere — the world starts to change',
    '전': 'dramatic, intense, climactic — high contrast light and shadow, stormy or charged atmosphere',
    '결': 'bittersweet, fading golden light, quiet aftermath — the world reflecting resolution and emotion',
}

_CLASSIC_PERIOD_BG = {
    "한국": "Korean Joseon dynasty",
    "중국": "Chinese Tang or Song dynasty",
    "일본": "Japanese Edo period",
}

def generate_background_image(
    content_type: str,
    genre: str,
    stage: str,
    scenario_stage_text: str,
    classic_country: Optional[str] = None,
    seed: int = 100,
    recent_chat_context: Optional[str] = None,
) -> Optional[str]:
    """단계별 채팅 배경 이미지를 생성합니다 (캐릭터 없는 환경/분위기 이미지)."""

    mood = _STAGE_MOOD_EN.get(stage, 'atmospheric, moody, immersive')

    # 최근 대화 컨텍스트가 있으면 우선 사용, 없으면 시나리오 텍스트 사용
    source_text = recent_chat_context or scenario_stage_text
    env_desc = f"{genre} story atmospheric setting"
    if source_text:
        try:
            env_desc = vertex_complete(
                messages=[{"role": "user", "content": (
                    f"Read this Korean story/conversation excerpt and describe ONLY the physical setting/location "
                    f"in 1-2 English sentences (place, time of day, weather, architecture, nature, atmosphere). "
                    f"No characters, no plot: {source_text[:800]}"
                )}],
                temperature=0.2,
                max_tokens=100,
                model="gemini-3.1-flash-lite-preview"
            ).strip()
        except Exception:
            pass

    # 콘텐츠 유형별 스타일
    if content_type in ["시리즈", "영화"]:
        style = "Ultra-realistic cinematic photography, dramatic film lighting, anamorphic lens flare, shallow depth of field"
    elif content_type == "만화":
        style = "Korean webtoon style environment illustration, clean lineart, atmospheric painterly background"
    elif content_type == "소설":
        style = "Atmospheric digital painting, soft dramatic lighting, painterly environment art, impressionistic mood"
    elif content_type == "고전":
        period = _CLASSIC_PERIOD_BG.get(classic_country or "", "Korean Joseon dynasty")
        style = (
            f"Traditional {period} landscape painting style, "
            f"ink wash and vibrant color, period-accurate architecture and nature scenery"
        )
    else:
        style = "Atmospheric digital art, cinematic environment, dramatic lighting"

    prompt = (
        f"{style}. "
        f"Mood: {mood}. "
        f"Setting: {env_desc}. "
        f"Wide establishing environment shot, full canvas composition. "
        f"Absolutely NO people, NO characters, NO human figures, NO silhouettes. "
        f"NO text, NO watermarks, NO UI elements. "
        f"Highly detailed, professional quality, masterpiece."
    )

    return gemini_generate_image(
        prompt=prompt,
        aspect_ratio="1:1",
        resolution="2K",
        seed=seed,
        system_instruction=_SYSTEM_BACKGROUND,
    )


# ---------------------------------------------------------------------------
# 단계 전환 캐릭터 이미지 생성
# ---------------------------------------------------------------------------

_STAGE_CHAR_MOOD_EN = {
    '승': 'building inner tension, determined yet conflicted expression, cinematic medium or 3/4 shot',
    '전': 'intense dramatic emotion, climactic pressure, powerful gaze, high contrast dynamic lighting',
    '결': 'reflective weight of the journey, quiet but emotionally charged, final chapter atmosphere',
}

def generate_stage_character_image(
    content_type: str,
    genre: str,
    stage: str,
    ai_char: dict,
    stage_opening_text: str,
    classic_country: Optional[str] = None,
    seed: Optional[int] = None,
    user_char: Optional[dict] = None,
    recent_conversation: str = '',
    worldview: str = '',
    compass: Optional[dict] = None,
    affinity: int = 0,
) -> Optional[str]:
    """단계 전환 시 극적인 장면 이미지를 생성합니다. 등장 인물 구성을 LLM이 판단합니다."""
    import random as _random
    if seed is None:
        seed = _random.randint(0, 9999)

    gender_map = {"남성": "man", "여성": "woman", "남자": "man", "여자": "woman"}
    age_map = {"10대": "teenager", "20대": "20s", "30대": "30s", "40대": "40s", "50대": "50s"}

    ai_name   = ai_char.get('name', 'AI 캐릭터')
    user_name = (user_char or {}).get('name', '유저 캐릭터')

    # ── 1단계: 등장인물 구성 판단 (Pro 모델) ─────────────────────────────────
    who = 'ai_only'  # 기본값
    try:
        compass_summary = ''
        if compass:
            compass_summary = (
                f"핵심 갈등: {compass.get('conflict', '')}\n"
                f"현재 단계: {stage} / 서사 목표: {compass.get('goal', '')}"
            )
        judgment_prompt = (
            f"아래 정보를 종합해서 현재 장면 이미지에 누가 등장해야 하는지 판단해.\n"
            f"반드시 'ai_only', 'both', 'user_only' 중 정확히 하나만 출력해. 다른 텍스트 없이.\n\n"
            f"[단계 오프닝 장면]\n{stage_opening_text[:400]}\n\n"
            f"[최근 대화]\n{recent_conversation[:400]}\n\n"
            f"[세계관]\n{worldview[:200]}\n\n"
            f"[나침반]\n{compass_summary}\n\n"
            f"[호감도] {affinity:+d}\n\n"
            f"[AI 캐릭터] {ai_name}\n"
            f"[유저 캐릭터] {user_name}\n\n"
            f"판단 기준:\n"
            f"- 장면에 {ai_name}만 등장하거나 {ai_name}의 내면/행동 묘사가 중심이면 → ai_only\n"
            f"- 두 캐릭터가 함께 있거나 대화/대립/접촉하는 장면이면 → both\n"
            f"- {user_name}의 단독 행동/감정이 중심이면 → user_only"
        )
        result = vertex_complete(
            messages=[{"role": "user", "content": judgment_prompt}],
            temperature=0.0,
            max_tokens=10,
            model=MODEL_PRO,
        ).strip().lower()
        if result in ('ai_only', 'both', 'user_only'):
            who = result
        print(f"[stage_char_image] 등장인물 판단: {who}")
    except Exception as e:
        print(f"[stage_char_image] 판단 실패, ai_only 기본값 사용: {e}")

    # ── 2단계: 장면 포즈/분위기 묘사 ────────────────────────────────────────
    visual_desc = f"A dramatic {genre} story scene"
    if stage_opening_text:
        try:
            visual_desc = vertex_complete(
                messages=[{"role": "user", "content": (
                    "다음 단계 전환 장면을 보고, 등장인물의 포즈·표정·주변 환경을 영어 1~2문장으로만 묘사해줘.\n"
                    "캐릭터의 외형(머리색, 눈색 등) 설명은 절대 포함하지 마. 동작과 분위기만.\n"
                    f"장르: {genre}, 단계: {stage}\n"
                    f"장면:\n{stage_opening_text[:500]}"
                )}],
                temperature=0.3,
                max_tokens=100,
                model="gemini-3.1-flash-lite-preview",
            ).strip()
        except Exception:
            pass

    # ── 3단계: 레퍼런스 이미지 + 스타일 구성 ────────────────────────────────
    ai_ref   = ai_char.get('image')
    user_ref = (user_char or {}).get('image')

    if who == 'ai_only':
        ref_imgs = [ai_ref] if ai_ref else []
    elif who == 'user_only':
        ref_imgs = [user_ref] if user_ref else []
    else:  # both
        ref_imgs = [r for r in [ai_ref, user_ref] if r]

    stage_mood = _STAGE_CHAR_MOOD_EN.get(stage, 'dramatic emotional expression')

    if content_type == "고전":
        period = CLASSIC_PERIOD_MAP.get(classic_country or "", "Korean Joseon-period")
        base_style = (
            f"Korean webtoon manhwa illustration style, semi-realistic digital painting, "
            f"traditional {period} historical aesthetics, period-accurate costume, dramatic composition."
        )
        system_instr = _SYSTEM_WEBTOON
    elif content_type in ["만화", "소설"]:
        base_style = COVER_STYLES.get(content_type, COVER_STYLES["소설"])
        system_instr = _SYSTEM_WEBTOON
    else:
        base_style = (
            "High-end cinematic film still, intense dramatic character portrait, "
            "ultra-high-quality realistic 8k photography, Hollywood production value, masterpiece."
        )
        system_instr = None

    no_text = (
        "SINGLE IMAGE ONLY — do not create collages, triptychs, character sheets, multi-panel grids, or comparison layouts. "
        "No text, no watermarks, no speech bubbles, no panel borders. "
        "Full body or 3/4 shot with atmospheric background. "
        "Highly detailed, professional quality, masterpiece."
    )

    # ── 4단계: 프롬프트 조합 ─────────────────────────────────────────────────
    if who == 'both' and ref_imgs:
        char_labels = []
        if ai_ref and ai_ref in ref_imgs:
            char_labels.append(f"Image {ref_imgs.index(ai_ref)} is {ai_name}")
        if user_ref and user_ref in ref_imgs:
            char_labels.append(f"Image {ref_imgs.index(user_ref)} is {user_name}")
        label_str = '. '.join(char_labels) + '.' if char_labels else ''
        prompt = (
            f"{base_style} "
            f"{visual_desc}. "
            f"{label_str} "
            f"Reproduce both characters with their exact same faces from the reference images. "
            f"{stage_mood}. {no_text}"
        )
    elif ref_imgs:
        char_name = ai_name if who == 'ai_only' else user_name
        prompt = (
            f"{base_style} "
            f"{visual_desc}. "
            f"Image 0 is {char_name}. "
            f"Reproduce the character with the exact same face from the reference image. "
            f"{stage_mood}. {no_text}"
        )
    else:
        ai_gen = gender_map.get(ai_char.get('gender', ''), ai_char.get('gender', ''))
        ai_age = age_map.get(ai_char.get('age', ''), ai_char.get('age', ''))
        prompt = (
            f"{base_style} "
            f"{visual_desc}. "
            f"Character: {ai_age} {ai_gen}, {ai_char.get('appearance', '')}. "
            f"{stage_mood}. {no_text}"
        )

    kwargs: dict = dict(prompt=prompt, resolution="2K", seed=seed)
    if ref_imgs:
        kwargs["reference_images"] = ref_imgs
    if system_instr:
        kwargs["system_instruction"] = system_instr

    return gemini_generate_image(**kwargs)


# ---------------------------------------------------------------------------
# 엔딩 이미지 생성
# ---------------------------------------------------------------------------

_ENDING_MOOD_EN = {
    '해피': 'warm golden hour lighting, hopeful romantic atmosphere, soft bokeh, tender emotional mood',
    '중립': 'muted cool tones, bittersweet mood, overcast diffused lighting, quiet melancholy, introspective',
    '배드': 'dark dramatic lighting, cold blue-grey tones, tragic atmosphere, heavy rain or mist, grief-stricken',
}

def generate_ending_image(
    content_type: str,
    genre: str,
    ending_scene: str,
    ai_char: dict,
    user_char: dict,
    classic_country: Optional[str] = None,
    seed: Optional[int] = None,
) -> Optional[str]:
    """엔딩 장면 일러스트를 생성합니다. LLM으로 구도를 결정하고 캐릭터 참조 이미지를 활용합니다."""
    import time as _time
    import random as _random

    if seed is None:
        seed = _random.randint(0, 9999)

    gender_map = {"남성": "man", "여성": "woman", "남자": "man", "여자": "woman"}
    age_map = {"10대": "teenager", "20대": "20s", "30대": "30s", "40대": "40s", "50대": "50s"}

    # ── 1단계: LLM으로 구도 결정 + 영어 장면 묘사 ───────────────────────────
    llm_raw = ""
    try:
        llm_raw = vertex_complete(
            messages=[{"role": "user", "content": (
                "다음 엔딩 장면을 이미지 생성용 영어 프롬프트로 변환해줘.\n\n"
                "[구도 결정 규칙]\n"
                "- 두 캐릭터가 함께 있는 장면 → duo\n"
                "- 한 명이 사망·부재·실종한 장면 → solo (남은 AI 캐릭터 단독)\n"
                "- 이별·단절이 주제, 멀찍이 떨어진 구도 → separation\n"
                "- 극적인 자연/배경이 핵심이고 인물이 소인물인 장면 → landscape\n\n"
                "[출력 형식 — 반드시 이 형식만]\n"
                "COMPOSITION: duo\n"
                "PROMPT: (영어 장면 묘사 2~3문장)\n\n"
                f"엔딩 장면:\n{ending_scene[:700]}"
            )}],
            temperature=0.3,
            max_tokens=220,
            model="gemini-3.1-flash-lite-preview",
        ).strip()
    except Exception:
        llm_raw = ""

    # COMPOSITION / PROMPT 파싱
    composition = "duo"
    visual_prompt = f"{genre} story ending scene, dramatic and emotional atmosphere"
    for line in llm_raw.splitlines():
        line = line.strip()
        if line.upper().startswith("COMPOSITION:"):
            val = line.split(":", 1)[-1].strip().lower()
            if val in ("solo", "duo", "separation", "landscape"):
                composition = val
        elif line.upper().startswith("PROMPT:"):
            visual_prompt = line.split(":", 1)[-1].strip()

    # ── 2단계: 구도별 캐릭터 묘사 + 참조 이미지 구성 ───────────────────────
    ai_appearance  = ai_char.get('appearance', '')
    user_appearance = user_char.get('appearance', '')
    ai_gen   = gender_map.get(ai_char.get('gender', ''), ai_char.get('gender', ''))
    ai_age   = age_map.get(ai_char.get('age', ''), ai_char.get('age', ''))
    user_gen = gender_map.get(user_char.get('gender', ''), user_char.get('gender', ''))
    user_age = age_map.get(user_char.get('age', ''), user_char.get('age', ''))

    ai_ref   = ai_char.get('image')   if content_type in ["시리즈", "영화", "만화", "소설"] else None
    user_ref = user_char.get('image') if content_type in ["시리즈", "영화", "만화", "소설"] else None

    if composition == 'solo':
        char_desc = f"Character: {ai_age} {ai_gen}, {ai_appearance}"
        ref_imgs = [ai_ref] if ai_ref else []
    elif composition == 'duo':
        char_desc = (
            f"Character 1: {ai_age} {ai_gen}, {ai_appearance}. "
            f"Character 2: {user_age} {user_gen}, {user_appearance}."
        )
        ref_imgs = [r for r in [ai_ref, user_ref] if r]
    elif composition == 'separation':
        char_desc = (
            f"Two figures far apart: {ai_age} {ai_gen}, {ai_appearance} "
            f"and {user_age} {user_gen}, {user_appearance}. "
            f"Physical distance emphasized, no eye contact between them."
        )
        ref_imgs = [r for r in [ai_ref, user_ref] if r]
    else:  # landscape
        char_desc = "Tiny silhouetted figure(s) in the far distance, dwarfed by the environment."
        ref_imgs = []

    # ── 3단계: content_type별 베이스 스타일 ─────────────────────────────────
    if content_type == "고전":
        period = CLASSIC_PERIOD_MAP.get(classic_country or "", "Korean Joseon-period")
        base_style = (
            f"Korean webtoon manhwa illustration style, semi-realistic digital painting, "
            f"clean crisp black line art, traditional {period} historical aesthetics, "
            f"period-accurate costumes, cinematic composition, professional Korean digital comic art."
        )
        system_instr = _SYSTEM_WEBTOON_CLASSIC_COVER
    elif content_type in ["만화", "소설"]:
        base_style = COVER_STYLES.get(content_type, COVER_STYLES["소설"])
        system_instr = _SYSTEM_WEBTOON_COVER
    else:  # 시리즈, 영화
        base_style = COVER_STYLES.get(content_type, COVER_STYLES["시리즈"])
        system_instr = None

    mood = 'cinematic, emotionally resonant, narrative conclusion atmosphere'

    # ── 4단계: 최종 프롬프트 조립 ───────────────────────────────────────────
    no_text_clause = (
        "SINGLE IMAGE ONLY — do not create collages, triptychs, character sheets, multi-panel grids, or comparison layouts. "
        "No text, no titles, no watermarks, no speech bubbles, no panel borders, "
        "no distorted faces, no extra people, no double exposure, no surreal distortion. "
        "Highly detailed, professional quality, masterpiece."
    )

    if ref_imgs:
        # 참조 이미지가 있을 때: 캐릭터 외형을 참조 이미지에 맡기고 장면/무드 중심으로
        img_labels = " ".join(
            [f"Image {i} is {[ai_char.get('name',''), user_char.get('name','')][i]}." for i in range(len(ref_imgs))]
        )
        prompt = (
            f"{base_style} "
            f"{visual_prompt}. "
            f"{img_labels} "
            f"Reproduce the characters with their exact same faces from the reference images. "
            f"{mood}. "
            f"{no_text_clause}"
        )
    else:
        # 참조 이미지 없을 때: 외형 묘사 텍스트로 처리
        prompt = (
            f"{base_style} "
            f"{visual_prompt}. "
            f"{char_desc} "
            f"{mood}. "
            f"{no_text_clause}"
        )

    kwargs = dict(prompt=prompt, resolution="2K", seed=seed)
    if ref_imgs:
        kwargs["reference_images"] = ref_imgs
    if system_instr:
        kwargs["system_instruction"] = system_instr

    return gemini_generate_image(**kwargs)


# ---------------------------------------------------------------------------
# 검색 함수 (RAG) - 원본 복구
# ---------------------------------------------------------------------------

def retrieve_scenes(query: str, category: Optional[str] = None, genre: Optional[str] = None, story_arc: Optional[str] = None, top_k: int = 5) -> list[dict]:
    if not scene_collection or not client: return []
    try:
        genre_db = _normalize_genre(genre) if genre else None
        query_vec = client.embeddings.create(model=EMBED_MODEL, input=[query]).data[0].embedding
        filter_list = []
        if category: filter_list.append({"category_name": {"$eq": category}})
        arc_stages = STORY_ARC_STAGES.get(story_arc, []) if story_arc else []
        if arc_stages: filter_list.append({"stage": {"$in": arc_stages}})
        where = ({"$and": filter_list} if len(filter_list) > 1 else filter_list[0] if len(filter_list) == 1 else None)
        fetch_k = min(top_k * 15 if genre_db else top_k, scene_collection.count())
        params: dict = {"query_embeddings": [query_vec], "n_results": fetch_k, "include": ["metadatas", "documents", "distances"]}
        if where: params["where"] = where
        results = scene_collection.query(**params)
        scenes = []
        for meta, doc, dist in zip(results["metadatas"][0], results["documents"][0], results["distances"][0]):
            if genre_db and genre_db not in meta.get("genre", ""): continue
            scenes.append({"score": round(1 - dist, 4), "stage": meta.get("stage", ""), "unit_motif": meta.get("unit_motif", ""), "genre": meta.get("genre", ""), "storyline": meta.get("storyline", ""), "causality": meta.get("causality", "")})
            if len(scenes) >= top_k: break
        return scenes
    except Exception as e:
        print(f"[Scenario Builder] retrieve_scenes 오류: {e}")
        return []

def retrieve_classics(query: str, country: Optional[str] = None, genre_keywords: Optional[list[str]] = None, top_k: int = 3) -> list[dict]:
    if not classic_collection or not client: return []
    try:
        query_vec = client.embeddings.create(model=EMBED_MODEL, input=[query]).data[0].embedding
        where = {"country": {"$eq": country}} if country else None
        fetch_k = min(top_k * 5, classic_collection.count())
        params: dict = {"query_embeddings": [query_vec], "n_results": fetch_k, "include": ["metadatas", "documents", "distances"]}
        if where: params["where"] = where
        results = classic_collection.query(**params)
        normalized_kw = [_normalize_classic_genre(g) for g in genre_keywords] if genre_keywords else []

        paragraphs = []
        for meta, doc, dist in zip(results["metadatas"][0], results["documents"][0], results["distances"][0]):
            if normalized_kw:
                meta_genre = meta.get("classic_genre", "")
                if not any(g in meta_genre for g in normalized_kw):
                    continue
            paragraphs.append({"score": round(1 - dist, 4), "country": meta.get("country", ""), "motif": meta.get("motif", ""), "space": meta.get("space", ""), "summary": doc})
            if len(paragraphs) >= top_k:
                break
        return paragraphs
    except Exception as e:
        print(f"[Scenario Builder] retrieve_classics 오류: {e}")
        return []

def build_scene_context(scenes: list[dict]) -> str:
    if not scenes: return ""
    lines = ["[유사 작품 씬 패턴 참고]"]
    for s in scenes:
        tag = f"{s['stage']} / {s['unit_motif']}" if s.get("unit_motif") else s["stage"]
        line = f"- [{tag}] {s['storyline']}"
        if s.get("causality"): line += f"\n  → {s['causality']}"
        lines.append(line)
    return "\n".join(lines)

def build_classic_context(paragraphs: list[dict]) -> str:
    if not paragraphs: return ""
    lines = ["[동아시아 고전 참고 — 세계관·분위기]"]
    for p in paragraphs:
        motif_str = (p.get("motif") or "")[:40] or "?"
        space_str = (p.get("space") or "")[:20] or "?"
        lines.append(f"- [{p.get('country','')} / {motif_str} / {space_str}] {p.get('summary','')}")
    return "\n".join(lines)

def build_rag_context(query: str, category: Optional[str] = None, genre: Optional[str] = None, story_arc: Optional[str] = None, country: Optional[str] = None, classic_genre: Optional[str] = None, top_k_scenes: int = 5, top_k_classics: int = 3) -> str:
    scenes = retrieve_scenes(query, category=category if category != "고전" else None, genre=genre, story_arc=story_arc, top_k=top_k_scenes)
    context = build_scene_context(scenes)
    if country and country in CLASSIC_COUNTRIES:
        genre_keywords = [classic_genre] if classic_genre else COUNTRY_TO_GENRES.get(country, [])
        classics = retrieve_classics(query, country=country, genre_keywords=genre_keywords, top_k=top_k_classics)
        if classics: context += "\n\n" + build_classic_context(classics)
    return context

def get_chat_context(query: str, genre: Optional[str] = None, category: Optional[str] = None) -> str:
    scenes = retrieve_scenes(query, category=category, genre=genre, top_k=3)
    return build_scene_context(scenes)

def parse_scenario_to_dict(scenario_text: str) -> dict:
    result = {"제목": "", "기": "", "승": "", "전": "", "결": ""}
    title_match = re.search(r'#{2,4}\s*제목\s*(.+?)(?=#{2,4}|$)', scenario_text, re.DOTALL)
    if title_match: result["제목"] = title_match.group(1).strip().split('\n')[0].strip()
    for heading_pat in [
        r'####\s*([기승전결])(.*?)(?=####\s*[기승전결]|\[예상|$)',
        r'###\s*([기승전결])(.*?)(?=###\s*[기승전결]|\[예상|$)',
        r'##\s*([기승전결])(.*?)(?=##\s*[기승전결]|\[예상|$)',
        r'\*\*([기승전결])[^\n]*\*\*(.*?)(?=\*\*[기승전결][^\n]*\*\*|\[예상|$)',
    ]:
        matches = re.findall(heading_pat, scenario_text, re.DOTALL)
        if matches:
            for key, content in matches: result[key] = content.strip()
            break
    return result

# ---------------------------------------------------------------------------
# LLM 생성 함수 (원본 원칙 100% 완벽 복구)
# ---------------------------------------------------------------------------

def extract_character_names_from_scenario(scenario_text: str, ai_char_name_hint: str = "", user_char_name_hint: str = "") -> dict:
    ai_hint   = f"[AI 캐릭터 이름 확정됨: {ai_char_name_hint}]" if ai_char_name_hint else "[AI 캐릭터: 이름 미확정 — 시나리오에서 추출]"
    user_hint = f"[유저 캐릭터 이름 확정됨: {user_char_name_hint}]" if user_char_name_hint else "[유저 캐릭터: 이름 미확정 — 시나리오에서 추출]"
    raw = vertex_complete(messages=[{"role": "system", "content": "아래 시나리오 본문에서 두 주인공의 이름만 추출해서 JSON으로 반환해.\n출력 형식: {\"ai_name\": \"...\", \"user_name\": \"...\"}\n이름 외에 어떤 설명도 붙이지 말 것."}, {"role": "user", "content": f"{ai_hint}\n{user_hint}\n\n[시나리오]\n{scenario_text[:2000]}"}], temperature=0.0, max_tokens=60, json_mode=True, model="gemini-3.1-flash-lite-preview") or "{}"
    try: return json.loads(raw)
    except: return {}

def generate_intro_display(scenario_ki: str, genre: str, ai_char_name: str = '', user_char_name: str = '') -> str:
    name_hint = ""
    if ai_char_name or user_char_name:
        name_hint = "\n[등장인물 확정 이름 — 반드시 이 이름을 사용할 것]\n"
        if ai_char_name: name_hint += f"- 상대방(AI) 캐릭터: {ai_char_name}\n"
        if user_char_name: name_hint += f"- 유저 캐릭터: {user_char_name}\n"
        name_hint += "원문에 다른 이름이 있더라도 위 이름으로 대체할 것.\n"
    try:
        result = vertex_complete(
            messages=[
                {"role": "system", "content": (
                    "너는 시나리오 소개 전문가야. "
                    "이 시나리오를 처음 접하는 유저가 읽을 '시작 배경' 텍스트를 작성해줘.\n\n"
                    "[규칙]\n"
                    "- 문체: 한다체(서술형)로 작성할 것. '~합니다', '~입니다' 등 합쇼체 절대 금지. '~한다', '~된다', '~이다' 형식 사용.\n"
                    "- 3~4문장으로 작성할 것\n"
                    "- 대화문·지문 형식 절대 금지: 따옴표로 감싼 대사(예: '단아, 너는...'), "
                    "'~라고 말했다' 형식, 인물 행동 묘사 지문 등 모든 대화체·서사 지문 형식 포함 금지. "
                    "출력 전 따옴표('', \"\")가 포함되어 있으면 서술 형식으로 반드시 고칠 것.\n"
                    "- 세계관 고유 용어(장소명·제도·개념 등)가 처음 등장할 때 한 구절 안에서 "
                    "자연스럽게 의미를 알 수 있도록 쓸 것 "
                    "(예: '기억을 사고파는 거래소', '기억을 지배하는 통치 기관' 등)\n"
                    "- 인물 이름·세계관 설정·핵심 갈등을 처음 읽는 사람도 이해할 수 있게 담을 것\n"
                    "- 이야기가 막 시작되려는 순간의 상황을 전달하는 느낌으로 쓸 것\n"
                    "- 요약문만 출력할 것 (제목·레이블 없이)"
                    f"{name_hint}"
                )},
                {"role": "user", "content": f"[장르] {genre}\n\n[기 단계 원문]\n{scenario_ki[:2000]}"},
            ],
            temperature=0.5,
            max_tokens=500,
            model=MODEL_PRO,
        )
        return (result or "").strip()
    except Exception as _e:
        import traceback; traceback.print_exc()
        print(f"[generate_intro_display] 실패, raw 텍스트 fallback: {_e}")
        return scenario_ki[:300]

def generate_scenario_title(user_query: str, genre: str, scenario_ki: str = '', ai_char_name: str = '', content_type: str = '') -> str:
    try:
        context_parts = [f"[장르] {genre}", f"[소재] {user_query}"]
        if content_type:
            context_parts.append(f"[콘텐츠 유형] {content_type}")
        if ai_char_name:
            context_parts.append(f"[주인공 이름] {ai_char_name}")
        if scenario_ki:
            context_parts.append(f"[도입부 내용]\n{scenario_ki[:400]}")
        result = vertex_complete(
            messages=[
                {"role": "system", "content": (
                    "너는 감성적이고 문학적인 한국어 소설 제목 작가야.\n"
                    "주어진 정보를 바탕으로 독자가 끌리는 제목을 15자 이내로 만들어줘.\n\n"
                    "[좋은 제목의 특징]\n"
                    "- 이야기의 핵심 감정·갈등·분위기를 함축할 것\n"
                    "- 독자가 궁금증을 갖게 하는 여운이 있을 것\n"
                    "- 진부하지 않고 고유한 표현을 쓸 것\n"
                    "- 주인공 이름을 그대로 제목에 쓰지 말 것\n\n"
                    "제목만 출력하고 따옴표나 설명은 절대 붙이지 마."
                )},
                {"role": "user", "content": "\n".join(context_parts)},
            ],
            temperature=0.9,
            max_tokens=50,
            model=VERTEX_MODEL_FLASH_LITE,
        )
        return result.strip('"').strip("'").strip()
    except: return "무제"

def generate_query_auto(genre: str, category: str, ai_character: Optional[dict] = None, user_character: Optional[dict] = None, recent_queries: Optional[list[str]] = None) -> str:
    char_hint = ""
    if ai_character or user_character:
        char_hint = "\n[캐릭터 힌트]\n"
        if ai_character: char_hint += f"- AI 캐릭터: {ai_character}\n"
        if user_character: char_hint += f"- 유저 캐릭터: {user_character}\n"
        char_hint += "위 캐릭터 설정과 어울리는 세계관·소재를 만들 것."
    avoid_hint = ""
    if recent_queries:
        items = "\n".join(f"- {q}" for q in recent_queries)
        avoid_hint = f"\n[최근 생성된 소재 — 아래 소재와 유사한 소재는 절대 사용하지 말 것]\n{items}\n"
    return vertex_complete(messages=[{"role": "system", "content": f"너는 {category}용 {genre} 장르의 인터랙티브 스토리 소재 전문가야.\n독창적이고 흥미로운 소재를 1~2문장으로 제안해.\n\n[규칙]\n- 등장인물 이름은 포함하지 말 것\n- 핵심 갈등 + 세계관 설정만 담을 것\n- 진부한 클리셰 피할 것\n{avoid_hint}{char_hint}"}, {"role": "user", "content": f"{genre} 장르 {category}에 어울리는 소재를 하나 제안해줘."}], temperature=1.0, max_tokens=150, model="gemini-3.1-pro-preview")

def generate_scenario_with_rag(user_query: str, genre: str = "판타지", category: str = "시리즈", ai_character: Optional[dict] = None, user_character: Optional[dict] = None, country: Optional[str] = None, classic_genre: Optional[str] = None, recent_names: Optional[list[str]] = None, recent_themes: Optional[list[str]] = None) -> str:
    ai_char_name = (ai_character or {}).get("name", "") or ""
    user_char_name = (user_character or {}).get("name", "") or ""

    avoid_names_block = ""
    if recent_names:
        names_str = ', '.join(recent_names)
        avoid_names_block = (
            f"\n[이름 중복 금지]\n"
            f"최근 생성된 시나리오에서 사용된 이름: {names_str}\n"
            f"위 이름들과 같거나 발음·어감이 유사한 이름(주인공·조연·지명·조직명 모두 해당)은 피하고, 이번 시나리오만의 새로운 이름을 만들 것.\n"
        )

    avoid_themes_block = ""
    if recent_themes:
        themes_str = '\n'.join(f'- {t}' for t in recent_themes)
        avoid_themes_block = (
            f"\n[소재·세계관 중복 금지]\n"
            f"최근 생성된 시나리오 소재:\n{themes_str}\n"
            f"위와 유사한 핵심 설정(기억, 저주, 특정 직업명 등)은 피하고, 이번 시나리오만의 새로운 세계관을 창조할 것.\n"
        )

    ai_name_line   = f"- {ai_char_name}: AI가 담당하는 캐릭터. 역할은 시나리오 소재에 따라 자유롭게 설정할 것." if ai_char_name else \
                     "- [AI 담당 캐릭터, 이름 미지정]: 서사에 어울리는 이름을 직접 짓고, 본문에서 그 이름으로만 지칭할 것."
    user_name_line = f"- {user_char_name}: 유저가 담당하는 캐릭터. 역할은 시나리오 소재에 따라 자유롭게 설정할 것." if user_char_name else \
                     "- [유저 담당 캐릭터, 이름 미지정]: 서사에 어울리는 이름을 직접 짓고, 본문에서 그 이름으로만 지칭할 것."
    rag_context = build_rag_context(query=user_query, category=category if category != "고전" else None, genre=genre, story_arc="기", country=country, classic_genre=classic_genre, top_k_scenes=5) if client else ""
    system_prompt = f"""너는 유저에게 선택권을 넘겨주는 '인터랙티브 게임 마스터'이자 전문 시나리오 작가야.
{category}용 {genre} 장르에 최적화된 기승전결 뼈대를 작성해.
{avoid_names_block}{avoid_themes_block}
등장 캐릭터:
{ai_name_line}
{user_name_line}

[서술 금지]
- 본문에서 'AI 캐릭터', '유저 캐릭터' 같은 역할 레이블을 절대 사용하지 말 것.
- 반드시 캐릭터의 실제 이름(또는 직접 지은 이름)으로만 지칭할 것.

[작성 원칙]
1. 복선: '기' 단계 본문에 복선을 1~2개 자연스럽게 심을 것.
   [조건]
   - 반드시 '기' 단계 본문에 위치할 것.
   - 복선임을 독자가 나중에야 알아채는 방식으로 쓸 것.
   - {ai_char_name}에게만 부여할 것.
   - 별도 항목으로 정리하지 말고 본문 안에 장면으로 녹여낼 것.
   - ★ 자기 검증: 출력 전 '기' 단계를 다시 읽어서 복선 문장이 실제 본문에 존재하는지 확인할 것. 없으면 반드시 추가 후 출력.
   [사용 금지]
   - 행동 지시형: "아이템을 찾아야 한다" 등
   - 추상적 선언: "{ai_char_name}의 비밀이 있다" 등
   - 중요도 노출: "(복선)" 레이블 표시, "그것이 저주와 관련이 있을 것이라 믿게 된다" 등 독자에게 '이게 중요해'라는 신호를 주는 모든 표현 금지.

2. 소재의 스케일 유지: 기승전결의 갈등 규모는 소재의 스케일을 그대로 반영할 것.
   - 소재가 세계적·역사적 규모를 암시하면 (저주의 기원, 세계 멸망, 신화적 사건 등)
     개인 단위 퀘스트가 아닌 그 규모에 맞는 구조 위에서 이야기를 전개할 것.
   - 아래 세 가지 물음이 기승전결 안에 반드시 드러나야 한다:
     ① 갈등의 기원은 무엇인가? (소재의 핵심 긴장)
     ② 어떤 세력·존재가 충돌하는가?
     ③ 해결 조건은 무엇이며, 그것이 왜 어려운가?

3. 장르별 재미 극대화: {genre} 장르의 특성에 맞는 '갈등'과 '긴장감'을 충분히 배치할 것.

4. 선택의 순간: 모든 큰 사건의 끝에는 서사의 핵심 인물이 선택의 기로에 서는
   '결정적 순간'을 포함하여 유저가 개입할 틈을 만들 것.

5. 출력 형식: #### 기, #### 승, #### 전, #### 결로 나누어 작성하고,
   마지막에 [예상되는 멀티 엔딩 조건]을 작성할 것.

   [결 단계 — 엄격 규칙]
   - '결'은 유저가 아직 선택하지 않은 분기점만 제시한다.
     선택의 결과를 AI가 먼저 서술하지 말 것.
   - 금지 예시: "카엘이 리나를 희생하면 저주가 풀리지만…"
   - 허용 예시: "{user_char_name}는 선택의 기로에 선다.
     무엇이 그를 더 붙잡는가 — 그 답이 이 이야기의 결말을 가른다."

   [예상되는 멀티 엔딩 조건 — 엄격 규칙]
   형식:
   - 선택 A: (어떤 상황에서 무엇을 선택하는 경우) → (방향 1~2문장)
   - 선택 B: (어떤 상황에서 무엇을 선택하는 경우) → (방향 1~2문장)
   (선택지는 2~3개)

   금지:
   - A와 B가 논리적으로 모순되거나 실질적으로 같은 방향을 가리키는 경우.
     예시 금지: "포기한다 → 계속 지키기 위해 떠난다"
               (포기와 지킴은 양립 불가 — 이런 모순 절대 금지)
   - 결과를 너무 상세하게 서술하는 것 (방향만, 결말은 유저에게 열어둘 것)
"""

    ai_char_label   = ai_char_name   if ai_char_name   else "상대방 캐릭터"
    user_char_label = user_char_name if user_char_name else "주인공 캐릭터"

    user_prompt = f"""
[사용자 소재]
{user_query}

[등장 캐릭터]
- {ai_char_label}: {ai_character}
- {user_char_label}: {user_character}

[참고 패턴]
{rag_context}

위 내용을 바탕으로 시나리오 뼈대를 작성해줘.

[출력 전 내부 확인 — 확인 결과는 출력하지 말 것]
- '기' 단계 본문에 복선 문장이 실제로 존재하는가?
- 복선이 "이것이 중요하다"는 신호 없이 장면에 녹아있는가?
- 소재의 스케일(기원·세력·해결 조건)이 서사 구조에 반영되어 있는가?
- 선택 A와 B가 논리적으로 모순 없이 서로 다른 방향을 가리키는가?

복선은 '기' 단계 본문 안에만 자연스럽게 녹여 넣고, 별도 항목으로 따로 정리하지 마.
'결' 단계는 분기 상황만 제시하고 결과는 유저에게 열어둬.
마지막에 [예상되는 멀티 엔딩 조건]을 작성해.
"""

    return vertex_complete(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=0.9,
        max_tokens=8192,
        model=MODEL_PRO,
    )

def generate_characters(
    scenario_text: str,
    genre: str,
    category: str,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    country: Optional[str] = None,
    recent_names: Optional[list[str]] = None,
) -> dict:
    ai_info = (
        f"- AI 캐릭터 참고 정보: {ai_character}\n"
        f"  ※ 값이 있는 필드는 절대 변경 금지. 비어있는 필드만 AI가 채울 것."
    ) if ai_character else "- AI 캐릭터: 시나리오에 맞게 AI가 자유 설계"

    user_info = (
        f"- 유저 캐릭터 참고 정보: {user_character}\n"
        f"  ※ 값이 있는 필드는 절대 변경 금지. 비어있는 필드만 AI가 채울 것."
    ) if user_character else "- 유저 캐릭터: 시나리오에 맞게 AI가 자유 설계"

    if category == "고전" and country:
        name_guidance = (
            f"이름은 {country} {genre} 배경에 실제로 존재할 법한 이름으로 지을 것. "
            f"해당 문화권의 언어적 특성과 시대적 분위기를 반영할 것."
        )
    else:
        name_guidance = (
            f"이름은 {genre} 세계관에 자연스럽게 어울리는 이름으로 지을 것. "
            "장르 분위기를 살리되, 이 시나리오만의 독특한 개성이 느껴지는 이름을 선택할 것."
        )

    avoid_names_hint = ""
    if recent_names:
        names_list = ", ".join(recent_names)
        avoid_names_hint = f"\n5. [이름 중복 금지] 최근 사용된 이름: {names_list} — 이 이름들과 겹치거나 유사한 이름(철자·발음·어감이 비슷한 것 포함)은 절대 사용하지 말 것."

    system_prompt = f"""
너는 {category}용 {genre} 스토리의 캐릭터 디자이너야.
시나리오를 분석해서 모든 등장인물을 구조화된 JSON으로 완성해.

[작성 규칙]
1. role: 소재 기반 서사적 역할을 자유 서술. 단순 기능 단어 하나로 끝내지 말 것.
2. context: 챗 시스템이 이 캐릭터를 어떻게 연기해야 하는지 자연어로 1~2문장 서술.
3. 조연 2~4명 포함.
4. [이름 지침] {name_guidance}{avoid_names_hint}
5. [appearance 작성 지침] 반드시 아래 4가지 요소를 모두 포함해서 구체적으로 작성할 것.
   - 얼굴: 눈 모양/색, 눈썹, 피부톤, 얼굴형 등 특징적인 요소
   - 헤어: 길이, 스타일(직모/웨이브/컬 등), 색깔
   - 체형: 키(큰/보통/작은), 체형(마른/보통/근육질 등)
   - 의상: 구체적인 색상과 스타일 (예: "짙은 남색 더블 브레스트 코트에 흰 셔츠")
   추상적·감성적 표현 금지 (예: "단정한 외모", "지적인 인상" 단독 사용 불가).
   장르와 역할에 맞는 의상을 반드시 포함할 것.

[절대 규칙]
- 참고 정보에서 값이 있는 필드는 절대 변경하지 말 것.
- 제공된 필드는 그대로 복사하고, 비어있는 필드만 채울 것.
- ai_character와 user_character의 이름은 반드시 서로 달라야 한다. 동일한 이름 절대 금지.

아래 JSON 형식으로만 출력:
{{
    "ai_character": {{"name": "", "gender": "", "age": "", "role": "", "personality": "", "appearance": "", "background": "", "relationship_to_user": "", "context": ""}},
    "user_character": {{"name": "", "gender": "", "age": "", "role": "", "personality": "", "appearance": "", "background": "", "context": ""}},
    "supporting_characters": [{{"name": "", "gender": "", "age": "", "role": "", "personality": "", "appearance": "", "background": "", "relationship": "", "importance": ""}}]
}}
"""

    user_prompt = f"""
[장르] {genre} / [유형] {category}

[캐릭터 참고 정보]
{ai_info}
{user_info}

[시나리오]
{scenario_text[:2000]}

위 시나리오를 바탕으로 등장인물 구조를 완성해줘.
"""

    raw = vertex_complete(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        temperature=0.9,
        max_tokens=4000,
        json_mode=True,
        model=MODEL_PRO,
    ) or "{}"
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        fence_match = re.search(r'```(?:json)?\s*([\s\S]+?)\s*```', raw)
        if fence_match:
            try:
                result = json.loads(fence_match.group(1))
            except json.JSONDecodeError:
                result = {}
        else:
            brace_match = re.search(r'\{[\s\S]+\}', raw)
            if brace_match:
                try:
                    result = json.loads(brace_match.group(0))
                except json.JSONDecodeError:
                    result = {}
            else:
                result = {}

        if isinstance(result, list):
            result = result[0] if result else {}

        if not result.get("ai_character"):
            result["ai_character"] = (ai_character or {}).copy()
        if not result.get("user_character"):
            result["user_character"] = (user_character or {}).copy()
        if "supporting_characters" not in result:
            result["supporting_characters"] = []

    # 유저 지정 필드 강제 복원 (LLM이 바꿨을 경우 대비)
    if ai_character:
        for k, v in ai_character.items():
            if v:
                result.setdefault("ai_character", {})[k] = v
    if user_character:
        for k, v in user_character.items():
            if v:
                result.setdefault("user_character", {})[k] = v

    # 이름 중복 감지 후처리
    ai_name   = result.get("ai_character",   {}).get("name", "")
    user_name = result.get("user_character", {}).get("name", "")
    if ai_name and user_name and ai_name == user_name:
        user_specified_ai_name = (ai_character or {}).get("name", "")
        if user_specified_ai_name:
            result["ai_character"]["name"] = ai_name + " (AI)"
        else:
            suffixes = ["아", "엘", "리", "에"]
            result["ai_character"]["name"] = ai_name + suffixes[len(ai_name) % len(suffixes)]

    return result

def generate_scenario_full(
    genre: str,
    category: str,
    user_query: Optional[str] = None,
    ai_character: Optional[dict] = None,
    user_character: Optional[dict] = None,
    country: Optional[str] = None,
    classic_genre: Optional[str] = None,
) -> dict:
    """시나리오 빌더 통합 파이프라인."""
    if not user_query:
        user_query = generate_query_auto(genre, category, ai_character=ai_character, user_character=user_character)

    scenario_text = generate_scenario_with_rag(
        user_query=user_query,
        genre=genre,
        category=category,
        ai_character=ai_character,
        user_character=user_character,
        country=country,
        classic_genre=classic_genre,
    )
    scenario_dict = parse_scenario_to_dict(scenario_text)
    
    characters = generate_characters(
        scenario_text=scenario_text,
        genre=genre,
        category=category,
        ai_character=ai_character,
        user_character=user_character,
        country=country,
    )

    return {
        "query":         user_query,
        "scenario_text": scenario_text,
        "scenario_dict": scenario_dict,
        "characters":    characters,
    }
