# Stage 1: Build frontend
FROM node:24-alpine AS frontend-builder

WORKDIR /build

# Install frontend dependencies
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# Copy frontend source and build
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Stage 2: Compile backend
# Node 24 only erases types, and the backend is CommonJS with imports without
# extensions, so tsc compiles it to JavaScript here rather than tsx at each start.
FROM node:24-alpine AS backend-builder

WORKDIR /build

# Type declarations and tsc only: the native modules are built in the last stage
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --ignore-scripts

COPY backend/tsconfig.json backend/index.ts ./backend/
COPY backend/src/ ./backend/src/
RUN cd backend && npx tsc --outDir dist --declaration false --declarationMap false

# Stage 3: Production image
FROM node:24-alpine

# Install build dependencies for native modules (sqlite3), curl for LLM cover scan, ffmpeg for image processing,
# tini to pass docker stop's SIGTERM on to node, which as PID 1 would ignore it
RUN apk add --no-cache python3 make g++ sqlite-dev curl ffmpeg tini

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy the compiled backend where its sources were, so that paths built from
# __dirname (../frontend, ../../images) stay the same
COPY --from=backend-builder /build/backend/dist/ ./backend/
COPY backend/migrations/ ./backend/migrations/

# Copy frontend build from stage 1
COPY --from=frontend-builder /build/frontend/build/ ./frontend/

# Copy deployment config
COPY deployment.prod.json ./deployment.json

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the application
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "backend/index.js"]
