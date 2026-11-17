---
name: dioramap
description: Draw any real place on Earth as a pixel-art isometric diorama poster (SimCity style), day or night, from open map data. Use when the user asks for a map, poster, diorama, wallpaper or "tiny city" of a place, address, neighbourhood or landmark.
---

# dioramap

Renders a square of the real world as an isometric pixel-art diorama with a title plaque. Buildings come from Overture Maps, roads, water and parks from OpenStreetMap via OpenFreeMap. No API key.

## Run it

```bash
npx dioramap "<place, address or lat,lon>" -r <radius_m> -t <day|night> -o <file.png>
```

Needs Node 20+ and Google Chrome, Edge or Chromium installed.

## Choosing the settings

- Radius is the half-width of the square in metres.
  - A single landmark or square: 120 to 180.
  - A neighbourhood or a street: 180 to 260.
  - A downtown with towers: 250 to 400.
  - Above 450 the buildings get too small to read.
- Theme: `day` by default. `night` lights windows and looks best with towers or dense blocks.
- `--rotate 45|135|225|315` picks the side you look from. If the landmark the user cares about is hidden behind a tower, render again from another side.
- `--title` and `--subtitle` override the plaque. Use the name the user used, not the geocoder's.

## After rendering

Open the PNG and look at it before you reply.

- If the square is mostly water, empty or the wrong spot, the geocoder picked another place with the same name. Retry with a city and country, or with `lat,lon`.
- If buildings are sparse, the area is thinly mapped. Say so in one line. Don't invent buildings.
- Offer a night version when the day render has towers or a dense centre.
