
FROM node:18-alpine

WORKDIR /app

# COPY package*.json ./
# COPY yarn.lock ./

COPY . . 

RUN yarn install 

# COPY . .

#Appended arguments need the below structure of the command to be work
RUN echo -e "PORT_WEBSOCKET=${PORT_WEBSOCKET}\n""PORT_WEBSOCKET_CLIENT=${PORT_WEBSOCKET_CLIENT}\n""PORT=${PORT}\n""REDIS_URL=${REDIS_URL}\n""CHAIN_ID=${CHAIN_ID}\n""SDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n""BROKER_KEY=${BROKER_KEY}\n""BROKER_FEE_TBPS=${BROKER_FEE_TBPS}\n" > .env

# Build the project
RUN npx lerna run build --scope referral

#EXPOSED PORTS
EXPOSE ${PORT_REST}
EXPOSE ${PORT_WEBSOCKET}

CMD ["node", "packages/referral/dist/index.js"]

