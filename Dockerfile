FROM maptiler/tileserver-gl

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install express --no-save

COPY ./data /data
COPY ./data ./data
COPY ./config.json ./config.json
COPY ./server.js ./server.js

EXPOSE 8080

CMD ["node", "server.js"]