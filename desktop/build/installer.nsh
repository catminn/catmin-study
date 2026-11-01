; 右键「发送到 → 学习空间」
!macro customInstall
  CreateShortCut "$SENDTO\学习空间.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend
!macro customUnInstall
  Delete "$SENDTO\学习空间.lnk"
!macroend
