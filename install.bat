@echo off
echo ============================================
echo   Semantic AI - Installer
echo   Built with Claude (Anthropic)
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download and install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Show Node.js version
echo [OK] Node.js found:
node --version
echo.

:: Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not installed!
    echo Please reinstall Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Show npm version
echo [OK] npm found:
npm --version
echo.

:: Install dependencies
echo ============================================
echo Installing dependencies...
echo ============================================
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] npm install failed!
    echo Try running: npm cache clean --force
    echo Then run this script again.
    pause
    exit /b 1
)
echo.
echo [OK] Dependencies installed successfully!
echo.

:: Build the plugin
echo ============================================
echo Building plugin...
echo ============================================
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build failed!
    echo Check the error messages above.
    pause
    exit /b 1
)
echo.

:: Check if main.js was created
if exist "main.js" (
    echo [OK] Build successful! main.js created.
) else (
    echo [WARNING] main.js not found - build may have failed.
)
echo.

echo ============================================
echo   INSTALLATION COMPLETE!
echo ============================================
echo.
echo Next steps:
echo   1. Restart Obsidian (or press Ctrl+Shift+R to reload)
echo   2. Go to Settings ^> Community Plugins
echo   3. Enable "Semantic AI"
echo   4. Go to Settings ^> Semantic AI to configure your API key
echo.
echo Supported AI Providers:
echo   - OpenAI (GPT-4o, GPT-4o-mini)
echo   - Anthropic (Claude 3)
echo   - Ollama (Local, free)
echo   - Custom API endpoints
echo.
pause
