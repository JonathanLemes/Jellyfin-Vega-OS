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
This client instead talks to the Jellyfin REST API directly and hands stream
URLs to Vega's W3C Media implementation, which is backed by the platform's
hardware decoders.

## Features

- Server discovery by address, with Jellyfin version detection
- Sign-in by user name and password, or by **Quick Connect** code
- Persistent session and a stable device id, so the app opens signed in
- Home screen with **Continue Watching**, **Next Up**, and **Latest** per library
- Library browsing with a poster grid, paging, and five sort orders
- Detail pages with backdrop art, logo treatment, cast, and recommendations
- Series browsing: season picker and an episode list with stills and progress
- Search across movies, series, episodes, albums, artists and collections
- Watch-state reporting, so progress syncs with every other Jellyfin client
- Mark watched/unwatched and favourite from the detail page
- Playback negotiation: direct play when the device can decode the file,
  server-side HLS transcoding when it cannot, plus a Jellyfin-styled on-screen
  display — **but see the playback limitation below; video does not yet render
  on Vega OS 1.2**

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
  components/   Focus primitive, cards, shelves, navigation bar, gradients
  navigation/   Route definitions and the navigation stack
  screens/      Connect, Home, Library, Detail, Search, Settings, Player
  state/        Session context and on-device persistence
  theme/        Colours, spacing and typography mirroring jellyfin-web
  utils/        Formatting helpers
```

A few decisions worth knowing about:

**The device profile is measured, not assumed.** Jellyfin decides whether to
transcode from the `DeviceProfile` the client sends. Rather than hard-coding a
codec list, `src/api/deviceProfile.ts` probes the Vega media stack with
`canPlayType` and advertises only what the device actually accepts. A Fire TV
without AV1 therefore gets AV1 transcoded automatically instead of failing at
playback time.

**Seeking behaves differently for direct play and transcoding.** A directly
played file is seekable in the player, so seeks set `currentTime`. A transcoded
stream is generated by the server starting at a requested offset, so seeking
re-requests the stream at the new position. That costs a short re-buffer on
each seek but is always correct.

**Navigation is hand-rolled.** With a small, fixed set of screens, owning the
stack directly keeps control over what the remote's Back key does, which is the
only way back on a TV.

**The player's on-screen display has no focusable controls.** Everything is
driven from remote key events, so the OSD never competes with the platform's
spatial navigation.

**Persistence uses the Vega file system module.** The session and device id live
in `/data`, the app's private sandbox directory. It survives reboots and
upgrades, and is cleared on uninstall — so reinstalling asks you to sign in
again.

**Service entries in `manifest.toml` are load-bearing, and failures are
silent.** Vega does not report a missing service as a permission error — the
feature just misbehaves. Two cases cost real debugging time here:
`com.amazon.inputmethod.service` is what lets a focused `TextInput` open the
on-screen keyboard (without it the field is simply dead, and the only clue is
`no active connection to input method service` in the device log), and the
`com.amazon.media*` / `com.amazon.audio.*` entries are what let the player
create a decoder at all. If something stops working after a manifest change,
check those first.

**The text field must be the focusable element itself.** Wrapping a
`TextInput` in a focusable `Pressable` and calling `.focus()` on press does not
open the keyboard: the wrapper holds platform focus, the input never does, and
the IME never attaches. `TextField` therefore makes the input focusable and
draws the focus ring from the input's own focus events.

## Known limitation: video does not play yet

Everything up to and including playback negotiation works on a real Fire TV —
sign-in, browsing, artwork, the detail page, the `PlaybackInfo` exchange, and
the direct-play/transcode decision. **The video itself does not render.**

Assigning a URL to the media element is rejected by the platform before any
decoding happens:

```
W3CMEDIA:[MSE_EME] set_src_uri: MPB Call failed with code: 50004
W3CMEDIA:[MSE_EME] MediaPlayerPipelineImpl::prepareForPlayback(): set_src_uri(mUri) failed
W3CMEDIA:makeMediaError: code= 4      # MEDIA_ERR_SRC_NOT_SUPPORTED
```

This happens for direct play and for HLS, for MP4 and for MKV, and the URLs
themselves are fine (they return `200 video/mp4` to `curl`). The package README
advertises URL playback, but on Vega OS 1.2 the media backend appears to accept
only **Media Source Extensions** — a `MediaSource` fed by `SourceBuffer`
appends, which is the path the Vega documentation's own example uses.

Making playback work therefore needs the player rewritten around MSE: parse the
HLS manifest in JavaScript, fetch fragmented-MP4 segments, and append them to a
`SourceBuffer`, rather than handing a URL to the element. Jellyfin can emit
fMP4 HLS segments (`SegmentContainer=mp4`), which are appendable as-is, so no
remuxing is needed — but it is a substantial piece of work and is not done.

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
