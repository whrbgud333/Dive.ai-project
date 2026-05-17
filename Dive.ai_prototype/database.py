from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os

# PostgreSQL 연결 정보 (환경 변수에서 가져오거나 기본값 사용)
# 예: "postgresql://user:password@localhost/dbname"
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sql_app.db")

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in SQLALCHEMY_DATABASE_URL else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
