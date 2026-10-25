# Starts llama-server in router mode on Windows with the Vulkan build, pinned to the AMD iGPU (the setup measured in this repository).
#   powershell -NoProfile -ExecutionPolicy Bypass -File launch-router.ps1 -Preset C:\llm\models.ini -ApiKey change-me
param(
  [string]$Preset = "$PSScriptRoot\models.example.ini",
  [string]$Server = 'C:\llama.cpp\llama-server.exe',
  [string]$ApiKey = $env:LLAMA_API_KEY,
  [int]$Port = 8080,
  [int]$ModelsMax = 3
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Preset)) { throw "Preset not found: $Preset" }
if (-not $ApiKey) { throw 'Pass -ApiKey <key> or set the LLAMA_API_KEY environment variable.' }
# Hide the NVIDIA Vulkan driver so that Vulkan0 is always the AMD iGPU (remove this line on other machines).
$env:VK_LOADER_DRIVERS_SELECT = '*amd*'
& $Server --models-preset $Preset --models-max $ModelsMax --host 127.0.0.1 --port $Port --api-key $ApiKey
exit $LASTEXITCODE
