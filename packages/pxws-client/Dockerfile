
FROM node:18-alpine

# sudo docker build . -t mytest -f ./src/Dockerfile --build-arg PORT=$PORT --build-arg PORT_WEBSOCKET=$PORT_WEBSOCKET --build-arg PORT_WEBSOCKET_CLIENT=$PORT_WEBSOCKET_CLIENT  --build-arg CHAIN_ID=$CHAIN_ID --build-arg REDIS_URL=$REDIS_URL 
# sudo docker run -it mytest
ARG PORT
ARG PORT_WEBSOCKET
ARG PORT_WEBSOCKET_CLIENT
ARG CHAIN_ID
ARG REDIS_URL

WORKDIR /app

COPY package*.json ./

COPY yarn.lock ./

RUN yarn install 

COPY . .

#Appended arguments need the below structure of the command to be work
RUN echo -e "PORT_WEBSOCKET=${PORT_WEBSOCKET}\n""PORT_WEBSOCKET_CLIENT=${PORT_WEBSOCKET_CLIENT}\n""PORT=${PORT}\n""REDIS_URL=${REDIS_URL}\n""CHAIN_ID=${CHAIN_ID}\n""SDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n" > .env

RUN yarn build

#EXPOSED PORTS
EXPOSE ${PORT_WEBSOCKET_CLIENT}

CMD ["yarn", "startWSClient"]
