FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ git
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++ git ffmpeg
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/whatsapp-sessions
EXPOSE 4000
CMD ["node", "dist/main"]
