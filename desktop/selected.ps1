# Print paths of files selected in the foreground File Explorer window, one per line
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class XkFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@
$h = [XkFg]::GetForegroundWindow().ToInt64()
$shell = New-Object -ComObject Shell.Application
foreach ($w in $shell.Windows()) {
  try {
    if ([int64]$w.HWND -eq $h) {
      foreach ($i in $w.Document.SelectedItems()) { if (-not $i.IsFolder) { $i.Path } }
    }
  } catch {}
}
