param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('colegio', 'universidad')]
    [string] $World,

    [Parameter(Mandatory = $true)]
    [object] $WebhookData
)

$ErrorActionPreference = 'Stop'
if (-not $WebhookData.RequestBody) { throw 'Falta el cuerpo del webhook.' }
$request = ConvertFrom-Json -InputObject $WebhookData.RequestBody
$version = [string] $request.version
$mode = [string] $request.mode
if ($version -notmatch '^\d+(?:\.\d+){1,2}$' -or $version.Length -gt 16) {
    throw 'Versión inválida.'
}
if ($mode -notin @('preserve', 'reset')) { throw 'Modo inválido.' }

Disable-AzContextAutosave -Scope Process | Out-Null
$context = (Connect-AzAccount -Identity).Context
$context = Set-AzContext -SubscriptionId $context.Subscription.Id -DefaultProfile $context
$resourceGroup = 'Minecraft-tht-server'
$vmName = 'Minecraft-server-tht-VM'

function Run-Guest([string] $script) {
    $result = Invoke-AzVMRunCommand -ResourceGroupName $resourceGroup -Name $vmName -CommandId 'RunShellScript' -ScriptString $script -DefaultProfile $context
    return (($result.Value | ForEach-Object { $_.Message }) -join [Environment]::NewLine)
}

$vm = Get-AzVM -ResourceGroupName $resourceGroup -Name $vmName -Status -DefaultProfile $context
$power = ($vm.Statuses | Where-Object { $_.Code -like 'PowerState/*' } | Select-Object -First 1).Code
$startedHere = $power -in @('PowerState/deallocated', 'PowerState/stopped')
if ($startedHere) {
    Start-AzVM -ResourceGroupName $resourceGroup -Name $vmName -DefaultProfile $context | Out-Null
}

try {
    $ready = $false
    for ($attempt = 1; $attempt -le 18; $attempt++) {
        try {
            if ((Run-Guest 'echo __MC_READY__') -match '__MC_READY__') {
                $ready = $true
                break
            }
        }
        catch {
            Write-Output "El agente aún no responde (intento $attempt)."
        }
        Start-Sleep -Seconds 10
    }
    if (-not $ready) { throw 'La VM no estuvo lista para cambiar Paper.' }

    # World, version and mode have fixed choices or a strict numeric pattern.
    # The guest script independently checks Mojang releases and Paper stable builds.
    $script = "set -eu; /usr/bin/python3 /usr/local/sbin/change-minecraft-version.py $World $version $mode; echo __MC_VERSION_OK__"
    $output = Run-Guest $script
    if ($output -notmatch '__MC_VERSION_OK__') { throw "Falló el cambio de versión. $output" }
    Write-Output "Cambio solicitado para $World a $version ($mode). $output"
}
finally {
    if ($startedHere) {
        try {
            $states = Run-Guest 'if systemctl is-active --quiet minecraft.service || systemctl is-active --quiet minecraft-universidad.service; then echo __MC_ACTIVE__; else echo __MC_BOTH_OFF__; fi'
            if ($states -match '__MC_BOTH_OFF__') {
                Stop-AzVM -ResourceGroupName $resourceGroup -Name $vmName -Force -DefaultProfile $context | Out-Null
                Write-Output 'La VM estaba apagada y volvió a quedar desasignada.'
            }
        }
        catch {
            Write-Warning 'No se pudo comprobar si corresponde desasignar la VM; revisa su estado en Azure.'
        }
    }
}
