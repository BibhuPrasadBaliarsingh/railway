FROM maptiler/tileserver-gl

COPY ./data /data

EXPOSE 8080

CMD ["--mbtiles", "/data/bbsr.mbtiles"]