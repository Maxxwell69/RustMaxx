param(
  [Parameter(Mandatory = $true)][string]$SftpHost,
  [Parameter(Mandatory = $true)][string]$SftpUser,
  [Parameter(Mandatory = $true)][string]$RemoteDir,
  [Parameter(Mandatory = $true)][string]$RconHost,
  [Parameter(Mandatory = $true)][int]$RconPort,
  [Parameter(Mandatory = $true)][string]$RconPassword,
  [int]$SftpPort = 2222,
  [string]$PluginName = "RustChaos",
  [string]$LocalPluginPath = "plugins/RustChaos/RustChaos.cs"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $LocalPluginPath)) {
  throw "Local plugin file not found: $LocalPluginPath"
}

$normalizedRemoteDir = $RemoteDir.Replace("\", "/").Trim("/")
$remoteFile = "$normalizedRemoteDir/$PluginName.cs"
$scpTarget = "$SftpUser@$SftpHost`:$remoteFile"

Write-Host "Uploading $LocalPluginPath -> $scpTarget"
Write-Host "If prompted, enter your SFTP password."
& scp.exe -P $SftpPort "$LocalPluginPath" "$scpTarget"
if ($LASTEXITCODE -ne 0) {
  throw "SFTP upload failed (scp exit code $LASTEXITCODE)."
}

Write-Host "Upload complete. Reloading plugin via RCON..."
npx tsx scripts/rcon-send.ts `
  --host "$RconHost" `
  --port "$RconPort" `
  --password "$RconPassword" `
  --command "oxide.reload $PluginName"

Write-Host "Done."
