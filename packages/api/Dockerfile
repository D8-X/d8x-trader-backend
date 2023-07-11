
FROM node:18-alpine
#The arguments inherited from GitHub variables
ARG PORT
ARG PORT_WEBSOCKET
ARG PORT_WEBSOCKET_CLIENT
ARG CHAIN_ID
ARG REDIS_URL
ARG BROKER_KEY
ARG BROKER_FEE_TBPS

WORKDIR /app

# COPY package*.json ./
# COPY yarn.lock ./

COPY . . 

RUN apk add --update python3 make g++ && rm -rf /var/cache/apk/*

RUN yarn install

# COPY . .

#Appended arguments need the below structure of the command to be work
RUN echo -e "PORT_WEBSOCKET=${PORT_WEBSOCKET}\n""PORT_WEBSOCKET_CLIENT=${PORT_WEBSOCKET_CLIENT}\n""PORT=${PORT}\n""REDIS_URL=${REDIS_URL}\n""CHAIN_ID=${CHAIN_ID}\n""SDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n""BROKER_KEY=${BROKER_KEY}\n""BROKER_FEE_TBPS=${BROKER_FEE_TBPS}\n" > .env

# Build the api project
RUN npx lerna run build --scope api

#EXPOSED PORTS
EXPOSE ${PORT_REST}
EXPOSE ${PORT_WEBSOCKET}

CMD ["node", "packages/api/dist/index.js"]

