
FROM node:18-alpine

WORKDIR /app
COPY . . 

RUN apk add --update python3 make g++ && rm -rf /var/cache/apk/*

RUN yarn install
RUN npx lerna run build --scope=referral


# Cd to referral
WORKDIR packages/referral

# Expose the provided API_PORT
EXPOSE ${REFERRAL_API_PORT}
EXPOSE ${HTTP_RPC_URL}

CMD ["yarn", "run-production"]

