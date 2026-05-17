"""
ai_engine.py - AI 모델 및 RAG 엔진 초기화

담당 역할:
  - LLM 인스턴스 생성 (get_llm, get_vertex_llm)
  - AI 응답 텍스트 정규화 (extract_ai_text)
  - RAG 벡터DB 초기화 및 retriever 노출

설계 원칙:
  - FastAPI 의존성(HTTPException 등)을 갖지 않습니다.
    LLM 오류는 ValueError로 raise하고, main.py에서 HTTPException으로 변환합니다.
  - load_dotenv()를 직접 호출하여 단독 import 시에도 환경 변수가 로드됩니다.

외부에서 사용하는 것:
  - get_vertex_llm(model_name) → Vertex AI LLM 인스턴스 반환
  - get_llm(model_name)        → [통합] Vertex AI LLM 인스턴스 반환
  - extract_ai_text(content)   → AI 응답을 항상 str로 정규화
  - retriever → RAG 검색기 (초기화 실패 시 None)
"""

import io
import os
import base64
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv

# ai_engine.py가 단독으로 import될 때도 .env가 로드되도록 보장
load_dotenv()

# ---------------------------------------------------------------------------
# 상수: 모델명
# ---------------------------------------------------------------------------
MODEL_FLASH      = "gemini-3-flash-preview"
MODEL_PRO        = "gemini-3.1-pro-preview"
MODEL_FLASH_LITE = "gemini-3.1-flash-lite-preview"

# Vertex AI Gemini 모델명
VERTEX_MODEL_FLASH      = "gemini-3-flash-preview"       # 배경 작업 기본값
VERTEX_MODEL_FLASH_LITE = "gemini-3.1-flash-lite-preview"  # 단순 반복 작업용
VERTEX_PROJECT          = None   # .env에서 로드
VERTEX_LOCATION         = "us-central1"

# Vertex AI Claude 모델명
CLAUDE_SONNET_MODEL = "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# LLM 팩토리 — Vertex AI (서비스 계정 JSON 방식)
# ---------------------------------------------------------------------------

def get_vertex_llm(model_name: str = None):
    """
    Vertex AI 서비스 계정 인증으로 LLM 인스턴스를 반환합니다.

    GOOGLE_APPLICATION_CREDENTIALS 환경 변수에 서비스 계정 JSON 경로를 설정해야 합니다.

    Args:
        model_name: 사용할 Vertex AI 모델명. None이면 기본값(VERTEX_MODEL_FLASH) 사용.

    Returns:
        ChatVertexAI 인스턴스

    Raises:
        ValueError: 인증 파일이 없거나 초기화에 실패한 경우.
    """
    try:
        from langchain_google_vertexai import ChatVertexAI
    except ImportError:
        raise ValueError(
            "langchain-google-vertexai 패키지가 설치되지 않았습니다. "
            "pip install langchain-google-vertexai 를 실행하세요."
        )

    creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds_path or not os.path.exists(creds_path):
        raise ValueError(
            f"GOOGLE_APPLICATION_CREDENTIALS 경로가 없거나 파일이 존재하지 않습니다: {creds_path}"
        )

    project = os.getenv("VERTEX_PROJECT", "diveai-494805")
    location = os.getenv("VERTEX_LOCATION", "us-central1")

    # model_name 미지정 시 기본 Flash 모델 사용
    target_model = model_name or VERTEX_MODEL_FLASH
    
    # 레거시 모델명 호환성 처리
    name_lower = target_model.lower()
    if "flash-lite" in name_lower or "flash_lite" in name_lower:
        target_model = VERTEX_MODEL_FLASH_LITE
    elif "flash" in name_lower:
        target_model = VERTEX_MODEL_FLASH
    elif "pro" in name_lower:
        target_model = MODEL_PRO # Vertex AI에서도 모델명은 동일하게 사용 가능하거나 매핑 필요

    try:
        from google.oauth2 import service_account

        credentials = service_account.Credentials.from_service_account_file(
            creds_path,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )

        llm = ChatVertexAI(
            model_name=target_model,
            project=project,
            location=location,
            credentials=credentials,
            temperature=0.7,
        )
        print(f"[AI Engine] Vertex AI LLM [{target_model}] (project={project}) 초기화 완료.")
        return llm
    except Exception as e:
        print(f"[AI Engine] Vertex AI LLM 초기화 실패: {e}")
        raise ValueError(f"Vertex AI LLM 초기화 실패: {e}")


