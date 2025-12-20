# Deploy Guide: Nanogen Django on New PC

다른 PC에서 이 프로젝트를 설치하고 실행하기 위한 가이드입니다.

## 1. 사전 준비
- **Git** 설치: https://git-scm.com/
- **Python** (3.10 이상) 설치: https://www.python.org/

## 2. 프로젝트 다운로드 (Clone)
명령 프롬프트(cmd) 또는 터미널을 열고 원하는 폴더에서 아래 명령어를 실행하세요.
```bash
git clone https://github.com/Master2DS/nanogen_django.git
cd nanogen_django
```

## 3. 가상환경 생성 및 패키지 설치
독립된 환경 구성을 위해 가상환경 사용을 권장합니다.

**Windows:**
```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

**Mac/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 4. 환경 변수 설정 (.env 파일 생성)
보안상 `.env` 파일은 GitHub에 업로드되지 않았습니다. 프로젝트 폴더(nanogen_django) 내에 `.env` 파일을 직접 생성하고, 아래 내용을 복사해 넣으세요.
(**API 키는 본인의 키로 채워야 합니다.**)

**파일명:** `.env`
```env
# Google Gemini API Key (필수)
GOOGLE_API_KEY=여기에_당신의_API_키를_입력하세요
GEMINI_API_KEY=여기에_당신의_API_키를_입력하세요

# GitHub Token (배포용, 선택사항)
GITHUB_tokens=ghp_DUMMY_REMOVED_TOKEN_12345
```

## 5. 데이터베이스 초기화
데이터베이스 파일(`db.sqlite3`)도 업로드되지 않았으므로, 새로 생성해야 합니다.
```bash
python manage.py migrate
python manage.py createsuperuser
# (ID, Email, Password 입력)
```

## 6. 서버 실행
```bash
python manage.py runserver
```
브라우저에서 `http://127.0.0.1:8000` 접속

## 7. 초기 설정 (Prompt Generator)
앱 실행 후, **Prompt Generator** 페이지에서 "Reset to Defaults" 버튼(또는 관련 기능)을 한 번 실행하거나, 관리자 페이지(`http://127.0.0.1:8000/admin`)를 통해 초기 데이터가 필요한 경우 확인해주세요.
(현재 로직상 `DEFAULT_PRESETS`가 코드에 있어 리셋 기능 사용 시 자동 복구됩니다.)
