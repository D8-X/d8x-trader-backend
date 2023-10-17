
FROM node:18-alpine
ARG PORT
ARG MAIN_API_PORT_WEBSOCKET
ARG CHAIN_ID
ARG REDIS_URL

WORKDIR /app

# COPY package*.json ./
# COPY yarn.lock ./

#COPY . . 
COPY ./packages/utils ./packages/utils
COPY ./packages/api ./packages/api
COPY ./package.json .
COPY ./nx.json .
COPY ./lerna.json .
COPY ./config/. ./config/.

RUN yarn install 

# COPY . .

#Appended arguments need the below structure of the command to be work
RUN echo -e "MAIN_API_PORT_WEBSOCKET=${MAIN_API_PORT_WEBSOCKET}\n""PORT=${PORT}\n""REDIS_URL=${REDIS_URL}\n""CHAIN_ID=${CHAIN_ID}\n""SDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n" > .env

# Build the api project
RUN npx lerna run build --scope api

#EXPOSED PORTS
EXPOSE ${MAIN_API_PORT_HTTP}
EXPOSE ${MAIN_API_PORT_WEBSOCKET}

CMD ["node", "packages/api/dist/index.js"]

