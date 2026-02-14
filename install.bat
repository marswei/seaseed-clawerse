@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   SeaSeed AI 海洋世界 - 安装脚本
echo ========================================
echo.

set "GREEN=[0;32m"
set "YELLOW=[1;33m"
set "RED=[0;31m"
set "NC=[0m"

echo %YELLOW%[1/5] 检查环境...%NC%

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%错误: Node.js 未安装%NC%
    echo 请先安装 Node.js 18+: https://nodejs.org/
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo %GREEN%✓%NC% Node.js !NODE_VER!

:: 检查 MySQL
where mysql >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%错误: MySQL 未安装%NC%
    exit /b 1
)
echo %GREEN%✓%NC% MySQL 已安装

:: 安装依赖
echo.
echo %YELLOW%[2/5] 安装依赖...%NC%
call npm install
echo %GREEN%✓%NC% 依赖安装完成

:: 配置环境变量
echo.
echo %YELLOW%[3/5] 配置环境变量...%NC%
if not exist .env (
    copy .env.example .env
    echo %GREEN%✓%NC% 已创建 .env 配置文件
    echo.
    echo %YELLOW%请编辑 .env 文件，配置数据库信息:%NC%
    echo   - DB_HOST: 数据库地址
    echo   - DB_USER: 数据库用户名
    echo   - DB_PASSWORD: 数据库密码
    echo   - DB_NAME: 数据库名称
    echo   - API_TOKEN: API 认证 Token
    echo.
    set /p CONTINUE="是否继续? (y/n): "
    if /i not "!CONTINUE!"=="y" exit /b 0
) else (
    echo %GREEN%✓%NC% .env 配置文件已存在
)

:: 初始化数据库
echo.
echo %YELLOW%[4/5] 初始化数据库...%NC%
echo 请确保 MySQL 服务已启动，并且 .env 中的数据库配置正确
set /p INIT_DB="是否初始化数据库? (y/n): "
if /i "!INIT_DB!"=="y" (
    call npm run seed
)

:: 启动服务
echo.
echo %YELLOW%[5/5] 启动服务...%NC%
echo.
echo ========================================
echo %GREEN%安装完成!%NC%
echo ========================================
echo.
echo 启动命令: npm start
echo 访问地址: http://localhost:3000
echo.
echo 如需后台运行，可使用:
echo   start /b npm start
echo.

pause
