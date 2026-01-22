FROM node:18-alpine

ARG PORT
ARG MAIN_API_PORT_HTTP
ARG MAIN_API_PORT_WEBSOCKET
ARG CHAIN_ID
ARG REDIS_URL
ARG SDK_CONFIG_NAME

WORKDIR /app

# Copy package files first
COPY package.json yarn.lock ./
COPY ./nx.json .
COPY ./lerna.json .
COPY ./config/. ./config/.

# Copy package-specific package.json files to establish workspace structure
COPY packages/*/package.json packages/*/

# Install dependencies with authentication
RUN --mount=type=secret,id=npm_token \
    echo "@d8-x:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "@D8-X:registry=https://npm.pkg.github.com" >> .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    cat .npmrc && \
    yarn install --frozen-lockfile --verbose && \
    rm -f .npmrc

# Now copy the actual source code
COPY ./packages/utils ./packages/utils
COPY ./packages/api ./packages/api

# Build the api project
RUN npx lerna run build --scope api

# Create .env file
RUN echo -e "MAIN_API_PORT_WEBSOCKET=${MAIN_API_PORT_WEBSOCKET}\nPORT=${PORT}\nREDIS_URL=${REDIS_URL}\nCHAIN_ID=${CHAIN_ID}\nSDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n" > .env

EXPOSE ${MAIN_API_PORT_HTTP}
EXPOSE ${MAIN_API_PORT_WEBSOCKET}

# Use NODE_PATH to help Node find modules in /app/node_modules
ENV NODE_PATH=/app/node_modules

CMD ["node", "packages/api/dist/index.js"]
#CMD ["sh", "-c", "echo '=== Checking for SDK ===' && find /app -name 'd8x-node-sdk' -o -name '@d8-x' && echo '=== Root node_modules ===' && ls -la /app/node_modules/ 2>/dev/null | head -20 && echo '=== API node_modules ===' && ls -la /app/packages/api/node_modules/ 2>/dev/null | head -20 && echo '=== Sleeping for inspection ===' && sleep 3600"]