# syntax=docker/dockerfile:1
# ── mnemos frontend ────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder

WORKDIR /app

# Dependency layer — only re-runs when package.json / package-lock.json change
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --silent

# Source layer — Vite build; npm install layer stays cached on code-only changes
COPY . .
RUN npm run build

# ── Serve with nginx ───────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
    CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
