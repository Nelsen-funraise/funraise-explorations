#!/bin/bash
# 睿鏡 PeakLens — Mac 一鍵啟動（雙擊這個檔案）。第一次會安裝相依套件並建置，之後直接開 server 與瀏覽器。
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "找不到 Node.js。請先安裝：brew install node   （或到 https://nodejs.org 下載 22 LTS）"; read -r -p "按 Enter 關閉"; exit 1
fi
MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 20 ]; then echo "Node 版本太舊（$(node -v)），需要 20 以上：brew upgrade node"; read -r -p "按 Enter 關閉"; exit 1; fi
[ -d node_modules ] || { echo "▶ 第一次執行：安裝相依套件…"; npm install || exit 1; }
NEWEST_SRC=$(find src index.html public/data -type f -newer dist/index.html 2>/dev/null | head -1)
if [ ! -f dist/index.html ] || [ -n "$NEWEST_SRC" ]; then echo "▶ 建置前端…"; npm run build || exit 1; fi
PORT=${PORT:-8790}
echo "▶ 啟動 PeakLens server：http://localhost:$PORT   金鑰設定：http://localhost:$PORT/setup"
( sleep 2; open "http://localhost:$PORT/setup" ) &
PORT=$PORT node server/index.mjs
