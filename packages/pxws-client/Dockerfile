
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
COPY ./packages/pxws-client ./packages/pxws-client
COPY ./package.json .
COPY ./nx.json .
COPY ./lerna.json .
COPY yarn.lock ./
COPY ./config/. ./config/.

RUN yarn install 


#Appended arguments need the below structure of the command to be work
RUN echo -e "MAIN_API_PORT_WEBSOCKET=${MAIN_API_PORT_WEBSOCKET}\n""PORT=${PORT}\n""REDIS_URL=${REDIS_URL}\n""CHAIN_ID=${CHAIN_ID}\n""SDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n" > .env


# Build the pxws project
RUN npx lerna run build --scope pxws-client

CMD ["node", "packages/pxws-client/dist/startIndexPXWSClient.js"]
