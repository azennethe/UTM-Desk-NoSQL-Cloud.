# Exporta la autoridad de certificación que el antivirus inserta en el TLS (Avast Web/Mail Shield
# y similares) desde el almacén de Windows, para que Node confíe en ella:
#   powershell -NoProfile -ExecutionPolicy Bypass -File exportar-ca-antivirus.ps1
#   set NODE_EXTRA_CA_CERTS=%TEMP%\ca-antivirus.pem   && npm run dev
# Sin ese ajuste, toda llamada a *.supabase.co falla en Node con UNABLE_TO_VERIFY_LEAF_SIGNATURE
# aunque el navegador y curl funcionen, porque Node trae su propio almacén CA.
$certs = @()
foreach ($store in @('Cert:\LocalMachine\Root', 'Cert:\CurrentUser\Root')) {
  $certs += @(Get-ChildItem $store -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -match 'Avast|Web/Mail Shield|Kaspersky|ESET|Bitdefender|McAfee|Sophos|Fortinet|Zscaler|Websense' })
}
if ($certs.Count -eq 0) { Write-Output 'NO_SE_ENCONTRO_NINGUNA_CA_DE_ANTIVIRUS'; exit 0 }

$lineas = @()
$grupos = @($certs | Group-Object Thumbprint)
foreach ($g in $grupos) {
  $b64 = [Convert]::ToBase64String($g.Group[0].RawData)
  $lineas += '-----BEGIN CERTIFICATE-----'
  foreach ($m in [regex]::Matches($b64, '.{1,64}')) { $lineas += $m.Value }
  $lineas += '-----END CERTIFICATE-----'
}
$pem = Join-Path $env:TEMP 'ca-antivirus.pem'
Set-Content -Path $pem -Value ($lineas -join "`r`n") -Encoding ascii
Write-Output ("CA exportada a " + $pem + " (" + $grupos.Count + " certificado(s))")
