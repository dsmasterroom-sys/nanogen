@echo off
echo Starting Nanogen Django Server...

:: 1. 가상환경 활성화 (venv 폴더가 있다고 가정)
if exist venv\Scripts\activate (
    call venv\Scripts\activate
) else (
    echo Virtual environment not found. Please create 'venv' first.
    pause
    exit
)

:: 2. 브라우저 열기 (서버 시작 시간 2초 대기 후 실행)
timeout /t 2 /nobreak >nul
start http://127.0.0.1:8000

:: 3. Django 서버 실행
python manage.py runserver

pause
