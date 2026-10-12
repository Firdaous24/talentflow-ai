# Optional real-browser QA; not part of application startup.
FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /tests
RUN npm install --no-save --package-lock=false playwright@1.58.2
COPY smoke.mjs ./
COPY accuracy-smoke.mjs ./
CMD ["node", "smoke.mjs"]
