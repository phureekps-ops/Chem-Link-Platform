# --- base ---------------------------------------------------------------
FROM node:20-alpine AS base
WORKDIR /app
# Prisma's engine needs OpenSSL to be present and detectable. Alpine's
# default image doesn't ship it, which makes Prisma silently fall back to
# a guessed engine binary that then fails at runtime with a non-JSON
# "Error load..." response (this bit us on Render — see chemlink-backend
# incident: Pre-Deploy `prisma migrate deploy` failing with
# "Could not parse schema engine response: SyntaxError: Unexpected token 'E'").
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
COPY prisma ./prisma

# --- development ----------------------------------------------------------
FROM base AS development
RUN npm install
COPY . .
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# --- build (for production image) -----------------------------------------
FROM base AS build
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
# Fail the BUILD (with a clear message) if the compiler didn't produce the
# expected entry point, instead of only discovering it later as a cryptic
# "Cannot find module '/app/dist/main'" at container start.
RUN ls -la dist && test -f dist/main.js || (echo "BUILD ERROR: dist/main.js was not produced by 'npm run build'" && exit 1)

# --- production ------------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
