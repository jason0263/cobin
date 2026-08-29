$startupFolder = [Environment]::GetFolderPath('Startup')
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($startupFolder + '\Cobin_AutoStart.lnk')
$shortcut.TargetPath = 'C:\xampp\htdocs\cobin\cobin\run_silent.vbs'
$shortcut.WorkingDirectory = 'C:\xampp\htdocs\cobin\cobin'
$shortcut.Save()
