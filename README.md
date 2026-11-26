# Lejon Spel

Mobilvänlig webbapp (PWA) med analys av **Stryktipset, Europatipset, V75 och V86**:
vinstchans från odds, folkets streck, spelvärde, skrällchans, exakt resultat (Poisson-modell från odds),
svenska/engelska analysnoteringar och en systembyggare.

* `update_data.py` – hämtar nästa öppna omgångar från Svenska Spels och ATG:s publika API:er och skriver `data.json`.
* `notes.json` – analystexter (svenska + engelska källor) som Grok Bot-rutinen fyller i. Saknas en text visas det tydligt.
* `.github/workflows/update.yml` – uppdaterar `data.json` automatiskt varannan timme.
* `publish.sh` – samma uppdatering + push, körs från Grok Bot-rutinen.

Endast analys, inga garantier för vinst · 18+ · [stodlinjen.se](https://stodlinjen.se)
