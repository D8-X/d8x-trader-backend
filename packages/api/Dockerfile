FROM node:18-alpine

ARG PORT
ARG MAIN_API_PORT_HTTP
ARG MAIN_API_PORT_WEBSOCKET
ARG CHAIN_ID
ARG REDIS_URL
ARG SDK_CONFIG_NAME

WORKDIR /app

COPY ./packages/utils ./packages/utils
COPY ./packages/api ./packages/api
COPY package.json yarn.lock ./
COPY ./nx.json .
COPY ./lerna.json .
COPY ./config/. ./config/.

RUN --mount=type=secret,id=npm_token \
    echo "@d8-x:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    yarn install && \
    rm -f .npmrc

# RUN echo -e "MAIN_API_PORT_WEBSOCKET=${MAIN_API_PORT_WEBSOCKET}\nPORT=${PORT}\nREDIS_URL=${REDIS_URL}\nCHAIN_ID=${CHAIN_ID}\nSDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n" > .env

RUN npx lerna run build --scope api

EXPOSE ${MAIN_API_PORT_HTTP}
EXPOSE ${MAIN_API_PORT_WEBSOCKET}

CMD ["node", "packages/api/dist/index.js"]