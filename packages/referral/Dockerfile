
FROM node:18-alpine

WORKDIR /app
COPY ./packages/utils ./packages/utils
COPY ./packages/referral ./packages/referral
COPY ./package.json .
COPY ./nx.json .
COPY ./lerna.json .
COPY ./config/. ./config/.

RUN yarn install
RUN npx lerna run build --scope=referral


# Cd to referral
WORKDIR packages/referral

# Expose the provided API_PORT
EXPOSE ${REFERRAL_API_PORT}
RUN echo -e "DATABASE_URL_REFERRAL\n" > .env

CMD ["yarn", "run-production"]

