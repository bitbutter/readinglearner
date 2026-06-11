# Generates bespoke phonics audio for letters a-z AND compound letter sounds
# (digraphs like sh/ee/oo) into audio/letters/*.wav using Windows SAPI
# (Microsoft Hazel, en-GB) with explicit IPA pronunciations, so the
# synthesizer can never "spell out" a pseudo-word like puh -> "pee you aitch".
#
# Tweak a sound: edit its IPA string below and re-run this script, then convert
# to mp3 (see repo commit notes) and commit.
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
$ezh    = [string][char]0x0292   # zh
$turnedR = [string][char]0x0279  # r (approximant)
$long   = [string][char]0x02D0   # length mark
$esh    = [string][char]0x0283   # sh
$theta  = [string][char]0x03B8   # th (voiceless, "thumb")
$eng    = [string][char]0x014B   # ng
$upsilon = [string][char]0x028A  # short oo (book) / second half of "oa"
$openO  = [string][char]0x0254   # aw (for)
$scriptA = [string][char]0x0251  # ah (car)
$revEps = [string][char]0x025C   # er (her)

# Phonics sounds (UK synthetic phonics): continuants are lengthened, plosives
# get the shortest possible schwa release. Each entry: primary IPA, then a
# simpler fallback in case the voice rejects the primary.
$sounds = [ordered]@{
  # ---- single letters ----
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
  # ---- compound sounds (digraphs / trigraphs) ----
  sh  = @(($esh + $long), $esh)                    # ship
  ch  = @(('t' + $esh + $schwa), ('t' + $esh + $schwa))  # chair
  th  = @(($theta + $long), $theta)                # thumb (voiceless)
  ng  = @(($eng + $long), $eng)                    # ring
  ee  = @(('i' + $long), 'i')                      # see
  oo  = @(('u' + $long), 'u')                      # moon
  qu  = @(('kw' + $schwa), ('kw' + $schwa))        # queen
  ay  = @(('e' + $smallI), ('e' + $smallI))        # play
  oa  = @(($schwa + $upsilon), ($schwa + $upsilon)) # boat
  oy  = @(($openO + $smallI), ($openO + $smallI))  # toy
  oi  = @(($openO + $smallI), ($openO + $smallI))  # coin
  ar  = @(($scriptA + $long), $scriptA)            # car
  or  = @(($openO + $long), $openO)                # for
  er  = @(($revEps + $long), $revEps)              # her
  ir  = @(($revEps + $long), $revEps)              # bird
  igh = @(('a' + $smallI), ('a' + $smallI))        # night
  air = @(($eps + $schwa), ($eps + $schwa))        # chair/air
  wh  = @(('w' + $schwa), ('w' + $schwa))          # when
  ck  = @(('k' + $schwa), ('k' + $schwa))          # duck
  ll  = @(('l' + $long), 'l')                      # bell
  ss  = @(('s' + $long), 's')                      # miss
  tt  = @(('t' + $schwa), ('t' + $schwa))          # little
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$outDir   = Join-Path $repoRoot 'audio\letters'
New-Item -ItemType Directory -Force $outDir | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Hazel Desktop')
$synth.Rate = -2   # slow and clear for a child

$failed = @()
foreach ($key in $sounds.Keys) {
  $primary, $fallback = $sounds[$key]
  $out = Join-Path $outDir ($key + '.wav')
  $ok = $false
  foreach ($ipa in @($primary, $fallback)) {
    try {
      $pb = New-Object System.Speech.Synthesis.PromptBuilder
      $pb.AppendTextWithPronunciation($key, $ipa)
      $synth.SetOutputToWaveFile($out)
      $synth.Speak($pb)
      $synth.SetOutputToNull()
      $ok = $true
      break
    } catch {
      $synth.SetOutputToNull()
      Write-Host ("  {0}: IPA '{1}' rejected ({2})" -f $key, $ipa, $_.Exception.Message)
    }
  }
  if (-not $ok) { $failed += $key }
  else {
    $len = (Get-Item $out).Length
    Write-Host ("  {0}.wav  {1,6} bytes" -f $key, $len)
  }
}

$synth.Dispose()
if ($failed.Count) { Write-Host ("FAILED: " + ($failed -join ', ')) } else { Write-Host ("All " + $sounds.Count + " sounds generated.") }
