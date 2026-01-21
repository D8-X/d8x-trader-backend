FROM node:18-alpine
ARG PORT
ARG MAIN_API_PORT_WEBSOCKET
ARG CHAIN_ID
ARG REDIS_URL

WORKDIR /app

COPY ./packages/utils ./packages/utils
COPY ./packages/api ./packages/api
COPY package.json yarn.lock .
COPY ./nx.json .
COPY ./lerna.json .
COPY ./config/. ./config/.

# Generate .npmrc and install in one step, then clean up
RUN --mount=type=secret,id=npm_token \
    echo "@d8-x:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    yarn install && \
    rm -f .npmrc

# Appended arguments need the below structure of the command to work
RUN echo -e "MAIN_API_PORT_WEBSOCKET=${MAIN_API_PORT_WEBSOCKET}\n""PORT=${PORT}\n""REDIS_URL=${REDIS_URL}\n""CHAIN_ID=${CHAIN_ID}\n""SDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n" > .env

# Build the api project
RUN npx lerna run build --scope api

# EXPOSED PORTS
EXPOSE ${MAIN_API_PORT_HTTP}
EXPOSE ${MAIN_API_PORT_WEBSOCKET}