FROM node:22-bookworm-slim
WORKDIR /app
COPY server ./server
COPY dist ./dist
ENV OFFICE_BIND=0.0.0.0 OFFICE_PORT=5214 OFFICE_DATA_PATH=/data/office.sqlite
USER node
EXPOSE 5214
CMD ["node", "server/office-server.mjs"]
