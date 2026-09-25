@echo off
chcp 65001 >nul
setlocal
rem 用 %~dp0 取脚本自己所在目录，所以整个文件夹搬到哪都能用
set "APP=%~dp0app"
echo 正在启动「大肥鱼桌宠」开发版（源码直跑，改代码自动热更新）...
echo.
echo 注意：安装版和开发版共用一个数据目录，请先关掉安装版再运行本脚本。
start "" "%APP%\node_modules\electron\dist\electron.exe" "%APP%"
