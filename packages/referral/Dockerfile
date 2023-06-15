
FROM node:18-alpine

WORKDIR /app
COPY . . 

RUN yarn install
RUN npx lerna run build --scope=referral


# Cd to referral
WORKDIR packages/referral

# Expose the provided API_PORT
EXPOSE ${REFERRAL_API_PORT}

CMD ["yarn", "run-production"]

