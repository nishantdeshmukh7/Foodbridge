FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npm run prisma:generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# Phase 19: safe-by-default, not merely a convenience default - this image
# has no way to know at build time whether it will be run in a real
# deployment or a local/CI compose stack, and several behaviors (most
# importantly: whether a password-reset link/token can ever be logged - see
# email.service.ts) are gated on NODE_ENV === 'production'. Baking the
# production value into the image means any invocation that does NOT
# explicitly override it (e.g. `docker run` with no -e NODE_ENV=...)
# defaults to the safe behavior instead of the permissive one. A compose
# file that intentionally wants development behavior (see docker-compose.yml)
# still can, and does, override this via its own `environment:` block -
# Compose's environment always wins over an image's baked ENV.
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist

# Phase 28: run as the non-root "node" user that node:20-alpine already
# ships (uid/gid 1000) rather than the image's default root. This app
# never needs to bind a privileged port (<1024) or write anywhere outside
# what's already granted below, so there's no reason to run it as root.
# chown happens before switching USER, while still root, since a
# non-root user can't chown files it doesn't already own.
RUN chown -R node:node /app
USER node

EXPOSE 3001
CMD ["npm", "start"]
