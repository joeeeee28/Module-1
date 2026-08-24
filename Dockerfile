# LearnMate — production image
FROM node:22-alpine

WORKDIR /app

# install deps (leverage layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# build the React frontend
COPY . .
RUN npm run build

# SQLite data lives on a mounted volume (see render.yaml / fly.toml)
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000
CMD ["node", "server/index.js"]
