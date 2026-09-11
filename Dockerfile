FROM maptiler/tileserver-gl

WORKDIR /usr/src/app

COPY ./data /data
COPY ./data /usr/src/app/data
COPY ./config.json ./config.json
COPY ./server.cjs ./server.cjs

EXPOSE 8080

CMD ["node", "server.cjs"]