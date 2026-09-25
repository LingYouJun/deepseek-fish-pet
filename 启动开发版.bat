@echo off
chcp 65001 >nul
echo 正在启动「大肥鱼桌宠」开发版（源码直跑，改代码自动热更新）...
echo.
echo 注意：安装版和开发版共用一个数据目录，请先关掉安装版再运行本脚本。
start "" "C:\deepseek\desktop-pet\app\node_modules\electron\dist\electron.exe" "C:\deepseek\desktop-pet\app"
