# Human-voice pipeline for audio/letters/*.wav (takes from record.html):
#   1. Peak-normalize each clip to -1 dBFS (two-pass: volumedetect, then volume).
#   2. Trim leading/trailing silence relative to the NORMALIZED level, keeping
#      a short pad so soft onsets (fff, sss) aren't clipped.
#   3. Short fade-in/out to guard against clicks at the cut points.
#   4. Encode mp3 alongside.
# Prints duration + applied gain per clip and warns about suspiciously short
# results. Originals are untouched; back them up before deleting.
# Afterwards: bump AUDIO_VERSION in app.js, commit.
#
# Usage:  powershell -File logs\tools\normalize_letter_sounds.ps1

$ErrorActionPreference = 'Stop'
$ffmpeg = 'C:\Program Files\ImageMagick-7.1.0-Q16-HDRI\ffmpeg.exe'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dir      = Join-Path $repoRoot 'audio\letters'

foreach ($f in Get-ChildItem "$dir\*.wav") {
  $key = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  $out = [IO.Path]::ChangeExtension($f.FullName, '.mp3')

  # Pass 1: measure peak. (cmd /c handles the stderr redirect: PS 5.1 turns
  # native stderr into ErrorRecords and throws under -ErrorAction Stop.)
  $detect = cmd /c "`"$ffmpeg`" -i `"$($f.FullName)`" -af volumedetect -f null NUL 2>&1" | Out-String
  if ($detect -notmatch 'max_volume:\s*(-?[\d.]+) dB') { Write-Host "  $key SKIPPED (no peak found)"; continue }
  $gain = [math]::Round(-1.0 - [double]$Matches[1], 2)

  # Pass 2: normalize, trim, fade, encode.
  $af = "volume=${gain}dB," +
        'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05,' +
        'areverse,silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.08,' +
        'afade=t=in:d=0.02,areverse,afade=t=in:d=0.01'
  cmd /c "`"$ffmpeg`" -y -loglevel error -i `"$($f.FullName)`" -af `"$af`" -codec:a libmp3lame -q:a 5 `"$out`" 2>&1" | Out-Null

  $probe = cmd /c "`"$ffmpeg`" -i `"$out`" -f null NUL 2>&1" | Out-String
  $dur = if ($probe -match 'Duration: (\d+:\d+:[\d.]+)') { [TimeSpan]::Parse($Matches[1]).TotalSeconds } else { -1 }
  $warn = if ($dur -ge 0 -and $dur -lt 0.12) { '  <-- SUSPICIOUSLY SHORT, check this take' } else { '' }
  Write-Host ("  {0,-4} gain {1,6} dB   {2,5:0.00}s{3}" -f $key, $gain, $dur, $warn)
}

Write-Host 'Done. Audition, then delete the wavs, bump AUDIO_VERSION, commit.'
