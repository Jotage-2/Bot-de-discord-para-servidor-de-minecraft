param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('colegio', 'universidad')]
    [string] $World,

    [Parameter(Mandatory = $true)]
    [ValidateSet('start', 'stop', 'reset')]
    [string] $Action
)

$ErrorActionPreference = 'Stop'
Disable-AzContextAutosave -Scope Process | Out-Null
$context = (Connect-AzAccount -Identity).Context
$context = Set-AzContext -SubscriptionId $context.Subscription.Id -DefaultProfile $context
$resourceGroup = 'Minecraft-tht-server'
$vmName = 'Minecraft-server-tht-VM'

function Run-Guest([string] $script) {
    $result = Invoke-AzVMRunCommand -ResourceGroupName $resourceGroup -Name $vmName -CommandId 'RunShellScript' -ScriptString $script -DefaultProfile $context
    return (($result.Value | ForEach-Object { $_.Message }) -join [Environment]::NewLine)
}

$ready = $false
for ($attempt = 1; $attempt -le 18; $attempt++) {
    $vm = Get-AzVM -ResourceGroupName $resourceGroup -Name $vmName -Status -DefaultProfile $context
    $power = ($vm.Statuses | Where-Object { $_.Code -like 'PowerState/*' } | Select-Object -First 1).Code
    if ($power -in @('PowerState/deallocated', 'PowerState/stopped')) {
        if ($Action -eq 'stop') {
            Write-Output 'La VM ya está detenida.'
            return
        }
        Start-AzVM -ResourceGroupName $resourceGroup -Name $vmName -DefaultProfile $context | Out-Null
    }
    elseif ($power -eq 'PowerState/running') {
        try {
            if ((Run-Guest 'echo __MC_READY__') -match '__MC_READY__') {
                $ready = $true
                break
            }
        }
        catch {
            Write-Output "El agente de la VM aún no responde (intento $attempt)."
        }
    }
    Start-Sleep -Seconds 10
}
if (-not $ready) { throw 'La VM no estuvo lista para ejecutar el control de mundos.' }

# The webhook binds World and Action. Neither the webhook body nor Discord text
# is interpolated into a shell command. ValidateSet also rejects other values.
$script = "set -eu; /usr/local/sbin/minecraft-world-control $Action $World; echo __MC_OK__"
$output = Run-Guest $script
if ($output -notmatch '__MC_OK__') { throw "Falló la acción $Action en $World. $output" }
Write-Output "Acción $Action terminada para $World."

if ($Action -eq 'stop') {
    $states = Run-Guest 'if systemctl is-active --quiet minecraft.service || systemctl is-active --quiet minecraft-universidad.service; then echo __MC_ACTIVE__; else echo __MC_BOTH_OFF__; fi'
    if ($states -match '__MC_BOTH_OFF__') {
        Stop-AzVM -ResourceGroupName $resourceGroup -Name $vmName -Force -DefaultProfile $context | Out-Null
        Write-Output 'Los dos mundos están detenidos; VM desasignada.'
    }
}
