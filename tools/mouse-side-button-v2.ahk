#Requires AutoHotkey v2.0
#SingleInstance Force

; 鼠标侧键 -> Reading Helper 的截图快捷键
; XButton1 = 后退键，XButton2 = 前进键（按需换成 XButton2）
; 只在 Chrome / Edge 窗口激活时生效，不影响其它程序。
; 如果扩展里改了快捷键，把下面的 ^+x 改成对应组合。

#HotIf WinActive("ahk_exe chrome.exe") || WinActive("ahk_exe msedge.exe")
XButton1::Send("^+x")
#HotIf
