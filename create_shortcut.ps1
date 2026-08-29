$desktop = [Environment]::GetFolderPath('Desktop')
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($desktop + '\Cobin_Voice_Call.lnk')
$shortcut.TargetPath = 'C:\xampp\htdocs\cobin\cobin\start_cobin_online.bat'
$shortcut.WorkingDirectory = 'C:\xampp\htdocs\cobin\cobin'
$shortcut.Save()
