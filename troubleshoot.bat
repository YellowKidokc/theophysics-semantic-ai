@echo off
echo ============================================
echo   Semantic AI - Troubleshooter
echo   Built with Claude (Anthropic)
echo ============================================
echo.

:menu
echo Select an option:
echo.
echo   [1] Check system requirements
echo   [2] Clean reinstall (delete node_modules and reinstall)
echo   [3] Rebuild plugin
echo   [4] Update npm packages
echo   [5] Clear npm cache
echo   [6] Fix vulnerabilities
echo   [7] Show plugin status
echo   [8] Full reset (clean + reinstall + rebuild)
echo   [9] Exit
echo.
set /p choice="Enter choice (1-9): "

if "%choice%"=="1" goto check_system
if "%choice%"=="2" goto clean_reinstall
if "%choice%"=="3" goto rebuild
if "%choice%"=="4" goto update_packages
if "%choice%"=="5" goto clear_cache
if "%choice%"=="6" goto fix_vulnerabilities
if "%choice%"=="7" goto show_status
if "%choice%"=="8" goto full_reset
if "%choice%"=="9" goto end
echo Invalid choice. Please try again.
echo.
goto menu

:check_system
echo.
echo ============================================
echo Checking system requirements...
echo ============================================
echo.

echo Node.js version:
node --version 2>nul || echo [NOT INSTALLED] - Download from https://nodejs.org/
echo.

echo npm version:
npm --version 2>nul || echo [NOT INSTALLED]
echo.

echo Current directory:
cd
echo.

echo Plugin files:
if exist "package.json" (echo [OK] package.json found) else (echo [MISSING] package.json)
if exist "manifest.json" (echo [OK] manifest.json found) else (echo [MISSING] manifest.json)
if exist "main.js" (echo [OK] main.js found - plugin is built) else (echo [NOT BUILT] main.js missing - run install.bat)
if exist "styles.css" (echo [OK] styles.css found) else (echo [MISSING] styles.css)
if exist "node_modules" (echo [OK] node_modules exists) else (echo [MISSING] node_modules - run npm install)
echo.
pause
goto menu

:clean_reinstall
echo.
echo ============================================
echo Clean reinstall...
echo ============================================
echo.
echo Removing node_modules...
if exist "node_modules" rmdir /s /q node_modules
echo Removing package-lock.json...
if exist "package-lock.json" del package-lock.json
echo.
echo Installing fresh dependencies...
call npm install
echo.
echo [OK] Clean reinstall complete!
echo.
pause
goto menu

:rebuild
echo.
echo ============================================
echo Rebuilding plugin...
echo ============================================
echo.
if exist "main.js" (
    echo Removing old build...
    del main.js
)
call npm run build
echo.
if exist "main.js" (
    echo [OK] Rebuild successful!
) else (
    echo [ERROR] Rebuild failed - check errors above
)
echo.
pause
goto menu

:update_packages
echo.
echo ============================================
echo Updating npm packages...
echo ============================================
echo.
echo Checking for outdated packages...
call npm outdated
echo.
echo Updating packages...
call npm update
echo.
echo [OK] Packages updated!
echo.
echo To update to latest major versions, run:
echo   npx npm-check-updates -u
echo   npm install
echo.
pause
goto menu

:clear_cache
echo.
echo ============================================
echo Clearing npm cache...
echo ============================================
echo.
call npm cache clean --force
echo.
echo [OK] npm cache cleared!
echo.
pause
goto menu

:fix_vulnerabilities
echo.
echo ============================================
echo Checking and fixing vulnerabilities...
echo ============================================
echo.
echo Running npm audit...
call npm audit
echo.
echo Attempting automatic fix...
call npm audit fix
echo.
echo [OK] Vulnerability check complete!
echo.
echo If issues remain, you may need to run:
echo   npm audit fix --force
echo   (Warning: this may introduce breaking changes)
echo.
pause
goto menu

:show_status
echo.
echo ============================================
echo Plugin Status
echo ============================================
echo.
echo Package info:
if exist "package.json" (
    echo Name: semantic-ai
    for /f "tokens=2 delims=:," %%a in ('findstr "version" package.json') do echo Version:%%a
)
echo.
echo Build status:
if exist "main.js" (
    echo [BUILT] main.js exists
    for %%A in (main.js) do echo Size: %%~zA bytes
    for %%A in (main.js) do echo Modified: %%~tA
) else (
    echo [NOT BUILT] Run install.bat to build
)
echo.
echo Dependencies:
if exist "node_modules" (
    echo [INSTALLED] node_modules exists
) else (
    echo [NOT INSTALLED] Run npm install
)
echo.
pause
goto menu

:full_reset
echo.
echo ============================================
echo Full Reset
echo ============================================
echo.
echo This will:
echo   - Delete node_modules
echo   - Delete package-lock.json
echo   - Delete main.js
echo   - Reinstall all dependencies
echo   - Rebuild the plugin
echo.
set /p confirm="Are you sure? (y/n): "
if /i not "%confirm%"=="y" goto menu

echo.
echo Cleaning...
if exist "node_modules" rmdir /s /q node_modules
if exist "package-lock.json" del package-lock.json
if exist "main.js" del main.js
echo.
echo Installing dependencies...
call npm install
echo.
echo Building plugin...
call npm run build
echo.
if exist "main.js" (
    echo ============================================
    echo [OK] Full reset complete!
    echo ============================================
) else (
    echo ============================================
    echo [ERROR] Reset completed but build failed
    echo ============================================
)
echo.
pause
goto menu

:end
echo.
echo Goodbye!
exit /b 0
