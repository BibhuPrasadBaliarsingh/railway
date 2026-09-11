FROM maptiler/tileserver-gl

WORKDIR /usr/src/app

COPY ./data /data
COPY ./data ./data
COPY ./config.json ./config.json
COPY ./server.js ./server.js

EXPOSE 8080

CMD ["node", "server.js"]