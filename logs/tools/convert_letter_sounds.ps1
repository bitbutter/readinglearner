# Converts audio/letters/*.wav (from generate_letter_sounds.ps1) into the
# trimmed mp3s the app ships. Two treatments:
#   1. All clips: strip SAPI's leading/trailing silence.
#   2. Release-type sounds (plosive/affricate + schwa): hard tail-cap with a
#      fast fade-out. Hazel lets the schwa decay into a y-like glide
#      ("g" -> "guhy"); cutting the tail keeps the burst + schwa onset only.
# Tune a cap below (seconds after silence-strip) and re-run if a sound still
# glides or gets cut too short. Bump AUDIO_VERSION in app.js after re-running.
#
# Usage:  powershell -File logs\tools\convert_letter_sounds.ps1
#         powershell -File logs\tools\convert_letter_sounds.ps1 -NoCaps
#
# Use -NoCaps for human recordings (e.g. from record.html): the tail caps
# exist to cut Hazel's synthetic schwa glide and would clip a natural voice.

param([switch]$NoCaps)

$ErrorActionPreference = 'Stop'
$ffmpeg = 'C:\Program Files\ImageMagick-7.1.0-Q16-HDRI\ffmpeg.exe'

# Tail caps for schwa-release sounds. Continuants (s, m, sh, th...) and
# vowels/diphthongs (a, ee, igh, air...) keep their full length.
$caps = @{
  b = 0.26; c = 0.26; d = 0.26; g = 0.26; h = 0.26; j = 0.32; k = 0.26
  p = 0.26; q = 0.32; t = 0.26; w = 0.26; y = 0.26
  ch = 0.32; ck = 0.26; qu = 0.32; tt = 0.26; wh = 0.26
}

$fade    = 0.06
$silence = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,' +
           'areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dir      = Join-Path $repoRoot 'audio\letters'

foreach ($f in Get-ChildItem "$dir\*.wav") {
  $key    = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  $out    = [IO.Path]::ChangeExtension($f.FullName, '.mp3')
  $af     = $silence
  $capped = (-not $NoCaps -and $caps.ContainsKey($key))
  if ($capped) {
    $cap = $caps[$key]
    $st  = [math]::Round($cap - $fade, 3)
    $af  = "$silence,atrim=0:$cap,afade=t=out:st=${st}:d=$fade"
  }
  & $ffmpeg -y -loglevel error -i $f.FullName -af $af -codec:a libmp3lame -q:a 5 $out
  Write-Host ("  {0}.mp3{1}" -f $key, $(if ($capped) { ' (tail-capped ' + $caps[$key] + 's)' } else { '' }))
}

Write-Host 'Done. Delete the wavs when satisfied, bump AUDIO_VERSION in app.js, commit.'
