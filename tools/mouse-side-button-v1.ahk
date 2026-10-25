#SingleInstance Force

; AutoHotkey v1 版本。XButton1 = 后退键，XButton2 = 前进键。
; 如果扩展里改了快捷键，把下面的 ^+x 改成对应组合。

#If WinActive("ahk_exe chrome.exe") || WinActive("ahk_exe msedge.exe")
XButton1::Send ^+x
#If
