FROM node:alpine

RUN apk add fltk-dev git make g++ freetype-dev libpng-dev libjpeg-turbo-dev
RUN mkdir /app
WORKDIR /app
RUN git clone https://github.com/samboy/Oblige --depth 1 oblige
WORKDIR /app/oblige
RUN mkdir /app/oblige/obj_linux
RUN mkdir /app/oblige/obj_linux/lua
RUN mkdir /app/oblige/obj_linux/glbsp
RUN mkdir /app/oblige/obj_linux/ajpoly
RUN mkdir /app/oblige/obj_linux/physfs
RUN make
WORKDIR /app
ADD . /app
RUN npm i

ENTRYPOINT node app.js
