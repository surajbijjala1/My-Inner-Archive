# Sounds

Every file here is a **silent placeholder** (50 ms of silence, WAV). The
plumbing in `src/sounds.ts` loads and plays them exactly as it will the real
clips, so they can be swapped without touching any code that calls `play()`.

## Licence rule

Only **CC0 or public-domain** recordings. For each file you add, fill in the
source and licence in the table below in the same commit. No attribution-
required licences (CC BY, etc.), no "royalty-free" packs with their own terms,
no recordings of unclear origin. A file whose row isn't filled in doesn't ship.

## The sounds

All are short and quiet: the app sets the level (`MASTER_VOLUME` and the
per-clip gain in `src/sounds.ts`), so record or normalise them at a
comfortable full level, trim the silence at both ends, and keep each under
about 1 s and 50 KB.

| File | Plays when | Intended character | Source | Licence |
|---|---|---|---|---|
| `open.wav` | the diary's cover opens on a cold start (`useEntrance`) | a book's cover opening: soft board and paper, ~0.8 s | placeholder | — |
| `save.wav` | an entry is saved | a pen lifting off paper / a page settling, ~0.4 s | placeholder | — |
| `tear.wav` | an entry rips away, once the server has confirmed the delete | a soft paper tear, ~0.6 s | placeholder | — |
| `chat-send.wav` | you send a typed chat message | a light paper slide or quill tick, ~0.2 s | placeholder | — |
| `chat-receive.wav` | the companion's reply arrives | a softer, lower answer to chat-send, ~0.3 s | placeholder | — |
| `navigate.wav` | you move between Journal, Chat, Patterns and Settings | the barest page brush, ~0.15 s (plays very quietly) | placeholder | — |
| `page.wav` | reserved: a single page turning (the phone's page turn currently uses `navigate`) | a single page turning, ~0.5 s | placeholder | — |

## Format

WAV keeps the placeholders tiny. For the real clips prefer **MP3** (or AAC
in `.m4a`): both decode in the Android WebView and in iOS Safari. Ogg/Opus
does not decode on older iOS. If you change an extension, change the matching
import at the top of `src/sounds.ts`.
