# Glama / directory sandbox image — builds from GitHub source (dist/ is gitignored).
# CMD is stdio MCP; inspectors must get initialize + tools/list with empty env.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY README.md server.json ./
USER node
ENTRYPOINT ["node", "dist/index.js"]
