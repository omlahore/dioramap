---
name: dioramap
description: Draw any real place on Earth as a pixel-art isometric diorama (SimCity style), as a poster, an MP4 video or a GIF, day or night, from open map data. Use when the user asks for a map, poster, diorama, wallpaper, "tiny city", 3D-looking map or a short video of a place, address, street, neighbourhood or landmark.
---

# dioramap

Renders a square of the real world as an isometric pixel-art diorama with a title plaque. Buildings come from Overture Maps, with their mapped heights, parts and roof shapes. Roads, water and parks come from OpenStreetMap through OpenFreeMap. No API key.

## Run it

```bash
npx dioramap "<place, address or lat,lon>" -r <radius_m> -t <day|night> -o <file.png|.mp4|.gif>
```

It needs Node 20+ and Google Chrome, Edge or Chromium installed. A poster takes about ten seconds.

## Choosing the settings

- Radius (`-r`) is half the width of the square in metres.
  - A single landmark or square: 120 to 180.
  - A neighbourhood or a street: 180 to 260.
  - A downtown with towers: 250 to 400.
  - Above 450 the buildings get too small to read.
- Theme (`-t`): `day` by default. `night` lights the windows and floodlights landmarks such as the Eiffel Tower. It looks best with towers or dense blocks.
- `--rotate 45|135|225|315` picks the side you look from. If a tower hides the landmark the user cares about, render again from another side.
- `--title` and `--subtitle` override the plaque. Use the name the user used, not the geocoder's.

## Videos and GIFs

- `--video` makes a 1080x1350 MP4: the street map rises into the city, then night falls. Use it when the user wants something to post.
- `--gif` makes a looping 720x900 GIF of the same thing.
- `--spin` turns the camera all the way round during the video.
- `-s 1080x1920` gives a vertical video for Reels, TikTok or Shorts.

## After rendering

Look at the output before you reply. For a video, check the poster version or one frame first.

- If the square is mostly water, empty or the wrong spot, the geocoder picked another place with the same name. Retry with the city and country, or with `lat, lon`.
- If buildings are sparse, the area is thinly mapped. Say so in one line. Don't invent buildings.
- Offer a night version or a video when the day poster has towers, a landmark or a dense centre.
