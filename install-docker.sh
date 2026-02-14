#!/bin/bash

# SeaSeed Docker 部署脚本

set -e

echo "========================================"
echo "  SeaSeed Docker 部署脚本"
echo "========================================"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 检查 Docker
echo -e "\n${YELLOW}[1/4] 检查 Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}错误: Docker 未安装${NC}"
    echo "请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi
echo -e "${GREEN}✓${NC} Docker $(docker --version)"

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}错误: Docker Compose 未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Docker Compose 已安装"

# 配置环境变量
echo -e "\n${YELLOW}[2/4] 配置环境变量...${NC}"
if [ ! -f .env ]; then
    cp .env.docker .env
    echo -e "${GREEN}✓${NC} 已创建 .env 配置文件"
    echo ""
    echo -e "${YELLOW}请编辑 .env 文件:${NC}"
    echo "  - DB_PASSWORD: 设置数据库密码"
    echo "  - API_TOKEN: 设置 API 认证 Token"
    echo ""
    read -p "是否继续? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
else
    echo -e "${GREEN}✓${NC} .env 配置文件已存在"
fi

# 启动服务
echo -e "\n${YELLOW}[3/4] 启动服务...${NC}"
docker-compose up -d --build
echo -e "${GREEN}✓${NC} 服务启动成功"

# 完成
echo -e "\n${YELLOW}[4/4] 完成!${NC}"
echo ""
echo "========================================"
echo -e "${GREEN}部署完成!${NC}"
echo "========================================"
echo ""
echo "访问地址: http://localhost:3000"
echo ""
echo "常用命令:"
echo "  查看日志: docker-compose logs -f"
echo "  停止服务: docker-compose down"
echo "  重启服务: docker-compose restart"
echo ""
