# Jellyfin for Vega OS

An unofficial, native [Jellyfin](https://jellyfin.org) client for Amazon Vega OS
— the operating system on newer Fire TV Sticks. It reproduces the look of the
Jellyfin web client while running as a real React Native for Vega application:
no web view, no bundled browser, and playback through the device's own media
pipeline.

> This project is not affiliated with or endorsed by the Jellyfin project or
> Amazon. "Jellyfin" and the Jellyfin logo belong to the Jellyfin project.

## Why a native port

Vega OS dropped Android compatibility, so the existing Jellyfin Android TV app
cannot run on it. Rendering `jellyfin-web` inside a web view would work but
gives up hardware decoding, remote-control focus handling, and start-up time.
This client instead talks to the Jellyfin REST API directly and feeds media to
Vega's W3C Media implementation, which is backed by the platform's hardware
decoders.

## Features

- Server discovery by address, with Jellyfin version detection
- Sign-in by user name and password, or by **Quick Connect** code
- Persistent session and a stable device id, so the app opens signed in
- Home screen with **Continue Watching**, **Next Up**, and **Latest** per library
- Library browsing with a poster grid, paging, and five sort orders
- Detail pages with backdrop art, logo treatment, cast, and recommendations
- Series browsing: season picker and an episode list with stills and progress
- Search across movies, series, episodes, albums, artists and collections
- Video playback through Media Source Extensions, with a Jellyfin-styled
  on-screen display, seeking and pause
- Watch-state reporting, so progress syncs with every other Jellyfin client
- Mark watched/unwatched and favourite from the detail page
- Remembers the last server and account, and signs in again on launch

## Requirements

- Node.js 20 or newer
- The Amazon Vega SDK with the `vega` CLI on `PATH`
- A Fire TV running Vega OS 1.2 in developer mode
- A reachable Jellyfin server (developed against 10.11)

Built and tested with Vega SDK `0.24.9914`, Vega CLI `1.3.4`, React Native
Kepler `4.x`, React Native `0.83`, on a 32-bit (`armv7`) Fire TV Stick running
Vega OS 1.2.

## Building

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build:debug     # or build:release
```

`vega build` regenerates the `[needs.module]` list in `manifest.toml` from
`package.json`, so add Vega libraries with `vega project install` rather than
editing the manifest by hand.

## Installing on a device

Connect the device once — the Vega CLI talks to it over the device adaptor,
which uses the same transport as adb:

```bash
"$(vega which vda)" connect 192.168.1.50:5555
vega device list
```

Then install and launch the build matching the device's architecture:

```bash
vega run-app build/armv7-debug/app_armv7.vpkg com.jonathanlemes.jellyfinvega.main
```

Use `aarch64` for 64-bit devices. `vega device info` reports the architecture.

To watch what the app is doing:

```bash
vega device start-log-stream
```

## Using the app

1. Launch **Jellyfin** from the Fire TV home screen.
2. Enter your server address. A bare host such as `192.168.1.10` is assumed to
   be `http` on port `8096`; type a full URL for anything else.
3. Sign in with your user name and password, or press **Use Quick Connect** and
   type the displayed code into Jellyfin on your phone or browser.
4. Browse from the home screen, or pick a library from the top navigation bar.

### Remote control

| Context | Key | Action |
| --- | --- | --- |
| Anywhere | Back | Go back one screen |
| Browsing | D-pad / OK | Move focus, open the focused item |
| Playback | OK or Play/Pause | Toggle pause |
| Playback | ◀ ▶ | Seek 10 seconds |
| Playback | Rewind / Fast-forward | Seek 30 seconds |
| Playback | Up / Down / Info | Show the on-screen display |
| Playback | Back | Stop and return |

## How it works

```text
src/
  api/          Jellyfin REST client, device profile, image and stream URLs
  player/       HLS parsing and the Media Source Extensions playback pipeline
  components/   Focus primitive, cards, shelves, navigation bar, gradients
  navigation/   Route definitions and the navigation stack
  screens/      Connect, Home, Library, Detail, Search, Settings, Player
  state/        Session context and on-device persistence
  theme/        Colours, spacing and typography mirroring jellyfin-web
  utils/        Formatting helpers
```

A few decisions worth knowing about:

**The device profile is measured, not assumed.** Jellyfin decides what to
transcode from the `DeviceProfile` the client sends. Rather than hard-coding a
codec list, `src/api/vegaCapabilities.ts` asks the platform through
`decodingInfo` at start-up and advertises only what it actually accepts. The
Fire TV Stick this was developed on reports h264, hevc, av1, vp9 and vp8 for
video and aac, mp3, opus, flac and vorbis for audio — notably **no Dolby**, so
claiming AC3/E-AC-3 makes the server hand back a file the hardware then
refuses.

**Navigation is hand-rolled.** With a small, fixed set of screens, owning the
stack directly keeps control over what the remote's Back key does, which is the
only way back on a TV.

**The player's on-screen display has no focusable controls.** Everything is
driven from remote key events, so the OSD never competes with the platform's
spatial navigation.

**Persistence uses `AsyncStorage`, not the file system module.**
`@amazon-devices/kepler-file-system` looks like the right tool, but on Vega OS
1.2 its `readFileAsString` and `writeStringToFile` fail with
`com.amazon.kepler.io.IoError` for every path and every open mode — only
`exists`, `getEntries` and `openFile` work, which is not enough to store
anything. `AsyncStorage` from the Kepler runtime works, and is what holds the
session, the device id and the remembered credentials.

**The remembered password is stored in clear text.** It is private to the app
and wiped on uninstall, but anyone with developer-mode access to the device can
read it. It is kept because signing in with a D-pad is genuinely painful;
signing out removes it.

**Service entries in `manifest.toml` are load-bearing, and failures are
silent.** Vega does not report a missing service as a permission error — the
feature just misbehaves. Two cases cost real debugging time here:
`com.amazon.inputmethod.service` is what lets a focused `TextInput` open the
on-screen keyboard (without it the field is simply dead, and the only clue is
`no active connection to input method service` in the device log), and the
`com.amazon.media*` / `com.amazon.audio.*` entries are what let the player
create a decoder at all. If something stops working after a manifest change,
check those first.

**The keyboard opens on press, not on focus.** Vega opens the on-screen
keyboard as soon as a `TextInput` gains focus, which makes a form unusable with
a remote: dismissing the keyboard returns focus to the same input, which
immediately reopens it, so the user can never reach the next field. `TextField`
therefore renders a focusable button while idle and only mounts a real
`TextInput` when the user presses OK. Finishing unmounts the input again, so
there is nothing left to re-trigger the keyboard.

## How playback works

Vega OS 1.2 will not open a media URL. Assigning one to the media element is
rejected before any decoding happens:

```
W3CMEDIA:[MSE_EME] set_src_uri: MPB Call failed with code: 50004
W3CMEDIA:makeMediaError: code= 4      # MEDIA_ERR_SRC_NOT_SUPPORTED
```

This is true for direct play and for HLS, MP4 and MKV alike, even though the
URLs themselves serve fine to `curl`. The platform accepts only **Media Source
Extensions**, so `src/player/` implements the client side of HLS: it fetches
the manifest, parses it, downloads fragmented-MP4 segments over HTTP, and
appends them to a `SourceBuffer` feeding a `VideoPlayer` that renders into a
`KeplerVideoSurfaceView`.

Two consequences follow:

- **Direct play is deliberately refused.** MSE can only be fed fragmented MP4,
  which a plain `.mkv` or progressive `.mp4` is not, so the client asks the
  server for HLS every time. Stream copy stays enabled, so a file the device
  can already decode is remuxed rather than re-encoded and the server does
  very little work.
- **`SegmentContainer=mp4` is forced on the transcoding URL.** Jellyfin
  otherwise emits MPEG-TS segments, which cannot be appended to a
  `SourceBuffer`. Asking explicitly is what makes the manifest carry an
  `EXT-X-MAP` initialisation segment and `.mp4` fragments.

Seeking discards the buffer and resumes from the segment covering the target.
That is exact, because each fragment carries its own timestamps.

## Other limitations

- Subtitles rely on the platform's caption rendering; there is no in-app
  subtitle or audio-track picker yet, so the server's default tracks are used.
- Live TV, DVR, SyncPlay, playlists and music playback beyond browsing are not
  implemented.
- There is no quality/bitrate selector; the profile requests up to 20 Mbps.
- No offline downloads, multi-user switching, or parental-control UI.
- Only tested against Jellyfin 10.11 on a 32-bit Fire TV Stick.

## Licensing

This client is released under the [GPL-3.0](LICENSE) license, matching the
Jellyfin project it is built for.

The Jellyfin name and logo belong to the Jellyfin project. The icon in
`assets/image/icon.png` and the mark in `src/components/JellyfinLogo.tsx` are
derived from [jellyfin-ux](https://github.com/jellyfin/jellyfin-ux), which is
licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Vega and Kepler libraries under `@amazon-devices/*` are distributed by Amazon
under their own terms and are not vendored here.