def get_llm(model_name: str):
    """
    [통합] 모든 LLM 요청을 Vertex AI로 라우팅합니다.
    기존 Google AI Studio(API Key) 방식 대신 Vertex AI를 사용합니다.
    """
    return get_vertex_llm(model_name)


# ---------------------------------------------------------------------------
# 응답 텍스트 정규화 유틸리티
# ---------------------------------------------------------------------------

def extract_ai_text(content) -> str:
    """
    Gemini API 응답을 항상 순수 문자열로 변환합니다.

    Gemini는 응답을 list[dict] 형태로 줄 때가 있으며,
    각 dict는 {"type": "text", "text": "..."} 구조입니다.
    이 함수는 그 경우에도 텍스트만 추출해 이어 붙입니다.

    Args:
        content: res.content (str 또는 list[dict])

    Returns:
        정규화된 문자열. None이나 빈 값이면 빈 문자열 반환.
    """
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return content or ""


# ---------------------------------------------------------------------------
# Vertex AI 공용 헬퍼 — scenario_builder / chat_engine_v2 전용
# ---------------------------------------------------------------------------

_vertex_credentials_cache = None


def _get_vertex_credentials():
    """서비스 계정 credentials를 모듈 수준에서 한 번만 로드합니다."""
    global _vertex_credentials_cache
    if _vertex_credentials_cache is None:
        from google.oauth2 import service_account
        creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not creds_path or not os.path.exists(creds_path):
            raise ValueError(
                f"GOOGLE_APPLICATION_CREDENTIALS 경로가 없거나 파일이 존재하지 않습니다: {creds_path}"
            )
        _vertex_credentials_cache = service_account.Credentials.from_service_account_file(
            creds_path,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
    return _vertex_credentials_cache


def vertex_complete(
    messages: list,
    max_tokens: int = 1024,
    temperature: float = 0.7,
    json_mode: bool = False,
    model: str = None,
) -> str:
    """
    Vertex AI Gemini로 채팅 완성을 수행합니다. scenario_builder / chat_engine_v2 전용.
    model=None 이면 VERTEX_MODEL_FLASH(gemini-3-flash-preview) 사용.
    단순 반복 작업은 model=VERTEX_MODEL_FLASH_LITE 전달.
    GOOGLE_APPLICATION_CREDENTIALS(JSON) 파일이 없으면 에러를 발생시킵니다.
    """
    try:
        from langchain_google_vertexai import ChatVertexAI
        from langchain_core.messages import SystemMessage as LCSystem, HumanMessage as LCHuman, AIMessage as LCAi
    except ImportError as e:
        raise ValueError(f"langchain-google-vertexai 패키지 필요: {e}")

    creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    if not creds_path or not os.path.exists(creds_path):
        raise ValueError(
            "Vertex AI 서비스 계정 JSON 파일이 없습니다.\n"
            ".env의 GOOGLE_APPLICATION_CREDENTIALS 경로를 확인하세요.\n"
            f"현재 설정된 경로: {creds_path or '(없음)'}"
        )

    credentials = _get_vertex_credentials()
    project  = os.getenv("VERTEX_PROJECT", "diveai-494805")
    location = os.getenv("VERTEX_LOCATION", "us-central1")

    target_model = model or VERTEX_MODEL_FLASH

    # thinking 모델(gemini-3-flash-preview, gemini-3.1-pro-preview)은 max_output_tokens 예산을
    # thinking이 먼저 소비하므로 적은 토큰으로 호출하면 실제 출력이 비어버린다.
    # json_mode: 16384 보장 / 일반 텍스트: 4096 보장 / 비-thinking 모델: 그대로 유지.
    _THINKING_MODELS = {VERTEX_MODEL_FLASH, MODEL_PRO}
    _is_thinking = target_model in _THINKING_MODELS
    if json_mode:
        effective_max_tokens = max(max_tokens, 16384)
    elif _is_thinking:
        effective_max_tokens = max(max_tokens, 4096)
    else:
        effective_max_tokens = max_tokens

    init_kwargs = dict(
        model_name=target_model,
        project=project,
        location=location,
        credentials=credentials,
        temperature=temperature,
        max_output_tokens=effective_max_tokens,
    )
    if json_mode:
        init_kwargs["response_mime_type"] = "application/json"

    llm = ChatVertexAI(**init_kwargs)

    lc_msgs = []
    for msg in messages:
        role, content = msg["role"], msg["content"]
        if role == "system":
            lc_msgs.append(LCSystem(content=content))
        elif role == "user":
            lc_msgs.append(LCHuman(content=content))
        else:
            lc_msgs.append(LCAi(content=content))

    res = llm.invoke(lc_msgs)
    print(f"[vertex_complete] content type={type(res.content).__name__}, json_mode={json_mode}, value={repr(res.content)[:300]}")
    return extract_ai_text(res.content).strip()


# ---------------------------------------------------------------------------
# Claude on Vertex AI 헬퍼
# ---------------------------------------------------------------------------

_anthropic_vertex_client = None


def _get_anthropic_vertex_client():
    """AnthropicVertex 클라이언트를 모듈 수준에서 한 번만 생성합니다."""
    global _anthropic_vertex_client
    if _anthropic_vertex_client is None:
        try:
            from anthropic import AnthropicVertex
        except ImportError:
            raise ValueError(
                "anthropic[vertex] 패키지가 필요합니다. "
                "pip install 'anthropic[vertex]' 를 실행하세요."
            )
        project  = os.getenv("VERTEX_PROJECT", "diveai-494805")
        location = os.getenv("VERTEX_LOCATION", "us-central1")
        _anthropic_vertex_client = AnthropicVertex(project_id=project, region=location)
    return _anthropic_vertex_client


def claude_vertex_complete(
    messages: list,
    max_tokens: int = 1024,
    temperature: float = 0.7,
    json_mode: bool = False,
    use_cache: bool = False,
) -> str:
    """
    Vertex AI Claude Sonnet으로 채팅 완성을 수행합니다.
    시나리오 생성·캐릭터 생성·엔딩 생성 등 고품질 창작 작업 전용.

    Args:
        messages:     [{"role": "system"|"user"|"assistant", "content": "..."}]
        max_tokens:   최대 출력 토큰
        temperature:  생성 온도
        json_mode:    True이면 JSON 출력 요청 문구를 시스템 프롬프트에 추가
        use_cache:    True이면 시스템 프롬프트에 Prompt Caching 적용 (채팅 턴 반복 시 유효)
    """
    client = _get_anthropic_vertex_client()

    system_text = None
    api_messages = []
    for msg in messages:
        if msg["role"] == "system":
            system_text = msg["content"]
        else:
            api_messages.append({"role": msg["role"], "content": msg["content"]})

    if json_mode:
        suffix = "\n\n반드시 유효한 JSON만 출력할 것. 코드 펜스(```)나 다른 텍스트 없이 JSON 객체만 출력."
        system_text = (system_text or "") + suffix

    kwargs = dict(
        model=CLAUDE_SONNET_MODEL,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=api_messages,
    )

    if system_text:
        if use_cache:
            # Prompt Caching: 시스템 프롬프트를 캐싱하여 반복 호출 시 입력 비용 90% 절감
            kwargs["system"] = [
                {"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}
            ]
        else:
            kwargs["system"] = system_text

    response = client.messages.create(**kwargs)
    return response.content[0].text.strip()


# ---------------------------------------------------------------------------
# Gemini 3.1 Flash Image 전용 헬퍼 (Nano Banana 2)
# ---------------------------------------------------------------------------

_SYSTEM_CINEMATIC = (
    "You are a professional cinematic image generator. "
    "Generate exactly ONE single standalone scene — never a collage, triptych, reference sheet, or multi-panel layout. "
    "Do not include any text, titles, logos, or watermarks in the image. "
    "Strictly follow the character's physical description provided in the prompt, "
    "even if it contains unusual, anomalous, or supernatural traits. Do not attempt to 'correct' them."
)

_SYSTEM_WEBTOON = (
    "You are a professional Korean webtoon (manhwa) illustrator. "
    "Your output must be ONE single vertical portrait illustration — a single character, single angle, single pose, single frame. "
    "CRITICAL: NEVER produce character sheets, reference sheets, turnarounds, front/side/back views, triptychs, side-by-side panels, or multi-angle layouts. "
    "This is a PORTRAIT illustration, not a character design sheet. Generate a single centered close-up or waist-up view only. "
    "Generate high-quality webtoon-style character illustrations with clean line art and cel-shading. "
    "Do not include any text, speech bubbles, panel borders, dialogue boxes, watermarks, or logos in the image. "
    "Strictly follow the character's physical description exactly as written — do not omit or soften any traits. "
    "Never add extra characters or background people. Keep backgrounds simple unless specified."
)

_SYSTEM_WEBTOON_COVER = (
    "You are a professional Korean webtoon (manhwa) illustrator specializing in cover art. "
    "Generate exactly ONE single standalone cover illustration — never a collage, triptych, or multi-panel layout. "
    "Generate high-quality webtoon-style cover illustrations with clean line art and cel-shading. "
    "When reference images are provided, reproduce those characters' exact faces and appearances faithfully. "
    "Do not include any text, speech bubbles, panel borders, watermarks, or logos. "
    "Fill the entire canvas with the illustration."
)

_SYSTEM_WEBTOON_CLASSIC = (
    "You are a professional Korean webtoon (manhwa) illustrator specializing in historical stories. "
    "Generate exactly ONE single-angle, single-panel illustration. "
    "NEVER produce character sheets, reference sheets, turnarounds, triptychs, side-by-side panels, or multi-angle layouts — even if the prompt describes a character. "
    "Generate high-quality webtoon-style character illustrations with clean line art and cel-shading, "
    "accurately depicting period-accurate traditional costumes and historical settings. "
    "Do not include any text, speech bubbles, panel borders, dialogue boxes, watermarks, or logos. "
    "Strictly follow the character's physical description. Never add extra characters or background people."
)

_SYSTEM_WEBTOON_CLASSIC_COVER = (
    "You are a professional Korean webtoon (manhwa) illustrator specializing in historical cover art. "
    "Generate exactly ONE single standalone cover illustration — never a collage, triptych, or multi-panel layout. "
    "Generate high-quality webtoon-style cover illustrations with clean line art and cel-shading, "
    "accurately depicting period-accurate traditional costumes and historical settings. "
    "When reference images are provided, reproduce those characters' exact faces and appearances faithfully. "
    "Do not include any text, speech bubbles, panel borders, watermarks, or logos. "
    "Fill the entire canvas with the illustration."
)

def _crop_to_portrait(data_url: str) -> str:
    """
    가로로 넓은 이미지(multi-panel)를 중앙 1컷으로 크롭합니다.
    - width/height > 1.4 이면 multi-panel로 판단
    - 3컷(ratio > 2.2): 가운데 1/3 크롭
    - 2컷(ratio > 1.4): 왼쪽 절반 크롭 (클로즈업이 보통 왼쪽)
    """
    try:
        from PIL import Image
        header, b64data = data_url.split(",", 1)
        img = Image.open(io.BytesIO(base64.b64decode(b64data)))
        w, h = img.size
        ratio = w / h
        if ratio > 2.2:
            print(f"[crop_to_portrait] 3컷 감지 (ratio={ratio:.2f}) → 가운데 1/3 크롭")
            third = w // 3
            img = img.crop((third, 0, third * 2, h))
        elif ratio > 1.4:
            print(f"[crop_to_portrait] 2컷 감지 (ratio={ratio:.2f}) → 왼쪽 절반 크롭")
            img = img.crop((0, 0, w // 2, h))
        else:
            print(f"[crop_to_portrait] 정상 1컷 (ratio={ratio:.2f}) → 크롭 없음")
            return data_url
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        cropped_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{cropped_b64}"
    except Exception:
        return data_url


def gemini_generate_image(
    prompt: str,
    reference_images: list = None,
    aspect_ratio: str = "1:1",
    resolution: str = "2K", # "1K", "2K", "4K"
    seed: int = None,
    system_instruction: str = None,
    crop_portrait: bool = False,
) -> str:
    """
    Gemini 3.1 Flash Image (Nano Banana 2) 모델을 사용하여 이미지를 생성합니다.
    멀티모달 이미지 참조 및 고해상도(2K, 4K)를 지원합니다.
    system_instruction: None이면 시네마틱(기본), _SYSTEM_WEBTOON/_SYSTEM_WEBTOON_COVER 전달 가능.
    crop_portrait: True이면 생성 후 multi-panel 여부를 감지해 1컷으로 크롭합니다.
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise ValueError("google-genai 패키지가 필요합니다. pip install google-genai 를 실행하세요.")

    project = os.getenv("VERTEX_PROJECT", "diveai-494805")
    location = os.getenv("VERTEX_LOCATION", "us-central1")

    # Vertex AI 클라이언트 초기화
    client = genai.Client(vertexai=True, project=project, location=location)
    
    # 해상도 매핑
    res_map = {
        "1K": "1024",
        "2K": "2048",
        "4K": "4096"
    }
    target_res = res_map.get(resolution, "2048")

    # 멀티모달 콘텐츠 구성
    contents = []
    
    # 1. 이미지 참조가 있는 경우 (Subject Reference)
    if reference_images:
        import requests as _requests
        n = len(reference_images)
        for i, img_data in enumerate(reference_images):
            if isinstance(img_data, str) and img_data.startswith("http"):
                # Firebase URL 등 HTTP URL → 다운로드 후 bytes로 전달
                try:
                    _res = _requests.get(img_data, timeout=15)
                    _res.raise_for_status()
                    raw_bytes = _res.content
                except Exception as _e:
                    print(f"[gemini_generate_image] 이미지 다운로드 실패 ({img_data[:60]}...): {_e}")
                    continue
                part = types.Part.from_bytes(data=raw_bytes, mime_type="image/jpeg")
            elif isinstance(img_data, str) and "base64," in img_data:
                raw_bytes = base64.b64decode(img_data.split("base64,")[1])
                part = types.Part.from_bytes(data=raw_bytes, mime_type="image/png")
            elif isinstance(img_data, str):
                raw_bytes = base64.b64decode(img_data)
                part = types.Part.from_bytes(data=raw_bytes, mime_type="image/png")
            else:
                part = types.Part.from_bytes(data=img_data, mime_type="image/png")
            contents.append(part)

        # 얼굴 일관성 강화 안내
        if n >= 2:
            ref_text = (
                "Image 0 shows the exact face and full appearance of Character 1. "
                "Image 1 shows the exact face and full appearance of Character 2. "
                "Reproduce BOTH characters exactly as shown in their reference images — "
                "same face structure, same hair, same features. Do not alter their appearance. "
            )
        else:
            ref_text = (
                "Image 0 shows the exact face and full appearance of the main character. "
                "Reproduce this character exactly as shown — same face, same hair, same features. "
            )
        prompt = ref_text + prompt

    # 2. 텍스트 프롬프트 추가
    contents.append(types.Part.from_text(text=prompt))

    # 생성 설정
    config = types.GenerateContentConfig(
        system_instruction=system_instruction or _SYSTEM_CINEMATIC,
        temperature=1.0,
    )
    
    # 이미지 생성 옵션 (모델마다 파라미터명이 다를 수 있으나 standard flow)
    # 실제 구현은 Imagen-like 파라미터 대신 Gemini Multimodal Generation 흐름을 따름
    response = client.models.generate_content(
        model="gemini-3.1-flash-image-preview",
        contents=contents,
        config=config
    )
    
    # 응답에서 이미지 데이터 추출 (Base64 형식으로 반환)
    # Gemini Image 모델은 응답 파트에 직접 이미지를 포함함
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            img_b64 = base64.b64encode(part.inline_data.data).decode('utf-8')
            result = f"data:image/png;base64,{img_b64}"
            if crop_portrait:
                result = _crop_to_portrait(result)
            return result

    return None


class _OverloadError(Exception):
    pass


class _RAIImageFilteredError(Exception):
    """RAI 필터가 reference 이미지 포함 요청을 차단했을 때 발생."""
    pass


def generate_cinematic_video(
    prompt: str,
    reference_image_b64: Optional[str] = None,
    resolution: str = "720p",
    _retry: int = 0,
) -> str:
    """
    Vertex AI Veo 3.1 Fast 모델로 시네마틱 영상을 생성합니다.
    완료 후 GCS URI를 반환합니다. (gs://버킷/경로/sample_0.mp4)
    서버 과부하 시 최대 3회 30초 간격으로 자동 재시도합니다.
    """
    import time
    try:
        return _generate_cinematic_video_inner(prompt, reference_image_b64, resolution)
    except _OverloadError as e:
        if _retry < 3:
            wait = 30 * (_retry + 1)
            print(f"[Veo] 서버 과부하 감지. {wait}초 후 재시도 ({_retry + 1}/3)...")
            time.sleep(wait)
            return generate_cinematic_video(prompt, reference_image_b64, resolution, _retry + 1)
        raise ValueError(f"[Veo] 서버 과부하로 생성 실패 (3회 재시도 초과): {e}")


def _generate_cinematic_video_inner(
    prompt: str,
    reference_image_b64: Optional[str] = None,
    resolution: str = "720p",
) -> str:
    """generate_cinematic_video 내부 구현."""
    import time
    import requests as _requests
    import google.auth
    import google.auth.transport.requests

    project = os.getenv("VERTEX_PROJECT", "diveai-494805")
    location = "us-central1"
    bucket = "diveai-494805.firebasestorage.app"
    timestamp = int(time.time())
    storage_uri = f"gs://{bucket}/videos/veo_{timestamp}/"

    # Vertex AI 인증
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    auth_req = google.auth.transport.requests.Request()
    credentials.refresh(auth_req)

    def _headers():
        if credentials.expired:
            credentials.refresh(auth_req)
        return {
            "Authorization": f"Bearer {credentials.token}",
            "Content-Type": "application/json",
        }

    base_url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/veo-3.1-fast-generate-001"

    # 인스턴스 구성 (이미지 참조 선택적 포함)
    instance: dict = {"prompt": prompt}
    if reference_image_b64:
        b64_data = reference_image_b64.split("base64,")[1] if "base64," in reference_image_b64 else reference_image_b64
        instance["image"] = {"bytesBase64Encoded": b64_data, "mimeType": "image/png"}

    # 1. 영상 생성 요청
    resp = _requests.post(
        f"{base_url}:predictLongRunning",
        headers=_headers(),
        json={
            "instances": [instance],
            "parameters": {
                "storageUri": storage_uri,
                "sampleCount": 1,
                "resolution": resolution,
            },
        },
        timeout=30,
    )
    if not resp.ok:
        print(f"[Veo] 400/오류 응답 본문: {resp.text}")
    resp.raise_for_status()
    operation_name = resp.json().get("name")
    if not operation_name:
        raise ValueError(f"[Veo] operation name 없음: {resp.text}")
    print(f"[Veo] 생성 요청 완료. operation={operation_name}")

    # 2. 완료 폴링 (최대 10분, 15초 간격)
    for elapsed in range(15, 601, 15):
        time.sleep(15)
        poll = _requests.post(
            f"{base_url}:fetchPredictOperation",
            headers=_headers(),
            json={"operationName": operation_name},
            timeout=30,
        )
        poll.raise_for_status()
        result = poll.json()
        print(f"[Veo] 폴링 {elapsed}초, done={result.get('done', False)}")
        if result.get("done"):
            # 서버 과부하 에러 감지
            if result.get("error"):
                err_msg = result["error"].get("message", "")
                err_code = result["error"].get("code", 0)
                if err_code == 8 or "high load" in err_msg.lower():
                    raise _OverloadError(f"[Veo] 서버 과부하: {err_msg}")
                raise ValueError(f"[Veo] 서버 에러: {result}")

            videos = result.get("response", {}).get("videos", [])
            if not videos:
                rai_count = result.get("response", {}).get("raiMediaFilteredCount", 0)
                if rai_count:
                    if reference_image_b64:
                        print(f"[Veo] RAI 필터 감지 (이미지 포함). 상위 핸들러에서 대체 이미지 시도.")
                        raise _RAIImageFilteredError("RAI 필터 감지 (이미지 포함)")
                    else:
                        print(f"[Veo] RAI 필터 감지 (텍스트 전용). 간소화 프롬프트 재시도 필요.")
                        raise ValueError(f"[RAI_FILTERED] 텍스트 프롬프트 차단: {result}")
                raise ValueError(f"[Veo] 영상 없음: {result}")
            gcs_uri = videos[0].get("gcsUri")
            print(f"[Veo] 생성 완료: {gcs_uri}")
            return gcs_uri

    raise TimeoutError("[Veo] 영상 생성 타임아웃 (10분)")


def generate_bgm_lyria(prompt: str) -> Optional[str]:
    """
    Vertex AI Lyria 3 Pro 모델을 사용하여 약 180초(3분) 분량의 BGM을 생성합니다.
    (방어적 Interactions API 및 Global 지역 사용)
    """
    try:
        from google import genai
    except ImportError:
        raise ValueError("google-genai 패키지가 필요합니다. pip install -U google-genai 를 실행하세요.")

    project = os.getenv("VERTEX_PROJECT", "diveai-494805")
    # BGM은 시스템 설정과 상관없이 반드시 global에서 작동해야 함
    client = genai.Client(vertexai=True, project=project, location="global")

    try:
        import time
        start_time = time.time()
        print(f"[generate_bgm_lyria] [1/3] Lyria 3 Pro 생성 요청 시작 (Location: global)...")
        
        # 1. Interaction 생성
        interaction = client.interactions.create(
            model="lyria-3-pro-preview",
            input=prompt,
        )
        print(f"[generate_bgm_lyria] [2/3] API 응답 수신 완료 (소요시간: {time.time() - start_time:.2f}초)")

        # 2. 방어적 데이터 추출 (outputs 또는 steps 탐색)
        audio_content = None
        
        # 우선순위 1: 최신 SDK의 'outputs' 속성 확인
        outputs = getattr(interaction, 'outputs', []) or []
        for output in outputs:
            if getattr(output, 'type', None) == "audio":
                audio_content = output
                break
        
        # 우선순위 2: 이전/특정 버전의 'steps' 속성 확인
        if not audio_content:
            steps = getattr(interaction, 'steps', []) or []
            for step in steps:
                if getattr(step, 'type', None) == "model_output":
                    content = getattr(step.model_output, 'content', None)
                    parts = getattr(content, 'parts', []) or []
                    for part in parts:
                        if getattr(part, 'inline_data', None):
                            audio_content = part.inline_data
                            break
                if audio_content: break

        # 3. 데이터 반환 (Base64 인코딩 처리)
        if audio_content:
            data = getattr(audio_content, 'data', None)
            if data:
                # 데이터가 bytes인 경우 인코딩, 이미 str(base64)인 경우 그대로 사용
                if isinstance(data, bytes):
                    audio_b64 = base64.b64encode(data).decode('utf-8')
                else:
                    audio_b64 = str(data)
                
                print("[generate_bgm_lyria] BGM 생성 성공.")
                return f"data:audio/mp3;base64,{audio_b64}"
            
        print(f"[generate_bgm_lyria] 오디오 데이터를 찾을 수 없습니다. (객체 구조: {dir(interaction)})")
        return None
        
    except Exception as e:
        print(f"[generate_bgm_lyria] 오류 발생: {e}")
        return None


# RAG는 scenario_builder.py (OpenAI + vectordb)에서 처리합니다.
