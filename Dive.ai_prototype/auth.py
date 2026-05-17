import os
from datetime import datetime, timedelta
from typing import Optional

import firebase_admin
from firebase_admin import credentials, auth as fb_auth
from jose import jwt, JWTError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dive-ai-dev-secret-change-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30


def _init_firebase():
    if firebase_admin._apps:
        return
    sa_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
    if sa_path:
        cred = credentials.Certificate(sa_path)
    else:
        # GOOGLE_APPLICATION_CREDENTIALS 환경변수 사용 (이미 Vertex AI용으로 설정됨)
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)


_init_firebase()


def verify_firebase_token(id_token: str) -> dict:
    return fb_auth.verify_id_token(id_token, clock_skew_seconds=10)


def create_access_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


_bearer = HTTPBearer(auto_error=False)


def get_current_user_id(creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> int:
    if not creds:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except JWTError:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")

def get_optional_user_id(creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> Optional[int]:
    if not creds:
        return None
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except JWTError:
        return None
