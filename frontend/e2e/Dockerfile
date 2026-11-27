# Optional real-browser QA; not part of application startup.
FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /tests
RUN npm install --no-save --package-lock=false playwright@1.58.2
COPY smoke.mjs ./
COPY accuracy-smoke.mjs ./
COPY job-smoke.mjs ./
COPY realistic-job-smoke.mjs ./
COPY comparison-workflow-smoke.mjs ./
COPY comparison-results-smoke.mjs ./
COPY real-world-comparison-smoke.mjs ./
COPY final-job-accuracy-smoke.mjs ./
COPY agents-smoke.mjs ./
COPY demo-smoke.mjs ./
COPY auth-smoke.mjs ./
COPY candidate-smoke.mjs ./
COPY recruiter-smoke.mjs ./
COPY screenshots-phase6.mjs ./
COPY screenshots-phase7.mjs ./
COPY screenshots-phase8.mjs ./
COPY native-select.mjs ./
CMD ["node", "smoke.mjs"]
