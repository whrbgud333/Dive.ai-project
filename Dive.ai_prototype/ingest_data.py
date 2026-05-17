import os
import zipfile
import json
from dotenv import load_dotenv
from langchain_community.vectorstores import Chroma
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

# 환경 변수 로드
load_dotenv()

# 1. 환경 설정
embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
persist_directory = "./chroma_db"

def process_zip_files(base_path):
    documents = []
    for root, dirs, files in os.walk(base_path):
        for file in files:
            if file.endswith(".zip"):
                zip_path = os.path.join(root, file)
                print(f"Processing: {zip_path}")
                with zipfile.ZipFile(zip_path, 'r') as z:
                    for name in z.namelist():
                        if name.endswith(".txt") or name.endswith(".json"):
                            with z.open(name) as f:
                                content = f.read().decode('utf-8', errors='ignore')
                                if name.endswith(".json"):
                                    try:
                                        data = json.loads(content)
                                        # AI 허브 데이터 구조에 맞게 텍스트 추출 (예시)
                                        text = data.get("content", str(data))
                                    except:
                                        text = content
                                else:
                                    text = content
                                
                                documents.append(Document(page_content=text, metadata={"source": file, "filename": name}))
    return documents

def main():
    # 데이터 경로 리스트
    data_paths = [
        "./145.다양한 문화콘텐츠 스토리 데이터",
        "./70.동아시아 고전 스토리 데이터"
    ]
    
    all_docs = []
    for path in data_paths:
        if os.path.exists(path):
            all_docs.extend(process_zip_files(path))
    
    if not all_docs:
        print("No documents found.")
        return

    # 텍스트 분할 및 저장
    print(f"Splitting {len(all_docs)} documents...")
    split_docs = text_splitter.split_documents(all_docs)
    
    print(f"Indexing {len(split_docs)} chunks into ChromaDB...")
    vectorstore = Chroma.from_documents(
        documents=split_docs,
        embedding=embeddings,
        persist_directory=persist_directory
    )
    vectorstore.persist()
    print("Ingestion complete!")

if __name__ == "__main__":
    main()
