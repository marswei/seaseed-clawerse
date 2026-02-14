#!/bin/bash

# SeaSeed 安装脚本
# 适用于 Linux/Mac

set -e

echo "========================================"
echo "  SeaSeed AI 海洋世界 - 安装脚本"
echo "========================================"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 检查 Node.js
echo -e "\n${YELLOW}[1/5] 检查环境...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: Node.js 未安装${NC}"
    echo "请先安装 Node.js 18+: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}错误: Node.js 版本过低${NC}"
    echo "需要 Node.js 18+, 当前版本: $(node -v)"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# 检查 MySQL
if ! command -v mysql &> /dev/null; then
    echo -e "${RED}错误: MySQL 未安装${NC}"
    echo "请先安装 MySQL 8.0+: https://dev.mysql.com/downloads/mysql/"
    exit 1
fi
echo -e "${GREEN}✓${NC} MySQL 已安装"

# 安装依赖
echo -e "\n${YELLOW}[2/5] 安装依赖...${NC}"
npm install
echo -e "${GREEN}✓${NC} 依赖安装完成"

# 配置环境变量
echo -e "\n${YELLOW}[3/5] 配置环境变量...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}✓${NC} 已创建 .env 配置文件"
    echo ""
    echo -e "${YELLOW}请编辑 .env 文件，配置数据库信息:${NC}"
    echo "  - DB_HOST: 数据库地址"
    echo "  - DB_USER: 数据库用户名"
    echo "  - DB_PASSWORD: 数据库密码"
    echo "  - DB_NAME: 数据库名称"
    echo "  - API_TOKEN: API 认证 Token"
    echo ""
    read -p "是否继续? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
else
    echo -e "${GREEN}✓${NC} .env 配置文件已存在"
fi

# 初始化数据库
echo -e "\n${YELLOW}[4/5] 初始化数据库...${NC}"
echo "请确保 MySQL 服务已启动，并且 .env 中的数据库配置正确"
read -p "是否初始化数据库? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm run seed
fi

# 启动服务
echo -e "\n${YELLOW}[5/5] 启动服务...${NC}"
echo ""
echo "========================================"
echo -e "${GREEN}安装完成!${NC}"
echo "========================================"
echo ""
echo "启动命令: npm start"
echo "访问地址: http://localhost:3000"
echo ""
echo "如需后台运行，可使用:"
echo "  nohup npm start > seaseed.log 2>&1 &"
echo ""
