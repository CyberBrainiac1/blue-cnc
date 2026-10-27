# Puts the Onshape OAuth client secret into the Worker straight from the clipboard.
# 1. In Onshape: GRBL Prep > Keys and secret > Regenerate, then copy the secret (copy nothing after that).
# 2. In this folder run:  .\set_secret.ps1
$s = (Get-Clipboard -Raw).Trim()
if ($s -notmatch '^[A-Za-z0-9+/]+=*$' -or $s.Length -lt 30) {
    Write-Host "The clipboard doesn't hold an Onshape secret (it has $($s.Length) characters, or spaces/symbols). Copy the secret from Onshape and run this again." -ForegroundColor Red
    exit 1
}
$s | npx wrangler secret put CLIENT_SECRET
Write-Host "Secret set ($($s.Length) characters). Tell the main chat to test sign-in."
