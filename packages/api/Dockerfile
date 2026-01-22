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
COPY ./packages/utils/package.json ./packages/utils/
COPY ./packages/api/package.json ./packages/api/

# Install dependencies with authentication
RUN --mount=type=secret,id=npm_token \
    echo "@d8-x:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    yarn install --frozen-lockfile && \
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

CMD ["node", "packages/api/dist/index.js"]