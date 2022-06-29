FROM alpine

ENV GIT_SHA=0b3531da70a858c6c7b9d9510fd040e13243ea9a
ENV GIT_REPO=https://github.com/dashodanger/Obsidian

RUN apk add nodejs npm fltk-dev git make g++ freetype-dev libpng-dev libjpeg-turbo-dev cmake
RUN mkdir -p /app/obsidian
WORKDIR /app/obsidian
RUN git init
RUN git remote add origin $GIT_REPO
RUN git fetch --depth 1 origin $GIT_SHA
RUN git checkout FETCH_HEAD
RUN cmake --version
RUN cmake --preset dist
RUN cmake --build --preset dist
WORKDIR /app
ADD app.js config.json options.json util.js package.json package-lock.json /app/
RUN npm install --production

ENTRYPOINT node app.js
