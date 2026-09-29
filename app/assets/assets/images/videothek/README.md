# Videothek-Bildordner

Zielpfade der v2-Videothek-Assets (Aufträge V1–V9 in `assets/source/v2-art/prompts.md`):

```
room.png        1536x2304  Hintergrund (V1 Boden + V2 Wand, komponiert)
shelf_a.png     512x512    Themenregal A  (Regal "Neu", "Kurz und schön")
shelf_b.png     512x512    Themenregal B  (Regal "Beliebt", "Für dich")
counter.png     512x512    Tresen
return_box.png  512x512    Rückgabebox
neon_sign.png   512x512    Neonschild über der Tür (Wand-Prop)
poster_a|b|c.png 512x512   Poster (Wand-Props, P1)
spinner.png     512x512    Kassettenständer "Überrasch mich" (P1)
```

Solange eine Datei fehlt, greift `assets/skins/videothek.json`:
Hintergrund → `assets/images/store/room.png`, Regale → `store/shelf.png`,
Tresen → `store/counter.png`, Rückgabebox/Ständer → `store/kiosk.png`,
Neon → `topdown/neon_sign.png`. Poster ohne Fallback: sie werden schlicht
nicht gezeichnet, bis V7 vorliegt.
