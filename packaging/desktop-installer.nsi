; DSH 工作站 Windows 安装包（NSIS）。
; 由 scripts/pack-desktop.mjs 填充 {{OUTPUT}}（产物路径）、{{INSTALL}}（待安装目录）、
; {{VERSION}} 与 {{ICON}}（packaging/dsh-station.ico）后调用 makensis。
; 默认安装到 Program Files\dsh-station，已安装过则目录页回显上次安装目录；
; 创建开始菜单/桌面快捷方式与卸载项；用户数据在 ~/.dsh-station 与 ~/.dsh，卸载不触碰。
Unicode true
ManifestDPIAware true

!include "LogicLib.nsh"

!define APPNAME "DSH 工作站"
!define APPID "dsh-station"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\dsh-station"

Name "${APPNAME}"
OutFile "{{OUTPUT}}"
InstallDir "$PROGRAMFILES64\${APPID}"
; 旧版（≤0.0.2）只写过 UninstallString（$INSTDIR\uninstall.exe），InstallDirRegKey 会
; 剥掉最后一段反推出目录；新版优先取 InstallLocation，见 .onInit。
InstallDirRegKey HKLM "${UNINSTKEY}" "UninstallString"
RequestExecutionLevel admin
; 载荷是几百 MB 的 node_modules：存储模式（SetCompress off）会让 setup.exe 是便携 zip 的 3 倍多。
SetCompressor /SOLID lzma
Icon "{{ICON}}"
UninstallIcon "{{ICON}}"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

; 上次安装目录写在卸载键 InstallLocation。注意：NSIS 是 32 位进程，HKLM\Software 会被
; 重定向到 WOW6432Node，读写必须保持同一视图，中途改 SetRegView 64 会留下孤儿卸载项。
Function .onInit
  ReadRegStr $R0 HKLM "${UNINSTKEY}" "InstallLocation"
  ${If} $R0 != ""
    StrCpy $INSTDIR $R0
  ${EndIf}
FunctionEnd

Section "install"
  SetOutPath $INSTDIR
  File /r "{{INSTALL}}\*.*"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\dsh-station.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\dsh-station.exe"

  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "{{VERSION}}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "dsh-station"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\dsh-station.exe"
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "uninstall"
  RMDir /r $INSTDIR
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegKey HKLM "${UNINSTKEY}"
SectionEnd
