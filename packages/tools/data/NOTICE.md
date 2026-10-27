# Frida nutrition data

`frida-foods.json` is derived from the Danish Food Composition Database, Frida version 5.5,
published by the National Food Institute, Technical University of Denmark (DTU Food).

- Source: https://frida.fooddata.dk, dataset DOI https://doi.org/10.11583/DTU.29500682
- License: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- Changes: reduced to English/Danish names, food group and per-100 g energy, protein, fat, saturated fat,
  available carbohydrates, sugars, dietary fibre and salt. Regenerate with `pnpm --filter @dinner/tools build:frida <xlsx>`.
