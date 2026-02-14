FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY backend ./backend
COPY frontend/public ./frontend/public

EXPOSE 3000

CMD ["node", "backend/server.js"]
