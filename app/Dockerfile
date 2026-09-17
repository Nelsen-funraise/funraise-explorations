# 睿鏡 PeakLens — agent server + static front end in one container (Cloud Run / Render / Fly.io friendly).
# Keys come from environment variables (OPENAI_API_KEY, FISH_API_KEY, CWA_API_KEY, …, PEAKLENS_ACCESS_CODE, PUBLIC_URL).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_CESIUM_ION_TOKEN
ARG VITE_GOOGLE_MAPS_API_KEY
RUN npm run build
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/index.mjs"]
