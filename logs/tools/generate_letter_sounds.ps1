# Generates bespoke phonics audio for each letter a-z into audio/letters/*.wav
# using Windows SAPI (Microsoft Hazel, en-GB) with explicit IPA pronunciations,
# so the synthesizer can never "spell out" a pseudo-word like puh -> "pee you aitch".
#
# Tweak a sound: edit its IPA string below and re-run this script, then commit.
# IPA chars are built from [char] codes so this file stays ASCII-safe in PS 5.1.
#
# Usage:  powershell -File logs\tools\generate_letter_sounds.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$schwa  = [string][char]0x0259   # @  (about)
$ae     = [string][char]0x00E6   # ae (cat)
$eps    = [string][char]0x025B   # e  (bed)
$smallI = [string][char]0x026A   # i  (bit)
$turnedAlpha = [string][char]0x0252  # o (hot, UK)
$wedge  = [string][char]0x028C   # u  (cup)
$scriptG = [string][char]0x0261  # g
$ezh    = [string][char]0x0292   # zh (as in dZ -> j sound)
$turnedR = [string][char]0x0279  # r (approximant)
$long   = [string][char]0x02D0   # length mark

# Phonics sounds (UK synthetic phonics): continuants are lengthened, plosives
# get the shortest possible schwa release. Each entry: primary IPA, then a
# simpler fallback in case the voice rejects the primary.
$sounds = [ordered]@{
  a = @($ae, $ae)
  b = @(('b' + $schwa), ('b' + $schwa))
  c = @(('k' + $schwa), ('k' + $schwa))
  d = @(('d' + $schwa), ('d' + $schwa))
  e = @($eps, $eps)
  f = @(('f' + $long), 'f')
  g = @(($scriptG + $schwa), ('g' + $schwa))
  h = @(('h' + $schwa), ('h' + $schwa))
  i = @($smallI, $smallI)
  j = @(('d' + $ezh + $schwa), ('d' + $ezh + $schwa))
  k = @(('k' + $schwa), ('k' + $schwa))
  l = @(('l' + $long), 'l')
  m = @(('m' + $long), 'm')
  n = @(('n' + $long), 'n')
  o = @($turnedAlpha, $turnedAlpha)
  p = @(('p' + $schwa), ('p' + $schwa))
  q = @(('kw' + $schwa), ('kw' + $schwa))
  r = @(($turnedR + $long), ($turnedR + $schwa))
  s = @(('s' + $long), 's')
  t = @(('t' + $schwa), ('t' + $schwa))
  u = @($wedge, $wedge)
  v = @(('v' + $long), 'v')
  w = @(('w' + $schwa), ('w' + $schwa))
  x = @('ks', 'ks')
  y = @(('j' + $schwa), ('j' + $schwa))
  z = @(('z' + $long), 'z')
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$outDir   = Join-Path $repoRoot 'audio\letters'
New-Item -ItemType Directory -Force $outDir | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Hazel Desktop')
$synth.Rate = -2   # slow and clear for a child

$failed = @()
foreach ($letter in $sounds.Keys) {
  $primary, $fallback = $sounds[$letter]
  $out = Join-Path $outDir ($letter + '.wav')
  $ok = $false
  foreach ($ipa in @($primary, $fallback)) {
    try {
      $pb = New-Object System.Speech.Synthesis.PromptBuilder
      $pb.AppendTextWithPronunciation($letter, $ipa)
      $synth.SetOutputToWaveFile($out)
      $synth.Speak($pb)
      $synth.SetOutputToNull()
      $ok = $true
      break
    } catch {
      $synth.SetOutputToNull()
      Write-Host ("  {0}: IPA '{1}' rejected ({2})" -f $letter, $ipa, $_.Exception.Message)
    }
  }
  if (-not $ok) { $failed += $letter }
  else {
    $len = (Get-Item $out).Length
    Write-Host ("  {0}.wav  {1,6} bytes" -f $letter, $len)
  }
}

$synth.Dispose()
if ($failed.Count) { Write-Host ("FAILED: " + ($failed -join ', ')) } else { Write-Host 'All 26 letter sounds generated.' }
